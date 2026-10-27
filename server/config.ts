import fs from 'node:fs';
import path from 'node:path';

export interface NotionConfig {
  notionSecret: string;
  parentPageId: string;
}

export const ROOT_DIR = process.cwd();
export const DATA_DIR = process.env.MODULAB_DATA_DIR
  ? path.resolve(process.env.MODULAB_DATA_DIR)
  : path.join(ROOT_DIR, 'data');
export const PUBLISHED_DIR = path.join(DATA_DIR, 'published');
export const UPLOADS_DIR = path.join(DATA_DIR, 'uploads');
export const CONFIG_FILE = path.join(DATA_DIR, 'notion-config.json');

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

export function loadNotionConfig(): NotionConfig {
  let notionSecret = process.env.NOTION_SECRET?.trim() || '';
  let parentPageId = process.env.NOTION_ID_PAGE?.trim() || process.env.NOTION_PARENT_PAGE_ID?.trim() || '';

  if (fs.existsSync(CONFIG_FILE)) {
    try {
      const saved = JSON.parse(fs.readFileSync(CONFIG_FILE, 'utf8')) as Partial<NotionConfig>;
      if (saved.notionSecret) notionSecret = saved.notionSecret;
      if (saved.parentPageId) parentPageId = saved.parentPageId;
    } catch (error) {
      console.warn('[modulab] No se pudo leer data/notion-config.json:', (error as Error).message);
    }
  }

  return { notionSecret, parentPageId: cleanNotionId(parentPageId) };
}

export function saveNotionConfig(config: Partial<NotionConfig>): NotionConfig {
  ensureDataDirs();
  const current = loadNotionConfig();
  const next: NotionConfig = {
    notionSecret:
      typeof config.notionSecret === 'string' && config.notionSecret.trim()
        ? config.notionSecret.trim()
        : current.notionSecret,
    parentPageId:
      typeof config.parentPageId === 'string' && config.parentPageId.trim()
        ? cleanNotionId(config.parentPageId)
        : current.parentPageId,
  };
  fs.writeFileSync(CONFIG_FILE, JSON.stringify(next, null, 2), 'utf8');
  return next;
}

export function clearNotionConfig(): void {
  if (fs.existsSync(CONFIG_FILE)) fs.unlinkSync(CONFIG_FILE);
}

export function maskedToken(token: string): string {
  if (!token) return '';
  return `••••••••${token.slice(-4)}`;
}
