import { describe, expect, it, vi, beforeEach, afterEach } from 'vitest';

/**
 * La caché de enlaces firmados evita un `GET /blocks/<id>` a Notion por cada
 * petición `Range` del navegador. Sin ella, reproducir un vídeo de 566 MB
 * generaba decenas de llamadas por persona, y Notion limita a ~3 req/s, así que
 * varios usuarios simultáneos se bloqueaban entre sí.
 */

const fetchMock = vi.fn();

beforeEach(() => {
  fetchMock.mockReset();
  vi.stubGlobal('fetch', fetchMock);
  vi.resetModules();
});

afterEach(() => {
  vi.unstubAllGlobals();
});

const config = { notionSecret: 'secret_test', parentPageId: 'page_test' };

function blockResponse(url: string): Response {
  return new Response(
    JSON.stringify({
      id: 'blk',
      type: 'file',
      file: { type: 'file', file: { url } },
    }),
    { status: 200, headers: { 'Content-Type': 'application/json' } },
  );
}

describe('caché de enlaces firmados', () => {
  it('reutiliza la URL y no vuelve a llamar a Notion', async () => {
    const { getFileBlockUrlCached } = await import('../../../functions/_shared/notion');
    fetchMock.mockImplementation(() => Promise.resolve(blockResponse('https://s3/img.png?X-Amz-Expires=3600')));

    const first = await getFileBlockUrlCached('blk', config);
    const second = await getFileBlockUrlCached('blk', config);
    const third = await getFileBlockUrlCached('blk', config);

    expect(first).toBe('https://s3/img.png?X-Amz-Expires=3600');
    expect(second).toBe(first);
    expect(third).toBe(first);
    // Una sola llamada a Notion para tres lecturas.
    expect(fetchMock).toHaveBeenCalledTimes(1);
  });

  it('refresca la URL cuando la entrada caduca', async () => {
    const { getFileBlockUrlCached, rememberFileUrl, getCachedFileUrl } = await import(
      '../../../functions/_shared/notion'
    );
    fetchMock.mockImplementation(() => Promise.resolve(blockResponse('https://s3/nueva.png')));

    rememberFileUrl('viejo', 'https://s3/vieja.png');
    expect(getCachedFileUrl('viejo')).toBe('https://s3/vieja.png');

    // Se simula el paso del tiempo adelantando el reloj más allá del TTL (50 min).
    const ahora = Date.now();
    const spy = vi.spyOn(Date, 'now').mockReturnValue(ahora + 51 * 60 * 1000);
    try {
      expect(getCachedFileUrl('viejo')).toBeNull();
      const fresco = await getFileBlockUrlCached('viejo', config);
      expect(fresco).toBe('https://s3/nueva.png');
    } finally {
      spy.mockRestore();
    }
  });

  it('no cachea cuando Notion no devuelve URL', async () => {
    const { getFileBlockUrlCached } = await import('../../../functions/_shared/notion');
    fetchMock.mockImplementation(() =>
      Promise.resolve(
        new Response(JSON.stringify({ id: 'blk', type: 'file', file: {} }), {
          status: 200,
          headers: { 'Content-Type': 'application/json' },
        }),
      ),
    );

    expect(await getFileBlockUrlCached('sin-url', config)).toBeNull();
    await getFileBlockUrlCached('sin-url', config);
    // Sin URL no hay nada que cachear: se consulta de nuevo.
    expect(fetchMock).toHaveBeenCalledTimes(2);
  });
});
