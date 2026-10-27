import { describe, expect, it } from 'vitest';
import { createProject } from './defaults';
import { duplicateProject, parseProject, ProjectParseError } from './projectSchema';
import { DEFAULT_EXHIBITOR_COLOR } from '@/utils/exhibitorColors';

describe('project data', () => {
  it('crea un proyecto con piso, muros, luces y cámara', () => {
    const project = createProject({ name: 'Muestra MAD', template: 't-shape' });
    expect(project.floor.vertices).toHaveLength(8);
    expect(project.edges).toHaveLength(8);
    expect(project.lights.length).toBeGreaterThan(0);
    expect(project.camera.position).toHaveLength(3);
    expect(project.schemaVersion).toBe(1);
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

  it('normaliza los muros cuando cambia el número de vértices', () => {
    const project = createProject({ name: 'Prueba' });
    project.floor.vertices.push({ x: 6, z: 0 });
    const parsed = parseProject(project);
    expect(parsed.edges).toHaveLength(parsed.floor.vertices.length);
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
  });

  it('elimina vínculos de expositor que ya no existen', () => {
    const project = createProject({ name: 'Vínculos' });
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
    project.edges[0].exhibitorId = 'exp_ok';
    project.edges[1].exhibitorId = 'exp_inexistente';
    project.internalWalls = [
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
    project.openings = [
      {
        id: 'open_1',
        wallId: project.edges[0].id,
        kind: 'door',
        offset: 1,
        width: 0.9,
        height: 2.1,
        sillHeight: 0,
        exhibitorId: 'exp_ok',
      },
      {
        id: 'open_2',
        wallId: project.edges[0].id,
        kind: 'window',
        offset: 2,
        width: 1.2,
        height: 1.2,
        sillHeight: 1,
        exhibitorId: 'exp_inexistente',
      },
    ];

    const parsed = parseProject(project);
    expect(parsed.edges[0].exhibitorId).toBe('exp_ok');
    expect(parsed.edges[1].exhibitorId).toBeNull();
    expect(parsed.internalWalls[0].exhibitorId).toBeNull();
    expect(parsed.openings[0].exhibitorId).toBe('exp_ok');
    expect(parsed.openings[1].exhibitorId).toBeNull();
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
  });

  it('remapea expositores, muros y aberturas al duplicar', () => {
    const project = createProject({ name: 'Original' });
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
    project.edges[0].exhibitorId = 'exp_original';
    project.internalWalls = [
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
    project.openings = [
      {
        id: 'open_original',
        wallId: project.edges[0].id,
        kind: 'door',
        offset: 1,
        width: 0.9,
        height: 2.1,
        sillHeight: 0,
        exhibitorId: 'exp_original',
      },
    ];

    const copy = duplicateProject(project);
    expect(copy.exhibitors[0].id).not.toBe('exp_original');
    expect(copy.edges[0].exhibitorId).toBe(copy.exhibitors[0].id);
    expect(copy.internalWalls[0].exhibitorId).toBe(copy.exhibitors[0].id);
    expect(copy.openings[0].exhibitorId).toBe(copy.exhibitors[0].id);
    expect(copy.openings[0].wallId).toBe(copy.edges[0].id);
  });
});
