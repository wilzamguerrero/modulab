/**
 * Marca de "este navegador autorizó Notion".
 *
 * No es autenticación: la credencial de Notion sigue viviendo en KV. Es una
 * cookie de sesión (sin `Max-Age`, muere al cerrar el navegador) que indica que
 * este cliente completó el flujo OAuth. Sin ella, la API responde como «no
 * conectado» y la interfaz no muestra la conexión al entrar.
 */

export const SESSION_COOKIE = 'modulab_notion';

/** Cabecera equivalente a la cookie, para clientes que no la reenvían. */
export const SESSION_HEADER = 'x-modulab-notion';

export const NOT_CONNECTED_MESSAGE =
  'Conecta Notion en este navegador para acceder a tus proyectos. Pulsa «Conectar Notion» y completa la autorización.';

const TOKEN_PATTERN = /^[a-f0-9]{32}$/;

export function createSessionToken(): string {
  const bytes = new Uint8Array(16);
  crypto.getRandomValues(bytes);
  return Array.from(bytes, (byte) => byte.toString(16).padStart(2, '0')).join('');
}

function readCookie(cookieHeader: string | null, name: string): string {
  if (!cookieHeader) return '';
  for (const part of cookieHeader.split(';')) {
    const index = part.indexOf('=');
    if (index < 0) continue;
    if (part.slice(0, index).trim() !== name) continue;
    try {
      return decodeURIComponent(part.slice(index + 1).trim());
    } catch {
      return '';
    }
  }
  return '';
}

/** Token de sesión de navegador, o '' si no hay una sesión válida. */
export function readSessionToken(request: Request): string {
  const fromCookie = readCookie(request.headers.get('cookie'), SESSION_COOKIE);
  if (TOKEN_PATTERN.test(fromCookie)) return fromCookie;
  const fromHeader = (request.headers.get(SESSION_HEADER) || '').trim();
  if (TOKEN_PATTERN.test(fromHeader)) return fromHeader;
  // Las etiquetas que el navegador carga solo (`<img>`, `<video>`) no envían
  // cabeceras propias: la marca puede llegar en `?k=`.
  try {
    const fromQuery = (new URL(request.url).searchParams.get('k') || '').trim();
    if (TOKEN_PATTERN.test(fromQuery)) return fromQuery;
  } catch {
    // URL no válida: se trata como sin sesión.
  }
  return '';
}

/** True cuando este navegador completó la autorización de Notion. */
export function hasBrowserSession(request: Request): boolean {
  return Boolean(readSessionToken(request));
}

function isSecure(request: Request): boolean {
  try {
    return new URL(request.url).protocol === 'https:';
  } catch {
    return true;
  }
}

/** Cabecera `Set-Cookie` que emite la marca de conexión. */
export function sessionCookieHeader(request: Request, token: string): string {
  const value = TOKEN_PATTERN.test(token) ? token : createSessionToken();
  const parts = [`${SESSION_COOKIE}=${encodeURIComponent(value)}`, 'Path=/', 'HttpOnly', 'SameSite=Lax'];
  if (isSecure(request)) parts.push('Secure');
  return parts.join('; ');
}

/** Cabecera `Set-Cookie` que borra la marca de conexión. */
export function clearSessionCookieHeader(request: Request): string {
  const parts = [`${SESSION_COOKIE}=`, 'Path=/', 'HttpOnly', 'SameSite=Lax', 'Max-Age=0'];
  if (isSecure(request)) parts.push('Secure');
  return parts.join('; ');
}

/** Respuesta JSON con la cookie de sesión añadida. */
export function withSessionCookie(
  payload: unknown,
  request: Request,
  token: string,
  status = 200,
): Response {
  return new Response(JSON.stringify(payload), {
    status,
    headers: {
      'Content-Type': 'application/json; charset=utf-8',
      'Set-Cookie': sessionCookieHeader(request, token),
      [SESSION_HEADER]: token,
      'Cache-Control': 'no-store',
    },
  });
}

/** Error uniforme de "conecta Notion primero". */
export function notConnectedResponse(): Response {
  return new Response(
    JSON.stringify({ error: NOT_CONNECTED_MESSAGE, details: { code: 'notion_not_connected' } }),
    {
      status: 409,
      headers: { 'Content-Type': 'application/json; charset=utf-8', 'Cache-Control': 'no-store' },
    },
  );
}
