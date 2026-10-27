// Declaraciones mínimas de las APIs de Cloudflare Pages/Workers usadas por
// estas Functions. Evitan depender de @cloudflare/workers-types para el
// type-check local; en el despliegue Cloudflare aporta las suyas.

export {};

declare global {
  interface KVGetOptions {
    type?: 'text' | 'json' | 'arrayBuffer' | 'stream';
    cacheTtl?: number;
  }

  interface KVPutOptions {
    metadata?: unknown;
    expiration?: number;
    expirationTtl?: number;
  }

  interface KVNamespace {
    get(key: string): Promise<string | null>;
    get(key: string, type: 'text'): Promise<string | null>;
    get<T = unknown>(key: string, type: 'json'): Promise<T | null>;
    get(key: string, type: 'arrayBuffer'): Promise<ArrayBuffer | null>;
    getWithMetadata<M = unknown>(
      key: string,
      type: 'arrayBuffer',
    ): Promise<{ value: ArrayBuffer | null; metadata: M | null }>;
    getWithMetadata<M = unknown>(
      key: string,
      type: 'text',
    ): Promise<{ value: string | null; metadata: M | null }>;
    put(key: string, value: string | ArrayBuffer | ReadableStream, options?: KVPutOptions): Promise<void>;
    delete(key: string): Promise<void>;
    list(options?: { prefix?: string; limit?: number; cursor?: string }): Promise<{
      keys: Array<{ name: string; expiration?: number; metadata?: unknown }>;
      list_complete: boolean;
      cursor?: string;
    }>;
  }

  interface Fetcher {
    fetch(input: RequestInfo | URL, init?: RequestInit): Promise<Response>;
  }

  interface PagesContext<E = unknown> {
    request: Request;
    env: E;
    params: Record<string, string | string[]>;
    next: () => Promise<Response>;
    waitUntil: (promise: Promise<unknown>) => void;
    data: Record<string, unknown>;
  }

  type PagesFunction<E = unknown> = (context: PagesContext<E>) => Response | Promise<Response>;
}
