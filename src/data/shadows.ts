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

/**
 * Sesgo de normal para mapas de sombra, expresado en múltiplos de la "texel"
 * del mapa (tamaño en metros de un píxel proyectado).
 *
 * Un valor absoluto fijo no funciona: con un frustum de 60 m y 1024 px cada
 * texel mide ~6 cm y las mallas de los GLB (que suelen traer geometría muy
 * fina) se sombrean a sí mismas, produciendo el rayado horizontal típico del
 * shadow acne. Al escalar el sesgo con el texel, el artefacto desaparece a
 * cualquier calidad y tamaño de recinto.
 */
export const SHADOW_NORMAL_BIAS_TEXELS = 1.5;

/** Sesgo de profundidad mínimo, en unidades del mapa de sombra. */
export const SHADOW_DEPTH_BIAS = -0.0005;

/**
 * Convierte la extensión del frustum ortográfico y la resolución del mapa en
 * un sesgo de normal en metros.
 */
export function shadowNormalBias(
  halfExtent: number,
  mapSize: number,
  texels = SHADOW_NORMAL_BIAS_TEXELS,
): number {
  const safeMap = Math.max(512, mapSize);
  const metersPerTexel = (halfExtent * 2) / safeMap;
  // Tope de 25 cm: por encima, las sombras se despegan del objeto
  // (peter-panning) y se nota más que el propio acne.
  return Math.min(metersPerTexel * texels, 0.25);
}
