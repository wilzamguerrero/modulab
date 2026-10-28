import type { Env } from '../_shared/env';
import { json, jsonError } from '../_shared/env';
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

      const targetBlock = String(form?.get('notionBlockId') || '').trim();
      const filename = sanitizePhotoName(blob.name || 'imagen');
      const bytes = await blob.arrayBuffer();
      const contentType = blob.type || 'image/jpeg';

      // Preferimos Notion como almacén de la imagen (no consume KV).
      const config = await loadConfig(env);
      if (config.notionSecret) {
        const parent = targetBlock || config.parentPageId;
        if (parent) {
          try {
            const blockId = await notion.uploadImageToBlock(parent, bytes, filename, contentType, config);
            return json({
              success: true,
              url: `/api/notion/image/${encodeURIComponent(blockId)}`,
              notionBlockId: blockId,
            });
          } catch (err) {
            console.warn('[modulab] Subida a Notion falló; se usa KV:', (err as Error).message);
          }
        }
      }

      // Respaldo: KV (si Notion no está disponible).
      const kv = env.MODULAB_KV;
      if (!kv) {
        return jsonError(400, 'No hay Notion disponible ni almacenamiento KV para guardar la fotografía.');
      }
      await kv.put(photoKey(filename), bytes, { metadata: { contentType } });
      return json({ success: true, url: `/uploads/${encodeURIComponent(filename)}`, filename });
    }

    // --- Notion: configuración ---------------------------------------------
    if (path === '/notion/config') {
      if (method === 'GET') {
        const config = await loadConfig(env);
        let configured = Boolean(config.notionSecret && config.parentPageId);
        let parentPageTitle: string | undefined;
        let error: string | undefined;
        if (configured) {
          try {
            parentPageTitle = await notion.verifyParentPage(config.parentPageId, config);
            if (!parentPageTitle) {
              error = 'La página responde, pero no se pudo leer su título. Verifica que esté compartida con la integración.';
            }
          } catch (err) {
            error = (err as Error).message;
            const status = Number((err as any)?.status);
            if (status === 401 || status === 403) configured = false;
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
        let configured = Boolean(config.notionSecret && config.parentPageId);
        let parentPageTitle: string | undefined;
        let error: string | undefined;
        if (configured) {
          try {
            parentPageTitle = await notion.verifyParentPage(config.parentPageId, config);
            if (!parentPageTitle) {
              error = 'La página responde, pero no se pudo leer su título. Verifica que esté compartida con la integración.';
            }
          } catch (err) {
            error = (err as Error).message;
            const status = Number((err as any)?.status);
            if (status === 401 || status === 403) configured = false;
          }
        }
        return json({
          success: true,
          configured,
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

    // --- Entorno Gaussian splat (subida a Notion + proxy) -------------------
    if (method === 'POST' && path === '/splat/init') {
      const body = await readJson(request);
      const filename = typeof body?.filename === 'string' ? body.filename : '';
      const sizeBytes = Number(body?.sizeBytes);
      if (!filename) return jsonError(400, 'Falta el nombre del archivo.');
      if (!Number.isFinite(sizeBytes) || sizeBytes <= 0) return jsonError(400, 'Tamaño de archivo inválido.');
      const config = await loadConfig(env);
      if (!config.notionSecret) return jsonError(400, 'Notion no está configurado.');
      const init = await notion.createFileUpload(
        { filename, contentType: String(body?.contentType || 'application/octet-stream'), sizeBytes },
        config,
      );
      return json({
        success: true,
        uploadId: init.id,
        mode: init.mode,
        numberOfParts: init.numberOfParts,
        chunkSize: init.chunkSize,
        filename: init.filename,
      });
    }

    if (method === 'POST' && path === '/splat/part') {
      const url = new URL(request.url);
      const uploadId = url.searchParams.get('upload_id');
      if (!uploadId) return jsonError(400, 'Falta upload_id.');
      const contentType = request.headers.get('Content-Type') || '';
      if (!contentType.toLowerCase().includes('multipart/form-data')) {
        return jsonError(400, 'Content-Type debe ser multipart/form-data.');
      }
      if (!request.body) return jsonError(400, 'Cuerpo vacío.');
      const config = await loadConfig(env);
      if (!config.notionSecret) return jsonError(400, 'Notion no está configurado.');
      await notion.sendFileUploadPart(uploadId, contentType, request.body, config);
      return json({ success: true });
    }

    if (method === 'POST' && path === '/splat/complete') {
      const body = await readJson(request);
      const uploadId = typeof body?.uploadId === 'string' ? body.uploadId : '';
      if (!uploadId) return jsonError(400, 'Falta uploadId.');
      const config = await loadConfig(env);
      if (!config.notionSecret) return jsonError(400, 'Notion no está configurado.');
      if (body?.mode !== 'single_part') {
        await notion.completeFileUpload(uploadId, config);
      }
      const parent = String(body?.parentBlockId || '').trim() || config.parentPageId;
      if (!parent) {
        return jsonError(400, 'Falta la página destino. Vincula el proyecto a Notion antes de subir el entorno.');
      }
      const blockId = await notion.appendFileUploadBlock(parent, uploadId, config);
      return json({ success: true, blockId, url: `/api/splat/${encodeURIComponent(blockId)}` });
    }

    const splatMatch = path.match(/^\/splat\/([^/]+)$/);
    if (method === 'GET' && splatMatch) {
      const blockId = splatMatch[1];
      const config = await loadConfig(env);
      const signedUrl = await notion.getFileBlockUrl(blockId, config);
      if (!signedUrl) return jsonError(404, 'El entorno no existe en Notion.');
      const range = request.headers.get('Range');
      const upstream = await fetch(signedUrl, range ? { headers: { Range: range } } : undefined);
      const headers = new Headers();
      headers.set('Content-Type', upstream.headers.get('Content-Type') || 'application/octet-stream');
      const length = upstream.headers.get('Content-Length');
      if (length) headers.set('Content-Length', length);
      headers.set('Accept-Ranges', upstream.headers.get('Accept-Ranges') || 'bytes');
      const contentRange = upstream.headers.get('Content-Range');
      if (contentRange) headers.set('Content-Range', contentRange);
      headers.set('Cache-Control', 'private, max-age=600');
      return new Response(upstream.body, { status: upstream.status, headers });
    }

    return jsonError(404, 'Ruta de API no encontrada.');
  } catch (error) {
    const status = Number((error as any)?.status) || 500;
    if (status >= 500) console.error('[modulab] Error inesperado:', error);
    return jsonError(status, (error as Error)?.message || 'Error interno del servidor.');
  }
};
