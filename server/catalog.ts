import fs from 'node:fs';
import path from 'node:path';
import multer from 'multer';
import { resolveCatalogDir } from './config';

export interface CatalogEntry {
  id: string;
  name: string;
  category: string;
  file: string;
  url: string;
  sizeBytes: number;
  modifiedAt: string;
}

function walk(dir: string, root: string, out: CatalogEntry[]): void {
  let entries: fs.Dirent[];
  try {
    entries = fs.readdirSync(dir, { withFileTypes: true });
  } catch {
    return;
  }
  for (const entry of entries) {
    if (entry.name.startsWith('.')) continue;
    const absolute = path.join(dir, entry.name);
    if (entry.isDirectory()) {
      walk(absolute, root, out);
      continue;
    }
    const ext = path.extname(entry.name).toLowerCase();
    if (ext !== '.glb' && ext !== '.gltf') continue;
    const relative = path.relative(root, absolute).split(path.sep).join('/');
    const segments = relative.split('/');
    const category = segments.length > 1 ? segments.slice(0, -1).join(' / ') : 'General';
    let stats: fs.Stats | undefined;
    try {
      stats = fs.statSync(absolute);
    } catch {
      // Sin estadísticas; se usa lo que haya.
    }
    out.push({
      id: relative,
      name: path.basename(entry.name, path.extname(entry.name)),
      category,
      file: relative,
      url: `/catalog/${segments.map((segment) => encodeURIComponent(segment)).join('/')}`,
      sizeBytes: stats?.size ?? 0,
      modifiedAt: stats?.mtime.toISOString() ?? '',
    });
  }
}

export function scanCatalog(): { items: CatalogEntry[]; directory: string } {
  const directory = resolveCatalogDir();
  const items: CatalogEntry[] = [];
  walk(directory, directory, items);
  items.sort((a, b) => a.category.localeCompare(b.category, 'es') || a.name.localeCompare(b.name, 'es'));
  return { items, directory };
}

function sanitizeFilename(name: string): string {
  const extension = path.extname(name).toLowerCase();
  const base = path
    .basename(name, path.extname(name))
    .normalize('NFD')
    .replace(/[\u0300-\u036f]/g, '')
    .replace(/[^a-zA-Z0-9 ._()\-]/g, '-')
    .replace(/\s+/g, ' ')
    .replace(/-+/g, '-')
    .trim()
    .slice(0, 120);
  return `${base || 'modelo'}${extension}`;
}

export function createCatalogUpload() {
  const directory = resolveCatalogDir();
  fs.mkdirSync(directory, { recursive: true });
  const storage = multer.diskStorage({
    destination: (_req, _file, cb) => cb(null, directory),
    filename: (_req, file, cb) => {
      const safe = sanitizeFilename(file.originalname);
      const extension = path.extname(safe);
      const base = path.basename(safe, extension);
      let candidate = safe;
      let counter = 2;
      while (fs.existsSync(path.join(directory, candidate))) {
        candidate = `${base}-${counter}${extension}`;
        counter++;
      }
      cb(null, candidate);
    },
  });
  return multer({
    storage,
    limits: { fileSize: 300 * 1024 * 1024 },
    fileFilter: (_req, file, cb) => {
      const ext = path.extname(file.originalname).toLowerCase();
      if (ext === '.glb' || ext === '.gltf') {
        cb(null, true);
      } else {
        cb(new Error('Solo se aceptan archivos .glb o .gltf.'));
      }
    },
  });
}
