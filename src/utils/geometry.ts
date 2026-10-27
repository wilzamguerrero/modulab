import type { Vec2 } from '@/types/project';

const EPSILON = 1e-7;

export interface Bounds2D {
  minX: number;
  maxX: number;
  minZ: number;
  maxZ: number;
  width: number;
  depth: number;
  center: Vec2;
}

export interface PolygonValidation {
  valid: boolean;
  errors: string[];
  warnings: string[];
  area: number;
  selfIntersections: Array<[number, number]>;
}

export function polygonSignedArea(vertices: Vec2[]): number {
  if (vertices.length < 3) return 0;
  let sum = 0;
  for (let i = 0; i < vertices.length; i++) {
    const a = vertices[i];
    const b = vertices[(i + 1) % vertices.length];
    sum += a.x * b.z - b.x * a.z;
  }
  return sum / 2;
}

export function polygonArea(vertices: Vec2[]): number {
  return Math.abs(polygonSignedArea(vertices));
}

export function polygonCentroid(vertices: Vec2[]): Vec2 {
  if (vertices.length === 0) return { x: 0, z: 0 };
  if (vertices.length < 3) {
    const sum = vertices.reduce((acc, v) => ({ x: acc.x + v.x, z: acc.z + v.z }), { x: 0, z: 0 });
    return { x: sum.x / vertices.length, z: sum.z / vertices.length };
  }
  const signedArea = polygonSignedArea(vertices);
  if (Math.abs(signedArea) < EPSILON) {
    const sum = vertices.reduce((acc, v) => ({ x: acc.x + v.x, z: acc.z + v.z }), { x: 0, z: 0 });
    return { x: sum.x / vertices.length, z: sum.z / vertices.length };
  }
  let cx = 0;
  let cz = 0;
  for (let i = 0; i < vertices.length; i++) {
    const a = vertices[i];
    const b = vertices[(i + 1) % vertices.length];
    const cross = a.x * b.z - b.x * a.z;
    cx += (a.x + b.x) * cross;
    cz += (a.z + b.z) * cross;
  }
  return { x: cx / (6 * signedArea), z: cz / (6 * signedArea) };
}

export function polygonBounds(vertices: Vec2[]): Bounds2D {
  if (vertices.length === 0) {
    return { minX: -5, maxX: 5, minZ: -5, maxZ: 5, width: 10, depth: 10, center: { x: 0, z: 0 } };
  }
  let minX = Infinity;
  let maxX = -Infinity;
  let minZ = Infinity;
  let maxZ = -Infinity;
  for (const vertex of vertices) {
    minX = Math.min(minX, vertex.x);
    maxX = Math.max(maxX, vertex.x);
    minZ = Math.min(minZ, vertex.z);
    maxZ = Math.max(maxZ, vertex.z);
  }
  return {
    minX,
    maxX,
    minZ,
    maxZ,
    width: maxX - minX,
    depth: maxZ - minZ,
    center: { x: (minX + maxX) / 2, z: (minZ + maxZ) / 2 },
  };
}

export function edgeSegments(vertices: Vec2[]): Array<{ a: Vec2; b: Vec2; index: number }> {
  return vertices.map((a, index) => ({
    a,
    b: vertices[(index + 1) % vertices.length],
    index,
  }));
}

export function distance(a: Vec2, b: Vec2): number {
  return Math.hypot(a.x - b.x, a.z - b.z);
}

export function edgeLength(vertices: Vec2[], index: number): number {
  if (vertices.length < 2) return 0;
  return distance(vertices[index], vertices[(index + 1) % vertices.length]);
}

function orientation(a: Vec2, b: Vec2, c: Vec2): number {
  const value = (b.z - a.z) * (c.x - b.x) - (b.x - a.x) * (c.z - b.z);
  if (Math.abs(value) < EPSILON) return 0;
  return value > 0 ? 1 : -1;
}

function onSegment(a: Vec2, b: Vec2, c: Vec2): boolean {
  return (
    Math.min(a.x, b.x) - EPSILON <= c.x &&
    c.x <= Math.max(a.x, b.x) + EPSILON &&
    Math.min(a.z, b.z) - EPSILON <= c.z &&
    c.z <= Math.max(a.z, b.z) + EPSILON
  );
}

export function segmentsIntersect(a: Vec2, b: Vec2, c: Vec2, d: Vec2): boolean {
  const o1 = orientation(a, b, c);
  const o2 = orientation(a, b, d);
  const o3 = orientation(c, d, a);
  const o4 = orientation(c, d, b);
  if (o1 !== o2 && o3 !== o4) return true;
  if (o1 === 0 && onSegment(a, b, c)) return true;
  if (o2 === 0 && onSegment(a, b, d)) return true;
  if (o3 === 0 && onSegment(c, d, a)) return true;
  if (o4 === 0 && onSegment(c, d, b)) return true;
  return false;
}

export function findSelfIntersections(vertices: Vec2[]): Array<[number, number]> {
  const intersections: Array<[number, number]> = [];
  const n = vertices.length;
  if (n < 4) return intersections;
  for (let i = 0; i < n; i++) {
    const a = vertices[i];
    const b = vertices[(i + 1) % n];
    for (let j = i + 1; j < n; j++) {
      if (j === i || j === i + 1 || (i === 0 && j === n - 1)) continue;
      const c = vertices[j];
      const d = vertices[(j + 1) % n];
      if (segmentsIntersect(a, b, c, d)) intersections.push([i, j]);
    }
  }
  return intersections;
}

export function validatePolygon(vertices: Vec2[]): PolygonValidation {
  const errors: string[] = [];
  const warnings: string[] = [];
  if (vertices.length < 3) {
    errors.push('La planta necesita al menos 3 vértices.');
  }
  const n = vertices.length;
  for (let i = 0; i < n; i++) {
    const a = vertices[i];
    const b = vertices[(i + 1) % n];
    if (distance(a, b) < 0.01) {
      errors.push(`Hay dos vértices casi en el mismo punto (${i + 1} y ${((i + 1) % n) + 1}).`);
      break;
    }
  }
  const selfIntersections = findSelfIntersections(vertices);
  if (selfIntersections.length > 0) {
    errors.push('El contorno se cruza consigo mismo. Corrige los cruces antes de generar el piso.');
  }
  const area = polygonArea(vertices);
  if (vertices.length >= 3 && area < 0.05) {
    errors.push('El área de la planta es demasiado pequeña.');
  }
  if (vertices.length > 200) {
    errors.push('La planta tiene demasiados vértices (máximo 200).');
  }
  for (let i = 0; i < n; i++) {
    const prev = vertices[(i - 1 + n) % n];
    const current = vertices[i];
    const next = vertices[(i + 1) % n];
    if (orientation(prev, current, next) === 0 && distance(prev, current) > 0.01 && distance(current, next) > 0.01) {
      warnings.push(`El vértice ${i + 1} está alineado con sus vecinos.`);
    }
  }
  return { valid: errors.length === 0, errors, warnings, area, selfIntersections };
}

export function snapValue(value: number, step: number): number {
  if (!Number.isFinite(step) || step <= 0) return value;
  return Math.round(value / step) * step;
}

export function snapPoint(point: Vec2, step: number): Vec2 {
  return { x: snapValue(point.x, step), z: snapValue(point.z, step) };
}

export function distanceToSegment(point: Vec2, a: Vec2, b: Vec2): number {
  const dx = b.x - a.x;
  const dz = b.z - a.z;
  const lengthSquared = dx * dx + dz * dz;
  if (lengthSquared < EPSILON) return distance(point, a);
  const t = Math.max(0, Math.min(1, ((point.x - a.x) * dx + (point.z - a.z) * dz) / lengthSquared));
  return distance(point, { x: a.x + t * dx, z: a.z + t * dz });
}

export function closestPointOnSegment(point: Vec2, a: Vec2, b: Vec2): { point: Vec2; t: number } {
  const dx = b.x - a.x;
  const dz = b.z - a.z;
  const lengthSquared = dx * dx + dz * dz;
  if (lengthSquared < EPSILON) return { point: a, t: 0 };
  const t = Math.max(0, Math.min(1, ((point.x - a.x) * dx + (point.z - a.z) * dz) / lengthSquared));
  return { point: { x: a.x + t * dx, z: a.z + t * dz }, t };
}

export function nearestEdge(vertices: Vec2[], point: Vec2): { index: number; distance: number; point: Vec2 } | null {
  if (vertices.length < 2) return null;
  let best: { index: number; distance: number; point: Vec2 } | null = null;
  for (let i = 0; i < vertices.length; i++) {
    const a = vertices[i];
    const b = vertices[(i + 1) % vertices.length];
    const closest = closestPointOnSegment(point, a, b);
    const d = distance(point, closest.point);
    if (!best || d < best.distance) best = { index: i, distance: d, point: closest.point };
  }
  return best;
}

export function pointInPolygon(point: Vec2, vertices: Vec2[]): boolean {
  if (vertices.length < 3) return false;
  let inside = false;
  for (let i = 0, j = vertices.length - 1; i < vertices.length; j = i++) {
    const xi = vertices[i].x;
    const zi = vertices[i].z;
    const xj = vertices[j].x;
    const zj = vertices[j].z;
    const intersects = zi > point.z !== zj > point.z && point.x < ((xj - xi) * (point.z - zi)) / (zj - zi) + xi;
    if (intersects) inside = !inside;
  }
  return inside;
}

export function formatMeters(value: number, decimals = 2): string {
  return `${value.toFixed(decimals).replace(/\.?0+$/, '')} m`;
}

export function formatArea(value: number): string {
  return `${value.toFixed(1).replace(/\.0$/, '')} m²`;
}
