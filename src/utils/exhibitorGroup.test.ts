import { describe, expect, it } from 'vitest';
import { createProject } from '@/data/defaults';
import { translateAssignedElements } from './exhibitorGroup';
import type { Project } from '@/types/project';

function projectWithExhibitor() {
  const project = createProject({ name: 'Grupo', template: 'rectangle' });
  const level = project.levels[0];
  const space = level.spaces[0];
  project.exhibitors.push({
    id: 'exp_1',
    name: 'Expositor',
    standCode: '',
    description: '',
    position: { x: 0, z: 0 },
    rotation: 0,
    levelId: level.id,
    cameraPosition: [4, 2, 4],
    cameraTarget: [0, 1, 0],
    relatedObjectIds: ['obj_1'],
    moveRelated: true,
    visible: true,
    metadata: {},
    notionMissing: false,
  });
  project.objects.push({
    id: 'obj_1',
    name: 'Vitrina',
    code: '',
    showCode: true,
    showName: false,
    source: { type: 'primitive', shape: 'box', name: 'Vitrina' },
    transform: { position: [1, 0, 1], rotationY: 0, scale: [1, 1, 1] },
    overrides: {},
    visible: true,
    levelId: level.id,
    exhibitorId: 'exp_1',
    locked: false,
  });
  project.objects.push({
    id: 'obj_2',
    name: 'Suelto',
    code: '',
    showCode: true,
    showName: false,
    source: { type: 'primitive', shape: 'box', name: 'Suelto' },
    transform: { position: [-1, 0, -1], rotationY: 0, scale: [1, 1, 1] },
    overrides: {},
    visible: true,
    levelId: level.id,
    exhibitorId: null,
    locked: false,
  });
  level.internalWalls.push({
    id: 'wall_1',
    a: { x: 0, z: 0 },
    b: { x: 1, z: 0 },
    height: 2.8,
    thickness: 0.14,
    color: '#e6e0d4',
    exhibitorId: 'exp_1',
  });
  // Un muro perimetral asignado: se mueven sus dos vértices.
  space.edges[0].exhibitorId = 'exp_1';
  return { project, level, space, exhibitor: project.exhibitors[0] };
}

describe('mover un expositor con sus elementos', () => {
  it('desplaza objetos y muros asociados y deja quieto el resto', () => {
    const { project, level, space, exhibitor } = projectWithExhibitor() as {
      project: Project;
      level: Project['levels'][number];
      space: Project['levels'][number]['spaces'][number];
      exhibitor: Project['exhibitors'][number];
    };
    const beforeVertices = space.vertices.map((vertex) => ({ ...vertex }));

    translateAssignedElements(project, exhibitor, { x: 2, z: -3 });

    expect(project.objects[0].transform.position).toEqual([3, 0, -2]);
    expect(project.objects[1].transform.position).toEqual([-1, 0, -1]);
    expect(level.internalWalls[0].a).toEqual({ x: 2, z: -3 });
    expect(level.internalWalls[0].b).toEqual({ x: 3, z: -3 });
    // El muro perimetral asignado mueve solo sus extremos.
    const movedIndexes = space.vertices
      .map((vertex, index) => ({ vertex, index }))
      .filter(
        ({ vertex, index }) =>
          vertex.x !== beforeVertices[index].x || vertex.z !== beforeVertices[index].z,
      )
      .map(({ index }) => index);
    expect(movedIndexes.sort()).toEqual([0, 1]);
    space.vertices.forEach((vertex, index) => {
      if (movedIndexes.includes(index)) {
        expect(vertex).toEqual({
          x: beforeVertices[index].x + 2,
          z: beforeVertices[index].z - 3,
        });
      } else {
        expect(vertex).toEqual(beforeVertices[index]);
      }
    });
  });

  it('no duplica el desplazamiento de un vértice compartido por dos muros asignados', () => {
    const { project, space, exhibitor } = projectWithExhibitor() as {
      project: Project;
      space: Project['levels'][number]['spaces'][number];
      exhibitor: Project['exhibitors'][number];
    };
    space.edges[1].exhibitorId = 'exp_1';
    const before = space.vertices.map((vertex) => ({ ...vertex }));

    translateAssignedElements(project, exhibitor, { x: 1, z: 0 });

    // El vértice 1 es el extremo compartido por los dos bordes: se mueve una vez.
    expect(space.vertices[1]).toEqual({ x: before[1].x + 1, z: before[1].z });
    expect(space.vertices[2]).toEqual({ x: before[2].x + 1, z: before[2].z });
  });

  it('no hace nada con delta cero', () => {
    const { project, space, exhibitor } = projectWithExhibitor() as {
      project: Project;
      space: Project['levels'][number]['spaces'][number];
      exhibitor: Project['exhibitors'][number];
    };
    const before = space.vertices.map((vertex) => ({ ...vertex }));
    translateAssignedElements(project, exhibitor, { x: 0, z: 0 });
    expect(space.vertices).toEqual(before);
    expect(project.objects[0].transform.position).toEqual([1, 0, 1]);
  });
});
