import type { EdgeConfig, Level, Project, Space, Vec2, WallOpening } from '@/types/project';
import { projectSchema } from '@/types/project';
import { createEdgeConfig, createLevel, createSpace } from './defaults';
import { createId } from '@/utils/id';
import { DEFAULT_EXHIBITOR_COLOR } from '@/utils/exhibitorColors';
import { getWallById, wallLength } from '@/utils/walls';

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

export function normalizeSpace(space: Space, defaultWall: Project['defaultWall']): Space {
  const edges = normalizeEdges(space.vertices, space.edges, defaultWall);
  const holes = space.holes.filter((hole) => hole.vertices.length >= 3);
  return { ...space, edges, holes };
}

/**
 * Migra proyectos v1 (planta única en la raíz) a v2 (niveles). Es idempotente:
 * un proyecto que ya tiene `levels` se devuelve tal cual con `schemaVersion: 2`.
 */
function migrateProject(source: Record<string, any>): Record<string, any> {
  if (Array.isArray(source.levels) && source.levels.length > 0) {
    return {
      ...source,
      schemaVersion: 2,
      floor: undefined,
      edges: undefined,
      internalWalls: undefined,
      openings: undefined,
    };
  }

  const legacyFloor = source.floor && typeof source.floor === 'object' ? source.floor : {};
  if (legacyFloor.vertices !== undefined && !Array.isArray(legacyFloor.vertices)) {
    throw new ProjectParseError('La planta del proyecto no es válida.');
  }
  const legacyVertices = Array.isArray(legacyFloor.vertices) ? legacyFloor.vertices : [];
  const legacyEdges = Array.isArray(source.edges) ? source.edges : [];
  const legacyWalls = Array.isArray(source.internalWalls) ? source.internalWalls : [];
  const legacyOpenings = Array.isArray(source.openings) ? source.openings : [];

  const level = createLevel('Planta baja', 0, {
    spaces: [
      createSpace(legacyVertices, {
        name: 'Espacio 1',
        edges: legacyEdges,
        color: legacyFloor.color,
        roughness: legacyFloor.roughness,
        metalness: legacyFloor.metalness,
      }),
    ],
    internalWalls: legacyWalls,
    openings: legacyOpenings,
  });
  const levelId = level.id;
  const assignLevel = <T extends Record<string, any>>(entity: T): T => ({
    ...entity,
    levelId: entity.levelId ?? levelId,
  });

  return {
    ...source,
    schemaVersion: 2,
    levels: [level],
    floor: undefined,
    edges: undefined,
    internalWalls: undefined,
    openings: undefined,
    objects: (Array.isArray(source.objects) ? source.objects : [])
      .map(assignLevel)
      .map((object: any) => ({ code: '', showCode: true, showName: false, ...object })),
    exhibitors: (Array.isArray(source.exhibitors) ? source.exhibitors : []).map(assignLevel),
  };
}

/** Acepta datos de IndexedDB, Notion o un archivo exportado y devuelve un proyecto válido. */
export function parseProject(raw: unknown): Project {
  if (!raw || typeof raw !== 'object') {
    throw new ProjectParseError('El archivo del proyecto está vacío o no es un objeto JSON.');
  }
  const now = new Date().toISOString();
  const source = migrateProject(raw as Record<string, any>);
  const candidate = {
    ...source,
    schemaVersion: 2,
    id: typeof source.id === 'string' && source.id ? source.id : createId('prj'),
    createdAt: typeof source.createdAt === 'string' ? source.createdAt : now,
    updatedAt: typeof source.updatedAt === 'string' ? source.updatedAt : now,
    levels:
      Array.isArray(source.levels) && source.levels.length > 0
        ? source.levels.map((level: any, levelIndex: number) => ({
            ...level,
            id: typeof level?.id === 'string' && level.id ? level.id : createId(`lvl${levelIndex}`),
            spaces: Array.isArray(level?.spaces)
              ? level.spaces.map((space: any, spaceIndex: number) => ({
                  ...space,
                  id:
                    typeof space?.id === 'string' && space.id
                      ? space.id
                      : createId(`spc${spaceIndex}`),
                  edges: Array.isArray(space?.edges)
                    ? space.edges.map((edge: any, edgeIndex: number) => ({
                        ...edge,
                        id:
                          typeof edge?.id === 'string' && edge.id
                            ? edge.id
                            : createId(`edge${edgeIndex}`),
                      }))
                    : [],
                  holes: Array.isArray(space?.holes)
                    ? space.holes.map((hole: any, holeIndex: number) => ({
                        ...hole,
                        id:
                          typeof hole?.id === 'string' && hole.id
                            ? hole.id
                            : createId(`hole${holeIndex}`),
                      }))
                    : [],
                }))
              : [],
            internalWalls: Array.isArray(level?.internalWalls)
              ? level.internalWalls.map((wall: any, index: number) => ({
                  ...wall,
                  id: typeof wall?.id === 'string' && wall.id ? wall.id : createId(`wall${index}`),
                }))
              : [],
            openings: Array.isArray(level?.openings)
              ? level.openings.map((opening: any, index: number) => ({
                  ...opening,
                  id:
                    typeof opening?.id === 'string' && opening.id
                      ? opening.id
                      : createId(`open${index}`),
                }))
              : [],
            stairs: Array.isArray(level?.stairs)
              ? level.stairs.map((stair: any, index: number) => ({
                  ...stair,
                  id: typeof stair?.id === 'string' && stair.id ? stair.id : createId(`stair${index}`),
                }))
              : [],
          }))
        : [createLevel('Planta baja', 0, { spaces: [createSpace([], { name: 'Espacio 1' })] })],
  };
  const result = projectSchema.safeParse(candidate);
  if (!result.success) {
    throw new ProjectParseError(
      'El proyecto no cumple el esquema de datos de Modulab.',
      result.error.issues.map((issue) => `${issue.path.join('.') || 'proyecto'}: ${issue.message}`),
    );
  }
  const project = result.data;

  for (const level of project.levels) {
    level.spaces = level.spaces.map((space) => normalizeSpace(space, project.defaultWall));
    level.internalWalls = level.internalWalls.filter(
      (wall) => wallLength(wall.a, wall.b) > 0.05,
    );
    level.openings = normalizeOpenings(level);
  }

  const levelIds = new Set(project.levels.map((level) => level.id));
  const fallbackLevel = project.levels[0]?.id ?? null;
  const validLevel = (id: string | null | undefined) =>
    id && levelIds.has(id) ? id : fallbackLevel;
  project.objects = project.objects.map((object) => ({
    ...object,
    levelId: validLevel(object.levelId),
    // Los proyectos antiguos no tienen código: se rellena con el nombre del
    // archivo del catálogo (p. ej. `b1.glb` → `b1`) para poder mostrarlo.
    code:
      object.code ||
      (object.source.type === 'glb'
        ? object.source.file.replace(/\.glb$/i, '')
        : object.name),
  }));
  project.exhibitors = project.exhibitors.map((exhibitor) => ({
    ...exhibitor,
    levelId: validLevel(exhibitor.levelId),
  }));
  project.accesses = project.accesses.map((access) => ({
    ...access,
    levelId: validLevel(access.levelId),
  }));

  // Una ficha sin vínculo a Notion nunca puede estar «ausente» en Notion.
  project.exhibitors = project.exhibitors.map((exhibitor) => ({
    ...exhibitor,
    color: exhibitor.color || DEFAULT_EXHIBITOR_COLOR,
    notionMissing: exhibitor.notionBlockId ? exhibitor.notionMissing : false,
  }));
  normalizeExhibitorLinks(project);
  return project;
}

/** Elimina vínculos huérfanos después de borrar o sincronizar expositores. */
export function normalizeExhibitorLinks(project: Project): void {
  const ids = new Set(project.exhibitors.map((exhibitor) => exhibitor.id));
  const valid = (id: string | null | undefined) => (id && ids.has(id) ? id : null);
  project.objects = project.objects.map((object) => ({
    ...object,
    exhibitorId: valid(object.exhibitorId),
  }));
  for (const level of project.levels) {
    level.spaces = level.spaces.map((space) => ({
      ...space,
      edges: space.edges.map((edge) => ({ ...edge, exhibitorId: valid(edge.exhibitorId) })),
    }));
    level.internalWalls = level.internalWalls.map((wall) => ({
      ...wall,
      exhibitorId: valid(wall.exhibitorId),
    }));
    level.openings = level.openings.map((opening) => ({
      ...opening,
      exhibitorId: valid(opening.exhibitorId),
    }));
  }
}

export function normalizeOpenings(level: Level): WallOpening[] {
  return level.openings
    .map((opening) => {
      const wall = getWallById(level, opening.wallId);
      if (!wall) return null;
      const length = wallLength(wall.a, wall.b);
      if (length <= 0.05) return null;
      const width = Math.max(0.2, Math.min(opening.width, Math.max(0.2, length - 0.02)));
      const offset = Math.max(width / 2, Math.min(length - width / 2, opening.offset));
      const sillHeight = opening.kind === 'door'
        ? 0
        : Math.max(0, Math.min(opening.sillHeight, Math.max(0, wall.height - 0.2)));
      const height = Math.max(0.2, Math.min(opening.height, Math.max(0.2, wall.height - sillHeight)));
      return { ...opening, width, offset, sillHeight, height };
    })
    .filter((opening): opening is WallOpening => Boolean(opening));
}

export function cloneProject(project: Project): Project {
  return structuredClone(project);
}

export function duplicateProject(project: Project, name?: string): Project {
  const copy = structuredClone(project);
  const objectIdMap = new Map<string, string>();
  const exhibitorIdMap = new Map<string, string>();
  const levelIdMap = new Map<string, string>();

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
  copy.accesses = copy.accesses.map((access) => ({
    ...access,
    id: createId('access'),
  }));

  const remapExhibitor = (exhibitorId: string | null | undefined) =>
    exhibitorId ? exhibitorIdMap.get(exhibitorId) ?? null : null;
  const remapLevel = (levelId: string | null | undefined) =>
    levelId ? levelIdMap.get(levelId) ?? levelId : levelId;

  copy.levels = copy.levels.map((level) => {
    const levelId = createId('lvl');
    levelIdMap.set(level.id, levelId);
    const wallIdMap = new Map<string, string>();
    const spaces = level.spaces.map((space) => {
      const edges = space.edges.map((edge) => {
        const id = createId('edge');
        wallIdMap.set(edge.id, id);
        return { ...edge, id, exhibitorId: remapExhibitor(edge.exhibitorId) };
      });
      return {
        ...space,
        id: createId('spc'),
        edges,
        holes: (space.holes ?? []).map((hole) => ({ ...hole, id: createId('hole') })),
      };
    });
    const internalWalls = level.internalWalls.map((wall) => {
      const id = createId('wall');
      wallIdMap.set(wall.id, id);
      return { ...wall, id, exhibitorId: remapExhibitor(wall.exhibitorId) };
    });
    const openings = level.openings.map((opening) => ({
      ...opening,
      id: createId('open'),
      wallId: wallIdMap.get(opening.wallId) ?? opening.wallId,
      exhibitorId: remapExhibitor(opening.exhibitorId),
    }));
    const stairs = level.stairs.map((stair) => ({ ...stair, id: createId('stair') }));
    return { ...level, id: levelId, spaces, internalWalls, openings, stairs };
  });

  copy.objects = copy.objects.map((object) => ({
    ...object,
    exhibitorId: object.exhibitorId
      ? exhibitorIdMap.get(object.exhibitorId) ?? null
      : object.exhibitorId,
    levelId: remapLevel(object.levelId),
  }));
  copy.exhibitors = copy.exhibitors.map((exhibitor) => ({
    ...exhibitor,
    levelId: remapLevel(exhibitor.levelId),
  }));
  copy.accesses = copy.accesses.map((access) => ({
    ...access,
    levelId: remapLevel(access.levelId),
  }));
  return copy;
}

export function projectSummary(project: Project) {
  const outline =
    project.levels
      .flatMap((level) => level.spaces)
      .find((space) => space.vertices.length >= 3)?.vertices ?? [];
  return {
    id: project.id,
    name: project.name,
    description: project.description,
    event: project.event,
    updatedAt: project.updatedAt,
    createdAt: project.createdAt,
    objectCount: project.objects.length,
    exhibitorCount: project.exhibitors.length,
    vertices: outline.map((vertex) => ({ ...vertex })),
    notionBlockId: project.notionBlockId,
    published: project.published,
  };
}
