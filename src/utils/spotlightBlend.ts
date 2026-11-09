/**
 * Fundido del entorno hacia el color neutro cuando se elige un expositor.
 *
 * El visor no cambia los materiales de golpe: guarda un progreso 0→1 y cada
 * fotograma lo acerca al objetivo. Al deseleccionar el progreso vuelve a 0,
 * así la escena recupera sus colores igual de suave.
 */

/** Segundos en los que el progreso recorre el 63 % del camino restante. */
export const SPOTLIGHT_TIME_CONSTANT = 0.22;

/**
 * Avanza el progreso hacia el objetivo. `dt` en milisegundos; una duración
 * de 0 (o negativa) corta el fundido y salta directo al objetivo.
 */
export function stepSpotlightTarget(
  current: number,
  target: number,
  dtMs: number,
  durationSeconds: number,
): number {
  const clamped = Math.max(0, Math.min(1, target));
  if (durationSeconds <= 0 || dtMs <= 0) return clamped;
  // Un paso nunca dura más de 100 ms: si la pestaña estuvo en segundo plano,
  // al volver el cambio termina sin un salto.
  const dt = Math.min(dtMs, 100) / 1000;
  // Más duración = menos velocidad de acercamiento al objetivo.
  const rate = 1 / Math.max(0.02, durationSeconds * SPOTLIGHT_TIME_CONSTANT);
  const next = current + (clamped - current) * (1 - Math.exp(-rate * dt));
  return Math.abs(clamped - next) < 0.0005 ? clamped : next;
}

/** Mezcla suave (ease-in-out) para interpolar colores del fundido. */
export function easeSpotlight(progress: number): number {
  const t = Math.max(0, Math.min(1, progress));
  return t * t * (3 - 2 * t);
}