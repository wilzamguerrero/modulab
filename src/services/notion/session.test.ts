import { describe, expect, it } from 'vitest';
import {
  SESSION_COOKIE,
  SESSION_HEADER,
  clearSessionCookieHeader,
  createSessionToken,
  hasBrowserSession,
  notConnectedResponse,
  readSessionToken,
  sessionCookieHeader,
} from '../../../functions/_shared/session';

function requestWith(cookie?: string, header?: string, query?: string): Request {
  const headers = new Headers();
  if (cookie) headers.set('cookie', cookie);
  if (header) headers.set(SESSION_HEADER, header);
  const suffix = query ? `?k=${encodeURIComponent(query)}` : '';
  return new Request(`https://modulabd.pages.dev/api/notion/config${suffix}`, { headers });
}

describe('sesión de navegador para Notion', () => {
  it('genera tokens hexadecimales de 32 caracteres', () => {
    const token = createSessionToken();
    expect(token).toMatch(/^[a-f0-9]{32}$/);
    expect(createSessionToken()).not.toBe(token);
  });

  it('sin cookie ni cabecera no hay sesión', () => {
    expect(hasBrowserSession(requestWith())).toBe(false);
    expect(readSessionToken(requestWith())).toBe('');
  });

  it('lee el token desde la cookie', () => {
    const token = createSessionToken();
    const request = requestWith(`${SESSION_COOKIE}=${token}`);
    expect(readSessionToken(request)).toBe(token);
    expect(hasBrowserSession(request)).toBe(true);
  });

  it('lee el token desde la cabecera de respaldo', () => {
    const token = createSessionToken();
    expect(readSessionToken(requestWith(undefined, token))).toBe(token);
  });

  it('ignora valores con formato inválido', () => {
    expect(hasBrowserSession(requestWith(`${SESSION_COOKIE}=no-valido`))).toBe(false);
    expect(hasBrowserSession(requestWith(`${SESSION_COOKIE}=${'a'.repeat(31)}`))).toBe(false);
    expect(hasBrowserSession(requestWith(undefined, 'inyectado'))).toBe(false);
  });

  it('la cookie es de sesión (sin Max-Age) y HttpOnly', () => {
    const header = sessionCookieHeader(requestWith(), createSessionToken());
    expect(header).toContain('HttpOnly');
    expect(header).toContain('SameSite=Lax');
    expect(header).toContain('Path=/');
    expect(header).not.toContain('Max-Age');
    expect(header).not.toContain('Expires');
    // En https la cookie se marca Secure.
    expect(header).toContain('Secure');
  });

  it('en http no marca Secure (desarrollo local)', () => {
    const request = new Request('http://localhost:8788/api/notion/config');
    expect(sessionCookieHeader(request, createSessionToken())).not.toContain('Secure');
  });

  it('al borrar la sesión se envía Max-Age=0', () => {
    expect(clearSessionCookieHeader(requestWith())).toContain('Max-Age=0');
  });

  it('el error de no conectado responde 409 con un código estable', async () => {
    const response = notConnectedResponse();
    expect(response.status).toBe(409);
    const body = (await response.json()) as { details?: { code?: string }; error?: string };
    expect(body.details?.code).toBe('notion_not_connected');
    expect(body.error).toBeTruthy();
  });

  it('acepta el token en ?k= para las etiquetas sin cabeceras propias', () => {
    const token = createSessionToken();
    expect(readSessionToken(requestWith(undefined, undefined, token))).toBe(token);
  });

  it('descarta un ?k= con formato inválido', () => {
    expect(readSessionToken(requestWith(undefined, undefined, 'no-es-un-token'))).toBe('');
  });
});
