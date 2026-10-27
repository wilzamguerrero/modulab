export interface Env {
  NOTION_SECRET?: string;
  NOTION_ID_PAGE?: string;
  NOTION_PARENT_PAGE_ID?: string;
  /** Namespace KV opcional (gratis) para configuración, publicaciones y fotos. */
  MODULAB_KV?: KVNamespace;
  /** Binding de assets estáticos que Pages provee automáticamente. */
  ASSETS?: Fetcher;
}

export interface NotionConfig {
  notionSecret: string;
  parentPageId: string;
}

export class ApiError extends Error {
  readonly status: number;
  readonly details?: unknown;
  constructor(message: string, status = 500, details?: unknown) {
    super(message);
    this.name = 'ApiError';
    this.status = status;
    this.details = details;
  }
}

export function json(data: unknown, status = 200, headers: Record<string, string> = {}): Response {
  return new Response(JSON.stringify(data), {
    status,
    headers: { 'Content-Type': 'application/json; charset=utf-8', ...headers },
  });
}

export function jsonError(status: number, message: string, details?: unknown): Response {
  return json({ error: message, details }, status);
}

/** Devuelve el KV o lanza un error claro si el binding no está configurado. */
export function requireKv(env: Env, feature: string): KVNamespace {
  if (!env.MODULAB_KV) {
    throw new ApiError(
      `Falta el almacenamiento KV. En Cloudflare Pages crea un namespace KV y asígnalo al binding MODULAB_KV (es gratis). Se usa para ${feature}.`,
      400,
    );
  }
  return env.MODULAB_KV;
}
