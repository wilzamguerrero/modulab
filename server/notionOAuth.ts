import crypto from 'node:crypto';
import {
  cleanNotionId,
  loadNotionConfig,
  loadOAuthMeta,
  saveNotionConfig,
  saveOAuthMeta,
} from './config';
import { NotionError } from './notion';

const NOTION_BASE = 'https://api.notion.com/v1';
const NOTION_VERSION = '2022-06-28';
const STATE_TTL_MS = 10 * 60 * 1000;

/**
 * URIs de retorno registradas en la integración de Notion. El cliente nunca
 * elige el `redirect_uri`: se resuelve aquí para que un tercero no pueda
 * desviar el código de autorización.
 *
 * Notion devuelve el `code` a la raíz del sitio, así que el intercambio se hace
 * con `POST /api/notion/oauth/exchange` desde la página de retorno.
 */
const DEFAULT_REDIRECT_URIS = ['http://localhost:3000/', 'https://modulabd.pages.dev/'];

export function oauthClientId(): string {
  return (process.env.NOTION_CLIENT_ID || process.env.NOTION_OAUTH_CLIENT_ID || '').trim();
}

function oauthClientSecret(): string {
  return (process.env.NOTION_CLIENT_SECRET || process.env.NOTION_OAUTH_CLIENT_SECRET || '').trim();
}

export function oauthConfigured(): boolean {
  return Boolean(oauthClientId() && oauthClientSecret());
}

export function allowedRedirectUris(): string[] {
  const extra = (process.env.NOTION_REDIRECT_URI || '')
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
 * Devuelve la URI registrada del mismo origen que la petición. Se compara por
 * origen porque Notion solo acepta una URI exacta y aquí la integración está
 * registrada en la raíz del sitio.
 */
export function resolveRedirectUri(origin?: string): string {
  const allowed = allowedRedirectUris();
  const target = origin ? originKey(origin) : '';
  if (target) {
    const match = allowed.find((uri) => originKey(uri) === target);
    if (match) return match;
  }
  return allowed[0];
}

// ---------------------------------------------------------------------------
// `state` firmado. El flujo abandona el sitio, así que no se guarda en
// memoria: se firma con el client secret y se verifica al volver.
// ---------------------------------------------------------------------------

function sign(data: string): string {
  return crypto.createHmac('sha256', oauthClientSecret()).update(data).digest('base64url');
}

function sameString(a: string, b: string): boolean {
  const left = Buffer.from(a);
  const right = Buffer.from(b);
  if (left.length !== right.length) return false;
  return crypto.timingSafeEqual(left, right);
}

/**
 * El `state` viaja firmado con el client secret y lleva, además de la URI de
 * retorno, el token de sesión del navegador que inició el flujo. Así, cuando
 * Notion devuelve el `code`, se sabe a qué cliente pertenece la autorización y
 * solo ese navegador recibe la marca de conexión.
 */
export function createState(redirectUri: string, sessionToken = ''): string {
  const payload = Buffer.from(
    JSON.stringify({ r: redirectUri, t: Date.now(), s: sessionToken || undefined }),
  ).toString('base64url');
  return `${payload}.${sign(payload)}`;
}

export interface VerifiedState {
  redirectUri: string;
  sessionToken: string;
}

/** Devuelve el `state` verificado, o `null` si no es válido o caducó. */
export function verifyState(state: string): VerifiedState | null {
  if (!state || !oauthConfigured()) return null;
  const [payload, signature] = state.split('.');
  if (!payload || !signature) return null;
  if (!sameString(signature, sign(payload))) return null;
  try {
    const parsed = JSON.parse(Buffer.from(payload, 'base64url').toString('utf8')) as {
      r?: string;
      t?: number;
      s?: string;
    };
    if (!parsed?.r || typeof parsed.t !== 'number') return null;
    if (Date.now() - parsed.t > STATE_TTL_MS) return null;
    if (!allowedRedirectUris().includes(parsed.r)) return null;
    return {
      redirectUri: parsed.r,
      sessionToken: typeof parsed.s === 'string' ? parsed.s : '',
    };
  } catch {
    return null;
  }
}

export function buildAuthorizeUrl(redirectUri: string, sessionToken = ''): string {
  const params = new URLSearchParams({
    client_id: oauthClientId(),
    response_type: 'code',
    owner: 'user',
    redirect_uri: redirectUri,
    state: createState(redirectUri, sessionToken),
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

/** Credenciales HTTP Basic para el endpoint de token. */
function basicCredentials(): string {
  return Buffer.from([oauthClientId(), oauthClientSecret()].join(':')).toString('base64');
}

export async function exchangeCode(
  code: string,
  redirectUri: string,
): Promise<NotionOAuthTokenResponse> {
  if (!oauthConfigured()) {
    throw new NotionError(
      'Falta configurar NOTION_CLIENT_ID y NOTION_CLIENT_SECRET en el servidor.',
      500,
    );
  }
  const credentials = basicCredentials();
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
    throw new NotionError(
      `Notion rechazó la autorización: ${data?.error_description || data?.message || data?.error || `HTTP ${response.status}`}`,
      response.status === 400 ? 400 : 502,
    );
  }
  return data as NotionOAuthTokenResponse;
}

/** Guarda el token OAuth como credencial de la integración. */
export function persistOAuthToken(token: NotionOAuthTokenResponse): void {
  // Si se autoriza otro workspace, la página anterior ya no sirve: hay que
  // volver a elegirla.
  const previous = loadOAuthMeta();
  const workspaceChanged = Boolean(
    previous?.workspaceId && token.workspace_id && previous.workspaceId !== token.workspace_id,
  );
  saveNotionConfig({
    notionSecret: token.access_token,
    clearParentPage: workspaceChanged,
  });
  saveOAuthMeta({
    workspaceName: token.workspace_name,
    workspaceId: token.workspace_id,
    botId: token.bot_id,
    ownerType: token.owner?.type,
    obtainedAt: new Date().toISOString(),
  });
}

/**
 * Intercambia el `code` recibido en la página de retorno y guarda el token.
 */
export async function completeAuthorization(
  code: string,
  state: string,
): Promise<{ workspaceName?: string; workspaceId?: string; sessionToken: string }> {
  const verified = verifyState(state);
  if (!verified) {
    throw new NotionError('La autorización caducó o no es válida. Vuelve a intentarlo.', 400);
  }
  const token = await exchangeCode(code, verified.redirectUri);
  persistOAuthToken(token);
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

/**
 * Lista las páginas a las que la integración tiene acceso, para que el usuario
 * elija cuál será la página padre de proyectos.
 */
export async function searchPages(): Promise<NotionPageOption[]> {
  const config = loadNotionConfig();
  if (!config.notionSecret) {
    throw new NotionError('Conecta Notion antes de elegir una página.', 400);
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
      throw new NotionError(
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

export function selectParentPage(pageId: string): string {
  const clean = cleanNotionId(pageId);
  if (!clean) throw new NotionError('Falta el ID de la página de Notion.', 400);
  saveNotionConfig({ parentPageId: clean });
  return clean;
}
