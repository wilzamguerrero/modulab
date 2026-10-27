import { useState } from 'react';
import {
  BrickWall,
  DoorOpen,
  DraftingCompass,
  Grid3X3,
  Layers,
  PaintBucket,
  PanelTop,
  PenTool,
  Ruler,
} from 'lucide-react';
import type { ExhibitorColorMode, Project, ShadowQuality } from '@/types/project';
import {
  Badge,
  Button,
  ColorInput,
  ConfirmDialog,
  Field,
  NumberInput,
  RangeInput,
  Select,
  Switch,
} from '@/components/ui';
import { useEditorStore } from '@/store/editorStore';
import { useUiStore } from '@/store/uiStore';
import { TEMPLATES, type TemplateId } from '@/data/templates';
import { SHADOW_QUALITY_OPTIONS } from '@/data/shadows';
import {
  edgeLength,
  formatArea,
  formatMeters,
  polygonArea,
  polygonBounds,
  validatePolygon,
} from '@/utils/geometry';
import { wallLength } from '@/utils/walls';

export function PlanPanel({ project }: { project: Project }) {
  const toast = useUiStore((state) => state.toast);
  const setView = useEditorStore((state) => state.setView);
  const setTool = useEditorStore((state) => state.setTool);
  const setPlanDrawMode = useEditorStore((state) => state.setPlanDrawMode);
  const replacePlan = useEditorStore((state) => state.replacePlan);
  const setDefaultWall = useEditorStore((state) => state.setDefaultWall);
  const applyWallSettingsToAll = useEditorStore((state) => state.applyWallSettingsToAll);
  const setFloorMaterial = useEditorStore((state) => state.setFloorMaterial);
  const setSettings = useEditorStore((state) => state.setSettings);
  const toggleWall = useEditorStore((state) => state.toggleWall);
  const setSelection = useEditorStore((state) => state.setSelection);

  const [template, setTemplate] = useState<TemplateId>('rectangle');
  const [confirmTemplate, setConfirmTemplate] = useState(false);

  const validation = validatePolygon(project.floor.vertices);
  const bounds = polygonBounds(project.floor.vertices);
  const area = polygonArea(project.floor.vertices);
  const perimeter = project.floor.vertices.reduce(
    (total, _vertex, index) => total + edgeLength(project.floor.vertices, index),
    0,
  );
  const wallCount = project.edges.filter((edge) => edge.wall).length + project.internalWalls.length;
  const openingCount = project.openings.length;

  const startDraw = (mode: 'outline' | 'partition' = 'outline') => {
    setView('plan');
    setPlanDrawMode(mode);
    setTool('draw');
    setSelection(null);
  };

  const startTool = (nextTool: 'internalWall' | 'door' | 'window') => {
    setView('plan');
    setTool(nextTool);
    setSelection(null);
  };

  const applyTemplate = () => {
    const selected = TEMPLATES.find((entry) => entry.id === template);
    if (!selected) return;
    replacePlan(selected.vertices.map((vertex) => ({ ...vertex })));
    setConfirmTemplate(false);
    setTool('select');
    toast(`Planta reemplazada por «${selected.name}».`, 'success');
  };

  return (
    <div>
      <section className="panel-section">
        <div className="panel-title">
          <span><DraftingCompass size={12} /> Planta</span>
          <Badge tone={validation.valid ? 'success' : 'warning'}>
            {validation.valid ? 'válida' : 'revisar'}
          </Badge>
        </div>
        <div className="prop-list">
          <div className="prop-row"><span>Área</span><strong>{formatArea(area)}</strong></div>
          <div className="prop-row"><span>Perímetro</span><strong>{formatMeters(perimeter, 1)}</strong></div>
          <div className="prop-row"><span>Dimensiones</span><strong>{bounds.width.toFixed(1)} × {bounds.depth.toFixed(1)} m</strong></div>
          <div className="prop-row"><span>Vértices</span><strong>{project.floor.vertices.length}</strong></div>
          <div className="prop-row"><span>Muros</span><strong>{wallCount} / {project.edges.length + project.internalWalls.length}</strong></div>
          <div className="prop-row"><span>Divisiones</span><strong>{project.internalWalls.length}</strong></div>
          <div className="prop-row"><span>Aberturas</span><strong>{openingCount}</strong></div>
        </div>
        {validation.errors.length > 0 ? (
          <div className="settings-status is-error">{validation.errors[0]}</div>
        ) : validation.warnings.length > 0 ? (
          <div className="panel-note">{validation.warnings[0]}</div>
        ) : null}
        <div className="inline-actions">
          {project.floor.vertices.length >= 3 ? (
            <>
              <Button size="sm" variant="primary" onClick={() => startDraw('partition')} icon={<PenTool size={13} />}>
                Añadir división
              </Button>
              <Button size="sm" variant="outline" onClick={() => startDraw('outline')} icon={<DraftingCompass size={13} />}>
                Reemplazar contorno
              </Button>
            </>
          ) : (
            <Button size="sm" variant="primary" onClick={() => startDraw('outline')} icon={<DraftingCompass size={13} />}>
              Dibujar contorno
            </Button>
          )}
          <Button size="sm" variant="outline" onClick={() => setView('3d')} icon={<Layers size={13} />}>
            Ver en 3D
          </Button>
        </div>
        <p className="panel-note">
          «Añadir división» dibuja un recinto cerrado con muros libres y conserva la planta y los
          objetos. «Reemplazar contorno» cambia el perímetro y regenera los muros perimetrales.
          Arrastra los vértices para ajustar el contorno; el piso 3D usa exactamente este polígono.
        </p>
      </section>

      <section className="panel-section">
        <div className="panel-title"><span><Ruler size={12} /> Muros por defecto</span></div>
        <div className="grid-2">
          <Field label="Altura">
            <NumberInput
              value={project.defaultWall.height}
              onChange={(value) => setDefaultWall({ height: Math.max(0.05, value) })}
              step={0.1}
              min={0.05}
              max={20}
              suffix="m"
            />
          </Field>
          <Field label="Grosor">
            <NumberInput
              value={project.defaultWall.thickness}
              onChange={(value) => setDefaultWall({ thickness: Math.max(0.02, value) })}
              step={0.01}
              min={0.02}
              max={2}
              suffix="m"
            />
          </Field>
        </div>
        <Field label="Color de muro">
          <ColorInput value={project.defaultWall.color} onChange={(color) => setDefaultWall({ color })} />
        </Field>
        <Button
          size="sm"
          variant="outline"
          onClick={() => { applyWallSettingsToAll(); toast('Estilo aplicado a todos los muros y divisiones.', 'success'); }}
          icon={<BrickWall size={13} />}
        >
          Aplicar a todos los muros
        </Button>
        <p className="panel-note">
          Cada segmento puede tener su propia altura, grosor y color. Los segmentos abiertos
          funcionan como accesos amplios; para huecos concretos usa puertas y ventanas.
        </p>
      </section>

      <section className="panel-section">
        <div className="panel-title">
          <span><BrickWall size={12} /> Divisiones y aberturas</span>
          <small>{project.internalWalls.length} muros libres · {openingCount} aberturas</small>
        </div>
        <div className="inline-actions">
          <Button size="sm" variant="outline" onClick={() => startTool('internalWall')} icon={<BrickWall size={13} />}>
            Muro libre
          </Button>
          <Button size="sm" variant="outline" onClick={() => startTool('door')} icon={<DoorOpen size={13} />}>
            Puerta
          </Button>
          <Button size="sm" variant="outline" onClick={() => startTool('window')} icon={<PanelTop size={13} />}>
            Ventana
          </Button>
        </div>
        <p className="panel-note">
          Los muros libres crean divisiones interiores sin cambiar el contorno. Con las
          herramientas Puerta y Ventana, haz clic sobre cualquier muro para abrir un hueco.
        </p>
        {project.internalWalls.length || project.openings.length ? (
          <div className="segment-list">
            {project.internalWalls.map((wall, index) => (
              <div className="segment-row" key={wall.id}>
                <button
                  type="button"
                  className="segment-name is-wall"
                  onClick={() => { setView('plan'); setSelection({ type: 'internalWall', id: wall.id }); }}
                >
                  <span>D{index + 1}</span>
                  <strong>{formatMeters(wallLength(wall.a, wall.b), 2)}</strong>
                </button>
                <span className="chip is-active">
                  {project.openings.filter((opening) => opening.wallId === wall.id).length} aberturas
                </span>
              </div>
            ))}
            {project.openings.map((opening) => (
              <div className="segment-row" key={opening.id}>
                <button
                  type="button"
                  className="segment-name"
                  onClick={() => { setView('plan'); setSelection({ type: 'opening', id: opening.id }); }}
                >
                  <span>{opening.kind === 'door' ? 'P' : 'V'}</span>
                  <strong>{formatMeters(opening.width, 2)}</strong>
                </button>
                <button
                  type="button"
                  className="chip is-active"
                  onClick={() => { setView('plan'); setSelection({ type: 'opening', id: opening.id }); }}
                >
                  Editar
                </button>
              </div>
            ))}
          </div>
        ) : (
          <p className="panel-note">Aún no hay divisiones ni aberturas.</p>
        )}
      </section>

      <section className="panel-section">
        <div className="panel-title">
          <span><BrickWall size={12} /> Segmentos</span>
          <small>{project.edges.length}</small>
        </div>
        <div className="segment-list">
          {project.edges.map((edge, index) => {
            const length = edgeLength(project.floor.vertices, index);
            return (
              <div className="segment-row" key={edge.id || index}>
                <button
                  type="button"
                  className={`segment-name${edge.wall ? ' is-wall' : ''}`}
                  onClick={() => { setView('plan'); setSelection({ type: 'edge', index }); }}
                >
                  <span>{index + 1}</span>
                  <strong>{formatMeters(length, 2)}</strong>
                </button>
                <button
                  type="button"
                  className={`chip${edge.wall ? ' is-active' : ''}`}
                  onClick={() => toggleWall(index)}
                  title={edge.wall ? 'Convertir en acceso abierto' : 'Convertir en muro'}
                >
                  {edge.wall ? 'Muro' : 'Abierto'}
                </button>
              </div>
            );
          })}
          {project.edges.length === 0 ? <p className="panel-note">Dibuja el contorno para crear segmentos.</p> : null}
        </div>
      </section>

      <section className="panel-section">
        <div className="panel-title"><span><PaintBucket size={12} /> Piso</span></div>
        <Field label="Color">
          <ColorInput value={project.floor.color} onChange={(color) => setFloorMaterial({ color })} />
        </Field>
        <RangeInput
          label="Rugosidad"
          value={project.floor.roughness}
          onChange={(roughness) => setFloorMaterial({ roughness })}
          min={0}
          max={1}
          step={0.01}
          format={(value) => value.toFixed(2)}
        />
        <RangeInput
          label="Metalicidad"
          value={project.floor.metalness}
          onChange={(metalness) => setFloorMaterial({ metalness })}
          min={0}
          max={1}
          step={0.01}
          format={(value) => value.toFixed(2)}
        />
      </section>

      <section className="panel-section">
        <div className="panel-title"><span><Grid3X3 size={12} /> Escena y ayudas</span></div>
        <Field label="Tamaño de cuadrícula">
          <Select
            value={String(project.settings.gridSize)}
            onChange={(event) => setSettings({ gridSize: Number(event.target.value) })}
          >
            <option value="0.1">10 cm</option>
            <option value="0.25">25 cm</option>
            <option value="0.5">50 cm</option>
            <option value="1">1 m</option>
          </Select>
        </Field>
        <Field label="Calidad de sombras">
          <Select
            value={project.settings.shadowQuality}
            onChange={(event) =>
              setSettings({ shadowQuality: event.target.value as ShadowQuality })
            }
          >
            {SHADOW_QUALITY_OPTIONS.map((option) => (
              <option key={option.value} value={option.value}>{option.label}</option>
            ))}
          </Select>
        </Field>
        <p className="panel-note">
          Más resolución mejora los bordes de las sombras, pero consume más GPU. En móviles,
          empieza por la calidad baja.
        </p>
        <Field label="Color de expositores">
          <Select
            value={project.settings.exhibitorColorMode}
            onChange={(event) =>
              setSettings({ exhibitorColorMode: event.target.value as ExhibitorColorMode })
            }
          >
            <option value="rings">Aros de color</option>
            <option value="paint">Pintar elementos</option>
            <option value="both">Aros + pintura</option>
          </Select>
        </Field>
        <RangeInput
          label="Intensidad de pintura"
          value={project.settings.exhibitorColorOpacity}
          onChange={(exhibitorColorOpacity) => setSettings({ exhibitorColorOpacity })}
          min={0.05}
          max={0.9}
          step={0.05}
          format={(value) => `${Math.round(value * 100)} %`}
        />
        <p className="panel-note">
          La pintura tiñe muros, aberturas y objetos asociados. La selección de un expositor
          resalta sus elementos incluso en el modo de solo aros.
        </p>
        <Switch
          checked={project.settings.snapToGrid}
          onChange={(snapToGrid) => setSettings({ snapToGrid })}
          label="Ajustar a cuadrícula"
          hint="Vértices, objetos y expositores se alinean al mover."
        />
        <Switch
          checked={project.settings.showGrid}
          onChange={(showGrid) => setSettings({ showGrid })}
          label="Mostrar cuadrícula"
        />
        <Switch
          checked={project.settings.showDimensions}
          onChange={(showDimensions) => setSettings({ showDimensions })}
          label="Mostrar cotas de muros"
        />
      </section>

      <section className="panel-section">
        <div className="panel-title"><span>Reemplazar por plantilla</span></div>
        <div className="row">
          <Select value={template} onChange={(event) => setTemplate(event.target.value as TemplateId)}>
            {TEMPLATES.map((entry) => (
              <option key={entry.id} value={entry.id}>{entry.name}</option>
            ))}
          </Select>
          <Button size="sm" variant="outline" onClick={() => setConfirmTemplate(true)}>
            Aplicar
          </Button>
        </div>
        <p className="panel-note">
          Cambiar la plantilla no elimina muebles ni expositores, pero sí sustituye el contorno y
          regenera los segmentos perimetrales. Las divisiones interiores se conservan.
        </p>
      </section>

      <ConfirmDialog
        open={confirmTemplate}
        title="Reemplazar la planta"
        message="Se sustituirá el contorno actual y se regenerarán los muros perimetrales. Los objetos, expositores y divisiones interiores conservarán su posición. Las aberturas de los muros perimetrales se eliminarán."
        confirmLabel="Reemplazar"
        onConfirm={applyTemplate}
        onCancel={() => setConfirmTemplate(false)}
      />
    </div>
  );
}
