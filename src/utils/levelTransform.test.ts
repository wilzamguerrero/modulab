import { describe, expect, it } from 'vitest';
import { createProject, createStair } from '@/data/defaults';
import {
  applyLevelTransform,
  levelContents,
  levelPivot,
  normalizeAngle,
  rotateAround,
} from './levelTransform';
import { polygonArea } from './geometry';

function projectWithLevel() {
  const project = createProject({ name: 'Niveles', template: 'rectangle' });
  const base = project.levels[0];
  base.spaces[0].holes.push({
    id: 'hole_1',
    name: 'Hueco',
    vertices: [
      { x: 1, z: 1 },
      { x: 2, z: 1 },
      { x: 2, z: 2 },
      { x: 1, z: 2 },
    ],
  });
  base.internalWalls.push({
    id: 'wall_1',
    a: { x: 0, z: 0 },
    b: { x: 1, z: 0 },
    height: 2.8,
    thickness: 0.14,
    color: '#e6e0d4',
  });
  base.stairs.push(createStair({ x: 1, z: 1 }, { id: 'stair_1' }));
  project.objects.push({
    id: 'obj_1',
    name: 'Cubo',
    source: { type: 'primitive', shape: 'box', name: 'Cubo' },
    transform: { position: [1, 0, 1], rotationY: 0.4, scale: [1, 1, 1] },
    overrides: {},
    visible: true,
    levelId: base.id,
    locked: false,
  });
  project.exhibitors.push({
    id: 'exp_1',
    name: 'Expositor',
    standCode: '',
    description: '',
    position: { x: 2, z: 2 },
    rotation: 0.3,
    levelId: base.id,
    cameraPosition: [4, 2, 4],
    cameraTarget: [0, 1, 0],
    relatedObjectIds: [],
    moveRelated: false,
    visible: true,
    metadata: {},
    notionMissing: false,
  });
  project.rotationPoints.push({
    id: 'rp_1',
    name: 'Pivote',
    position: { x: 3, z: 1 },
    levelId: base.id,
  });
  return { project, level: base };
}

describe('transformación de un nivel completo', () => {
  it('el pivote es el centroide del piso, no el origen', () => {
    const { level } = projectWithLevel();
    const pivot = levelPivot(level);
    // La plantilla 'rectangle' está centrada en el origen.
    expect(pivot.x).toBeCloseTo(0, 6);
    expect(pivot.z).toBeCloseTo(0, 6);
  });

  it('un piso descentrado gira sobre sí mismo', () => {
    const project = createProject({ name: 'Niveles', template: 'rectangle' });
    const level = project.levels[0];
    // Desplaza el piso lejos del origen.
    level.spaces[0].vertices = level.spaces[0].vertices.map((vertex) => ({
      x: vertex.x + 10,
      z: vertex.z + 5,
    }));
    const pivot = levelPivot(level);
    expect(pivot.x).toBeCloseTo(10, 6);
    expect(pivot.z).toBeCloseTo(5, 6);
    // El pivote queda dentro del contorno: girar 180° devuelve la misma planta
    // (los vértices se reordenan, así que se compara el conjunto, no índice a índice).
    const original = level.spaces[0].vertices.map((vertex) => ({
      x: Number(vertex.x.toFixed(6)),
      z: Number(vertex.z.toFixed(6)),
    }));
    const rotated = level.spaces[0].vertices
      .map((vertex) => rotateAround(vertex, pivot, Math.PI))
      .map((vertex) => ({ x: Number(vertex.x.toFixed(6)), z: Number(vertex.z.toFixed(6)) }));
    const sortKey = (point: { x: number; z: number }) => `${point.x}:${point.z}`;
    expect(rotated.map(sortKey).sort()).toEqual(original.map(sortKey).sort());
  });

  it('mover el nivel traslada espacios, huecos, muros, escaleras y contenido', () => {
    const { project, level } = projectWithLevel();
    const before = {
      vertex: { ...level.spaces[0].vertices[0] },
      hole: { ...level.spaces[0].holes[0].vertices[0] },
      wallA: { ...level.internalWalls[0].a },
      stair: { ...level.stairs[0].position },
      object: [...project.objects[0].transform.position] as [number, number, number],
      exhibitor: { ...project.exhibitors[0].position },
      point: { ...project.rotationPoints[0].position },
    };
    applyLevelTransform(project, level.id, {
      delta: { x: 3, z: -2 },
      angle: 0,
      pivot: levelPivot(level),
    });
    expect(level.spaces[0].vertices[0]).toEqual({
      x: before.vertex.x + 3,
      z: before.vertex.z - 2,
    });
    expect(level.spaces[0].holes[0].vertices[0]).toEqual({
      x: before.hole.x + 3,
      z: before.hole.z - 2,
    });
    expect(level.internalWalls[0].a).toEqual({
      x: before.wallA.x + 3,
      z: before.wallA.z - 2,
    });
    expect(level.stairs[0].position).toEqual({
      x: before.stair.x + 3,
      z: before.stair.z - 2,
    });
    expect(project.objects[0].transform.position[0]).toBeCloseTo(before.object[0] + 3);
    expect(project.objects[0].transform.position[2]).toBeCloseTo(before.object[2] - 2);
    // La altura del objeto no cambia al mover el piso.
    expect(project.objects[0].transform.position[1]).toBeCloseTo(before.object[1]);
    expect(project.exhibitors[0].position).toEqual({
      x: before.exhibitor.x + 3,
      z: before.exhibitor.z - 2,
    });
    expect(project.rotationPoints[0].position).toEqual({
      x: before.point.x + 3,
      z: before.point.z - 2,
    });
  });

  it('girar el nivel gira también lo que está encima', () => {
    const { project, level } = projectWithLevel();
    const angle = Math.PI / 2;
    applyLevelTransform(project, level.id, { delta: { x: 0, z: 0 }, angle, pivot: { x: 0, z: 0 } });
    // Un punto en (3, 1) pasa a (1, -3) con el convenio de rotación en Y.
    expect(project.rotationPoints[0].position.x).toBeCloseTo(1, 6);
    expect(project.rotationPoints[0].position.z).toBeCloseTo(-3, 6);
    // Las rotaciones propias de cada elemento se acumulan.
    expect(project.objects[0].transform.rotationY).toBeCloseTo(0.4 + angle, 6);
    expect(project.exhibitors[0].rotation).toBeCloseTo(0.3 + angle, 6);
    expect(level.stairs[0].rotation).toBeCloseTo(angle, 6);
  });

  it('girar el nivel gira también la cámara guardada de los expositores', () => {
    const { project, level } = projectWithLevel();
    applyLevelTransform(project, level.id, {
      delta: { x: 0, z: 0 },
      angle: Math.PI / 2,
      pivot: { x: 0, z: 0 },
    });
    // (4, 4) gira a (4, -4); el eje Y no se toca.
    expect(project.exhibitors[0].cameraPosition[0]).toBeCloseTo(4, 6);
    expect(project.exhibitors[0].cameraPosition[1]).toBeCloseTo(2, 6);
    expect(project.exhibitors[0].cameraPosition[2]).toBeCloseTo(-4, 6);
    expect(project.exhibitors[0].cameraTarget[0]).toBeCloseTo(0, 6);
    expect(project.exhibitors[0].cameraTarget[2]).toBeCloseTo(0, 6);
  });

  it('girar no cambia el área del piso ni el tamaño de sus huecos', () => {
    const { project, level } = projectWithLevel();
    const areaBefore = polygonArea(level.spaces[0].vertices);
    const holeBefore = polygonArea(level.spaces[0].holes[0].vertices);
    applyLevelTransform(project, level.id, {
      delta: { x: 5, z: 5 },
      angle: 0.7,
      pivot: levelPivot(level),
    });
    expect(polygonArea(level.spaces[0].vertices)).toBeCloseTo(areaBefore, 6);
    expect(polygonArea(level.spaces[0].holes[0].vertices)).toBeCloseTo(holeBefore, 6);
  });

  it('no toca el contenido de otros niveles', () => {
    const { project, level } = projectWithLevel();
    const other = {
      id: 'lvl_other',
      name: 'Otro',
      elevation: 3,
      rotation: 0,
      spaces: [],
      internalWalls: [],
      openings: [],
      stairs: [],
      visible: true,
    };
    project.levels.push(other);
    project.objects.push({
      id: 'obj_2',
      name: 'Otro cubo',
      source: { type: 'primitive', shape: 'box', name: 'Cubo' },
      transform: { position: [1, 0, 1], rotationY: 0, scale: [1, 1, 1] },
      overrides: {},
      visible: true,
      levelId: other.id,
      locked: false,
    });
    applyLevelTransform(project, level.id, {
      delta: { x: 9, z: 9 },
      angle: 1,
      pivot: levelPivot(level),
    });
    expect(project.objects[1].transform.position).toEqual([1, 0, 1]);
    expect(project.objects[1].transform.rotationY).toBe(0);
  });

  it('cuenta el contenido que se arrastra con el nivel', () => {
    const { project, level } = projectWithLevel();
    const contents = levelContents(project, level.id);
    expect(contents.spaces).toBe(1);
    expect(contents.holes).toBe(1);
    expect(contents.walls).toBe(1);
    expect(contents.stairs).toBe(1);
    expect(contents.objects).toBe(1);
    expect(contents.exhibitors).toBe(1);
    expect(contents.rotationPoints).toBe(1);
  });

  it('normaliza el ángulo a (-π, π]', () => {
    expect(normalizeAngle(Math.PI * 3)).toBeCloseTo(Math.PI, 6);
    expect(normalizeAngle(-Math.PI * 1.5)).toBeCloseTo(Math.PI / 2, 6);
    expect(normalizeAngle(-Math.PI)).toBeCloseTo(Math.PI, 6);
    expect(normalizeAngle(0.5)).toBeCloseTo(0.5, 6);
  });

  it('girar dos veces cumple la regla del seno y el coseno', () => {
    const { project, level } = projectWithLevel();
    const pivot = levelPivot(level);
    const start = { ...level.spaces[0].vertices[0] };
    applyLevelTransform(project, level.id, { delta: { x: 0, z: 0 }, angle: 0.3, pivot });
    applyLevelTransform(project, level.id, { delta: { x: 0, z: 0 }, angle: 0.4, pivot });
    const expected = rotateAround(start, pivot, 0.7);
    expect(level.spaces[0].vertices[0].x).toBeCloseTo(expected.x, 6);
    expect(level.spaces[0].vertices[0].z).toBeCloseTo(expected.z, 6);
  });

  it('acumula el giro del piso para poder mostrarlo y corregirlo', () => {
    const { project, level } = projectWithLevel();
    const pivot = levelPivot(level);
    expect(level.rotation).toBe(0);
    applyLevelTransform(project, level.id, { delta: { x: 0, z: 0 }, angle: 0.5, pivot });
    expect(level.rotation).toBeCloseTo(0.5, 6);
    applyLevelTransform(project, level.id, { delta: { x: 0, z: 0 }, angle: -0.2, pivot });
    expect(level.rotation).toBeCloseTo(0.3, 6);
    // El giro se normaliza, no crece sin límite.
    applyLevelTransform(project, level.id, { delta: { x: 0, z: 0 }, angle: Math.PI * 2, pivot });
    expect(level.rotation).toBeCloseTo(0.3, 6);
  });

  it('un desplazamiento sin giro no altera el ángulo guardado', () => {
    const { project, level } = projectWithLevel();
    level.rotation = 0.4;
    applyLevelTransform(project, level.id, {
      delta: { x: 2, z: -1 },
      angle: 0,
      pivot: levelPivot(level),
    });
    expect(level.rotation).toBeCloseTo(0.4, 6);
  });
});