import type { NotionConfig } from './env';
import { cleanNotionId } from './config';

const NOTION_BASE = 'https://api.notion.com/v1';
const NOTION_VERSION = '2022-06-28';

export class NotionError extends Error {
  readonly status: number;
  constructor(message: string, status = 500) {
    super(message);
    this.name = 'NotionError';
    this.status = status;
  }
}

const sleep = (ms: number) => new Promise((resolve) => setTimeout(resolve, ms));

function resolveConfig(config?: NotionConfig): NotionConfig {
  if (!config) throw new NotionError('Notion no está configurado.', 400);
  return config;
}

let active = 0;
const waiting: Array<() => void> = [];
const MAX_CONCURRENCY = 2;
const MAX_QUEUE = 20;

async function acquire(): Promise<void> {
  if (active < MAX_CONCURRENCY) {
    active++;
    return;
  }
  if (waiting.length >= MAX_QUEUE) {
    throw new NotionError('Notion está recibiendo demasiadas solicitudes. Intenta de nuevo en unos segundos.', 503);
  }
  await new Promise<void>((resolve) => waiting.push(resolve));
}

function release(): void {
  const next = waiting.shift();
  if (next) {
    next();
    return;
  }
  active--;
}

function isRetryable(status: number): boolean {
  return status === 429 || status === 502 || status === 503 || status === 504;
}

async function notionFetch<T = any>(
  method: string,
  endpoint: string,
  body?: unknown,
  configOverride?: NotionConfig,
): Promise<T> {
  const config = resolveConfig(configOverride);
  if (!config.notionSecret) {
    throw new NotionError('Notion no está configurado. Añade el token de integración en Ajustes.', 400);
  }

  for (let attempt = 0; attempt <= 3; attempt++) {
    await acquire();
    let holdingSlot = true;
    const freeSlot = () => {
      if (holdingSlot) {
        holdingSlot = false;
        release();
      }
    };
    try {
      const response = await fetch(`${NOTION_BASE}${endpoint}`, {
        method,
        headers: {
          Authorization: `Bearer ${config.notionSecret}`,
          'Notion-Version': NOTION_VERSION,
          'Content-Type': 'application/json',
        },
        body: body === undefined ? undefined : JSON.stringify(body),
      });
      const text = await response.text();
      let data: any = {};
      if (text) {
        try {
          data = JSON.parse(text);
        } catch {
          data = { message: text };
        }
      }
      if (!response.ok) {
        const message = data?.message || data?.code || `HTTP ${response.status}`;
        if (isRetryable(response.status) && attempt < 3) {
          freeSlot();
          await sleep(1000 * 2 ** attempt);
          continue;
        }
        throw new NotionError(`Notion: ${message}`, response.status);
      }
      return data as T;
    } catch (error) {
      if (error instanceof NotionError) throw error;
      if (attempt < 3) {
        freeSlot();
        await sleep(1000 * 2 ** attempt);
        continue;
      }
      throw new NotionError(`No se pudo conectar con Notion: ${(error as Error).message}`, 502);
    } finally {
      freeSlot();
    }
  }
  throw new NotionError('No se pudo completar la solicitud a Notion.', 502);
}

export interface NotionBlock {
  id: string;
  type: string;
  created_time?: string;
  last_edited_time?: string;
  has_children?: boolean;
  [key: string]: any;
}

export function richTextToPlain(richText: unknown): string {
  if (!Array.isArray(richText)) return '';
  return richText.map((item: any) => item?.plain_text ?? item?.text?.content ?? '').join('');
}

export function toRichTextChunks(content: string): Array<{ type: 'text'; text: { content: string } }> {
  const chunks: Array<{ type: 'text'; text: { content: string } }> = [];
  for (let i = 0; i < content.length; i += 1900) {
    chunks.push({ type: 'text', text: { content: content.slice(i, i + 1900) } });
  }
  return chunks.length ? chunks : [{ type: 'text', text: { content: '' } }];
}

export async function listAllChildren(
  blockId: string,
  configOverride?: NotionConfig,
): Promise<NotionBlock[]> {
  const out: NotionBlock[] = [];
  let cursor: string | undefined;
  do {
    const query = cursor
      ? `?start_cursor=${encodeURIComponent(cursor)}&page_size=100`
      : '?page_size=100';
    const data = await notionFetch<any>('GET', `/blocks/${blockId}/children${query}`, undefined, configOverride);
    for (const block of data.results || []) out.push(block);
    cursor = data.has_more ? data.next_cursor : undefined;
  } while (cursor);
  return out;
}

export async function retrieveBlock(blockId: string, configOverride?: NotionConfig): Promise<NotionBlock> {
  return notionFetch<NotionBlock>('GET', `/blocks/${blockId}`, undefined, configOverride);
}

export async function retrievePage(pageId: string, configOverride?: NotionConfig): Promise<any> {
  return notionFetch<any>('GET', `/pages/${pageId}`, undefined, configOverride);
}

export async function updateBlock(
  blockId: string,
  update: unknown,
  configOverride?: NotionConfig,
): Promise<NotionBlock> {
  return notionFetch<NotionBlock>('PATCH', `/blocks/${blockId}`, update, configOverride);
}

export async function appendChildren(
  blockId: string,
  children: unknown[],
  configOverride?: NotionConfig,
): Promise<NotionBlock[]> {
  const data = await notionFetch<any>(
    'PATCH',
    `/blocks/${blockId}/children`,
    { children },
    configOverride,
  );
  return data.results || [];
}

export async function archiveBlock(blockId: string, configOverride?: NotionConfig): Promise<void> {
  await notionFetch('PATCH', `/blocks/${blockId}`, { archived: true }, configOverride);
}

function parseJsonCodeBlock(block: NotionBlock): any | null {
  if (block.type !== 'code' || block.code?.language !== 'json') return null;
  const content = richTextToPlain(block.code?.rich_text).trim();
  if (!content) return null;
  try {
    return JSON.parse(content);
  } catch {
    return null;
  }
}

export function findJsonBlock(children: NotionBlock[], marker: string): { block: NotionBlock; value: any } | null {
  for (const child of children) {
    const parsed = parseJsonCodeBlock(child);
    if (parsed && parsed[marker] !== undefined) {
      return { block: child, value: parsed[marker] };
    }
  }
  return null;
}

export async function writeJsonBlock(
  parentBlockId: string,
  marker: string,
  value: unknown,
  configOverride?: NotionConfig,
): Promise<{ blockId: string; created: boolean }> {
  const children = await listAllChildren(parentBlockId, configOverride);
  const existing = findJsonBlock(children, marker);
  const json = JSON.stringify({ [marker]: value });
  if (json.length > 190_000) {
    throw new NotionError(
      'El proyecto es demasiado grande para guardarlo en un bloque de Notion (límite ≈190 000 caracteres). Reduce imágenes incrustadas o divide el proyecto.',
      413,
    );
  }
  const code = {
    code: {
      rich_text: toRichTextChunks(json),
      language: 'json',
    },
  };
  if (existing) {
    await updateBlock(existing.block.id, code, configOverride);
    return { blockId: existing.block.id, created: false };
  }
  const result = await appendChildren(
    parentBlockId,
    [{ object: 'block', type: 'code', ...code }],
    configOverride,
  );
  return { blockId: result[0]?.id || '', created: true };
}

export function blockTitle(block: NotionBlock): string {
  if (block.type === 'toggle') return richTextToPlain(block.toggle?.rich_text).trim();
  if (block.type === 'child_page') return String(block.child_page?.title || '').trim();
  return '';
}

export interface NotionProjectListItem {
  id: string;
  name: string;
  type: 'toggle' | 'child_page';
  url: string;
  createdTime?: string;
  lastEditedTime?: string;
}

const projectsCache = new Map<string, { at: number; data: NotionProjectListItem[] }>();
const PROJECTS_TTL = 15_000;

export function invalidateProjectsCache(): void {
  projectsCache.clear();
}

export async function listProjects(
  parentPageId?: string,
  configOverride?: NotionConfig,
): Promise<{ projects: NotionProjectListItem[]; parentPageId: string; parentPageTitle?: string }> {
  const config = resolveConfig(configOverride);
  const parentId = cleanNotionId(parentPageId || config.parentPageId);
  if (!parentId) throw new NotionError('Falta la página padre de proyectos en Notion.', 400);
  const cached = projectsCache.get(parentId);
  if (cached && Date.now() - cached.at < PROJECTS_TTL) {
    return {
      projects: cached.data,
      parentPageId: parentId,
      parentPageTitle: await getPageTitle(parentId, config).catch(() => undefined),
    };
  }

  const blocks = await listAllChildren(parentId, config);
  const projects = blocks
    .filter((block) => block.type === 'toggle' || block.type === 'child_page')
    .map((block) => ({
      id: block.id,
      name: blockTitle(block) || 'Proyecto sin título',
      type: block.type as 'toggle' | 'child_page',
      url: `https://www.notion.so/${block.id.replace(/-/g, '')}`,
      createdTime: block.created_time,
      lastEditedTime: block.last_edited_time,
    }));
  projectsCache.set(parentId, { at: Date.now(), data: projects });
  return {
    projects,
    parentPageId: parentId,
    parentPageTitle: await getPageTitle(parentId, config).catch(() => undefined),
  };
}

const titleCache = new Map<string, string>();

export async function getPageTitle(pageId: string, configOverride?: NotionConfig): Promise<string | undefined> {
  if (titleCache.has(pageId)) return titleCache.get(pageId);
  try {
    const page = await retrievePage(pageId, configOverride);
    const properties = page?.properties || {};
    for (const property of Object.values<any>(properties)) {
      if (property?.type === 'title') {
        const title = richTextToPlain(property.title).trim();
        if (title) {
          titleCache.set(pageId, title);
          return title;
        }
      }
    }
  } catch {
    try {
      const block = await retrieveBlock(pageId, configOverride);
      const title = blockTitle(block);
      if (title) {
        titleCache.set(pageId, title);
        return title;
      }
    } catch {
      // Sin título disponible.
    }
  }
  return undefined;
}

/**
 * Valida el token y devuelve el título de la página padre. Lanza si el token
 * es inválido (401/403), para que el estado refleje el error real.
 */
export async function verifyParentPage(
  pageId: string,
  configOverride?: NotionConfig,
): Promise<string | undefined> {
  const page = await retrievePage(pageId, configOverride);
  const properties = page?.properties || {};
  for (const property of Object.values<any>(properties)) {
    if (property?.type === 'title') {
      const title = richTextToPlain(property.title).trim();
      if (title) return title;
    }
  }
  return undefined;
}

export const PROJECT_MARKER = '__modulab_project__';
export const PUBLISHED_MARKER = '__modulab_published__';

export async function loadProject(
  blockId: string,
  configOverride?: NotionConfig,
): Promise<{ project: any | null; page: NotionProjectListItem }> {
  const block = await retrieveBlock(blockId, configOverride);
  const page: NotionProjectListItem = {
    id: block.id,
    name: blockTitle(block) || 'Proyecto sin título',
    type: (block.type === 'child_page' ? 'child_page' : 'toggle') as 'toggle' | 'child_page',
    url: `https://www.notion.so/${block.id.replace(/-/g, '')}`,
    createdTime: block.created_time,
    lastEditedTime: block.last_edited_time,
  };
  const children = await listAllChildren(blockId, configOverride);
  const found = findJsonBlock(children, PROJECT_MARKER);
  return { project: found?.value ?? null, page };
}

export async function createProject(
  parentPageId: string,
  name: string,
  projectData: unknown,
  configOverride?: NotionConfig,
): Promise<NotionProjectListItem> {
  const config = resolveConfig(configOverride);
  const [created] = await appendChildren(
    cleanNotionId(parentPageId),
    [
      {
        object: 'block',
        type: 'toggle',
        toggle: {
          rich_text: toRichTextChunks(name),
          color: 'default',
        },
      },
    ],
    config,
  );
  if (!created?.id) throw new NotionError('Notion no devolvió el bloque del proyecto creado.');
  const data = {
    ...(projectData && typeof projectData === 'object' ? projectData : {}),
    notionBlockId: created.id,
  };
  await writeJsonBlock(created.id, PROJECT_MARKER, data, config);
  invalidateProjectsCache();
  return {
    id: created.id,
    name,
    type: 'toggle',
    url: `https://www.notion.so/${created.id.replace(/-/g, '')}`,
    createdTime: created.created_time,
    lastEditedTime: created.last_edited_time,
  };
}

export async function saveProject(
  blockId: string,
  name: string,
  projectData: unknown,
  configOverride?: NotionConfig,
): Promise<void> {
  const config = resolveConfig(configOverride);
  if (name.trim()) {
    const block = await retrieveBlock(blockId, config);
    if (block.type === 'toggle') {
      await updateBlock(
        blockId,
        { toggle: { rich_text: toRichTextChunks(name.trim()) } },
        config,
      );
    } else if (block.type === 'child_page') {
      await updateBlock(blockId, { child_page: { title: name.trim().slice(0, 200) } }, config);
    }
  }
  const data = {
    ...(projectData && typeof projectData === 'object' ? projectData : {}),
    notionBlockId: blockId,
  };
  await writeJsonBlock(blockId, PROJECT_MARKER, data, config);
  invalidateProjectsCache();
  titleCache.delete(blockId);
}

export async function savePublishedSnapshot(
  blockId: string,
  snapshot: unknown,
  configOverride?: NotionConfig,
): Promise<void> {
  await writeJsonBlock(blockId, PUBLISHED_MARKER, snapshot, configOverride);
}

export async function loadPublishedSnapshot(
  blockId: string,
  configOverride?: NotionConfig,
): Promise<any | null> {
  const children = await listAllChildren(blockId, configOverride);
  return findJsonBlock(children, PUBLISHED_MARKER)?.value ?? null;
}

export interface NotionPerson {
  notionBlockId: string;
  name: string;
  description: string;
  standCode: string;
  photoNotionBlockId?: string;
  notionUrl: string;
  metadata: Record<string, string>;
}

const FIELD_ALIASES: Record<string, string> = {
  nombre: 'nombre',
  name: 'nombre',
  proyecto: 'proyecto',
  obra: 'proyecto',
  titulo: 'proyecto',
  stand: 'stand',
  'stand #': 'stand',
  codigo: 'stand',
  'codigo de stand': 'stand',
  'numero de stand': 'stand',
  puesto: 'stand',
  rol: 'rol',
  categoria: 'rol',
  carrera: 'rol',
  correo: 'correo',
  email: 'correo',
  'e-mail': 'correo',
  telefono: 'telefono',
  celular: 'telefono',
  whatsapp: 'telefono',
  instagram: 'instagram',
  web: 'enlace',
  enlace: 'enlace',
  url: 'enlace',
  descripcion: 'descripcion',
  description: 'descripcion',
};

function normalizeFieldKey(value: string): string {
  return value
    .normalize('NFD')
    .replace(/[̀-ͯ]/g, '')
    .toLowerCase()
    .replace(/\s+/g, ' ')
    .replace(/[.:]+$/g, '')
    .trim();
}

function parseFieldLine(line: string): { key: string; value: string } | null {
  const match = line.match(/^\s*([^:]{2,40}):\s*(.+?)\s*$/);
  if (!match) return null;
  const alias = FIELD_ALIASES[normalizeFieldKey(match[1])];
  if (!alias) return null;
  return { key: alias, value: match[2].trim() };
}

function textFromBlock(block: NotionBlock): string {
  const type = block.type;
  const payload = block[type];
  if (!payload) return '';
  return richTextToPlain(payload.rich_text).trim();
}

function parsePersonBlock(
  block: NotionBlock,
  children: NotionBlock[],
): NotionPerson | null {
  const rawTitle = blockTitle(block);
  if (!rawTitle) return null;

  let name = rawTitle;
  let standCode = '';
  const titleMatch = rawTitle.match(/^([A-Za-z0-9]{1,8})\s*[-–—.)]\s*(.+)$/);
  if (titleMatch) {
    standCode = titleMatch[1];
    name = titleMatch[2].trim();
  }

  const fields: Record<string, string> = {};
  const descriptionParts: string[] = [];
  let photoNotionBlockId: string | undefined;

  for (const child of children) {
    if (child.type === 'image') {
      if (!photoNotionBlockId) photoNotionBlockId = child.id;
      continue;
    }
    if (child.type === 'file' || child.type === 'pdf' || child.type === 'video') continue;
    const text = textFromBlock(child);
    if (!text) continue;
    const lines = text.split(/\r?\n/).map((line) => line.trim()).filter(Boolean);
    for (const line of lines) {
      const field = parseFieldLine(line);
      if (field) {
        if (field.key === 'descripcion') {
          if (field.value) descriptionParts.push(field.value);
        } else if (!fields[field.key]) {
          fields[field.key] = field.value;
        }
      } else {
        descriptionParts.push(line);
      }
    }
  }

  if (fields.nombre) name = fields.nombre;
  if (fields.stand) standCode = fields.stand;
  const description = descriptionParts.join('\n\n').trim().slice(0, 8000);
  const metadata: Record<string, string> = { ...fields };
  delete metadata.nombre;
  delete metadata.descripcion;
  delete metadata.stand;
  if (fields.proyecto) metadata.proyecto = fields.proyecto;
  if (fields.rol) metadata.rol = fields.rol;

  return {
    notionBlockId: block.id,
    name: name.trim() || rawTitle,
    description,
    standCode: standCode.trim(),
    photoNotionBlockId,
    notionUrl: `https://www.notion.so/${block.id.replace(/-/g, '')}`,
    metadata,
  };
}

const peopleCache = new Map<string, { at: number; data: NotionPerson[] }>();
const PEOPLE_TTL = 30_000;

export function invalidatePeopleCache(): void {
  peopleCache.clear();
}

export async function listPeople(
  pageId: string,
  configOverride?: NotionConfig,
): Promise<{ people: NotionPerson[]; pageTitle?: string }> {
  const config = resolveConfig(configOverride);
  const cleanPageId = cleanNotionId(pageId);
  if (!cleanPageId) throw new NotionError('Falta el ID de la página de expositores.', 400);
  const cached = peopleCache.get(cleanPageId);
  if (cached && Date.now() - cached.at < PEOPLE_TTL) {
    return { people: cached.data, pageTitle: await getPageTitle(cleanPageId, config).catch(() => undefined) };
  }

  const topLevel = await listAllChildren(cleanPageId, config);
  const container = topLevel.find((block) => {
    if (block.type !== 'toggle') return false;
    const title = normalizeFieldKey(blockTitle(block));
    return /^(personas|expositores|participantes|expositores y personas|stands)$/.test(title);
  });

  let personBlocks = topLevel;
  if (container) {
    personBlocks = await listAllChildren(container.id, config);
  }

  const candidates = personBlocks.filter(
    (block) => block.type === 'toggle' || block.type === 'child_page',
  );

  const people: NotionPerson[] = [];
  const concurrency = 3;
  let cursor = 0;
  async function worker() {
    while (cursor < candidates.length) {
      const block = candidates[cursor++];
      try {
        const children = await listAllChildren(block.id, config);
        const person = parsePersonBlock(block, children);
        if (person) people.push(person);
      } catch (error) {
        console.warn(`[modulab] No se pudo leer la persona ${block.id}:`, (error as Error).message);
      }
    }
  }
  await Promise.all(Array.from({ length: Math.min(concurrency, candidates.length) }, () => worker()));
  people.sort((a, b) => a.name.localeCompare(b.name, 'es'));
  peopleCache.set(cleanPageId, { at: Date.now(), data: people });
  return { people, pageTitle: await getPageTitle(cleanPageId, config).catch(() => undefined) };
}

export async function getImageBlockUrl(
  blockId: string,
  configOverride?: NotionConfig,
): Promise<string | null> {
  const block = await retrieveBlock(blockId, configOverride);
  if (block.type !== 'image') return null;
  return block.image?.file?.url || block.image?.external?.url || null;
}

/**
 * Sube una imagen al almacenamiento de Notion y la adjunta como bloque de
 * imagen dentro de `parentBlockId`. Devuelve el id del bloque creado, que luego
 * se sirve con el proxy `/api/notion/image/:blockId`.
 */
export async function uploadImageToBlock(
  parentBlockId: string,
  bytes: ArrayBuffer,
  filename: string,
  contentType: string,
  configOverride?: NotionConfig,
): Promise<string> {
  const config = resolveConfig(configOverride);
  if (!config.notionSecret) throw new NotionError('Notion no está configurado.', 400);
  const mime = contentType || 'application/octet-stream';

  // 1) Crear la subida (single part).
  const upload = await notionFetch<any>(
    'POST',
    '/file_uploads',
    { filename, content_type: mime },
    config,
  );
  if (!upload?.id) throw new NotionError('No se pudo crear la subida en Notion.', 502);

  // 2) Enviar los bytes como multipart (no usar notionFetch: no es JSON).
  const form = new FormData();
  form.append('file', new Blob([bytes], { type: mime }), filename);
  const sendUrl = upload.upload_url || `${NOTION_BASE}/file_uploads/${upload.id}/send`;
  const sendRes = await fetch(sendUrl, {
    method: 'POST',
    headers: {
      Authorization: `Bearer ${config.notionSecret}`,
      'Notion-Version': NOTION_VERSION,
    },
    body: form,
  });
  const sendData = (await sendRes.json().catch(() => ({}))) as any;
  if (!sendRes.ok) {
    throw new NotionError(`Notion: ${sendData?.message || `HTTP ${sendRes.status}`}`, sendRes.status);
  }
  if (sendData?.status && sendData.status !== 'uploaded' && sendData.status !== 'complete') {
    throw new NotionError(`La subida a Notion quedó en estado «${sendData.status}».`, 502);
  }

  // 3) Adjuntar el bloque de imagen con la referencia al upload.
  const [block] = await appendChildren(
    parentBlockId,
    [{ object: 'block', type: 'image', image: { type: 'file_upload', file_upload: { id: upload.id } } }],
    config,
  );
  if (!block?.id) throw new NotionError('Notion no devolvió el bloque de imagen.', 502);
  return block.id;
}
