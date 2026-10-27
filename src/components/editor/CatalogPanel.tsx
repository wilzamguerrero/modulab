import { useEffect, useMemo, useRef, useState } from 'react';
import {
  Box,
  Boxes,
  Loader2,
  MousePointerClick,
  RefreshCcw,
  Search,
  Upload,
} from 'lucide-react';
import type { CatalogItem, Project, Vec2 } from '@/types/project';
import { Badge, Button, IconButton, Spinner, TextInput } from '@/components/ui';
import { useEditorStore } from '@/store/editorStore';
import { useUiStore } from '@/store/uiStore';
import { loadCatalog, uploadCatalogFile } from '@/services/assets/catalogService';
import { getCatalogThumbnail } from '@/services/thumbnails/thumbnailService';
import { PRIMITIVE_CATALOG } from '@/data/defaults';
import { polygonBounds, polygonCentroid, pointInPolygon } from '@/utils/geometry';
import { formatBytes } from '@/utils/format';

function CatalogThumbnail({ item }: { item: CatalogItem }) {
  const [source, setSource] = useState<string | null>(null);
  const [error, setError] = useState(false);

  useEffect(() => {
    let active = true;
    setSource(null);
    setError(false);
    getCatalogThumbnail(item)
      .then((dataUrl) => {
        if (active) setSource(dataUrl);
      })
      .catch(() => {
        if (active) setError(true);
      });
    return () => {
      active = false;
    };
  }, [item]);

  if (source) return <img src={source} alt="" draggable={false} />;
  return (
    <div className="catalog-thumb-fallback">
      {error ? (
        <span>No se pudo previsualizar</span>
      ) : (
        <Loader2 size={18} className="spin" />
      )}
    </div>
  );
}

function fallbackPrimitives(): CatalogItem[] {
  return PRIMITIVE_CATALOG.map((item) => ({
    id: `primitive:${item.shape}`,
    name: item.name,
    category: 'Formas básicas',
    kind: 'primitive',
    shape: item.shape,
  }));
}

export function CatalogPanel({ project }: { project: Project }) {
  const toast = useUiStore((state) => state.toast);
  const setPendingCatalogItem = useEditorStore((state) => state.setPendingCatalogItem);
  const pendingCatalogItem = useEditorStore((state) => state.pendingCatalogItem);
  const addObject = useEditorStore((state) => state.addObject);
  const [items, setItems] = useState<CatalogItem[]>([]);
  const [directory, setDirectory] = useState('catalog');
  const [loading, setLoading] = useState(true);
  const [error, setError] = useState<string | null>(null);
  const [category, setCategory] = useState('Todos');
  const [query, setQuery] = useState('');
  const [uploading, setUploading] = useState(false);
  const [dragOver, setDragOver] = useState(false);
  const inputRef = useRef<HTMLInputElement>(null);

  const refresh = async (quiet = false) => {
    if (!quiet) setLoading(true);
    setError(null);
    try {
      const catalog = await loadCatalog();
      setItems(catalog.items);
      setDirectory(catalog.directory);
    } catch (loadError) {
      setItems(fallbackPrimitives());
      setError(
        `No se pudo leer el catálogo del servidor (${(loadError as Error).message}). Se muestran solo las formas básicas.`,
      );
    } finally {
      setLoading(false);
    }
  };

  useEffect(() => {
    refresh();
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, []);

  const categories = useMemo(() => {
    const values = new Set(items.map((item) => item.category));
    return ['Todos', ...Array.from(values).sort((a, b) => a.localeCompare(b, 'es'))];
  }, [items]);

  const filtered = useMemo(() => {
    const normalized = query.trim().toLowerCase();
    return items.filter((item) => {
      if (category !== 'Todos' && item.category !== category) return false;
      if (normalized && !item.name.toLowerCase().includes(normalized)) return false;
      return true;
    });
  }, [items, category, query]);

  const glbCount = items.filter((item) => item.kind === 'glb').length;

  const placeAtCenter = (item: CatalogItem) => {
    let position: Vec2 = { x: 0, z: 0 };
    if (project.floor.vertices.length >= 3) {
      const center = polygonCentroid(project.floor.vertices);
      position = pointInPolygon(center, project.floor.vertices)
        ? center
        : polygonBounds(project.floor.vertices).center;
    }
    const id = addObject(item, position);
    if (id) toast(`«${item.name}» colocado en el centro de la planta.`, 'success');
  };

  const selectForPlacement = (item: CatalogItem) => {
    setPendingCatalogItem(item);
    toast(`Haz clic en la planta o en el piso 3D para colocar «${item.name}».`, 'info');
  };

  const upload = async (file: File | undefined) => {
    if (!file) return;
    if (!/\.(glb|gltf)$/i.test(file.name)) {
      toast('Solo se aceptan archivos .glb o .gltf.', 'warning');
      return;
    }
    setUploading(true);
    try {
      await uploadCatalogFile(file);
      await refresh(true);
      toast(`«${file.name}» añadido al catálogo.`, 'success');
    } catch (uploadError) {
      toast(`No se pudo subir el modelo: ${(uploadError as Error).message}`, 'error');
    } finally {
      setUploading(false);
      if (inputRef.current) inputRef.current.value = '';
    }
  };

  return (
    <div>
      <section className="panel-section">
        <div className="panel-title">
          <span><Boxes size={12} /> Catálogo dinámico</span>
          <Badge tone="accent">{glbCount} GLB</Badge>
        </div>
        <div className="catalog-toolbar">
          <div style={{ position: 'relative', flex: 1 }}>
            <Search size={13} style={{ position: 'absolute', left: 9, top: 11, color: 'var(--muted-2)' }} />
            <TextInput
              placeholder="Buscar modelo…"
              value={query}
              onChange={(event) => setQuery(event.target.value)}
              style={{ paddingLeft: 28 }}
            />
          </div>
          <IconButton label="Recargar catálogo" onClick={() => refresh()} icon={<RefreshCcw size={15} />} />
        </div>
        <div className="catalog-filters">
          {categories.map((entry) => (
            <button
              key={entry}
              type="button"
              className={`chip${entry === category ? ' is-active' : ''}`}
              onClick={() => setCategory(entry)}
            >
              {entry}
            </button>
          ))}
        </div>
        <p className="panel-note">
          Carpeta <span className="code">public/catalog</span>. Cada archivo GLB aparece aquí
          automáticamente y usa su nombre de archivo como nombre visible.
        </p>
      </section>

      <section className="panel-section">
        <div
          className={`drop-zone${dragOver ? ' is-over' : ''}`}
          onDragOver={(event) => {
            if (event.dataTransfer.types.includes('Files')) {
              event.preventDefault();
              setDragOver(true);
            }
          }}
          onDragLeave={() => setDragOver(false)}
          onDrop={(event) => {
            event.preventDefault();
            setDragOver(false);
            upload(event.dataTransfer.files[0]);
          }}
        >
          <Upload size={16} style={{ marginBottom: 4 }} />
          <div>Arrastra un .glb aquí o usa el botón.</div>
          <Button
            size="sm"
            variant="secondary"
            onClick={() => inputRef.current?.click()}
            loading={uploading}
            icon={<Upload size={13} />}
            style={{ marginTop: 8 }}
          >
            Subir GLB
          </Button>
          <input
            ref={inputRef}
            type="file"
            accept=".glb,.gltf,model/gltf-binary,model/gltf+json"
            hidden
            onChange={(event) => upload(event.target.files?.[0])}
          />
        </div>
        {error ? <div className="settings-status is-error">{error}</div> : null}
      </section>

      <section className="panel-section">
        {loading ? (
          <div style={{ padding: 18 }}><Spinner label="Leyendo catálogo…" /></div>
        ) : filtered.length === 0 ? (
          <div className="empty-state" style={{ padding: '20px 12px' }}>
            <Box size={18} />
            <h3>Sin modelos</h3>
            <p>
              {glbCount === 0
                ? 'Añade archivos GLB a public/catalog o súbelos desde este panel.'
                : 'No hay modelos que coincidan con el filtro.'}
            </p>
          </div>
        ) : (
          <div className="catalog-grid">
            {filtered.map((item) => (
              <article
                key={item.id}
                className={`catalog-card${pendingCatalogItem?.id === item.id ? ' is-pending' : ''}`}
                draggable
                onDragStart={(event) => {
                  event.dataTransfer.setData('application/x-modulab-catalog', JSON.stringify(item));
                  event.dataTransfer.effectAllowed = 'copy';
                }}
                onDoubleClick={() => placeAtCenter(item)}
                title={`${item.name} · ${item.category}${item.sizeBytes ? ` · ${formatBytes(item.sizeBytes)}` : ''}`}
              >
                <div className="catalog-thumb">
                  <CatalogThumbnail item={item} />
                  <div className="catalog-card-actions">
                    <button
                      type="button"
                      title="Colocar en la planta"
                      onClick={(event) => {
                        event.stopPropagation();
                        selectForPlacement(item);
                      }}
                    >
                      <MousePointerClick size={13} />
                    </button>
                  </div>
                </div>
                <div className="catalog-meta">
                  <span className="catalog-name">{item.name}</span>
                  <span className="catalog-category">
                    {item.kind === 'primitive' ? 'Forma básica' : item.category}
                  </span>
                </div>
              </article>
            ))}
          </div>
        )}
      </section>

      <section className="panel-section">
        <div className="panel-title"><span>Cómo añadir modelos</span></div>
        <ol className="settings-steps">
          <li>Copia tus archivos <span className="code">.glb</span> dentro de <span className="code">public/catalog</span>.</li>
          <li>Puedes usar subcarpetas: cada carpeta se convierte en una categoría.</li>
          <li>Pulsa recargar. El nombre visible es el nombre del archivo, sin extensión.</li>
          <li>Arrastra la tarjeta a la escena 3D o haz clic en el icono para colocarla.</li>
        </ol>
        <p className="panel-note">Carpeta activa: <span className="code">{directory}</span></p>
      </section>
    </div>
  );
}
