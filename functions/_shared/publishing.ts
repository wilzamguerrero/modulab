import { ApiError, type Env } from './env';
import { loadConfig } from './config';
import {
  getFileBlockUrlCached,
  listProjects,
  loadPublishedSnapshot,
  savePublishedSnapshot,
} from './notion';

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
    try {
      const config = await loadConfig(env);
      if (config.notionSecret) {
        await savePublishedSnapshot(notionBlockId, payload, config);
        mirrored = true;
      }
    } catch (error) {
      // El espejo es un extra: si Notion lo rechaza (proyecto grande, token
      // caducado, red), la publicación ya quedó en KV y debe seguir adelante.
      // Antes este fallo se propagaba y la interfaz mostraba un 500 sin causa.
      console.warn(
        '[modulab] La publicación quedó guardada, pero no se pudo espejar en Notion:',
        (error as Error)?.message || error,
      );
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

/**
 * Sustituye las referencias a bloques de Notion por enlaces firmados directos
 * en los VÍDEOS del documento publicado.
 *
 * Motivo: un vídeo servido a través del proxy obliga a Cloudflare a reenviar
 * cada petición `Range` desde Notion (decenas por espectador, y Notion limita a
 * ~3 req/s). Con la URL firmada, el navegador descarga directamente de S3 sin
 * pasar por la Function: es lo que hacen los visores de galería rápidos.
 *
 * Solo se hidratan los vídeos. Las imágenes siguen por el proxy porque así la
 * CDN las cachea y se benefician de `immutable`; un vídeo, en cambio, se sirve
 * por rangos y aprovecha más la descarga directa.
 *
 * Los enlaces de Notion caducan a la hora, por eso se piden en cada lectura del
 * documento: el navegador siempre recibe uno vigente.
 */
export async function withDirectVideoUrls(env: Env, document: PublishedDocument): Promise<PublishedDocument> {
  const project = document?.project;
  const exhibitors = Array.isArray(project?.exhibitors) ? project.exhibitors : [];
  const videos: Array<{ blockId: string; item: any }> = [];
  for (const exhibitor of exhibitors) {
    for (const item of Array.isArray(exhibitor?.media) ? exhibitor.media : []) {
      if (item?.kind === 'video' && item?.notionBlockId) {
        videos.push({ blockId: String(item.notionBlockId), item });
      }
    }
  }
  if (!videos.length) return document;

  const config = await loadConfig(env);
  if (!config.notionSecret) return document;

  const resolved = await Promise.all(
    videos.map(async ({ blockId, item }) => {
      try {
        const url = await getFileBlockUrlCached(blockId, config);
        return url ? { item, url } : null;
      } catch {
        // Si falla, el elemento conserva su `notionBlockId` y el proxy responde.
        return null;
      }
    }),
  );

  const byBlock = new Map<string, string>();
  for (const entry of resolved) {
    if (!entry) continue;
    byBlock.set(String(entry.item.notionBlockId), entry.url);
  }
  if (!byBlock.size) return document;

  return {
    ...document,
    project: {
      ...project,
      exhibitors: exhibitors.map((exhibitor: any) => ({
        ...exhibitor,
        media: (Array.isArray(exhibitor?.media) ? exhibitor.media : []).map((item: any) =>
          item?.kind === 'video' && byBlock.has(String(item.notionBlockId))
            ? { ...item, url: byBlock.get(String(item.notionBlockId)), notionBlockId: undefined }
            : item,
        ),
      })),
    },
  };
}
