import { describe, expect, it } from 'vitest';
import { createProject } from './defaults';
import { duplicateProject, parseProject, ProjectParseError } from './projectSchema';

describe('project data', () => {
  it('crea un proyecto con piso, muros, luces y cámara', () => {
    const project = createProject({ name: 'Muestra MAD', template: 't-shape' });
    expect(project.floor.vertices).toHaveLength(8);
    expect(project.edges).toHaveLength(8);
    expect(project.lights.length).toBeGreaterThan(0);
    expect(project.camera.position).toHaveLength(3);
    expect(project.schemaVersion).toBe(1);
    expect(project.settings.shadowQuality).toBe('medium');
  });

  it('aplica calidad de sombras media a proyectos antiguos sin ese ajuste', () => {
    const project = createProject({ name: 'Proyecto antiguo' });
    const legacy = structuredClone(project) as Partial<typeof project>;
    delete legacy.settings;

    const parsed = parseProject(legacy);
    expect(parsed.settings.shadowQuality).toBe('medium');
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
});
