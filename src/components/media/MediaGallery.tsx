import { useCallback, useEffect, useMemo, useRef, useState } from 'react';
import { ChevronLeft, ChevronRight, ExternalLink, FileText, Film, Image as ImageIcon } from 'lucide-react';
import type { MediaItem } from '@/types/project';
import { Button, IconButton, Modal } from '@/components/ui';
import { formatBytes, mediaItemUrl, mediaKindLabel } from '@/services/assets/mediaService';
import {
  FALLBACK_IMAGE_RATIO,
  FALLBACK_VIDEO_RATIO,
  getRatio,
  rememberRatio,
} from './aspectRatioStore';
import { useMediaSettle } from './useProgressiveStream';

/** Icono que representa el tipo de archivo en las listas. */
export function MediaKindIcon({ kind, size = 13 }: { kind: MediaItem['kind']; size?: number }) {
  if (kind === 'image') return <ImageIcon size={size} />;
  if (kind === 'video') return <Film size={size} />;
  return <FileText size={size} />;
}

/**
 * Miniatura de un elemento multimedia.
 *
 * Reserva el hueco desde el primer frame para que la lista no salte cuando
 * llegan las imágenes, y avisa al flujo progresivo (`useMediaSettle`) cuando
 * termina, de modo que entre la siguiente sin saturar la conexión.
 */
export function MediaThumb({ item, size = 56 }: { item: MediaItem; size?: number }) {
  const url = mediaItemUrl(item);
  const [loaded, setLoaded] = useState(false);
  const imgRef = useRef<HTMLImageElement | null>(null);
  const settle = useMediaSettle(item.id, item.kind === 'image' && Boolean(url));

  const finish = useCallback(
    (img?: HTMLImageElement | null) => {
      if (img && img.naturalWidth && img.naturalHeight) {
        rememberRatio(item.id, img.naturalWidth, img.naturalHeight);
      }
      setLoaded(true);
      // Libera siempre el cupo, tanto por `onLoad` como por la comprobación de
      // caché. `settle` es idempotente, así que llamarlo dos veces no afecta.
      settle();
    },
    [item.id, settle],
  );

  // Si la imagen ya estaba en la caché del navegador, el evento `load` puede
  // haberse disparado antes de que React enganchara `onLoad`. Sin esto el cupo
  // del flujo se quedaba ocupado y la galería parecía colgada hasta recargar.
  useEffect(() => {
    const img = imgRef.current;
    if (!img) return;
    // `complete` es cierto tanto si la imagen terminó como si falló sin llegar
    // a cargar; `naturalWidth` distingue los dos casos.
    if (img.complete) {
      finish(img.naturalWidth ? img : null);
      return;
    }
    // Segunda oportunidad: la imagen puede terminar entre el commit y este
    // efecto. Si para entonces ya está completa, se libera el cupo sin esperar
    // al temporizador de reserva.
    let cancelled = false;
    const check = () => {
      if (cancelled) return;
      const el = imgRef.current;
      if (el?.complete) finish(el.naturalWidth ? el : null);
    };
    const timer = window.setTimeout(check, 160);
    return () => {
      cancelled = true;
      clearTimeout(timer);
    };
  }, [finish, url]);

  if (item.kind === 'image' && url) {
    return (
      <span className="media-thumb-frame" style={{ width: size, height: size }}>
        {!loaded ? <span className="media-thumb-skeleton" aria-hidden /> : null}
        <img
          ref={imgRef}
          className={`media-thumb${loaded ? ' is-loaded' : ''}`}
          src={url}
          alt={item.caption || item.name}
          loading="lazy"
          decoding="async"
          onLoad={(event) => finish(event.currentTarget)}
          onError={() => finish(null)}
          style={{ width: size, height: size }}
        />
      </span>
    );
  }
  return (
    <span
      className={`media-thumb media-thumb-icon is-${item.kind}`}
      style={{ width: size, height: size }}
      aria-hidden
    >
      <MediaKindIcon kind={item.kind} size={Math.round(size / 2.8)} />
    </span>
  );
}

/**
 * Visor a pantalla completa de un elemento. Muestra imágenes, vídeos con
 * controles y PDF incrustados; el resto se abre como enlace de descarga.
 */
function MediaViewer({ item }: { item: MediaItem }) {
  const url = mediaItemUrl(item);
  const [loaded, setLoaded] = useState(false);

  // Proporción conocida (de esta visita o de una anterior) para reservar el
  // hueco y que la imagen no empuje el contenido al aparecer.
  const [ratio, setRatio] = useState<number | undefined>(() => getRatio(item.id));
  const fallback = item.kind === 'video' ? FALLBACK_VIDEO_RATIO : FALLBACK_IMAGE_RATIO;
  const reservedRatio = ratio ?? fallback;

  if (!url) {
    return <div className="media-viewer-empty">Este archivo no está disponible.</div>;
  }
  if (item.kind === 'image') {
    // Fundido al terminar la descarga: evita el salto de una imagen a medio
    // pintar y deja claro que está cargando.
    return (
      <span className="media-viewer-image-frame" style={{ aspectRatio: String(reservedRatio) }}>
        {!loaded ? <span className="media-viewer-skeleton" aria-hidden /> : null}
        <img
          className={`media-viewer-image${loaded ? ' is-loaded' : ''}`}
          src={url}
          alt={item.caption || item.name}
          decoding="async"
          onLoad={(event) => {
            const img = event.currentTarget;
            const learned = rememberRatio(item.id, img.naturalWidth, img.naturalHeight);
            if (learned) setRatio(learned);
            setLoaded(true);
          }}
          onError={() => setLoaded(true)}
        />
      </span>
    );
  }
  if (item.kind === 'video') {
    // `preload="metadata"` solo trae la cabecera: el vídeo se descarga al pulsar
    // reproducir. Sin esto el navegador intenta bajar el archivo entero (los
    // vídeos de este proyecto llegan a 566 MB).
    //
    // El hueco se reserva con la proporción aprendida (16:9 por defecto) para
    // que el reproductor no cambie de altura cuando llegan los metadatos.
    return (
      <span className="media-viewer-image-frame" style={{ aspectRatio: String(reservedRatio) }}>
        {!loaded ? <span className="media-viewer-skeleton" aria-hidden /> : null}
        <video
          className={`media-viewer-video${loaded ? ' is-loaded' : ''}`}
          src={url}
          controls
          playsInline
          preload="metadata"
          onLoadedMetadata={(event) => {
            const video = event.currentTarget;
            const learned = rememberRatio(item.id, video.videoWidth, video.videoHeight);
            if (learned) setRatio(learned);
            setLoaded(true);
          }}
          onLoadedData={() => setLoaded(true)}
          onCanPlay={() => setLoaded(true)}
          onError={() => setLoaded(true)}
        >
          Tu navegador no puede reproducir este vídeo.
        </video>
      </span>
    );
  }
  if (item.kind === 'pdf') {
    return <iframe className="media-viewer-frame" src={`${url}#toolbar=1&view=FitH`} title={item.name} />;
  }
  return (
    <div className="media-viewer-empty">
      <MediaKindIcon kind={item.kind} size={30} />
      <p>{item.name || 'Archivo'} </p>
      <Button variant="secondary" onClick={() => window.open(url, '_blank', 'noopener')} icon={<ExternalLink size={14} />}>
        Abrir archivo
      </Button>
    </div>
  );
}

/**
 * Galería a pantalla completa, en modal. Navega con las flechas del teclado y
 * permite abrir el archivo original en otra pestaña.
 */
export function MediaGalleryModal({
  items,
  initialIndex = 0,
  title = 'Galería',
  onClose,
}: {
  items: MediaItem[];
  initialIndex?: number;
  title?: string;
  onClose: () => void;
}) {
  const [index, setIndex] = useState(() =>
    Math.max(0, Math.min(initialIndex, Math.max(0, items.length - 1))),
  );

  useEffect(() => {
    if (items.length < 2) return;
    const onKey = (event: KeyboardEvent) => {
      if (event.key === 'ArrowLeft') setIndex((current) => Math.max(0, current - 1));
      if (event.key === 'ArrowRight') setIndex((current) => Math.min(items.length - 1, current + 1));
    };
    document.addEventListener('keydown', onKey);
    return () => document.removeEventListener('keydown', onKey);
  }, [items.length]);

  if (!items.length) return null;
  const item = items[index];
  const url = mediaItemUrl(item);

  return (
    <Modal
      open
      onClose={onClose}
      title={item.caption || item.name || mediaKindLabel(item.kind)}
      subtitle={`${title} · ${index + 1} de ${items.length}${item.sizeBytes ? ` · ${formatBytes(item.sizeBytes)}` : ''}`}
      size="xl"
      footer={
        <>
          <span className="media-gallery-kind">{mediaKindLabel(item.kind)}</span>
          <div className="media-gallery-actions">
            {url ? (
              <Button
                variant="ghost"
                size="sm"
                icon={<ExternalLink size={14} />}
                onClick={() => window.open(url, '_blank', 'noopener')}
              >
                Abrir original
              </Button>
            ) : null}
          </div>
        </>
      }
    >
      <div className="media-gallery-body">
        {items.length > 1 ? (
          <IconButton
            className="media-gallery-nav is-prev"
            label="Anterior"
            icon={<ChevronLeft size={18} />}
            onClick={() => setIndex((current) => Math.max(0, current - 1))}
            disabled={index === 0}
          />
        ) : null}
        <div className="media-gallery-stage">
          <MediaViewer item={item} />
          {item.caption ? <p className="media-gallery-caption">{item.caption}</p> : null}
        </div>
        {items.length > 1 ? (
          <IconButton
            className="media-gallery-nav is-next"
            label="Siguiente"
            icon={<ChevronRight size={18} />}
            onClick={() => setIndex((current) => Math.min(items.length - 1, current + 1))}
            disabled={index === items.length - 1}
          />
        ) : null}
      </div>
      {items.length > 1 ? (
        <div className="media-gallery-strip">
          {items.map((entry, position) => (
            <button
              key={entry.id}
              type="button"
              className={`media-gallery-chip${position === index ? ' is-active' : ''}`}
              onClick={() => setIndex(position)}
              title={entry.caption || entry.name}
            >
              <MediaThumb item={entry} size={38} />
            </button>
          ))}
        </div>
      ) : null}
    </Modal>
  );
}
