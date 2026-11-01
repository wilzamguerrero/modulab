import type { Bounds2D } from './geometry';
import type { Level, Project, SceneObject, Space, Stair, Vec2 } from '@/types/project';
import { pointInPolygon, polygonBounds } from './geometry';

/** Niveles ordenados de abajo hacia arriba. */
export function sortedLevels(project: Project): Level[] {
  return [...project.levels].sort((a, b) => a.elevation - b.elevation);
}

export function getLevel(project: Project, levelId?: string | null): Level | undefined {
  if (!levelId) return project.levels[0];
  return project.levels.find((level) => level.id === levelId) ?? project.levels[0];
}

export function getSpace(level: Level | undefined, spaceId?: string | null): Space | undefined {
  if (!level) return undefined;
  if (!spaceId) return level.spaces[0];
  return level.spaces.find((space) => space.id === spaceId) ?? level.spaces[0];
}

export function defaultLevelId(project: Project): string | null {
  return sortedLevels(project)[0]?.id ?? project.levels[0]?.id ?? null;
}

export function levelElevation(project: Project, levelId?: string | null): number {
  if (!levelId) return 0;
  return project.levels.find((level) => level.id === levelId)?.elevation ?? 0;
}

/** Mapa id de nivel → elevación, útil para colocar objetos y marcadores. */
export function levelElevationMap(project: Project): Record<string, number> {
  const map: Record<string, number> = {};
  for (const level of project.levels) map[level.id] = level.elevation;
  return map;
}

/** Vértices de todos los espacios con contorno válido del nivel. */
export function levelVertices(level: Level | undefined): Vec2[] {
  if (!level) return [];
  const space = level.spaces.find((entry) => entry.vertices.length >= 3);
  return space?.vertices ?? [];
}

/** Lista plana de vértices de todos los espacios (para snapping/encaje). */
export function levelAllVertices(level: Level | undefined): Vec2[] {
  if (!level) return [];
  return level.spaces.flatMap((space) => space.vertices);
}

export function levelBounds(level: Level | undefined): Bounds2D {
  if (!level) return polygonBounds([]);
  const points = level.spaces
    .filter((space) => space.vertices.length >= 3)
    .flatMap((space) => space.vertices);
  if (!points.length) return polygonBounds([]);
  let minX = Infinity;
  let maxX = -Infinity;
  let minZ = Infinity;
  let maxZ = -Infinity;
  for (const point of points) {
    minX = Math.min(minX, point.x);
    maxX = Math.max(maxX, point.x);
    minZ = Math.min(minZ, point.z);
    maxZ = Math.max(maxZ, point.z);
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

/** Bounds de todo el proyecto en planta (para cámara, sombras y encuadres). */
export function projectBounds(project: Project): Bounds2D {
  const points = project.levels
    .flatMap((level) => level.spaces)
    .filter((space) => space.vertices.length >= 3)
    .flatMap((space) => space.vertices);
  if (!points.length) return polygonBounds([]);
  let minX = Infinity;
  let maxX = -Infinity;
  let minZ = Infinity;
  let maxZ = -Infinity;
  for (const point of points) {
    minX = Math.min(minX, point.x);
    maxX = Math.max(maxX, point.x);
    minZ = Math.min(minZ, point.z);
    maxZ = Math.max(maxZ, point.z);
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

/** Primer espacio del nivel que contiene el punto. */
export function spaceAtPoint(level: Level | undefined, point: Vec2): Space | undefined {
  if (!level) return undefined;
  return level.spaces.find(
    (space) => space.vertices.length >= 3 && pointInPolygon(point, space.vertices),
  );
}

export function pointInLevel(level: Level | undefined, point: Vec2): boolean {
  return Boolean(spaceAtPoint(level, point));
}

/** Elevación sugerida para un nivel nuevo por encima o por debajo. */
export function suggestLevelElevation(
  project: Project,
  direction: 'above' | 'below',
  gap = 3,
): number {
  if (!project.levels.length) return direction === 'above' ? 0 : -gap;
  const elevations = project.levels.map((level) => level.elevation);
  const height = Math.max(gap, project.defaultWall.height + 0.2);
  return direction === 'above'
    ? Math.max(...elevations) + height
    : Math.min(...elevations) - height;
}

export function objectsForLevel(project: Project, levelId: string | null | undefined): SceneObject[] {
  const fallback = defaultLevelId(project);
  return project.objects.filter((object) => (object.levelId ?? fallback) === levelId);
}

/** Nivel de un objeto/expositor; si no tiene, el primero del proyecto. */
export function entityLevelId(
  project: Project,
  entity: { levelId?: string | null },
): string | null {
  const valid = project.levels.some((level) => level.id === entity.levelId);
  return valid ? entity.levelId ?? null : defaultLevelId(project);
}

/**
 * Escalera con la altura real del salto entre niveles: al subir llega al
 * suelo del nivel superior; al bajar, al del nivel inferior.
 */
export function fitStairToLevels(project: Project, level: Level, stair: Stair): Stair {
  const floor = level.elevation;
  const target = stair.direction === 'down'
    ? project.levels
        .filter((entry) => entry.elevation < floor - 0.2)
        .sort((a, b) => b.elevation - a.elevation)[0]
    : project.levels
        .filter((entry) => entry.elevation > floor + 0.2)
        .sort((a, b) => a.elevation - b.elevation)[0];
  if (!target) return stair;
  const rise = Math.abs(target.elevation - floor);
  return { ...stair, rise: Math.min(30, Math.max(0.2, rise)) };
}
