import { useMemo, useState } from 'react';
import { Layers, Scissors, Trash2 } from 'lucide-react';
import type { Project } from '@/types/project';
import { Badge, ConfirmDialog, Field, HelpButton, IconButton, NumberInput } from '@/components/ui';
import { useEditorStore } from '@/store/editorStore';
import { useUiStore } from '@/store/uiStore';
import { collectHoles, type HoleEntry } from '@/utils/holes';
import { formatArea, formatMeters } from '@/utils/geometry';

/**
 * Lista de cortes de suelo (huecos para escaleras y vacíos) de todos los
 * niveles. Antes solo se podían seleccionar pulsando el relleno del hueco en la
 * vista de planta, lo que era incómodo cuando el corte quedaba fino o pegado al
 * borde; aquí se eligen como cualquier otro elemento del proyecto.
 */
export function HolesPanel({ project }: { project: Project }) {
  const toast = useUiStore((state) => state.toast);
  const selection = useEditorStore((state) => state.selection);
  const setSelection = useEditorStore((state) => state.setSelection);
  const setActiveLevel = useEditorStore((state) => state.setActiveLevel);
  const setActiveSpace = useEditorStore((state) => state.setActiveSpace);
  const setView = useEditorStore((state) => state.setView);
  const renameHole = useEditorStore((state) => state.renameHole);
  const deleteHole = useEditorStore((state) => state.deleteHole);

  const [confirmId, setConfirmId] = useState<string | null>(null);

  const entries = useMemo(() => collectHoles(project), [project]);
  const selectedId = selection?.type === 'hole' ? selection.id : null;
  const selected = entries.find((entry) => entry.hole.id === selectedId) ?? null;

  const focus = (entry: HoleEntry) => {
    setActiveLevel(entry.level.id);
    setActiveSpace(entry.space.id);
    setView('plan');
    setSelection({ type: 'hole', id: entry.hole.id, spaceId: entry.space.id });
  };

  const groups = useMemo(() => {
    const byLevel = new Map<string, { levelName: string; elevation: number; items: HoleEntry[] }>();
    for (const entry of entries) {
      const group = byLevel.get(entry.level.id) ?? {
        levelName: entry.level.name,
        elevation: entry.level.elevation,
        items: [],
      };
      group.items.push(entry);
      byLevel.set(entry.level.id, group);
    }
    return [...byLevel.values()];
  }, [entries]);

  return (
    <div>
      <section className="panel-section">
        <div className="panel-title">
          <span><Scissors size={12} /> Cortes de suelo</span>
          <span className="panel-title-actions">
            <HelpButton title="Cortes de suelo">
              <p>
                Un corte es un hueco en el forjado: sirve para el paso de una escalera o para
                dejar un vacío entre plantas.
              </p>
              <p>
                Se crean con la herramienta <strong>Recorte</strong> de la pestaña Planta,
                arrastrando un rectángulo sobre el piso donde irá la escalera. El corte cae
                automáticamente en el piso superior, que es el que hay que abrir.
              </p>
              <p>
                Aquí puedes seleccionarlos, renombrarlos, ajustar su tamaño y su posición sin
                tener que acertar en el dibujo.
              </p>
            </HelpButton>
            <Badge tone="neutral">{entries.length}</Badge>
          </span>
        </div>
        <p className="panel-note">
          {entries.length === 0
            ? 'Aún no hay cortes. Usa Recorte en la pestaña Planta y arrastra sobre el piso.'
            : 'Selecciona un corte de la lista para editarlo; te lleva al nivel y al espacio donde está.'}
        </p>
      </section>

      {groups.map((group) => (
        <section className="panel-section" key={group.levelName}>
          <div className="panel-title">
            <span><Layers size={12} /> {group.levelName}</span>
            <small>{group.elevation.toFixed(2)} m</small>
          </div>
          <div className="segment-list">
            {group.items.map((entry) => {
              const isActive = entry.hole.id === selectedId;
              return (
                <div className="segment-row is-stacked" key={entry.hole.id}>
                  <button
                    type="button"
                    className={`segment-name${isActive ? ' is-wall' : ''}`}
                    onClick={() => focus(entry)}
                    title="Seleccionar corte"
                  >
                    <span className="segment-label">{entry.hole.name || 'Hueco'}</span>
                    <strong>{formatArea(entry.area)}</strong>
                  </button>
                  <div className="segment-meta">
                    <span className="chip">{formatMeters(entry.width, 2)}</span>
                    <span className="chip">{formatMeters(entry.depth, 2)}</span>
                    <span className="segment-meta-actions">
                      <IconButton
                        label="Eliminar corte"
                        size="sm"
                        icon={<Trash2 size={12} />}
                        onClick={() => setConfirmId(entry.hole.id)}
                      />
                    </span>
                  </div>
                </div>
              );
            })}
          </div>
        </section>
      ))}

      {selected ? (
        <section className="panel-section">
          <div className="panel-title">
            <span><Scissors size={12} /> {selected.hole.name || 'Corte'}</span>
            <small>{selected.space.name}</small>
          </div>
          <Field label="Nombre">
            <input
              className="input"
              value={selected.hole.name}
              onChange={(event) => renameHole(selected.hole.id, event.target.value)}
            />
          </Field>
          <div className="prop-list">
            <div className="prop-row">
              <span>Nivel</span><strong>{selected.level.name}</strong>
            </div>
            <div className="prop-row">
              <span>Espacio</span><strong>{selected.space.name}</strong>
            </div>
            <div className="prop-row">
              <span>Centro</span>
              <strong>
                {selected.center.x.toFixed(2)} / {selected.center.z.toFixed(2)} m
              </strong>
            </div>
          </div>
          <HoleShapeFields entry={selected} />
        </section>
      ) : null}

      <ConfirmDialog
        open={Boolean(confirmId)}
        title="Eliminar corte"
        message="El piso volverá a quedar cerrado en esa zona. Esta acción se puede deshacer."
        confirmLabel="Eliminar corte"
        danger
        onConfirm={() => {
          if (confirmId) {
            deleteHole(confirmId);
            toast('Corte eliminado.', 'success');
          }
          setConfirmId(null);
        }}
        onCancel={() => setConfirmId(null)}
      />
    </div>
  );
}

/** Ancho, fondo y centro del corte, para ajustarlo con números. */
function HoleShapeFields({ entry }: { entry: HoleEntry }) {
  const resizeHole = useEditorStore((state) => state.resizeHole);
  const setHoleCenter = useEditorStore((state) => state.setHoleCenter);
  const id = entry.hole.id;
  return (
    <>
      <Field label="Ancho">
        <NumberInput
          value={Math.round(entry.width * 100) / 100}
          onChange={(width) => resizeHole(id, width, entry.depth)}
          min={0.2}
          step={0.05}
          suffix="m"
        />
      </Field>
      <Field label="Fondo">
        <NumberInput
          value={Math.round(entry.depth * 100) / 100}
          onChange={(depth) => resizeHole(id, entry.width, depth)}
          min={0.2}
          step={0.05}
          suffix="m"
        />
      </Field>
      <Field label="Centro X">
        <NumberInput
          value={Math.round(entry.center.x * 100) / 100}
          onChange={(x) => setHoleCenter(id, { x, z: entry.center.z })}
          step={0.05}
          suffix="m"
        />
      </Field>
      <Field label="Centro Z">
        <NumberInput
          value={Math.round(entry.center.z * 100) / 100}
          onChange={(z) => setHoleCenter(id, { x: entry.center.x, z })}
          step={0.05}
          suffix="m"
        />
      </Field>
    </>
  );
}