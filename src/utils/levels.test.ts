import { describe, expect, it } from 'vitest';
import { createLevel, createProject, createSpace, createStair } from '@/data/defaults';
import type { Project } from '@/types/project';
import {
  fitStairToLevels,
  entityLevelId,
  freeLevelElevation,
  hasNeighbourLevel,
  levelsToMakeRoom,
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

describe('freeLevelElevation', () => {
  const buildTower = (elevations: number[]): Project => {
    const project = createProject({ name: 'Torre' });
    project.levels = elevations.map((elevation, index) =>
      createLevel(`N${index}`, elevation),
    );
    return project;
  };

  it('coloca la copia justo encima del nivel duplicado, no al final de la torre', () => {
    const project = buildTower([0, 3]);
    const base = project.levels[0];
    // El hueco de 3 está ocupado, así que el salto sigue hasta el primer libre.
    expect(freeLevelElevation(project, base, 'above')).toBeCloseTo(6);
  });

  it('respeta el hueco contiguo cuando está libre', () => {
    const project = buildTower([0]);
    expect(freeLevelElevation(project, project.levels[0], 'above')).toBeCloseTo(3);
  });

  it('baja simétricamente', () => {
    const project = buildTower([0]);
    expect(freeLevelElevation(project, project.levels[0], 'below')).toBeCloseTo(-3);
  });

  it('puede ignorar niveles que se van a mover', () => {
    const project = buildTower([0, 3]);
    expect(
      freeLevelElevation(project, project.levels[0], 'above', 3, [project.levels[1].id]),
    ).toBeCloseTo(3);
  });
});

describe('levelsToMakeRoom', () => {
  it('no empuja nada si el hueco contiguo está libre', () => {
    const project = createProject({ name: 'Torre' });
    expect(levelsToMakeRoom(project, project.levels[0], 'above')).toEqual([]);
  });

  it('identifica los pisos que hay que subir para dejar sitio', () => {
    const project = createProject({ name: 'Torre' });
    const base = project.levels[0];
    const second = createLevel('Segundo', 3);
    const third = createLevel('Tercero', 6);
    project.levels.push(second, third);
    expect(levelsToMakeRoom(project, base, 'above').sort()).toEqual(
      [second.id, third.id].sort(),
    );
  });
});

describe('hasNeighbourLevel', () => {
  it('detecta si hay un piso hacia donde sube o baja la escalera', () => {
    const project = createProject({ name: 'Torre' });
    const base = project.levels[0];
    expect(hasNeighbourLevel(project, base, 'up')).toBe(false);
    project.levels.push(createLevel('P1', 3));
    expect(hasNeighbourLevel(project, base, 'up')).toBe(true);
  });
});
