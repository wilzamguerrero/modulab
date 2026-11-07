import { useCallback, useEffect, useMemo, useState } from 'react';
import { Link, useParams } from 'react-router-dom';
import {
  AlertTriangle,
  ChevronLeft,
  ChevronRight,
  Compass,
  Home,
  Layers,
  MapPin,
  Maximize2,
  MousePointer2,
  Ruler,
  Sparkles,
  Tags,
  Users,
  X,
} from 'lucide-react';
import type { Exhibitor, Project, ReaderView, Vec2 } from '@/types/project';
import { Badge, IconButton, Spinner } from '@/components/ui';
import { PublicScene, type ViewerCameraCommand } from '@/components/viewer/PublicScene';
import { fetchPublished } from '@/services/publishing/publishService';
import { notionPhotoUrl } from '@/services/notion/notionService';
import { focusCameraFor } from '@/utils/exhibitorCamera';
import { entityLevelId } from '@/utils/levels';
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

type Vec3Tuple = [number, number, number];

type TravelStop = { position: Vec3Tuple; target: Vec3Tuple; hold?: number };

/**
 * Recorrido del viaje entre dos stands, construido con las vistas de lectura
 * del editor: una cámara por nivel (o una general) en la que el visitante se
 * posa unos instantes antes de llegar.
 *
 *   1. Desde donde está, se acerca primero a la vista de su propio nivel.
 *   2. Si viene de otro nivel, pasa por la vista del nivel de destino.
 *   3. Entra al expositor: la cámara se coloca en la línea marcada por la
 *      flecha de rotación del expositor y mira el stand.
 *
 * Los puntos de rotación ya no se usan como paradas; la posición de la vista
 * la decide el editor en «Entorno → Vistas».
 */
function buildTravelWaypoints(
  project: Project,
  from: Vec2,
  fromExhibitor: Exhibitor | null,
  to: Exhibitor,
  views: ReaderView[],
  activeViewId: string | undefined,
): TravelStop[] {
  if (!views.length) return [];
  const toLevelId = entityLevelId(project, to) ?? null;
  const fromLevelId = fromExhibitor ? (entityLevelId(project, fromExhibitor) ?? null) : null;
  const stops: TravelStop[] = [];

  const viewFor = (levelId: string | null) => {
    const inLevel = views.find((view) => view.levelId && view.levelId === levelId);
    if (inLevel) return inLevel;
    const general = views.find((view) => !view.levelId);
    if (general) return general;
    if (toLevelId !== fromLevelId && levelId === toLevelId) {
      const active = views.find((view) => view.id === activeViewId) ?? views[0];
      return active;
    }
    return null;
  };

  const stopFor = (view: ReaderView): TravelStop => ({
    position: view.position,
    target: view.target,
    // Media pausa en cada vista para que el traslado se lea.
    hold: 650,
  });

  const exitView = fromLevelId ? viewFor(fromLevelId) : null;
  const entryView = toLevelId !== fromLevelId ? viewFor(toLevelId) : null;
  if (exitView && exitView.id !== entryView?.id) stops.push(stopFor(exitView));
  if (entryView) stops.push(stopFor(entryView));
  return stops;
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
  const relatedWalls = project.levels.reduce(
    (total, level) =>
      total +
      level.spaces.reduce(
        (spaceTotal, space) =>
          spaceTotal + space.edges.filter((edge) => edge.exhibitorId === exhibitor.id).length,
        0,
      ) +
      level.internalWalls.filter((wall) => wall.exhibitorId === exhibitor.id).length,
    0,
  );
  const relatedOpenings = project.levels.reduce(
    (total, level) =>
      total + level.openings.filter((opening) => opening.exhibitorId === exhibitor.id).length,
    0,
  );
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
  const [showSplat, setShowSplat] = useState(false);
  // Las etiquetas de los objetos llegan apagadas: en la experiencia pública el
  // espacio se lee mejor limpio y el visitante las enciende si las necesita.
  const [showLabels, setShowLabels] = useState(false);
  // Botón independiente para ver solo los nombres de los expositores.
  const [showExhibitorNames, setShowExhibitorNames] = useState(false);
  // Las cotas llegan apagadas: en la visita pública no hacen falta, pero se
  // pueden encender para consultar el tamaño de los objetos de un expositor.
  const [showMeasurements, setShowMeasurements] = useState(false);
  // `null` hasta tener el proyecto: la primera orden es la vista de lectura
  // elegida en el editor, no la cámara esquema del documento.
  const [cameraCommand, setCameraCommand] = useState<ViewerCameraCommand | null>(null);

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

  /**
   * Cámara de entrada: la vista de lectura activa del editor. Es la que se
   * muestra al abrir el enlace, vuelve con «Inicio» y sirve de origen al
   * primer viaje entre expositores.
   */
  const readerView = useMemo(() => {
    if (!publicProject) return null;
    return (
      publicProject.readerViews.find(
        (entry) => entry.id === publicProject.activeReaderViewId,
      ) ?? null
    );
  }, [publicProject]);

  const readerCamera = useMemo(() => {
    if (readerView) {
      return { position: readerView.position, target: readerView.target, fov: readerView.fov };
    }
    return { position: project?.camera.position, target: project?.camera.target, fov: project?.camera.fov };
  }, [readerView, project]);

  useEffect(() => {
    if (!readerCamera.position || !readerCamera.target) return;
    setCameraCommand((current) =>
      current ?? {
        mode: 'focus',
        nonce: 0,
        position: readerCamera.position,
        target: readerCamera.target,
        fov: readerCamera.fov,
      },
    );
  }, [readerCamera]);

  const selectedExhibitor = useMemo(
    () => visibleExhibitors.find((exhibitor) => exhibitor.id === selectedId) ?? null,
    [visibleExhibitors, selectedId],
  );

  const selectExhibitor = useCallback((exhibitor: Exhibitor) => {
    if (!publicProject) return;
    setSelectedId(exhibitor.id);
    // Si la vista de lectura actual es casi la misma que la de llegada, el
    // viaje no se notaría: se eleva un poco: el descenso hace visible que el
    // visor se ha colocado en el expositor.
    let camera = focusCameraFor(exhibitor, publicProject);
    if (
      readerCamera.position &&
      readerCamera.target &&
      Math.hypot(
        readerCamera.position[0] - camera.position[0],
        readerCamera.position[2] - camera.position[2],
      ) < 3
    ) {
      const dir = { x: Math.sin(exhibitor.rotation), z: Math.cos(exhibitor.rotation) };
      camera = {
        position: [
          camera.position[0] - dir.x * 0.6,
          camera.position[1] + 6,
          camera.position[2] - dir.z * 0.6,
        ],
        target: camera.target,
      };
    }
    // Ruta profesional entre stands: la cámara no corta en línea recta de uno
    // a otro, sino que repasa el recorrido con paradas de giro.
    //   1. levanta hacia un punto de rotación del nivel de origen (el más
    //      cercano al trayecto) y lo mira desde su propia cámara;
    //   2. baja al punto más cercano a la llegada en la planta del expositor,
    //      mirando el nivel de llegada;
    //   3. finalmente enfoca al expositor.
    // Si los dos puntos son el mismo (mismo nivel, misma zona) basta con una
    // parada. Sin puntos, el viaje es directo como antes.
    const fromPosition = selectedExhibitor?.position ?? {
      x: readerCamera.position?.[0] ?? 0,
      z: readerCamera.position?.[2] ?? 0,
    };
    const waypoints = buildTravelWaypoints(
      publicProject,
      fromPosition,
      selectedExhibitor,
      exhibitor,
      publicProject.readerViews ?? [],
      publicProject.activeReaderViewId,
    );
    setCameraCommand((current) => ({
      mode: 'focus',
      nonce: (current?.nonce ?? 0) + 1,
      position: camera.position,
      target: camera.target,
      via: waypoints,
    }));
  }, [publicProject, selectedExhibitor, readerCamera]);

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
    // «Inicio» vuelve a la vista de lectura publicada, no a una cámara genérica.
    if (readerCamera.position && readerCamera.target) {
      setCameraCommand((current) => ({
        mode: 'focus',
        nonce: (current?.nonce ?? 0) + 1,
        position: readerCamera.position,
        target: readerCamera.target,
        fov: readerCamera.fov,
      }));
      return;
    }
    setCameraCommand((current) => ({ mode: 'reset', nonce: (current?.nonce ?? 0) + 1 }));
  };

  const topCamera = () => {
    setCameraCommand((current) => ({ mode: 'top', nonce: (current?.nonce ?? 0) + 1 }));
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
          {/* Solo el nombre: el recuento de expositores ya está en el panel
              lateral y el evento lo cuenta cada ficha. */}
          <div className="viewer-header-info">
            <h1>{project.name}</h1>
          </div>
        </div>
        <div className="viewer-header-actions">
          <span className="viewer-credit">dev by wilzamguerrero</span>
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
            showSplat={showSplat}
            showObjectLabels={showLabels}
            showExhibitorNames={showExhibitorNames}
            showMeasurements={showMeasurements}
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
            <button
              type="button"
              className={showLabels ? 'is-active' : ''}
              onClick={() => setShowLabels((value) => !value)}
              title={showLabels ? 'Ocultar las etiquetas' : 'Mostrar las etiquetas de los objetos'}
              aria-pressed={showLabels}
            >
              <Tags size={14} />
              Etiquetas
            </button>
            <button
              type="button"
              className={showExhibitorNames ? 'is-active' : ''}
              onClick={() => setShowExhibitorNames((value) => !value)}
              title={
                showExhibitorNames
                  ? 'Ocultar los nombres de los expositores'
                  : 'Ver solo los nombres de los expositores'
              }
              aria-pressed={showExhibitorNames}
            >
              <Users size={14} />
              Nombres
            </button>
            <button
              type="button"
              className={showMeasurements ? 'is-active' : ''}
              onClick={() => setShowMeasurements((value) => !value)}
              title={
                showMeasurements
                  ? 'Ocultar las cotas de los objetos'
                  : 'Ver las cotas de los objetos del expositor seleccionado'
              }
              aria-pressed={showMeasurements}
            >
              <Ruler size={14} />
              Medidas
            </button>
            {publicProject.environment.url || publicProject.environment.blockId ? (
              <button
                type="button"
                className={showSplat ? 'is-active' : ''}
                onClick={() => setShowSplat((value) => !value)}
                title={showSplat ? 'Ocultar el Gaussian splat' : 'Mostrar el Gaussian splat'}
              >
                <Sparkles size={14} />
                Gaussian
              </button>
            ) : null}
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
