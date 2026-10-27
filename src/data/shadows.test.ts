import { describe, expect, it } from 'vitest';
import { SHADOW_QUALITY_OPTIONS, shadowMapSize } from './shadows';

describe('calidad de sombras', () => {
  it('asigna una resolución creciente a cada nivel', () => {
    expect(shadowMapSize('low')).toBe(1024);
    expect(shadowMapSize('medium')).toBe(2048);
    expect(shadowMapSize('high')).toBe(4096);
    expect(shadowMapSize(undefined)).toBe(2048);
  });

  it('ofrece las tres opciones en la interfaz', () => {
    expect(SHADOW_QUALITY_OPTIONS.map((option) => option.value)).toEqual([
      'low',
      'medium',
      'high',
    ]);
  });
});
