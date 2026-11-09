import { describe, expect, it } from 'vitest';
import { breathFactor, buildTravelTimeline } from './travelMotion';

const CASES: [number, number][] = [
  [2200, 0],
  [2200, 500],
  [2200, 1000],
  [2200, 2000],
  [2200, 5000],
  [600, 2000],
  [6000, 10000],
];

const SAMPLE_COUNT = 4000;

function sampleProgress(travelMs: number, holdMs: number) {
  const timeline = buildTravelTimeline(travelMs, holdMs);
  const values: number[] = [];
  for (let index = 0; index <= SAMPLE_COUNT; index++) {
    values.push(timeline.progressAt((index / SAMPLE_COUNT) * timeline.duration));
  }
  return { timeline, values };
}

describe('ritmo del viaje de cámara', () => {
  it.each(CASES)('avanza sin retroceder ni saltar (viaje %i ms, pausa %i ms)', (travel, hold) => {
    const { values } = sampleProgress(travel, hold);
    let maxJump = 0;
    for (let index = 1; index < values.length; index++) {
      const jump = values[index] - values[index - 1];
      // Estrictamente creciente: la cámara jamás vuelve atrás.
      expect(jump).toBeGreaterThanOrEqual(-1e-9);
      maxJump = Math.max(maxJump, jump);
    }
    // Ningún fotograma recorre más del 1,5 % del camino: no hay teletransportes.
    expect(maxJump).toBeLessThan(0.015);
  });

  it.each(CASES)('termina exactamente en el destino (viaje %i ms, pausa %i ms)', (travel, hold) => {
    const { timeline } = sampleProgress(travel, hold);
    expect(timeline.progressAt(0)).toBe(0);
    expect(timeline.progressAt(timeline.duration)).toBe(1);
    expect(timeline.progressAt(timeline.duration * 2)).toBe(1);
  });

  it.each(CASES.filter(([, hold]) => hold > 0))(
    'la pausa se queda cerca de la vista aunque haya movimiento suave (viaje %i ms, pausa %i ms)',
    (travel, hold) => {
      const { timeline } = sampleProgress(travel, hold);
      const pauseStart = travel / 2;
      const pauseEnd = pauseStart + hold;
      const drift = timeline.progressAt(pauseEnd) - timeline.progressAt(pauseStart);
      // Avanza algo (no está congelada) pero poco (se queda en la vista).
      expect(drift).toBeGreaterThan(0.002);
      expect(drift).toBeLessThan(0.06);
    },
  );

  it.each(CASES.filter(([, hold]) => hold > 0))(
    'la velocidad es continua al entrar y salir de la pausa (viaje %i ms, pausa %i ms)',
    (travel, hold) => {
      const { timeline } = sampleProgress(travel, hold);
      const step = 4;
      const speedNear = (time: number) =>
        (timeline.progressAt(time + step) - timeline.progressAt(time - step)) / (2 * step);
      const pauseStart = travel / 2;
      const pauseEnd = pauseStart + hold;
      for (const edge of [pauseStart, pauseEnd]) {
        const before = speedNear(edge - 6);
        const after = speedNear(edge + 6);
        const reference = Math.max(Math.abs(before), Math.abs(after), 1e-6);
        // La velocidad no cambia de golpe en el borde de la pausa.
        expect(Math.abs(after - before) / reference).toBeLessThan(0.35);
      }
    },
  );

  it('sin pausa mantiene el ritmo de siempre', () => {
    const { timeline } = sampleProgress(2200, 0);
    expect(timeline.duration).toBe(2200);
    expect(timeline.progressAt(1100)).toBeCloseTo(0.5, 2);
  });

  it('la respiración no tiene saltos en los bordes de la pausa', () => {
    expect(breathFactor(0)).toBeCloseTo(0, 10);
    expect(breathFactor(1)).toBeCloseTo(0, 10);
    let previous = breathFactor(0);
    for (let index = 1; index <= 1000; index++) {
      const value = breathFactor(index / 1000);
      expect(Math.abs(value - previous)).toBeLessThan(0.02);
      previous = value;
    }
  });
});