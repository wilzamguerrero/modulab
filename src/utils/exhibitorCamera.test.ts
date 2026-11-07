import { describe, expect, it } from 'vitest';
import type { Exhibitor, Project } from '@/types/project';
import { focusCameraFor, headingCameraFor, visitorCameraFor } from './exhibitorCamera';

// Recinto de prueba: rectángulo de 16 × 12 m (de -8 a 8 en X, -6 a 6 en Z).
const VERTICES = [
  { x: -8, z: -6 },
  { x: 8, z: -6 },
  { x: 8, z: 6 },
  { x: -8, z: 6 },
];

function makeProject(overrides: Partial<Exhibitor> = {}): Project {
  const exhibitor = {
    id: 'exp_1',
    name: 'Prueba',
    standCode: '',
    description: '',
    color: '#ff8800',
    position: { x: 1, z: 0 },
    rotation: 0,
    levelId: 'lvl_1',
    cameraPosition: [4, 2, 4],
    cameraTarget: [0, 1, 0],
    relatedObjectIds: [],
    moveRelated: false,
    visible: true,
    metadata: {},
    notionMissing: false,
    ...overrides,
  } as Exhibitor;
  return {
    id: 'prj_1',
    levels: [
      {
        id: 'lvl_1',
        name: 'Nivel',
        elevation: 0,
        rotation: 0,
        internalWalls: [],
        openings: [],
        stairs: [],
        visible: true,
        spaces: [
          {
            id: 'spc_1',
            name: 'Espacio',
            vertices: VERTICES,
            edges: VERTICES.map(() => ({ wall: true })),
            holes: [],
            color: '#fff',
            roughness: 1,
            metalness: 0,
            thickness: 0.2,
            visible: true,
          },
        ],
      },
    ],
    objects: [],
    exhibitors: [exhibitor],
    readerCameraDistance: 3.2,
  } as unknown as Project;
}

describe('headingCameraFor', () => {
  it('coloca la cámara 3,2 m detrás según el rumbo y mira al expositor', () => {
    const cases: [number, number, number][] = [
      [0, 0, 3.2],
      [Math.PI / 2, 3.2, 0],
      [Math.PI, 0, -3.2],
      [-Math.PI / 2, -3.2, 0],
    ];
    for (const [rotation, offsetX, offsetZ] of cases) {
      const project = makeProject({ rotation });
      const camera = headingCameraFor(project.exhibitors[0], project);
      expect(camera.position[0]).toBeCloseTo(1 - offsetX, 5);
      expect(camera.position[2]).toBeCloseTo(0 - offsetZ, 5);
      expect(camera.position[1]).toBeCloseTo(1.9, 5);
      expect(camera.target[0]).toBeCloseTo(1, 5);
      expect(camera.target[2]).toBeCloseTo(0, 5);
    }
  });

  it('recorta la distancia cuando el rumbo sale del recinto', () => {
    const project = makeProject({ position: { x: 7, z: 0 }, rotation: Math.PI });
    const camera = headingCameraFor(project.exhibitors[0], project);
    expect(camera.position[1]).toBeCloseTo(1.9, 5);
    expect(camera.position[0]).toBeLessThan(8);
    expect(camera.position[0]).toBeGreaterThan(0);
  });

  it('usa la flecha en el visor aunque la ficha no marque rotationCustom', () => {
    const project = makeProject({ rotation: Math.PI / 2 });
    const camera = focusCameraFor(project.exhibitors[0], project);
    expect(camera.position[0]).toBeCloseTo(1 - 3.2, 5);
    expect(camera.position[2]).toBeCloseTo(0, 5);
  });

  it('sin rumbo (0°) ignora la cámara guardada y se coloca detrás de la flecha', () => {
    const project = makeProject({
      cameraPosition: [3, 1.9, 2],
      cameraTarget: [1, 1.15, 0],
    });
    const camera = focusCameraFor(project.exhibitors[0], project);
    // Rumbo 0 = mira hacia +Z: la cámara queda detrás, en Z negativo.
    expect(camera.position[0]).toBeCloseTo(1, 5);
    expect(camera.position[2]).toBeCloseTo(-3.2, 5);
  });

  it('usa la distancia de llegada del visor para abrir o cerrar el plano', () => {
    const project = makeProject({ rotation: Math.PI / 2 });
    project.readerCameraDistance = 5;
    const camera = headingCameraFor(project.exhibitors[0], project);
    expect(camera.position[0]).toBeCloseTo(1 - 5, 5);
    project.readerCameraDistance = 2;
    expect(headingCameraFor(project.exhibitors[0], project).position[0]).toBeCloseTo(1 - 2, 5);
  });

  it('la distancia del visor manda sobre la antigua de la ficha', () => {
    const project = makeProject({ rotation: Math.PI / 2, cameraDistance: 9 });
    project.readerCameraDistance = 4;
    expect(headingCameraFor(project.exhibitors[0], project).position[0]).toBeCloseTo(1 - 4, 5);
  });

  it('la flecha manda siempre, aunque la cámara guardada sea válida', () => {
    const project = makeProject({
      rotation: Math.PI / 2,
      rotationCustom: true,
      cameraPosition: [-2, 1.9, 0],
      cameraTarget: [1, 1.15, 0],
    });
    const camera = visitorCameraFor(project.exhibitors[0], project);
    expect(camera.position[0]).toBeCloseTo(1 - 3.2, 5);
    expect(camera.position[2]).toBeCloseTo(0, 5);
    const closer = makeProject({
      rotation: Math.PI / 2,
      rotationCustom: true,
      cameraPosition: [4, 2, 4],
      cameraTarget: [0, 1, 0],
    });
    closer.readerCameraDistance = 5;
    const opened = visitorCameraFor(closer.exhibitors[0], closer);
    expect(opened.position[0]).toBeCloseTo(1 - 5, 5);
    expect(opened.position[2]).toBeCloseTo(0, 5);
  });

  it('con la espalda pegada a un muro se queda detrás y sólo se eleva', () => {
    // Expositor a 0,2 m del borde trasero (Z = -6), flecha hacia +Z.
    const project = makeProject({ position: { x: 1, z: -5.8 }, rotation: 0 });
    const exhibitor = project.exhibitors[0];
    const camera = headingCameraFor(exhibitor, project);
    // Nunca al lateral ni al frente: sigue en la línea de la flecha.
    expect(camera.position[0]).toBeCloseTo(1, 5);
    expect(camera.position[2]).toBeLessThan(-5.8);
    expect(camera.position[1]).toBeGreaterThan(1.9);
    expect(camera.target[2]).toBeGreaterThanOrEqual(-5.8);
  });

  it('desplaza el objetivo hacia el montaje lateral del expositor', () => {
    const project = makeProject();
    project.objects = [
      {
        id: 'obj_1',
        name: 'cartel',
        exhibitorId: 'exp_1',
        visible: true,
        levelId: 'lvl_1',
        transform: { position: [2.5, 1.1, 0.6], rotationY: 0, scale: [1, 1, 1] },
      },
    ] as unknown as Project['objects'];
    const camera = headingCameraFor(project.exhibitors[0], project);
    // El cartel está 1,5 m a un lado: el objetivo acompaña al montaje.
    expect(camera.target[0]).toBeGreaterThan(1.3);
  });
});
