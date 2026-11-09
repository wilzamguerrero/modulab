import { beforeEach, describe, expect, it } from 'vitest';
import { createProject } from '@/data/defaults';
import { useEditorStore } from './editorStore';

function resetWithProject() {
  const project = createProject({ name: 'Duplicados', template: 'rectangle' });
  useEditorStore.getState().loadProjectData(project);
  return project;
}

describe('duplicar un nivel', () => {
  beforeEach(() => {
    resetWithProject();
  });

  it('coloca la copia al lado con la misma elevación', () => {
    const base = useEditorStore.getState().project!.levels[0];
    const beforeXs = base.spaces[0].vertices.map((vertex) => vertex.x);

    const id = useEditorStore.getState().duplicateLevel(base.id, { placement: 'same' });
    const copy = useEditorStore.getState().project!.levels.find((level) => level.id === id);

    expect(copy).toBeTruthy();
    expect(copy!.elevation).toBeCloseTo(base.elevation, 6);
    // El desplazamiento es positivo en X, así que la copia no se solapa.
    const afterXs = copy!.spaces[0].vertices.map((vertex) => vertex.x);
    expect(Math.min(...afterXs)).toBeGreaterThan(Math.max(...beforeXs));
  });

  it('apila la copia arriba o abajo en la misma posición en planta', () => {
    const base = useEditorStore.getState().project!.levels[0];
    const original = base.spaces[0].vertices.map((vertex) => ({ ...vertex }));

    const above = useEditorStore.getState().duplicateLevel(base.id, { placement: 'above' });
    const below = useEditorStore.getState().duplicateLevel(base.id, { placement: 'below' });
    const levels = useEditorStore.getState().project!.levels;
    const up = levels.find((level) => level.id === above)!;
    const down = levels.find((level) => level.id === below)!;

    expect(up.elevation).toBeGreaterThan(base.elevation);
    expect(down.elevation).toBeLessThan(base.elevation);
    expect(up.spaces[0].vertices).toEqual(original);
    expect(down.spaces[0].vertices).toEqual(original);
  });

  it('copia objetos y expositores del piso con vínculos nuevos', () => {
    const base = useEditorStore.getState().project!.levels[0];
    const project = useEditorStore.getState().project!;
    project.exhibitors.push({
      id: 'exp_1',
      name: 'Expositor',
      standCode: '',
      description: '',
      position: { x: 1, z: 1 },
      rotation: 0,
      levelId: base.id,
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
      levelId: base.id,
      exhibitorId: 'exp_1',
      locked: false,
    });

    const id = useEditorStore.getState().duplicateLevel(base.id, { placement: 'same' });
    const copy = useEditorStore.getState().project!.levels.find((level) => level.id === id)!;
    const copyExhibitors = useEditorStore
      .getState()
      .project!.exhibitors.filter((exhibitor) => exhibitor.levelId === copy.id);
    const copyObjects = useEditorStore
      .getState()
      .project!.objects.filter((object) => object.levelId === copy.id);

    expect(copyExhibitors).toHaveLength(1);
    expect(copyObjects).toHaveLength(1);
    expect(copyExhibitors[0].id).not.toBe('exp_1');
    expect(copyObjects[0].id).not.toBe('obj_1');
    expect(copyObjects[0].exhibitorId).toBe(copyExhibitors[0].id);
    expect(copyExhibitors[0].relatedObjectIds).toEqual([copyObjects[0].id]);
  });

  it('desplaza también los objetos y expositores copiados', () => {
    const base = useEditorStore.getState().project!.levels[0];
    const project = useEditorStore.getState().project!;
    project.exhibitors.push({
      id: 'exp_1',
      name: 'Expositor',
      standCode: '',
      description: '',
      position: { x: 1, z: 1 },
      rotation: 0,
      levelId: base.id,
      cameraPosition: [4, 2, 4],
      cameraTarget: [0, 1, 0],
      relatedObjectIds: [],
      moveRelated: false,
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
      levelId: base.id,
      exhibitorId: null,
      locked: false,
    });

    const id = useEditorStore.getState().duplicateLevel(base.id, { placement: 'same' });
    const copyExhibitor = useEditorStore
      .getState()
      .project!.exhibitors.find((exhibitor) => exhibitor.levelId === id)!;
    const copyObject = useEditorStore
      .getState()
      .project!.objects.find((object) => object.levelId === id)!;

    expect(copyExhibitor.position.x).toBeGreaterThan(1);
    expect(copyObject.transform.position[0]).toBeGreaterThan(1);
    expect(copyObject.transform.position[0] - 1).toBeCloseTo(copyExhibitor.position.x - 1, 6);
  });

  it('respeta un desplazamiento explícito', () => {
    const base = useEditorStore.getState().project!.levels[0];
    const before = base.spaces[0].vertices[0];
    const id = useEditorStore.getState().duplicateLevel(base.id, {
      placement: 'same',
      offset: { x: 5, z: 2 },
    });
    const copy = useEditorStore.getState().project!.levels.find((level) => level.id === id)!;
    expect(copy.spaces[0].vertices[0]).toEqual({ x: before.x + 5, z: before.z + 2 });
  });

  it('apila la copia justo encima y empuja los pisos superiores', () => {
    const base = useEditorStore.getState().project!.levels[0];
    const secondId = useEditorStore.getState().addLevel('above')!;
    const beforeSecond = useEditorStore
      .getState()
      .project!.levels.find((level) => level.id === secondId)!.elevation;

    const copyId = useEditorStore
      .getState()
      .duplicateLevel(base.id, { placement: 'above' })!;
    const levels = useEditorStore.getState().project!.levels;
    const copy = levels.find((level) => level.id === copyId)!;
    const second = levels.find((level) => level.id === secondId)!;

    // La copia queda pegada al original, no al final de la torre.
    expect(copy.elevation).toBeGreaterThan(base.elevation);
    expect(copy.elevation - base.elevation).toBeCloseTo(3);
    // El piso que ocupaba ese hueco sube para dejarle sitio.
    expect(second.elevation).toBeGreaterThan(beforeSecond);
    // Sin huecos: elevaciones distintas y en orden.
    const elevations = levels.map((level) => level.elevation).sort((a, b) => a - b);
    for (let index = 1; index < elevations.length; index += 1) {
      expect(elevations[index] - elevations[index - 1]).toBeCloseTo(3);
    }
  });

  it('apila la copia justo debajo del original', () => {
    const base = useEditorStore.getState().project!.levels[0];
    useEditorStore.getState().addLevel('above');
    const copyId = useEditorStore
      .getState()
      .duplicateLevel(base.id, { placement: 'below' })!;
    const copy = useEditorStore
      .getState()
      .project!.levels.find((level) => level.id === copyId)!;
    expect(copy.elevation).toBeCloseTo(base.elevation - 3);
  });

  it('recalcula la altura de las escaleras de la copia al nivel vecino real', () => {
    const base = useEditorStore.getState().project!.levels[0];
    useEditorStore.getState().setActiveLevel(base.id);
    useEditorStore.getState().addStair({ x: 1, z: 1 });

    const copyId = useEditorStore
      .getState()
      .duplicateLevel(base.id, { placement: 'above' })!;
    const project = useEditorStore.getState().project!;
    const copy = project.levels.find((level) => level.id === copyId)!;
    expect(copy.stairs).toHaveLength(1);
    // La copia sube hasta el piso que tiene justo encima.
    const above = project.levels
      .filter((level) => level.elevation > copy.elevation + 0.2)
      .sort((a, b) => a.elevation - b.elevation)[0];
    const expected = above ? above.elevation - copy.elevation : 2.8;
    expect(copy.stairs[0].rise).toBeCloseTo(expected);
  });

  it('no deja la escalera de la copia con la altura del nivel original', () => {
    const base = useEditorStore.getState().project!.levels[0];
    useEditorStore.getState().addLevel('above');
    useEditorStore.getState().setActiveLevel(base.id);
    useEditorStore.getState().addStair({ x: 1, z: 1 });
    const originalRise = useEditorStore.getState().project!.levels[0].stairs[0].rise;

    const copyId = useEditorStore
      .getState()
      .duplicateLevel(base.id, { placement: 'above' })!;
    const project = useEditorStore.getState().project!;
    const copy = project.levels.find((level) => level.id === copyId)!;
    const above = project.levels
      .filter((level) => level.elevation > copy.elevation + 0.2)
      .sort((a, b) => a.elevation - b.elevation)[0];

    if (above) {
      // Hay piso encima: la escalera mide exactamente ese salto.
      expect(copy.stairs[0].rise).toBeCloseTo(above.elevation - copy.elevation);
    } else {
      // Sin piso encima usa el salto estándar del proyecto.
      expect(copy.stairs[0].rise).toBeCloseTo(2.8);
      expect(copy.stairs[0].rise).not.toBeCloseTo(originalRise + 10);
    }
  });
});

describe('mover un expositor agrupado', () => {
  beforeEach(() => {
    resetWithProject();
  });

  it('arrastra sus objetos asociados solo si la opción está activa', () => {
    const level = useEditorStore.getState().project!.levels[0];
    const store = useEditorStore.getState();
    const objectId = store.addObject(
      { id: 'cat_box', name: 'Vitrina', category: 'primitivas', kind: 'primitive', shape: 'box' },
      { x: 1, z: 1 },
    )!;
    const exhibitorId = useEditorStore.getState().addExhibitor({ x: 0, z: 0 })!;
    useEditorStore.getState().assignObjectToExhibitor(objectId, exhibitorId);
    useEditorStore.getState().updateExhibitor(exhibitorId, { levelId: level.id });

    useEditorStore.getState().moveExhibitor(exhibitorId, { x: 2, z: 0 });
    let object = useEditorStore.getState().project!.objects.find((entry) => entry.id === objectId)!;
    expect(object.transform.position[0]).toBeCloseTo(1);

    useEditorStore.getState().updateExhibitor(exhibitorId, { moveRelated: true });
    useEditorStore.getState().moveExhibitor(exhibitorId, { x: 4, z: 0 });
    object = useEditorStore.getState().project!.objects.find((entry) => entry.id === objectId)!;
    expect(object.transform.position[0]).toBeCloseTo(3);
  });

  it('también agrupa al escribir la posición en el inspector', () => {
    const objectId = useEditorStore
      .getState()
      .addObject({ id: 'cat_box', name: 'Vitrina', category: 'primitivas', kind: 'primitive', shape: 'box' }, { x: 1, z: 1 })!;
    const exhibitorId = useEditorStore.getState().addExhibitor({ x: 0, z: 0 })!;
    useEditorStore.getState().assignObjectToExhibitor(objectId, exhibitorId);
    useEditorStore.getState().updateExhibitor(exhibitorId, { moveRelated: true });

    useEditorStore.getState().updateExhibitor(exhibitorId, { position: { x: 3, z: 3 } });

    const object = useEditorStore.getState().project!.objects.find((entry) => entry.id === objectId)!;
    expect(object.transform.position[0]).toBeCloseTo(4);
    expect(object.transform.position[2]).toBeCloseTo(4);
  });
});

describe('banderas de entrada y salida', () => {
  beforeEach(() => {
    resetWithProject();
  });

  it('crea una entrada y permite convertirla en salida', () => {
    const id = useEditorStore.getState().addAccess({ x: 2, z: 1 }, 'entrance')!;
    let access = useEditorStore.getState().project!.accesses.find((entry) => entry.id === id)!;

    expect(access.kind).toBe('entrance');
    expect(access.name).toBe('Entrada');
    expect(access.levelId).toBe(useEditorStore.getState().project!.levels[0].id);

    useEditorStore.getState().updateAccess(id, { kind: 'exit' });
    access = useEditorStore.getState().project!.accesses.find((entry) => entry.id === id)!;
    expect(access.kind).toBe('exit');
    // La etiqueta y el color de fábrica acompañan al tipo nuevo.
    expect(access.name).toBe('Salida');
    expect(access.color).toBe('#f87171');
  });

  it('conserva una etiqueta y un color personalizados al cambiar el tipo', () => {
    const id = useEditorStore.getState().addAccess({ x: 2, z: 1 }, 'entrance')!;
    useEditorStore.getState().updateAccess(id, { name: 'Puerta norte', color: '#123456' });
    useEditorStore.getState().updateAccess(id, { kind: 'both' });

    const access = useEditorStore.getState().project!.accesses.find((entry) => entry.id === id)!;
    expect(access.kind).toBe('both');
    expect(access.name).toBe('Puerta norte');
    expect(access.color).toBe('#123456');
  });

  it('duplica una bandera con id nuevo y la desplaza', () => {
    const id = useEditorStore.getState().addAccess({ x: 2, z: 1 }, 'exit')!;
    const copyId = useEditorStore.getState().duplicateAccess(id)!;
    const copy = useEditorStore.getState().project!.accesses.find((entry) => entry.id === copyId)!;

    expect(copyId).not.toBe(id);
    expect(copy.kind).toBe('exit');
    expect(copy.position).toEqual({ x: 2.75, z: 1.75 });

    useEditorStore.getState().deleteAccess(copyId);
    expect(useEditorStore.getState().project!.accesses).toHaveLength(1);
  });

  it('la copia de un nivel se lleva sus banderas con ids nuevos', () => {
    const level = useEditorStore.getState().project!.levels[0];
    useEditorStore.getState().addAccess({ x: 2, z: 1 }, 'entrance');

    const copyId = useEditorStore.getState().duplicateLevel(level.id, { placement: 'same' })!;
    const accesses = useEditorStore
      .getState()
      .project!.accesses.filter((access) => access.levelId === copyId);

    expect(accesses).toHaveLength(1);
    expect(accesses[0].kind).toBe('entrance');
    expect(accesses[0].position.x).toBeGreaterThan(2);
  });
});
