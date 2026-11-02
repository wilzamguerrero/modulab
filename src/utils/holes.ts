import type { Level, Project, Space, SpaceHole } from '@/types/project';
import { polygonArea, polygonBounds } from './geometry';
import { sortedLevels } from './levels';

export interface HoleEntry {
  hole: SpaceHole;
  level: Level;
  space: Space;
  area: number;
  center: { x: number; z: number };
  width: number;
  depth: number;
}

/**
 * Todos los cortes de suelo del proyecto, ordenados por nivel y por posición.
 * Sirve para listarlos en el panel (como expositores o luces) y poder
 * seleccionarlos sin tener que acertar el trazo fino en la vista de planta.
 */
export function collectHoles(project: Project): HoleEntry[] {
  const entries: HoleEntry[] = [];
  for (const level of [...project.levels].sort((a, b) => a.elevation - b.elevation)) {
    for (const space of level.spaces) {
      for (const hole of space.holes) {
        const bounds = polygonBounds(hole.vertices);
        entries.push({
          hole,
          level,
          space,
          area: polygonArea(hole.vertices),
          center: bounds.center,
          width: bounds.width,
          depth: bounds.depth,
        });
      }
    }
  }
  return entries;
}

/** Cortes del nivel activo (los que afectan a la planta que se está viendo). */
export function holesOfLevel(project: Project, levelId: string | null | undefined): HoleEntry[] {
  const level = sortedLevels(project).find((entry) => entry.id === levelId);
  if (!level) return [];
  return collectHoles(project).filter((entry) => entry.level.id === level.id);
}

/** Cortes del espacio activo. */
export function holesOfSpace(entries: HoleEntry[], spaceId: string | null | undefined): HoleEntry[] {
  if (!spaceId) return entries;
  return entries.filter((entry) => entry.space.id === spaceId);
}