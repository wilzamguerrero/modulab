/**
 * Movimiento de la cámara en el viaje entre expositores del visor público.
 *
 * El recorrido es una sola trayectoria continua: arranca desde la cámara
 * actual, pasa por la vista de lectura y termina en el expositor. Este módulo
 * se ocupa solo del *ritmo* (qué fracción del camino se lleva recorrida en cada
 * instante).
 *
 * El viaje se divide en tres tramos que comparten la misma velocidad en sus
 * bordes:
 *
 *   1. vuelo hasta la vista: arranca a velocidad 0 y llega a la pausa ya en
 *      marcha;
 *   2. pausa: la cámara cruza la vista despacio, a velocidad constante, así
 *      que entra y sale sin ningún frenón;
 *   3. vuelo hasta el expositor: sale a esa misma velocidad y frena al llegar.
 *
 * Cada tramo es un polinomio de Hermite con pendientes compatibles, por lo que
 * la velocidad es continua: no hay cortes entre «venir», «quedarse» y «seguir».
 */

/**
 * Fracción del camino que se recorre durante la pausa. No es 0: la cámara se
 * mueve despacio en la vista (nunca se congela), pero se queda ahí.
 */
const HOLD_DRIFT = 0.04;

/**
 * Avance normalizado (0 → 1) para un viaje sin pausa: acelera desde 0 y frena
 * al final.
 */
export function smoothProgress(value: number): number {
  const clamped = Math.min(1, Math.max(0, value));
  return clamped < 0.5 ? 4 * clamped ** 3 : 1 - (-2 * clamped + 2) ** 3 / 2;
}

/**
 * Tramo de Hermite: de `from` a `to` con las pendientes dadas en los extremos
 * (en unidades de avance por unidad de `u`). Con pendiente 0 en un extremo,
 * frena suave; con pendientes iguales a la media, avanza en línea.
 */
function hermite(
  from: number,
  slopeFrom: number,
  to: number,
  slopeTo: number,
  u: number,
): number {
  const u2 = u * u;
  const u3 = u2 * u;
  return (
    (2 * u3 - 3 * u2 + 1) * from +
    (u3 - 2 * u2 + u) * slopeFrom +
    (-2 * u3 + 3 * u2) * to +
    (u3 - u2) * slopeTo
  );
}

export interface TravelTimeline {
  /** Duración total del viaje (vuelo + pausa), en milisegundos. */
  duration: number;
  /**
   * Fracción del camino recorrida en `elapsed` milisegundos (0 → 1, siempre
   * creciente y continua).
   */
  progressAt(elapsed: number): number;
}

/**
 * Construye el ritmo del viaje.
 *
 * - `travelMs`: parte del tiempo dedicada al vuelo (sin contar la pausa).
 * - `holdMs`: tiempo que la cámara se queda en la vista. 0 = sin pausa.
 */
export function buildTravelTimeline(travelMs: number, holdMs: number): TravelTimeline {
  const travel = Math.max(1, travelMs);
  const hold = Math.max(0, holdMs);
  const duration = travel + hold;

  if (hold <= 0) {
    return { duration, progressAt: (elapsed) => smoothProgress(elapsed / travel) };
  }

  // Mitad del tiempo de vuelo para cada lado de la pausa.
  const leg = travel / 2;
  // Punto del camino en el que empieza y acaba la pausa: centrados en la vista.
  const drift = Math.min(HOLD_DRIFT, 0.5);
  const entry = 0.5 - drift / 2;
  const exit = 0.5 + drift / 2;
  // Velocidad en los bordes de la pausa (fracción del camino por milisegundo).
  // Al ser la misma en los tres tramos, no hay salto de velocidad.
  const pauseSpeed = drift / hold;

  return {
    duration,
    progressAt(elapsed: number) {
      if (elapsed <= 0) return 0;
      if (elapsed >= duration) return 1;

      if (elapsed < leg) {
        // Sale con velocidad 0 y llega a la pausa con `pauseSpeed`.
        const u = elapsed / leg;
        return hermite(0, 0, entry, pauseSpeed * leg, u);
      }

      if (elapsed < leg + hold) {
        // Velocidad constante: ni frena al entrar ni arranca al salir.
        const u = (elapsed - leg) / hold;
        return hermite(entry, pauseSpeed * hold, exit, pauseSpeed * hold, u);
      }

      // Sale con `pauseSpeed` y frena al llegar al expositor.
      const u = (elapsed - leg - hold) / leg;
      return hermite(exit, pauseSpeed * leg, 1, 0, u);
    },
  };
}

/**
 * Elevación de la cámara durante la pausa (factor de -1 a 1).
 *
 * Vale exactamente 0 al empezar y al terminar la pausa, y sube y baja una vez
 * en medio: un movimiento de respiración que se suma al vuelo sin ningún
 * salto.
 */
export function breathFactor(pauseProgress: number): number {
  const clamped = Math.min(1, Math.max(0, pauseProgress));
  // El seno al cuadrado garantiza entrar y salir a 0; el coseno marca la
  // subida y la bajada.
  return Math.sin(clamped * Math.PI) ** 2 * Math.cos(clamped * Math.PI * 2);
}