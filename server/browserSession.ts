import crypto from 'node:crypto';
import type { Request, Response } from 'express';

/**
 * Marca de "esta pestaña autorizó Notion".
 *
 * No es autenticación: la credencial de Notion sigue viviendo en el servidor.
 * Es una cookie de navegador sin `Max-Age` (muere al cerrar el navegador) que
 * indica que este cliente completó el flujo OAuth. Sin ella, la API de datos
 * responde 409 y la interfaz no muestra la conexión como activa, de modo que
 * quien entre por primera vez no ve la conexión de otra persona.
 *
 * También se refleja en `sessionStorage` desde el cliente; la cookie cubre el
 * caso de las llamadas que no pasan por la interfaz.
 */
export const SESSION_COOKIE = 'modulab_notion';

/** Cabecera que el cliente envía tras autorizar, como respaldo de la cookie. */
export const SESSION_HEADER = 'x-modulab-notion';

const TOKEN_PATTERN = /^[a-f0-9]{32}$/;

export function createSessionToken(): string {
  return crypto.randomBytes(16).toString('hex');
}

function readCookie(header: string | undefined, name: string): string {
  if (!header) return '';
  for (const part of header.split(';')) {
    const index = part.indexOf('=');
    if (index < 0) continue;
    if (part.slice(0, index).trim() !== name) continue;
    return decodeURIComponent(part.slice(index + 1).trim());
  }
  return '';
}

/** Token de sesión de navegador, o '' si no hay una sesión válida. */
export function readSessionToken(req: Request): string {
  const fromCookie = readCookie(req.headers.cookie, SESSION_COOKIE);
  if (TOKEN_PATTERN.test(fromCookie)) return fromCookie;
  const headerValue = String(req.headers[SESSION_HEADER] || '').trim();
  if (TOKEN_PATTERN.test(headerValue)) return headerValue;
  // Las etiquetas que el navegador carga solo (`<img>`, `<video>`) no envían
  // cabeceras propias: la marca puede llegar en `?k=`.
  const fromQuery = String((req.query as Record<string, unknown>)?.k || '').trim();
  if (TOKEN_PATTERN.test(fromQuery)) return fromQuery;
  return '';
}

/** True cuando este navegador completó la autorización de Notion. */
export function hasBrowserSession(req: Request): boolean {
  return Boolean(readSessionToken(req));
}

/**
 * Emite (o renueva) la cookie de sesión. Sin `Max-Age`/`Expires`: el navegador
 * la descarta al cerrarse.
 */
export function issueSessionCookie(req: Request, res: Response, token?: string): string {
  const value = token && TOKEN_PATTERN.test(token) ? token : createSessionToken();
  const parts = [
    `${SESSION_COOKIE}=${encodeURIComponent(value)}`,
    'Path=/',
    'HttpOnly',
    'SameSite=Lax',
  ];
  if (req.secure || req.get('x-forwarded-proto') === 'https') parts.push('Secure');
  res.append('Set-Cookie', parts.join('; '));
  res.setHeader(SESSION_HEADER, value);
  return value;
}

export function clearSessionCookie(req: Request, res: Response): void {
  const parts = [`${SESSION_COOKIE}=`, 'Path=/', 'HttpOnly', 'SameSite=Lax', 'Max-Age=0'];
  if (req.secure || req.get('x-forwarded-proto') === 'https') parts.push('Secure');
  res.append('Set-Cookie', parts.join('; '));
}

/** Respuesta uniforme de "conecta Notion primero". */
export const NOT_CONNECTED_MESSAGE =
  'Conecta Notion en este navegador para acceder a tus proyectos. Pulsa «Conectar Notion» y completa la autorización.';
