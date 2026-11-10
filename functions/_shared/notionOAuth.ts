import type { Env, NotionConfig } from './env';
import { ApiError } from './env';
import { cleanNotionId, loadOAuthMeta, saveConfig, saveOAuthMeta } from './config';

const NOTION_BASE = 'https://api.notion.com/v1';
const NOTION_VERSION = '2022-06-28';
const STATE_TTL_MS = 10 * 60 * 1000;

/**
 * URIs de retorno registradas en la integración. El `redirect_uri` nunca llega
 * desde el cliente: se resuelve aquí para que no pueda desviarse el código.
 *
 * Notion devuelve el `code` a la URI registrada, que en este proyecto es la
 * raíz del sitio (`/`). Por eso el intercambio se hace desde el cliente con
 * `POST /api/notion/oauth/exchange`; el callback de servidor queda solo como
 * alternativa para despliegues que registren una ruta propia.
 */
const DEFAULT_REDIRECT_URIS = ['http://localhost:3000/', 'https://modulabd.pages.dev/'];

export function oauthClientId(env: Env): string {
  return (env.NOTION_CLIENT_ID || '').trim();
}

function oauthClientSecret(env: Env): string {
  return (env.NOTION_CLIENT_SECRET || '').trim();
}

export function oauthConfigured(env: Env): boolean {
  return Boolean(oauthClientId(env) && oauthClientSecret(env));
}

export function allowedRedirectUris(env: Env): string[] {
  const extra = (env.NOTION_REDIRECT_URI || '')
    .split(',')
    .map((value) => value.trim())
    .filter(Boolean);
  return Array.from(new Set([...extra, ...DEFAULT_REDIRECT_URIS]));
}

function originKey(value: string): string {
  try {
    const url = new URL(value);
    return `${url.protocol}//${url.host}`;
  } catch {
    return '';
  }
}

/**
 * Elige la URI registrada del mismo origen que la petición. Se compara por
 * origen (no por ruta) porque Notion solo acepta una URI exacta y la
 * integración está registrada en la raíz del sitio.
 */
export function resolveRedirectUri(env: Env, origin?: string): string {
  const allowed = allowedRedirectUris(env);
  const target = origin ? originKey(origin) : '';
  if (target) {
    const match = allowed.find((uri) => originKey(uri) === target);
    if (match) return match;
  }
  return allowed[0];
}

export function originOf(request: Request): string {
  const url = new URL(request.url);
  return `${url.protocol}//${url.host}`;
}

/** Credenciales HTTP Basic para el endpoint de token (ASCII). */
function basicCredentials(env: Env): string {
  // En Workers no hay Buffer; btoa trabaja con latin1, suficiente aquí.
  const raw = [oauthClientId(env), oauthClientSecret(env)].join(':');
  return btoa(raw);
}

// ---------------------------------------------------------------------------
// `state` firmado (sin estado en servidor)
//
// El flujo hace una navegación completa fuera del sitio, así que el `state` no
// puede vivir en memoria. Se firma con el client secret: incluye la URI de
// retorno y una marca de tiempo, y se verifica al volver. Funciona igual con o
// sin KV.
// ---------------------------------------------------------------------------

function b64urlFromBytes(bytes: Uint8Array): string {
  let binary = '';
  for (const byte of bytes) binary += String.fromCharCode(byte);
  return btoa(binary).replace(/\+/g, '-').replace(/\//g, '_').replace(/=+$/, '');
}

function b64urlEncode(value: string): string {
  return b64urlFromBytes(new TextEncoder().encode(value));
}

function b64urlDecode(value: string): string {
  const normalized = value.replace(/-/g, '+').replace(/_/g, '/');
  const padded = normalized + '='.repeat((4 - (normalized.length % 4)) % 4);
  const binary = atob(padded);
  const bytes = Uint8Array.from(binary, (char) => char.charCodeAt(0));
  return new TextDecoder().decode(bytes);
}

async function sign(secret: string, data: string): Promise<string> {
  const key = await crypto.subtle.importKey(
    'raw',
    new TextEncoder().encode(secret),
    { name: 'HMAC', hash: 'SHA-256' },
    false,
    ['sign'],
  );
  const signature = await crypto.subtle.sign('HMAC', key, new TextEncoder().encode(data));
  return b64urlFromBytes(new Uint8Array(signature));
}

function sameString(a: string, b: string): boolean {
  if (a.length !== b.length) return false;
  let diff = 0;
  for (let i = 0; i < a.length; i += 1) diff |= a.charCodeAt(i) ^ b.charCodeAt(i);
  return diff === 0;
}

export async function createState(env: Env, redirectUri: string, sessionToken = ''): Promise<string> {
  const payload = b64urlEncode(
    JSON.stringify({ r: redirectUri, t: Date.now(), s: sessionToken || undefined }),
  );
  return `${payload}.${await sign(oauthClientSecret(env), payload)}`;
}

export interface VerifiedState {
  redirectUri: string;
  sessionToken: string;
}

/** Devuelve el `state` verificado, o `null` si no es válido o caducó. */
export async function verifyState(env: Env, state: string): Promise<VerifiedState | null> {
  if (!state || !oauthConfigured(env)) return null;
  const [payload, signature] = state.split('.');
  if (!payload || !signature) return null;
  const expected = await sign(oauthClientSecret(env), payload);
  if (!sameString(signature, expected)) return null;
  try {
    const parsed = JSON.parse(b64urlDecode(payload)) as { r?: string; t?: number; s?: string };
    if (!parsed?.r || typeof parsed.t !== 'number') return null;
    if (Date.now() - parsed.t > STATE_TTL_MS) return null;
    if (!allowedRedirectUris(env).includes(parsed.r)) return null;
    return {
      redirectUri: parsed.r,
      sessionToken: typeof parsed.s === 'string' ? parsed.s : '',
    };
  } catch {
    return null;
  }
}

export function buildAuthorizeUrl(clientId: string, redirectUri: string, state: string): string {
  const params = new URLSearchParams({
    client_id: clientId,
    response_type: 'code',
    owner: 'user',
    redirect_uri: redirectUri,
    state,
  });
  return `${NOTION_BASE}/oauth/authorize?${params.toString()}`;
}

export interface NotionOAuthTokenResponse {
  access_token: string;
  bot_id?: string;
  workspace_name?: string;
  workspace_id?: string;
  owner?: { type?: string };
}

export async function exchangeCode(
  env: Env,
  code: string,
  redirectUri: string,
): Promise<NotionOAuthTokenResponse> {
  if (!oauthConfigured(env)) {
    throw new ApiError(
      'Falta configurar NOTION_CLIENT_ID y NOTION_CLIENT_SECRET en Cloudflare Pages.',
      500,
    );
  }
  const credentials = basicCredentials(env);
  const response = await fetch(`${NOTION_BASE}/oauth/token`, {
    method: 'POST',
    headers: {
      Authorization: `Basic ${credentials}`,
      'Content-Type': 'application/json',
      'Notion-Version': NOTION_VERSION,
    },
    body: JSON.stringify({
      grant_type: 'authorization_code',
      code,
      redirect_uri: redirectUri,
    }),
  });
  const text = await response.text();
  let data: any = {};
  if (text) {
    try {
      data = JSON.parse(text);
    } catch {
      data = { message: text };
    }
  }
  if (!response.ok || !data?.access_token) {
    throw new ApiError(
      `Notion rechazó la autorización: ${data?.error_description || data?.message || data?.error || `HTTP ${response.status}`}`,
      response.status === 400 ? 400 : 502,
    );
  }
  return data as NotionOAuthTokenResponse;
}

export async function persistOAuthToken(env: Env, token: NotionOAuthTokenResponse): Promise<void> {
  // Si se autoriza otro workspace, la página anterior ya no sirve.
  const previous = await loadOAuthMeta(env);
  const workspaceChanged = Boolean(
    previous?.workspaceId && token.workspace_id && previous.workspaceId !== token.workspace_id,
  );
  await saveConfig(env, { notionSecret: token.access_token, clearParentPage: workspaceChanged });
  await saveOAuthMeta(env, {
    workspaceName: token.workspace_name,
    workspaceId: token.workspace_id,
    botId: token.bot_id,
    ownerType: token.owner?.type,
    obtainedAt: new Date().toISOString(),
  });
}

/**
 * Intercambia el `code` recibido en la página de retorno y guarda el token.
 * Devuelve los datos del workspace para que la interfaz continúe con la
 * elección de página.
 */
export async function completeAuthorization(
  env: Env,
  code: string,
  state: string,
): Promise<{ workspaceName?: string; workspaceId?: string; sessionToken: string }> {
  const verified = await verifyState(env, state);
  if (!verified) {
    throw new ApiError('La autorización caducó o no es válida. Vuelve a intentarlo.', 400);
  }
  const token = await exchangeCode(env, code, verified.redirectUri);
  await persistOAuthToken(env, token);
  return {
    workspaceName: token.workspace_name,
    workspaceId: token.workspace_id,
    // El navegador que inició el flujo recibe la marca de conexión.
    sessionToken: verified.sessionToken,
  };
}

export interface NotionPageOption {
  id: string;
  title: string;
  url: string;
  lastEditedTime?: string;
}

function pageTitle(page: any): string {
  const properties = page?.properties || {};
  for (const property of Object.values<any>(properties)) {
    if (property?.type === 'title') {
      const text = (property.title || [])
        .map((item: any) => item?.plain_text ?? item?.text?.content ?? '')
        .join('')
        .trim();
      if (text) return text;
    }
  }
  return '';
}

export async function searchPages(
  env: Env,
  config: NotionConfig,
): Promise<NotionPageOption[]> {
  if (!config.notionSecret) {
    throw new ApiError('Conecta Notion antes de elegir una página.', 400);
  }
  const pages: NotionPageOption[] = [];
  let cursor: string | undefined;
  do {
    const body: Record<string, unknown> = {
      filter: { property: 'object', value: 'page' },
      page_size: 100,
    };
    if (cursor) body.start_cursor = cursor;
    const response = await fetch(`${NOTION_BASE}/search`, {
      method: 'POST',
      headers: {
        Authorization: `Bearer ${config.notionSecret}`,
        'Notion-Version': NOTION_VERSION,
        'Content-Type': 'application/json',
      },
      body: JSON.stringify(body),
    });
    const data = (await response.json().catch(() => ({}))) as any;
    if (!response.ok) {
      throw new ApiError(
        `Notion: ${data?.message || `HTTP ${response.status}`}`,
        response.status,
      );
    }
    for (const page of data.results || []) {
      pages.push({
        id: page.id,
        title: pageTitle(page) || 'Página sin título',
        url: page.url || `https://www.notion.so/${String(page.id).replace(/-/g, '')}`,
        lastEditedTime: page.last_edited_time,
      });
    }
    cursor = data.has_more ? data.next_cursor : undefined;
  } while (cursor);

  pages.sort((a, b) => a.title.localeCompare(b.title, 'es'));
  return pages;
}

export async function selectParentPage(env: Env, pageId: string): Promise<string> {
  const clean = cleanNotionId(pageId);
  if (!clean) throw new ApiError('Falta el ID de la página de Notion.', 400);
  await saveConfig(env, { parentPageId: clean });
  return clean;
}
