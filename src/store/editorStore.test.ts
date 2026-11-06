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
