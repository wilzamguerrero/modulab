import { useCallback, useEffect, useMemo, useState } from 'react';
import { Link, useParams } from 'react-router-dom';
import {
  AlertTriangle,
  ArrowLeft,
  ChevronLeft,
  ChevronRight,
  Compass,
  Home,
  Layers,
  MapPin,
  Maximize2,
  MousePointer2,
  Users,
  X,
} from 'lucide-react';
import type { Exhibitor, Project } from '@/types/project';
import { Badge, IconButton, Spinner } from '@/components/ui';
import { PublicScene, type ViewerCameraCommand } from '@/components/viewer/PublicScene';
import { fetchPublished } from '@/services/publishing/publishService';
import { notionPhotoUrl } from '@/services/notion/notionService';
import { defaultExhibitorCamera, isExhibitorCameraUsable } from '@/data/defaults';
import { pointInPolygon } from '@/utils/geometry';
import { exhibitorColor } from '@/utils/exhibitorColors';

function initials(name: string): string {
  const words = name
    .trim()
    .split(/\s+/)
    .filter(Boolean)
    .slice(0, 2);
  if (words.length === 0) return 'EX';
  return words.map((word) => word[0]?.toUpperCase() ?? '').join('');
}

function finiteVector(vector: unknown): vector is [number, number, number] {
  return (
    Array.isArray(vector) &&
    vector.length === 3 &&
    vector.every((value) => typeof value === 'number' && Number.isFinite(value))
  );
}

/**
 * Usa la cámara configurada por el editor, pero sustituye vistas imposibles
 * (vectores inválidos, cámara bajo el piso o cámara pegada al objetivo).
 */
export function focusCameraFor(
  exhibitor: Exhibitor,
  project: Project,
): { position: [number, number, number]; target: [number, number, number] } {
  const position = exhibitor.cameraPosition;
  const target = exhibitor.cameraTarget;
  const distance = Math.hypot(
    position[0] - target[0],
    position[1] - target[1],
    position[2] - target[2],
  );
  const targetInside =
    project.floor.vertices.length < 3 ||
    pointInPolygon({ x: target[0], z: target[2] }, project.floor.vertices);
  if (
    finiteVector(position) &&
    finiteVector(target) &&
    position[1] >= 0.35 &&
    distance >= 0.8 &&
    targetInside &&
    isExhibitorCameraUsable(position, project.floor.vertices)
  ) {
    return { position, target };
  }
  return defaultExhibitorCamera(exhibitor.position, project.floor.vertices);
}

function ViewerSidebar({
  project,
  selectedId,
  onSelect,
}: {
  project: Project;
  selectedId: string | null;
  onSelect: (exhibitor: Exhibitor) => void;
}) {
  const exhibitors = project.exhibitors.filter((exhibitor) => exhibitor.visible);

  return (
    <aside className="viewer-sidebar">
      <div className="viewer-sidebar-head">
        <h2>
          <Users size={15} />
          Expositores
          <span className="viewer-count">{exhibitors.length}</span>
        </h2>
        <p>Selecciona una ficha para viajar hasta su stand.</p>
      </div>
      <div className="viewer-list">
        {exhibitors.length === 0 ? (
          <div className="viewer-empty">
            <Users size={22} />
            <strong>Sin expositores publicados</strong>
            <span>Explora el recinto libremente en 3D.</span>
          </div>
        ) : (
          exhibitors.map((exhibitor) => {
            const photo = notionPhotoUrl(exhibitor);
            const active = selectedId === exhibitor.id;
            return (
              <button
                key={exhibitor.id}
                type="button"
                className={`viewer-card${active ? ' is-active' : ''}`}
                onClick={() => onSelect(exhibitor)}
              >
                <span
                  className="viewer-card-thumb"
                  style={{ borderColor: exhibitorColor(exhibitor) }}
                >
                  {photo ? <img src={photo} alt="" /> : initials(exhibitor.name)}
                </span>
                <span className="viewer-card-main">
                  <span className="viewer-card-name">
                    <span
                      className="color-dot"
                      style={{ background: exhibitorColor(exhibitor) }}
                    />
                    {exhibitor.name || 'Expositor'}
                  </span>
                  <span className="viewer-card-sub">
                    {exhibitor.standCode ? (
                      <>
                        <MapPin size={10} /> {exhibitor.standCode}
                      </>
                    ) : (
                      'Punto de interés'
                    )}
                  </span>
                </span>
              </button>
            );
          })
        )}
      </div>
    </aside>
  );
}

function ExhibitorCard({
  project,
  exhibitor,
  onClose,
  onPrevious,
  onNext,
}: {
  project: Project;
  exhibitor: Exhibitor;
  onClose: () => void;
  onPrevious: () => void;
  onNext: () => void;
}) {
  const photo = notionPhotoUrl(exhibitor);
  const related = project.objects.filter(
    (object) =>
      object.exhibitorId === exhibitor.id || exhibitor.relatedObjectIds.includes(object.id),
  );
  const relatedWalls =
    project.edges.filter((edge) => edge.exhibitorId === exhibitor.id).length +
    project.internalWalls.filter((wall) => wall.exhibitorId === exhibitor.id).length;
  const relatedOpenings = project.openings.filter(
    (opening) => opening.exhibitorId === exhibitor.id,
  ).length;
  const relatedTotal = related.length + relatedWalls + relatedOpenings;

  return (
    <aside className="viewer-info-card" aria-live="polite">
      <div className="viewer-info-head">
        <div style={{ minWidth: 0 }}>
          <h3>
            <span
              className="color-dot"
              style={{ background: exhibitorColor(exhibitor) }}
            />
            {exhibitor.name || 'Expositor'}
          </h3>
          <div className="viewer-info-meta">
            {exhibitor.standCode ? <Badge tone="accent">Stand {exhibitor.standCode}</Badge> : null}
            {relatedTotal ? (
              <span>
                {related.length} objeto{related.length === 1 ? '' : 's'} · {relatedWalls} muro
                {relatedWalls === 1 ? '' : 's'} · {relatedOpenings} abertura
                {relatedOpenings === 1 ? '' : 's'}
              </span>
            ) : null}
          </div>
        </div>
        <div className="viewer-info-actions">
          <IconButton label="Expositor anterior" icon={<ChevronLeft size={15} />} onClick={onPrevious} />
          <IconButton label="Expositor siguiente" icon={<ChevronRight size={15} />} onClick={onNext} />
          <IconButton label="Cerrar ficha" icon={<X size={15} />} onClick={onClose} />
        </div>
      </div>

      {photo ? <img className="viewer-info-photo" src={photo} alt={exhibitor.name} /> : null}

      <p className={exhibitor.description ? undefined : 'viewer-info-empty'}>
        {exhibitor.description || 'Este expositor todavía no tiene una descripción.'}
      </p>

      {related.length ? (
        <div className="viewer-info-objects">
          <span>En su espacio</span>
          <div>
            {related.slice(0, 6).map((object) => (
              <Badge key={object.id} tone="neutral">{object.name}</Badge>
            ))}
            {related.length > 6 ? <Badge tone="neutral">+{related.length - 6}</Badge> : null}
          </div>
        </div>
      ) : null}
    </aside>
  );
}

export function PublicViewerPage() {
  const { publicId } = useParams<{ publicId: string }>();
  const [project, setProject] = useState<Project | null>(null);
  const [loading, setLoading] = useState(true);
  const [error, setError] = useState<string | null>(null);
  const [selectedId, setSelectedId] = useState<string | null>(null);
  const [cameraCommand, setCameraCommand] = useState<ViewerCameraCommand>({
    mode: 'reset',
    nonce: 0,
  });

  useEffect(() => {
    if (!publicId) {
      setError('La dirección no incluye un identificador de publicación.');
      setLoading(false);
      return;
    }
    let cancelled = false;
    setLoading(true);
    setError(null);
    fetchPublished(publicId)
      .then((document) => {
        if (cancelled) return;
        setProject(document.project);
      })
      .catch((fetchError: Error) => {
        if (cancelled) return;
        setError(fetchError.message || 'No se encontró la publicación.');
      })
      .finally(() => {
        if (!cancelled) setLoading(false);
      });
    return () => {
      cancelled = true;
    };
  }, [publicId]);

  // Las fichas eliminadas en Notion se conservan en el editor para poder
  // recuperarlas, pero no deben aparecer en la experiencia pública.
  const publicProject = useMemo(
    () =>
      project
        ? {
            ...project,
            exhibitors: project.exhibitors.filter(
              (exhibitor) => exhibitor.visible && !exhibitor.notionMissing,
            ),
          }
        : null,
    [project],
  );

  const visibleExhibitors = useMemo(() => publicProject?.exhibitors ?? [], [publicProject]);

  const selectedExhibitor = useMemo(
    () => visibleExhibitors.find((exhibitor) => exhibitor.id === selectedId) ?? null,
    [visibleExhibitors, selectedId],
  );

  const selectExhibitor = useCallback((exhibitor: Exhibitor) => {
    if (!publicProject) return;
    setSelectedId(exhibitor.id);
    const camera = focusCameraFor(exhibitor, publicProject);
    setCameraCommand((current) => ({
      mode: 'focus',
      nonce: current.nonce + 1,
      position: camera.position,
      target: camera.target,
    }));
  }, [publicProject]);

  const selectById = useCallback(
    (id: string) => {
      const exhibitor = visibleExhibitors.find((entry) => entry.id === id);
      if (exhibitor) selectExhibitor(exhibitor);
    },
    [visibleExhibitors, selectExhibitor],
  );

  const moveSelection = (direction: 1 | -1) => {
    if (!selectedExhibitor || visibleExhibitors.length === 0) return;
    const index = visibleExhibitors.findIndex((entry) => entry.id === selectedExhibitor.id);
    const next = visibleExhibitors[(index + direction + visibleExhibitors.length) % visibleExhibitors.length];
    if (next) selectExhibitor(next);
  };

  const resetCamera = () => {
    setSelectedId(null);
    setCameraCommand((current) => ({ mode: 'reset', nonce: current.nonce + 1 }));
  };

  const topCamera = () => {
    setCameraCommand((current) => ({ mode: 'top', nonce: current.nonce + 1 }));
  };

  if (loading) {
    return (
      <div className="viewer-loading">
        <Spinner label="Abriendo el espacio publicado…" />
      </div>
    );
  }

  if (!project || !publicProject || error) {
    return (
      <div className="viewer-loading">
        <div className="viewer-error">
          <div className="empty-icon"><AlertTriangle size={20} /></div>
          <h1>Publicación no disponible</h1>
          <p>{error || 'No se encontró esta publicación. Comprueba el enlace o vuelve a publicar el espacio desde Modulab.'}</p>
          <div className="inline-actions">
            <Link to="/" className="btn btn-primary btn-md">
              <Home size={15} />
              <span>Ir a Modulab</span>
            </Link>
          </div>
        </div>
      </div>
    );
  }

  return (
    <div className="viewer-page">
      <header className="viewer-header">
        <div className="viewer-header-left">
          <Link to="/" className="brand viewer-brand" aria-label="Modulab">
            <span className="brand-mark"><Layers size={15} /></span>
            <span className="brand-text">
              modulab
              <small>visor 3D</small>
            </span>
          </Link>
          <span className="viewer-header-divider" />
          <div className="viewer-header-info">
            <h1>{project.name}</h1>
            <p>
              {project.event || 'Espacio expositivo'}
              {' · '}
              {visibleExhibitors.length} expositor{visibleExhibitors.length === 1 ? '' : 'es'}
            </p>
          </div>
        </div>
        <div className="viewer-header-actions">
          <Badge tone="neutral">solo lectura</Badge>
          <Link to="/" className="btn btn-outline btn-sm" title="Volver a Modulab">
            <ArrowLeft size={14} />
            <span>Modulab</span>
          </Link>
        </div>
      </header>

      <div className="viewer-body">
        <ViewerSidebar
          project={publicProject}
          selectedId={selectedId}
          onSelect={selectExhibitor}
        />

        <main className="viewer-stage">
          <PublicScene
            project={publicProject}
            selectedExhibitorId={selectedId}
            cameraCommand={cameraCommand}
            onSelectExhibitor={selectById}
            onClearSelection={() => setSelectedId(null)}
          />

          <div className="viewer-hint">
            <MousePointer2 size={11} /> Arrastra para orbitar · rueda para acercar · clic en un expositor
          </div>

          <div className="viewer-controls">
            <button type="button" onClick={resetCamera} title="Volver a la vista inicial">
              <Compass size={14} />
              Vista general
            </button>
            <button type="button" onClick={topCamera} title="Ver la planta desde arriba">
              <Maximize2 size={14} />
              Vista superior
            </button>
          </div>

          {selectedExhibitor ? (
            <ExhibitorCard
              project={publicProject}
              exhibitor={selectedExhibitor}
              onClose={() => setSelectedId(null)}
              onPrevious={() => moveSelection(-1)}
              onNext={() => moveSelection(1)}
            />
          ) : null}
        </main>
      </div>
    </div>
  );
}
