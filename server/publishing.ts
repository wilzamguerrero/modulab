import fs from 'node:fs';
import path from 'node:path';
import { PUBLISHED_DIR, ensureDataDirs, loadNotionConfig } from './config';
import { listProjects, loadPublishedSnapshot, savePublishedSnapshot } from './notion';

export interface PublishedDocument {
  publicId: string;
  publishedAt: string;
  version: number;
  project: any;
}

const PUBLIC_ID_PATTERN = /^[a-z0-9][a-z0-9-]{2,120}$/;

function safePublicId(publicId: string): string {
  if (!PUBLIC_ID_PATTERN.test(publicId)) {
    throw new Error('El identificador público no es válido.');
  }
  return publicId;
}

function fileFor(publicId: string): string {
  return path.join(PUBLISHED_DIR, `${safePublicId(publicId)}.json`);
}

export function writePublished(document: PublishedDocument): void {
  ensureDataDirs();
  const publicId = safePublicId(document.publicId);
  const target = fileFor(publicId);
  const temporary = `${target}.tmp`;
  fs.writeFileSync(temporary, JSON.stringify({ ...document, publicId }, null, 2), 'utf8');
  fs.renameSync(temporary, target);
}

export function readPublished(publicId: string): PublishedDocument | null {
  try {
    const file = fileFor(publicId);
    if (!fs.existsSync(file)) return null;
    const parsed = JSON.parse(fs.readFileSync(file, 'utf8')) as PublishedDocument;
    if (!parsed || !parsed.project) return null;
    return parsed;
  } catch {
    return null;
  }
}

export function deletePublished(publicId: string): void {
  const file = fileFor(publicId);
  if (fs.existsSync(file)) fs.unlinkSync(file);
}

const notionPublishedCache = new Map<string, { at: number; document: PublishedDocument | null }>();
const NOTION_PUBLISHED_TTL = 60_000;

/** Busca una publicación guardada dentro de los proyectos de Notion. */
export async function findPublishedInNotion(publicId: string): Promise<PublishedDocument | null> {
  const cached = notionPublishedCache.get(publicId);
  if (cached && Date.now() - cached.at < NOTION_PUBLISHED_TTL) return cached.document;
  const config = loadNotionConfig();
  if (!config.notionSecret || !config.parentPageId) return null;

  let document: PublishedDocument | null = null;
  try {
    const { projects } = await listProjects(config.parentPageId, config);
    for (const project of projects) {
      try {
        const snapshot = await loadPublishedSnapshot(project.id, config);
        if (snapshot && snapshot.publicId === publicId) {
          document = {
            publicId,
            publishedAt: snapshot.publishedAt || new Date().toISOString(),
            version: snapshot.version || 1,
            project: snapshot.project,
          };
          break;
        }
      } catch {
        // Se continúa con el siguiente proyecto.
      }
    }
  } catch (error) {
    console.warn('[modulab] No se pudo buscar la publicación en Notion:', (error as Error).message);
  }
  notionPublishedCache.set(publicId, { at: Date.now(), document });
  return document;
}

export async function publishDocument(
  document: PublishedDocument,
  notionBlockId?: string,
): Promise<void> {
  writePublished(document);
  notionPublishedCache.set(document.publicId, { at: Date.now(), document });
  if (notionBlockId) {
    const config = loadNotionConfig();
    if (config.notionSecret) {
      try {
        await savePublishedSnapshot(notionBlockId, document, config);
      } catch (error) {
        console.warn('[modulab] La publicación quedó local, pero no se pudo guardar en Notion:', (error as Error).message);
      }
    }
  }
}

export async function getPublishedDocument(publicId: string): Promise<PublishedDocument | null> {
  const local = readPublished(publicId);
  if (local) return local;
  const remote = await findPublishedInNotion(publicId);
  if (remote) {
    try {
      writePublished(remote);
    } catch {
      // Solo caché.
    }
  }
  return remote;
}
