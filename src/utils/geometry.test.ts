import { describe, expect, it } from 'vitest';
import {
  closestPointOnSegment,
  edgeLength,
  findSelfIntersections,
  pointInPolygon,
  polygonArea,
  polygonBounds,
  polygonCentroid,
  snapValue,
  validatePolygon,
} from './geometry';
import type { Vec2 } from '@/types/project';

const rectangle: Vec2[] = [
  { x: 0, z: 0 },
  { x: 4, z: 0 },
  { x: 4, z: 3 },
  { x: 0, z: 3 },
];

const tShape: Vec2[] = [
  { x: -6, z: -4 },
  { x: 6, z: -4 },
  { x: 6, z: 0 },
  { x: 2, z: 0 },
  { x: 2, z: 5 },
  { x: -2, z: 5 },
  { x: -2, z: 0 },
  { x: -6, z: 0 },
];

describe('geometry', () => {
  it('calcula el área de un rectángulo', () => {
    expect(polygonArea(rectangle)).toBeCloseTo(12, 5);
  });

  it('calcula el área de una planta en T', () => {
    // Barra superior 12 x 4 = 48, tallo 4 x 5 = 20.
    expect(polygonArea(tShape)).toBeCloseTo(68, 5);
  });

  it('calcula el centro y los límites', () => {
    expect(polygonCentroid(rectangle)).toEqual({ x: 2, z: 1.5 });
    const bounds = polygonBounds(rectangle);
    expect(bounds.width).toBe(4);
    expect(bounds.depth).toBe(3);
    expect(bounds.center).toEqual({ x: 2, z: 1.5 });
  });

  it('valida plantas simples y detecta autointersecciones', () => {
    expect(validatePolygon(rectangle).valid).toBe(true);
    expect(validatePolygon(tShape).valid).toBe(true);
    const crossed: Vec2[] = [
      { x: 0, z: 0 },
      { x: 4, z: 4 },
      { x: 4, z: 0 },
      { x: 0, z: 4 },
    ];
    expect(findSelfIntersections(crossed)).toHaveLength(1);
    expect(validatePolygon(crossed).valid).toBe(false);
  });

  it('rechaza polígonos con menos de tres vértices o área mínima', () => {
    expect(validatePolygon([]).valid).toBe(false);
    expect(validatePolygon([{ x: 0, z: 0 }, { x: 1, z: 1 }]).valid).toBe(false);
    expect(validatePolygon([{ x: 0, z: 0 }, { x: 0.1, z: 0 }, { x: 0, z: 0.1 }]).valid).toBe(false);
  });

  it('calcula longitudes y puntos sobre segmentos', () => {
    expect(edgeLength(rectangle, 0)).toBeCloseTo(4, 5);
    const closest = closestPointOnSegment({ x: 2, z: 2 }, { x: 0, z: 0 }, { x: 4, z: 0 });
    expect(closest.point).toEqual({ x: 2, z: 0 });
    expect(closest.t).toBeCloseTo(0.5, 5);
  });

  it('detecta puntos dentro del polígono', () => {
    expect(pointInPolygon({ x: 2, z: 1.5 }, rectangle)).toBe(true);
    expect(pointInPolygon({ x: 10, z: 10 }, rectangle)).toBe(false);
  });

  it('ajusta valores a la cuadrícula', () => {
    expect(snapValue(1.13, 0.25)).toBe(1.25);
    expect(snapValue(1.1, 0.25)).toBe(1);
  });
});
