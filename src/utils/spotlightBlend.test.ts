import { describe, expect, it } from 'vitest';
import { easeSpotlight, stepSpotlightTarget } from './spotlightBlend';

describe('fundido del entorno al seleccionar un expositor', () => {
  it('avanza hacia el objetivo sin pasarse', () => {
    const next = stepSpotlightTarget(0, 1, 16, 0.6);
    expect(next).toBeGreaterThan(0);
    expect(next).toBeLessThan(1);
  });

  it('termina en el objetivo', () => {
    let value = 0;
    for (let i = 0; i < 600; i++) value = stepSpotlightTarget(value, 1, 16, 0.6);
    expect(value).toBe(1);
    for (let i = 0; i < 600; i++) value = stepSpotlightTarget(value, 0, 16, 0.6);
    expect(value).toBe(0);
  });

  it('una duración mayor llega más tarde', () => {
    const fast = stepSpotlightTarget(0, 1, 100, 0.3);
    const slow = stepSpotlightTarget(0, 1, 100, 2.4);
    expect(fast).toBeGreaterThan(slow);
  });

  it('con suavizado 0 el cambio es instantáneo', () => {
    expect(stepSpotlightTarget(0, 1, 16, 0)).toBe(1);
    expect(stepSpotlightTarget(1, 0, 16, 0)).toBe(0);
  });

  it('un fotograma largo no da un salto brusco', () => {
    const next = stepSpotlightTarget(0, 1, 5000, 1);
    expect(next).toBeGreaterThan(0);
    expect(next).toBeLessThan(1);
  });

  it('la mezcla suave va de 0 a 1 sin pasarse', () => {
    expect(easeSpotlight(0)).toBe(0);
    expect(easeSpotlight(1)).toBe(1);
    expect(easeSpotlight(0.5)).toBeCloseTo(0.5, 6);
    expect(easeSpotlight(-1)).toBe(0);
    expect(easeSpotlight(2)).toBe(1);
  });
});