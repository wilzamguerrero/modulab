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

describe('pasamanos apoyado en los peldaños', () => {
  it('la barra pasa por el centro de la pisada del primer y último peldaño', () => {
    const stair = createStair({ x: 0, z: 0 }, { steps: 10, rise: 2.5, tread: 0.3, railing: true });
    const boxes = buildStairBoxes(stair);
    const rails = boxes.filter((box) => box.rotation);
    expect(rails).toHaveLength(2);
    const risePerStep = 0.25;
    // Extremos en Z de cada barra (girada solo en X).
    for (const rail of rails) {
      const half = rail.size[2] / 2;
      const endZ = rail.position[2] + half * Math.cos(rail.rotation![0]);
      const startZ = rail.position[2] - half * Math.cos(rail.rotation![0]);
      const endY = rail.position[1] - half * Math.sin(rail.rotation![0]);
      const startY = rail.position[1] + half * Math.sin(rail.rotation![0]);
      // Primer peldaño: centro z = 0.15, superficie = 1 * risePerStep.
      expect(Math.min(startZ, endZ)).toBeCloseTo(0.15, 5);
      expect(Math.min(startY, endY)).toBeCloseTo(risePerStep + 0.95, 5);
    }
  });

  it('cada pie nace sobre la barra (misma pendiente), sin huecos ni solapes', () => {
    for (const kind of ['straight', 'l', 'u'] as const) {
      const stair = createStair({ x: 0, z: 0 }, { kind, steps: 10, rise: 3, railing: true });
      const boxes = buildStairBoxes(stair);
      const rails = boxes.filter((box) => box.rotation);
      const posts = boxes.filter((box) => !box.rotation && box.size[1] > 0.5 && box.size[0] < 0.1);
      expect(posts.length).toBeGreaterThanOrEqual(4);
      // La base de cada pie debe coincidir con la cota de su peldaño.
      const stepTops = boxes
        .filter((box) => !box.rotation && box.size[0] >= 0.1 && box.size[2] < stair.width * 3)
        .map((box) => box.position[1] + box.size[1] / 2);
      for (const post of posts) {
        const base = post.position[1] - post.size[1] / 2;
        expect(stepTops.some((top) => Math.abs(top - base) < 1e-6)).toBe(true);
      }
      expect(rails.length).toBeGreaterThanOrEqual(2);
    }
  });
});

describe('descansillos apoyados', () => {
  it('el descansillo de L y U llega desde la base hasta su superficie', () => {
    for (const kind of ['l', 'u'] as const) {
      const stair = createStair({ x: 0, z: 0 }, { kind, steps: 10, rise: 2.5, railing: false });
      const boxes = buildStairBoxes(stair);
      const metrics = stairMetrics(stair);
      const landing = boxes.find(
        (box) => !box.rotation
          && Math.abs(box.size[1] - metrics.landingHeight) < 1e-6
          && box.size[2] > stair.width * 1.05,
      );
      expect(landing).toBeDefined();
      expect(landing!.position[1] - landing!.size[1] / 2).toBeCloseTo(0);
    }
  });
});

describe('cada pie toca su pasamanos', () => {
  // Cota de la línea central de una barra girada sobre X o Z, en su tramo.
  const railHeightAt = (
    rail: { position: number[]; size: number[]; rotation?: number[] },
    x: number,
    z: number,
  ): number | null => {
    const rot = rail.rotation ?? [0, 0, 0];
    const dx = x - rail.position[0];
    const dz = z - rail.position[2];
    if (Math.abs(rot[2] ?? 0) > 1e-9) {
      // Barra sobre Z: el largo va en X. Rotar sobre Z sube +X.
      const angle = rot[2];
      const localX = dx / Math.cos(angle);
      if (Math.abs(localX) > rail.size[0] / 2 + 1e-6) return null;
      if (Math.abs(dz) > 0.06) return null;
      return rail.position[1] + localX * Math.sin(angle);
    }
    // Barra sobre X: el largo va en Z. Rotar sobre X baja +Z.
    const angle = rot[0] ?? 0;
    const localZ = dz / Math.cos(angle);
    if (Math.abs(localZ) > rail.size[2] / 2 + 1e-6) return null;
    if (Math.abs(dx) > 0.06) return null;
    return rail.position[1] - localZ * Math.sin(angle);
  };

  it.each(['straight', 'l', 'u'] as const)('en escalera %s cada pie nace y muere en la barra', (kind) => {
    const stair = createStair({ x: 0, z: 0 }, { kind, steps: 12, rise: 3, tread: 0.28, railing: true });
    const boxes = buildStairBoxes(stair);
    const rails = boxes.filter((box) => box.rotation);
    const posts = boxes.filter((box) => !box.rotation && box.size[1] > 0.5 && box.size[0] < 0.1);
    expect(rails.length).toBeGreaterThanOrEqual(2);
    expect(posts.length).toBeGreaterThanOrEqual(4);
    for (const post of posts) {
      const top = post.position[1] + post.size[1] / 2;
      const candidates = rails
        .map((rail) => railHeightAt(rail, post.position[0], post.position[2]))
        .filter((value): value is number => value !== null);
      expect(candidates.length).toBeGreaterThan(0);
      // La tapa del pie coincide con la línea central de la barra.
      expect(Math.min(...candidates.map((value) => Math.abs(value - top)))).toBeLessThan(1e-6);
    }
  });
});
