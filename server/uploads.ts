import fs from 'node:fs';
import path from 'node:path';
import multer from 'multer';
import { UPLOADS_DIR, ensureDataDirs } from './config';

function sanitizeFilename(name: string): string {
  const extension = path.extname(name).toLowerCase() || '.jpg';
  const base = path
    .basename(name, path.extname(name))
    .normalize('NFD')
    .replace(/[\u0300-\u036f]/g, '')
    .replace(/[^a-zA-Z0-9._-]/g, '-')
    .replace(/-+/g, '-')
    .trim()
    .slice(0, 80);
  return `${base || 'imagen'}-${Date.now()}${extension}`;
}

export function createUploadsMiddleware() {
  ensureDataDirs();
  const storage = multer.diskStorage({
    destination: (_req, _file, cb) => {
      ensureDataDirs();
      cb(null, UPLOADS_DIR);
    },
    filename: (_req, file, cb) => cb(null, sanitizeFilename(file.originalname)),
  });
  return multer({
    storage,
    limits: { fileSize: 15 * 1024 * 1024 },
    fileFilter: (_req, file, cb) => {
      if (file.mimetype.startsWith('image/')) cb(null, true);
      else cb(new Error('Solo se aceptan imágenes.'));
    },
  });
}

export function uploadsDir(): string {
  ensureDataDirs();
  return UPLOADS_DIR;
}

export function listUploads(): string[] {
  try {
    return fs.readdirSync(UPLOADS_DIR).filter((name) => !name.startsWith('.'));
  } catch {
    return [];
  }
}
