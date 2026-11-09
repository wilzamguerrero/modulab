import type { AccessKind, AccessPoint } from '@/types/project';

/** Color con el que se dibuja un acceso cuando no tiene uno propio. */
export const DEFAULT_ACCESS_COLOR = '#34d399';

/** Etiqueta por defecto de cada tipo de acceso. */
export const ACCESS_KIND_LABELS: Record<AccessKind, string> = {
  entrance: 'Entrada',
  exit: 'Salida',
  both: 'Entrada y salida',
};

/** Color sugerido al crear cada tipo de acceso. */
export const ACCESS_KIND_COLORS: Record<AccessKind, string> = {
  entrance: '#34d399',
  exit: '#f87171',
  both: '#fbbf24',
};

export function accessKindLabel(kind: AccessKind): string {
  return ACCESS_KIND_LABELS[kind] ?? ACCESS_KIND_LABELS.entrance;
}

export function accessColor(
  access: Pick<AccessPoint, 'color' | 'kind'> | null | undefined,
): string {
  return access?.color || ACCESS_KIND_COLORS[access?.kind ?? 'entrance'] || DEFAULT_ACCESS_COLOR;
}

/**
 * Título visible del acceso. Si el usuario no escribió una etiqueta propia se
 * usa el nombre del tipo («Entrada», «Salida», «Entrada y salida»).
 */
export function accessTitle(access: Pick<AccessPoint, 'name' | 'kind'>): string {
  return access.name?.trim() || accessKindLabel(access.kind);
}

/** Si la etiqueta repite el tipo, no hace falta mostrarlo dos veces. */
export function accessShowsKindLabel(
  access: Pick<AccessPoint, 'name' | 'kind'>,
): boolean {
  return accessTitle(access) !== accessKindLabel(access.kind);
}

/** Icono textual que resume el tipo en listas y etiquetas. */
export function accessKindShort(access: Pick<AccessPoint, 'kind'>): string {
  switch (access.kind) {
    case 'exit':
      return 'Salida';
    case 'both':
      return 'Entrada y salida';
    default:
      return 'Entrada';
  }
}
