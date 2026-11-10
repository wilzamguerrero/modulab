import 'dotenv/config';
import express, { type NextFunction, type Request, type Response } from 'express';
import fs from 'node:fs';
import path from 'node:path';
import { Readable } from 'node:stream';
import {
  DIST_DIR,
  clearNotionConfig,
  clearOAuthMeta,
  ensureDataDirs,
  loadNotionConfig,
  loadOAuthMeta,
  maskedToken,
  resolveCatalogDir,
  saveNotionConfig,
} from './server/config';
import {
  buildAuthorizeUrl,
  completeAuthorization,
  oauthConfigured,
  resolveRedirectUri,
  searchPages,
  selectParentPage,
} from './server/notionOAuth';
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
import {
  NOT_CONNECTED_MESSAGE,
  clearSessionCookie,
  createSessionToken,
  hasBrowserSession,
  issueSessionCookie,
  readSessionToken,
} from './server/browserSession';

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

/**
 * La credencial de Notion vive en el servidor, pero solo se expone a un
 * navegador que haya completado la autorización. Sin esa marca, los datos se
 * responden como «no conectado» para que nadie que entre por primera vez vea
 * la conexión de otra persona.
 */
function requireNotionSession(req: Request, res: Response): boolean {
  if (hasBrowserSession(req)) return true;
  jsonError(res, 409, NOT_CONNECTED_MESSAGE, { code: 'notion_not_connected' });
  return false;
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
  asyncRoute(async (req, res) => {
    // Sin autorización en este navegador se responde como si no hubiera nada:
    // ni token, ni página, ni workspace, ni los últimos 4 caracteres del token.
    if (!hasBrowserSession(req)) {
      res.json({
        configured: false,
        hasToken: false,
        parentPageId: '',
        authMode: 'none',
        oauthAvailable: oauthConfigured(),
        connected: false,
      });
      return;
    }

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
    const oauth = loadOAuthMeta();
    res.json({
      configured,
      connected: true,
      hasToken: Boolean(config.notionSecret),
      parentPageId: config.parentPageId,
      parentPageTitle,
      maskedToken: maskedToken(config.notionSecret),
      workspaceName: oauth?.workspaceName,
      authMode: oauth ? 'oauth' : 'manual',
      oauthAvailable: oauthConfigured(),
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
    // Un token pegado a mano deja de ser una sesión OAuth.
    if (typeof notionSecret === 'string' && notionSecret.trim()) clearOAuthMeta();
    // Quien guarda un token a mano pasa a estar conectado en este navegador.
    if (config.notionSecret && config.parentPageId) issueSessionCookie(req, res);
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
      connected: true,
      parentPageId: config.parentPageId,
      parentPageTitle,
      maskedToken: maskedToken(config.notionSecret),
      error,
    });
  }),
);

app.delete('/api/notion/config', (req, res) => {
  clearNotionConfig();
  clearSessionCookie(req, res);
  res.json({ success: true });
});

// ---------------------------------------------------------------------------
// Notion OAuth (el client secret nunca sale del servidor)
// ---------------------------------------------------------------------------

app.get('/api/notion/oauth/start', (req, res) => {
  if (!oauthConfigured()) {
    return jsonError(
      res,
      500,
      'Falta configurar NOTION_CLIENT_ID y NOTION_CLIENT_SECRET en el servidor.',
    );
  }
  const origin = `${req.protocol}://${req.get('host')}`;
  const redirectUri = resolveRedirectUri(origin);
  // El token de sesión viaja firmado dentro del `state`: al volver de Notion se
  // sabe que el navegador que autorizó es este y solo a él se le marca.
  const sessionToken = readSessionToken(req) || createSessionToken();
  issueSessionCookie(req, res, sessionToken);
  res.redirect(buildAuthorizeUrl(redirectUri, sessionToken));
});

// Notion vuelve a la URI registrada (la raíz del sitio). La página recibe
// `code`/`state` y los envía aquí; el secreto nunca sale del servidor.
app.post(
  '/api/notion/oauth/exchange',
  asyncRoute(async (req, res) => {
    const code = String(req.body?.code || '').trim();
    const state = String(req.body?.state || '').trim();
    if (!code || !state) {
      return jsonError(res, 400, 'La autorización llegó incompleta. Vuelve a intentarlo.');
    }
    const result = await completeAuthorization(code, state);
    // La cookie se confirma aquí: desde este momento el navegador está conectado.
    issueSessionCookie(req, res, result.sessionToken);
    // El cliente guarda el token en `sessionStorage` para enviarlo también como
    // cabecera. Sin devolverlo, este navegador quedaría con cookie pero sin
    // marca local y la interfaz seguiría pidiendo autorizar.
    res.json({
      workspaceName: result.workspaceName,
      workspaceId: result.workspaceId,
      sessionToken: result.sessionToken,
    });
  }),
);

// Callback de servidor: solo aplica si la integración registra esta ruta.
app.get(
  '/api/notion/oauth/callback',
  asyncRoute(async (req, res) => {
    const code = String(req.query.code || '').trim();
    const state = String(req.query.state || '').trim();
    const oauthError = String(req.query.error || '').trim();
    const fallback = resolveRedirectUri(`${req.protocol}://${req.get('host')}`);

    if (oauthError) {
      return res.redirect(`${fallback}?notion=error&reason=${encodeURIComponent(oauthError)}`);
    }
    if (!code || !state) {
      return res.redirect(`${fallback}?notion=error&reason=state`);
    }

    try {
      const result = await completeAuthorization(code, state);
      issueSessionCookie(req, res, result.sessionToken);
      const workspace = encodeURIComponent(result.workspaceName || '');
      res.redirect(`${fallback}?notion=connected&workspace=${workspace}`);
    } catch (error) {
      const reason = encodeURIComponent((error as Error).message);
      res.redirect(`${fallback}?notion=error&reason=${reason}`);
    }
  }),
);

app.get(
  '/api/notion/oauth/pages',
  asyncRoute(async (_req, res) => {
    res.json({ pages: await searchPages() });
  }),
);

app.post(
  '/api/notion/oauth/select',
  asyncRoute(async (req, res) => {
    const pageId = String(req.body?.pageId || '').trim();
    if (!pageId) return jsonError(res, 400, 'Falta el ID de la página de Notion.');
    const parentPageId = selectParentPage(pageId);
    // La página anterior ya no aplica: se descartan proyectos y personas.
    invalidateProjectsCache();
    invalidatePeopleCache();
    let parentPageTitle: string | undefined;
    try {
      parentPageTitle = await getPageTitle(parentPageId);
    } catch {
      // El título es informativo; la selección ya quedó guardada.
    }
    res.json({ success: true, parentPageId, parentPageTitle });
  }),
);

app.get(
  '/api/notion/projects',
  asyncRoute(async (req, res) => {
    if (!requireNotionSession(req, res)) return;
    const result = await listProjects();
    res.json(result);
  }),
);

app.post(
  '/api/notion/projects',
  asyncRoute(async (req, res) => {
    if (!requireNotionSession(req, res)) return;
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
    if (!requireNotionSession(req, res)) return;
    const result = await loadProject(req.params.blockId);
    res.json(result);
  }),
);

app.put(
  '/api/notion/projects/:blockId',
  asyncRoute(async (req, res) => {
    if (!requireNotionSession(req, res)) return;
    const { name, project } = req.body || {};
    if (!project || typeof project !== 'object') return jsonError(res, 400, 'Faltan los datos del proyecto.');
    await saveProject(req.params.blockId, typeof name === 'string' ? name : '', project);
    res.json({ success: true, savedAt: new Date().toISOString() });
  }),
);

app.delete(
  '/api/notion/projects/:blockId',
  asyncRoute(async (req, res) => {
    if (!requireNotionSession(req, res)) return;
    await archiveBlock(req.params.blockId);
    invalidateProjectsCache();
    res.json({ success: true });
  }),
);

app.get(
  '/api/notion/people',
  asyncRoute(async (req, res) => {
    if (!requireNotionSession(req, res)) return;
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
    // Lectura pública a propósito: las imágenes viajan dentro de un proyecto
    // publicado (`/e/<id>`), que se abre sin sesión de Notion.
    const url = await getImageBlockUrl(req.params.blockId);
    if (!url) return jsonError(res, 404, 'La imagen no existe en Notion.');
    const upstream = await fetch(url);
    if (!upstream.ok) return jsonError(res, 502, 'No se pudo descargar la imagen desde Notion.');
    const buffer = Buffer.from(await upstream.arrayBuffer());
    res.setHeader('Content-Type', upstream.headers.get('content-type') || 'image/jpeg');
    // Cacheable en el navegador y en la CDN: el `blockId` identifica un contenido
    // inmutable. Con `private` cada visita volvía a descargar la imagen de
    // Notion, lo que provocaba que la galería cargara de forma intermitente.
    res.setHeader('Cache-Control', 'public, max-age=31536000, immutable');
    res.setHeader('CDN-Cache-Control', 'public, max-age=31536000, immutable');
    res.send(buffer);
  }),
);

// ---------------------------------------------------------------------------
// Archivos multimedia servidos desde Notion (vídeos, PDF y adjuntos)
// ---------------------------------------------------------------------------

async function serveNotionFile(req: Request, res: Response, disposition: 'inline' | 'attachment') {
  const config = loadNotionConfig();
  const signedUrl = await getFileBlockUrl(req.params.blockId, config);
  if (!signedUrl) return jsonError(res, 404, 'El archivo no existe en Notion.');
  const range = req.headers.range;
  const upstream = await fetch(signedUrl, range ? { headers: { Range: range } } : undefined);
  if (!upstream.ok && upstream.status !== 206) {
    return jsonError(res, 502, 'No se pudo descargar el archivo desde Notion.');
  }
  res.status(upstream.status);
  res.setHeader('Content-Type', upstream.headers.get('content-type') || 'application/octet-stream');
  const length = upstream.headers.get('content-length');
  if (length) res.setHeader('Content-Length', length);
  res.setHeader('Accept-Ranges', upstream.headers.get('accept-ranges') || 'bytes');
  const contentRange = upstream.headers.get('content-range');
  if (contentRange) res.setHeader('Content-Range', contentRange);
  res.setHeader('Content-Disposition', disposition);
  res.setHeader('Cache-Control', 'private, max-age=600');
  if (!upstream.body) return res.end();
  // Se transmite por partes para no cargar en memoria vídeos o PDF grandes.
  Readable.fromWeb(upstream.body as any).pipe(res);
}

app.get(
  '/api/notion/file/:blockId',
  asyncRoute(async (req, res) => {
    // Público: los vídeos y PDF forman parte del proyecto publicado.
    await serveNotionFile(req, res, 'inline');
  }),
);

// ---------------------------------------------------------------------------
// Publicaciones
// ---------------------------------------------------------------------------

app.post(
  '/api/publish',
  asyncRoute(async (req, res) => {
    if (!requireNotionSession(req, res)) return;
    const { publicId, project, notionBlockId, version, publishedAt } = req.body || {};
    if (!publicId || typeof publicId !== 'string') return jsonError(res, 400, 'Falta el identificador público.');
    if (!/^[a-z0-9][a-z0-9-]{2,120}$/.test(publicId)) {
      return jsonError(res, 400, 'El identificador público solo puede tener minúsculas, números y guiones.');
    }
    const projectData = project as { levels?: unknown; floor?: { vertices?: unknown } } | null;
    const validProject =
      projectData &&
      typeof projectData === 'object' &&
      (Array.isArray(projectData.levels) || Array.isArray(projectData.floor?.vertices));
    if (!validProject) {
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
    if (!requireNotionSession(req, res)) return;
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
    if (!requireNotionSession(req, res)) return;
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
    if (!requireNotionSession(req, res)) return;
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
    if (!requireNotionSession(req, res)) return;
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
    // Público: el entorno se carga en la vista compartida. Subir sigue
    // exigiendo sesión en /api/splat/init|part|complete.
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
// Multimedia del proyecto y de los expositores (imágenes, vídeos y PDF)
// ---------------------------------------------------------------------------

const MEDIA_BLOCK_TYPES = new Set(['image', 'video', 'pdf', 'file']);

function normalizeMediaKind(value: unknown): 'image' | 'video' | 'pdf' | 'file' {
  const kind = String(value || '').toLowerCase();
  return MEDIA_BLOCK_TYPES.has(kind) ? (kind as 'image' | 'video' | 'pdf' | 'file') : 'file';
}

app.post(
  '/api/media/init',
  asyncRoute(async (req, res) => {
    if (!requireNotionSession(req, res)) return;
    const { filename, contentType, sizeBytes } = req.body || {};
    if (!filename || typeof filename !== 'string') {
      return jsonError(res, 400, 'Falta el nombre del archivo.');
    }
    const size = Number(sizeBytes);
    if (!Number.isFinite(size) || size <= 0) return jsonError(res, 400, 'Tamaño de archivo inválido.');
    const config = loadNotionConfig();
    if (!config.notionSecret) return jsonError(res, 400, 'Notion no está configurado.');
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
  '/api/media/part',
  express.raw({ type: () => true, limit: '512mb' }),
  asyncRoute(async (req, res) => {
    if (!requireNotionSession(req, res)) return;
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
  '/api/media/complete',
  asyncRoute(async (req, res) => {
    if (!requireNotionSession(req, res)) return;
    const { uploadId, mode, parentBlockId, kind } = req.body || {};
    if (!uploadId || typeof uploadId !== 'string') return jsonError(res, 400, 'Falta uploadId.');
    const config = loadNotionConfig();
    if (!config.notionSecret) return jsonError(res, 400, 'Notion no está configurado.');
    if (mode !== 'single_part') {
      await completeFileUpload(uploadId, config);
    }
    const parent = String(parentBlockId || '').trim() || config.parentPageId;
    if (!parent) {
      return jsonError(
        res,
        400,
        'Falta el destino en Notion. Vincula el proyecto o el expositor antes de subir archivos.',
      );
    }
    const blockType = normalizeMediaKind(kind);
    const blockId = await appendFileUploadBlock(parent, uploadId, config, blockType);
    res.json({ success: true, blockId, kind: blockType });
  }),
);

app.delete(
  '/api/media/:blockId',
  asyncRoute(async (req, res) => {
    if (!requireNotionSession(req, res)) return;
    await archiveBlock(req.params.blockId);
    res.json({ success: true });
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
    console.log(`  OAuth:     ${oauthConfigured() ? 'disponible' : 'sin NOTION_CLIENT_ID/SECRET'}`);
    console.log('');
  });
}

start().catch((error) => {
  console.error('[modulab] No se pudo iniciar el servidor:', error);
  process.exit(1);
});
