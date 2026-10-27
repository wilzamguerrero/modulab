import { useEffect, useState } from 'react';
import {
  AlertTriangle,
  Check,
  Copy,
  ExternalLink,
  Globe2,
  Sparkles,
} from 'lucide-react';
import type { Project } from '@/types/project';
import { Badge, Button, Field, Modal, TextInput } from '@/components/ui';
import { useUiStore } from '@/store/uiStore';
import {
  getPublishChecks,
  publishProject,
  shareUrl,
} from '@/services/publishing/publishService';
import { formatDateTime } from '@/utils/format';

export function PublishModal({
  project,
  open,
  onClose,
  onPublished,
}: {
  project: Project;
  open: boolean;
  onClose: () => void;
  onPublished: (project: Project) => void;
}) {
  const toast = useUiStore((state) => state.toast);
  const [publishing, setPublishing] = useState(false);
  const [result, setResult] = useState<{ url: string; version: number } | null>(null);
  const checks = getPublishChecks(project);
  const blocking = checks.filter((check) => !check.ok && (check.label === 'Nombre del proyecto' || check.label === 'Planta válida'));
  const canPublish = blocking.length === 0;
  const currentUrl = project.published ? shareUrl(project.published.publicId) : null;

  useEffect(() => {
    if (open) setResult(null);
  }, [open]);

  const publish = async () => {
    setPublishing(true);
    try {
      const response = await publishProject(project);
      onPublished(response.published);
      setResult({ url: response.url, version: response.published.published?.version ?? 1 });
      toast('Espacio publicado. El enlace ya está disponible.', 'success');
    } catch (error) {
      toast(`No se pudo publicar: ${(error as Error).message}`, 'error');
    } finally {
      setPublishing(false);
    }
  };

  const copy = async (url: string) => {
    try {
      await navigator.clipboard.writeText(url);
      toast('Enlace copiado.', 'success');
    } catch {
      toast('No se pudo copiar automáticamente. Selecciona el enlace y cópialo.', 'warning');
    }
  };

  return (
    <Modal
      open={open}
      onClose={onClose}
      title={project.published ? 'Actualizar publicación' : 'Publicar espacio'}
      subtitle="El visor público es de solo lectura y usa una copia independiente del borrador."
      size="lg"
      footer={
        result ? (
          <>
            <Button variant="ghost" onClick={onClose}>Cerrar</Button>
            <Button
              variant="primary"
              onClick={() => window.open(result.url, '_blank')}
              icon={<ExternalLink size={15} />}
            >
              Abrir visor público
            </Button>
          </>
        ) : (
          <>
            <Button variant="ghost" onClick={onClose}>Cancelar</Button>
            <Button
              variant="primary"
              onClick={publish}
              loading={publishing}
              disabled={!canPublish}
              icon={<Sparkles size={15} />}
            >
              {project.published ? 'Publicar nueva versión' : 'Publicar'}
            </Button>
          </>
        )
      }
    >
      {result ? (
        <div className="publish-success">
          <div className="publish-success-icon"><Check size={22} /></div>
          <div>
            <h3>Publicación lista · versión {result.version}</h3>
            <p>Cualquier persona con este enlace puede explorar el espacio. Los cambios del editor no aparecerán hasta que vuelvas a publicar.</p>
          </div>
          <Field label="Enlace público">
            <div className="row">
              <TextInput readOnly value={result.url} onFocus={(event) => event.currentTarget.select()} />
              <Button variant="secondary" onClick={() => copy(result.url)} icon={<Copy size={14} />}>
                Copiar
              </Button>
            </div>
          </Field>
          <div className="inline-actions">
            <Button variant="outline" onClick={() => copy(result.url)} icon={<Copy size={14} />}>Copiar enlace</Button>
            <Button variant="secondary" onClick={() => window.open(result.url, '_blank')} icon={<ExternalLink size={14} />}>Abrir</Button>
          </div>
        </div>
      ) : (
        <>
          <div className="publish-status">
            <Globe2 size={16} />
            <div>
              <strong>{project.published ? `Publicado como /e/${project.published.publicId}` : 'Todavía no publicado'}</strong>
              <span>
                {project.published
                  ? `Versión ${project.published.version} · ${formatDateTime(project.published.publishedAt)}`
                  : 'Al publicar se guardará una instantánea de la escena actual.'}
              </span>
            </div>
            {project.published ? <Badge tone="accent">en línea</Badge> : <Badge tone="neutral">borrador</Badge>}
          </div>

          {currentUrl ? (
            <Field label="Enlace actual">
              <div className="row">
                <TextInput readOnly value={currentUrl} onFocus={(event) => event.currentTarget.select()} />
                <Button variant="secondary" onClick={() => copy(currentUrl)} icon={<Copy size={14} />}>Copiar</Button>
              </div>
            </Field>
          ) : null}

          <div className="publish-checks">
            {checks.map((check) => (
              <div key={check.label} className={`publish-check${check.ok ? ' is-ok' : ' is-warning'}`}>
                <span className="publish-check-icon">
                  {check.ok ? <Check size={14} /> : <AlertTriangle size={14} />}
                </span>
                <div>
                  <strong>{check.label}</strong>
                  <span>{check.detail}</span>
                </div>
              </div>
            ))}
          </div>

          {!canPublish ? (
            <div className="settings-status is-error">
              Corrige el nombre o la planta antes de publicar. Las advertencias de mobiliario o
              expositores no bloquean la publicación.
            </div>
          ) : null}

          <div className="hint-box">
            <strong>Qué se publica:</strong> la planta, los muros, los objetos, las luces, los
            expositores y sus fichas. Los modelos GLB se cargan desde el catálogo del servidor; si
            cambias un archivo GLB, la publicación usará la versión nueva.
          </div>
        </>
      )}
    </Modal>
  );
}
