import polygonClipping from 'polygon-clipping';
import type { Vec2 } from '@/types/project';

export interface FloorPiece {
  /** Contorno exterior de una pieza de forjado. */
  outer: Vec2[];
  /** Huecos interiores de esa pieza. */
  holes: Vec2[][];
}

const EPSILON = 1e-6;

function samePoint(a: Vec2, b: Vec2): boolean {
  return Math.abs(a.x - b.x) < EPSILON && Math.abs(a.z - b.z) < EPSILON;
}

function toRing(points: Vec2[]): Array<[number, number]> {
  const ring: Array<[number, number]> = [];
  for (const point of points) {
    const next: [number, number] = [point.x, point.z];
    const last = ring[ring.length - 1];
    if (last && Math.abs(last[0] - next[0]) < EPSILON && Math.abs(last[1] - next[1]) < EPSILON) {
      continue;
    }
    ring.push(next);
  }
  // polygon-clipping cierra los anillos él mismo; se evita duplicar el primero.
  if (ring.length > 1) {
    const first = ring[0];
    const last = ring[ring.length - 1];
    if (Math.abs(first[0] - last[0]) < EPSILON && Math.abs(first[1] - last[1]) < EPSILON) {
      ring.pop();
    }
  }
  return ring;
}

function fromRing(ring: Array<[number, number]>): Vec2[] {
  // Se descarta el punto de cierre si polygon-clipping lo añadió.
  const points = ring.map(([x, z]) => ({ x, z }));
  if (points.length > 2 && samePoint(points[0], points[points.length - 1])) points.pop();
  return points;
}

/**
 * Planta del forjado ya recortada: resta los huecos del contorno del espacio.
 *
 * Es importante restarlos de verdad (operación booleana) y no solo pasarlos como
 * agujeros al extruido: un hueco apoyado justo en el borde del forjado no puede
 * quedar "tapiado" por una franja mínima de losa, tiene que abrir ese lado por
 * completo. Además, un corte que cruza el forjado puede partirlo en varias
 * piezas, algo que un agujero simple no puede representar.
 *
 * Devuelve `null` cuando la operación falla o no queda nada (por ejemplo, un
 * corte que se come todo el forjado).
 */
export function clipFloorPieces(vertices: Vec2[], holes: Vec2[][] = []): FloorPiece[] | null {
  if (vertices.length < 3) return null;
  const outer = toRing(vertices);
  if (outer.length < 3) return null;

  const usableHoles = holes
    .map((hole) => toRing(hole))
    .filter((ring) => ring.length >= 3);

  if (usableHoles.length === 0) {
    return [{ outer: fromRing(outer), holes: [] }];
  }

  let result: Array<Array<Array<[number, number]>>>;
  try {
    result = polygonClipping.difference(
      [outer],
      ...usableHoles.map((ring) => [ring]),
    ) as Array<Array<Array<[number, number]>>>;
  } catch {
    return null;
  }

  const pieces: FloorPiece[] = [];
  for (const polygon of result) {
    if (!polygon.length) continue;
    const [first, ...rest] = polygon;
    const piece: FloorPiece = {
      outer: fromRing(first),
      holes: rest.map(fromRing).filter((ring) => ring.length >= 3),
    };
    if (piece.outer.length < 3) continue;
    pieces.push(piece);
  }
  return pieces.length ? pieces : null;
}

/** Área total de las piezas devueltas por `clipFloorPieces`. */
export function floorPiecesArea(pieces: FloorPiece[]): number {
  const ringArea = (ring: Vec2[]) => {
    let sum = 0;
    for (let index = 0; index < ring.length; index += 1) {
      const a = ring[index];
      const b = ring[(index + 1) % ring.length];
      sum += a.x * b.z - b.x * a.z;
    }
    return Math.abs(sum / 2);
  };
  return pieces.reduce(
    (total, piece) => total
      + ringArea(piece.outer)
      - piece.holes.reduce((inner, hole) => inner + ringArea(hole), 0),
    0,
  );
}