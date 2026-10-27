/**
 * Evita que el clic de fin de arrastre (gizmo o tiradores) se propague al piso
 * y deseleccione el elemento. R3F entrega el clic a todos los objetos
 * intersectados bajo el puntero, incluido el piso detrás del gizmo.
 */
let active = false;
let releasedAt = 0;

export function markSceneDragActive(): void {
  active = true;
}

export function markSceneDragEnd(): void {
  active = false;
  releasedAt = typeof performance !== 'undefined' ? performance.now() : Date.now();
}

export function isSceneDragClickBlocked(windowMs = 300): boolean {
  if (active) return true;
  const now = typeof performance !== 'undefined' ? performance.now() : Date.now();
  return now - releasedAt < windowMs;
}
