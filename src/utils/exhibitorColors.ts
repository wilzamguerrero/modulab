import type { Exhibitor, Project } from '@/types/project';

export const DEFAULT_EXHIBITOR_COLOR = '#7dd3fc';

function parseHex(value: string): [number, number, number] {
  const clean = value.trim().replace(/^#/, '');
  const expanded =
    clean.length === 3
      ? clean
          .split('')
          .map((part) => `${part}${part}`)
          .join('')
      : clean;
  const parsed = Number.parseInt(expanded, 16);
  if (!Number.isFinite(parsed) || expanded.length !== 6) return [255, 255, 255];
  return [(parsed >> 16) & 255, (parsed >> 8) & 255, parsed & 255];
}

function toHex(value: number): string {
  return Math.round(Math.max(0, Math.min(255, value)))
    .toString(16)
    .padStart(2, '0');
}

export function exhibitorColor(exhibitor: Pick<Exhibitor, 'color'> | null | undefined): string {
  return exhibitor?.color || DEFAULT_EXHIBITOR_COLOR;
}

/** Mezcla dos colores hexadecimales. `amount` 0 deja la base intacta. */
export function mixHexColors(base: string, tint: string, amount: number): string {
  const ratio = Math.max(0, Math.min(1, Number.isFinite(amount) ? amount : 0));
  if (ratio <= 0) return base;
  const [br, bg, bb] = parseHex(base);
  const [tr, tg, tb] = parseHex(tint);
  return `#${toHex(br + (tr - br) * ratio)}${toHex(bg + (tg - bg) * ratio)}${toHex(bb + (tb - bb) * ratio)}`;
}

export function hexToRgba(value: string, alpha: number): string {
  const [r, g, b] = parseHex(value);
  const safeAlpha = Math.max(0, Math.min(1, Number.isFinite(alpha) ? alpha : 1));
  return `rgba(${r}, ${g}, ${b}, ${safeAlpha})`;
}

export function findExhibitor(
  project: Pick<Project, 'exhibitors'>,
  exhibitorId: string | null | undefined,
): Exhibitor | undefined {
  if (!exhibitorId) return undefined;
  return project.exhibitors.find((exhibitor) => exhibitor.id === exhibitorId);
}

/**
 * Devuelve cuánto debe teñirse un elemento con el color de su expositor.
 * La selección explícita de una ficha siempre resalta sus elementos, aunque
 * el proyecto esté configurado solo con aros.
 */
export function exhibitorPaintAmount(
  project: Pick<Project, 'settings' | 'exhibitors'>,
  exhibitorId: string | null | undefined,
  selectedExhibitorId?: string | null,
): number {
  if (!exhibitorId || !findExhibitor(project, exhibitorId)) return 0;
  const selected = selectedExhibitorId === exhibitorId;
  const mode = project.settings.exhibitorColorMode ?? 'rings';
  const paintEnabled = mode === 'paint' || mode === 'both';
  const opacity = Math.max(0, Math.min(1, project.settings.exhibitorColorOpacity ?? 0.35));
  if (selected) return Math.max(paintEnabled ? opacity : 0, 0.55);
  return paintEnabled ? opacity : 0;
}

export function paintedExhibitorColor(
  project: Pick<Project, 'settings' | 'exhibitors'>,
  exhibitorId: string | null | undefined,
  baseColor: string,
  selectedExhibitorId?: string | null,
): string {
  const exhibitor = findExhibitor(project, exhibitorId);
  const amount = exhibitorPaintAmount(project, exhibitorId, selectedExhibitorId);
  if (!exhibitor || amount <= 0) return baseColor;
  return mixHexColors(baseColor, exhibitorColor(exhibitor), amount);
}
