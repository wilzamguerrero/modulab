export function createId(prefix = ''): string {
  const uuid =
    typeof globalThis.crypto?.randomUUID === 'function'
      ? globalThis.crypto.randomUUID()
      : `${Date.now().toString(36)}-${Math.random().toString(36).slice(2, 10)}`;
  return prefix ? `${prefix}_${uuid}` : uuid;
}

export function shortId(id: string, length = 6): string {
  return id.replace(/[^a-zA-Z0-9]/g, '').slice(-length).toLowerCase();
}
