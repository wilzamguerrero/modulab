import type { EdgeConfig, Project, Vec2 } from '@/types/project';
import { projectSchema } from '@/types/project';
import { createEdgeConfig } from './defaults';
import { createId } from '@/utils/id';

export class ProjectParseError extends Error {
  readonly issues: string[];
  constructor(message: string, issues: string[] = []) {
    super(message);
    this.name = 'ProjectParseError';
    this.issues = issues;
  }
}

export function normalizeEdges(
  vertices: Vec2[],
  edges: EdgeConfig[],
  defaultWall: Project['defaultWall'],
): EdgeConfig[] {
  return vertices.map((_, index) => {
    const existing = edges[index];
    if (!existing) {
      return createEdgeConfig({
        height: defaultWall.height,
        thickness: defaultWall.thickness,
        color: defaultWall.color,
      });
    }
    return {
      ...existing,
      id: existing.id || createId('edge'),
      wall: existing.wall !== false,
      height: Number.isFinite(existing.height) ? existing.height : defaultWall.height,
      thickness: Number.isFinite(existing.thickness) ? existing.thickness : defaultWall.thickness,
      color: existing.color || defaultWall.color,
    };
  });
}

/** Acepta datos de IndexedDB, Notion o un archivo exportado y devuelve un proyecto válido. */
export function parseProject(raw: unknown): Project {
  if (!raw || typeof raw !== 'object') {
    throw new ProjectParseError('El archivo del proyecto está vacío o no es un objeto JSON.');
  }
  const source = raw as Record<string, any>;
  const now = new Date().toISOString();
  const candidate = {
    ...source,
    schemaVersion: source.schemaVersion ?? 1,
    id: typeof source.id === 'string' && source.id ? source.id : createId('prj'),
    createdAt: typeof source.createdAt === 'string' ? source.createdAt : now,
    updatedAt: typeof source.updatedAt === 'string' ? source.updatedAt : now,
    edges: Array.isArray(source.edges)
      ? source.edges.map((edge: any, index: number) => ({
          ...edge,
          id: typeof edge?.id === 'string' && edge.id ? edge.id : createId(`edge${index}`),
        }))
      : [],
  };
  const result = projectSchema.safeParse(candidate);
  if (!result.success) {
    throw new ProjectParseError(
      'El proyecto no cumple el esquema de datos de Modulab.',
      result.error.issues.map((issue) => `${issue.path.join('.') || 'proyecto'}: ${issue.message}`),
    );
  }
  const project = result.data;
  project.edges = normalizeEdges(project.floor.vertices, project.edges, project.defaultWall);
  // Una ficha sin vínculo a Notion nunca puede estar «ausente» en Notion.
  // Esto repara también proyectos guardados antes de esta regla.
  project.exhibitors = project.exhibitors.map((exhibitor) => ({
    ...exhibitor,
    notionMissing: exhibitor.notionBlockId ? exhibitor.notionMissing : false,
  }));
  if (!project.lights.length) {
    project.lights = [];
  }
  return project;
}

export function cloneProject(project: Project): Project {
  return structuredClone(project);
}

export function duplicateProject(project: Project, name?: string): Project {
  const copy = structuredClone(project);
  const objectIdMap = new Map<string, string>();
  const exhibitorIdMap = new Map<string, string>();

  copy.id = createId('prj');
  copy.name = name ?? `${project.name} (copia)`;
  copy.createdAt = new Date().toISOString();
  copy.updatedAt = copy.createdAt;
  copy.notionBlockId = undefined;
  copy.notionLastSyncedAt = undefined;
  copy.published = undefined;
  copy.objects = copy.objects.map((object) => {
    const id = createId('obj');
    objectIdMap.set(object.id, id);
    return { ...object, id };
  });
  copy.exhibitors = copy.exhibitors.map((exhibitor) => {
    const id = createId('exp');
    exhibitorIdMap.set(exhibitor.id, id);
    return {
      ...exhibitor,
      id,
      notionBlockId: undefined,
      notionMissing: false,
      relatedObjectIds: exhibitor.relatedObjectIds
        .map((objectId) => objectIdMap.get(objectId))
        .filter((value): value is string => Boolean(value)),
    };
  });
  copy.objects = copy.objects.map((object) => ({
    ...object,
    exhibitorId: object.exhibitorId ? exhibitorIdMap.get(object.exhibitorId) ?? null : object.exhibitorId,
  }));
  copy.edges = copy.edges.map((edge) => ({ ...edge, id: createId('edge') }));
  return copy;
}

export function projectSummary(project: Project) {
  return {
    id: project.id,
    name: project.name,
    description: project.description,
    event: project.event,
    updatedAt: project.updatedAt,
    createdAt: project.createdAt,
    objectCount: project.objects.length,
    exhibitorCount: project.exhibitors.length,
    vertices: project.floor.vertices.map((vertex) => ({ ...vertex })),
    notionBlockId: project.notionBlockId,
    published: project.published,
  };
}
