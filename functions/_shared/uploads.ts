export const PHOTO_PREFIX = 'upload:';

export function photoKey(filename: string): string {
  return `${PHOTO_PREFIX}${filename}`;
}

export function sanitizePhotoName(name: string): string {
  const dot = name.lastIndexOf('.');
  const extension = (dot >= 0 ? name.slice(dot) : '.jpg').toLowerCase() || '.jpg';
  const raw = dot >= 0 ? name.slice(0, dot) : name;
  const base = raw
    .normalize('NFD')
    .replace(/[̀-ͯ]/g, '')
    .replace(/[^a-zA-Z0-9._-]/g, '-')
    .replace(/-+/g, '-')
    .trim()
    .slice(0, 80);
  return `${base || 'imagen'}-${Date.now()}${extension}`;
}
