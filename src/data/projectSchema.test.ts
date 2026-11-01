import { describe, expect, it } from 'vitest';
import { createInternalWall, createLevel, createProject, createSpace, createStair } from './defaults';
import { duplicateProject, parseProject, ProjectParseError } from './projectSchema';
import { DEFAULT_EXHIBITOR_COLOR } from '@/utils/exhibitorColors';

function firstSpace(project: ReturnType<typeof createProject>) {
  return project.levels[0].spaces[0];
}

describe('project data', () => {
  it('crea un proyecto v2 con nivel, espacio, muros, luces y cámara', () => {
    const project = createProject({ name: 'Muestra MAD', template: 't-shape' });
    expect(project.schemaVersion).toBe(2);
    expect(project.levels).toHaveLength(1);
    expect(project.levels[0].spaces).toHaveLength(1);
    expect(firstSpace(project).vertices).toHaveLength(8);
    expect(firstSpace(project).edges).toHaveLength(8);
    expect(project.lights.length).toBeGreaterThan(0);
    expect(project.camera.position).toHaveLength(3);
    expect(project.settings.shadowQuality).toBe('medium');
    expect(project.settings.exhibitorColorMode).toBe('rings');
    expect(project.settings.exhibitorColorOpacity).toBe(0.35);
  });

  it('aplica calidad de sombras media a proyectos antiguos sin ese ajuste', () => {
    const project = createProject({ name: 'Proyecto antiguo' });
    const legacy = structuredClone(project) as Partial<typeof project>;
    delete legacy.settings;

    const parsed = parseProject(legacy);
    expect(parsed.settings.shadowQuality).toBe('medium');
    expect(parsed.settings.exhibitorColorMode).toBe('rings');
    expect(parsed.settings.exhibitorColorOpacity).toBe(0.35);
  });

  it('normaliza los muros cuando cambia el número de vértices del espacio', () => {
    const project = createProject({ name: 'Prueba' });
    firstSpace(project).vertices.push({ x: 6, z: 0 });
    const parsed = parseProject(project);
    const space = parsed.levels[0].spaces[0];
    expect(space.edges).toHaveLength(space.vertices.length);
  });

  it('no marca como ausentes los expositores manuales al normalizar', () => {
    const project = createProject({ name: 'Prueba' });
    project.exhibitors = [
      {
        id: 'exp_manual',
        name: 'Manual',
        standCode: '',
        description: '',
        position: { x: 0, z: 0 },
        rotation: 0,
        cameraPosition: [4, 2, 4],
        cameraTarget: [0, 1, 0],
        relatedObjectIds: [],
        visible: true,
        metadata: {},
        notionMissing: true,
      },
      {
        id: 'exp_notion',
        name: 'Notion',
        standCode: '',
        description: '',
        notionBlockId: 'person-1',
        position: { x: 1, z: 1 },
        rotation: 0,
        cameraPosition: [4, 2, 4],
        cameraTarget: [0, 1, 0],
        relatedObjectIds: [],
        visible: true,
        metadata: {},
        notionMissing: true,
      },
    ];

    const parsed = parseProject(project);
    expect(parsed.exhibitors.find((exhibitor) => exhibitor.id === 'exp_manual')?.notionMissing).toBe(false);
    expect(parsed.exhibitors.find((exhibitor) => exhibitor.id === 'exp_notion')?.notionMissing).toBe(true);
    expect(parsed.exhibitors.every((exhibitor) => exhibitor.color === DEFAULT_EXHIBITOR_COLOR)).toBe(true);
    expect(parsed.exhibitors.every((exhibitor) => exhibitor.levelId === parsed.levels[0].id)).toBe(true);
  });

  it('elimina vínculos de expositor que ya no existen', () => {
    const project = createProject({ name: 'Vínculos' });
    const level = project.levels[0];
    project.exhibitors = [
      {
        id: 'exp_ok',
        name: 'Expositor válido',
        standCode: '',
        description: '',
        color: '#ff0000',
        position: { x: 0, z: 0 },
        rotation: 0,
        cameraPosition: [4, 2, 4],
        cameraTarget: [0, 1, 0],
        relatedObjectIds: [],
        visible: true,
        metadata: {},
        notionMissing: false,
      },
    ];
    level.spaces[0].edges[0].exhibitorId = 'exp_ok';
    level.spaces[0].edges[1].exhibitorId = 'exp_inexistente';
    level.internalWalls = [
      {
        id: 'wall_1',
        a: { x: 0, z: 0 },
        b: { x: 1, z: 0 },
        height: 2.8,
        thickness: 0.14,
        color: '#e6e0d4',
        exhibitorId: 'exp_inexistente',
      },
    ];
    level.openings = [
      {
        id: 'open_1',
        wallId: level.spaces[0].edges[0].id,
        kind: 'door',
        offset: 1,
        width: 0.9,
        height: 2.1,
        sillHeight: 0,
        exhibitorId: 'exp_ok',
      },
      {
        id: 'open_2',
        wallId: level.spaces[0].edges[0].id,
        kind: 'window',
        offset: 2,
        width: 1.2,
        height: 1.2,
        sillHeight: 1,
        exhibitorId: 'exp_inexistente',
      },
    ];

    const parsed = parseProject(project);
    const parsedLevel = parsed.levels[0];
    expect(parsedLevel.spaces[0].edges[0].exhibitorId).toBe('exp_ok');
    expect(parsedLevel.spaces[0].edges[1].exhibitorId).toBeNull();
    expect(parsedLevel.internalWalls[0].exhibitorId).toBeNull();
    expect(parsedLevel.openings[0].exhibitorId).toBe('exp_ok');
    expect(parsedLevel.openings[1].exhibitorId).toBeNull();
  });

  it('rechaza datos inválidos', () => {
    expect(() => parseProject(null)).toThrow(ProjectParseError);
    expect(() => parseProject({ floor: { vertices: 'no-es-un-array' } })).toThrow(ProjectParseError);
  });

  it('duplica un proyecto con identificadores nuevos', () => {
    const project = createProject({ name: 'Original' });
    const copy = duplicateProject(project);
    expect(copy.id).not.toBe(project.id);
    expect(copy.name).toContain('copia');
    expect(copy.notionBlockId).toBeUndefined();
    expect(copy.published).toBeUndefined();
    expect(copy.levels[0].id).not.toBe(project.levels[0].id);
  });

  it('remapea expositores, muros y aberturas dentro de los niveles al duplicar', () => {
    const project = createProject({ name: 'Original' });
    const level = project.levels[0];
    project.exhibitors = [
      {
        id: 'exp_original',
        name: 'Expositor',
        standCode: '',
        description: '',
        color: '#ff0000',
        position: { x: 0, z: 0 },
        rotation: 0,
        cameraPosition: [4, 2, 4],
        cameraTarget: [0, 1, 0],
        relatedObjectIds: [],
        visible: true,
        metadata: {},
        notionMissing: false,
      },
    ];
    level.spaces[0].edges[0].exhibitorId = 'exp_original';
    level.internalWalls = [
      {
        id: 'wall_original',
        a: { x: 0, z: 0 },
        b: { x: 1, z: 0 },
        height: 2.8,
        thickness: 0.14,
        color: '#e6e0d4',
        exhibitorId: 'exp_original',
      },
    ];
    level.openings = [
      {
        id: 'open_original',
        wallId: level.spaces[0].edges[0].id,
        kind: 'door',
        offset: 1,
        width: 0.9,
        height: 2.1,
        sillHeight: 0,
        exhibitorId: 'exp_original',
      },
    ];

    const copy = duplicateProject(project);
    const copyLevel = copy.levels[0];
    expect(copy.exhibitors[0].id).not.toBe('exp_original');
    expect(copyLevel.spaces[0].edges[0].exhibitorId).toBe(copy.exhibitors[0].id);
    expect(copyLevel.internalWalls[0].exhibitorId).toBe(copy.exhibitors[0].id);
    expect(copyLevel.openings[0].exhibitorId).toBe(copy.exhibitors[0].id);
    expect(copyLevel.openings[0].wallId).toBe(copyLevel.spaces[0].edges[0].id);
  });

  it('migra un proyecto v1 de planta única a un nivel con un espacio', () => {
    const legacy = {
      schemaVersion: 1,
      id: 'prj_legacy',
      name: 'Legado',
      floor: { vertices: [{ x: 0, z: 0 }, { x: 4, z: 0 }, { x: 4, z: 3 }, { x: 0, z: 3 }], color: '#cccccc' },
      edges: [
        { id: 'e1', wall: true, height: 2.8, thickness: 0.14, color: '#ffffff' },
        { id: 'e2', wall: true, height: 2.8, thickness: 0.14, color: '#ffffff' },
        { id: 'e3', wall: true, height: 2.8, thickness: 0.14, color: '#ffffff' },
        { id: 'e4', wall: true, height: 2.8, thickness: 0.14, color: '#ffffff' },
      ],
      internalWalls: [
        { id: 'w1', a: { x: 2, z: 0 }, b: { x: 2, z: 3 }, height: 2.8, thickness: 0.14, color: '#ffffff' },
      ],
      openings: [
        { id: 'o1', wallId: 'e1', kind: 'door', offset: 1, width: 0.9, height: 2.1, sillHeight: 0 },
      ],
      objects: [
        {
          id: 'obj1',
          name: 'Cubo',
          source: { type: 'primitive', shape: 'box', name: 'Cubo' },
          transform: { position: [1, 0, 1], rotationY: 0, scale: [1, 1, 1] },
          overrides: {},
          visible: true,
        },
      ],
    };

    const parsed = parseProject(legacy);
    expect(parsed.schemaVersion).toBe(2);
    expect(parsed.levels).toHaveLength(1);
    const level = parsed.levels[0];
    expect(level.elevation).toBe(0);
    expect(level.spaces[0].vertices).toHaveLength(4);
    expect(level.spaces[0].edges).toHaveLength(4);
    expect(level.internalWalls).toHaveLength(1);
    expect(level.openings).toHaveLength(1);
    expect(level.openings[0].wallId).toBe('e1');
    expect(parsed.objects[0].levelId).toBe(level.id);
  });

  it('migra un proyecto con levels vacío y planta raíz (sin perder la planta)', () => {
    const project = createProject({ name: 'Raro' });
    const raw = {
      ...structuredClone(project),
      levels: [],
      floor: { vertices: [{ x: 0, z: 0 }, { x: 2, z: 0 }, { x: 2, z: 2 }] },
      edges: [],
    };
    const parsed = parseProject(raw);
    expect(parsed.levels).toHaveLength(1);
    expect(parsed.levels[0].spaces[0].vertices).toHaveLength(3);
  });

  it('conserva varios niveles y escaleras al parsear', () => {
    const project = createProject({ name: 'Torre' });
    const upper = createLevel('Nivel 2', 3, {
      spaces: [createSpace([{ x: 0, z: 0 }, { x: 4, z: 0 }, { x: 4, z: 4 }, { x: 0, z: 4 }])],
      stairs: [createStair({ x: 1, z: 1 }, { kind: 'l', steps: 18, rise: 3 })],
      internalWalls: [createInternalWall({ x: 1, z: 1 }, { x: 2, z: 2 })],
    });
    project.levels.push(upper);

    const parsed = parseProject(project);
    expect(parsed.levels).toHaveLength(2);
    expect(parsed.levels[1].elevation).toBe(3);
    expect(parsed.levels[1].stairs[0].kind).toBe('l');
    expect(parsed.levels[1].stairs[0].steps).toBe(18);
    expect(parsed.levels[1].internalWalls).toHaveLength(1);
  });

  it('asigna el primer nivel a entidades con levelId inválido', () => {
    const project = createProject({ name: 'Nivel inválido' });
    project.objects = [
      {
        id: 'obj',
        name: 'Obj',
        source: { type: 'primitive', shape: 'box', name: 'Obj' },
        transform: { position: [0, 0, 0], rotationY: 0, scale: [1, 1, 1] },
        overrides: {},
        visible: true,
        levelId: 'no-existe',
        locked: false,
      },
    ];
    const parsed = parseProject(project);
    expect(parsed.objects[0].levelId).toBe(parsed.levels[0].id);
  });
});
