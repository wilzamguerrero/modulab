import { describe, expect, it } from 'vitest';
import { defaultExhibitorCamera, isExhibitorCameraUsable } from './defaults';
import { getTemplate } from './templates';
import type { Vec2 } from '@/types/project';
import { distanceToSegment, pointInPolygon } from '@/utils/geometry';

function wallClearance(point: Vec2, vertices: Vec2[]): number {
  let clearance = Number.POSITIVE_INFINITY;
  for (let index = 0; index < vertices.length; index++) {
    clearance = Math.min(
      clearance,
      distanceToSegment(point, vertices[index], vertices[(index + 1) % vertices.length]),
    );
  }
  return clearance;
}

const insideCases: Array<{ label: string; template: 'rectangle' | 'l-shape' | 't-shape' | 'u-shape'; position: Vec2 }> = [
  { label: 'barra central de la T', template: 't-shape', position: { x: 0, z: -0.676 } },
  { label: 'extremo de la barra de la T', template: 't-shape', position: { x: -4.5, z: -1 } },
  { label: 'vástago de la T', template: 't-shape', position: { x: 0, z: 3.8 } },
  { label: 'esquina de la L', template: 'l-shape', position: { x: -3, z: -2 } },
  { label: 'ala de la L', template: 'l-shape', position: { x: 3, z: -2 } },
  { label: 'brazo de la U', template: 'u-shape', position: { x: -4.5, z: 3 } },
  { label: 'borde del rectángulo', template: 'rectangle', position: { x: 0, z: 3.7 } },
  { label: 'centro del rectángulo', template: 'rectangle', position: { x: 0, z: 0 } },
];

describe('cámara sugerida de expositor', () => {
  it.each(insideCases)('queda dentro y a 3,5 m en $label', ({ template, position }) => {
    const vertices = getTemplate(template).vertices;
    const camera = defaultExhibitorCamera(position, vertices);
    const cameraPoint = { x: camera.position[0], z: camera.position[2] };
    const distance = Math.hypot(cameraPoint.x - position.x, cameraPoint.z - position.z);

    expect(pointInPolygon(cameraPoint, vertices)).toBe(true);
    expect(isExhibitorCameraUsable(camera.position, vertices)).toBe(true);
    expect(wallClearance(cameraPoint, vertices)).toBeGreaterThanOrEqual(0.45);
    expect(distance).toBeCloseTo(3.5, 2);
  });

  it('usa una vista elevada cuando la planta es demasiado estrecha', () => {
    const tiny: Vec2[] = [
      { x: -1, z: -1 },
      { x: 1, z: -1 },
      { x: 1, z: 1 },
      { x: -1, z: 1 },
    ];
    const camera = defaultExhibitorCamera({ x: 0, z: 0 }, tiny);

    expect(camera.position[1]).toBeGreaterThan(2.8);
    expect(camera.target).toEqual([0, 0.8, 0]);
  });

  it('usa una vista elevada si el marcador está fuera del recinto', () => {
    const uShape = getTemplate('u-shape').vertices;
    const position = { x: 0, z: 3 };
    const camera = defaultExhibitorCamera(position, uShape);

    expect(camera.position[1]).toBeGreaterThan(2.8);
    expect(camera.target[0]).toBe(position.x);
    expect(camera.target[2]).toBe(position.z);
  });

  it('rechaza cámaras fuera de la planta o pegadas a un muro', () => {
    const rectangle = getTemplate('rectangle').vertices;
    expect(isExhibitorCameraUsable([0, 1.9, 0], rectangle)).toBe(true);
    expect(isExhibitorCameraUsable([0, 1.9, 5.5], rectangle)).toBe(false);
    expect(isExhibitorCameraUsable([4.9, 1.9, 0], rectangle)).toBe(false);
  });
});
