import 'dotenv/config';
import express, { type NextFunction, type Request, type Response } from 'express';
import fs from 'node:fs';
import path from 'node:path';
import {
  DIST_DIR,
  clearNotionConfig,
  ensureDataDirs,
  loadNotionConfig,
  maskedToken,
  resolveCatalogDir,
  saveNotionConfig,
} from './server/config';
import { createCatalogUpload, scanCatalog } from './server/catalog';
import { createUploadsMiddleware, uploadsDir } from './server/uploads';
import {
  NotionError,
  appendFileUploadBlock,
  archiveBlock,
  completeFileUpload,
  createFileUpload,
  createProject,
  getFileBlockUrl,
  getImageBlockUrl,
  getPageTitle,
  invalidatePeopleCache,
  invalidateProjectsCache,
  listPeople,
  listProjects,
  loadProject,
  saveProject,
  sendFileUploadPart,
} from './server/notion';
import { deletePublished, getPublishedDocument, publishDocument } from './server/publishing';

const app = express();
const PORT = Number(process.env.PORT || 3000);
const isProduction =
  process.env.NODE_ENV === 'production' ||
  process.argv.includes('--production') ||
  Boolean(process.argv[1]?.replace(/\\/g, '/').endsWith('dist/server.cjs'));

app.disable('x-powered-by');
app.use(express.json({ limit: '30mb' }));
app.use(express.urlencoded({ extended: true, limit: '30mb' }));

function asyncRoute(
  handler: (req: Request, res: Response, next: NextFunction) => Promise<void>,
) {
  return (req: Request, res: Response, next: NextFunction) => {
    handler(req, res, next).catch(next);
  };
}

function jsonError(res: Response, status: number, message: string, details?: unknown) {
  res.status(status).json({ error: message, details });
}

// ---------------------------------------------------------------------------
// Salud y catálogo dinámico
// ---------------------------------------------------------------------------

app.get('/api/health', (_req, res) => {
  res.json({ ok: true, name: 'modulab', version: '0.1.0' });
});

app.get('/api/catalog', (_req, res) => {
  const { items, directory } = scanCatalog();
  res.json({
    items,
    directory: path.basename(directory),
    count: items.length,
  });
});

const catalogUpload = createCatalogUpload();
app.post('/api/catalog/upload', catalogUpload.single('file'), (req, res) => {
  if (!req.file) return jsonError(res, 400, 'No se recibió ningún archivo.');
  const name = path.basename(req.file.filename, path.extname(req.file.filename));
  res.json({
    success: true,
    item: {
      id: req.file.filename,
      name,
      category: 'General',
      file: req.file.filename,
      url: `/catalog/${encodeURIComponent(req.file.filename)}`,
      sizeBytes: req.file.size,
      modifiedAt: new Date().toISOString(),
    },
  });
});

// ---------------------------------------------------------------------------
// Archivos subidos (fotografías de expositores)
// ---------------------------------------------------------------------------

const uploads = createUploadsMiddleware();
app.post('/api/uploads/photo', uploads.single('file'), (req, res) => {
  if (!req.file) return jsonError(res, 400, 'No se recibió ninguna imagen.');
  res.json({
    success: true,
    url: `/uploads/${encodeURIComponent(req.file.filename)}`,
    filename: req.file.filename,
  });
});

app.use('/uploads', express.static(uploadsDir(), { maxAge: '1h', fallthrough: true }));

// ---------------------------------------------------------------------------
// Notion
// ---------------------------------------------------------------------------

app.get(
  '/api/notion/config',
  asyncRoute(async (_req, res) => {
    const config = loadNotionConfig();
    const configured = Boolean(config.notionSecret && config.parentPageId);
    let parentPageTitle: string | undefined;
    let error: string | undefined;
    if (configured) {
      try {
        parentPageTitle = await getPageTitle(config.parentPageId, config);
      } catch (err) {
        error = (err as Error).message;
      }
    }
    res.json({
      configured,
      hasToken: Boolean(config.notionSecret),
      parentPageId: config.parentPageId,
      parentPageTitle,
      maskedToken: maskedToken(config.notionSecret),
      error,
    });
  }),
);

app.post(
  '/api/notion/config',
  asyncRoute(async (req, res) => {
    const { notionSecret, parentPageId } = req.body || {};
    if (!notionSecret && !parentPageId) {
      return jsonError(res, 400, 'Indica el token y la página padre de Notion.');
    }
    const config = saveNotionConfig({ notionSecret, parentPageId });
    let parentPageTitle: string | undefined;
    let error: string | undefined;
    if (config.notionSecret && config.parentPageId) {
      try {
        parentPageTitle = await getPageTitle(config.parentPageId, config);
        if (!parentPageTitle) {
          error = 'La página responde, pero no se pudo leer su título. Verifica que esté compartida con la integración.';
        }
      } catch (err) {
        error = (err as Error).message;
      }
    }
    res.json({
      success: true,
      configured: Boolean(config.notionSecret && config.parentPageId),
      parentPageId: config.parentPageId,
      parentPageTitle,
      maskedToken: maskedToken(config.notionSecret),
      error,
    });
  }),
);

app.delete('/api/notion/config', (_req, res) => {
  clearNotionConfig();
  res.json({ success: true });
});

app.get(
  '/api/notion/projects',
  asyncRoute(async (_req, res) => {
    const result = await listProjects();
    res.json(result);
  }),
);

app.post(
  '/api/notion/projects',
  asyncRoute(async (req, res) => {
    const { name, project } = req.body || {};
    if (!name || typeof name !== 'string') return jsonError(res, 400, 'Falta el nombre del proyecto.');
    if (!project || typeof project !== 'object') return jsonError(res, 400, 'Faltan los datos del proyecto.');
    const config = loadNotionConfig();
    if (!config.parentPageId) {
      return jsonError(res, 400, 'Configura primero la página padre de proyectos en Notion.');
    }
    const created = await createProject(config.parentPageId, name, project, config);
    res.status(201).json({ success: true, page: created });
  }),
);

app.get(
  '/api/notion/projects/:blockId',
  asyncRoute(async (req, res) => {
    const result = await loadProject(req.params.blockId);
    res.json(result);
  }),
);

app.put(
  '/api/notion/projects/:blockId',
  asyncRoute(async (req, res) => {
    const { name, project } = req.body || {};
    if (!project || typeof project !== 'object') return jsonError(res, 400, 'Faltan los datos del proyecto.');
    await saveProject(req.params.blockId, typeof name === 'string' ? name : '', project);
    res.json({ success: true, savedAt: new Date().toISOString() });
  }),
);

app.delete(
  '/api/notion/projects/:blockId',
  asyncRoute(async (req, res) => {
    await archiveBlock(req.params.blockId);
    invalidateProjectsCache();
    res.json({ success: true });
  }),
);

app.get(
  '/api/notion/people',
  asyncRoute(async (req, res) => {
    const pageId = String(req.query.pageId || '').trim();
    if (!pageId) return jsonError(res, 400, 'Falta el ID de la página de expositores.');
    if (req.query.refresh === '1') invalidatePeopleCache();
    const result = await listPeople(pageId);
    res.json({ ...result, pageId });
  }),
);

app.get(
  '/api/notion/image/:blockId',
  asyncRoute(async (req, res) => {
    const url = await getImageBlockUrl(req.params.blockId);
    if (!url) return jsonError(res, 404, 'La imagen no existe en Notion.');
    const upstream = await fetch(url);
    if (!upstream.ok) return jsonError(res, 502, 'No se pudo descargar la imagen desde Notion.');
    const buffer = Buffer.from(await upstream.arrayBuffer());
    res.setHeader('Content-Type', upstream.headers.get('content-type') || 'image/jpeg');
    res.setHeader('Cache-Control', 'private, max-age=3600');
    res.send(buffer);
  }),
);

// ---------------------------------------------------------------------------
// Publicaciones
// ---------------------------------------------------------------------------

app.post(
  '/api/publish',
  asyncRoute(async (req, res) => {
    const { publicId, project, notionBlockId, version, publishedAt } = req.body || {};
    if (!publicId || typeof publicId !== 'string') return jsonError(res, 400, 'Falta el identificador público.');
    if (!/^[a-z0-9][a-z0-9-]{2,120}$/.test(publicId)) {
      return jsonError(res, 400, 'El identificador público solo puede tener minúsculas, números y guiones.');
    }
    if (!project || typeof project !== 'object' || !Array.isArray(project.floor?.vertices)) {
      return jsonError(res, 400, 'Los datos de la escena publicada no son válidos.');
    }
    const document = {
      publicId,
      publishedAt: typeof publishedAt === 'string' ? publishedAt : new Date().toISOString(),
      version: Number.isFinite(version) ? Math.max(1, Math.round(version)) : 1,
      project,
    };
    await publishDocument(document, typeof notionBlockId === 'string' ? notionBlockId : undefined);
    res.json({ success: true, url: `/e/${publicId}`, publicId, publishedAt: document.publishedAt, version: document.version });
  }),
);

app.get(
  '/api/published/:publicId',
  asyncRoute(async (req, res) => {
    const document = await getPublishedDocument(req.params.publicId);
    if (!document) return jsonError(res, 404, 'Esta publicación no existe o todavía no se ha publicado.');
    res.setHeader('Cache-Control', 'no-cache');
    res.json(document);
  }),
);

app.delete(
  '/api/published/:publicId',
  asyncRoute(async (req, res) => {
    deletePublished(req.params.publicId);
    res.json({ success: true });
  }),
);

// ---------------------------------------------------------------------------
// Entorno Gaussian splat (subida a Notion + proxy)
// ---------------------------------------------------------------------------

app.post(
  '/api/splat/init',
  asyncRoute(async (req, res) => {
    const { filename, contentType, sizeBytes } = req.body || {};
    if (!filename || typeof filename !== 'string') {
      return jsonError(res, 400, 'Falta el nombre del archivo.');
    }
    const size = Number(sizeBytes);
    if (!Number.isFinite(size) || size <= 0) {
      return jsonError(res, 400, 'Tamaño de archivo inválido.');
    }
    const config = loadNotionConfig();
    if (!config.notionSecret) {
      return jsonError(res, 400, 'Notion no está configurado.');
    }
    const init = await createFileUpload(
      { filename, contentType: String(contentType || 'application/octet-stream'), sizeBytes: size },
      config,
    );
    res.json({
      success: true,
      uploadId: init.id,
      mode: init.mode,
      numberOfParts: init.numberOfParts,
      chunkSize: init.chunkSize,
      filename: init.filename,
    });
  }),
);

app.post(
  '/api/splat/part',
  express.raw({ type: () => true, limit: '512mb' }),
  asyncRoute(async (req, res) => {
    const uploadId = String(req.query.upload_id || '').trim();
    if (!uploadId) return jsonError(res, 400, 'Falta upload_id.');
    const contentType = req.headers['content-type'] || '';
    if (!contentType.toLowerCase().includes('multipart/form-data')) {
      return jsonError(res, 400, 'Content-Type debe ser multipart/form-data.');
    }
    const body = req.body as Buffer;
    if (!body || !body.length) return jsonError(res, 400, 'Cuerpo vacío.');
    const config = loadNotionConfig();
    if (!config.notionSecret) return jsonError(res, 400, 'Notion no está configurado.');
    await sendFileUploadPart(uploadId, contentType, body, config);
    res.json({ success: true });
  }),
);

app.post(
  '/api/splat/complete',
  asyncRoute(async (req, res) => {
    const { uploadId, mode, parentBlockId } = req.body || {};
    if (!uploadId || typeof uploadId !== 'string') return jsonError(res, 400, 'Falta uploadId.');
    const config = loadNotionConfig();
    if (!config.notionSecret) return jsonError(res, 400, 'Notion no está configurado.');
    if (mode !== 'single_part') {
      await completeFileUpload(uploadId, config);
    }
    const parent = String(parentBlockId || '').trim() || config.parentPageId;
    if (!parent) {
      return jsonError(res, 400, 'Falta la página destino. Vincula el proyecto a Notion antes de subir el entorno.');
    }
    const blockId = await appendFileUploadBlock(parent, uploadId, config);
    res.json({ success: true, blockId, url: `/api/splat/${encodeURIComponent(blockId)}` });
  }),
);

app.get(
  '/api/splat/:blockId',
  asyncRoute(async (req, res) => {
    const config = loadNotionConfig();
    const signedUrl = await getFileBlockUrl(req.params.blockId, config);
    if (!signedUrl) return jsonError(res, 404, 'El entorno no existe en Notion.');
    const range = req.headers.range;
    const upstream = await fetch(signedUrl, range ? { headers: { Range: range } } : undefined);
    res.status(upstream.status);
    res.setHeader('Content-Type', upstream.headers.get('content-type') || 'application/octet-stream');
    const length = upstream.headers.get('content-length');
    if (length) res.setHeader('Content-Length', length);
    res.setHeader('Accept-Ranges', upstream.headers.get('accept-ranges') || 'bytes');
    const contentRange = upstream.headers.get('content-range');
    if (contentRange) res.setHeader('Content-Range', contentRange);
    res.setHeader('Cache-Control', 'private, max-age=600');
    res.send(Buffer.from(await upstream.arrayBuffer()));
  }),
);

// ---------------------------------------------------------------------------
// Estáticos y SPA
// ---------------------------------------------------------------------------

const catalogDir = resolveCatalogDir();
fs.mkdirSync(catalogDir, { recursive: true });
// Sin caché prolongada: los modelos se reemplazan en sitio y deben revalidarse.
app.use('/catalog', express.static(catalogDir, { maxAge: 0, etag: true, fallthrough: true }));

async function start() {
  ensureDataDirs();

  if (isProduction) {
    app.use(express.static(DIST_DIR, { maxAge: '1h', index: false }));
    app.get('*', (req, res, next) => {
      if (req.path.startsWith('/api/')) return next();
      const index = path.join(DIST_DIR, 'index.html');
      if (!fs.existsSync(index)) {
        return jsonError(res, 500, 'No se encontró el build del cliente. Ejecuta npm run build.');
      }
      res.sendFile(index);
    });
  } else {
    const { createServer } = await import('vite');
    const vite = await createServer({
      server: { middlewareMode: true },
      appType: 'spa',
    });
    app.use(vite.middlewares);
  }

  app.use((req, res, next) => {
    if (req.path.startsWith('/api/')) return jsonError(res, 404, 'Ruta de API no encontrada.');
    next();
  });

  app.use((error: any, _req: Request, res: Response, _next: NextFunction) => {
    if (res.headersSent) return;
    if (error instanceof NotionError) {
      return jsonError(res, error.status, error.message);
    }
    if (error?.name === 'MulterError') {
      return jsonError(res, 400, `Error al subir el archivo: ${error.message}`);
    }
    if (typeof error?.message === 'string' && /Solo se aceptan/.test(error.message)) {
      return jsonError(res, 400, error.message);
    }
    console.error('[modulab] Error inesperado:', error);
    jsonError(res, 500, error?.message || 'Error interno del servidor.');
  });

  app.listen(PORT, () => {
    const config = loadNotionConfig();
    console.log('');
    console.log('  MODULAB');
    console.log(`  Editor:    http://localhost:${PORT}`);
    console.log(`  Catálogo:  ${catalogDir}`);
    console.log(`  Notion:    ${config.notionSecret && config.parentPageId ? 'configurado' : 'sin configurar'}`);
    console.log('');
  });
}

start().catch((error) => {
  console.error('[modulab] No se pudo iniciar el servidor:', error);
  process.exit(1);
});
