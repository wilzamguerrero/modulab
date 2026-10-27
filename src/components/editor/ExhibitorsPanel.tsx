import { useEffect, useState } from 'react';
import {
  AlertTriangle,
  Cloud,
  RefreshCcw,
  Settings2,
  Trash2,
  UserPlus,
  Users,
} from 'lucide-react';
import type { Project, Vec2 } from '@/types/project';
import { Badge, Button, Field, IconButton, Spinner, TextInput } from '@/components/ui';
import { useEditorStore } from '@/store/editorStore';
import { useUiStore } from '@/store/uiStore';
import { notionPhotoUrl, syncPeopleIntoProject } from '@/services/notion/notionService';
import { polygonBounds, polygonCentroid, pointInPolygon } from '@/utils/geometry';
import { formatRelativeDate } from '@/utils/format';

function freePosition(project: Project): Vec2 {
  if (project.floor.vertices.length < 3) return { x: 0, z: 0 };
  const center = polygonCentroid(project.floor.vertices);
  if (pointInPolygon(center, project.floor.vertices)) return center;
  return polygonBounds(project.floor.vertices).center;
}

export function ExhibitorsPanel({
  project,
  notionConfigured,
}: {
  project: Project;
  notionConfigured: boolean;
}) {
  const toast = useUiStore((state) => state.toast);
  const setNotionModalOpen = useUiStore((state) => state.setNotionModalOpen);
  const setView = useEditorStore((state) => state.setView);
  const setSelection = useEditorStore((state) => state.setSelection);
  const addExhibitor = useEditorStore((state) => state.addExhibitor);
  const deleteExhibitor = useEditorStore((state) => state.deleteExhibitor);
  const removeMissingExhibitors = useEditorStore((state) => state.removeMissingExhibitors);
  const replaceProject = useEditorStore((state) => state.replaceProject);
  const [pageId, setPageId] = useState(
    project.notionExhibitorsPageId || project.notionBlockId || '',
  );
  const [syncing, setSyncing] = useState(false);
  const missingCount = project.exhibitors.filter((exhibitor) => exhibitor.notionMissing).length;

  useEffect(() => {
    setPageId(project.notionExhibitorsPageId || project.notionBlockId || '');
  }, [project.id, project.notionExhibitorsPageId, project.notionBlockId]);

  const add = () => {
    const id = addExhibitor(freePosition(project));
    if (id) {
      setView('3d');
      toast('Expositor creado. Completa su ficha en el inspector.', 'success');
    }
  };

  const sync = async () => {
    if (!notionConfigured) {
      setNotionModalOpen(true);
      return;
    }
    if (!pageId.trim()) {
      toast('Indica la página o el toggle de Notion que contiene las personas.', 'warning');
      return;
    }
    setSyncing(true);
    try {
      const result = await syncPeopleIntoProject(project, pageId.trim());
      replaceProject(result.project, true);
      const parts = [
        `${result.total} persona${result.total === 1 ? '' : 's'} leída${result.total === 1 ? '' : 's'}`,
        `${result.added} nueva${result.added === 1 ? '' : 's'}`,
        `${result.updated} actualizada${result.updated === 1 ? '' : 's'}`,
      ];
      if (result.missing) parts.push(`${result.missing} sin coincidencia`);
      toast(parts.join(' · '), result.missing ? 'warning' : 'success');
    } catch (syncError) {
      toast(`No se pudo sincronizar Notion: ${(syncError as Error).message}`, 'error');
    } finally {
      setSyncing(false);
    }
  };

  return (
    <div>
      <section className="panel-section">
        <div className="panel-title">
          <span><Users size={12} /> Expositores</span>
          <Badge tone={project.exhibitors.length ? 'accent' : 'neutral'}>{project.exhibitors.length}</Badge>
        </div>
        <div className="inline-actions">
          <Button size="sm" variant="primary" onClick={add} icon={<UserPlus size={13} />}>
            Añadir expositor
          </Button>
          {project.exhibitors.length ? (
            <Button size="sm" variant="outline" onClick={() => setView('3d')} icon={<Users size={13} />}>
              Ver marcadores
            </Button>
          ) : null}
        </div>
        <p className="panel-note">
          Cada expositor es un punto de interés con ficha, fotografía y cámara propia. En el visor
          público se puede saltar a su stand.
        </p>
      </section>

      <section className="panel-section">
        <div className="panel-title">
          <span><Cloud size={12} /> Sincronizar desde Notion</span>
          {notionConfigured ? <Badge tone="success">conectado</Badge> : <Badge tone="warning">sin conexión</Badge>}
        </div>
        {!notionConfigured ? (
          <div className="hint-box">
            <strong>Notion no está conectado.</strong> Configura el token y la página padre para
            importar personas, fotos, descripciones y líneas como «Stand: A-01».
            <div style={{ marginTop: 8 }}>
              <Button size="sm" variant="secondary" onClick={() => setNotionModalOpen(true)} icon={<Settings2 size={13} />}>
                Configurar Notion
              </Button>
            </div>
          </div>
        ) : (
          <>
            <Field
              label="Página o toggle de personas"
              hint="Pega la URL de la página que contiene el toggle list de expositores. Si se deja vacío, se usa la página del proyecto."
            >
              <TextInput
                value={pageId}
                onChange={(event) => setPageId(event.target.value)}
                placeholder="https://www.notion.so/…"
              />
            </Field>
            <Button
              size="sm"
              variant="secondary"
              onClick={sync}
              loading={syncing}
              icon={<RefreshCcw size={13} />}
            >
              Sincronizar personas
            </Button>
            {project.notionExhibitorsSourceName ? (
              <p className="panel-note">
                Fuente: <strong>{project.notionExhibitorsSourceName}</strong>
                {project.notionLastSyncedAt ? ` · ${formatRelativeDate(project.notionLastSyncedAt)}` : ''}
              </p>
            ) : null}
            <p className="panel-note">
              Se conservan las posiciones y cámaras de los expositores ya existentes. Las personas
              eliminadas en Notion se marcan como «sin coincidencia».
            </p>
          </>
        )}
        {missingCount ? (
          <div className="settings-status is-error">
            <AlertTriangle size={14} />
            <span>{missingCount} expositor{missingCount === 1 ? '' : 'es'} ya no aparece en Notion.</span>
            <Button size="sm" variant="ghost" onClick={removeMissingExhibitors} icon={<Trash2 size={13} />}>
              Quitar
            </Button>
          </div>
        ) : null}
      </section>

      <section className="panel-section">
        <div className="panel-title"><span>Listado</span><small>{project.exhibitors.length}</small></div>
        {syncing ? <div style={{ padding: 12 }}><Spinner label="Leyendo Notion…" /></div> : null}
        <div className="stack">
          {project.exhibitors.map((exhibitor) => {
            const photo = notionPhotoUrl(exhibitor);
            return (
              <article
                key={exhibitor.id}
                className={`list-card${exhibitor.notionMissing ? ' is-missing' : ''}`}
                onClick={() => {
                  setSelection({ type: 'exhibitor', id: exhibitor.id });
                  setView('3d');
                }}
              >
                <div className="list-thumb">
                  {photo ? (
                    <img
                      src={photo}
                      alt=""
                      onError={(event) => {
                        (event.currentTarget as HTMLImageElement).style.display = 'none';
                      }}
                    />
                  ) : (
                    <span>{exhibitor.name.slice(0, 2).toUpperCase() || 'EX'}</span>
                  )}
                </div>
                <div className="list-card-main">
                  <div className="list-card-title">{exhibitor.name || 'Sin nombre'}</div>
                  <div className="list-card-sub">
                    {exhibitor.standCode || 'Sin stand'}
                    {exhibitor.notionMissing ? ' · no está en Notion' : ''}
                  </div>
                </div>
                {exhibitor.notionMissing ? <Badge tone="danger">!</Badge> : null}
                <IconButton
                  label="Eliminar expositor"
                  icon={<Trash2 size={13} />}
                  onClick={(event) => {
                    event.stopPropagation();
                    deleteExhibitor(exhibitor.id);
                    toast('Expositor eliminado.', 'success');
                  }}
                />
              </article>
            );
          })}
          {project.exhibitors.length === 0 ? (
            <div className="empty-state" style={{ padding: '20px 12px' }}>
              <Users size={18} />
              <h3>Todavía no hay expositores</h3>
              <p>Añade un punto de interés o sincroniza el toggle list de personas desde Notion.</p>
            </div>
          ) : null}
        </div>
      </section>
    </div>
  );
}
