export function slugify(value: string): string {
  return value
    .normalize('NFD')
    .replace(/[\u0300-\u036f]/g, '')
    .toLowerCase()
    .replace(/[^a-z0-9]+/g, '-')
    .replace(/^-+|-+$/g, '')
    .slice(0, 60);
}

export function publicIdFor(name: string, id: string): string {
  const base = slugify(name) || 'espacio';
  const suffix = id.replace(/[^a-zA-Z0-9]/g, '').slice(-6).toLowerCase() || 'modulab';
  return `${base}-${suffix}`;
}
