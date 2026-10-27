import { ApiError, type Env, type NotionConfig } from './env';

const CONFIG_KEY = 'config';

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
 * Precedencia: variables de entorno como base; si hay KV y existe una
 * configuración guardada desde la interfaz, esta la sobrescribe por campo.
 */
export async function loadConfig(env: Env): Promise<NotionConfig> {
  let notionSecret = (env.NOTION_SECRET || '').trim();
  let parentPageId = (env.NOTION_ID_PAGE || env.NOTION_PARENT_PAGE_ID || '').trim();

  if (env.MODULAB_KV) {
    try {
      const saved = (await env.MODULAB_KV.get(CONFIG_KEY, 'json')) as Partial<NotionConfig> | null;
      if (saved?.notionSecret) notionSecret = saved.notionSecret;
      if (saved?.parentPageId) parentPageId = saved.parentPageId;
    } catch {
      // Sin configuración guardada; se usan las variables de entorno.
    }
  }

  return { notionSecret, parentPageId: cleanNotionId(parentPageId) };
}

export async function saveConfig(env: Env, partial: Partial<NotionConfig>): Promise<NotionConfig> {
  if (!env.MODULAB_KV) {
    throw new ApiError(
      'Para guardar Notion desde la interfaz necesitas un binding KV llamado MODULAB_KV. Alternativa: define NOTION_SECRET y NOTION_ID_PAGE como variables de entorno de Cloudflare Pages.',
      400,
    );
  }
  const current = await loadConfig(env);
  const next: NotionConfig = {
    notionSecret:
      typeof partial.notionSecret === 'string' && partial.notionSecret.trim()
        ? partial.notionSecret.trim()
        : current.notionSecret,
    parentPageId:
      typeof partial.parentPageId === 'string' && partial.parentPageId.trim()
        ? cleanNotionId(partial.parentPageId)
        : current.parentPageId,
  };
  await env.MODULAB_KV.put(CONFIG_KEY, JSON.stringify(next));
  return next;
}

export async function clearConfig(env: Env): Promise<void> {
  if (env.MODULAB_KV) await env.MODULAB_KV.delete(CONFIG_KEY);
}
