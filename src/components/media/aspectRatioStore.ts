/**
 * Memoria de proporciones de los medios
 * =====================================
 * Notion no expone el ancho/alto de las imágenes ni de los vídeos, así que
 * hasta que el archivo carga no se sabe qué altura ocupará su hueco. Sin esa
 * reserva, la miniatura mide su tamaño mínimo y al llegar la imagen salta a su
 * tamaño real: la lista crece a tirones y el contenido se mueve bajo el cursor.
 *
 * Aquí se guarda la proporción (ancho/alto) la primera vez que se ve cada medio.
 * A partir de entonces el hueco queda reservado desde el primer frame, también
 * en visitas posteriores y en cualquier dispositivo.
 */

const STORAGE_KEY = 'modulab:media-ratios:v1';

/** Proporción supuesta mientras no se conoce la real (retrato suave). */
export const FALLBACK_IMAGE_RATIO = 3 / 4;
/** Los vídeos son apaisados con mucha más frecuencia. */
export const FALLBACK_VIDEO_RATIO = 16 / 9;

/** Techo de entradas: la caché no debe crecer sin límite. */
const MAX_ENTRIES = 4000;

let cache: Record<string, number> | null = null;
let flushTimer: number | undefined;

function load(): Record<string, number> {
  if (cache) return cache;
  try {
    const raw = localStorage.getItem(STORAGE_KEY);
    const parsed = raw ? JSON.parse(raw) : {};
    cache = parsed && typeof parsed === 'object' ? parsed : {};
  } catch {
    // localStorage bloqueado (modo privado): se sigue sin persistir.
    cache = {};
  }
  return cache!;
}

// La escritura se agrupa: al cargar muchas imágenes seguidas no conviene
// serializar miles de claves en cada `onLoad`.
function scheduleFlush() {
  if (flushTimer) return;
  flushTimer = window.setTimeout(() => {
    flushTimer = undefined;
    const data = cache;
    if (!data) return;
    try {
      const keys = Object.keys(data);
      if (keys.length > MAX_ENTRIES) {
        // Se descartan las más antiguas (orden de inserción del objeto).
        for (const key of keys.slice(0, keys.length - MAX_ENTRIES)) delete data[key];
      }
      localStorage.setItem(STORAGE_KEY, JSON.stringify(data));
    } catch {
      // Cuota llena o modo privado: seguir sin persistir no rompe nada.
    }
  }, 1200);
}

export function getRatio(id: string): number | undefined {
  const value = load()[id];
  return typeof value === 'number' && value > 0 ? value : undefined;
}

export function rememberRatio(id: string, width: number, height: number): number | undefined {
  if (!width || !height) return undefined;
  // Redondeo a 4 decimales: evita reescribir por diferencias irrelevantes.
  const ratio = Math.round((width / height) * 10000) / 10000;
  if (!Number.isFinite(ratio) || ratio <= 0) return undefined;
  const data = load();
  if (data[id] !== ratio) {
    data[id] = ratio;
    scheduleFlush();
  }
  return ratio;
}
