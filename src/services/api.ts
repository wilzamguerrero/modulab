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

async function parseResponse<T>(response: Response): Promise<T> {
  const text = await response.text();
  let data: any = null;
  if (text) {
    try {
      data = JSON.parse(text);
    } catch {
      data = { raw: text };
    }
  }
  if (!response.ok) {
    // 409 `notion_not_connected`: el servidor oculta la conexión a este
    // navegador. Se olvida la marca local para que la interfaz vuelva a pedir
    // la autorización en vez de reintentar en bucle.
    const code = data?.details?.code;
    if (response.status === 409 && code === 'notion_not_connected') {
      try {
        window.sessionStorage.removeItem(NOTION_SESSION_KEY);
      } catch {
        // sessionStorage bloqueado: la cookie tampoco existía.
      }
    }
    throw new ApiError(data?.error || `Error HTTP ${response.status}`, response.status, data?.details);
  }
  return data as T;
}

export const NOTION_SESSION_KEY = 'modulab:notion-session';

export function notionSessionToken(): string {
  try {
    return window.sessionStorage.getItem(NOTION_SESSION_KEY) || '';
  } catch {
    return '';
  }
}

/**
 * Cabeceras con la marca de conexión de Notion de este navegador.
 *
 * Sirve para las peticiones que no pasan por `apiFetch` (`fetch` directo de
 * subida por partes) y para las URLs que se entregan al navegador (imágenes),
 * donde la cookie no siempre basta (p. ej. `Referrer-Policy` estricta o
 * `<img>` servido desde otro origen durante el desarrollo).
 */
export function notionSessionHeaders(): Record<string, string> {
  const token = notionSessionToken();
  return token ? { 'x-modulab-notion': token } : {};
}

export async function apiFetch<T>(input: string, init?: RequestInit): Promise<T> {
  const headers = new Headers(init?.headers);
  if (init?.body && !(init.body instanceof FormData) && !headers.has('Content-Type')) {
    headers.set('Content-Type', 'application/json');
  }
  // Marca de conexión de Notion de este navegador. Se envía como cabecera
  // además de la cookie para que no dependa de que el navegador la reenvíe.
  const notionToken = notionSessionToken();
  if (notionToken && !headers.has('x-modulab-notion')) {
    headers.set('x-modulab-notion', notionToken);
  }
  const response = await fetch(input, { ...init, headers });
  return parseResponse<T>(response);
}

export function apiGet<T>(url: string): Promise<T> {
  return apiFetch<T>(url);
}

export function apiPost<T>(url: string, body: unknown): Promise<T> {
  return apiFetch<T>(url, { method: 'POST', body: JSON.stringify(body) });
}

export function apiPut<T>(url: string, body: unknown): Promise<T> {
  return apiFetch<T>(url, { method: 'PUT', body: JSON.stringify(body) });
}

export function apiDelete<T>(url: string): Promise<T> {
  return apiFetch<T>(url, { method: 'DELETE' });
}

export async function apiUpload<T>(url: string, file: File, field = 'file'): Promise<T> {
  const form = new FormData();
  form.append(field, file);
  return apiFetch<T>(url, { method: 'POST', body: form });
}
