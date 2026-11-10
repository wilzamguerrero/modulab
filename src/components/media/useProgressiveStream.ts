import { createContext, useCallback, useContext, useEffect, useRef, useState } from 'react';

/**
 * Carga en flujo continuo
 * =======================
 * En lugar de pedir todas las imágenes de golpe (que satura la conexión y hace
 * que ninguna termine pronto), las tarjetas entran en goteo: unas pocas por
 * frame, y el ritmo lo regula un límite de medios cargando *a la vez*. Cuando
 * una imagen termina, entra la siguiente. El resultado es una cascada suave en
 * vez de una lista que aparece a trozos.
 *
 * Dos velocidades:
 *  - En segundo plano va tranquilo, para no robar fluidez al scroll.
 *  - Cuando el usuario se acerca al final de lo cargado, acelera para que nunca
 *    se encuentre con el vacío.
 */

/** Primeras tarjetas: entran sin esperar para llenar la pantalla rápido. */
const INITIAL_BURST = 14;

/**
 * Un móvil no aguanta el mismo ritmo que un portátil: menos núcleos, menos ancho
 * de banda y cada decodificación pesa mucho más en proporción. Se mide una sola
 * vez al cargar el módulo.
 */
const IS_CONSTRAINED = (() => {
  if (typeof window === 'undefined') return false;
  const narrow = window.matchMedia?.('(max-width: 820px)').matches ?? false;
  const fewCores = (navigator.hardwareConcurrency ?? 8) <= 4;
  return narrow || fewCores;
})();

/** Medios descargando simultáneamente. Es la palanca real contra la saturación. */
const IDLE_CONCURRENCY = IS_CONSTRAINED ? 3 : 5;
const NEAR_EDGE_CONCURRENCY = IS_CONSTRAINED ? 6 : 12;

/**
 * Si los medios en vuelo no terminan, se deja de esperarlos y el flujo sigue.
 * Evita que una URL de Notion caducada congele la cascada.
 */
const STALL_MS = 2200;

interface MediaLoadApi {
  registerPending: (id: string) => void;
  reportSettled: (id: string) => void;
}

export const MediaLoadContext = createContext<MediaLoadApi | null>(null);

interface UseProgressiveStreamOptions {
  total: number;
  /** Cambia al navegar a otra galería: reinicia el flujo. */
  resetKey: string | null;
}

interface ProgressiveStreamResult {
  visibleCount: number;
  isComplete: boolean;
  loadApi: MediaLoadApi;
  /** Se coloca al final de la lista: al asomarse, el flujo acelera. */
  sentinelRef: React.RefObject<HTMLDivElement | null>;
}

export function useProgressiveStream({
  total,
  resetKey,
}: UseProgressiveStreamOptions): ProgressiveStreamResult {
  const pendingRef = useRef<Set<string>>(new Set());
  const rafRef = useRef<number | undefined>(undefined);
  const stallRef = useRef<number | undefined>(undefined);
  const nearEdgeRef = useRef(false);
  const sentinelRef = useRef<HTMLDivElement | null>(null);

  const [stream, setStream] = useState<{ key: string | null; count: number }>({
    key: resetKey,
    count: Math.min(INITIAL_BURST, Math.max(total, 0)),
  });

  // Reinicio al cambiar de galería. Se ajusta durante el render para que nunca
  // llegue a pintarse un frame con la lista entera.
  if (stream.key !== resetKey) {
    pendingRef.current.clear();
    nearEdgeRef.current = false;
    setStream({ key: resetKey, count: Math.min(INITIAL_BURST, Math.max(total, 0)) });
  }

  const visibleCount = Math.min(stream.count, Math.max(total, 0));
  const isComplete = visibleCount >= total;

  const totalRef = useRef(total);
  totalRef.current = total;
  const visibleRef = useRef(visibleCount);
  visibleRef.current = visibleCount;

  // Con listas muy largas se admiten más por frame: el goteo sigue siendo suave
  // pero no obliga a React a re-renderizar cientos de veces.
  const dripRef = useRef(3);
  dripRef.current = Math.min(
    IS_CONSTRAINED ? 4 : 12,
    Math.max(IS_CONSTRAINED ? 2 : 3, Math.ceil(total / 120)),
  );

  const clearTimers = useCallback(() => {
    if (rafRef.current) {
      cancelAnimationFrame(rafRef.current);
      rafRef.current = undefined;
    }
    if (stallRef.current) {
      clearTimeout(stallRef.current);
      stallRef.current = undefined;
    }
  }, []);

  // Bomba de admisión: un frame, unas pocas tarjetas, y vuelta a empezar.
  const pump = useCallback(() => {
    if (rafRef.current) cancelAnimationFrame(rafRef.current);

    rafRef.current = requestAnimationFrame(() => {
      rafRef.current = undefined;
      if (visibleRef.current >= totalRef.current) return;

      const cap = nearEdgeRef.current ? NEAR_EDGE_CONCURRENCY : IDLE_CONCURRENCY;

      // Cupo lleno: se espera a que algún medio termine. `reportSettled`
      // reanuda el flujo; el temporizador es sólo la red de seguridad.
      if (pendingRef.current.size >= cap) {
        if (!stallRef.current) {
          stallRef.current = window.setTimeout(() => {
            stallRef.current = undefined;
            pendingRef.current.clear();
            pump();
          }, STALL_MS);
        }
        return;
      }

      if (stallRef.current) {
        clearTimeout(stallRef.current);
        stallRef.current = undefined;
      }

      setStream((prev) => ({
        key: prev.key,
        count: Math.min(prev.count + dripRef.current, totalRef.current),
      }));
    });
  }, []);

  const pumpRef = useRef(pump);
  pumpRef.current = pump;

  const registerPending = useCallback((id: string) => {
    pendingRef.current.add(id);
  }, []);

  const reportSettled = useCallback((id: string) => {
    if (!pendingRef.current.delete(id)) return;
    // Un hueco libre = una tarjeta más entra. Esto produce el flujo continuo.
    pumpRef.current();
  }, []);

  const loadApiRef = useRef<MediaLoadApi>({ registerPending, reportSettled });

  // Cada vez que entran tarjetas se vuelve a evaluar si caben más. Este efecto
  // corre después de los de las tarjetas nuevas, así que el recuento de medios
  // en vuelo ya está actualizado.
  useEffect(() => {
    if (visibleCount >= total) {
      clearTimers();
      return;
    }
    pump();
  }, [visibleCount, total, pump, clearTimers]);

  // El usuario llegó al borde de lo cargado: subir el ritmo.
  useEffect(() => {
    const el = sentinelRef.current;
    if (!el || typeof IntersectionObserver === 'undefined') return;

    const observer = new IntersectionObserver(
      (entries) => {
        const near = entries.some((e) => e.isIntersecting);
        if (near === nearEdgeRef.current) return;
        nearEdgeRef.current = near;
        if (near) pumpRef.current();
      },
      { rootMargin: '600px 0px' },
    );
    observer.observe(el);
    return () => observer.disconnect();
  }, [isComplete]);

  useEffect(() => clearTimers, [clearTimers]);

  return { visibleCount, isComplete, loadApi: loadApiRef.current, sentinelRef };
}

/**
 * Lado tarjeta: declara que este medio está en vuelo y devuelve el callback
 * para marcarlo como terminado. Idempotente y a prueba de desmontajes.
 */
export function useMediaSettle(id: string, enabled: boolean): () => void {
  const api = useContext(MediaLoadContext);
  const doneRef = useRef(false);

  useEffect(() => {
    if (!enabled || !api) return;
    doneRef.current = false;
    api.registerPending(id);
    // Si la tarjeta se desmonta antes de cargar, se libera el cupo igualmente.
    return () => {
      if (!doneRef.current) api.reportSettled(id);
    };
  }, [id, enabled, api]);

  return useCallback(() => {
    if (doneRef.current) return;
    doneRef.current = true;
    api?.reportSettled(id);
  }, [api, id]);
}

/**
 * Monta contenido pesado (iframes de PDF, por ejemplo) sólo cuando la tarjeta
 * está a punto de entrar en pantalla.
 */
export function useInView<T extends HTMLElement>(rootMargin = '300px'): [React.RefObject<T | null>, boolean] {
  const ref = useRef<T | null>(null);
  const [inView, setInView] = useState(false);

  useEffect(() => {
    if (inView) return;
    const el = ref.current;
    if (!el) return;
    if (typeof IntersectionObserver === 'undefined') {
      setInView(true);
      return;
    }
    const observer = new IntersectionObserver(
      (entries) => {
        if (entries.some((e) => e.isIntersecting)) {
          setInView(true);
          observer.disconnect();
        }
      },
      { rootMargin },
    );
    observer.observe(el);
    return () => observer.disconnect();
  }, [rootMargin, inView]);

  return [ref, inView];
}
