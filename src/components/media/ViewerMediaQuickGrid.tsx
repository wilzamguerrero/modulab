import { useMemo } from 'react';
import type { MediaItem, MediaKind } from '@/types/project';
import { mediaDisplayLabel, mediaKindLabel, mediaOrdinals } from '@/services/assets/mediaService';
import { MEDIA_KIND_TILE_ICON } from './MediaGallery';

/**
 * Galería del visor de solo lectura.
 *
 * No se descarga ninguna miniatura: cada archivo es una tarjeta con el icono de
 * su tipo y, si hay más de uno de ese tipo, su número en la esquina. El nombre
 * del archivo subido no se muestra nunca; sin pie de foto la etiqueta accesible
 * es «Imagen 2», «Vídeo 1»…
 *
 * El archivo real se pide solo al pulsar la tarjeta, que abre la galería a
 * pantalla completa. Así la ficha abre al instante aunque haya decenas de fotos.
 */

export function ViewerMediaQuickGrid({
  items,
  onOpen,
}: {
  items: MediaItem[];
  onOpen: (index: number) => void;
}) {
  // Numero de cada archivo dentro de su tipo: la tercera imagen es «Imagen 3».
  const ordinals = useMemo(() => mediaOrdinals(items), [items]);

  // Cuantos archivos hay de cada tipo. Solo se pinta el numero si hay mas de uno.
  const totals = useMemo(() => {
    const counts = new Map<MediaKind, number>();
    for (const item of items) counts.set(item.kind, (counts.get(item.kind) ?? 0) + 1);
    return counts;
  }, [items]);

  if (!items.length) return null;

  return (
    <div className="viewer-media-grid">
      {items.map((item, index) => {
        const Icon = MEDIA_KIND_TILE_ICON[item.kind];
        const ordinal = ordinals.get(item.id) ?? 1;
        const showNumber = (totals.get(item.kind) ?? 0) > 1;
        const label = mediaDisplayLabel(item, ordinal);

        return (
          <button
            key={item.id}
            type="button"
            className="viewer-media-tile"
            onClick={() => onOpen(index)}
            title={`Ver ${label}`}
            aria-label={label}
          >
            <Icon size={20} />
            {showNumber ? (
              <span className="viewer-media-tile-badge" aria-hidden>
                {ordinal}
              </span>
            ) : null}
            <span className="viewer-media-tile-kind" aria-hidden>
              {mediaKindLabel(item.kind)}
            </span>
          </button>
        );
      })}
    </div>
  );
}
