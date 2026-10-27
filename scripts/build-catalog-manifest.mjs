import fs from 'node:fs';
import path from 'node:path';
import { fileURLToPath } from 'node:url';

const root = path.resolve(path.dirname(fileURLToPath(import.meta.url)), '..');
const catalogDir = path.join(root, 'public', 'catalog');
const outFile = path.join(catalogDir, 'manifest.json');

if (!fs.existsSync(catalogDir)) {
  console.log('[modulab] No existe public/catalog; se omite el manifest.');
  process.exit(0);
}

const items = [];

function walk(dir) {
  let entries;
  try {
    entries = fs.readdirSync(dir, { withFileTypes: true });
  } catch {
    return;
  }
  for (const entry of entries) {
    if (entry.name.startsWith('.')) continue;
    const absolute = path.join(dir, entry.name);
    if (entry.isDirectory()) {
      walk(absolute);
      continue;
    }
    const ext = path.extname(entry.name).toLowerCase();
    if (ext !== '.glb' && ext !== '.gltf') continue;
    const relative = path.relative(catalogDir, absolute).split(path.sep).join('/');
    const segments = relative.split('/');
    const category = segments.length > 1 ? segments.slice(0, -1).join(' / ') : 'General';
    let sizeBytes = 0;
    let modifiedAt = '';
    try {
      const stats = fs.statSync(absolute);
      sizeBytes = stats.size;
      modifiedAt = stats.mtime.toISOString();
    } catch {
      // Sin estadísticas.
    }
    items.push({
      id: relative,
      name: path.basename(entry.name, path.extname(entry.name)),
      category,
      file: relative,
      url: `/catalog/${segments.map((segment) => encodeURIComponent(segment)).join('/')}`,
      sizeBytes,
      modifiedAt,
    });
  }
}

walk(catalogDir);
items.sort((a, b) => a.category.localeCompare(b.category, 'es') || a.name.localeCompare(b.name, 'es'));

fs.writeFileSync(outFile, JSON.stringify({ generatedAt: new Date().toISOString(), items }, null, 2));
console.log(`[modulab] Manifest de catálogo: ${items.length} modelo(s) en public/catalog/manifest.json.`);
