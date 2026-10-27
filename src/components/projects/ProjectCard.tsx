import { useState } from 'react';
import { ArrowRight, Cloud, Copy, ExternalLink, FileJson, MoreHorizontal, Trash2 } from 'lucide-react';
import type { ProjectSummary } from '@/types/project';
import { MiniPlan } from '@/components/ui/MiniPlan';
import { Badge, Button, IconButton } from '@/components/ui';
import { formatRelativeDate } from '@/utils/format';

export function ProjectCard({
  project,
  onOpen,
  onDuplicate,
  onExport,
  onDelete,
  onPublish,
}: {
  project: ProjectSummary;
  onOpen: () => void;
  onDuplicate: () => void;
  onExport: () => void;
  onDelete: () => void;
  onPublish?: () => void;
}) {
  const [menuOpen, setMenuOpen] = useState(false);
  return (
    <article className="project-card">
      <button type="button" className="project-thumb" onClick={onOpen} aria-label={`Abrir ${project.name}`}>
        <MiniPlan vertices={project.vertices} accent="rgba(215,255,79,.85)" />
        <div className="project-thumb-badges">
          {project.notionBlockId ? <Badge tone="info"><Cloud size={10} /> Notion</Badge> : null}
          {project.published ? <Badge tone="accent">Publicado</Badge> : null}
        </div>
      </button>
      <div className="project-body">
        <button type="button" onClick={onOpen} style={{ textAlign: 'left', background: 'none', border: 0, padding: 0 }}>
          <div className="project-title">{project.name}</div>
          <div className="project-event">{project.event || project.description || 'Sin evento asignado'}</div>
        </button>
        <div className="project-meta">
          <span>{project.objectCount} objetos</span>
          <span>{project.exhibitorCount} expositores</span>
          <span>{formatRelativeDate(project.updatedAt)}</span>
        </div>
      </div>
      <div className="project-actions">
        <Button variant="secondary" size="sm" onClick={onOpen} icon={<ArrowRight size={14} />}>Abrir</Button>
        <div style={{ position: 'relative' }}>
          <IconButton
            label="Más acciones"
            icon={<MoreHorizontal size={16} />}
            onClick={() => setMenuOpen((value) => !value)}
          />
          {menuOpen ? (
            <>
              <div
                style={{ position: 'fixed', inset: 0, zIndex: 30 }}
                onClick={() => setMenuOpen(false)}
                aria-hidden
              />
              <div className="card-menu">
                <button type="button" onClick={() => { setMenuOpen(false); onDuplicate(); }}>
                  <Copy size={14} /> Duplicar
                </button>
                <button type="button" onClick={() => { setMenuOpen(false); onExport(); }}>
                  <FileJson size={14} /> Exportar JSON
                </button>
                {project.published ? (
                  <button type="button" onClick={() => { setMenuOpen(false); onPublish?.(); }}>
                    <ExternalLink size={14} /> Ver publicación
                  </button>
                ) : null}
                <button type="button" className="danger" onClick={() => { setMenuOpen(false); onDelete(); }}>
                  <Trash2 size={14} /> Eliminar
                </button>
              </div>
            </>
          ) : null}
        </div>
      </div>
    </article>
  );
}
