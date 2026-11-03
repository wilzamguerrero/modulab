import fs from 'node:fs';
import path from 'node:path';

export interface NotionConfig {
  notionSecret: string;
  parentPageId: string;
}

/**
 * Metadatos de la última autorización OAuth. El access token NO se guarda
 * aquí: se escribe en `notion-config.json` como `notionSecret`, de modo que
 * todo el resto de la API sigue funcionando sin cambios.
 */
export interface NotionOAuthMeta {
  workspaceName?: string;
  workspaceId?: string;
  botId?: string;
  ownerType?: string;
  obtainedAt: string;
}

export const ROOT_DIR = process.cwd();
export const DATA_DIR = process.env.MODULAB_DATA_DIR
  ? path.resolve(process.env.MODULAB_DATA_DIR)
  : path.join(ROOT_DIR, 'data');
export const PUBLISHED_DIR = path.join(DATA_DIR, 'published');
export const UPLOADS_DIR = path.join(DATA_DIR, 'uploads');
export const CONFIG_FILE = path.join(DATA_DIR, 'notion-config.json');
export const OAUTH_FILE = path.join(DATA_DIR, 'notion-oauth.json');

export const PUBLIC_DIR = path.join(ROOT_DIR, 'public');
export const DIST_DIR = path.join(ROOT_DIR, 'dist');

export function ensureDataDirs(): void {
  for (const dir of [DATA_DIR, PUBLISHED_DIR, UPLOADS_DIR]) {
    fs.mkdirSync(dir, { recursive: true });
  }
}

export function resolveCatalogDir(): string {
  const sourceCatalog = path.join(PUBLIC_DIR, 'catalog');
  if (fs.existsSync(sourceCatalog)) return sourceCatalog;
  return path.join(DIST_DIR, 'catalog');
}

export function cleanNotionId(input: string): string {
  if (!input) return '';
  const trimmed = input.trim();
  const withDashes = trimmed.match(/[a-f0-9]{8}-[a-f0-9]{4}-[a-f0-9]{4}-[a-f0-9]{4}-[a-f0-9]{12}/i);
  if (withDashes) return withDashes[0];
  const plain = trimmed.match(/[a-f0-9]{32}/i);
  if (plain) {
    return `${plain[0].slice(0, 8)}-${plain[0].slice(8, 12)}-${plain[0].slice(12, 16)}-${plain[0].slice(16, 20)}-${plain[0].slice(20)}`;
  }
  return trimmed;
}

/**
 * Con OAuth configurado, la conexión sale de la autorización hecha desde la
 * interfaz; `NOTION_SECRET`/`NOTION_ID_PAGE` quedan como respaldo solo cuando
 * no hay credenciales OAuth.
 */
function oauthEnabled(): boolean {
  const clientId = (process.env.NOTION_CLIENT_ID || process.env.NOTION_OAUTH_CLIENT_ID || '').trim();
  const clientSecret = (
    process.env.NOTION_CLIENT_SECRET || process.env.NOTION_OAUTH_CLIENT_SECRET || ''
  ).trim();
  return Boolean(clientId && clientSecret);
}

export function loadNotionConfig(): NotionConfig {
  const fromEnv = !oauthEnabled();
  let notionSecret = fromEnv ? process.env.NOTION_SECRET?.trim() || '' : '';
  let parentPageId = fromEnv
    ? process.env.NOTION_ID_PAGE?.trim() || process.env.NOTION_PARENT_PAGE_ID?.trim() || ''
    : '';

  if (fs.existsSync(CONFIG_FILE)) {
    try {
      const saved = JSON.parse(fs.readFileSync(CONFIG_FILE, 'utf8')) as Partial<NotionConfig>;
      // El archivo manda completo, incluso con la página vacía: al autorizar
      // otro workspace no se reutiliza la página anterior.
      if (saved && typeof saved === 'object') {
        if (saved.notionSecret) notionSecret = saved.notionSecret;
        parentPageId = typeof saved.parentPageId === 'string' ? saved.parentPageId : '';
      }
    } catch (error) {
      console.warn('[modulab] No se pudo leer data/notion-config.json:', (error as Error).message);
    }
  }

  return { notionSecret, parentPageId: cleanNotionId(parentPageId) };
}

export function saveNotionConfig(
  config: Partial<NotionConfig> & { clearParentPage?: boolean },
): NotionConfig {
  ensureDataDirs();
  const current = loadNotionConfig();
  const next: NotionConfig = {
    notionSecret:
      typeof config.notionSecret === 'string' && config.notionSecret.trim()
        ? config.notionSecret.trim()
        : current.notionSecret,
    parentPageId: config.clearParentPage
      ? ''
      : typeof config.parentPageId === 'string' && config.parentPageId.trim()
        ? cleanNotionId(config.parentPageId)
        : current.parentPageId,
  };
  fs.writeFileSync(CONFIG_FILE, JSON.stringify(next, null, 2), 'utf8');
  return next;
}

export function loadOAuthMeta(): NotionOAuthMeta | null {
  if (!fs.existsSync(OAUTH_FILE)) return null;
  try {
    const parsed = JSON.parse(fs.readFileSync(OAUTH_FILE, 'utf8')) as Partial<NotionOAuthMeta>;
    if (!parsed || typeof parsed !== 'object') return null;
    return { ...parsed, obtainedAt: parsed.obtainedAt || new Date().toISOString() };
  } catch (error) {
    console.warn('[modulab] No se pudo leer data/notion-oauth.json:', (error as Error).message);
    return null;
  }
}

export function saveOAuthMeta(meta: NotionOAuthMeta): NotionOAuthMeta {
  ensureDataDirs();
  fs.writeFileSync(OAUTH_FILE, JSON.stringify(meta, null, 2), 'utf8');
  return meta;
}

export function clearOAuthMeta(): void {
  if (fs.existsSync(OAUTH_FILE)) fs.unlinkSync(OAUTH_FILE);
}

export function clearNotionConfig(): void {
  if (fs.existsSync(CONFIG_FILE)) fs.unlinkSync(CONFIG_FILE);
  clearOAuthMeta();
}

export function maskedToken(token: string): string {
  if (!token) return '';
  return `••••••••${token.slice(-4)}`;
}
