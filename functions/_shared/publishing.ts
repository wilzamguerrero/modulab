import { ApiError, type Env } from './env';
import { loadConfig } from './config';
import { listProjects, loadPublishedSnapshot, savePublishedSnapshot } from './notion';

export interface PublishedDocument {
  publicId: string;
  publishedAt: string;
  version: number;
  project: any;
}

const PUBLIC_ID_PATTERN = /^[a-z0-9][a-z0-9-]{2,120}$/;
const keyFor = (publicId: string) => `published:${publicId}`;

function safePublicId(publicId: string): string {
  if (!PUBLIC_ID_PATTERN.test(publicId)) {
    throw new ApiError('El identificador público no es válido.', 400);
  }
  return publicId;
}

export async function readPublished(env: Env, publicId: string): Promise<PublishedDocument | null> {
  if (!env.MODULAB_KV) return null;
  try {
    const parsed = (await env.MODULAB_KV.get(keyFor(safePublicId(publicId)), 'json')) as PublishedDocument | null;
    if (!parsed || !parsed.project) return null;
    return parsed;
  } catch {
    return null;
  }
}

export async function deletePublished(env: Env, publicId: string): Promise<void> {
  notionPublishedCache.delete(publicId);
  if (!env.MODULAB_KV) return;
  await env.MODULAB_KV.delete(keyFor(safePublicId(publicId)));
}

const notionPublishedCache = new Map<string, { at: number; document: PublishedDocument | null }>();
const NOTION_PUBLISHED_TTL = 60_000;

/** Busca una publicación guardada dentro de los proyectos de Notion. */
export async function findPublishedInNotion(env: Env, publicId: string): Promise<PublishedDocument | null> {
  const cached = notionPublishedCache.get(publicId);
  if (cached && Date.now() - cached.at < NOTION_PUBLISHED_TTL) return cached.document;
  const config = await loadConfig(env);
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
  env: Env,
  document: PublishedDocument,
  notionBlockId?: string,
): Promise<void> {
  const publicId = safePublicId(document.publicId);
  const payload: PublishedDocument = { ...document, publicId };

  if (env.MODULAB_KV) {
    await env.MODULAB_KV.put(keyFor(publicId), JSON.stringify(payload));
  }

  let mirrored = false;
  if (notionBlockId) {
    const config = await loadConfig(env);
    if (config.notionSecret) {
      try {
        await savePublishedSnapshot(notionBlockId, payload, config);
        mirrored = true;
      } catch (error) {
        console.warn('[modulab] No se pudo guardar la publicación en Notion:', (error as Error).message);
      }
    }
  }

  if (!env.MODULAB_KV && !mirrored) {
    throw new ApiError(
      'No hay dónde guardar la publicación. Crea el binding KV MODULAB_KV en Cloudflare Pages (gratis) o vincula el proyecto a Notion antes de publicar.',
      400,
    );
  }
}

export async function getPublishedDocument(env: Env, publicId: string): Promise<PublishedDocument | null> {
  const local = await readPublished(env, publicId);
  if (local) return local;
  return findPublishedInNotion(env, publicId);
}
