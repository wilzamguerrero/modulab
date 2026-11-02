import { describe, expect, it } from 'vitest';
import { createLevel, createProject, createSpace, createStair } from '@/data/defaults';
import type { Project } from '@/types/project';
import {
  fitStairToLevels,
  entityLevelId,
  getLevel,
  getSpace,
  levelAllVertices,
  levelBounds,
  levelVertices,
  pointInLevel,
  projectBounds,
  sortedLevels,
  spaceAtPoint,
  suggestLevelElevation,
} from './levels';

const square = [
  { x: 0, z: 0 },
  { x: 4, z: 0 },
  { x: 4, z: 4 },
  { x: 0, z: 4 },
];

function tower() {
  const project = createProject({ name: 'Torre' });
  const upper = createLevel('Nivel 2', 3, {
    spaces: [
      createSpace([
        { x: 10, z: 0 },
        { x: 14, z: 0 },
        { x: 14, z: 4 },
        { x: 10, z: 4 },
      ]),
    ],
  });
  project.levels.push(upper);
  return project;
}

describe('level helpers', () => {
  it('ordena los niveles por elevación', () => {
    const project = tower();
    const sorted = sortedLevels(project);
    expect(sorted[0].elevation).toBe(0);
    expect(sorted[1].elevation).toBe(3);
  });

  it('calcula bounds por nivel y del proyecto completo', () => {
    const project = tower();
    const ground = levelBounds(project.levels[0]);
    expect(ground.width).toBeCloseTo(10);
    const all = projectBounds(project);
    expect(all.minX).toBeCloseTo(-5);
    expect(all.maxX).toBeCloseTo(14);
  });

  it('detecta el espacio que contiene un punto', () => {
    const project = tower();
    const upper = project.levels[1];
    expect(spaceAtPoint(upper, { x: 12, z: 2 })?.id).toBe(upper.spaces[0].id);
    expect(pointInLevel(upper, { x: 12, z: 2 })).toBe(true);
    expect(pointInLevel(upper, { x: 0, z: 0 })).toBe(false);
  });

  it('devuelve vértices de un nivel con varios espacios', () => {
    const level = createLevel('L', 0, {
      spaces: [createSpace([]), createSpace(square)],
    });
    expect(levelVertices(level)).toHaveLength(4);
    expect(levelAllVertices(level)).toHaveLength(4);
  });

  it('usa el nivel por defecto cuando la entidad no tiene uno válido', () => {
    const project = tower();
    const fallback = project.levels[0].id;
    expect(entityLevelId(project, { levelId: undefined })).toBe(fallback);
    expect(entityLevelId(project, { levelId: 'no-existe' })).toBe(fallback);
    expect(entityLevelId(project, { levelId: project.levels[1].id })).toBe(project.levels[1].id);
  });

  it('sugiere elevaciones por encima y por debajo', () => {
    const project = tower();
    expect(suggestLevelElevation(project, 'above')).toBeGreaterThan(3);
    expect(suggestLevelElevation(project, 'below')).toBeLessThan(0);
  });

  it('resuelve nivel y espacio por id con reserva al primero', () => {
    const project = tower();
    expect(getLevel(project, 'no-existe')?.id).toBe(project.levels[0].id);
    const upper = project.levels[1];
    expect(getSpace(upper, 'no-existe')?.id).toBe(upper.spaces[0].id);
  });
});

describe('fitStairToLevels', () => {
  it('ajusta la altura de la escalera al nivel superior real', () => {
    const base = { id: 'a', name: 'PB', elevation: 0, rotation: 0, spaces: [], internalWalls: [], openings: [], stairs: [], visible: true };
    const upper = { ...base, id: 'b', name: 'P1', elevation: 3.4 };
    const project = { levels: [base, upper] } as unknown as Project;
    const stair = createStair({ x: 0, z: 0 }, { rise: 2.8, direction: 'up' });
    expect(fitStairToLevels(project, base, stair).rise).toBeCloseTo(3.4);
  });

  it('al bajar usa el nivel inferior', () => {
    const base = { id: 'a', name: 'PB', elevation: 0, rotation: 0, spaces: [], internalWalls: [], openings: [], stairs: [], visible: true };
    const upper = { ...base, id: 'b', name: 'P1', elevation: 3.4 };
    const project = { levels: [base, upper] } as unknown as Project;
    const stair = createStair({ x: 0, z: 0 }, { direction: 'down' });
    expect(fitStairToLevels(project, upper, stair).rise).toBeCloseTo(3.4);
  });
});
