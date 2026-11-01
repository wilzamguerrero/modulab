import { useEditorStore } from '@/store/editorStore';
import type { Project, Stair } from '@/types/project';
import { fitStairToLevels } from '@/utils/levels';
import { formatMeters } from '@/utils/geometry';
import { stairMetrics } from '@/utils/stairs';

const clamp = (value: number, min: number, max: number) => Math.min(max, Math.max(min, value));

/** Panel flotante para editar la escalera seleccionada sin salir de la vista 3D. */
export function StairQuickEditor({ project, stair }: { project: Project; stair: Stair }) {
  const updateStair = useEditorStore((state) => state.updateStair);
  const level = project.levels.find((entry) => entry.stairs.some((item) => item.id === stair.id));
  const effective = level ? fitStairToLevels(project, level, stair) : stair;
  const metrics = stairMetrics(effective);
  const parse = (value: string, fallback: number) => {
    const parsed = Number(value);
    return Number.isFinite(parsed) ? parsed : fallback;
  };

  return (
    <div className="stair-quick">
      <div className="stair-quick-title">{stair.name} · {level?.name ?? 'Nivel'}</div>
      <label>
        Tipo
        <select
          value={stair.kind}
          onChange={(event) => updateStair(stair.id, { kind: event.target.value as Stair['kind'] })}
        >
          <option value="straight">Recta</option>
          <option value="l">En L</option>
          <option value="u">En U</option>
        </select>
      </label>
      <label>
        Sentido
        <select
          value={stair.direction}
          onChange={(event) => updateStair(stair.id, { direction: event.target.value as Stair['direction'] })}
        >
          <option value="up">Sube</option>
          <option value="down">Baja</option>
        </select>
      </label>
      <label>
        Peldaños
        <input
          type="number"
          min={2}
          max={80}
          step={1}
          value={stair.steps}
          onChange={(event) =>
            updateStair(stair.id, { steps: Math.round(clamp(parse(event.target.value, stair.steps), 2, 80)) })
          }
        />
      </label>
      <label>
        Huella (m)
        <input
          type="number"
          min={0.1}
          max={1}
          step={0.01}
          value={stair.tread}
          onChange={(event) => updateStair(stair.id, { tread: clamp(parse(event.target.value, stair.tread), 0.1, 1) })}
        />
      </label>
      <label>
        Ancho (m)
        <input
          type="number"
          min={0.4}
          max={6}
          step={0.05}
          value={stair.width}
          onChange={(event) => updateStair(stair.id, { width: clamp(parse(event.target.value, stair.width), 0.4, 6) })}
        />
      </label>
      {stair.kind !== 'straight' ? (
        <label>
          Descansillo (m)
          <input
            type="number"
            min={0.2}
            max={6}
            step={0.05}
            value={stair.landingDepth}
            onChange={(event) =>
              updateStair(stair.id, { landingDepth: clamp(parse(event.target.value, stair.landingDepth), 0.2, 6) })
            }
          />
        </label>
      ) : null}
      <label>
        Giro (°)
        <input
          type="number"
          step={5}
          value={Math.round((stair.rotation * 180) / Math.PI)}
          onChange={(event) =>
            updateStair(stair.id, { rotation: (parse(event.target.value, 0) * Math.PI) / 180 })
          }
        />
      </label>
      <label className="stair-quick-check">
        <input
          type="checkbox"
          checked={stair.railing}
          onChange={(event) => updateStair(stair.id, { railing: event.target.checked })}
        />
        Barandilla
      </label>
      <div className="stair-quick-info">
        {formatMeters(metrics.risePerStep, 3)} por peldaño · salto {formatMeters(effective.rise, 2)}
      </div>
    </div>
  );
}
