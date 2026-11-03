import { ApiError, type Env, type NotionConfig, type NotionOAuthMeta } from './env';

const CONFIG_KEY = 'config';
const OAUTH_KEY = 'oauth';

export function cleanNotionId(input: string): string {
  if (!input) return '';
  const trimmed = input.trim();
  const withDashes = trimmed.match(/[a-f0-9]{8}-[a-f0-9]{4}-[a-f0-9]{4}-[a-f0-9]{4}-[a-f0-9]{12}/i);
  if (withDashes) return withDashes[0];
  const plain = trimmed.match(/[a-f0-9]{32}/i);
  if (plain) {
    const s = plain[0];
    return `${s.slice(0, 8)}-${s.slice(8, 12)}-${s.slice(12, 16)}-${s.slice(16, 20)}-${s.slice(20)}`;
  }
  return trimmed;
}

export function maskedToken(token: string): string {
  if (!token) return '';
  return `••••••••${token.slice(-4)}`;
}

/**
 * Con OAuth configurado, la conexión sale del token autorizado desde la
 * interfaz; `NOTION_SECRET`/`NOTION_ID_PAGE` quedan como respaldo solo cuando
 * no hay credenciales OAuth.
 */
function oauthEnabled(env: Env): boolean {
  return Boolean(
    (env.NOTION_CLIENT_ID || '').trim() && (env.NOTION_CLIENT_SECRET || '').trim(),
  );
}

/**
 * Precedencia: variables de entorno como base; si hay KV y existe una
 * configuración guardada desde la interfaz, esta la sobrescribe por campo.
 */
export async function loadConfig(env: Env): Promise<NotionConfig> {
  const fromEnv = !oauthEnabled(env);
  let notionSecret = fromEnv ? (env.NOTION_SECRET || '').trim() : '';
  let parentPageId = fromEnv
    ? (env.NOTION_ID_PAGE || env.NOTION_PARENT_PAGE_ID || '').trim()
    : '';

  if (env.MODULAB_KV) {
    try {
      const saved = (await env.MODULAB_KV.get(CONFIG_KEY, 'json')) as Partial<NotionConfig> | null;
      if (saved) {
        // El registro guardado manda completo, incluso con la página vacía:
        // al autorizar otro workspace no se reutiliza la página anterior.
        if (typeof saved.notionSecret === 'string' && saved.notionSecret.trim()) {
          notionSecret = saved.notionSecret.trim();
        }
        parentPageId = typeof saved.parentPageId === 'string' ? saved.parentPageId : '';
      }
    } catch {
      // Sin configuración guardada; se usan las variables de entorno.
    }
  }

  return { notionSecret, parentPageId: cleanNotionId(parentPageId) };
}

export async function saveConfig(
  env: Env,
  partial: Partial<NotionConfig> & { clearParentPage?: boolean },
): Promise<NotionConfig> {
  if (!env.MODULAB_KV) {
    throw new ApiError(
      'Para guardar Notion desde la interfaz necesitas un binding KV llamado MODULAB_KV. Alternativa: define NOTION_CLIENT_ID/NOTION_CLIENT_SECRET y NOTION_ID_PAGE como variables de entorno de Cloudflare Pages.',
      400,
    );
  }
  const current = await loadConfig(env);
  const next: NotionConfig = {
    notionSecret:
      typeof partial.notionSecret === 'string' && partial.notionSecret.trim()
        ? partial.notionSecret.trim()
        : current.notionSecret,
    parentPageId: partial.clearParentPage
      ? ''
      : typeof partial.parentPageId === 'string' && partial.parentPageId.trim()
        ? cleanNotionId(partial.parentPageId)
        : current.parentPageId,
  };
  await env.MODULAB_KV.put(CONFIG_KEY, JSON.stringify(next));
  return next;
}

export async function clearConfig(env: Env): Promise<void> {
  if (!env.MODULAB_KV) return;
  await env.MODULAB_KV.delete(CONFIG_KEY);
  await env.MODULAB_KV.delete(OAUTH_KEY);
}

export async function loadOAuthMeta(env: Env): Promise<NotionOAuthMeta | null> {
  if (!env.MODULAB_KV) return null;
  try {
    return (await env.MODULAB_KV.get(OAUTH_KEY, 'json')) as NotionOAuthMeta | null;
  } catch {
    return null;
  }
}

export async function saveOAuthMeta(env: Env, meta: NotionOAuthMeta): Promise<void> {
  if (!env.MODULAB_KV) return;
  await env.MODULAB_KV.put(OAUTH_KEY, JSON.stringify(meta));
}

export async function clearOAuthMeta(env: Env): Promise<void> {
  if (env.MODULAB_KV) await env.MODULAB_KV.delete(OAUTH_KEY);
}

