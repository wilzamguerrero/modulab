import { useCallback, useEffect, useMemo, useState, type ReactNode } from 'react';
import { Link, useNavigate, useParams } from 'react-router-dom';
import {
  AlertTriangle,
  ArrowLeft,
  ArrowUpDown,
  Box,
  Boxes,
  BrickWall,
  Check,
  Cloud,
  DoorOpen,
  DraftingCompass,
  Globe2,
  Hand,
  HelpCircle,
  Layers,
  LayoutGrid,
  Loader2,
  Maximize2,
  MousePointer2,
  Move,
  Orbit,
  PanelLeft,
  PanelRight,
  PanelTop,
  PenTool,
  RefreshCcw,
  Redo2,
  RotateCw,
  Ruler,
  Save,
  Scaling,
  Scissors,
  Sparkles,
  Undo2,
  UserPlus,
  Users,
  X,
} from 'lucide-react';
import type { EditorTool, EditorView } from '@/types/project';
import type { NotionConfigStatus as NotionStatus } from '@/types/notion';
import {
  Badge,
  Button,
  ConfirmDialog,
  IconButton,
  Segmented,
  Select,
  Spinner,
} from '@/components/ui';
import { PlanEditor2D } from '@/components/plan/PlanEditor2D';
import { EditorCanvas, type CameraRequest } from '@/components/scene/EditorCanvas';
import { PlanPanel } from '@/components/editor/PlanPanel';
import { LevelsPanel } from '@/components/editor/LevelsPanel';
import { CatalogPanel } from '@/components/editor/CatalogPanel';
import { ExhibitorsPanel } from '@/components/editor/ExhibitorsPanel';
import { EnvironmentPanel } from '@/components/editor/EnvironmentPanel';
import { Inspector } from '@/components/editor/Inspector';
import { StairQuickEditor } from '@/components/editor/StairQuickEditor';
import { PublishModal } from '@/components/editor/PublishModal';
import { useEditorStore } from '@/store/editorStore';
import { useUiStore } from '@/store/uiStore';
import { loadProject, refreshProjectFromNotion, saveProjectLocal, saveProjectToNotion } from '@/services/projects/projectService';
import { getNotionStatus } from '@/services/notion/notionService';
import { edgeLength, formatArea, formatMeters, polygonArea, validatePolygon } from '@/utils/geometry';
import { getLevel, getSpace, levelBounds, sortedLevels } from '@/utils/levels';
import { formatRelativeDate } from '@/utils/format';

type SidebarTab = 'plan' | 'levels' | 'catalog' | 'exhibitors' | 'environment';

const SIDEBAR_TABS: Array<{ id: SidebarTab; label: string; icon: ReactNode }> = [
  { id: 'plan', label: 'Planta', icon: <DraftingCompass size={16} /> },
  { id: 'levels', label: 'Niveles', icon: <Layers size={16} /> },
  { id: 'catalog', label: 'Catálogo', icon: <Boxes size={16} /> },
  { id: 'exhibitors', label: 'Expositores', icon: <Users size={16} /> },
  // Iluminación y cortes viven dentro de Entorno: son ajustes del espacio, y
  // así la barra queda en cinco pestañas sin que se traslapen las etiquetas.
  { id: 'environment', label: 'Entorno', icon: <Globe2 size={16} /> },
];

export function EditorPage() {
  const { projectId } = useParams<{ projectId: string }>();
  const navigate = useNavigate();
  const toast = useUiStore((state) => state.toast);
  const setNotionModalOpen = useUiStore((state) => state.setNotionModalOpen);
  const setShortcutsOpen = useUiStore((state) => state.setShortcutsOpen);
  const notionModalOpen = useUiStore((state) => state.notionModalOpen);
  const orthographic = useUiStore((state) => state.orthographic);
  const setOrthographic = useUiStore((state) => state.setOrthographic);
  const wireframe = useUiStore((state) => state.wireframe);
  const setWireframe = useUiStore((state) => state.setWireframe);

  const project = useEditorStore((state) => state.project);
  const loading = useEditorStore((state) => state.loading);
  const loadError = useEditorStore((state) => state.loadError);
  const selection = useEditorStore((state) => state.selection);
  const tool = useEditorStore((state) => state.tool);
  const view = useEditorStore((state) => state.view);
  const transformMode = useEditorStore((state) => state.transformMode);
  const pendingCatalogItem = useEditorStore((state) => state.pendingCatalogItem);
  const dirty = useEditorStore((state) => state.dirty);
  const saveStatus = useEditorStore((state) => state.saveStatus);
  const saveError = useEditorStore((state) => state.saveError);
  const lastSavedAt = useEditorStore((state) => state.lastSavedAt);
  const notionSaveStatus = useEditorStore((state) => state.notionSaveStatus);
  const notionError = useEditorStore((state) => state.notionError);
  const measureMode = useEditorStore((state) => state.measureMode);
  const measureAxis = useEditorStore((state) => state.measureAxis);
  const measureSnap = useEditorStore((state) => state.measureSnap);
  const setMeasureAxis = useEditorStore((state) => state.setMeasureAxis);
  const setMeasureSnap = useEditorStore((state) => state.setMeasureSnap);
  const clearMeasurements = useEditorStore((state) => state.clearMeasurements);
  const toggleMeasureMode = useEditorStore((state) => state.toggleMeasureMode);
  const measurementCount = useEditorStore((state) => state.measurements.length);
  const environmentPreview = useEditorStore((state) => state.environmentPreview);
  const setEnvironment = useEditorStore((state) => state.setEnvironment);

  const loadProjectData = useEditorStore((state) => state.loadProjectData);
  const setLoading = useEditorStore((state) => state.setLoading);
  const setLoadError = useEditorStore((state) => state.setLoadError);
  const setTool = useEditorStore((state) => state.setTool);
  const setView = useEditorStore((state) => state.setView);
  const setTransformMode = useEditorStore((state) => state.setTransformMode);
  const setSelection = useEditorStore((state) => state.setSelection);
  const setPendingCatalogItem = useEditorStore((state) => state.setPendingCatalogItem);
  const setProjectMeta = useEditorStore((state) => state.setProjectMeta);
  const setSettings = useEditorStore((state) => state.setSettings);
  const undo = useEditorStore((state) => state.undo);
  const redo = useEditorStore((state) => state.redo);
  const deleteObject = useEditorStore((state) => state.deleteObject);
  const duplicateObject = useEditorStore((state) => state.duplicateObject);
  const deleteExhibitor = useEditorStore((state) => state.deleteExhibitor);
  const deleteLight = useEditorStore((state) => state.deleteLight);
  const deleteInternalWall = useEditorStore((state) => state.deleteInternalWall);
  const deleteOpening = useEditorStore((state) => state.deleteOpening);
  const deleteStair = useEditorStore((state) => state.deleteStair);
  const deleteHole = useEditorStore((state) => state.deleteHole);
  const setPlanDrawMode = useEditorStore((state) => state.setPlanDrawMode);
  const planDrawMode = useEditorStore((state) => state.planDrawMode);
  const deleteRotationPoint = useEditorStore((state) => state.deleteRotationPoint);
  const activeLevelId = useEditorStore((state) => state.activeLevelId);
  const activeSpaceId = useEditorStore((state) => state.activeSpaceId);
  const setActiveLevel = useEditorStore((state) => state.setActiveLevel);
  const setActiveSpace = useEditorStore((state) => state.setActiveSpace);
  const removeVertex = useEditorStore((state) => state.removeVertex);
  const setClipboardObject = useEditorStore((state) => state.setClipboardObject);
  const clipboardObject = useEditorStore((state) => state.clipboardObject);
  const pasteObject = useEditorStore((state) => state.pasteObject);

  const [activeTab, setActiveTab] = useState<SidebarTab>('plan');
  const [sidebarOpen, setSidebarOpen] = useState(
    () => typeof window !== 'undefined' && window.matchMedia('(min-width: 981px)').matches,
  );
  const [inspectorOpen, setInspectorOpen] = useState(
    () => typeof window !== 'undefined' && window.matchMedia('(min-width: 981px)').matches,
  );
  const [publishOpen, setPublishOpen] = useState(false);
  const [viewsOpen, setViewsOpen] = useState(false);
  const [notionPullOpen, setNotionPullOpen] = useState(false);
  const [pulling, setPulling] = useState(false);
  const [notionStatus, setNotionStatus] = useState<NotionStatus | null>(null);
  const [cameraRequest, setCameraRequest] = useState<CameraRequest>({ mode: 'project', nonce: 0 });

  const requestCamera = (mode: CameraRequest['mode']) => {
    // Vistas ortogonales (frente, perfil, superior) usan proyección
    // ortográfica, como en Blender/Maya. Isométrica y cámara: perspectiva.
    const orthoView =
      mode === 'front' || mode === 'back' || mode === 'left' || mode === 'right' || mode === 'top';
    setOrthographic(orthoView);
    setCameraRequest((current) => ({ mode, nonce: current.nonce + 1 }));
  };

  useEffect(() => {
    if (!projectId) return;
    let cancelled = false;
    setLoading(true);
    setLoadError(null);
    loadProject(projectId)
      .then((loaded) => {
        if (cancelled) return;
        if (!loaded) {
          setLoadError('No se encontró el proyecto en este navegador. Puede que se haya eliminado o que estés en otro dispositivo.');
          return;
        }
        loadProjectData(loaded);
      })
      .catch((error) => {
        if (!cancelled) setLoadError((error as Error).message);
      });
    return () => {
      cancelled = true;
    };
  }, [projectId, loadProjectData, setLoading, setLoadError]);

  const refreshNotionStatus = useCallback(() => {
    getNotionStatus()
      .then(setNotionStatus)
      .catch(() => setNotionStatus({ configured: false, hasToken: false, parentPageId: '' }));
  }, []);

  useEffect(() => {
    refreshNotionStatus();
  }, [refreshNotionStatus]);

  useEffect(() => {
    if (!notionModalOpen) refreshNotionStatus();
  }, [notionModalOpen, refreshNotionStatus]);

  const saveNow = useCallback(
    async (notify = false) => {
      const snapshot = useEditorStore.getState().project;
      if (!snapshot) return;
      useEditorStore.getState().setSaveStatus('saving');
      try {
        await saveProjectLocal(snapshot);
        const current = useEditorStore.getState();
        if (current.project?.updatedAt === snapshot.updatedAt) {
          current.markSaved(snapshot.updatedAt);
        } else {
          current.setSaveStatus('dirty');
        }
        if (notify) toast('Proyecto guardado localmente.', 'success');
      } catch (error) {
        useEditorStore.getState().setSaveStatus('error', (error as Error).message);
        if (notify) toast(`No se pudo guardar: ${(error as Error).message}`, 'error');
      }
    },
    [toast],
  );

  useEffect(() => {
    if (!project || !dirty) return;
    const timer = window.setTimeout(() => saveNow(false), 850);
    return () => window.clearTimeout(timer);
  }, [project, dirty, saveNow]);

  useEffect(() => {
    if (!dirty) return;
    const onBeforeUnload = (event: BeforeUnloadEvent) => {
      event.preventDefault();
      event.returnValue = '';
    };
    const onVisibility = () => {
      if (document.visibilityState === 'hidden') saveNow(false);
    };
    window.addEventListener('beforeunload', onBeforeUnload);
    document.addEventListener('visibilitychange', onVisibility);
    return () => {
      window.removeEventListener('beforeunload', onBeforeUnload);
      document.removeEventListener('visibilitychange', onVisibility);
    };
  }, [dirty, saveNow]);

  useEffect(() => {
    if (selection) setInspectorOpen(true);
  }, [selection]);

  useEffect(() => {
    if (view !== '3d') setViewsOpen(false);
  }, [view]);

  useEffect(() => {
    const isEditable = (target: EventTarget | null) => {
      const element = target as HTMLElement | null;
      return Boolean(
        element &&
          (element.tagName === 'INPUT' ||
            element.tagName === 'TEXTAREA' ||
            element.tagName === 'SELECT' ||
            element.isContentEditable),
      );
    };

    const onKeyDown = (event: KeyboardEvent) => {
      if (isEditable(event.target)) return;
      const mod = event.ctrlKey || event.metaKey;
      const key = event.key.toLowerCase();
      const state = useEditorStore.getState();

      if (mod && key === 's') {
        event.preventDefault();
        saveNow(true);
        return;
      }
      if (mod && key === 'z' && !event.shiftKey) {
        event.preventDefault();
        undo();
        return;
      }
      if ((mod && key === 'y') || (mod && key === 'z' && event.shiftKey)) {
        event.preventDefault();
        redo();
        return;
      }
      if (mod && key === 'd') {
        event.preventDefault();
        if (state.selection?.type === 'object') {
          duplicateObject(state.selection.id);
        }
        return;
      }
      if (mod && key === 'c') {
        const currentSelection = state.selection;
        if (currentSelection?.type === 'object') {
          const found = state.project?.objects.find((entry) => entry.id === currentSelection.id);
          if (found) {
            setClipboardObject(found);
            toast('Objeto copiado.', 'success');
          }
        }
        return;
      }
      if (mod && key === 'v') {
        if (clipboardObject) {
          event.preventDefault();
          pasteObject();
        }
        return;
      }
      if (event.key === 'Escape') {
        setPendingCatalogItem(null);
        setTool('select');
        setSelection(null);
        return;
      }
      if (event.key === 'Delete') {
        if (state.selection?.type === 'object') deleteObject(state.selection.id);
        else if (state.selection?.type === 'exhibitor') deleteExhibitor(state.selection.id);
        else if (state.selection?.type === 'light') deleteLight(state.selection.id);
        else if (state.selection?.type === 'internalWall') deleteInternalWall(state.selection.id);
        else if (state.selection?.type === 'opening') deleteOpening(state.selection.id);
        else if (state.selection?.type === 'stair') deleteStair(state.selection.id);
        else if (state.selection?.type === 'hole') deleteHole(state.selection.id);
        else if (state.selection?.type === 'rotationPoint') deleteRotationPoint(state.selection.id);
        else if (state.selection?.type === 'vertex') removeVertex(state.selection.index);
        return;
      }
      if (event.altKey && state.project) {
        const levels = sortedLevels(state.project);
        const level = getLevel(state.project, state.activeLevelId);
        if (event.key === 'ArrowUp' || event.key === 'ArrowDown') {
          event.preventDefault();
          const index = levels.findIndex((entry) => entry.id === level?.id);
          const delta = event.key === 'ArrowUp' ? 1 : -1;
          const next = levels[(index + delta + levels.length) % levels.length];
          if (next) setActiveLevel(next.id);
          return;
        }
        if (event.key === 'ArrowLeft' || event.key === 'ArrowRight') {
          event.preventDefault();
          const spaces = level?.spaces ?? [];
          if (!spaces.length) return;
          const index = spaces.findIndex((entry) => entry.id === state.activeSpaceId);
          const delta = event.key === 'ArrowRight' ? 1 : -1;
          const next = spaces[(index + delta + spaces.length) % spaces.length];
          if (next) setActiveSpace(next.id);
          return;
        }
      }
      if (mod || event.altKey) return;
      if (key === '1') { setView('plan'); return; }
      if (key === '2') { setView('3d'); return; }
      if (key === 'v') { setTool('select'); return; }
      if (key === 'd') { setView('plan'); setTool('draw'); return; }
      if (key === 'm') { setView('plan'); setTool('wall'); return; }
      if (key === 'f') { setView('plan'); setTool('internalWall'); return; }
      if (key === 'p') { setView('plan'); setTool('door'); return; }
      if (key === 'n') { setView('plan'); setTool('window'); return; }
      if (key === 'u') { setView('plan'); setTool('stair'); return; }
      if (key === 'h') { setView('plan'); setPlanDrawMode('hole'); setTool('draw'); return; }
      if (key === 'e') { setTool('exhibitor'); return; }
      if (key === 'o') { setTool('rotationPoint'); return; }
      if (key === 't') { setView('3d'); toggleMeasureMode(); return; }
      if (key === 'g') { setTransformMode('translate'); return; }
      if (key === 'r') { setTransformMode('rotate'); return; }
      if (key === 's') { setTransformMode('scale'); return; }
    };
    window.addEventListener('keydown', onKeyDown);
    return () => window.removeEventListener('keydown', onKeyDown);
  }, [
    clipboardObject,
    deleteExhibitor,
    deleteInternalWall,
    deleteLight,
    deleteObject,
    deleteOpening,
    deleteRotationPoint,
    duplicateObject,
    pasteObject,
    redo,
    removeVertex,
    saveNow,
    setClipboardObject,
    setPendingCatalogItem,
    setSelection,
    setTool,
    setTransformMode,
    setView,
    toast,
    toggleMeasureMode,
    undo,
  ]);

  const handleNotionSave = async () => {
    if (!project) return;
    if (!notionStatus?.configured) {
      setNotionModalOpen(true);
      return;
    }
    useEditorStore.getState().setNotionSaveStatus('saving');
    try {
      const saved = await saveProjectToNotion(structuredClone(project));
      useEditorStore.setState({
        project: saved,
        projectId: saved.id,
        dirty: false,
        saveStatus: 'saved',
        lastSavedAt: new Date().toISOString(),
      });
      if (saved.levels[0]) useEditorStore.getState().setActiveLevel(saved.levels[0].id);
      useEditorStore.getState().setNotionSaveStatus('saved');
      toast(project.notionBlockId ? 'Proyecto sincronizado con Notion.' : 'Proyecto guardado en Notion.', 'success');
    } catch (error) {
      useEditorStore.getState().setNotionSaveStatus('error', (error as Error).message);
      toast(`No se pudo guardar en Notion: ${(error as Error).message}`, 'error');
    }
  };

  const handleNotionPull = async () => {
    if (!project?.notionBlockId) return;
    setPulling(true);
    try {
      const remote = await refreshProjectFromNotion(project);
      loadProjectData(remote);
      setNotionPullOpen(false);
      toast('Proyecto actualizado desde Notion.', 'success');
    } catch (error) {
      toast(`No se pudo leer Notion: ${(error as Error).message}`, 'error');
    } finally {
      setPulling(false);
    }
  };

  const planOnlyTools: EditorTool[] = ['draw', 'wall', 'internalWall', 'door', 'window', 'stair'];
  const chooseTool = (nextTool: EditorTool) => {
    if (planOnlyTools.includes(nextTool)) setView('plan');
    setTool(nextTool);
  };

  const changeView = (nextView: EditorView) => {
    if (nextView === '3d' && planOnlyTools.includes(tool)) setTool('select');
    setView(nextView);
  };

  const handlePublished = (publishedProject: typeof project) => {
    if (!publishedProject) return;
    useEditorStore.setState({
      project: publishedProject,
      projectId: publishedProject.id,
      dirty: false,
      saveStatus: 'saved',
      lastSavedAt: new Date().toISOString(),
    });
    if (publishedProject.levels[0]) {
      useEditorStore.getState().setActiveLevel(publishedProject.levels[0].id);
    }
  };

  const activeLevel = project ? getLevel(project, activeLevelId) : undefined;
  const activeSpace = project ? getSpace(activeLevel, activeSpaceId) : undefined;
  const area = activeSpace ? polygonArea(activeSpace.vertices) : 0;
  const validation = activeSpace ? validatePolygon(activeSpace.vertices) : null;
  const wallCount = activeLevel
    ? activeLevel.spaces.reduce(
        (total, space) => total + space.edges.filter((edge) => edge.wall).length,
        0,
      ) + activeLevel.internalWalls.length
    : 0;
  const selectedObject = project && selection?.type === 'object'
    ? project.objects.find((entry) => entry.id === selection.id)
    : null;
  const selectedStair = project && selection?.type === 'stair'
    ? project.levels.flatMap((level) => level.stairs).find((entry) => entry.id === selection.id)
    : null;

  const saveLabel = useMemo(() => {
    if (saveStatus === 'saving') return 'Guardando…';
    if (saveStatus === 'dirty') return 'Cambios sin guardar';
    if (saveStatus === 'error') return 'Error al guardar';
    if (lastSavedAt) return `Guardado ${formatRelativeDate(lastSavedAt)}`;
    return 'Guardado';
  }, [saveStatus, lastSavedAt]);

  if (!project) {
    if (loadError) {
      return (
        <div className="viewer-loading">
          <div className="viewer-error">
            <div className="empty-icon"><AlertTriangle size={20} /></div>
            <h1>No se pudo abrir el proyecto</h1>
            <p>{loadError}</p>
            <div className="inline-actions">
              <Button variant="primary" onClick={() => navigate('/')} icon={<ArrowLeft size={15} />}>
                Volver al inicio
              </Button>
            </div>
          </div>
        </div>
      );
    }
    return (
      <div className="viewer-loading">
        <Spinner label={loading ? 'Abriendo proyecto…' : 'Cargando…'} />
      </div>
    );
  }

  const totalWallLength = activeSpace
    ? activeSpace.vertices.reduce(
        (sum, _vertex, index) =>
          sum + (activeSpace.edges[index]?.wall ? edgeLength(activeSpace.vertices, index) : 0),
        0,
      )
    : 0;

  return (
    <div className="editor-shell">
      <header className="editor-topbar">
        <div className="topbar-left">
          <IconButton
            label="Volver al inicio"
            icon={<ArrowLeft size={17} />}
            onClick={() => navigate('/')}
          />
          <span className="brand-mark editor-brand-mark"><Layers size={15} /></span>
          <div className="project-name-wrap">
            <input
              className="project-name-input"
              value={project.name}
              aria-label="Nombre del proyecto"
              onChange={(event) => setProjectMeta({ name: event.target.value })}
              onBlur={() => {
                if (!project.name.trim()) setProjectMeta({ name: 'Proyecto sin título' });
              }}
            />
          </div>
          <span className={`save-state${saveStatus === 'dirty' ? ' is-dirty' : ''}${saveStatus === 'saving' ? ' is-saving' : ''}${saveStatus === 'error' ? ' is-error' : ''}`} title={saveError ?? undefined}>
            {saveStatus === 'saving' ? <Loader2 size={11} className="spin" /> : saveStatus === 'error' ? <AlertTriangle size={11} /> : saveStatus === 'dirty' ? <span className="status-dot" /> : <Check size={11} />}
            <span>{saveLabel}</span>
          </span>
          <IconButton label="Guardar ahora (Ctrl+S)" icon={<Save size={15} />} onClick={() => saveNow(true)} />
        </div>

        <div className="topbar-center">
          <div className="level-switcher">
            <Select
              value={activeLevelId ?? ''}
              onChange={(event) => setActiveLevel(event.target.value)}
              aria-label="Nivel activo"
            >
              {sortedLevels(project).map((entry) => (
                <option key={entry.id} value={entry.id}>
                  {entry.name} · {entry.elevation.toFixed(2)} m
                </option>
              ))}
            </Select>
            {activeLevel && activeLevel.spaces.length > 0 ? (
              <Select
                value={activeSpaceId ?? ''}
                onChange={(event) => setActiveSpace(event.target.value)}
                aria-label="Espacio activo"
              >
                {activeLevel.spaces.map((space) => (
                  <option key={space.id} value={space.id}>
                    {space.name}
                  </option>
                ))}
              </Select>
            ) : null}
          </div>
          <Segmented<EditorView>
            value={view}
            onChange={changeView}
            options={[
              { value: 'plan', label: 'Planta', icon: <LayoutGrid size={14} /> },
              { value: '3d', label: '3D', icon: <Box size={14} /> },
            ]}
          />
        </div>

        <div className="topbar-right">
          <IconButton label="Deshacer (Ctrl+Z)" icon={<Undo2 size={16} />} onClick={undo} />
          <IconButton label="Rehacer (Ctrl+Y)" icon={<Redo2 size={16} />} onClick={redo} />
          <span className="topbar-divider" />
          {notionStatus?.configured ? (
            <>
              <Button
                variant="outline"
                size="sm"
                onClick={handleNotionSave}
                loading={notionSaveStatus === 'saving'}
                icon={<Cloud size={14} />}
                title={notionError ?? undefined}
              >
                Notion
              </Button>
              {project.notionBlockId ? (
                <IconButton
                  label="Traer cambios desde Notion"
                  icon={<RefreshCcw size={15} />}
                  onClick={() => setNotionPullOpen(true)}
                />
              ) : null}
            </>
          ) : (
            <Button variant="outline" size="sm" onClick={() => setNotionModalOpen(true)} icon={<Cloud size={14} />}>
              Conectar
            </Button>
          )}
          <Button variant="primary" size="sm" onClick={() => setPublishOpen(true)} icon={<Sparkles size={14} />}>
            Publicar
          </Button>
          <span className="topbar-divider" />
          <IconButton label="Atajos" icon={<HelpCircle size={16} />} onClick={() => setShortcutsOpen(true)} />
          <IconButton
            label="Panel lateral"
            icon={<PanelLeft size={16} />}
            onClick={() => setSidebarOpen((value) => !value)}
          />
          <IconButton
            label="Inspector"
            icon={<PanelRight size={16} />}
            onClick={() => setInspectorOpen((value) => !value)}
          />
        </div>
      </header>

      <div className={`editor-main${sidebarOpen ? '' : ' no-sidebar'}${inspectorOpen ? '' : ' no-inspector'}`}>
        <aside className={`editor-sidebar${sidebarOpen ? ' is-open' : ''}`}>
          <div className="sidebar-tabs">
            {SIDEBAR_TABS.map((tab) => (
              <button
                key={tab.id}
                type="button"
                className={activeTab === tab.id ? 'is-active' : ''}
                onClick={() => { setActiveTab(tab.id); setSidebarOpen(true); }}
              >
                {tab.icon}
                <span>{tab.label}</span>
              </button>
            ))}
          </div>
          <div className="sidebar-content">
            {activeTab === 'plan' ? <PlanPanel project={project} /> : null}
            {activeTab === 'levels' ? <LevelsPanel project={project} /> : null}
            {activeTab === 'catalog' ? <CatalogPanel project={project} /> : null}
            {activeTab === 'exhibitors' ? (
              <ExhibitorsPanel project={project} notionConfigured={Boolean(notionStatus?.configured)} />
            ) : null}
            {activeTab === 'environment' ? (
              <EnvironmentPanel project={project} />
            ) : null}
          </div>
        </aside>

        <main className="editor-workspace">
          <div className="workspace-view">
            {/* El canvas 3D permanece montado para no recargar el Gaussian splat
                al alternar entre planta y 3D. La planta se dibuja encima. */}
            <EditorCanvas
              project={project}
              cameraRequest={cameraRequest}
              active={view === '3d'}
              orthographic={orthographic}
            />
            {view === 'plan' ? <PlanEditor2D /> : null}
          </div>

          <div className="floating-toolbar">
            <button type="button" className={`tool-btn${tool === 'select' ? ' is-active' : ''}`} title="Seleccionar (V)" onClick={() => chooseTool('select')}>
              <MousePointer2 size={16} />
            </button>
            <button type="button" className={`tool-btn${tool === 'draw' ? ' is-active' : ''}`} title="Dibujar contorno o división (D)" onClick={() => chooseTool('draw')}>
              <PenTool size={16} />
            </button>
            <button type="button" className={`tool-btn${tool === 'wall' ? ' is-active' : ''}`} title="Muro / acceso (M)" onClick={() => chooseTool('wall')}>
              <DraftingCompass size={16} />
            </button>
            <button type="button" className={`tool-btn${tool === 'internalWall' ? ' is-active' : ''}`} title="Muro libre (F)" onClick={() => chooseTool('internalWall')}>
              <BrickWall size={16} />
            </button>
            <button type="button" className={`tool-btn${tool === 'door' ? ' is-active' : ''}`} title="Puerta (P)" onClick={() => chooseTool('door')}>
              <DoorOpen size={16} />
            </button>
            <button type="button" className={`tool-btn${tool === 'window' ? ' is-active' : ''}`} title="Ventana (N)" onClick={() => chooseTool('window')}>
              <PanelTop size={16} />
            </button>
            <button type="button" className={`tool-btn${tool === 'stair' ? ' is-active' : ''}`} title="Escalera (U)" onClick={() => chooseTool('stair')}>
              <ArrowUpDown size={16} />
            </button>
            <button
              type="button"
              className={`tool-btn${tool === 'draw' && planDrawMode === 'hole' ? ' is-active' : ''}`}
              title="Hueco en el suelo (H)"
              onClick={() => {
                setView('plan');
                setPlanDrawMode('hole');
                setTool('draw');
              }}
            >
              <Scissors size={16} />
            </button>
            <button type="button" className={`tool-btn${tool === 'exhibitor' ? ' is-active' : ''}`} title="Colocar expositor (E)" onClick={() => chooseTool('exhibitor')}>
              <UserPlus size={16} />
            </button>
            <button type="button" className={`tool-btn${tool === 'rotationPoint' ? ' is-active' : ''}`} title="Punto de rotación (O)" onClick={() => chooseTool('rotationPoint')}>
              <Orbit size={16} />
            </button>
            <button type="button" className={`tool-btn${measureMode ? ' is-active' : ''}`} title="Medir (T)" onClick={() => { setView('3d'); toggleMeasureMode(); }}>
              <Ruler size={16} />
            </button>
            <button type="button" className={`tool-btn${tool === 'pan' ? ' is-active' : ''}`} title="Mover vista (espacio)" onClick={() => chooseTool('pan')}>
              <Hand size={16} />
            </button>
            {view === '3d' && (selectedObject || selectedStair) ? (
              <>
                <span className="tool-sep" />
                <button type="button" className={`tool-btn${transformMode === 'translate' ? ' is-active' : ''}`} title="Mover (G)" onClick={() => setTransformMode('translate')}>
                  <Move size={16} />
                </button>
                <button type="button" className={`tool-btn${transformMode === 'rotate' ? ' is-active' : ''}`} title="Rotar (R)" onClick={() => setTransformMode('rotate')}>
                  <RotateCw size={16} />
                </button>
                {selectedObject ? (
                  <button type="button" className={`tool-btn${transformMode === 'scale' ? ' is-active' : ''}`} title="Escalar (S)" onClick={() => setTransformMode('scale')}>
                    <Scaling size={16} />
                  </button>
                ) : null}
              </>
            ) : null}
            {view === '3d' ? (
              <>
                <span className="tool-sep" />
                <div className="views-anchor">
                  <button
                    type="button"
                    className={`tool-btn${viewsOpen ? ' is-active' : ''}`}
                    title="Vistas y proyección"
                    onClick={() => setViewsOpen((value) => !value)}
                  >
                    <Maximize2 size={16} />
                  </button>
                  {viewsOpen ? (
                    <div className="views-menu">
                      <button
                        type="button"
                        onClick={() => {
                          requestCamera('project');
                          setViewsOpen(false);
                        }}
                      >
                        Cámara del proyecto
                      </button>
                      <div className="views-grid">
                        <button type="button" onClick={() => { requestCamera('top'); setViewsOpen(false); }}>
                          Superior
                        </button>
                        <button type="button" onClick={() => { requestCamera('front'); setViewsOpen(false); }}>
                          Frontal
                        </button>
                        <button type="button" onClick={() => { requestCamera('back'); setViewsOpen(false); }}>
                          Posterior
                        </button>
                        <button type="button" onClick={() => { requestCamera('left'); setViewsOpen(false); }}>
                          Izquierda
                        </button>
                        <button type="button" onClick={() => { requestCamera('right'); setViewsOpen(false); }}>
                          Derecha
                        </button>
                        <button type="button" onClick={() => { requestCamera('iso'); setViewsOpen(false); }}>
                          Isométrica
                        </button>
                      </div>
                      <button
                        type="button"
                        className={`views-projection${orthographic ? ' is-active' : ''}`}
                        onClick={() => setOrthographic(!orthographic)}
                      >
                        {orthographic ? 'Proyección ortográfica' : 'Proyección perspectiva'}
                      </button>
                    </div>
                  ) : null}
                </div>
              </>
            ) : null}
          </div>

          <div className="view-badge">
            {view === 'plan' ? <LayoutGrid size={12} /> : <Box size={12} />}
            <strong>{view === 'plan' ? 'Planta 2D' : 'Vista 3D'}</strong>
            {pendingCatalogItem ? <Badge tone="accent">{pendingCatalogItem.name}</Badge> : null}
          </div>

          {view === '3d' ? (
            <div className="view-cube">
              <span className="view-cube-title">Vista</span>
              <div className="view-cube-grid">
                <button type="button" onClick={() => requestCamera('front')}>Frente</button>
                <button type="button" onClick={() => requestCamera('right')}>Perfil</button>
                <button type="button" onClick={() => requestCamera('top')}>Sup.</button>
                <button type="button" onClick={() => requestCamera('iso')}>Iso</button>
              </div>
              <button
                type="button"
                className={`view-cube-ortho${orthographic ? ' is-active' : ''}`}
                onClick={() => setOrthographic(!orthographic)}
                title="Alternar proyección ortográfica"
              >
                Ortográfica
              </button>
              <button
                type="button"
                className={`view-cube-ortho${wireframe ? ' is-active' : ''}`}
                onClick={() => setWireframe(!wireframe)}
                title="Ver la geometría en modo alámbrico"
              >
                Wireframe
              </button>
              <button
                type="button"
                className={`view-cube-ortho${project.settings.showGrid ? ' is-active' : ''}`}
                onClick={() => setSettings({ showGrid: !project.settings.showGrid })}
                title="Mostrar u ocultar la cuadrícula"
              >
                Cuadrícula
              </button>
              {project.environment.url || project.environment.blockId || environmentPreview ? (
                <button
                  type="button"
                  className={`view-cube-ortho${project.environment.visible ? ' is-active' : ''}`}
                  onClick={() => setEnvironment({ visible: !project.environment.visible })}
                  title={
                    project.environment.visible
                      ? 'Ocultar el Gaussian splat'
                      : 'Mostrar el Gaussian splat'
                  }
                  aria-pressed={project.environment.visible}
                >
                  <Sparkles size={12} />
                  Gaussian
                </button>
              ) : null}
            </div>
          ) : null}

          {view === '3d' && measureMode ? (
            <div className="measure-bar">
              <span style={{ color: 'var(--accent)' }}>Medir</span>
              <button
                type="button"
                className={measureAxis === 'none' ? 'is-active' : ''}
                onClick={() => setMeasureAxis('none')}
                title="Sin bloqueo de eje (L)"
              >
                Libre
              </button>
              <button
                type="button"
                className={measureAxis === 'x' ? 'is-active' : ''}
                onClick={() => setMeasureAxis('x')}
                title="Bloquear a X: ancho (X)"
              >
                X
              </button>
              <button
                type="button"
                className={measureAxis === 'y' ? 'is-active' : ''}
                onClick={() => setMeasureAxis('y')}
                title="Bloquear a Y: alto (Y)"
              >
                Y
              </button>
              <button
                type="button"
                className={measureAxis === 'z' ? 'is-active' : ''}
                onClick={() => setMeasureAxis('z')}
                title="Bloquear a Z: fondo (Z)"
              >
                Z
              </button>
              <span className="measure-sep" />
              <button
                type="button"
                className={measureSnap ? 'is-active' : ''}
                onClick={() => setMeasureSnap(!measureSnap)}
                title="Pegar a la superficie (Shift lo desactiva mientras mides)"
              >
                Snap
              </button>
              <button type="button" onClick={() => clearMeasurements()} title="Borrar medidas">
                Borrar ({measurementCount})
              </button>
              <button type="button" onClick={() => toggleMeasureMode()} title="Cerrar herramienta">
                <X size={12} />
              </button>
            </div>
          ) : null}

          {project && view === '3d' && selectedStair ? (
            <StairQuickEditor project={project} stair={selectedStair} />
          ) : null}

          {pendingCatalogItem && view === '3d' ? (
            <div className="plan-pending">
              <span className="plan-pending-dot" />
              Colocando <strong>{pendingCatalogItem.name}</strong>
              <button type="button" onClick={() => setPendingCatalogItem(null)}>Cancelar</button>
            </div>
          ) : null}
        </main>

        <Inspector project={project} onPublish={() => setPublishOpen(true)} open={inspectorOpen} />
      </div>

      <footer className="editor-statusbar">
        <span className="status-item"><LayoutGrid size={11} /> <strong>{formatArea(area)}</strong></span>
        <span className="status-item"><Layers size={11} /> <strong>{activeLevel?.name ?? '—'}</strong> · {activeSpace?.name ?? 'sin espacio'}</span>
        <span className="status-item"><DraftingCompass size={11} /> <strong>{activeSpace?.vertices.length ?? 0}</strong> vértices</span>
        <span className="status-item"><Boxes size={11} /> <strong>{project.objects.length}</strong> objetos</span>
        <span className="status-item"><Users size={11} /> <strong>{project.exhibitors.length}</strong> expositores</span>
        <span className="status-item"><Layers size={11} /> <strong>{wallCount}</strong> muros · {formatMeters(totalWallLength, 1)}</span>
        {validation && !validation.valid ? (
          <span className="status-item status-warning"><AlertTriangle size={11} /> {validation.errors[0]}</span>
        ) : null}
        <span className="status-spacer" />
        {notionSaveStatus === 'error' ? (
          <span className="status-item status-error" title={notionError ?? undefined}><Cloud size={11} /> Notion con error</span>
        ) : project.notionBlockId ? (
          <span className="status-item"><Cloud size={11} /> Notion vinculado</span>
        ) : null}
        <span className="status-item"><Globe2 size={11} /> {project.published ? `v${project.published.version} publicada` : 'sin publicar'}</span>
        <span className={`status-item${saveStatus === 'error' ? ' status-error' : saveStatus === 'dirty' ? ' status-warning' : ''}`} title={saveError ?? undefined}>
          {saveStatus === 'saving' ? <Loader2 size={11} className="spin" /> : <Save size={11} />}
          {saveLabel}
        </span>
        <span className="status-item status-credit">dev by wilzamguerrero</span>
      </footer>

      <PublishModal
        project={project}
        open={publishOpen}
        onClose={() => setPublishOpen(false)}
        onPublished={handlePublished}
      />

      <ConfirmDialog
        open={notionPullOpen}
        title="Traer cambios desde Notion"
        message="Se reemplazará la versión local por el proyecto guardado en Notion. Los cambios locales que no se hayan guardado en Notion se perderán."
        confirmLabel="Traer desde Notion"
        loading={pulling}
        onConfirm={handleNotionPull}
        onCancel={() => setNotionPullOpen(false)}
      />
    </div>
  );
}
