import type { MediaItem, MediaKind } from '@/types/project';
import { apiDelete, apiPost, notionSessionHeaders } from '@/services/api';
import { createId } from '@/utils/id';

interface InitResponse {
  uploadId: string;
  mode: 'single_part' | 'multi_part';
  numberOfParts: number;
  chunkSize: number;
  /** Nombre finalmente aceptado por Notion. */
  filename?: string;
}

export interface UploadMediaResult {
  blockId?: string;
  url?: string;
  kind: MediaKind;
}

const IMAGE_EXTENSIONS = /\.(avif|bmp|gif|heic|jpe?g|png|svg|tiff?|webp)$/i;
const VIDEO_EXTENSIONS = /\.(amv|asf|avi|f4v|flv|gifv|m4v|mkv|mov|mp4|mpe?g|mpv|qt|webm|wmv)$/i;

/** Deduce el tipo de contenido a partir del MIME y, si falta, de la extensión. */
export function mediaKindForFile(file: Pick<File, 'name' | 'type'>): MediaKind {
  const type = (file.type || '').toLowerCase();
  if (type.startsWith('image/')) return 'image';
  if (type.startsWith('video/')) return 'video';
  if (type === 'application/pdf') return 'pdf';
  const name = file.name || '';
  if (IMAGE_EXTENSIONS.test(name)) return 'image';
  if (VIDEO_EXTENSIONS.test(name)) return 'video';
  if (/\.pdf$/i.test(name)) return 'pdf';
  return 'file';
}

/**
 * URL con la que se sirve el contenido.
 *
 * Orden de preferencia:
 * 1. `url` — enlace directo. En los vídeos de una publicación llega firmado por
 *    Notion/S3, así el navegador descarga sin pasar por la Function (más rápido
 *    y sin gastar CPU del Worker).
 * 2. `notionBlockId` — proxy del servidor, para las imágenes: así la CDN las
 *    cachea de forma compartida y se sirven instantáneas a todos los visitantes.
 */
export function mediaItemUrl(
  item: Pick<MediaItem, 'kind' | 'notionBlockId' | 'url'> | null | undefined,
): string | undefined {
  if (!item) return undefined;
  if (item.url) return item.url;
  if (item.notionBlockId) {
    const endpoint = item.kind === 'image' ? 'image' : 'file';
    return `/api/notion/${endpoint}/${encodeURIComponent(item.notionBlockId)}`;
  }
  return undefined;
}

export function mediaKindLabel(kind: MediaKind): string {
  switch (kind) {
    case 'image':
      return 'Imagen';
    case 'video':
      return 'Vídeo';
    case 'pdf':
      return 'PDF';
    default:
      return 'Archivo';
  }
}

/**
 * Etiqueta visible de un archivo.
 *
 * Si el autor escribió un pie/título se usa tal cual. Si no, se genera
 * «Imagen 3», «Vídeo 2», «PDF 1»… a partir de la posición dentro de su propio
 * tipo. Nunca se muestra el nombre técnico del archivo subido
 * (`foto_2026_final.jpg`), que no aporta nada al visitante.
 *
 * @param item    Archivo a etiquetar.
 * @param ordinal Posición 1-based entre los archivos del mismo tipo.
 */
export function mediaDisplayLabel(
  item: Pick<MediaItem, 'kind' | 'caption'>,
  ordinal: number,
): string {
  const caption = item.caption?.trim();
  if (caption) return caption;
  return `${mediaKindLabel(item.kind)} ${ordinal}`;
}

/**
 * Calcula el número que corresponde a cada archivo dentro de su tipo, en el
 * mismo orden en que aparecen. Con `[img, video, img, img]` devuelve los
 * ordinales `[1, 1, 2, 3]`: la tercera imagen es «Imagen 2».
 */
export function mediaOrdinals(items: readonly Pick<MediaItem, 'id' | 'kind'>[]): Map<string, number> {
  const counters = new Map<string, number>();
  const result = new Map<string, number>();
  for (const item of items) {
    const next = (counters.get(item.kind) ?? 0) + 1;
    counters.set(item.kind, next);
    result.set(item.id, next);
  }
  return result;
}

export function formatBytes(bytes: number | undefined): string {
  if (!bytes || !Number.isFinite(bytes)) return '';
  if (bytes < 1024) return `${bytes} B`;
  if (bytes < 1024 * 1024) return `${(bytes / 1024).toFixed(0)} KB`;
  if (bytes < 1024 * 1024 * 1024) return `${(bytes / (1024 * 1024)).toFixed(1)} MB`;
  return `${(bytes / (1024 * 1024 * 1024)).toFixed(2)} GB`;
}

/**
 * Borra el bloque de Notion asociado a un elemento. No hace nada si el archivo
 * vive fuera de Notion (URL externa) o ya se borró. Se ignora el error para no
 * impedir quitar el elemento del proyecto cuando Notion no responde.
 */
export async function deleteMediaItem(item: Pick<MediaItem, 'notionBlockId'>): Promise<void> {
  if (!item.notionBlockId) return;
  try {
    await apiDelete(`/api/media/${encodeURIComponent(item.notionBlockId)}`);
  } catch (error) {
    console.warn('[modulab] No se pudo borrar el archivo de Notion:', (error as Error).message);
  }
}

/**
 * Sube un archivo a Notion troceándolo en partes de 10 MB (igual que el
 * entorno Gaussian). Los archivos pequeños usan una sola parte. El binario se
 * adjunta al proyecto como bloque `image`, `video`, `pdf` o `file`.
 */
export async function uploadMediaFile(
  file: File,
  options: {
    parentBlockId: string;
    kind?: MediaKind;
    onProgress?: (ratio: number) => void;
  },
): Promise<MediaItem> {
  const kind = options.kind ?? mediaKindForFile(file);
  const init = await apiPost<InitResponse>('/api/media/init', {
    filename: file.name,
    contentType: file.type || 'application/octet-stream',
    sizeBytes: file.size,
    kind,
  });

  const partName = init.filename || file.name;

  for (let part = 1; part <= init.numberOfParts; part++) {
    const start = (part - 1) * init.chunkSize;
    const end = Math.min(start + init.chunkSize, file.size);
    const form = new FormData();
    if (init.mode === 'multi_part') form.append('part_number', String(part));
    form.append('file', file.slice(start, end), partName);

    const response = await fetch(`/api/media/part?upload_id=${encodeURIComponent(init.uploadId)}`, {
      method: 'POST',
      // La subida por partes no pasa por `apiFetch`: la marca de sesión se añade aquí.
      headers: notionSessionHeaders(),
      body: form,
    });
    if (!response.ok) {
      let message = `Error subiendo la parte ${part}/${init.numberOfParts}`;
      try {
        const data = (await response.json()) as { error?: string };
        if (data?.error) message = data.error;
      } catch {
        // Sin cuerpo JSON.
      }
      throw new Error(message);
    }
    options.onProgress?.(part / init.numberOfParts);
  }

  const result = await apiPost<UploadMediaResult>('/api/media/complete', {
    uploadId: init.uploadId,
    mode: init.mode,
    parentBlockId: options.parentBlockId,
    kind,
  });

  return {
    id: createId('media'),
    kind: result.kind || kind,
    name: file.name,
    caption: '',
    notionBlockId: result.blockId,
    url: result.blockId ? undefined : result.url,
    mimeType: file.type || undefined,
    sizeBytes: file.size,
    createdAt: new Date().toISOString(),
  };
}
