import { create } from 'zustand';
import type {
  CatalogItem,
  EditorTool,
  EditorView,
  Exhibitor,
  LightConfig,
  Project,
  SceneObject,
  Selection,
  TransformMode,
  Vec2,
  Vec3,
} from '@/types/project';
import { createEdgeConfig, defaultExhibitorCamera, primitiveSize } from '@/data/defaults';
import { normalizeEdges } from '@/data/projectSchema';
import { createId } from '@/utils/id';
import { polygonCentroid } from '@/utils/geometry';

export type SaveStatus = 'idle' | 'dirty' | 'saving' | 'saved' | 'error';

interface PatchOptions {
  history?: boolean;
  coalesceKey?: string;
  touch?: boolean;
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

  addLight: (type: LightConfig['type']) => string | null;
  updateLight: (id: string, patch: Partial<LightConfig>, options?: PatchOptions) => void;
  deleteLight: (id: string) => void;

  setProjectMeta: (patch: Partial<Pick<Project, 'name' | 'description' | 'event'>>) => void;
  setProjectCamera: (camera: Partial<Project['camera']>) => void;
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

  loadProjectData: (project) =>
    set({
      project,
      projectId: project.id,
      loading: false,
      loadError: null,
      selection: null,
      tool: 'select',
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
    }),

  clearProject: () =>
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
    }),

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
    }, options),

  replacePlan: (vertices) =>
    get().patchProject((draft) => {
      draft.floor.vertices = vertices.map((vertex) => ({ ...vertex }));
      draft.edges = draft.floor.vertices.map(() =>
        createEdgeConfig({
          height: draft.defaultWall.height,
          thickness: draft.defaultWall.thickness,
          color: draft.defaultWall.color,
        }),
      );
    }),

  insertVertexOnEdge: (edgeIndex, point) => {
    const project = get().project;
    if (!project) return;
    const count = project.floor.vertices.length;
    if (edgeIndex < 0 || edgeIndex >= count) return;
    get().patchProject((draft) => {
      const vertices = [...draft.floor.vertices];
      vertices.splice(edgeIndex + 1, 0, { ...point });
      const edges = [...draft.edges];
      const source = edges[edgeIndex];
      edges.splice(
        edgeIndex + 1,
        0,
        createEdgeConfig({
          wall: source?.wall ?? true,
          height: source?.height ?? draft.defaultWall.height,
          thickness: source?.thickness ?? draft.defaultWall.thickness,
          color: source?.color ?? draft.defaultWall.color,
        }),
      );
      draft.floor.vertices = vertices;
      draft.edges = edges;
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
    });
    set({ selection: null });
  },

  moveVertex: (index, point, options = {}) =>
    get().patchProject((draft) => {
      if (!draft.floor.vertices[index]) return;
      draft.floor.vertices[index] = { ...point };
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
    }),

  setFloorMaterial: (patch) =>
    get().patchProject((draft) => {
      draft.floor = { ...draft.floor, ...patch };
    }, { coalesceKey: 'floor-material' }),

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
    }),

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

  setSettings: (patch) =>
    get().patchProject((draft) => {
      draft.settings = { ...draft.settings, ...patch };
    }, { history: false }),
}));
