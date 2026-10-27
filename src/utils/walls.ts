import type { EdgeConfig, InternalWall, Project, Vec2, WallOpening } from '@/types/project';

export type WallTarget =
  | { type: 'edge'; index: number }
  | { type: 'internalWall'; id: string };

export interface WallDefinition {
  id: string;
  target: WallTarget;
  a: Vec2;
  b: Vec2;
  height: number;
  thickness: number;
  color: string;
  exhibitorId?: string | null;
  edge?: EdgeConfig;
  internalWall?: InternalWall;
}

export interface OpeningSpan {
  opening: WallOpening;
  start: number;
  end: number;
  center: number;
  width: number;
  sill: number;
  top: number;
}

export interface WallPiece {
  start: number;
  length: number;
  bottom: number;
  height: number;
}

export function wallLength(a: Vec2, b: Vec2): number {
  return Math.hypot(b.x - a.x, b.z - a.z);
}

export function wallDirection(a: Vec2, b: Vec2): { x: number; z: number; length: number } {
  const length = wallLength(a, b);
  if (length <= 1e-8) return { x: 1, z: 0, length: 0 };
  return { x: (b.x - a.x) / length, z: (b.z - a.z) / length, length };
}

export function getWalls(project: Project): WallDefinition[] {
  const walls: WallDefinition[] = [];
  project.edges.forEach((edge, index) => {
    if (!edge.wall) return;
    const a = project.floor.vertices[index];
    const b = project.floor.vertices[(index + 1) % project.floor.vertices.length];
    if (!a || !b) return;
    walls.push({
      id: edge.id,
      target: { type: 'edge', index },
      a,
      b,
      height: edge.height,
      thickness: edge.thickness,
      color: edge.color,
      exhibitorId: edge.exhibitorId ?? null,
      edge,
    });
  });
  for (const wall of project.internalWalls) {
    walls.push({
      id: wall.id,
      target: { type: 'internalWall', id: wall.id },
      a: wall.a,
      b: wall.b,
      height: wall.height,
      thickness: wall.thickness,
      color: wall.color,
      exhibitorId: wall.exhibitorId ?? null,
      internalWall: wall,
    });
  }
  return walls;
}

export function getWallById(project: Project, wallId: string): WallDefinition | undefined {
  const edgeIndex = project.edges.findIndex((edge) => edge.id === wallId);
  if (edgeIndex >= 0) {
    const edge = project.edges[edgeIndex];
    const a = project.floor.vertices[edgeIndex];
    const b = project.floor.vertices[(edgeIndex + 1) % project.floor.vertices.length];
    if (!a || !b) return undefined;
    return {
      id: edge.id,
      target: { type: 'edge', index: edgeIndex },
      a,
      b,
      height: edge.height,
      thickness: edge.thickness,
      color: edge.color,
      exhibitorId: edge.exhibitorId ?? null,
      edge,
    };
  }
  const internalWall = project.internalWalls.find((wall) => wall.id === wallId);
  if (!internalWall) return undefined;
  return {
    id: internalWall.id,
    target: { type: 'internalWall', id: internalWall.id },
    a: internalWall.a,
    b: internalWall.b,
    height: internalWall.height,
    thickness: internalWall.thickness,
    color: internalWall.color,
    exhibitorId: internalWall.exhibitorId ?? null,
    internalWall,
  };
}

export function getWallOpenings(project: Project, wallId: string): WallOpening[] {
  return project.openings.filter((opening) => opening.wallId === wallId);
}

/** Proyecta un punto sobre el muro y devuelve la distancia desde su inicio. */
export function pointOffsetOnWall(point: Vec2, a: Vec2, b: Vec2): number {
  const direction = wallDirection(a, b);
  if (!direction.length) return 0;
  const offset = (point.x - a.x) * direction.x + (point.z - a.z) * direction.z;
  return Math.max(0, Math.min(direction.length, offset));
}

export function pointAtWallOffset(a: Vec2, b: Vec2, offset: number): Vec2 {
  const direction = wallDirection(a, b);
  return {
    x: a.x + direction.x * offset,
    z: a.z + direction.z * offset,
  };
}

/**
 * Normaliza las aberturas de un muro. Las aberturas que se solapan se recortan
 * para que la geometría nunca genere piezas duplicadas.
 */
export function getOpeningSpans(
  length: number,
  height: number,
  openings: WallOpening[],
): OpeningSpan[] {
  if (length <= 0) return [];
  const spans = openings
    .map((opening) => {
      const width = Math.max(0.2, Math.min(opening.width, length));
      const center = Math.max(
        width / 2,
        Math.min(length - width / 2, Number.isFinite(opening.offset) ? opening.offset : width / 2),
      );
      const start = Math.max(0, Math.min(length - width, center - width / 2));
      const end = Math.min(length, start + width);
      const sill = Math.max(0, Math.min(opening.sillHeight, Math.max(0, height - 0.2)));
      const top = Math.min(height, sill + Math.max(0.2, opening.height));
      return {
        opening,
        start,
        end,
        center: (start + end) / 2,
        width: Math.max(0, end - start),
        sill,
        top,
      };
    })
    .filter((span) => span.end > span.start)
    .sort((a, b) => a.start - b.start);

  let cursor = 0;
  const result: OpeningSpan[] = [];
  for (const span of spans) {
    if (span.end <= cursor + 1e-6) continue;
    const start = Math.max(span.start, cursor);
    const end = span.end;
    if (end <= start + 1e-6) continue;
    result.push({
      ...span,
      start,
      end,
      center: (start + end) / 2,
      width: end - start,
    });
    cursor = end;
  }
  return result;
}

/** Tramos macizos del muro, útiles para dibujar la planta en 2D. */
export function getSolidRanges(length: number, openings: WallOpening[]): Array<{ start: number; end: number }> {
  const spans = getOpeningSpans(length, 20, openings);
  const ranges: Array<{ start: number; end: number }> = [];
  let cursor = 0;
  for (const span of spans) {
    if (span.start > cursor) ranges.push({ start: cursor, end: span.start });
    cursor = Math.max(cursor, span.end);
  }
  if (cursor < length) ranges.push({ start: cursor, end: length });
  return ranges;
}

/**
 * Divide un muro en cajas alrededor de sus aberturas. Devuelve piezas en
 * coordenadas locales a lo largo del muro; la escena las coloca en 3D.
 */
export function getWallPieces(length: number, height: number, openings: WallOpening[]): WallPiece[] {
  if (length <= 0 || height <= 0) return [];
  const spans = getOpeningSpans(length, height, openings);
  const pieces: WallPiece[] = [];
  let cursor = 0;
  for (const span of spans) {
    if (span.start > cursor + 1e-6) {
      pieces.push({ start: cursor, length: span.start - cursor, bottom: 0, height });
    }
    if (span.sill > 0.001) {
      pieces.push({
        start: span.start,
        length: span.width,
        bottom: 0,
        height: span.sill,
      });
    }
    if (span.top < height - 0.001) {
      pieces.push({
        start: span.start,
        length: span.width,
        bottom: span.top,
        height: height - span.top,
      });
    }
    cursor = Math.max(cursor, span.end);
  }
  if (cursor < length - 1e-6) {
    pieces.push({ start: cursor, length: length - cursor, bottom: 0, height });
  }
  return pieces.filter((piece) => piece.length > 1e-5 && piece.height > 1e-5);
}
