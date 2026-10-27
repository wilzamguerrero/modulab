import type { CatalogItem, PrimitiveShape } from '@/types/project';
import { PRIMITIVE_CATALOG } from '@/data/defaults';
import { apiGet, apiUpload } from '@/services/api';

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

export async function loadCatalog(): Promise<{ items: CatalogItem[]; directory: string; glbCount: number }> {
  const response = await apiGet<CatalogResponse>('/api/catalog');
  const glbItems: CatalogItem[] = response.items.map((item) => ({
    id: `glb:${item.id}`,
    name: item.name,
    category: item.category,
    url: item.url,
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

export async function uploadExhibitorPhoto(file: File): Promise<string> {
  const response = await apiUpload<{ url: string }>('/api/uploads/photo', file);
  return response.url;
}

export function catalogItemKey(item: CatalogItem): string {
  return item.id;
}
