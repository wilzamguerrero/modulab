import { describe, expect, it, vi, beforeEach, afterEach } from 'vitest';

/**
 * El bug que se corrige aquí tumbaba la publicación en producción con
 * «The Workers runtime canceled this request because it detected that your
 * Worker's code had hung»: el contador de concurrencia hacia Notion se
 * corrompía al liberar el cupo dos veces (una en el reintento y otra en el
 * `finally`), y como el isolate de Cloudflare se reutiliza, todas las llamadas
 * siguientes quedaban esperando para siempre.
 */

const fetchMock = vi.fn();

beforeEach(() => {
  fetchMock.mockReset();
  vi.stubGlobal('fetch', fetchMock);
});

afterEach(() => {
  vi.unstubAllGlobals();
});

function okJson(body: unknown): Response {
  return new Response(JSON.stringify(body), {
    status: 200,
    headers: { 'Content-Type': 'application/json' },
  });
}

function statusResponse(status: number, body: unknown = {}): Response {
  return new Response(JSON.stringify(body), {
    status,
    headers: { 'Content-Type': 'application/json' },
  });
}

const config = { notionSecret: 'secret_test', parentPageId: 'page_test' };

describe('concurrencia hacia Notion', () => {
  it('no se cuelga tras varios errores reintentables seguidos', async () => {
    // Cada respuesta 429 fuerza un reintento; antes, cada reintento liberaba el
    // cupo y el `finally` lo liberaba otra vez, dejando el contador negativo.
    fetchMock.mockImplementation(() =>
      Promise.resolve(statusResponse(429, { message: 'rate limited' })),
    );

    const { retrieveBlock } = await import('../../../functions/_shared/notion');

    // Las primeras llamadas agotan sus reintentos y fallan, pero deben fallar
    // rápido en vez de quedarse colgadas.
    for (let i = 0; i < 4; i++) {
      await expect(retrieveBlock('block_1', config)).rejects.toThrow();
    }

    // Si el contador estuviera corrupto, esto no llegaría a resolver nunca.
    fetchMock.mockImplementation(() => Promise.resolve(okJson({ id: 'block_ok', type: 'paragraph' })));
    const result = await retrieveBlock('block_ok', config);
    expect(result.id).toBe('block_ok');
  }, 30_000);

  it('sigue sirviendo llamadas correctas después de una excepción de red', async () => {
    fetchMock.mockImplementationOnce(() => Promise.reject(new Error('network down')));

    const { retrieveBlock } = await import('../../../functions/_shared/notion');

    // El primer intento reintenta y termina bien o falla, pero no debe filtrar cupos.
    fetchMock.mockImplementation(() => Promise.resolve(okJson({ id: 'b2', type: 'toggle' })));
    const result = await retrieveBlock('b2', config);
    expect(result.id).toBe('b2');
  }, 30_000);

  it('resuelve varias llamadas en paralelo sin bloquearse', async () => {
    fetchMock.mockImplementation((url: string) => {
      const id = String(url).split('/blocks/')[1] || 'x';
      return Promise.resolve(okJson({ id, type: 'paragraph' }));
    });

    const { retrieveBlock } = await import('../../../functions/_shared/notion');

    const results = await Promise.all(
      Array.from({ length: 5 }, (_, i) => retrieveBlock(`par_${i}`, config)),
    );
    expect(results).toHaveLength(5);
  }, 30_000);
});
