import type { ReactNode } from 'react';
import {
  CloudSun,
  Flashlight,
  Lightbulb,
  Sun,
  SunMedium,
  Trash2,
} from 'lucide-react';
import type { LightConfig, Project } from '@/types/project';
import { Badge, Button, IconButton } from '@/components/ui';
import { useEditorStore } from '@/store/editorStore';
import { useUiStore } from '@/store/uiStore';

const LIGHT_LABELS: Record<LightConfig['type'], string> = {
  ambient: 'Ambiental',
  hemisphere: 'Hemisférica',
  directional: 'Direccional',
  point: 'Puntual',
  spot: 'Foco',
};

const LIGHT_ICONS: Record<LightConfig['type'], ReactNode> = {
  ambient: <Sun size={13} />,
  hemisphere: <CloudSun size={13} />,
  directional: <SunMedium size={13} />,
  point: <Lightbulb size={13} />,
  spot: <Flashlight size={13} />,
};

const ADD_OPTIONS: Array<{ type: LightConfig['type']; label: string; icon: ReactNode }> = [
  { type: 'ambient', label: 'Ambiental', icon: <Sun size={13} /> },
  { type: 'hemisphere', label: 'Hemisférica', icon: <CloudSun size={13} /> },
  { type: 'directional', label: 'Direccional', icon: <SunMedium size={13} /> },
  { type: 'point', label: 'Puntual', icon: <Lightbulb size={13} /> },
  { type: 'spot', label: 'Foco', icon: <Flashlight size={13} /> },
];

export function LightsPanel({ project }: { project: Project }) {
  const toast = useUiStore((state) => state.toast);
  const addLight = useEditorStore((state) => state.addLight);
  const updateLight = useEditorStore((state) => state.updateLight);
  const deleteLight = useEditorStore((state) => state.deleteLight);
  const setSelection = useEditorStore((state) => state.setSelection);
  const setView = useEditorStore((state) => state.setView);

  const add = (type: LightConfig['type']) => {
    if (project.lights.length >= 16) {
      toast('Hay demasiadas luces. Elimina alguna antes de añadir otra.', 'warning');
      return;
    }
    const id = addLight(type);
    if (id) {
      setView('3d');
      toast(`Luz ${LIGHT_LABELS[type].toLowerCase()} añadida.`, 'success');
    }
  };

  return (
    <div>
      <section className="panel-section">
        <div className="panel-title">
          <span><Lightbulb size={12} /> Iluminación</span>
          <Badge tone="accent">{project.lights.length}</Badge>
        </div>
        <div className="light-add-grid">
          {ADD_OPTIONS.map((option) => (
            <Button
              key={option.type}
              size="sm"
              variant="secondary"
              onClick={() => add(option.type)}
              icon={option.icon}
            >
              {option.label}
            </Button>
          ))}
        </div>
        <p className="panel-note">
          La iluminación se calcula en tiempo real. Las sombras son costosas: actívalas solo en una
          o dos luces principales.
        </p>
      </section>

      <section className="panel-section">
        <div className="panel-title"><span>Luces de la escena</span><small>{project.lights.length} / 16</small></div>
        <div className="stack">
          {project.lights.map((light) => (
            <article
              key={light.id}
              className="list-card"
              onClick={() => {
                setSelection({ type: 'light', id: light.id });
                setView('3d');
              }}
            >
              <div className={`mini-icon${light.enabled ? ' is-on' : ''}`}>{LIGHT_ICONS[light.type]}</div>
              <div className="list-card-main">
                <div className="list-card-title">{light.name || LIGHT_LABELS[light.type]}</div>
                <div className="list-card-sub">
                  {LIGHT_LABELS[light.type]} · {light.intensity.toFixed(2)}
                  {light.castShadow ? ' · sombras' : ''}
                </div>
              </div>
              <button
                type="button"
                className={`chip${light.enabled ? ' is-active' : ''}`}
                onClick={(event) => {
                  event.stopPropagation();
                  updateLight(light.id, { enabled: !light.enabled });
                }}
              >
                {light.enabled ? 'On' : 'Off'}
              </button>
              <IconButton
                label="Eliminar luz"
                icon={<Trash2 size={13} />}
                onClick={(event) => {
                  event.stopPropagation();
                  deleteLight(light.id);
                  toast('Luz eliminada.', 'success');
                }}
              />
            </article>
          ))}
          {project.lights.length === 0 ? (
            <div className="empty-state" style={{ padding: '20px 12px' }}>
              <Lightbulb size={18} />
              <h3>Sin luces</h3>
              <p>La escena usará una iluminación mínima. Añade una luz ambiental y una direccional.</p>
            </div>
          ) : null}
        </div>
      </section>
    </div>
  );
}
