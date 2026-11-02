import { create } from 'zustand';
import type {
  CatalogItem,
  EdgeConfig,
  EditorTool,
  EditorView,
  Exhibitor,
  InternalWall,
  Level,
  LightConfig,
  OpeningKind,
  PlanDrawMode,
  Project,
  RotationPoint,
  SceneObject,
  Selection,
  Space,
  Stair,
  TransformMode,
  Vec2,
  Vec3,
  WallOpening,
} from '@/types/project';
import {
  createEdgeConfig,
  createInternalWall,
  createLevel,
  createSpace,
  createStair,
  defaultExhibitorCamera,
  openingDefaults,
  primitiveSize,
} from '@/data/defaults';
import { normalizeEdges, normalizeExhibitorLinks, normalizeOpenings } from '@/data/projectSchema';
import { createId } from '@/utils/id';
import { DEFAULT_EXHIBITOR_COLOR } from '@/utils/exhibitorColors';
import { pointInPolygon, polygonCentroid } from '@/utils/geometry';
import { applyLevelTransform, levelPivot, normalizeAngle } from '@/utils/levelTransform';
import {
  defaultLevelId,
  getLevel,
  getSpace,
  levelVertices,
  suggestLevelElevation,
} from '@/utils/levels';
import {
  findWallInProject,
  getWallById,
  pointAtWallOffset,
  pointOffsetOnWall,
  wallLength,
} from '@/utils/walls';

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

/** Instantánea reversible de todo lo que cambia con el editor. */
interface HistorySnapshot {
  project: Project;
  measurements: Measurement[];
  activeLevelId: string | null;
  activeSpaceId: string | null;
}

/** Nivel activo o, si no existe, el primero del proyecto. */
function resolveLevel(project: Project, levelId: string | null): Level | undefined {
  return project.levels.find((level) => level.id === levelId) ?? project.levels[0];
}

/** Espacio activo dentro del nivel o el primero disponible. */
function resolveSpace(level: Level | undefined, spaceId: string | null): Space | undefined {
  if (!level) return undefined;
  return level.spaces.find((space) => space.id === spaceId) ?? level.spaces[0];
}

/** Nivel que contiene un muro o abertura concreto. */
function levelForWall(project: Project, levelId: string | null, wallId: string): Level | undefined {
  const active = resolveLevel(project, levelId);
  if (active && getWallById(active, wallId)) return active;
  return findWallInProject(project, wallId)?.level;
}

function levelForOpening(
  project: Project,
  levelId: string | null,
  openingId: string,
): Level | undefined {
  const active = resolveLevel(project, levelId);
  if (active?.openings.some((opening) => opening.id === openingId)) return active;
  return project.levels.find((level) =>
    level.openings.some((opening) => opening.id === openingId),
  );
}

function levelForStair(project: Project, levelId: string | null, stairId: string): Level | undefined {
  const active = resolveLevel(project, levelId);
  if (active?.stairs.some((stair) => stair.id === stairId)) return active;
  return project.levels.find((level) => level.stairs.some((stair) => stair.id === stairId));
}

/** Devuelve ids activos válidos para un proyecto restaurado por undo/redo. */
function validActiveIds(
  project: Project,
  levelId: string | null,
  spaceId: string | null,
): { activeLevelId: string | null; activeSpaceId: string | null } {
  const level = project.levels.find((entry) => entry.id === levelId) ?? project.levels[0];
  const space = level?.spaces.find((entry) => entry.id === spaceId) ?? level?.spaces[0];
  return { activeLevelId: level?.id ?? null, activeSpaceId: space?.id ?? null };
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
  /** Nivel y espacio sobre los que trabajan las herramientas de planta. */
  activeLevelId: string | null;
  activeSpaceId: string | null;
  setActiveLevel: (levelId: string) => void;
  setActiveSpace: (spaceId: string) => void;
  addLevel: (direction?: 'above' | 'below') => string | null;
  updateLevel: (id: string, patch: Partial<Level>, options?: PatchOptions) => void;
  deleteLevel: (id: string) => void;
  duplicateLevel: (id: string) => string | null;
  /**
   * Mueve y gira un nivel completo con todo lo que está apoyado en él (espacios,
   * huecos, muros libres, escaleras, objetos, expositores y puntos de rotación).
   * Existe para reacomodar un piso sobre otro de una vez, sin ir elemento a
   * elemento.
   */
  transformLevel: (
    id: string,
    transform: { delta?: Vec2; angle?: number; pivot?: Vec2 },
    options?: PatchOptions,
  ) => void;
  /**
   * Previsualización en vivo de un arrastre del gizmo: recalcula el proyecto a
   * partir de la instantánea tomada al empezar, así que el piso sigue al cursor
   * sin acumular deriva. No registra historial; lo hace `commitHistory`.
   */
  previewLevelTransform: (
    id: string,
    base: Project,
    transform: { delta?: Vec2; angle?: number; pivot?: Vec2 },
  ) => void;
  /** Centro de giro natural del nivel (su centroide en planta). */
  levelPivotOf: (id: string) => Vec2 | null;
  /**
   * Nivel seleccionado para moverlo/girarlo entero con el gizmo 3D.
   * `null` = gizmo apagado.
   */
  levelGizmoId: string | null;
  levelGizmoMode: 'translate' | 'rotate';
  setLevelGizmo: (levelId: string | null, mode?: 'translate' | 'rotate') => void;
  setLevelGizmoMode: (mode: 'translate' | 'rotate') => void;

  addSpace: (vertices: Vec2[], name?: string) => string | null;
  updateSpace: (id: string, patch: Partial<Space>, options?: PatchOptions) => void;
  deleteSpace: (id: string) => void;
  /** Recorte del suelo del espacio activo (hueco para escaleras). */
  addHole: (vertices: Vec2[]) => string | null;
  cutRectHole: (vertices: Vec2[]) => string | null;
  deleteHole: (id: string) => void;
  /** Mueve el hueco completo por un delta en planta. */
  moveHole: (id: string, delta: Vec2, options?: PatchOptions) => void;
  /** Coloca el centro del hueco en un punto (usado por el gizmo 3D). */
  setHoleCenter: (id: string, center: Vec2, options?: PatchOptions) => void;
  /** Redimensiona un hueco rectangular alrededor de su centro. */
  resizeHole: (id: string, width: number, depth: number, options?: PatchOptions) => void;
  /** Desplaza un vértice del hueco (polígono libre o rectángulo). */
  setHoleVertex: (id: string, index: number, point: Vec2, options?: PatchOptions) => void;
  /** Renombra un corte de suelo. */
  renameHole: (id: string, name: string, options?: PatchOptions) => void;
  addStair: (position: Vec2) => string | null;
  updateStair: (id: string, patch: Partial<Stair>, options?: PatchOptions) => void;
  moveStair: (id: string, position: Vec2, options?: PatchOptions) => void;
  deleteStair: (id: string) => void;

  /**
   * Historial (deshacer/rehacer) de pasos del editor. Cada entrada guarda el
   * proyecto completo y las medidas, para que Ctrl+Z también deshaga medidas,
   * entorno y cualquier cambio, no solo geometría.
   */
  past: HistorySnapshot[];
  future: HistorySnapshot[];
  pendingHistory: HistorySnapshot | null;
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
  /** Empuja una instantánea (proyecto + medidas) al historial. */
  pushHistory: () => void;
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
  setEdge: (index: number, patch: Partial<EdgeConfig>, options?: PatchOptions) => void;
  toggleWall: (index: number) => void;
  setDefaultWall: (patch: Partial<Project['defaultWall']>) => void;
  applyWallSettingsToAll: () => void;
  setFloorMaterial: (
    patch: Partial<Pick<Space, 'color' | 'roughness' | 'metalness' | 'thickness'>>,
  ) => void;
  /** Espesor del forjado en metros para todos los espacios del nivel activo. */
  setLevelFloorThickness: (thickness: number) => void;

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
  /** Medida seleccionada (resaltada y editable desde el panel). */
  activeMeasurementId: string | null;
  toggleMeasureMode: () => void;
  addMeasurePoint: (point: Vec3) => void;
  updateMeasurementPoint: (id: string, end: 'a' | 'b', point: Vec3) => void;
  /** Mueve la medida completa (ambos extremos) manteniendo su longitud. */
  moveMeasurement: (id: string, a: Vec3, b: Vec3) => void;
  deleteMeasurement: (id: string) => void;
  setActiveMeasurement: (id: string | null) => void;
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
  activeLevelId: null,
  activeSpaceId: null,
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
  levelGizmoId: null,
  levelGizmoMode: 'translate',
  measureMode: false,
  measurePending: null,
  measurements: [],
  measureAxis: 'none',
  measureSnap: true,
  measureHover: null,
  activeMeasurementId: null,

  loadProjectData: (project) => {
    revokePreviewUrl(get().environmentPreview?.url);
    const firstLevel = project.levels[0];
    const firstSpace = firstLevel?.spaces[0];
    set({
      project,
      projectId: project.id,
      loading: false,
      loadError: null,
      selection: null,
      tool: 'select',
      activeLevelId: firstLevel?.id ?? null,
      activeSpaceId: firstSpace?.id ?? null,
      planDrawMode: (firstSpace?.vertices.length ?? 0) >= 3 ? 'partition' : 'outline',
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
      activeMeasurementId: null,
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
      activeLevelId: null,
      activeSpaceId: null,
      past: [],
      future: [],
      pendingHistory: null,
      dirty: false,
      saveStatus: 'idle',
      environmentPreview: null,
      measurePending: null,
      measureHover: null,
      measurements: [],
      activeMeasurementId: null,
    });
  },

  setLoading: (loading) => set({ loading }),
  setLoadError: (loadError) => set({ loadError, loading: false }),

  pushHistory: () => {
    const project = get().project;
    if (!project) return;
    const snapshot: HistorySnapshot = {
      project: structuredClone(project),
      measurements: structuredClone(get().measurements),
      activeLevelId: get().activeLevelId,
      activeSpaceId: get().activeSpaceId,
    };
    set((state) => ({
      past: [...state.past.slice(-59), snapshot],
      future: [],
      pendingHistory: null,
      lastCoalesce: null,
      dirty: true,
      saveStatus: state.saveStatus === 'saving' ? 'saving' : 'dirty',
    }));
  },

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
      past: pushHistory
        ? [
            ...state.past.slice(-59),
            {
              project: current,
              measurements: structuredClone(state.measurements),
              activeLevelId: state.activeLevelId,
              activeSpaceId: state.activeSpaceId,
            },
          ]
        : state.past,
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
      past:
        history && current
          ? [
              ...state.past.slice(-59),
              {
                project: current,
                measurements: structuredClone(state.measurements),
                activeLevelId: state.activeLevelId,
                activeSpaceId: state.activeSpaceId,
              },
            ]
          : state.past,
      future: history ? [] : state.future,
      selection: null,
      ...validActiveIds(project, state.activeLevelId, state.activeSpaceId),
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
    if (project) {
      set({
        pendingHistory: {
          project: structuredClone(project),
          measurements: structuredClone(get().measurements),
          activeLevelId: get().activeLevelId,
          activeSpaceId: get().activeSpaceId,
        },
      });
    }
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
      project: previous.project,
      projectId: previous.project.id,
      measurements: previous.measurements,
      ...validActiveIds(previous.project, previous.activeLevelId, previous.activeSpaceId),
      past: state.past.slice(0, -1),
      future: [
        {
          project: state.project,
          measurements: structuredClone(state.measurements),
          activeLevelId: state.activeLevelId,
          activeSpaceId: state.activeSpaceId,
        },
        ...state.future,
      ].slice(0, 60),
      selection: null,
      activeMeasurementId: null,
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
      project: next.project,
      projectId: next.project.id,
      measurements: next.measurements,
      ...validActiveIds(next.project, next.activeLevelId, next.activeSpaceId),
      past: [
        ...state.past.slice(-59),
        {
          project: state.project,
          measurements: structuredClone(state.measurements),
          activeLevelId: state.activeLevelId,
          activeSpaceId: state.activeSpaceId,
        },
      ],
      future: state.future.slice(1),
      selection: null,
      activeMeasurementId: null,
      pendingHistory: null,
      lastCoalesce: null,
      dirty: true,
      saveStatus: 'dirty',
      saveError: null,
    });
  },

  setSelection: (selection) =>
    set((state) => ({
      selection,
      // Seleccionar un piso muestra su gizmo directamente: así basta con hacer
      // clic en el forjado (en planta o en 3D) para poder moverlo o girarlo
      // entero, sin pasar por los botones del panel de niveles. Al seleccionar
      // cualquier otro elemento el gizmo se apaga para no tener dos a la vez.
      levelGizmoId: selection?.type === 'level' ? selection.id : null,
      levelGizmoMode: state.levelGizmoMode,
    })),
  setTool: (tool) => set({ tool, pendingCatalogItem: tool === 'select' ? get().pendingCatalogItem : null }),
  setView: (view) => set({ view }),
  setTransformMode: (transformMode) => set({ transformMode }),
  setPlanDrawMode: (planDrawMode) => set({ planDrawMode }),
  setPendingCatalogItem: (pendingCatalogItem) => set({ pendingCatalogItem }),
  setClipboardObject: (clipboardObject) => set({ clipboardObject }),

  setActiveLevel: (levelId) => {
    const project = get().project;
    const level = project?.levels.find((entry) => entry.id === levelId);
    if (!level) return;
    const space = level.spaces[0];
    set({
      activeLevelId: level.id,
      activeSpaceId: space?.id ?? null,
      selection: null,
      // El gizmo pertenece a un piso concreto: al cambiar de nivel se apaga.
      levelGizmoId: get().levelGizmoId === level.id ? level.id : null,
      planDrawMode: (space?.vertices.length ?? 0) >= 3 ? 'partition' : 'outline',
    });
  },

  setActiveSpace: (spaceId) => {
    const project = get().project;
    if (!project) return;
    const level = resolveLevel(project, get().activeLevelId);
    const space = level?.spaces.find((entry) => entry.id === spaceId);
    if (!space) return;
    set({
      activeSpaceId: space.id,
      selection: null,
      // El gizmo de piso va ligado a una selección: al cambiar de espacio se
      // apaga, igual que al seleccionar cualquier otro elemento.
      levelGizmoId: null,
      planDrawMode: space.vertices.length >= 3 ? 'partition' : 'outline',
    });
  },

  addLevel: (direction = 'above') => {
    const project = get().project;
    if (!project) return null;
    const elevation = suggestLevelElevation(project, direction);
    const name = `Nivel ${project.levels.length + 1}`;
    const level = createLevel(name, elevation, {
      spaces: [createSpace([], { name: 'Espacio 1' })],
    });
    get().patchProject((draft) => {
      draft.levels.push(level);
    });
    set({
      activeLevelId: level.id,
      activeSpaceId: level.spaces[0]?.id ?? null,
      selection: null,
      planDrawMode: 'outline',
      tool: 'draw',
      view: 'plan',
    });
    return level.id;
  },

  updateLevel: (id, patch, options = {}) =>
    get().patchProject((draft) => {
      const level = draft.levels.find((entry) => entry.id === id);
      if (!level) return;
      Object.assign(level, patch, { id: level.id });
    }, { coalesceKey: `level:${id}`, ...options }),

  deleteLevel: (id) => {
    const project = get().project;
    if (!project || project.levels.length <= 1) return;
    get().patchProject((draft) => {
      draft.levels = draft.levels.filter((level) => level.id !== id);
      draft.objects = draft.objects.filter((object) => object.levelId !== id);
      draft.exhibitors = draft.exhibitors.filter((exhibitor) => exhibitor.levelId !== id);
      draft.rotationPoints = draft.rotationPoints.filter((point) => point.levelId !== id);
    });
    const next = get().project;
    if (next) set({ selection: null, ...validActiveIds(next, get().activeLevelId, get().activeSpaceId) });
  },

  duplicateLevel: (id) => {
    const project = get().project;
    const source = project?.levels.find((level) => level.id === id);
    if (!project || !source) return null;
    const level = structuredClone(source);
    level.id = createId('lvl');
    level.name = `${source.name} (copia)`;
    level.elevation = suggestLevelElevation(project, 'above');
    const wallIds = new Map<string, string>();
    level.spaces = level.spaces.map((space) => ({
      ...space,
      id: createId('spc'),
      edges: space.edges.map((edge) => {
        const edgeId = createId('edge');
        wallIds.set(edge.id, edgeId);
        return { ...edge, id: edgeId };
      }),
    }));
    level.internalWalls = level.internalWalls.map((wall) => {
      const wallId = createId('wall');
      wallIds.set(wall.id, wallId);
      return { ...wall, id: wallId };
    });
    level.openings = level.openings.map((opening) => ({
      ...opening,
      id: createId('open'),
      wallId: wallIds.get(opening.wallId) ?? opening.wallId,
    }));
    level.stairs = level.stairs.map((stair) => ({ ...stair, id: createId('stair') }));
    get().patchProject((draft) => {
      draft.levels.push(level);
    });
    set({
      activeLevelId: level.id,
      activeSpaceId: level.spaces[0]?.id ?? null,
      selection: null,
    });
    return level.id;
  },

  addSpace: (vertices, name) => {
    const project = get().project;
    if (!project) return null;
    const level = resolveLevel(project, get().activeLevelId);
    if (!level) return null;
    const space = createSpace(vertices, {
      name: name ?? `Espacio ${level.spaces.length + 1}`,
    });
    get().patchProject((draft) => {
      const target = draft.levels.find((entry) => entry.id === level.id);
      target?.spaces.push(space);
    });
    set({
      activeSpaceId: space.id,
      selection: null,
      planDrawMode: space.vertices.length >= 3 ? 'partition' : 'outline',
    });
    return space.id;
  },

  updateSpace: (id, patch, options = {}) =>
    get().patchProject((draft) => {
      for (const level of draft.levels) {
        const space = level.spaces.find((entry) => entry.id === id);
        if (!space) continue;
        Object.assign(space, patch, { id: space.id });
        level.openings = normalizeOpenings(level);
        break;
      }
    }, options),

  deleteSpace: (id) => {
    get().patchProject((draft) => {
      for (const level of draft.levels) {
        const index = level.spaces.findIndex((entry) => entry.id === id);
        if (index < 0) continue;
        level.spaces.splice(index, 1);
        level.openings = normalizeOpenings(level);
        break;
      }
    });
    const next = get().project;
    if (next) set({ selection: null, ...validActiveIds(next, get().activeLevelId, get().activeSpaceId) });
  },

  addHole: (vertices) => {
    if (vertices.length < 3) return null;
    const project = get().project;
    if (!project) return null;
    const level = resolveLevel(project, get().activeLevelId);
    const space = resolveSpace(level, get().activeSpaceId);
    if (!level || !space) return null;
    const hole = {
      id: createId('hole'),
      name: `Hueco ${space.holes.length + 1}`,
      vertices: vertices.map((vertex) => ({ ...vertex })),
    };
    get().patchProject((draft) => {
      const draftLevel = resolveLevel(draft, get().activeLevelId);
      const draftSpace = resolveSpace(draftLevel, get().activeSpaceId);
      draftSpace?.holes.push(hole);
    });
    set({ selection: { type: 'hole', id: hole.id, spaceId: space.id } });
    return hole.id;
  },

  moveHole: (id, delta, options = {}) =>
    get().patchProject((draft) => {
      for (const level of draft.levels) {
        for (const space of level.spaces) {
          const hole = space.holes.find((entry) => entry.id === id);
          if (!hole) continue;
          hole.vertices = hole.vertices.map((vertex) => ({
            x: vertex.x + delta.x,
            z: vertex.z + delta.z,
          }));
        }
      }
    }, { coalesceKey: `hole-move:${id}`, ...options }),

  setHoleCenter: (id, center, options = {}) =>
    get().patchProject((draft) => {
      for (const level of draft.levels) {
        for (const space of level.spaces) {
          const hole = space.holes.find((entry) => entry.id === id);
          if (!hole || hole.vertices.length < 3) continue;
          let minX = Infinity;
          let maxX = -Infinity;
          let minZ = Infinity;
          let maxZ = -Infinity;
          for (const vertex of hole.vertices) {
            minX = Math.min(minX, vertex.x);
            maxX = Math.max(maxX, vertex.x);
            minZ = Math.min(minZ, vertex.z);
            maxZ = Math.max(maxZ, vertex.z);
          }
          const cx = (minX + maxX) / 2;
          const cz = (minZ + maxZ) / 2;
          hole.vertices = hole.vertices.map((vertex) => ({
            x: vertex.x + (center.x - cx),
            z: vertex.z + (center.z - cz),
          }));
        }
      }
    }, { coalesceKey: `hole-center:${id}`, ...options }),

  resizeHole: (id, width, depth, options = {}) =>
    get().patchProject((draft) => {
      for (const level of draft.levels) {
        for (const space of level.spaces) {
          const hole = space.holes.find((entry) => entry.id === id);
          if (!hole || hole.vertices.length < 3) continue;
          let minX = Infinity;
          let maxX = -Infinity;
          let minZ = Infinity;
          let maxZ = -Infinity;
          for (const vertex of hole.vertices) {
            minX = Math.min(minX, vertex.x);
            maxX = Math.max(maxX, vertex.x);
            minZ = Math.min(minZ, vertex.z);
            maxZ = Math.max(maxZ, vertex.z);
          }
          const cx = (minX + maxX) / 2;
          const cz = (minZ + maxZ) / 2;
          const sx = Math.max(0.2, width) / Math.max(1e-4, maxX - minX);
          const sz = Math.max(0.2, depth) / Math.max(1e-4, maxZ - minZ);
          hole.vertices = hole.vertices.map((vertex) => ({
            x: cx + (vertex.x - cx) * sx,
            z: cz + (vertex.z - cz) * sz,
          }));
        }
      }
    }, { coalesceKey: `hole-resize:${id}`, ...options }),

  setHoleVertex: (id, index, point, options = {}) =>
    get().patchProject((draft) => {
      for (const level of draft.levels) {
        for (const space of level.spaces) {
          const hole = space.holes.find((entry) => entry.id === id);
          if (!hole?.vertices[index]) continue;
          hole.vertices[index] = { ...point };
        }
      }
    }, { coalesceKey: `hole-vertex:${id}:${index}`, ...options }),

  renameHole: (id, name, options = {}) =>
    get().patchProject((draft) => {
      for (const level of draft.levels) {
        for (const space of level.spaces) {
          const hole = space.holes.find((entry) => entry.id === id);
          if (hole) hole.name = name;
        }
      }
    }, { coalesceKey: `hole-name:${id}`, ...options }),

  deleteHole: (id) => {
    get().patchProject((draft) => {
      for (const level of draft.levels) {
        for (const space of level.spaces) {
          const index = space.holes.findIndex((hole) => hole.id === id);
          if (index >= 0) {
            space.holes.splice(index, 1);
            return;
          }
        }
      }
    });
    const selection = get().selection;
    if (selection?.type === 'hole' && selection.id === id) set({ selection: null });
  },

  cutRectHole: (vertices) => {
    if (vertices.length < 4) return null;
    const project = get().project;
    if (!project) return null;
    const level = resolveLevel(project, get().activeLevelId);
    if (!level) return null;
    const inside = (space: Space) =>
      space.vertices.length >= 3 && vertices.every((point) => pointInPolygon(point, space.vertices));
    const above = project.levels
      .filter((entry) => entry.elevation > level.elevation + 0.2)
      .sort((a, b) => a.elevation - b.elevation);
    let found: { levelId: string; spaceId: string } | null = null;
    for (const candidate of [...above, level]) {
      const space = candidate.spaces.find(inside);
      if (space) {
        found = { levelId: candidate.id, spaceId: space.id };
        break;
      }
    }
    if (!found) return null;
    const { levelId, spaceId } = found;
    const holeId = createId('hole');
    get().patchProject((draft) => {
      const target = draft.levels.find((entry) => entry.id === levelId);
      const space = target?.spaces.find((entry) => entry.id === spaceId);
      space?.holes.push({
        id: holeId,
        name: 'Hueco escalera',
        vertices: vertices.map((vertex) => ({ ...vertex })),
      });
    });
    set({ selection: { type: 'hole', id: holeId, spaceId } });
    return holeId;
  },

  addStair: (position) => {
    const project = get().project;
    if (!project) return null;
    const level = resolveLevel(project, get().activeLevelId);
    if (!level) return null;
    const above = project.levels
      .filter((entry) => entry.elevation > level.elevation + 0.2)
      .sort((a, b) => a.elevation - b.elevation)[0];
    const rise = above
      ? Math.min(20, above.elevation - level.elevation)
      : Math.max(0.3, project.defaultWall.height);
    const stair = createStair(position, { rise });
    get().patchProject((draft) => {
      const target = draft.levels.find((entry) => entry.id === level.id);
      target?.stairs.push(stair);
    });
    set({ selection: { type: 'stair', id: stair.id } });
    return stair.id;
  },

  updateStair: (id, patch, options = {}) =>
    get().patchProject((draft) => {
      const level = levelForStair(draft, get().activeLevelId, id);
      const stair = level?.stairs.find((entry) => entry.id === id);
      if (!stair) return;
      Object.assign(stair, patch, { id: stair.id });
    }, { coalesceKey: `stair:${id}`, ...options }),

  moveStair: (id, position, options = {}) =>
    get().patchProject((draft) => {
      const level = levelForStair(draft, get().activeLevelId, id);
      const stair = level?.stairs.find((entry) => entry.id === id);
      if (!stair) return;
      stair.position = { ...position };
    }, { coalesceKey: `stair-move:${id}`, ...options }),

  deleteStair: (id) => {
    get().patchProject((draft) => {
      const level = levelForStair(draft, get().activeLevelId, id);
      if (level) level.stairs = level.stairs.filter((stair) => stair.id !== id);
    });
    const selection = get().selection;
    if (selection?.type === 'stair' && selection.id === id) set({ selection: null });
  },

  setSaveStatus: (saveStatus, saveError = null) => set({ saveStatus, saveError }),
  markSaved: (date = new Date().toISOString()) =>
    set({ dirty: false, saveStatus: 'saved', saveError: null, lastSavedAt: date }),
  setNotionSaveStatus: (notionSaveStatus, notionError = null) => set({ notionSaveStatus, notionError }),

  setPlanVertices: (vertices, options = {}) =>
    get().patchProject((draft) => {
      const level = resolveLevel(draft, get().activeLevelId);
      const space = resolveSpace(level, get().activeSpaceId);
      if (!level || !space) return;
      space.vertices = vertices.map((vertex) => ({ ...vertex }));
      space.edges = normalizeEdges(space.vertices, space.edges, draft.defaultWall);
      level.openings = normalizeOpenings(level);
    }, options),

  replacePlan: (vertices) =>
    get().patchProject((draft) => {
      const level = resolveLevel(draft, get().activeLevelId);
      const space = resolveSpace(level, get().activeSpaceId);
      if (!level || !space) return;
      const oldEdgeIds = new Set(space.edges.map((edge) => edge.id));
      space.vertices = vertices.map((vertex) => ({ ...vertex }));
      space.edges = space.vertices.map(() =>
        createEdgeConfig({
          height: draft.defaultWall.height,
          thickness: draft.defaultWall.thickness,
          color: draft.defaultWall.color,
        }),
      );
      // Las aberturas perimetrales pertenecen a los bordes anteriores. Las
      // divisiones interiores y sus aberturas se conservan.
      level.openings = level.openings.filter((opening) => !oldEdgeIds.has(opening.wallId));
    }),

  insertVertexOnEdge: (edgeIndex, point) => {
    const project = get().project;
    if (!project) return;
    const level = resolveLevel(project, get().activeLevelId);
    const space = resolveSpace(level, get().activeSpaceId);
    if (!level || !space) return;
    const count = space.vertices.length;
    if (edgeIndex < 0 || edgeIndex >= count) return;
    const sourceA = space.vertices[edgeIndex];
    const sourceB = space.vertices[(edgeIndex + 1) % count];
    const splitOffset = sourceA && sourceB
      ? pointOffsetOnWall(point, sourceA, sourceB)
      : 0;
    get().patchProject((draft) => {
      const draftLevel = resolveLevel(draft, get().activeLevelId);
      const draftSpace = resolveSpace(draftLevel, get().activeSpaceId);
      if (!draftLevel || !draftSpace) return;
      const vertices = [...draftSpace.vertices];
      vertices.splice(edgeIndex + 1, 0, { ...point });
      const edges = [...draftSpace.edges];
      const current = edges[edgeIndex];
      const newEdge = createEdgeConfig({
        wall: current?.wall ?? true,
        height: current?.height ?? draft.defaultWall.height,
        thickness: current?.thickness ?? draft.defaultWall.thickness,
        color: current?.color ?? draft.defaultWall.color,
        exhibitorId: current?.exhibitorId ?? null,
      });
      edges.splice(edgeIndex + 1, 0, newEdge);
      draftSpace.vertices = vertices;
      draftSpace.edges = edges;
      // Las aberturas que quedan en la segunda mitad se trasladan al nuevo
      // borde para que no se deformen al insertar un vértice.
      if (current?.id) {
        draftLevel.openings = draftLevel.openings.map((opening) => {
          if (opening.wallId !== current.id || opening.offset <= splitOffset) return opening;
          return {
            ...opening,
            wallId: newEdge.id,
            offset: Math.max(0.1, opening.offset - splitOffset),
          };
        });
      }
      draftLevel.openings = normalizeOpenings(draftLevel);
    });
    set({ selection: { type: 'vertex', index: edgeIndex + 1, spaceId: space.id } });
  },

  removeVertex: (index) => {
    const project = get().project;
    if (!project) return;
    const level = resolveLevel(project, get().activeLevelId);
    const space = resolveSpace(level, get().activeSpaceId);
    if (!space || space.vertices.length <= 3) return;
    get().patchProject((draft) => {
      const draftLevel = resolveLevel(draft, get().activeLevelId);
      const draftSpace = resolveSpace(draftLevel, get().activeSpaceId);
      if (!draftLevel || !draftSpace) return;
      draftSpace.vertices.splice(index, 1);
      draftSpace.edges.splice(index, 1);
      draftSpace.edges = normalizeEdges(draftSpace.vertices, draftSpace.edges, draft.defaultWall);
      draftLevel.openings = normalizeOpenings(draftLevel);
    });
    set({ selection: null });
  },

  moveVertex: (index, point, options = {}) =>
    get().patchProject((draft) => {
      const level = resolveLevel(draft, get().activeLevelId);
      const space = resolveSpace(level, get().activeSpaceId);
      if (!level || !space?.vertices[index]) return;
      space.vertices[index] = { ...point };
      level.openings = normalizeOpenings(level);
    }, options),

  setEdge: (index, patch, options = {}) =>
    get().patchProject((draft) => {
      const space = resolveSpace(resolveLevel(draft, get().activeLevelId), get().activeSpaceId);
      if (!space?.edges[index]) return;
      space.edges[index] = { ...space.edges[index], ...patch };
    }, options),

  toggleWall: (index) => {
    const project = get().project;
    if (!project) return;
    const space = resolveSpace(resolveLevel(project, get().activeLevelId), get().activeSpaceId);
    if (!space?.edges[index]) return;
    get().setEdge(index, { wall: !space.edges[index].wall });
  },

  setDefaultWall: (patch) =>
    get().patchProject((draft) => {
      draft.defaultWall = { ...draft.defaultWall, ...patch };
    }, { coalesceKey: 'default-wall' }),

  applyWallSettingsToAll: () =>
    get().patchProject((draft) => {
      const level = resolveLevel(draft, get().activeLevelId);
      if (!level) return;
      level.spaces = level.spaces.map((space) => ({
        ...space,
        edges: space.edges.map((edge) => ({
          ...edge,
          height: draft.defaultWall.height,
          thickness: draft.defaultWall.thickness,
          color: draft.defaultWall.color,
        })),
      }));
      level.internalWalls = level.internalWalls.map((wall) => ({
        ...wall,
        height: draft.defaultWall.height,
        thickness: draft.defaultWall.thickness,
        color: draft.defaultWall.color,
      }));
      level.openings = normalizeOpenings(level);
    }),

  setFloorMaterial: (patch) =>
    get().patchProject((draft) => {
      const space = resolveSpace(resolveLevel(draft, get().activeLevelId), get().activeSpaceId);
      if (!space) return;
      Object.assign(space, patch);
    }, { coalesceKey: 'floor-material' }),

  setLevelFloorThickness: (thickness) =>
    get().patchProject((draft) => {
      const level = resolveLevel(draft, get().activeLevelId);
      if (!level) return;
      const value = Math.max(0.02, Math.min(2, thickness));
      for (const space of level.spaces) space.thickness = value;
    }, { coalesceKey: 'floor-thickness' }),

  addInternalWall: (a, b) => {
    const project = get().project;
    if (!project || wallLength(a, b) <= 0.05) return null;
    const wall = createInternalWall(a, b, {
      height: project.defaultWall.height,
      thickness: project.defaultWall.thickness,
      color: project.defaultWall.color,
    });
    get().patchProject((draft) => {
      resolveLevel(draft, get().activeLevelId)?.internalWalls.push(wall);
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
      resolveLevel(draft, get().activeLevelId)?.internalWalls.push(...walls);
    });
    set({ selection: null });
    return walls.map((wall) => wall.id);
  },

  updateInternalWall: (id, patch, options = {}) =>
    get().patchProject((draft) => {
      const level = resolveLevel(draft, get().activeLevelId);
      const index = level?.internalWalls.findIndex((wall) => wall.id === id) ?? -1;
      if (!level || index < 0) return;
      level.internalWalls[index] = { ...level.internalWalls[index], ...patch, id };
      level.openings = normalizeOpenings(level);
    }, { coalesceKey: `internal-wall:${id}`, ...options }),

  moveInternalWallPoint: (id, endpoint, point, options = {}) =>
    get().patchProject((draft) => {
      const level = resolveLevel(draft, get().activeLevelId);
      const wall = level?.internalWalls.find((entry) => entry.id === id);
      if (!level || !wall) return;
      const oldPoint = wall[endpoint];
      const tolerance = 0.002;
      level.internalWalls = level.internalWalls.map((entry) => {
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
      level.openings = normalizeOpenings(level);
    }, { coalesceKey: `internal-point:${id}:${endpoint}`, ...options }),

  insertVertexOnInternalWall: (id, point) => {
    const project = get().project;
    const level = project ? resolveLevel(project, get().activeLevelId) : undefined;
    const wall = level?.internalWalls.find((entry) => entry.id === id);
    if (!level || !wall) return;
    const length = wallLength(wall.a, wall.b);
    const offset = pointOffsetOnWall(point, wall.a, wall.b);
    if (offset <= 0.1 || length - offset <= 0.1) return;
    const splitPoint = pointAtWallOffset(wall.a, wall.b, offset);
    get().patchProject((draft) => {
      const draftLevel = resolveLevel(draft, get().activeLevelId);
      const index = draftLevel?.internalWalls.findIndex((entry) => entry.id === id) ?? -1;
      if (!draftLevel || index < 0) return;
      const current = draftLevel.internalWalls[index];
      const newWall = createInternalWall(splitPoint, current.b, {
        height: current.height,
        thickness: current.thickness,
        color: current.color,
        exhibitorId: current.exhibitorId ?? null,
      });
      draftLevel.internalWalls[index] = { ...current, b: { ...splitPoint } };
      draftLevel.internalWalls.splice(index + 1, 0, newWall);
      draftLevel.openings = draftLevel.openings.map((opening) => {
        if (opening.wallId !== current.id || opening.offset <= offset) return opening;
        return {
          ...opening,
          wallId: newWall.id,
          offset: Math.max(0.1, opening.offset - offset),
        };
      });
      draftLevel.openings = normalizeOpenings(draftLevel);
    });
    set({ selection: { type: 'internalWall', id } });
  },

  deleteInternalWall: (id) => {
    get().patchProject((draft) => {
      const level = resolveLevel(draft, get().activeLevelId);
      if (!level) return;
      level.internalWalls = level.internalWalls.filter((wall) => wall.id !== id);
      level.openings = level.openings.filter((opening) => opening.wallId !== id);
    });
    const selection = get().selection;
    if (
      (selection?.type === 'internalWall' && selection.id === id) ||
      (selection?.type === 'opening' &&
        !get().project?.levels.some((level) =>
          level.openings.some((opening) => opening.id === selection.id),
        ))
    ) {
      set({ selection: null });
    }
  },

  addOpening: (wallId, kind, offset) => {
    const project = get().project;
    if (!project) return null;
    const level = levelForWall(project, get().activeLevelId, wallId);
    const wall = level ? getWallById(level, wallId) : undefined;
    if (!level || !wall || (wall.edge && !wall.edge.wall)) return null;
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
      const target = draft.levels.find((entry) => entry.id === level.id);
      target?.openings.push(opening);
    });
    set({ selection: { type: 'opening', id: opening.id } });
    return opening.id;
  },

  updateOpening: (id, patch, options = {}) =>
    get().patchProject((draft) => {
      const level = levelForOpening(draft, get().activeLevelId, id);
      const index = level?.openings.findIndex((opening) => opening.id === id) ?? -1;
      if (!level || index < 0) return;
      const next = { ...level.openings[index], ...patch, id };
      if (next.kind === 'door') next.sillHeight = 0;
      level.openings[index] = next;
      level.openings = normalizeOpenings(level);
    }, { coalesceKey: `opening:${id}`, ...options }),

  deleteOpening: (id) => {
    get().patchProject((draft) => {
      const level = levelForOpening(draft, get().activeLevelId, id);
      if (level) level.openings = level.openings.filter((opening) => opening.id !== id);
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
      levelId: get().activeLevelId,
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
    copy.levelId = get().activeLevelId ?? copy.levelId;
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
    const level = resolveLevel(project, get().activeLevelId);
    const camera = defaultExhibitorCamera(
      position,
      levelVertices(level),
      level?.elevation ?? 0,
    );
    const exhibitor: Exhibitor = {
      id,
      name: `Expositor ${project.exhibitors.length + 1}`,
      standCode: '',
      description: '',
      color: DEFAULT_EXHIBITOR_COLOR,
      position: { ...position },
      rotation: 0,
      levelId: level?.id ?? get().activeLevelId,
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
      levelId: get().activeLevelId,
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
    const level = resolveLevel(project, get().activeLevelId);
    const primary = level?.spaces.find((space) => space.vertices.length >= 3);
    const center = primary
      ? polygonCentroid(primary.vertices)
      : { x: 0, z: 0 };
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

  levelPivotOf: (id) => {
    const project = get().project;
    const level = project?.levels.find((entry) => entry.id === id);
    return level ? levelPivot(level) : null;
  },

  setLevelGizmo: (levelId, mode) =>
    set((state) => ({
      levelGizmoId: levelId,
      levelGizmoMode: mode ?? state.levelGizmoMode,
    })),
  setLevelGizmoMode: (mode) => set({ levelGizmoMode: mode }),

  transformLevel: (id, transform, options = {}) => {
    get().patchProject((draft) => {
      const level = draft.levels.find((entry) => entry.id === id);
      if (!level) return;
      const angle = transform.angle ?? 0;
      if (!transform.delta && Math.abs(angle) < 1e-9) return;
      applyLevelTransform(draft, id, {
        delta: transform.delta ?? { x: 0, z: 0 },
        angle: normalizeAngle(angle),
        pivot: transform.pivot ?? levelPivot(level),
      });
    }, { coalesceKey: `level-transform:${id}`, ...options });
  },

  previewLevelTransform: (id, base, transform) => {
    const current = get().project;
    if (!current) return;
    const angle = transform.angle ?? 0;
    // Se parte siempre de la instantánea del inicio del arrastre: así el piso
    // sigue al cursor en tiempo real y no acumula desfase entre frames. Tampoco
    // se descarta el caso sin desplazamiento: si el usuario vuelve al punto de
    // partida hay que poder devolver el piso a su sitio original.
    const draft = structuredClone(base);
    const level = draft.levels.find((entry) => entry.id === id);
    if (!level) return;
    applyLevelTransform(draft, id, {
      delta: transform.delta ?? { x: 0, z: 0 },
      angle: normalizeAngle(angle),
      pivot: transform.pivot ?? levelPivot(level),
    });
    set({
      project: draft,
      dirty: true,
      saveStatus: get().saveStatus === 'saving' ? 'saving' : 'dirty',
    });
  },

  toggleMeasureMode: () =>
    set((state) => ({ measureMode: !state.measureMode, measurePending: null, measureHover: null })),
  addMeasurePoint: (point) => {
    const state = get();
    if (!state.measurePending) {
      set({ measurePending: point });
      return;
    }
    // Un paso reversible por cada medida creada.
    state.pushHistory();
    const measurement: Measurement = { id: createId('mes'), a: state.measurePending, b: point };
    set((current) => ({
      measurePending: null,
      measurements: [...current.measurements, measurement],
      activeMeasurementId: measurement.id,
    }));
  },
  updateMeasurementPoint: (id, end, point) =>
    set((state) => ({
      measurements: state.measurements.map((measurement) =>
        measurement.id === id ? { ...measurement, [end]: point } : measurement,
      ),
    })),
  moveMeasurement: (id, a, b) =>
    set((state) => ({
      measurements: state.measurements.map((measurement) =>
        measurement.id === id ? { ...measurement, a, b } : measurement,
      ),
    })),
  deleteMeasurement: (id) => {
    if (!get().measurements.some((measurement) => measurement.id === id)) return;
    get().pushHistory();
    set((state) => ({
      measurements: state.measurements.filter((measurement) => measurement.id !== id),
      activeMeasurementId:
        state.activeMeasurementId === id ? null : state.activeMeasurementId,
    }));
  },
  setActiveMeasurement: (activeMeasurementId) => set({ activeMeasurementId }),
  clearMeasurements: () => {
    const state = get();
    if (!state.measurements.length && !state.measurePending) return;
    if (state.measurements.length) state.pushHistory();
    set({
      measurements: [],
      measurePending: null,
      measureHover: null,
      activeMeasurementId: null,
    });
  },
  setMeasureAxis: (measureAxis) => set({ measureAxis }),
  setMeasureSnap: (measureSnap) => set({ measureSnap }),
  setMeasureHover: (measureHover) => set({ measureHover }),

  setSettings: (patch) =>
    get().patchProject((draft) => {
      draft.settings = { ...draft.settings, ...patch };
    }, { history: false }),
}));
