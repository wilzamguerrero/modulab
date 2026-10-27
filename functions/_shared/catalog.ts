import type { Env } from './env';

export interface CatalogEntry {
  id: string;
  name: string;
  category: string;
  file: string;
  url: string;
  sizeBytes: number;
  modifiedAt: string;
}

/**
 * En Cloudflare no se puede escanear el sistema de archivos. El build genera
 * `public/catalog/manifest.json` (ver scripts/build-catalog-manifest.mjs) y
 * aquí lo leemos como asset estático.
 */
export async function scanCatalog(
  request: Request,
  env: Env,
): Promise<{ items: CatalogEntry[]; directory: string; count: number }> {
  let items: CatalogEntry[] = [];
  try {
    if (env.ASSETS) {
      const res = await env.ASSETS.fetch(new URL('/catalog/manifest.json', request.url).toString());
      if (res.ok) {
        const data = (await res.json()) as { items?: CatalogEntry[] };
        if (Array.isArray(data.items)) items = data.items;
      }
    }
  } catch {
    // Sin manifest: catálogo vacío.
  }

  items = items
    .slice()
    .sort((a, b) => a.category.localeCompare(b.category, 'es') || a.name.localeCompare(b.name, 'es'));

  return { items, directory: 'catalog', count: items.length };
}
