import type { ShadowQuality } from '@/types/project';

/** Resolución de los mapas de sombra para cada nivel de calidad. */
export const SHADOW_MAP_SIZES: Record<ShadowQuality, number> = {
  low: 1024,
  medium: 2048,
  high: 4096,
};

export const SHADOW_QUALITY_OPTIONS: Array<{
  value: ShadowQuality;
  label: string;
  hint: string;
}> = [
  {
    value: 'low',
    label: 'Baja · 1024 px',
    hint: 'Más fluida en móviles y equipos modestos.',
  },
  {
    value: 'medium',
    label: 'Media · 2048 px',
    hint: 'Equilibrio recomendado entre nitidez y rendimiento.',
  },
  {
    value: 'high',
    label: 'Alta · 4096 px',
    hint: 'Bordes más nítidos; puede bajar los FPS en escenas grandes.',
  },
];

export function shadowMapSize(quality: ShadowQuality | undefined): number {
  return SHADOW_MAP_SIZES[quality ?? 'medium'];
}
