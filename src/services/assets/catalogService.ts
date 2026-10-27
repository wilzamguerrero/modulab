import type { CatalogItem, PrimitiveShape } from '@/types/project';
import { PRIMITIVE_CATALOG } from '@/data/defaults';
import { apiFetch, apiGet, apiUpload } from '@/services/api';

interface CatalogResponse {
  items: Array<{
    id: string;
    name: string;
    category: string;
    file: string;
    url: string;
    sizeBytes: number;
    modifiedAt: string;
  }>;
  directory: string;
  count: number;
}

/**
 * Añade un parámetro de versión (tamaño + fecha de modificación) a la URL.
 * Si se reemplaza el archivo conservando la ruta, la URL cambia y se evitan
 * las cachés en memoria y del navegador que devolvían el modelo anterior.
 */
function versionedCatalogUrl(item: { url: string; sizeBytes?: number; modifiedAt?: string }): string {
  const version = encodeURIComponent(`${item.sizeBytes ?? 0}-${item.modifiedAt ?? ''}`);
  const separator = item.url.includes('?') ? '&' : '?';
  return `${item.url}${separator}v=${version}`;
}

export async function loadCatalog(): Promise<{ items: CatalogItem[]; directory: string; glbCount: number }> {
  const response = await apiGet<CatalogResponse>('/api/catalog');
  const glbItems: CatalogItem[] = response.items.map((item) => ({
    id: `glb:${item.id}`,
    name: item.name,
    category: item.category,
    url: versionedCatalogUrl(item),
    file: item.file,
    kind: 'glb',
    sizeBytes: item.sizeBytes,
    modifiedAt: item.modifiedAt,
  }));
  const primitives: CatalogItem[] = PRIMITIVE_CATALOG.map((item) => ({
    id: `primitive:${item.shape}`,
    name: item.name,
    category: 'Formas básicas',
    kind: 'primitive',
    shape: item.shape as PrimitiveShape,
  }));
  return {
    items: [...primitives, ...glbItems],
    directory: response.directory,
    glbCount: glbItems.length,
  };
}

export async function uploadCatalogFile(file: File): Promise<void> {
  await apiUpload('/api/catalog/upload', file);
}

export interface UploadedPhoto {
  url: string;
  notionBlockId?: string;
  filename?: string;
}

/**
 * Sube una fotografía de expositor. El servidor intenta guardarla en Notion
 * (adjuntándola a `notionBlockId` o a la página padre) y, si no puede, la
 * deja en KV. La respuesta indica dónde quedó.
 */
export async function uploadExhibitorPhoto(
  file: File,
  options?: { notionBlockId?: string },
): Promise<UploadedPhoto> {
  const form = new FormData();
  form.append('file', file);
  if (options?.notionBlockId) form.append('notionBlockId', options.notionBlockId);
  return apiFetch<UploadedPhoto>('/api/uploads/photo', { method: 'POST', body: form });
}

export function catalogItemKey(item: CatalogItem): string {
  return item.id;
}
