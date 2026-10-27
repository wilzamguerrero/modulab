import { useCallback, useEffect, useMemo, useState, type ReactNode } from 'react';
import { Link, useNavigate, useParams } from 'react-router-dom';
import {
  AlertTriangle,
  ArrowLeft,
  Box,
  Boxes,
  Check,
  Cloud,
  DraftingCompass,
  Globe2,
  Hand,
  HelpCircle,
  Layers,
  LayoutGrid,
  Lightbulb,
  Loader2,
  Maximize2,
  MousePointer2,
  Move,
  PanelLeft,
  PanelRight,
  PenTool,
  RefreshCcw,
  Redo2,
  RotateCw,
  Save,
  Scaling,
  Sparkles,
  Undo2,
  UserPlus,
  Users,
} from 'lucide-react';
import type { EditorTool, EditorView } from '@/types/project';
import type { NotionConfigStatus as NotionStatus } from '@/types/notion';
import {
  Badge,
  Button,
  ConfirmDialog,
  IconButton,
  Segmented,
  Spinner,
} from '@/components/ui';
import { PlanEditor2D } from '@/components/plan/PlanEditor2D';
import { EditorCanvas, type CameraRequest } from '@/components/scene/EditorCanvas';
import { PlanPanel } from '@/components/editor/PlanPanel';
import { CatalogPanel } from '@/components/editor/CatalogPanel';
import { ExhibitorsPanel } from '@/components/editor/ExhibitorsPanel';
import { LightsPanel } from '@/components/editor/LightsPanel';
import { Inspector } from '@/components/editor/Inspector';
import { PublishModal } from '@/components/editor/PublishModal';
import { useEditorStore } from '@/store/editorStore';
import { useUiStore } from '@/store/uiStore';
import { loadProject, refreshProjectFromNotion, saveProjectLocal, saveProjectToNotion } from '@/services/projects/projectService';
import { getNotionStatus } from '@/services/notion/notionService';
import { edgeLength, formatArea, formatMeters, polygonArea, validatePolygon } from '@/utils/geometry';
import { formatRelativeDate } from '@/utils/format';

type SidebarTab = 'plan' | 'catalog' | 'exhibitors' | 'lights';

const SIDEBAR_TABS: Array<{ id: SidebarTab; label: string; icon: ReactNode }> = [
  { id: 'plan', label: 'Planta', icon: <DraftingCompass size={16} /> },
  { id: 'catalog', label: 'Catálogo', icon: <Boxes size={16} /> },
  { id: 'exhibitors', label: 'Expositores', icon: <Users size={16} /> },
  { id: 'lights', label: 'Luces', icon: <Lightbulb size={16} /> },
];

export function EditorPage() {
  const { projectId } = useParams<{ projectId: string }>();
  const navigate = useNavigate();
  const toast = useUiStore((state) => state.toast);
  const setNotionModalOpen = useUiStore((state) => state.setNotionModalOpen);
  const setShortcutsOpen = useUiStore((state) => state.setShortcutsOpen);
  const notionModalOpen = useUiStore((state) => state.notionModalOpen);

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

  const loadProjectData = useEditorStore((state) => state.loadProjectData);
  const setLoading = useEditorStore((state) => state.setLoading);
  const setLoadError = useEditorStore((state) => state.setLoadError);
  const setTool = useEditorStore((state) => state.setTool);
  const setView = useEditorStore((state) => state.setView);
  const setTransformMode = useEditorStore((state) => state.setTransformMode);
  const setSelection = useEditorStore((state) => state.setSelection);
  const setPendingCatalogItem = useEditorStore((state) => state.setPendingCatalogItem);
  const setProjectMeta = useEditorStore((state) => state.setProjectMeta);
  const undo = useEditorStore((state) => state.undo);
  const redo = useEditorStore((state) => state.redo);
  const deleteObject = useEditorStore((state) => state.deleteObject);
  const duplicateObject = useEditorStore((state) => state.duplicateObject);
  const deleteExhibitor = useEditorStore((state) => state.deleteExhibitor);
  const deleteLight = useEditorStore((state) => state.deleteLight);
  const removeVertex = useEditorStore((state) => state.removeVertex);
  const setClipboardObject = useEditorStore((state) => state.setClipboardObject);
  const clipboardObject = useEditorStore((state) => state.clipboardObject);
  const pasteObject = useEditorStore((state) => state.pasteObject);

  const [activeTab, setActiveTab] = useState<SidebarTab>('plan');
  const [sidebarOpen, setSidebarOpen] = useState(false);
  const [inspectorOpen, setInspectorOpen] = useState(false);
  const [publishOpen, setPublishOpen] = useState(false);
  const [notionPullOpen, setNotionPullOpen] = useState(false);
  const [pulling, setPulling] = useState(false);
  const [notionStatus, setNotionStatus] = useState<NotionStatus | null>(null);
  const [cameraRequest, setCameraRequest] = useState<CameraRequest>({ mode: 'project', nonce: 0 });

  const requestCamera = (mode: CameraRequest['mode']) =>
    setCameraRequest((current) => ({ mode, nonce: current.nonce + 1 }));

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
        else if (state.selection?.type === 'vertex') removeVertex(state.selection.index);
        return;
      }
      if (mod || event.altKey) return;
      if (key === '1') { setView('plan'); return; }
      if (key === '2') { setView('3d'); return; }
      if (key === 'v') { setTool('select'); return; }
      if (key === 'd') { setView('plan'); setTool('draw'); return; }
      if (key === 'm') { setView('plan'); setTool('wall'); return; }
      if (key === 'e') { setTool('exhibitor'); return; }
      if (key === 'g') { setTransformMode('translate'); return; }
      if (key === 'r') { setTransformMode('rotate'); return; }
      if (key === 's') { setTransformMode('scale'); return; }
    };
    window.addEventListener('keydown', onKeyDown);
    return () => window.removeEventListener('keydown', onKeyDown);
  }, [
    clipboardObject,
    deleteExhibitor,
    deleteLight,
    deleteObject,
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

  const chooseTool = (nextTool: EditorTool) => {
    if (nextTool === 'draw' || nextTool === 'wall') setView('plan');
    setTool(nextTool);
  };

  const changeView = (nextView: EditorView) => {
    if (nextView === '3d' && (tool === 'draw' || tool === 'wall')) setTool('select');
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
  };

  const area = project ? polygonArea(project.floor.vertices) : 0;
  const validation = project ? validatePolygon(project.floor.vertices) : null;
  const wallCount = project?.edges.filter((edge) => edge.wall).length ?? 0;
  const selectedObject = project && selection?.type === 'object'
    ? project.objects.find((entry) => entry.id === selection.id)
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

  const totalWallLength = project.floor.vertices.reduce(
    (sum, _vertex, index) => sum + (project.edges[index]?.wall ? edgeLength(project.floor.vertices, index) : 0),
    0,
  );

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

      <div className="editor-main">
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
            {activeTab === 'catalog' ? <CatalogPanel project={project} /> : null}
            {activeTab === 'exhibitors' ? (
              <ExhibitorsPanel project={project} notionConfigured={Boolean(notionStatus?.configured)} />
            ) : null}
            {activeTab === 'lights' ? <LightsPanel project={project} /> : null}
          </div>
        </aside>

        <main className="editor-workspace">
          <div className="workspace-view">
            {view === 'plan' ? (
              <PlanEditor2D />
            ) : (
              <EditorCanvas project={project} cameraRequest={cameraRequest} />
            )}
          </div>

          <div className="floating-toolbar">
            <button type="button" className={`tool-btn${tool === 'select' ? ' is-active' : ''}`} title="Seleccionar (V)" onClick={() => chooseTool('select')}>
              <MousePointer2 size={16} />
            </button>
            <button type="button" className={`tool-btn${tool === 'draw' ? ' is-active' : ''}`} title="Dibujar contorno (D)" onClick={() => chooseTool('draw')}>
              <PenTool size={16} />
            </button>
            <button type="button" className={`tool-btn${tool === 'wall' ? ' is-active' : ''}`} title="Muro / acceso (M)" onClick={() => chooseTool('wall')}>
              <DraftingCompass size={16} />
            </button>
            <button type="button" className={`tool-btn${tool === 'exhibitor' ? ' is-active' : ''}`} title="Colocar expositor (E)" onClick={() => chooseTool('exhibitor')}>
              <UserPlus size={16} />
            </button>
            <button type="button" className={`tool-btn${tool === 'pan' ? ' is-active' : ''}`} title="Mover vista (espacio)" onClick={() => chooseTool('pan')}>
              <Hand size={16} />
            </button>
            {view === '3d' && selectedObject ? (
              <>
                <span className="tool-sep" />
                <button type="button" className={`tool-btn${transformMode === 'translate' ? ' is-active' : ''}`} title="Mover (G)" onClick={() => setTransformMode('translate')}>
                  <Move size={16} />
                </button>
                <button type="button" className={`tool-btn${transformMode === 'rotate' ? ' is-active' : ''}`} title="Rotar (R)" onClick={() => setTransformMode('rotate')}>
                  <RotateCw size={16} />
                </button>
                <button type="button" className={`tool-btn${transformMode === 'scale' ? ' is-active' : ''}`} title="Escalar (S)" onClick={() => setTransformMode('scale')}>
                  <Scaling size={16} />
                </button>
              </>
            ) : null}
            {view === '3d' ? (
              <>
                <span className="tool-sep" />
                <button type="button" className="tool-btn" title="Cámara del proyecto" onClick={() => requestCamera('project')}>
                  <Box size={16} />
                </button>
                <button type="button" className="tool-btn" title="Vista superior" onClick={() => requestCamera('top')}>
                  <Maximize2 size={16} />
                </button>
              </>
            ) : null}
          </div>

          <div className="view-badge">
            {view === 'plan' ? <LayoutGrid size={12} /> : <Box size={12} />}
            <strong>{view === 'plan' ? 'Planta 2D' : 'Vista 3D'}</strong>
            {pendingCatalogItem ? <Badge tone="accent">{pendingCatalogItem.name}</Badge> : null}
          </div>

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
        <span className="status-item"><DraftingCompass size={11} /> <strong>{project.floor.vertices.length}</strong> vértices</span>
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
