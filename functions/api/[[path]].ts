import type { Env } from '../_shared/env';
import { json, jsonError, requireKv } from '../_shared/env';
import { clearConfig, loadConfig, maskedToken, saveConfig } from '../_shared/config';
import * as notion from '../_shared/notion';
import { deletePublished, getPublishedDocument, publishDocument } from '../_shared/publishing';
import { scanCatalog } from '../_shared/catalog';
import { photoKey, sanitizePhotoName } from '../_shared/uploads';

const MAX_PHOTO_BYTES = 15 * 1024 * 1024;

async function readJson(request: Request): Promise<any> {
  try {
    return await request.json();
  } catch {
    return {};
  }
}

export const onRequest: PagesFunction<Env> = async (context) => {
  const { request, env, params } = context;
  const segments = Array.isArray(params.path) ? params.path : params.path ? [params.path] : [];
  const path = '/' + segments.join('/');
  const method = request.method.toUpperCase();

  try {
    // --- Salud y catálogo ---------------------------------------------------
    if (method === 'GET' && path === '/health') {
      return json({ ok: true, name: 'modulab', version: '0.1.0' });
    }

    if (method === 'GET' && path === '/catalog') {
      return json(await scanCatalog(request, env));
    }

    if (method === 'POST' && path === '/catalog/upload') {
      return jsonError(
        400,
        'En Cloudflare Pages la subida de modelos en tiempo de ejecución no está disponible (los GLB pueden superar el límite de KV y R2 es de pago). Copia el modelo en public/catalog y vuelve a desplegar.',
      );
    }

    // --- Fotografías de expositores ----------------------------------------
    if (method === 'POST' && path === '/uploads/photo') {
      const form = await request.formData().catch(() => null);
      const file = form?.get('file');
      if (!file || typeof file === 'string') {
        return jsonError(400, 'No se recibió ninguna imagen.');
      }
      const blob = file as File;
      if (!blob.type.startsWith('image/')) {
        return jsonError(400, 'Solo se aceptan imágenes.');
      }
      if (blob.size > MAX_PHOTO_BYTES) {
        return jsonError(400, 'La imagen supera el límite de 15 MB.');
      }
      const kv = requireKv(env, 'guardar las fotografías subidas');
      const filename = sanitizePhotoName(blob.name || 'imagen');
      const bytes = await blob.arrayBuffer();
      await kv.put(photoKey(filename), bytes, {
        metadata: { contentType: blob.type || 'image/jpeg' },
      });
      return json({ success: true, url: `/uploads/${encodeURIComponent(filename)}`, filename });
    }

    // --- Notion: configuración ---------------------------------------------
    if (path === '/notion/config') {
      if (method === 'GET') {
        const config = await loadConfig(env);
        const configured = Boolean(config.notionSecret && config.parentPageId);
        let parentPageTitle: string | undefined;
        let error: string | undefined;
        if (configured) {
          try {
            parentPageTitle = await notion.getPageTitle(config.parentPageId, config);
          } catch (err) {
            error = (err as Error).message;
          }
        }
        return json({
          configured,
          hasToken: Boolean(config.notionSecret),
          parentPageId: config.parentPageId,
          parentPageTitle,
          maskedToken: maskedToken(config.notionSecret),
          error,
        });
      }

      if (method === 'POST') {
        const body = await readJson(request);
        const { notionSecret, parentPageId } = body || {};
        if (!notionSecret && !parentPageId) {
          return jsonError(400, 'Indica el token y la página padre de Notion.');
        }
        const config = await saveConfig(env, { notionSecret, parentPageId });
        let parentPageTitle: string | undefined;
        let error: string | undefined;
        if (config.notionSecret && config.parentPageId) {
          try {
            parentPageTitle = await notion.getPageTitle(config.parentPageId, config);
            if (!parentPageTitle) {
              error = 'La página responde, pero no se pudo leer su título. Verifica que esté compartida con la integración.';
            }
          } catch (err) {
            error = (err as Error).message;
          }
        }
        return json({
          success: true,
          configured: Boolean(config.notionSecret && config.parentPageId),
          parentPageId: config.parentPageId,
          parentPageTitle,
          maskedToken: maskedToken(config.notionSecret),
          error,
        });
      }

      if (method === 'DELETE') {
        await clearConfig(env);
        return json({ success: true });
      }
    }

    // --- Notion: proyectos --------------------------------------------------
    if (path === '/notion/projects') {
      const config = await loadConfig(env);
      if (method === 'GET') {
        return json(await notion.listProjects(config.parentPageId, config));
      }
      if (method === 'POST') {
        const body = await readJson(request);
        const { name, project } = body || {};
        if (!name || typeof name !== 'string') return jsonError(400, 'Falta el nombre del proyecto.');
        if (!project || typeof project !== 'object') return jsonError(400, 'Faltan los datos del proyecto.');
        if (!config.parentPageId) {
          return jsonError(400, 'Configura primero la página padre de proyectos en Notion.');
        }
        const created = await notion.createProject(config.parentPageId, name, project, config);
        return json({ success: true, page: created }, 201);
      }
    }

    const projectMatch = path.match(/^\/notion\/projects\/([^/]+)$/);
    if (projectMatch) {
      const blockId = projectMatch[1];
      const config = await loadConfig(env);
      if (method === 'GET') {
        return json(await notion.loadProject(blockId, config));
      }
      if (method === 'PUT') {
        const body = await readJson(request);
        const { name, project } = body || {};
        if (!project || typeof project !== 'object') return jsonError(400, 'Faltan los datos del proyecto.');
        await notion.saveProject(blockId, typeof name === 'string' ? name : '', project, config);
        return json({ success: true, savedAt: new Date().toISOString() });
      }
      if (method === 'DELETE') {
        await notion.archiveBlock(blockId, config);
        notion.invalidateProjectsCache();
        return json({ success: true });
      }
    }

    // --- Notion: expositores -----------------------------------------------
    if (method === 'GET' && path === '/notion/people') {
      const url = new URL(request.url);
      const pageId = String(url.searchParams.get('pageId') || '').trim();
      if (!pageId) return jsonError(400, 'Falta el ID de la página de expositores.');
      if (url.searchParams.get('refresh') === '1') notion.invalidatePeopleCache();
      const config = await loadConfig(env);
      const result = await notion.listPeople(pageId, config);
      return json({ ...result, pageId });
    }

    // --- Notion: proxy de imagen -------------------------------------------
    const imageMatch = path.match(/^\/notion\/image\/([^/]+)$/);
    if (method === 'GET' && imageMatch) {
      const blockId = imageMatch[1];
      const config = await loadConfig(env);
      const url = await notion.getImageBlockUrl(blockId, config);
      if (!url) return jsonError(404, 'La imagen no existe en Notion.');
      const upstream = await fetch(url);
      if (!upstream.ok) return jsonError(502, 'No se pudo descargar la imagen desde Notion.');
      return new Response(upstream.body, {
        status: 200,
        headers: {
          'Content-Type': upstream.headers.get('content-type') || 'image/jpeg',
          'Cache-Control': 'private, max-age=3600',
        },
      });
    }

    // --- Publicaciones ------------------------------------------------------
    if (method === 'POST' && path === '/publish') {
      const body = await readJson(request);
      const { publicId, project, notionBlockId, version, publishedAt } = body || {};
      if (!publicId || typeof publicId !== 'string') return jsonError(400, 'Falta el identificador público.');
      if (!/^[a-z0-9][a-z0-9-]{2,120}$/.test(publicId)) {
        return jsonError(400, 'El identificador público solo puede tener minúsculas, números y guiones.');
      }
      if (!project || typeof project !== 'object' || !Array.isArray(project.floor?.vertices)) {
        return jsonError(400, 'Los datos de la escena publicada no son válidos.');
      }
      const document = {
        publicId,
        publishedAt: typeof publishedAt === 'string' ? publishedAt : new Date().toISOString(),
        version: Number.isFinite(version) ? Math.max(1, Math.round(version as number)) : 1,
        project,
      };
      await publishDocument(env, document, typeof notionBlockId === 'string' ? notionBlockId : undefined);
      return json({
        success: true,
        url: `/e/${publicId}`,
        publicId,
        publishedAt: document.publishedAt,
        version: document.version,
      });
    }

    const publishedMatch = path.match(/^\/published\/([^/]+)$/);
    if (publishedMatch) {
      const publicId = publishedMatch[1];
      if (method === 'GET') {
        const document = await getPublishedDocument(env, publicId);
        if (!document) return jsonError(404, 'Esta publicación no existe o todavía no se ha publicado.');
        return json(document, 200, { 'Cache-Control': 'no-cache' });
      }
      if (method === 'DELETE') {
        await deletePublished(env, publicId);
        return json({ success: true });
      }
    }

    return jsonError(404, 'Ruta de API no encontrada.');
  } catch (error) {
    const status = Number((error as any)?.status) || 500;
    if (status >= 500) console.error('[modulab] Error inesperado:', error);
    return jsonError(status, (error as Error)?.message || 'Error interno del servidor.');
  }
};
