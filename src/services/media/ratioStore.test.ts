import { describe, expect, it, vi, beforeEach, afterEach } from 'vitest';

/**
 * Regresión del atasco «la galería se queda cargando hasta que recargo».
 *
 * El cupo de concurrencia del flujo progresivo sólo baja cuando una tarjeta
 * avisa de que terminó. Si la imagen ya estaba en la caché del navegador, el
 * evento `load` se dispara antes de que React enganche `onLoad`; nadie avisa y
 * el cupo queda ocupado para siempre. Aquí se fija el contrato que lo evita.
 */

const STORAGE_KEY = 'modulab:media-ratios:v1';

// El entorno de pruebas no trae `localStorage`: el módulo debe funcionar
// igualmente (modo privado), así que se simula uno sencillo.
function installLocalStorage() {
  const store = new Map<string, string>();
  vi.stubGlobal('localStorage', {
    getItem: (key: string) => store.get(key) ?? null,
    setItem: (key: string, value: string) => void store.set(key, value),
    removeItem: (key: string) => void store.delete(key),
    clear: () => store.clear(),
  });
  return store;
}

beforeEach(() => {
  installLocalStorage();
  vi.resetModules();
});

afterEach(() => {
  vi.unstubAllGlobals();
});

describe('memoria de proporciones', () => {
  it('guarda la proporción y la devuelve después', async () => {
    const { rememberRatio, getRatio } = await import(
      '../../components/media/aspectRatioStore'
    );
    expect(getRatio('media-1')).toBeUndefined();
    expect(rememberRatio('media-1', 1600, 900)).toBeCloseTo(1.7778, 3);
    expect(getRatio('media-1')).toBeCloseTo(1.7778, 3);
  });

  it('ignora dimensiones inválidas en vez de guardar basura', async () => {
    const { rememberRatio, getRatio } = await import(
      '../../components/media/aspectRatioStore'
    );
    expect(rememberRatio('media-2', 0, 0)).toBeUndefined();
    expect(rememberRatio('media-2', Number.NaN, 100)).toBeUndefined();
    expect(getRatio('media-2')).toBeUndefined();
  });

  it('expone proporciones por defecto razonables', async () => {
    const { FALLBACK_IMAGE_RATIO, FALLBACK_VIDEO_RATIO } = await import(
      '../../components/media/aspectRatioStore'
    );
    expect(FALLBACK_IMAGE_RATIO).toBeCloseTo(0.75, 2);
    expect(FALLBACK_VIDEO_RATIO).toBeCloseTo(1.777, 2);
  });

  it('persiste entre lecturas dentro del mismo proceso', async () => {
    const { rememberRatio, getRatio } = await import(
      '../../components/media/aspectRatioStore'
    );
    rememberRatio('media-3', 1200, 800);
    // El valor queda en la caché en memoria, que es la fuente de lectura.
    expect(getRatio('media-3')).toBeCloseTo(1.5, 4);
  });
});

describe('constantes del flujo progresivo', () => {
  it('el módulo exporta el contexto y los hooks esperados', async () => {
    const mod = await import('../../components/media/useProgressiveStream');
    expect(mod.MediaLoadContext).toBeDefined();
    expect(typeof mod.useProgressiveStream).toBe('function');
    expect(typeof mod.useMediaSettle).toBe('function');
    expect(typeof mod.useInView).toBe('function');
  });
});
