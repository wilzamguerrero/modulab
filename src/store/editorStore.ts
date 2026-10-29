import { create } from 'zustand';
import type {
  CatalogItem,
  EditorTool,
  EditorView,
  Exhibitor,
  InternalWall,
  LightConfig,
  OpeningKind,
  PlanDrawMode,
  Project,
  RotationPoint,
  SceneObject,
  Selection,
  TransformMode,
  Vec2,
  Vec3,
  WallOpening,
} from '@/types/project';
import {
  createEdgeConfig,
  createInternalWall,
  defaultExhibitorCamera,
  openingDefaults,
  primitiveSize,
} from '@/data/defaults';
import { normalizeEdges, normalizeExhibitorLinks, normalizeOpenings } from '@/data/projectSchema';
import { createId } from '@/utils/id';
import { DEFAULT_EXHIBITOR_COLOR } from '@/utils/exhibitorColors';
import { polygonCentroid } from '@/utils/geometry';
import { getWallById, pointAtWallOffset, pointOffsetOnWall, wallLength } from '@/utils/walls';

export type SaveStatus = 'idle' | 'dirty' | 'saving' | 'saved' | 'error';

/** Eje al que se puede bloquear el segundo punto de una medida. */
export type MeasureAxis = 'none' | 'x' | 'y' | 'z';

interface PatchOptions {
  history?: boolean;
  coalesceKey?: string;
  touch?: boolean;
}

function revokePreviewUrl(url?: string | null): void {
  if (url && url.startsWith('blob:')) {
    try {
      URL.revokeObjectURL(url);
    } catch {
      // Ignorar si ya no es válido.
    }
  }
}

export interface Measurement {
  id: string;
  a: Vec3;
  b: Vec3;
}

interface EditorState {
  project: Project | null;
  projectId: string | null;
  loading: boolean;
  loadError: string | null;

  selection: Selection;
  tool: EditorTool;
  view: EditorView;
  transformMode: TransformMode;
  planDrawMode: PlanDrawMode;
  pendingCatalogItem: CatalogItem | null;
  clipboardObject: SceneObject | null;

  past: Project[];
  future: Project[];
  pendingHistory: Project | null;
  lastCoalesce: { key?: string; at: number } | null;
  dirty: boolean;
  saveStatus: SaveStatus;
  saveError: string | null;
  notionSaveStatus: 'idle' | 'saving' | 'saved' | 'error';
  notionError: string | null;
  lastSavedAt: string | null;

  loadProjectData: (project: Project) => void;
  clearProject: () => void;
  setLoading: (loading: boolean) => void;
  setLoadError: (message: string | null) => void;

  patchProject: (updater: (draft: Project) => Project | void, options?: PatchOptions) => void;
  replaceProject: (project: Project, history?: boolean) => void;
  beginHistory: () => void;
  commitHistory: () => void;
  cancelHistory: () => void;
  undo: () => void;
  redo: () => void;

  setSelection: (selection: Selection) => void;
  setTool: (tool: EditorTool) => void;
  setView: (view: EditorView) => void;
  setTransformMode: (mode: TransformMode) => void;
  setPlanDrawMode: (mode: PlanDrawMode) => void;
  setPendingCatalogItem: (item: CatalogItem | null) => void;
  setClipboardObject: (object: SceneObject | null) => void;

  setSaveStatus: (status: SaveStatus, error?: string | null) => void;
  markSaved: (date?: string) => void;
  setNotionSaveStatus: (status: EditorState['notionSaveStatus'], error?: string | null) => void;

  setPlanVertices: (vertices: Vec2[], options?: PatchOptions) => void;
  replacePlan: (vertices: Vec2[]) => void;
  insertVertexOnEdge: (edgeIndex: number, point: Vec2) => void;
  removeVertex: (index: number) => void;
  moveVertex: (index: number, point: Vec2, options?: PatchOptions) => void;
  setEdge: (index: number, patch: Partial<Project['edges'][number]>, options?: PatchOptions) => void;
  toggleWall: (index: number) => void;
  setDefaultWall: (patch: Partial<Project['defaultWall']>) => void;
  applyWallSettingsToAll: () => void;
  setFloorMaterial: (patch: Partial<Project['floor']>) => void;

  addInternalWall: (a: Vec2, b: Vec2) => string | null;
  addInternalWallLoop: (points: Vec2[]) => string[];
  updateInternalWall: (id: string, patch: Partial<InternalWall>, options?: PatchOptions) => void;
  moveInternalWallPoint: (
    id: string,
    endpoint: 'a' | 'b',
    point: Vec2,
    options?: PatchOptions,
  ) => void;
  insertVertexOnInternalWall: (id: string, point: Vec2) => void;
  deleteInternalWall: (id: string) => void;
  addOpening: (wallId: string, kind: OpeningKind, offset: number) => string | null;
  updateOpening: (id: string, patch: Partial<WallOpening>, options?: PatchOptions) => void;
  deleteOpening: (id: string) => void;

  addObject: (item: CatalogItem, position: Vec2) => string | null;
  updateObject: (id: string, patch: Partial<SceneObject>, options?: PatchOptions) => void;
  updateObjectTransform: (id: string, transform: Partial<SceneObject['transform']>, options?: PatchOptions) => void;
  setObjectSize: (id: string, size: Vec3) => void;
  setObjectOverride: (
    id: string,
    slotKey: string,
    override: SceneObject['overrides'][string],
    options?: PatchOptions,
  ) => void;
  clearObjectOverrides: (id: string) => void;
  deleteObject: (id: string) => void;
  duplicateObject: (id: string) => string | null;
  pasteObject: () => string | null;
  assignObjectToExhibitor: (objectId: string, exhibitorId: string | null) => void;

  addExhibitor: (position: Vec2) => string | null;
  updateExhibitor: (id: string, patch: Partial<Exhibitor>, options?: PatchOptions) => void;
  moveExhibitor: (id: string, position: Vec2, options?: PatchOptions) => void;
  deleteExhibitor: (id: string) => void;
  removeMissingExhibitors: () => void;

  addRotationPoint: (position: Vec2) => string | null;
  updateRotationPoint: (id: string, patch: Partial<RotationPoint>, options?: PatchOptions) => void;
  moveRotationPoint: (id: string, position: Vec2, options?: PatchOptions) => void;
  deleteRotationPoint: (id: string) => void;

  addLight: (type: LightConfig['type']) => string | null;
  updateLight: (id: string, patch: Partial<LightConfig>, options?: PatchOptions) => void;
  deleteLight: (id: string) => void;

  setProjectMeta: (patch: Partial<Pick<Project, 'name' | 'description' | 'event'>>) => void;
  setProjectCamera: (camera: Partial<Project['camera']>) => void;
  setEnvironment: (patch: Partial<Project['environment']>) => void;
  /** Vista previa local (blob) del splat, no persistida en el proyecto. */
  environmentPreview: { url: string; format?: 'ply' | 'splat' | 'ksplat' } | null;
  setEnvironmentPreview: (preview: { url: string; format?: 'ply' | 'splat' | 'ksplat' } | null) => void;

  /** Gizmo 3D para alinear el entorno splat. */
  environmentGizmo: boolean;
  environmentGizmoMode: TransformMode;
  setEnvironmentGizmo: (enabled: boolean) => void;
  setEnvironmentGizmoMode: (mode: TransformMode) => void;

  /** Herramienta de medida (clic A → clic B). */
  measureMode: boolean;
  measurePending: Vec3 | null;
  measurements: Measurement[];
  /** Eje bloqueado para el segundo punto; 'none' = libre. */
  measureAxis: MeasureAxis;
  /** Si es false, los puntos no se pegan a la superficie del splat/geometría. */
  measureSnap: boolean;
  /** Punto bajo el cursor mientras se mide, para la guía en vivo. */
  measureHover: Vec3 | null;
  toggleMeasureMode: () => void;
  addMeasurePoint: (point: Vec3) => void;
  updateMeasurementPoint: (id: string, end: 'a' | 'b', point: Vec3) => void;
  clearMeasurements: () => void;
  setMeasureAxis: (axis: MeasureAxis) => void;
  setMeasureSnap: (snap: boolean) => void;
  setMeasureHover: (point: Vec3 | null) => void;

  setSettings: (patch: Partial<Project['settings']>) => void;
}

export const useEditorStore = create<EditorState>()((set, get) => ({
  project: null,
  projectId: null,
  loading: false,
  loadError: null,
  selection: null,
  tool: 'select',
  view: 'plan',
  transformMode: 'translate',
  planDrawMode: 'partition',
  pendingCatalogItem: null,
  clipboardObject: null,
  past: [],
  future: [],
  pendingHistory: null,
  lastCoalesce: null,
  dirty: false,
  saveStatus: 'idle',
  saveError: null,
  notionSaveStatus: 'idle',
  notionError: null,
  lastSavedAt: null,
  environmentPreview: null,
  environmentGizmo: false,
  environmentGizmoMode: 'translate',
  measureMode: false,
  measurePending: null,
  measurements: [],
  measureAxis: 'none',
  measureSnap: true,
  measureHover: null,

  loadProjectData: (project) => {
    revokePreviewUrl(get().environmentPreview?.url);
    set({
      project,
      projectId: project.id,
      loading: false,
      loadError: null,
      selection: null,
      tool: 'select',
      planDrawMode: project.floor.vertices.length >= 3 ? 'partition' : 'outline',
      pendingCatalogItem: null,
      past: [],
      future: [],
      pendingHistory: null,
      lastCoalesce: null,
      dirty: false,
      saveStatus: 'saved',
      saveError: null,
      notionSaveStatus: 'idle',
      notionError: null,
      lastSavedAt: new Date().toISOString(),
      environmentPreview: null,
      measureMode: false,
      measurePending: null,
      measureHover: null,
      measurements: [],
    });
  },

  clearProject: () => {
    revokePreviewUrl(get().environmentPreview?.url);
    set({
      project: null,
      projectId: null,
      loading: false,
      loadError: null,
      selection: null,
      past: [],
      future: [],
      pendingHistory: null,
      dirty: false,
      saveStatus: 'idle',
      environmentPreview: null,
      measurePending: null,
      measureHover: null,
      measurements: [],
    });
  },

  setLoading: (loading) => set({ loading }),
  setLoadError: (loadError) => set({ loadError, loading: false }),

  patchProject: (updater, options = {}) => {
    const current = get().project;
    if (!current) return;
    const draft = structuredClone(current);
    const updated = updater(draft) ?? draft;
    if (options.touch !== false) updated.updatedAt = new Date().toISOString();

    const now = Date.now();
    const coalesceKey = options.coalesceKey;
    const canCoalesce =
      Boolean(coalesceKey) &&
      get().lastCoalesce?.key === coalesceKey &&
      now - (get().lastCoalesce?.at ?? 0) < 900;
    const pushHistory = options.history !== false && !canCoalesce;

    set((state) => ({
      project: updated,
      past: pushHistory ? [...state.past.slice(-59), current] : state.past,
      future: pushHistory ? [] : state.future,
      pendingHistory: pushHistory ? null : state.pendingHistory,
      lastCoalesce: coalesceKey ? { key: coalesceKey, at: now } : pushHistory ? null : state.lastCoalesce,
      dirty: true,
      saveStatus: state.saveStatus === 'saving' ? 'saving' : 'dirty',
      saveError: null,
    }));
  },

  replaceProject: (project, history = true) => {
    const current = get().project;
    set((state) => ({
      project,
      projectId: project.id,
      past: history && current ? [...state.past.slice(-59), current] : state.past,
      future: history ? [] : state.future,
      selection: null,
      pendingHistory: null,
      lastCoalesce: null,
      dirty: true,
      saveStatus: 'dirty',
      saveError: null,
    }));
  },

  beginHistory: () => {
    if (get().pendingHistory) return;
    const project = get().project;
    if (project) set({ pendingHistory: structuredClone(project) });
  },

  commitHistory: () => {
    const pending = get().pendingHistory;
    const current = get().project;
    if (!pending || !current) {
      set({ pendingHistory: null });
      return;
    }
    set((state) => ({
      past: [...state.past.slice(-59), pending],
      future: [],
      pendingHistory: null,
      lastCoalesce: null,
      dirty: true,
      saveStatus: 'dirty',
    }));
  },

  cancelHistory: () => set({ pendingHistory: null }),

  undo: () => {
    const state = get();
    if (!state.project || state.past.length === 0) return;
    const previous = state.past[state.past.length - 1];
    set({
      project: previous,
      projectId: previous.id,
      past: state.past.slice(0, -1),
      future: [state.project, ...state.future].slice(0, 60),
      selection: null,
      pendingHistory: null,
      lastCoalesce: null,
      dirty: true,
      saveStatus: 'dirty',
      saveError: null,
    });
  },

  redo: () => {
    const state = get();
    if (!state.project || state.future.length === 0) return;
    const next = state.future[0];
    set({
      project: next,
      projectId: next.id,
      past: [...state.past.slice(-59), state.project],
      future: state.future.slice(1),
      selection: null,
      pendingHistory: null,
      lastCoalesce: null,
      dirty: true,
      saveStatus: 'dirty',
      saveError: null,
    });
  },

  setSelection: (selection) => set({ selection }),
  setTool: (tool) => set({ tool, pendingCatalogItem: tool === 'select' ? get().pendingCatalogItem : null }),
  setView: (view) => set({ view }),
  setTransformMode: (transformMode) => set({ transformMode }),
  setPlanDrawMode: (planDrawMode) => set({ planDrawMode }),
  setPendingCatalogItem: (pendingCatalogItem) => set({ pendingCatalogItem }),
  setClipboardObject: (clipboardObject) => set({ clipboardObject }),

  setSaveStatus: (saveStatus, saveError = null) => set({ saveStatus, saveError }),
  markSaved: (date = new Date().toISOString()) =>
    set({ dirty: false, saveStatus: 'saved', saveError: null, lastSavedAt: date }),
  setNotionSaveStatus: (notionSaveStatus, notionError = null) => set({ notionSaveStatus, notionError }),

  setPlanVertices: (vertices, options = {}) =>
    get().patchProject((draft) => {
      draft.floor.vertices = vertices.map((vertex) => ({ ...vertex }));
      draft.edges = normalizeEdges(draft.floor.vertices, draft.edges, draft.defaultWall);
      draft.openings = normalizeOpenings(draft);
    }, options),

  replacePlan: (vertices) =>
    get().patchProject((draft) => {
      const oldEdgeIds = new Set(draft.edges.map((edge) => edge.id));
      draft.floor.vertices = vertices.map((vertex) => ({ ...vertex }));
      draft.edges = draft.floor.vertices.map(() =>
        createEdgeConfig({
          height: draft.defaultWall.height,
          thickness: draft.defaultWall.thickness,
          color: draft.defaultWall.color,
        }),
      );
      // Las aberturas perimetrales pertenecen a los bordes anteriores. Las
      // divisiones interiores y sus aberturas se conservan.
      draft.openings = draft.openings.filter((opening) => !oldEdgeIds.has(opening.wallId));
    }),

  insertVertexOnEdge: (edgeIndex, point) => {
    const project = get().project;
    if (!project) return;
    const count = project.floor.vertices.length;
    if (edgeIndex < 0 || edgeIndex >= count) return;
    const source = project.edges[edgeIndex];
    const sourceA = project.floor.vertices[edgeIndex];
    const sourceB = project.floor.vertices[(edgeIndex + 1) % count];
    const splitOffset = sourceA && sourceB
      ? pointOffsetOnWall(point, sourceA, sourceB)
      : 0;
    get().patchProject((draft) => {
      const vertices = [...draft.floor.vertices];
      vertices.splice(edgeIndex + 1, 0, { ...point });
      const edges = [...draft.edges];
      const current = edges[edgeIndex];
      const newEdge = createEdgeConfig({
        wall: current?.wall ?? true,
        height: current?.height ?? draft.defaultWall.height,
        thickness: current?.thickness ?? draft.defaultWall.thickness,
        color: current?.color ?? draft.defaultWall.color,
        exhibitorId: current?.exhibitorId ?? null,
      });
      edges.splice(edgeIndex + 1, 0, newEdge);
      draft.floor.vertices = vertices;
      draft.edges = edges;
      // Las aberturas que quedan en la segunda mitad se trasladan al nuevo
      // borde para que no se deformen al insertar un vértice.
      if (current?.id) {
        draft.openings = draft.openings.map((opening) => {
          if (opening.wallId !== current.id || opening.offset <= splitOffset) return opening;
          return {
            ...opening,
            wallId: newEdge.id,
            offset: Math.max(0.1, opening.offset - splitOffset),
          };
        });
      }
      draft.openings = normalizeOpenings(draft);
    });
    set({ selection: { type: 'vertex', index: edgeIndex + 1 } });
  },

  removeVertex: (index) => {
    const project = get().project;
    if (!project || project.floor.vertices.length <= 3) return;
    get().patchProject((draft) => {
      draft.floor.vertices.splice(index, 1);
      draft.edges.splice(index, 1);
      draft.edges = normalizeEdges(draft.floor.vertices, draft.edges, draft.defaultWall);
      draft.openings = normalizeOpenings(draft);
    });
    set({ selection: null });
  },

  moveVertex: (index, point, options = {}) =>
    get().patchProject((draft) => {
      if (!draft.floor.vertices[index]) return;
      draft.floor.vertices[index] = { ...point };
      draft.openings = normalizeOpenings(draft);
    }, options),

  setEdge: (index, patch, options = {}) =>
    get().patchProject((draft) => {
      if (!draft.edges[index]) return;
      draft.edges[index] = { ...draft.edges[index], ...patch };
    }, options),

  toggleWall: (index) => {
    const project = get().project;
    if (!project?.edges[index]) return;
    get().setEdge(index, { wall: !project.edges[index].wall });
  },

  setDefaultWall: (patch) =>
    get().patchProject((draft) => {
      draft.defaultWall = { ...draft.defaultWall, ...patch };
    }, { coalesceKey: 'default-wall' }),

  applyWallSettingsToAll: () =>
    get().patchProject((draft) => {
      draft.edges = draft.edges.map((edge) => ({
        ...edge,
        height: draft.defaultWall.height,
        thickness: draft.defaultWall.thickness,
        color: draft.defaultWall.color,
      }));
      draft.internalWalls = draft.internalWalls.map((wall) => ({
        ...wall,
        height: draft.defaultWall.height,
        thickness: draft.defaultWall.thickness,
        color: draft.defaultWall.color,
      }));
      draft.openings = normalizeOpenings(draft);
    }),

  setFloorMaterial: (patch) =>
    get().patchProject((draft) => {
      draft.floor = { ...draft.floor, ...patch };
    }, { coalesceKey: 'floor-material' }),

  addInternalWall: (a, b) => {
    const project = get().project;
    if (!project || wallLength(a, b) <= 0.05) return null;
    const wall = createInternalWall(a, b, {
      height: project.defaultWall.height,
      thickness: project.defaultWall.thickness,
      color: project.defaultWall.color,
    });
    get().patchProject((draft) => {
      draft.internalWalls.push(wall);
    });
    set({ selection: { type: 'internalWall', id: wall.id } });
    return wall.id;
  },

  addInternalWallLoop: (points) => {
    const project = get().project;
    if (!project || points.length < 3) return [];
    const walls = points
      .map((point, index) =>
        createInternalWall(point, points[(index + 1) % points.length], {
          height: project.defaultWall.height,
          thickness: project.defaultWall.thickness,
          color: project.defaultWall.color,
        }),
      )
      .filter((wall) => wallLength(wall.a, wall.b) > 0.05);
    if (!walls.length) return [];
    get().patchProject((draft) => {
      draft.internalWalls.push(...walls);
    });
    set({ selection: null });
    return walls.map((wall) => wall.id);
  },

  updateInternalWall: (id, patch, options = {}) =>
    get().patchProject((draft) => {
      const index = draft.internalWalls.findIndex((wall) => wall.id === id);
      if (index < 0) return;
      draft.internalWalls[index] = { ...draft.internalWalls[index], ...patch, id };
      draft.openings = normalizeOpenings(draft);
    }, { coalesceKey: `internal-wall:${id}`, ...options }),

  moveInternalWallPoint: (id, endpoint, point, options = {}) =>
    get().patchProject((draft) => {
      const wall = draft.internalWalls.find((entry) => entry.id === id);
      if (!wall) return;
      const oldPoint = wall[endpoint];
      const tolerance = 0.002;
      draft.internalWalls = draft.internalWalls.map((entry) => {
        if (entry.id === id) {
          return { ...entry, [endpoint]: { ...point } };
        }
        const sharesA = Math.hypot(entry.a.x - oldPoint.x, entry.a.z - oldPoint.z) <= tolerance;
        const sharesB = Math.hypot(entry.b.x - oldPoint.x, entry.b.z - oldPoint.z) <= tolerance;
        if (!sharesA && !sharesB) return entry;
        return {
          ...entry,
          ...(sharesA ? { a: { ...point } } : {}),
          ...(sharesB ? { b: { ...point } } : {}),
        };
      });
      draft.openings = normalizeOpenings(draft);
    }, { coalesceKey: `internal-point:${id}:${endpoint}`, ...options }),

  insertVertexOnInternalWall: (id, point) => {
    const project = get().project;
    const wall = project?.internalWalls.find((entry) => entry.id === id);
    if (!project || !wall) return;
    const length = wallLength(wall.a, wall.b);
    const offset = pointOffsetOnWall(point, wall.a, wall.b);
    if (offset <= 0.1 || length - offset <= 0.1) return;
    const splitPoint = pointAtWallOffset(wall.a, wall.b, offset);
    get().patchProject((draft) => {
      const index = draft.internalWalls.findIndex((entry) => entry.id === id);
      if (index < 0) return;
      const current = draft.internalWalls[index];
      const newWall = createInternalWall(splitPoint, current.b, {
        height: current.height,
        thickness: current.thickness,
        color: current.color,
        exhibitorId: current.exhibitorId ?? null,
      });
      draft.internalWalls[index] = { ...current, b: { ...splitPoint } };
      draft.internalWalls.splice(index + 1, 0, newWall);
      draft.openings = draft.openings.map((opening) => {
        if (opening.wallId !== current.id || opening.offset <= offset) return opening;
        return {
          ...opening,
          wallId: newWall.id,
          offset: Math.max(0.1, opening.offset - offset),
        };
      });
      draft.openings = normalizeOpenings(draft);
    });
    set({ selection: { type: 'internalWall', id } });
  },

  deleteInternalWall: (id) => {
    get().patchProject((draft) => {
      draft.internalWalls = draft.internalWalls.filter((wall) => wall.id !== id);
      draft.openings = draft.openings.filter((opening) => opening.wallId !== id);
    });
    const selection = get().selection;
    if (
      (selection?.type === 'internalWall' && selection.id === id) ||
      (selection?.type === 'opening' && !get().project?.openings.some((opening) => opening.id === selection.id))
    ) {
      set({ selection: null });
    }
  },

  addOpening: (wallId, kind, offset) => {
    const project = get().project;
    if (!project) return null;
    const wall = getWallById(project, wallId);
    if (!wall || (wall.edge && !wall.edge.wall)) return null;
    const length = wallLength(wall.a, wall.b);
    if (length < 0.25) return null;
    const defaults = openingDefaults(kind);
    const width = Math.min(defaults.width, Math.max(0.2, length - 0.1));
    const sillHeight = Math.min(defaults.sillHeight, Math.max(0, wall.height - 0.2));
    const height = Math.max(0.2, Math.min(defaults.height, wall.height - sillHeight));
    const opening: WallOpening = {
      id: createId('open'),
      wallId,
      kind,
      offset: Math.max(width / 2, Math.min(length - width / 2, offset)),
      width,
      height,
      sillHeight,
      exhibitorId: null,
    };
    get().patchProject((draft) => {
      draft.openings.push(opening);
    });
    set({ selection: { type: 'opening', id: opening.id } });
    return opening.id;
  },

  updateOpening: (id, patch, options = {}) =>
    get().patchProject((draft) => {
      const index = draft.openings.findIndex((opening) => opening.id === id);
      if (index < 0) return;
      const next = { ...draft.openings[index], ...patch, id };
      if (next.kind === 'door') next.sillHeight = 0;
      draft.openings[index] = next;
      draft.openings = normalizeOpenings(draft);
    }, { coalesceKey: `opening:${id}`, ...options }),

  deleteOpening: (id) => {
    get().patchProject((draft) => {
      draft.openings = draft.openings.filter((opening) => opening.id !== id);
    });
    const selection = get().selection;
    if (selection?.type === 'opening' && selection.id === id) set({ selection: null });
  },

  addObject: (item, position) => {
    const project = get().project;
    if (!project) return null;
    const id = createId('obj');
    const source: SceneObject['source'] =
      item.kind === 'glb' && item.url && item.file
        ? { type: 'glb', url: item.url, file: item.file, name: item.name }
        : { type: 'primitive', shape: item.shape ?? 'box', name: item.name };
    const object: SceneObject = {
      id,
      name: item.name,
      source,
      transform: {
        position: [position.x, 0, position.z],
        rotationY: 0,
        scale: [1, 1, 1],
      },
      overrides: {},
      visible: true,
      size: source.type === 'primitive' ? primitiveSize(source.shape) : undefined,
      exhibitorId: null,
      locked: false,
    };
    get().patchProject((draft) => {
      draft.objects.push(object);
    });
    set({ selection: { type: 'object', id }, pendingCatalogItem: null });
    return id;
  },

  updateObject: (id, patch, options = {}) =>
    get().patchProject((draft) => {
      const index = draft.objects.findIndex((object) => object.id === id);
      if (index < 0) return;
      draft.objects[index] = { ...draft.objects[index], ...patch };
    }, options),

  updateObjectTransform: (id, transform, options = {}) =>
    get().patchProject((draft) => {
      const object = draft.objects.find((entry) => entry.id === id);
      if (!object) return;
      object.transform = { ...object.transform, ...transform };
    }, options),

  setObjectSize: (id, size) =>
    get().patchProject((draft) => {
      const object = draft.objects.find((entry) => entry.id === id);
      if (!object) return;
      object.size = size;
    }, { history: false, touch: false }),

  setObjectOverride: (id, slotKey, override, options = {}) =>
    get().patchProject((draft) => {
      const object = draft.objects.find((entry) => entry.id === id);
      if (!object) return;
      object.overrides = {
        ...object.overrides,
        [slotKey]: { ...(object.overrides[slotKey] ?? {}), ...override },
      };
    }, options),

  clearObjectOverrides: (id) =>
    get().patchProject((draft) => {
      const object = draft.objects.find((entry) => entry.id === id);
      if (object) object.overrides = {};
    }),

  deleteObject: (id) => {
    get().patchProject((draft) => {
      draft.objects = draft.objects.filter((object) => object.id !== id);
      draft.exhibitors = draft.exhibitors.map((exhibitor) => ({
        ...exhibitor,
        relatedObjectIds: exhibitor.relatedObjectIds.filter((objectId) => objectId !== id),
      }));
    });
    const selection = get().selection;
    if (selection?.type === 'object' && selection.id === id) set({ selection: null });
  },

  duplicateObject: (id) => {
    const project = get().project;
    const source = project?.objects.find((object) => object.id === id);
    if (!source) return null;
    const newId = createId('obj');
    const copy = structuredClone(source);
    copy.id = newId;
    copy.name = source.name;
    copy.transform.position = [
      source.transform.position[0] + 0.5,
      source.transform.position[1],
      source.transform.position[2] + 0.5,
    ];
    get().patchProject((draft) => {
      draft.objects.push(copy);
    });
    set({ selection: { type: 'object', id: newId }, clipboardObject: structuredClone(source) });
    return newId;
  },

  pasteObject: () => {
    const clipboard = get().clipboardObject;
    if (!clipboard) return null;
    const newId = createId('obj');
    const copy = structuredClone(clipboard);
    copy.id = newId;
    copy.transform.position = [
      clipboard.transform.position[0] + 0.5,
      clipboard.transform.position[1],
      clipboard.transform.position[2] + 0.5,
    ];
    get().patchProject((draft) => {
      draft.objects.push(copy);
    });
    set({ selection: { type: 'object', id: newId } });
    return newId;
  },

  assignObjectToExhibitor: (objectId, exhibitorId) =>
    get().patchProject((draft) => {
      const object = draft.objects.find((entry) => entry.id === objectId);
      if (object) object.exhibitorId = exhibitorId;
      draft.exhibitors = draft.exhibitors.map((exhibitor) => ({
        ...exhibitor,
        relatedObjectIds: exhibitor.id === exhibitorId
          ? Array.from(new Set([...exhibitor.relatedObjectIds, objectId]))
          : exhibitor.relatedObjectIds.filter((id) => id !== objectId),
      }));
    }),

  addExhibitor: (position) => {
    const project = get().project;
    if (!project) return null;
    const id = createId('exp');
    const camera = defaultExhibitorCamera(position, project.floor.vertices);
    const exhibitor: Exhibitor = {
      id,
      name: `Expositor ${project.exhibitors.length + 1}`,
      standCode: '',
      description: '',
      color: DEFAULT_EXHIBITOR_COLOR,
      position: { ...position },
      rotation: 0,
      cameraPosition: camera.position,
      cameraTarget: camera.target,
      relatedObjectIds: [],
      visible: true,
      metadata: {},
      notionMissing: false,
    };
    get().patchProject((draft) => {
      draft.exhibitors.push(exhibitor);
    });
    set({ selection: { type: 'exhibitor', id } });
    return id;
  },

  updateExhibitor: (id, patch, options = {}) =>
    get().patchProject((draft) => {
      const index = draft.exhibitors.findIndex((exhibitor) => exhibitor.id === id);
      if (index < 0) return;
      draft.exhibitors[index] = { ...draft.exhibitors[index], ...patch };
    }, { coalesceKey: `exhibitor:${id}`, ...options }),

  moveExhibitor: (id, position, options = {}) =>
    get().patchProject((draft) => {
      const exhibitor = draft.exhibitors.find((entry) => entry.id === id);
      if (!exhibitor) return;
      exhibitor.position = { ...position };
    }, options),

  deleteExhibitor: (id) => {
    get().patchProject((draft) => {
      draft.exhibitors = draft.exhibitors.filter((exhibitor) => exhibitor.id !== id);
      draft.objects = draft.objects.map((object) =>
        object.exhibitorId === id ? { ...object, exhibitorId: null } : object,
      );
      draft.edges = draft.edges.map((edge) =>
        edge.exhibitorId === id ? { ...edge, exhibitorId: null } : edge,
      );
      draft.internalWalls = draft.internalWalls.map((wall) =>
        wall.exhibitorId === id ? { ...wall, exhibitorId: null } : wall,
      );
      draft.openings = draft.openings.map((opening) =>
        opening.exhibitorId === id ? { ...opening, exhibitorId: null } : opening,
      );
      normalizeExhibitorLinks(draft);
    });
    const selection = get().selection;
    if (selection?.type === 'exhibitor' && selection.id === id) set({ selection: null });
  },

  removeMissingExhibitors: () =>
    get().patchProject((draft) => {
      const missingIds = new Set(draft.exhibitors.filter((exhibitor) => exhibitor.notionMissing).map((exhibitor) => exhibitor.id));
      draft.exhibitors = draft.exhibitors.filter((exhibitor) => !missingIds.has(exhibitor.id));
      draft.objects = draft.objects.map((object) =>
        object.exhibitorId && missingIds.has(object.exhibitorId) ? { ...object, exhibitorId: null } : object,
      );
      draft.edges = draft.edges.map((edge) =>
        edge.exhibitorId && missingIds.has(edge.exhibitorId) ? { ...edge, exhibitorId: null } : edge,
      );
      draft.internalWalls = draft.internalWalls.map((wall) =>
        wall.exhibitorId && missingIds.has(wall.exhibitorId) ? { ...wall, exhibitorId: null } : wall,
      );
      draft.openings = draft.openings.map((opening) =>
        opening.exhibitorId && missingIds.has(opening.exhibitorId) ? { ...opening, exhibitorId: null } : opening,
      );
      normalizeExhibitorLinks(draft);
    }),

  addRotationPoint: (position) => {
    const project = get().project;
    if (!project) return null;
    const id = createId('rot');
    const point: RotationPoint = {
      id,
      name: `Punto de rotación ${project.rotationPoints.length + 1}`,
      position: { ...position },
    };
    get().patchProject((draft) => {
      draft.rotationPoints.push(point);
    });
    set({ selection: { type: 'rotationPoint', id } });
    return id;
  },

  updateRotationPoint: (id, patch, options = {}) =>
    get().patchProject((draft) => {
      const index = draft.rotationPoints.findIndex((entry) => entry.id === id);
      if (index < 0) return;
      draft.rotationPoints[index] = { ...draft.rotationPoints[index], ...patch, id };
    }, { coalesceKey: `rotation-point:${id}`, ...options }),

  moveRotationPoint: (id, position, options = {}) =>
    get().patchProject((draft) => {
      const point = draft.rotationPoints.find((entry) => entry.id === id);
      if (!point) return;
      point.position = { ...position };
    }, { coalesceKey: `rotation-move:${id}`, ...options }),

  deleteRotationPoint: (id) => {
    get().patchProject((draft) => {
      draft.rotationPoints = draft.rotationPoints.filter((entry) => entry.id !== id);
    });
    const selection = get().selection;
    if (selection?.type === 'rotationPoint' && selection.id === id) set({ selection: null });
  },

  addLight: (type) => {
    const project = get().project;
    if (!project) return null;
    const id = createId('light');
    const center = polygonCentroid(project.floor.vertices);
    const count = project.lights.filter((light) => light.type === type).length + 1;
    const names: Record<LightConfig['type'], string> = {
      ambient: 'Luz ambiental',
      hemisphere: 'Luz hemisférica',
      directional: 'Luz direccional',
      point: 'Luz puntual',
      spot: 'Foco',
    };
    const light: LightConfig = {
      id,
      type,
      name: `${names[type]} ${count}`,
      color: type === 'directional' ? '#fff4df' : '#ffffff',
      intensity: type === 'ambient' ? 0.6 : type === 'hemisphere' ? 0.7 : 2,
      position:
        type === 'directional'
          ? [center.x + 6, 9, center.z + 6]
          : type === 'spot'
            ? [center.x, 4.5, center.z]
            : [center.x, type === 'point' ? 3 : 6, center.z],
      target: [center.x, 0, center.z],
      distance: type === 'point' || type === 'spot' ? 18 : undefined,
      angle: type === 'spot' ? Math.PI / 5 : undefined,
      penumbra: type === 'spot' ? 0.45 : undefined,
      castShadow: type === 'directional',
      enabled: true,
    };
    get().patchProject((draft) => {
      draft.lights.push(light);
    });
    set({ selection: { type: 'light', id } });
    return id;
  },

  updateLight: (id, patch, options = {}) =>
    get().patchProject((draft) => {
      const index = draft.lights.findIndex((light) => light.id === id);
      if (index < 0) return;
      draft.lights[index] = { ...draft.lights[index], ...patch };
    }, { coalesceKey: `light:${id}`, ...options }),

  deleteLight: (id) => {
    get().patchProject((draft) => {
      draft.lights = draft.lights.filter((light) => light.id !== id);
    });
    const selection = get().selection;
    if (selection?.type === 'light' && selection.id === id) set({ selection: null });
  },

  setProjectMeta: (patch) =>
    get().patchProject((draft) => {
      if (typeof patch.name === 'string') draft.name = patch.name;
      if (typeof patch.description === 'string') draft.description = patch.description;
      if (typeof patch.event === 'string') draft.event = patch.event;
    }, { coalesceKey: `meta:${Object.keys(patch).join(',')}` }),

  setProjectCamera: (camera) =>
    get().patchProject((draft) => {
      draft.camera = { ...draft.camera, ...camera };
    }, { coalesceKey: 'camera' }),

  setEnvironment: (patch) =>
    get().patchProject((draft) => {
      draft.environment = { ...draft.environment, ...patch };
    }, { coalesceKey: 'environment' }),

  setEnvironmentPreview: (preview) =>
    set((state) => {
      if (state.environmentPreview?.url !== preview?.url) {
        revokePreviewUrl(state.environmentPreview?.url);
      }
      return { environmentPreview: preview };
    }),

  setEnvironmentGizmo: (enabled) => set({ environmentGizmo: enabled }),
  setEnvironmentGizmoMode: (mode) => set({ environmentGizmoMode: mode }),

  toggleMeasureMode: () =>
    set((state) => ({ measureMode: !state.measureMode, measurePending: null, measureHover: null })),
  addMeasurePoint: (point) =>
    set((state) => {
      if (!state.measurePending) return { measurePending: point };
      const measurement: Measurement = { id: createId('mes'), a: state.measurePending, b: point };
      return { measurePending: null, measurements: [...state.measurements, measurement] };
    }),
  updateMeasurementPoint: (id, end, point) =>
    set((state) => ({
      measurements: state.measurements.map((measurement) =>
        measurement.id === id ? { ...measurement, [end]: point } : measurement,
      ),
    })),
  clearMeasurements: () => set({ measurements: [], measurePending: null, measureHover: null }),
  setMeasureAxis: (measureAxis) => set({ measureAxis }),
  setMeasureSnap: (measureSnap) => set({ measureSnap }),
  setMeasureHover: (measureHover) => set({ measureHover }),

  setSettings: (patch) =>
    get().patchProject((draft) => {
      draft.settings = { ...draft.settings, ...patch };
    }, { history: false }),
}));
