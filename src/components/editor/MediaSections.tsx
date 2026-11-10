import { useEffect, useRef, useState } from 'react';
import { ImagePlus, Loader2, Maximize2, Trash2, Upload } from 'lucide-react';
import type { MediaItem, MediaKind, Project, SceneObject } from '@/types/project';
import { Badge, Button, Field, IconButton, TextInput } from '@/components/ui';
import { useUiStore } from '@/store/uiStore';
import { useEditorStore } from '@/store/editorStore';
import {
  deleteMediaItem,
  formatBytes,
  mediaItemUrl,
  mediaKindForFile,
  mediaKindLabel,
  uploadMediaFile,
} from '@/services/assets/mediaService';
import { MediaGalleryModal, MediaKindIcon, MediaThumb } from '@/components/media/MediaGallery';
import {
  MediaLoadContext,
  useProgressiveStream,
} from '@/components/media/useProgressiveStream';

const MEDIA_ACCEPT = 'image/*,video/*,application/pdf,.pdf,.glb,.gltf,.zip,.doc,.docx,.ppt,.pptx,.xls,.xlsx,.txt,application/octet-stream';

/** Página de Notion donde se adjuntan los archivos de un expositor. */
export function mediaParentBlockId(project: Project, exhibitorBlockId?: string): string {
  return project.notionBlockId || exhibitorBlockId || '';
}

interface MediaSectionProps {
  items: MediaItem[];
  parentBlockId?: string;
  onChange: (next: MediaItem[]) => void;
  /** Texto del botón principal. */
  addLabel?: string;
  emptyHint?: string;
  /** Título de la galería a pantalla completa. */
  galleryTitle?: string;
}

/**
 * Gestor de galería: permite subir varios archivos (imágenes, vídeos y PDF),
 * verlos a pantalla completa, editar el pie y eliminarlos. Los binarios van a
 * Notion y aquí sólo quedan los metadatos que se guardan en el proyecto.
 */
export function MediaManager({
  items,
  parentBlockId,
  onChange,
  addLabel = 'Añadir archivos',
  emptyHint = 'Sube imágenes, vídeos o PDF para completar la ficha.',
  galleryTitle = 'Galería',
}: MediaSectionProps) {
  const toast = useUiStore((state) => state.toast);
  const inputRef = useRef<HTMLInputElement>(null);
  const [uploading, setUploading] = useState(false);
  const [progress, setProgress] = useState<{ name: string; value: number; index: number; total: number } | null>(null);
  const [gallery, setGallery] = useState<{ index: number } | null>(null);
  // Arrastrar y soltar: `dragDepth` evita que el resaltado parpadee cuando el
  // puntero cruza los hijos del contenedor (dragenter/dragleave se disparan
  // en cada uno).
  const [dragDepth, setDragDepth] = useState(0);
  const isDragging = dragDepth > 0;

  const handleFiles = async (files: FileList | null) => {
    if (!files?.length) return;
    const selected = Array.from(files);
    setUploading(true);
    let added = items.slice();
    try {
      for (let i = 0; i < selected.length; i++) {
        const file = selected[i];
        setProgress({ name: file.name, value: 0, index: i + 1, total: selected.length });
        try {
          const item = await uploadMediaFile(file, {
            parentBlockId: parentBlockId ?? '',
            onProgress: (value) =>
              setProgress({ name: file.name, value, index: i + 1, total: selected.length }),
          });
          added = [...added, item];
          onChange(added);
        } catch (error) {
          toast(`No se pudo subir «${file.name}»: ${(error as Error).message}`, 'error');
        }
      }
      if (added.length > items.length) {
        toast(
          added.length - items.length === 1
            ? 'Archivo añadido a la galería.'
            : `${added.length - items.length} archivos añadidos a la galería.`,
          'success',
        );
      }
    } finally {
      setProgress(null);
      setUploading(false);
      if (inputRef.current) inputRef.current.value = '';
    }
  };

  /** Comprueba si el arrastre trae archivos (y no texto o una fila interna). */
  const hasFiles = (event: React.DragEvent) => {
    const types = event.dataTransfer?.types;
    return Boolean(types && Array.from(types).includes('Files'));
  };

  const onDragEnter = (event: React.DragEvent) => {
    if (!hasFiles(event)) return;
    event.preventDefault();
    setDragDepth((depth) => depth + 1);
  };

  const onDragOver = (event: React.DragEvent) => {
    if (!hasFiles(event)) return;
    // Sin preventDefault el navegador abre el archivo en lugar de soltarlo.
    event.preventDefault();
    if (event.dataTransfer) event.dataTransfer.dropEffect = 'copy';
  };

  const onDragLeave = (event: React.DragEvent) => {
    if (!hasFiles(event)) return;
    setDragDepth((depth) => Math.max(0, depth - 1));
  };

  const onDrop = (event: React.DragEvent) => {
    if (!hasFiles(event)) return;
    event.preventDefault();
    setDragDepth(0);
    if (uploading) return;
    void handleFiles(event.dataTransfer.files);
  };

  // Si el arrastre acaba fuera de la ventana no llega ningún `dragleave` al
  // panel y el resaltado se quedaría pegado. Se reinicia al soltar en
  // cualquier sitio o al salir de la ventana.
  useEffect(() => {
    if (dragDepth === 0) return;
    const reset = () => setDragDepth(0);
    window.addEventListener('drop', reset);
    window.addEventListener('dragend', reset);
    document.addEventListener('mouseleave', reset);
    return () => {
      window.removeEventListener('drop', reset);
      window.removeEventListener('dragend', reset);
      document.removeEventListener('mouseleave', reset);
    };
  }, [dragDepth]);

  const remove = async (item: MediaItem) => {
    onChange(items.filter((entry) => entry.id !== item.id));
    await deleteMediaItem(item);
  };

  const patch = (id: string, changes: Partial<MediaItem>) => {
    onChange(items.map((entry) => (entry.id === id ? { ...entry, ...changes } : entry)));
  };

  // Flujo progresivo: las miniaturas entran poco a poco, con un cupo de
  // descargas simultáneas. Se reinicia al cambiar de galería.
  const stream = useProgressiveStream({
    total: items.length,
    resetKey: parentBlockId || 'galeria',
  });

  const move = (id: string, direction: -1 | 1) => {
    const index = items.findIndex((entry) => entry.id === id);
    const target = index + direction;
    if (index < 0 || target < 0 || target >= items.length) return;
    const next = items.slice();
    const [entry] = next.splice(index, 1);
    next.splice(target, 0, entry);
    onChange(next);
  };

  return (
    <div
      className={`media-manager${isDragging ? ' is-dragging' : ''}`}
      onDragEnter={onDragEnter}
      onDragOver={onDragOver}
      onDragLeave={onDragLeave}
      onDrop={onDrop}
    >
      {items.length ? (
        <MediaLoadContext.Provider value={stream.loadApi}>
        <div className="media-list">
          {/* Solo se pintan las tarjetas admitidas por el flujo: las imágenes
              entran en cascada regulada en vez de pedirse todas de golpe. */}
          {items.slice(0, stream.visibleCount).map((item, index) => (
            <div key={item.id} className="media-row">
              <button
                type="button"
                className="media-row-thumb"
                onClick={() => setGallery({ index })}
                title={`Ver «${item.caption || item.name}» a pantalla completa`}
              >
                <MediaThumb item={item} size={52} />
                {item.kind === 'image' ? <Maximize2 size={12} className="media-row-zoom" /> : null}
              </button>
              <div className="media-row-body">
                <div className="media-row-title">
                  <span className="media-row-name" title={item.name}>
                    {item.name || mediaKindLabel(item.kind)}
                  </span>
                  <Badge tone="neutral">{mediaKindLabel(item.kind)}</Badge>
                  {item.sizeBytes ? <span className="media-row-size">{formatBytes(item.sizeBytes)}</span> : null}
                </div>
                <TextInput
                  className="media-row-caption"
                  value={item.caption}
                  placeholder="Pie de foto (opcional)"
                  onChange={(event) => patch(item.id, { caption: event.target.value })}
                />
                {mediaItemUrl(item) ? (
                  <div className="media-row-links">
                    <a href={mediaItemUrl(item)} target="_blank" rel="noreferrer">
                      Abrir original
                    </a>
                    {item.kind !== 'image' ? (
                      <button type="button" onClick={() => setGallery({ index })}>
                        Ver en el visor
                      </button>
                    ) : null}
                    <button
                      type="button"
                      disabled={index === 0}
                      onClick={() => move(item.id, -1)}
                      aria-label="Subir en la galería"
                    >
                      ↑ subir
                    </button>
                    <button
                      type="button"
                      disabled={index === items.length - 1}
                      onClick={() => move(item.id, 1)}
                      aria-label="Bajar en la galería"
                    >
                      ↓ bajar
                    </button>
                  </div>
                ) : (
                  <div className="media-row-links">
                    <span className="media-row-warning">Archivo no disponible</span>
                  </div>
                )}
              </div>
              <IconButton
                label="Eliminar archivo"
                icon={<Trash2 size={13} />}
                onClick={() => remove(item)}
              />
            </div>
          ))}
          {/* Al asomarse este centinela, el flujo acelera para que el usuario
              nunca se encuentre con huecos al desplazarse. */}
          {!stream.isComplete ? <div ref={stream.sentinelRef} className="media-stream-sentinel" /> : null}
        </div>
        </MediaLoadContext.Provider>
      ) : (
        <div className="media-empty" role="button" tabIndex={0}
          onClick={() => inputRef.current?.click()}
          onKeyDown={(event) => {
            if (event.key === 'Enter' || event.key === ' ') {
              event.preventDefault();
              inputRef.current?.click();
            }
          }}
          title="Arrastra aquí tus archivos o haz clic para seleccionarlos"
        >
          <MediaKindIcon kind="image" size={22} />
          <p>{emptyHint}</p>
          <span className="media-empty-drop">
            {isDragging ? 'Suelta los archivos aquí' : 'o arrástralos y suéltalos aquí'}
          </span>
        </div>
      )}

      {isDragging ? (
        <div className="media-drop-overlay" aria-live="polite">
          <Upload size={20} />
          <span>Suelta los archivos para añadirlos a la galería</span>
        </div>
      ) : null}

      <div className="media-actions">
        <Button
          size="sm"
          variant="secondary"
          icon={<Upload size={13} />}
          onClick={() => inputRef.current?.click()}
          disabled={uploading}
        >
          {addLabel}
        </Button>
        {progress ? (
          <span className="media-progress">
            <Loader2 size={12} className="spin" />
            {progress.index}/{progress.total} · {progress.name} · {Math.round(progress.value * 100)} %
          </span>
        ) : null}
      </div>
      {parentBlockId ? null : (
        <p className="media-warning">
          Este proyecto todavía no está guardado en Notion. Los archivos se adjuntarán a la página
          padre; guarda el proyecto en Notion para que queden vinculados a él.
        </p>
      )}
      <input
        ref={inputRef}
        type="file"
        accept={MEDIA_ACCEPT}
        multiple
        hidden
        onChange={(event) => handleFiles(event.target.files)}
      />

      {gallery ? (
        <MediaGalleryModal
          items={items}
          initialIndex={gallery.index}
          title={galleryTitle}
          onClose={() => setGallery(null)}
        />
      ) : null}
    </div>
  );
}

/**
 * Impreso de una araña metálica. Es una sola imagen la que cuelga del soporte;
 * el archivo se adjunta a Notion con el mismo sistema que la galería y la foto
 * del expositor, así que se puede cambiar o quitar al reabrir el proyecto.
 */
export function ObjectBannerField({ project, object }: { project: Project; object: SceneObject }) {
  const toast = useUiStore((state) => state.toast);
  const updateObject = useEditorStore((state) => state.updateObject);
  const inputRef = useRef<HTMLInputElement>(null);
  const [uploading, setUploading] = useState(false);
  const [progress, setProgress] = useState(0);
  const [gallery, setGallery] = useState(false);
  const value = object.banner;
  const url = mediaItemUrl(value);

  const handleFile = async (file: File | undefined) => {
    if (!file) return;
    if (mediaKindForFile(file) !== 'image') {
      toast('El impreso debe ser una imagen (JPG, PNG, WEBP…).', 'warning');
      if (inputRef.current) inputRef.current.value = '';
      return;
    }
    setUploading(true);
    setProgress(0);
    try {
      const next = await uploadMediaFile(file, {
        parentBlockId: project.notionBlockId ?? '',
        kind: 'image' as MediaKind,
        onProgress: setProgress,
      });
      const previous = value;
      updateObject(object.id, { banner: next });
      // El archivo anterior deja de usarse: se archiva en Notion para no
      // acumular adjuntos huérfanos en la página del proyecto.
      if (previous) await deleteMediaItem(previous);
      toast('Impreso actualizado.', 'success');
    } catch (error) {
      toast(`No se pudo subir el impreso: ${(error as Error).message}`, 'error');
    } finally {
      setUploading(false);
      if (inputRef.current) inputRef.current.value = '';
    }
  };

  const remove = async () => {
    updateObject(object.id, { banner: undefined });
    if (value) await deleteMediaItem(value);
    toast('Impreso eliminado.', 'success');
  };

  return (
    <Field label="Imagen que cuelga del soporte">
      <div className="event-image-field">
        <button
          type="button"
          className="event-image-preview is-banner"
          onClick={() => (url ? setGallery(true) : inputRef.current?.click())}
          title={url ? 'Ver a pantalla completa' : 'Subir la imagen del impreso'}
        >
          {url ? (
            <img src={url} alt={value?.name || 'Impreso'} />
          ) : (
            <span className="event-image-empty">
              <ImagePlus size={20} />
              <span>60 × 160</span>
            </span>
          )}
          {uploading ? (
            <span className="event-image-overlay">
              <Loader2 size={18} className="spin" />
              {Math.round(progress * 100)} %
            </span>
          ) : null}
        </button>
        <div className="event-image-side">
          <p className="event-image-hint">
            El paño mantiene el alto real de 160 cm y el ancho se ajusta a la proporción de tu
            imagen (vertical, cuadrada o apaisada) sin deformarla.
          </p>
          <div className="event-image-actions">
            <Button
              size="sm"
              variant="secondary"
              icon={<Upload size={13} />}
              onClick={() => inputRef.current?.click()}
              loading={uploading}
            >
              {value ? 'Reemplazar' : 'Subir imagen'}
            </Button>
            {value ? (
              <Button size="sm" variant="ghost" icon={<Trash2 size={13} />} onClick={remove}>
                Quitar
              </Button>
            ) : null}
          </div>
        </div>
      </div>
      <input
        ref={inputRef}
        type="file"
        accept="image/*"
        hidden
        onChange={(event) => handleFile(event.target.files?.[0])}
      />
      {gallery && value ? (
        <MediaGalleryModal items={[value]} title="Impreso" onClose={() => setGallery(false)} />
      ) : null}
    </Field>
  );
}

/**
 * Imagen cuadrada del evento. Un único archivo 1:1 que se muestra junto al
 * logo de Modulab en el visor público.
 */
export function EventImageField({
  project,
  value,
  onChange,
}: {
  project: Project;
  value: MediaItem | undefined;
  onChange: (next: MediaItem | undefined) => void;
}) {
  const toast = useUiStore((state) => state.toast);
  const inputRef = useRef<HTMLInputElement>(null);
  const [uploading, setUploading] = useState(false);
  const [progress, setProgress] = useState(0);
  const [gallery, setGallery] = useState(false);
  const url = mediaItemUrl(value);

  const handleFile = async (file: File | undefined) => {
    if (!file) return;
    if (mediaKindForFile(file) !== 'image') {
      toast('La imagen del evento debe ser una imagen (se recomienda 1:1).', 'warning');
      if (inputRef.current) inputRef.current.value = '';
      return;
    }
    setUploading(true);
    setProgress(0);
    try {
      const next = await uploadMediaFile(file, {
        parentBlockId: project.notionBlockId ?? '',
        kind: 'image' as MediaKind,
        onProgress: setProgress,
      });
      const previous = value;
      onChange(next);
      if (previous) await deleteMediaItem(previous);
      toast('Imagen del evento actualizada.', 'success');
    } catch (error) {
      toast(`No se pudo subir la imagen: ${(error as Error).message}`, 'error');
    } finally {
      setUploading(false);
      if (inputRef.current) inputRef.current.value = '';
    }
  };

  const remove = async () => {
    onChange(undefined);
    if (value) await deleteMediaItem(value);
    toast('Imagen del evento eliminada.', 'success');
  };

  return (
    <Field label="Imagen del evento (cuadrada)">
      <div className="event-image-field">
        <button
          type="button"
          className="event-image-preview"
          onClick={() => (url ? setGallery(true) : inputRef.current?.click())}
          title={url ? 'Ver a pantalla completa' : 'Subir imagen 1:1'}
        >
          {url ? (
            <img src={url} alt="Imagen del evento" />
          ) : (
            <span className="event-image-empty">
              <ImagePlus size={20} />
              <span>1:1</span>
            </span>
          )}
          {uploading ? (
            <span className="event-image-overlay">
              <Loader2 size={18} className="spin" />
              {Math.round(progress * 100)} %
            </span>
          ) : null}
        </button>
        <div className="event-image-side">
          <p className="event-image-hint">
            Se muestra junto al logo de Modulab en la vista de lectura. Usa una imagen cuadrada
            (p. ej. 1080 × 1080).
          </p>
          <div className="event-image-actions">
            <Button
              size="sm"
              variant="secondary"
              icon={<Upload size={13} />}
              onClick={() => inputRef.current?.click()}
              loading={uploading}
            >
              {value ? 'Reemplazar' : 'Subir'}
            </Button>
            {value ? (
              <Button size="sm" variant="ghost" icon={<Trash2 size={13} />} onClick={remove}>
                Quitar
              </Button>
            ) : null}
          </div>
        </div>
      </div>
      <input
        ref={inputRef}
        type="file"
        accept="image/*"
        hidden
        onChange={(event) => handleFile(event.target.files?.[0])}
      />
      {gallery && value ? (
        <MediaGalleryModal items={[value]} title="Imagen del evento" onClose={() => setGallery(false)} />
      ) : null}
    </Field>
  );
}
