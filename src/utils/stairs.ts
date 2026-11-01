import type { Stair, Vec2 } from '@/types/project';

/**
 * Geometría de escaleras. Sistema local: el origen es la base del primer
 * tramo (centrado en el ancho), el ascenso va hacia +Z y el ancho en X.
 * El grupo 3D aplica `position` + `rotation` del elemento.
 *
 * Cada peldaño se genera como un bloque macizo desde el suelo hasta su
 * contrahuella, de modo que la escalera queda apoyada (sin piezas flotantes).
 * Las barandillas se dibujan como pasamanos continuos inclinados con pies
 * verticales, no como piezas sueltas por peldaño.
 */

export interface StairBox {
  position: [number, number, number];
  size: [number, number, number];
  rotation?: [number, number, number];
}

export interface StairFootprintRect {
  x0: number;
  z0: number;
  x1: number;
  z1: number;
}

export interface StairMetrics {
  /** Altura de cada escalón. */
  risePerStep: number;
  /** Escalones del primer y segundo tramo (0 en escaleras rectas). */
  n1: number;
  n2: number;
  run1: number;
  run2: number;
  landingHeight: number;
  landingDepth: number;
  /** Profundidad total del primer tramo (para dibujar la flecha). */
  totalRun: number;
}

const RAIL_HEIGHT = 0.95;
const RAIL_THICKNESS = 0.05;
const POST_THICKNESS = 0.04;

export function stairMetrics(stair: Stair): StairMetrics {
  const steps = Math.max(2, Math.round(stair.steps));
  if (stair.kind === 'straight') {
    return {
      risePerStep: stair.rise / steps,
      n1: steps,
      n2: 0,
      run1: steps * stair.tread,
      run2: 0,
      landingHeight: stair.rise,
      landingDepth: 0,
      totalRun: steps * stair.tread,
    };
  }
  const n1 = Math.ceil(steps / 2);
  const n2 = steps - n1;
  return {
    risePerStep: stair.rise / steps,
    n1,
    n2,
    run1: n1 * stair.tread,
    run2: n2 * stair.tread,
    landingHeight: n1 * (stair.rise / steps),
    landingDepth: Math.max(stair.landingDepth, 0.2),
    totalRun: n1 * stair.tread + Math.max(stair.landingDepth, 0.2),
  };
}

/**
 * Cajas (peldaños macizos, descansillo, soportes y barandillas) en
 * coordenadas locales de la escalera.
 */
export function buildStairBoxes(stair: Stair): StairBox[] {
  const metrics = stairMetrics(stair);
  const width = stair.width;
  const tread = stair.tread;
  const { risePerStep, n1, n2, run1, landingDepth } = metrics;
  const descending = stair.direction === 'down';
  // El peldaño k (0..steps-1) tiene esta cota de pisada. Al bajar, las
  // pisadas descienden desde el nivel hasta la planta inferior.
  const surfaceAt = (k: number) => (descending ? -(k + 1) : k + 1) * risePerStep;
  const baseY = descending ? -stair.rise : 0;
  const boxes: StairBox[] = [];
  const half = width / 2;
  const railOffset = Math.max(half - 0.05, 0.05);

  const add = (
    position: [number, number, number],
    size: [number, number, number],
    rotation?: [number, number, number],
  ) => {
    if (size[0] <= 1e-4 || size[1] <= 1e-4 || size[2] <= 1e-4) return;
    boxes.push(rotation ? { position, size, rotation } : { position, size });
  };

  // Peldaño macizo desde la base hasta su pisada (estructura apoyada).
  const step = (
    centerX: number,
    centerZ: number,
    sizeX: number,
    sizeZ: number,
    surface: number,
  ) => {
    const height = surface - baseY;
    if (height <= 1e-4) return;
    add([centerX, baseY + height / 2, centerZ], [sizeX, height, sizeZ]);
  };

  // Pasamanos continuo inclinado. `deltaSurface` va firmado (positivo si sube).
  const rail = (
    x: number,
    z: number,
    horizontalRun: number,
    deltaSurface: number,
    startSurface: number,
    axis: 'z+' | 'z-' | 'x+',
  ) => {
    if (!stair.railing || horizontalRun <= 1e-4) return;
    const length = Math.hypot(horizontalRun, Math.abs(deltaSurface));
    const angle = Math.atan2(deltaSurface, horizontalRun);
    const centerY = startSurface + deltaSurface / 2 + RAIL_HEIGHT;
    if (axis === 'z+') {
      add([x, centerY, z], [RAIL_THICKNESS, RAIL_THICKNESS, length], [-angle, 0, 0]);
    } else if (axis === 'z-') {
      add([x, centerY, z], [RAIL_THICKNESS, RAIL_THICKNESS, length], [angle, 0, 0]);
    } else {
      add([x, centerY, z], [length, RAIL_THICKNESS, RAIL_THICKNESS], [0, 0, -angle]);
    }
  };

  const posts = (points: Array<{ x: number; z: number; surface: number }>) => {
    if (!stair.railing) return;
    for (const point of points) {
      add(
        [point.x, point.surface + RAIL_HEIGHT / 2, point.z],
        [POST_THICKNESS, RAIL_HEIGHT, POST_THICKNESS],
      );
    }
  };

  // Primer tramo: avanza en +Z desde z = 0.
  const flightAPosts: Array<{ x: number; z: number; surface: number }> = [];
  for (let index = 0; index < n1; index += 1) {
    const surface = surfaceAt(index);
    const z = index * tread + tread / 2;
    step(0, z, width, tread, surface);
    if (index % 3 === 0 || index === n1 - 1) {
      flightAPosts.push({ x: -railOffset, z, surface });
      flightAPosts.push({ x: railOffset, z, surface });
    }
  }
  {
    const start = surfaceAt(0);
    const delta = surfaceAt(n1 - 1) - start;
    rail(-railOffset, run1 / 2, run1, delta, start, 'z+');
    rail(railOffset, run1 / 2, run1, delta, start, 'z+');
    posts(flightAPosts);
  }

  if (stair.kind === 'straight') return boxes;

  const landingZ0 = run1;
  const landingZ1 = run1 + landingDepth;
  const landingCenterZ = (landingZ0 + landingZ1) / 2;
  const landingWidth = stair.kind === 'u' ? width * 2 : width;
  const landingCenterX = stair.kind === 'u' ? width / 2 : 0;
  const landingSurface = surfaceAt(n1 - 1);

  // Descansillo macizo apoyado en la base.
  {
    const height = landingSurface - baseY;
    if (height > 1e-4) {
      add(
        [landingCenterX, baseY + height / 2, landingCenterZ],
        [landingWidth, height, landingDepth],
      );
    }
  }

  if (stair.kind === 'l') {
    // Segundo tramo: gira +X desde el borde del descansillo.
    const startX = half;
    const flightBPosts: Array<{ x: number; z: number; surface: number }> = [];
    for (let index = 0; index < n2; index += 1) {
      const surface = surfaceAt(n1 + index);
      const x = startX + index * tread + tread / 2;
      step(x, landingCenterZ, tread, width, surface);
      if (index % 3 === 0 || index === n2 - 1) {
        flightBPosts.push({ x, z: landingCenterZ - railOffset, surface });
        flightBPosts.push({ x, z: landingCenterZ + railOffset, surface });
      }
    }
    if (n2 > 0 && stair.railing) {
      const start = surfaceAt(n1);
      const delta = surfaceAt(n1 + n2 - 1) - start;
      rail(startX + metrics.run2 / 2, landingCenterZ - railOffset, metrics.run2, delta, start, 'x+');
      rail(startX + metrics.run2 / 2, landingCenterZ + railOffset, metrics.run2, delta, start, 'x+');
      posts(flightBPosts);
    }
  } else {
    // Segundo tramo en U: vuelve en -Z por el lado paralelo.
    const centerX = width;
    const startZ = landingZ1;
    const flightBPosts: Array<{ x: number; z: number; surface: number }> = [];
    for (let index = 0; index < n2; index += 1) {
      const surface = surfaceAt(n1 + index);
      const z = startZ - index * tread - tread / 2;
      step(centerX, z, width, tread, surface);
      if (index % 3 === 0 || index === n2 - 1) {
        flightBPosts.push({ x: centerX - railOffset, z, surface });
        flightBPosts.push({ x: centerX + railOffset, z, surface });
      }
    }
    if (n2 > 0 && stair.railing) {
      const start = surfaceAt(n1);
      const delta = surfaceAt(n1 + n2 - 1) - start;
      rail(centerX - railOffset, startZ - metrics.run2 / 2, metrics.run2, delta, start, 'z-');
      rail(centerX + railOffset, startZ - metrics.run2 / 2, metrics.run2, delta, start, 'z-');
      posts(flightBPosts);
    }
  }

  return boxes;
}

/** Rectángulos de la huella en planta (coordenadas locales). */
export function stairFootprintRects(stair: Stair): StairFootprintRect[] {
  const metrics = stairMetrics(stair);
  const half = stair.width / 2;
  const tread = stair.tread;
  if (stair.kind === 'straight') {
    return [{ x0: -half, z0: 0, x1: half, z1: metrics.n1 * tread }];
  }
  const landingZ0 = metrics.run1;
  const landingZ1 = metrics.run1 + metrics.landingDepth;
  if (stair.kind === 'l') {
    return [
      { x0: -half, z0: 0, x1: half, z1: landingZ0 },
      { x0: -half, z0: landingZ0, x1: half, z1: landingZ1 },
      {
        x0: half,
        z0: landingZ0 + metrics.landingDepth / 2 - half,
        x1: half + metrics.run2,
        z1: landingZ0 + metrics.landingDepth / 2 + half,
      },
    ];
  }
  return [
    { x0: -half, z0: 0, x1: half, z1: landingZ0 },
    { x0: -half, z0: landingZ0, x1: half * 3, z1: landingZ1 },
    { x0: half, z0: landingZ1 - metrics.run2, x1: half * 3, z1: landingZ1 },
  ];
}

/** Convierte un punto local de la escalera a coordenadas de planta. */
export function transformStairPoint(stair: Stair, point: Vec2): Vec2 {
  const cos = Math.cos(stair.rotation);
  const sin = Math.sin(stair.rotation);
  return {
    x: point.x * cos + point.z * sin + stair.position.x,
    z: -point.x * sin + point.z * cos + stair.position.z,
  };
}

/** Rectángulo de planta que cubre un hueco dibujado (para cortar el suelo). */
export function stairHoleRect(stair: Stair, margin = 0.08): Vec2[] {
  const bounds = stairFootprintBounds(stair);
  return [
    { x: bounds.minX - margin, z: bounds.minZ - margin },
    { x: bounds.maxX + margin, z: bounds.minZ - margin },
    { x: bounds.maxX + margin, z: bounds.maxZ + margin },
    { x: bounds.minX - margin, z: bounds.maxZ + margin },
  ];
}

export function stairFootprintBounds(stair: Stair): {
  minX: number;
  maxX: number;
  minZ: number;
  maxZ: number;
  center: Vec2;
} {
  let minX = Infinity;
  let maxX = -Infinity;
  let minZ = Infinity;
  let maxZ = -Infinity;
  for (const rect of stairFootprintRects(stair)) {
    for (const corner of [
      { x: rect.x0, z: rect.z0 },
      { x: rect.x1, z: rect.z0 },
      { x: rect.x1, z: rect.z1 },
      { x: rect.x0, z: rect.z1 },
    ]) {
      const point = transformStairPoint(stair, corner);
      minX = Math.min(minX, point.x);
      maxX = Math.max(maxX, point.x);
      minZ = Math.min(minZ, point.z);
      maxZ = Math.max(maxZ, point.z);
    }
  }
  return {
    minX,
    maxX,
    minZ,
    maxZ,
    center: { x: (minX + maxX) / 2, z: (minZ + maxZ) / 2 },
  };
}

export function stairTopHeight(stair: Stair): number {
  return stair.rise;
}
