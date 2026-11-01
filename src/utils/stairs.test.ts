import { describe, expect, it } from 'vitest';
import { createStair } from '@/data/defaults';
import {
  buildStairBoxes,
  stairFootprintBounds,
  stairFootprintRects,
  stairMetrics,
  transformStairPoint,
} from './stairs';

const top = (box: { position: number[]; size: number[] }) =>
  box.position[1] + box.size[1] / 2;

describe('stairs geometry', () => {
  it('reparte la altura entre los peldaños de una escalera recta', () => {
    const stair = createStair({ x: 0, z: 0 }, { steps: 10, rise: 2.5, tread: 0.3, railing: false });
    const metrics = stairMetrics(stair);
    expect(metrics.risePerStep).toBeCloseTo(0.25);
    expect(metrics.n1).toBe(10);
    expect(metrics.n2).toBe(0);
    const boxes = buildStairBoxes(stair);
    expect(boxes).toHaveLength(10);
    const last = boxes[boxes.length - 1];
    // Peldaño macizo apoyado en el suelo: llega desde la base hasta su huella.
    expect(last.position[1]).toBeCloseTo(2.5 / 2);
    expect(last.size[1]).toBeCloseTo(2.5);
    expect(top(last)).toBeCloseTo(2.5);
    expect(last.position[2]).toBeCloseTo(9 * 0.3 + 0.15);
  });

  it('genera pasamanos continuo y pies verticales, sin piezas sueltas', () => {
    const stair = createStair({ x: 0, z: 0 }, { steps: 8, rise: 2.4, railing: true });
    const boxes = buildStairBoxes(stair);
    const rails = boxes.filter((box) => box.rotation);
    const posts = boxes.filter((box) => !box.rotation && box.size[1] > 0.5 && box.size[0] < 0.1);
    expect(rails).toHaveLength(2);
    // Cada pasamanos cubre todo el tramo (longitud inclinada), no un peldaño.
    for (const rail of rails) {
      expect(rail.size[2]).toBeGreaterThan(stair.tread * 2);
    }
    expect(posts.length).toBeGreaterThanOrEqual(4);
    const risePerStep = stair.rise / stair.steps;
    for (const post of posts) {
      const base = post.position[1] - post.size[1] / 2;
      expect(base).toBeGreaterThanOrEqual(risePerStep - 1e-6);
      expect(base).toBeLessThanOrEqual(stair.rise + 1e-6);
      expect(top(post) - base).toBeCloseTo(0.95);
    }
  });

  it('todos los peldaños parten del suelo (sin soportes en el aire)', () => {
    for (const kind of ['straight', 'l', 'u'] as const) {
      const stair = createStair({ x: 0, z: 0 }, { kind, steps: 9, railing: false });
      const boxes = buildStairBoxes(stair);
      const solid = boxes.filter((box) => !box.rotation);
      for (const box of solid) {
        expect(box.position[1] - box.size[1] / 2).toBeCloseTo(0);
      }
    }
  });

  it('reparte los peldaños en dos tramos con descansillo en L', () => {
    const stair = createStair({ x: 0, z: 0 }, {
      kind: 'l',
      steps: 11,
      rise: 2.2,
      tread: 0.28,
      landingDepth: 1.2,
      railing: false,
    });
    const metrics = stairMetrics(stair);
    expect(metrics.n1).toBe(6);
    expect(metrics.n2).toBe(5);
    expect(metrics.landingHeight).toBeCloseTo((6 / 11) * 2.2);
    expect(metrics.run1).toBeCloseTo(6 * 0.28);
    const boxes = buildStairBoxes(stair);
    // Peldaños + descansillo (sin barandilla).
    expect(boxes).toHaveLength(11 + 1);
    const landing = boxes[metrics.n1];
    expect(landing.size[0]).toBeCloseTo(1);
    expect(landing.size[2]).toBeCloseTo(1.2);
    expect(landing.position[2]).toBeCloseTo(metrics.run1 + 1.2 / 2);
    expect(landing.position[1] - landing.size[1] / 2).toBeCloseTo(0);
    const rects = stairFootprintRects(stair);
    expect(rects).toHaveLength(3);
  });

  it('la escalera en U vuelve en sentido contrario por el lado paralelo', () => {
    const stair = createStair({ x: 0, z: 0 }, {
      kind: 'u',
      width: 1,
      steps: 10,
      tread: 0.25,
      landingDepth: 1,
      railing: false,
    });
    const metrics = stairMetrics(stair);
    const boxes = buildStairBoxes(stair);
    const secondFlight = boxes.filter((box) => box.position[0] > 0.75);
    expect(secondFlight.length).toBe(metrics.n2);
    for (const box of secondFlight) {
      expect(box.position[0]).toBeCloseTo(1);
    }
    const rects = stairFootprintRects(stair);
    expect(rects[1].x1 - rects[1].x0).toBeCloseTo(2);
  });

  it('al bajar, cada peldaño se apoya en el nivel inferior', () => {
    const stair = createStair({ x: 0, z: 0 }, {
      steps: 8,
      rise: 2.4,
      direction: 'down',
      railing: false,
    });
    const risePerStep = stair.rise / stair.steps;
    const boxes = buildStairBoxes(stair);
    // El último peldaño coincide con la planta inferior y no genera caja.
    expect(boxes).toHaveLength(stair.steps - 1);
    boxes.forEach((box, index) => {
      expect(top(box)).toBeCloseTo(-(index + 1) * risePerStep);
      expect(box.position[1] - box.size[1] / 2).toBeCloseTo(-stair.rise);
    });
  });

  it('transforma la huella con la rotación y la posición', () => {
    const stair = createStair({ x: 2, z: -1 }, { steps: 4, tread: 0.3, rotation: Math.PI / 2, railing: false });
    const point = transformStairPoint(stair, { x: 0, z: 1 });
    expect(point.x).toBeCloseTo(3);
    expect(point.z).toBeCloseTo(-1);
    const bounds = stairFootprintBounds(stair);
    expect(bounds.maxX).toBeGreaterThan(bounds.minX);
    expect(bounds.maxZ).toBeGreaterThan(bounds.minZ);
  });
});
