import { useCallback, useEffect, useMemo, useRef, useState } from 'react';
import { useNavigate } from 'react-router-dom';
import {
  ArrowUpRight,
  Boxes,
  Cloud,
  FileJson,
  FolderOpen,
  HelpCircle,
  Import,
  Layers,
  Loader2,
  Plus,
  RefreshCcw,
  Settings2,
  Sparkles,
  Upload,
  Users,
} from 'lucide-react';
import type { NotionConfigStatus, NotionProjectListItem } from '@/types/notion';
import type { ProjectSummary } from '@/types/project';
import {
  Badge,
  Button,
  ConfirmDialog,
  EmptyState,
  IconButton,
  Spinner,
  Tabs,
} from '@/components/ui';
import { MiniPlan } from '@/components/ui/MiniPlan';
import { NewProjectModal } from '@/components/projects/NewProjectModal';
import { ProjectCard } from '@/components/projects/ProjectCard';
import {
  duplicateLocalProject,
  exportProjectFile,
  importProjectFile,
  listNotionProjects,
  listProjects,
  loadProject,
  loadProjectFromNotion,
  removeProject,
} from '@/services/projects/projectService';
import { getNotionStatus } from '@/services/notion/notionService';
import { loadCatalog } from '@/services/assets/catalogService';
import { useUiStore } from '@/store/uiStore';
import { getTemplate } from '@/data/templates';
import { formatRelativeDate } from '@/utils/format';

export function HomePage() {
  const navigate = useNavigate();
  const toast = useUiStore((state) => state.toast);
  const setNotionModalOpen = useUiStore((state) => state.setNotionModalOpen);
  const setShortcutsOpen = useUiStore((state) => state.setShortcutsOpen);
  const [projects, setProjects] = useState<ProjectSummary[]>([]);
  const [loading, setLoading] = useState(true);
  const [notionStatus, setNotionStatus] = useState<NotionConfigStatus | null>(null);
  const [notionProjects, setNotionProjects] = useState<NotionProjectListItem[]>([]);
  const [notionLoading, setNotionLoading] = useState(false);
  const [notionError, setNotionError] = useState<string | null>(null);
  const [openingId, setOpeningId] = useState<string | null>(null);
  const [tab, setTab] = useState<'local' | 'notion'>('local');
  const [newOpen, setNewOpen] = useState(false);
  const [deleteTarget, setDeleteTarget] = useState<ProjectSummary | null>(null);
  const [deleting, setDeleting] = useState(false);
  const [glbCount, setGlbCount] = useState<number | null>(null);
  const importRef = useRef<HTMLInputElement>(null);

  const refreshLocal = useCallback(async () => {
    try {
      setProjects(await listProjects());
    } catch (error) {
      toast((error as Error).message, 'error');
    } finally {
      setLoading(false);
    }
  }, [toast]);

  const refreshNotion = useCallback(async () => {
    if (!notionStatus?.configured) return;
    setNotionLoading(true);
    setNotionError(null);
    try {
      const response = await listNotionProjects();
      setNotionProjects(response.projects);
    } catch (error) {
      setNotionError((error as Error).message);
    } finally {
      setNotionLoading(false);
    }
  }, [notionStatus?.configured]);

  useEffect(() => {
    refreshLocal();
    getNotionStatus()
      .then(setNotionStatus)
      .catch(() => setNotionStatus({ configured: false, hasToken: false, parentPageId: '' }));
    loadCatalog()
      .then((catalog) => setGlbCount(catalog.glbCount))
      .catch(() => setGlbCount(null));
  }, [refreshLocal]);

  useEffect(() => {
    if (tab === 'notion' && notionStatus?.configured) refreshNotion();
  }, [tab, notionStatus?.configured, refreshNotion]);

  const heroProject = projects[0];
  const heroVertices = useMemo(
    () => heroProject?.vertices ?? getTemplate('t-shape').vertices,
    [heroProject],
  );

  const openNotionProject = async (item: NotionProjectListItem) => {
    const local = projects.find((project) => project.notionBlockId === item.id);
    if (local) {
      navigate(`/editor/${local.id}`);
      return;
    }
    setOpeningId(item.id);
    try {
      const project = await loadProjectFromNotion(item.id);
      await refreshLocal();
      navigate(`/editor/${project.id}`);
    } catch (error) {
      toast((error as Error).message, 'error');
    } finally {
      setOpeningId(null);
    }
  };

  const duplicate = async (project: ProjectSummary) => {
    try {
      const copy = await duplicateLocalProject(project.id);
      await refreshLocal();
      toast(`«${copy.name}» creado.`, 'success');
    } catch (error) {
      toast((error as Error).message, 'error');
    }
  };

  const exportProject = async (project: ProjectSummary) => {
    try {
      const full = await loadProject(project.id);
      if (!full) throw new Error('No se encontró el proyecto.');
      exportProjectFile(full);
      toast('Proyecto exportado como JSON editable.', 'success');
    } catch (error) {
      toast((error as Error).message, 'error');
    }
  };

  const confirmDelete = async () => {
    if (!deleteTarget) return;
    setDeleting(true);
    try {
      await removeProject(deleteTarget.id);
      setDeleteTarget(null);
      await refreshLocal();
      toast('Proyecto eliminado del almacenamiento local.', 'success');
    } catch (error) {
      toast((error as Error).message, 'error');
    } finally {
      setDeleting(false);
    }
  };

  const importFile = async (file: File | undefined) => {
    if (!file) return;
    try {
      const project = await importProjectFile(file);
      await refreshLocal();
      toast(`«${project.name}» importado.`, 'success');
      navigate(`/editor/${project.id}`);
    } catch (error) {
      toast(`No se pudo importar: ${(error as Error).message}`, 'error');
    } finally {
      if (importRef.current) importRef.current.value = '';
    }
  };

  const notionLocalIds = new Set(projects.map((project) => project.notionBlockId).filter(Boolean));

  return (
    <div className="app-home">
      <header className="home-header">
        <div className="brand">
          <span className="brand-mark"><Layers size={17} /></span>
          <span className="brand-text">
            modulab
            <small>espacios expositivos 3D</small>
          </span>
        </div>
        <nav>
          <Button variant="ghost" size="sm" onClick={() => setShortcutsOpen(true)} icon={<HelpCircle size={15} />}>
            Atajos
          </Button>
          <Button
            variant={notionStatus?.configured ? 'outline' : 'secondary'}
            size="sm"
            onClick={() => setNotionModalOpen(true)}
            icon={<Cloud size={15} />}
          >
            {notionStatus?.configured ? 'Notion conectado' : 'Conectar Notion'}
          </Button>
          <Button variant="primary" size="sm" onClick={() => setNewOpen(true)} icon={<Plus size={15} />}>
            Nuevo proyecto
          </Button>
        </nav>
      </header>

      <main className="home-main">
        <section className="hero">
          <div>
            <div className="hero-kicker">Editor de montajes expositivos</div>
            <h1 className="hero-title">
              Dibuja el espacio.<br />
              Coloca el mobiliario.<br />
              <em>Publica el recorrido.</em>
            </h1>
            <p className="hero-sub">
              Modulab convierte una planta sencilla en un recinto 3D navegable. Sin modelar en Blender:
              dibuja el contorno, genera muros, arrastra modelos GLB y comparte un enlace para visitar la muestra.
            </p>
            <div className="hero-actions">
              <Button variant="primary" size="lg" onClick={() => setNewOpen(true)} icon={<Sparkles size={17} />}>
                Crear espacio
              </Button>
              <Button variant="outline" size="lg" onClick={() => importRef.current?.click()} icon={<Import size={16} />}>
                Importar proyecto
              </Button>
              <input
                ref={importRef}
                type="file"
                accept="application/json,.json"
                hidden
                onChange={(event) => importFile(event.target.files?.[0])}
              />
            </div>
          </div>
          <div className="hero-side">
            <div className="hero-card">
              <div className="mini-plan">
                <MiniPlan vertices={heroVertices} accent="var(--accent)" />
              </div>
              <div className="hero-card-foot">
                <span>{heroProject ? 'Último proyecto' : 'Planta de ejemplo'}</span>
                <strong>{heroProject?.name ?? 'Forma en T · 68 m²'}</strong>
              </div>
              <div className="hero-card-stats">
                <div><strong>{projects.length}</strong><span>Proyectos</span></div>
                <div><strong>{glbCount ?? '—'}</strong><span>GLB en catálogo</span></div>
                <div><strong>∞</strong><span>Recorridos</span></div>
              </div>
            </div>
          </div>
        </section>

        {!notionStatus?.configured ? (
          <div className="notion-banner">
            <div>
              <h3><Cloud size={16} /> Guarda tus proyectos y fichas en Notion</h3>
              <p>
                Conecta una página padre: Modulab creará un toggle por proyecto y podrá leer las personas
                desde un toggle list, incluidas sus fotos y descripciones.
              </p>
            </div>
            <Button variant="secondary" onClick={() => setNotionModalOpen(true)} icon={<Settings2 size={15} />}>
              Configurar Notion
            </Button>
          </div>
        ) : (
          <div className="notion-banner">
            <div>
              <h3><Cloud size={16} /> Notion conectado</h3>
              <p>
                Página: <strong>{notionStatus.parentPageTitle || notionStatus.parentPageId}</strong>
                {notionStatus.error ? ` · ${notionStatus.error}` : ''}
              </p>
            </div>
            <Button variant="ghost" onClick={() => setNotionModalOpen(true)} icon={<Settings2 size={15} />}>
              Ajustes
            </Button>
          </div>
        )}

        <section className="projects-section">
          <div className="section-head">
            <div>
              <h2>Tus espacios</h2>
              <p>Los proyectos se guardan en este navegador y, si quieres, también en Notion.</p>
            </div>
            <div className="section-actions">
              <Tabs
                value={tab}
                onChange={setTab}
                options={[
                  { value: 'local', label: 'Locales', badge: projects.length },
                  { value: 'notion', label: 'Notion', badge: notionProjects.length || undefined },
                ]}
              />
            </div>
          </div>

          {tab === 'local' ? (
            loading ? (
              <div style={{ padding: 40 }}><Spinner label="Leyendo proyectos locales…" /></div>
            ) : projects.length === 0 ? (
              <EmptyState
                icon={<FolderOpen size={20} />}
                title="Todavía no hay espacios"
                description="Crea un proyecto con una planta rectangular, en L o en T. También puedes importar un archivo .modulab.json."
                action={
                  <div className="inline-actions" style={{ marginTop: 6 }}>
                    <Button variant="primary" onClick={() => setNewOpen(true)} icon={<Plus size={15} />}>Nuevo proyecto</Button>
                    <Button variant="outline" onClick={() => importRef.current?.click()} icon={<Upload size={15} />}>Importar</Button>
                  </div>
                }
              />
            ) : (
              <div className="project-grid">
                {projects.map((project) => (
                  <ProjectCard
                    key={project.id}
                    project={project}
                    onOpen={() => navigate(`/editor/${project.id}`)}
                    onDuplicate={() => duplicate(project)}
                    onExport={() => exportProject(project)}
                    onDelete={() => setDeleteTarget(project)}
                    onPublish={() => project.published ? window.open(`/e/${project.published.publicId}`, '_blank') : undefined}
                  />
                ))}
              </div>
            )
          ) : (
            <NotionProjects
              configured={Boolean(notionStatus?.configured)}
              loading={notionLoading}
              error={notionError}
              projects={notionProjects}
              localIds={notionLocalIds}
              openingId={openingId}
              onRefresh={refreshNotion}
              onOpen={openNotionProject}
              onConfigure={() => setNotionModalOpen(true)}
            />
          )}
        </section>
      </main>

      <footer className="home-footer">
        <span>modulab · editor de espacios expositivos · {new Date().getFullYear()}</span>
        <span style={{ display: 'inline-flex', alignItems: 'center', gap: 6 }}>
          <Boxes size={12} /> Catálogo GLB dinámico
          <span style={{ margin: '0 4px', opacity: 0.4 }}>·</span>
          <Users size={12} /> Fichas desde Notion
        </span>
      </footer>

      <NewProjectModal
        open={newOpen}
        onClose={() => setNewOpen(false)}
        notionConfigured={Boolean(notionStatus?.configured)}
        onCreated={async (project) => {
          await refreshLocal();
          navigate(`/editor/${project.id}`);
        }}
      />

      <ConfirmDialog
        open={Boolean(deleteTarget)}
        title="Eliminar proyecto local"
        message={
          <>
            Se eliminará <strong>{deleteTarget?.name}</strong> de este navegador. Si está vinculado a Notion,
            la página de Notion no se borra; podrás volver a abrirla desde la pestaña Notion.
          </>
        }
        confirmLabel="Eliminar"
        danger
        loading={deleting}
        onConfirm={confirmDelete}
        onCancel={() => setDeleteTarget(null)}
      />
    </div>
  );
}

function NotionProjects({
  configured,
  loading,
  error,
  projects,
  localIds,
  openingId,
  onRefresh,
  onOpen,
  onConfigure,
}: {
  configured: boolean;
  loading: boolean;
  error: string | null;
  projects: NotionProjectListItem[];
  localIds: Set<string | undefined>;
  openingId: string | null;
  onRefresh: () => void;
  onOpen: (project: NotionProjectListItem) => void;
  onConfigure: () => void;
}) {
  if (!configured) {
    return (
      <EmptyState
        icon={<Cloud size={20} />}
        title="Notion todavía no está conectado"
        description="Añade el token de una integración y la página padre de proyectos. Modulab podrá listar, abrir y guardar cada espacio como un toggle."
        action={<Button variant="primary" onClick={onConfigure} icon={<Settings2 size={15} />}>Conectar Notion</Button>}
      />
    );
  }
  return (
    <div>
      <div className="row-between" style={{ marginBottom: 10 }}>
        <span className="panel-note">Proyectos detectados como bloques toggle o páginas hijas.</span>
        <Button variant="ghost" size="sm" onClick={onRefresh} icon={<RefreshCcw size={14} />} loading={loading}>
          Actualizar
        </Button>
      </div>
      {error ? <div className="settings-status is-error" style={{ marginBottom: 10 }}>{error}</div> : null}
      {loading && projects.length === 0 ? (
        <div style={{ padding: 30 }}><Spinner label="Leyendo Notion…" /></div>
      ) : projects.length === 0 ? (
        <EmptyState
          icon={<Cloud size={20} />}
          title="No hay proyectos en esa página"
          description="Crea un toggle dentro de la página padre o crea un proyecto nuevo aquí y guárdalo en Notion."
        />
      ) : (
        <div className="project-grid">
          {projects.map((project) => (
            <article className="project-card" key={project.id}>
              <div className="project-thumb" style={{ display: 'grid', placeItems: 'center' }}>
                <div className="notion-thumb">
                  <Cloud size={26} />
                  <span>Notion</span>
                </div>
                <div className="project-thumb-badges">
                  {localIds.has(project.id) ? <Badge tone="accent">Abierto localmente</Badge> : <Badge tone="info">Remoto</Badge>}
                </div>
              </div>
              <div className="project-body">
                <div className="project-title">{project.name}</div>
                <div className="project-event">
                  {project.type === 'toggle' ? 'Toggle de proyecto' : 'Página hija'}
                  {project.lastEditedTime ? ` · ${formatRelativeDate(project.lastEditedTime)}` : ''}
                </div>
                <div className="project-meta">
                  <span><Cloud size={11} /> {project.id.slice(0, 8)}…</span>
                </div>
              </div>
              <div className="project-actions">
                <Button
                  variant="secondary"
                  size="sm"
                  onClick={() => onOpen(project)}
                  loading={openingId === project.id}
                  icon={<ArrowUpRight size={14} />}
                >
                  Abrir desde Notion
                </Button>
              </div>
            </article>
          ))}
        </div>
      )}
    </div>
  );
}
