import { useEffect, useRef, useState, type ReactNode } from 'react';
import {
  ArrowUpRight,
  Box,
  BrickWall,
  Camera,
  Copy,
  CopyPlus,
  DoorOpen,
  ImagePlus,
  Lightbulb,
  MapPin,
  Move,
  MoveDown,
  MoveUp,
  PanelTop,
  RotateCcw,
  RotateCw,
  Sparkles,
  Trash2,
  Users,
  X,
} from 'lucide-react';
import type {
  Exhibitor,
  ExhibitorColorMode,
  InternalWall,
  Level,
  LightConfig,
  Project,
  SceneObject,
  ShadowQuality,
  Space,
  SpaceHole,
  Stair,
  Vec3,
  WallOpening,
} from '@/types/project';
import { entityLevelId, getLevel, getSpace, levelVertices, projectBounds } from '@/utils/levels';
import { buildStairBoxes, stairMetrics } from '@/utils/stairs';
import {
  Badge,
  Button,
  ColorInput,
  Field,
  HelpButton,
  IconButton,
  NumberInput,
  RangeInput,
  Select,
  Switch,
  TextArea,
  TextInput,
} from '@/components/ui';
import { useEditorStore } from '@/store/editorStore';
import { useModelInfoStore } from '@/store/modelInfoStore';
import { useUiStore } from '@/store/uiStore';
import { cameraForVertices, defaultExhibitorCamera } from '@/data/defaults';
import { DEFAULT_CAMERA_DISTANCE, headingCameraFor } from '@/utils/exhibitorCamera';
import { SHADOW_QUALITY_OPTIONS } from '@/data/shadows';
import { notionPhotoUrl } from '@/services/notion/notionService';
import { uploadExhibitorPhoto } from '@/services/assets/catalogService';
import { formatDateTime } from '@/utils/format';
import { edgeLength, formatArea, formatMeters, polygonArea, polygonBounds, snapValue } from '@/utils/geometry';
import { levelPivot } from '@/utils/levelTransform';
import { LevelReadout } from '@/components/editor/LevelReadout';
import { findWallInProject, getWallById, wallLength } from '@/utils/walls';
import { DEFAULT_EXHIBITOR_COLOR } from '@/utils/exhibitorColors';

function AxisInput({
  value,
  onChange,
  step = 0.05,
  disabled,
}: {
  value: Vec3;
  onChange: (value: Vec3) => void;
  step?: number;
  disabled?: boolean;
}) {
  return (
    <div className="vector-inputs">
      {(['X', 'Y', 'Z'] as const).map((axis, index) => (
        <label key={axis}>
          <span>{axis}</span>
          <input
            className="input"
            type="number"
            step={step}
            disabled={disabled}
            value={Number(value[index].toFixed(3))}
            onChange={(event) => {
              const next = Number(event.target.value);
              if (!Number.isFinite(next)) return;
              const values = [...value] as Vec3;
              values[index] = next;
              onChange(values);
            }}
          />
        </label>
      ))}
    </div>
  );
}

/**
 * Campo numérico que aplica el valor al confirmar (Enter o al salir), no en cada
 * tecla. El de `ui` aplica en `onChange` y, al ser controlado, impide escribir
 * valores intermedios como «-» o «12.» para corregir el giro a mano.
 */
function CommitNumberInput({
  value,
  onCommit,
  step = 0.1,
  suffix,
  decimals = 2,
}: {
  value: number;
  onCommit: (value: number) => void;
  step?: number;
  suffix?: string;
  decimals?: number;
}) {
  const format = (next: number) => String(Number(next.toFixed(decimals)));
  const [text, setText] = useState(format(value));
  const [editing, setEditing] = useState(false);

  // Mientras no se esté escribiendo, el campo refleja el valor real (también
  // durante el arrastre del gizmo).
  useEffect(() => {
    if (!editing) setText(format(value));
  }, [value, editing]);

  const commit = () => {
    setEditing(false);
    const next = Number(text.replace(',', '.'));
    if (Number.isFinite(next)) {
      // No se reformatea aquí: al salir se deja de editar y el efecto de arriba
      // vuelve a pintar el valor real del piso. Eso importa porque el giro se
      // normaliza (escribir 360° lo deja en 0°) y el campo debe coincidir con
      // lo que de verdad quedó en el nivel.
      onCommit(next);
    } else {
      setText(format(value));
    }
  };

  return (
    <div className="number-input">
      <input
        className="input"
        type="number"
        step={step}
        value={text}
        onFocus={() => setEditing(true)}
        onChange={(event) => {
          const raw = event.target.value;
          setText(raw);
          // Las flechas del campo (y las de teclado) emiten un valor ya completo:
          // se aplica al momento para que el piso gire al pulsarlas. Mientras se
          // escribe, los estados intermedios («-», «1.») no son números válidos y
          // no se aplican, y el texto no se reformatea hasta salir del campo.
          const next = Number(raw.replace(',', '.'));
          if (raw.trim() !== '' && Number.isFinite(next)) onCommit(next);
        }}
        onBlur={commit}
        onKeyDown={(event) => {
          if (event.key === 'Enter') {
            event.currentTarget.blur();
          } else if (event.key === 'Escape') {
            setText(format(value));
            setEditing(false);
            event.currentTarget.blur();
          }
        }}
      />
      {suffix ? <span className="number-suffix">{suffix}</span> : null}
    </div>
  );
}

function Section({ title, children, action }: { title: string; children: ReactNode; action?: ReactNode }) {
  return (
    <section className="inspector-section">
      <div className="inspector-section-title">
        <span>{title}</span>
        {action}
      </div>
      {children}
    </section>
  );
}

function ExhibitorSelect({
  project,
  value,
  onChange,
}: {
  project: Project;
  value: string | null | undefined;
  onChange: (exhibitorId: string | null) => void;
}) {
  return (
    <Select
      value={value ?? ''}
      onChange={(event) => onChange(event.target.value || null)}
    >
      <option value="">Sin asociar</option>
      {project.exhibitors.map((exhibitor) => (
        <option key={exhibitor.id} value={exhibitor.id}>
          {exhibitor.name}
          {exhibitor.standCode ? ` · ${exhibitor.standCode}` : ''}
        </option>
      ))}
    </Select>
  );
}

function ProjectInspector({ project, onPublish }: { project: Project; onPublish: () => void }) {
  const setProjectMeta = useEditorStore((state) => state.setProjectMeta);
  const setProjectCamera = useEditorStore((state) => state.setProjectCamera);
  const setSettings = useEditorStore((state) => state.setSettings);

  return (
    <>
      <Section title="Proyecto">
        <Field label="Nombre">
          <TextInput value={project.name} onChange={(event) => setProjectMeta({ name: event.target.value })} />
        </Field>
        <Field label="Evento o materia">
          <TextInput value={project.event} onChange={(event) => setProjectMeta({ event: event.target.value })} />
        </Field>
        <Field label="Descripción">
          <TextArea
            value={project.description}
            placeholder="Describe el montaje, el recorrido o la muestra."
            onChange={(event) => setProjectMeta({ description: event.target.value })}
          />
        </Field>
      </Section>

      <Section title="Cámara inicial">
        <Field label="Posición">
          <AxisInput
            value={project.camera.position}
            onChange={(position) => setProjectCamera({ position })}
            step={0.5}
          />
        </Field>
        <Field label="Objetivo">
          <AxisInput
            value={project.camera.target}
            onChange={(target) => setProjectCamera({ target })}
            step={0.5}
          />
        </Field>
        <Field label="Campo de visión">
          <NumberInput
            value={project.camera.fov}
            onChange={(fov) => setProjectCamera({ fov: Math.min(100, Math.max(20, fov)) })}
            step={1}
            min={20}
            max={100}
            suffix="°"
          />
        </Field>
        <Button
          size="sm"
          variant="outline"
          icon={<Camera size={13} />}
          onClick={() => {
            const space = project.levels
              .flatMap((level) => level.spaces)
              .find((entry) => entry.vertices.length >= 3);
            setProjectCamera(cameraForVertices(space?.vertices ?? []));
          }}
        >
          Ajustar a la planta
        </Button>
      </Section>

      <Section
        title="Vista y edición"
        action={
          <HelpButton title="Vista y edición">
            <p>
              La pintura tiñe muros, aberturas y objetos asociados. Al seleccionar un expositor, sus
              elementos se resaltan siempre, aunque solo estén activos los aros.
            </p>
            <p>
              Las cotas muestran la longitud de cada segmento en la planta. El ajuste a cuadrícula
              alinea vértices, objetos y expositores al moverlos.
            </p>
          </HelpButton>
        }
      >
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
        <Switch
          checked={project.settings.showGrid}
          onChange={(showGrid) => setSettings({ showGrid })}
          label="Cuadrícula"
        />
        <Switch
          checked={project.settings.showDimensions}
          onChange={(showDimensions) => setSettings({ showDimensions })}
          label="Cotas y medidas"
        />
        <Switch
          checked={project.settings.showLiveMeasurements}
          onChange={(showLiveMeasurements) => setSettings({ showLiveMeasurements })}
          label="Medidas al editar"
          hint="Largo y ancho mientras dibujas o editas un elemento."
        />
        <Switch
          checked={project.settings.snapToGrid}
          onChange={(snapToGrid) => setSettings({ snapToGrid })}
          label="Ajuste a cuadrícula"
        />
      </Section>

      <Section title="Resumen">
        <div className="prop-list">
          <div className="prop-row"><span>Área</span><strong>{formatArea(
            project.levels.reduce(
              (total, level) =>
                total +
                level.spaces.reduce((sum, space) => sum + polygonArea(space.vertices), 0),
              0,
            ),
          )}</strong></div>
          <div className="prop-row"><span>Niveles</span><strong>{project.levels.length}</strong></div>
          <div className="prop-row"><span>Objetos</span><strong>{project.objects.length}</strong></div>
          <div className="prop-row"><span>Expositores</span><strong>{project.exhibitors.length}</strong></div>
          <div className="prop-row"><span>Luces</span><strong>{project.lights.length}</strong></div>
          <div className="prop-row"><span>Actualizado</span><strong>{formatDateTime(project.updatedAt)}</strong></div>
        </div>
      </Section>

      <Section
        title="Publicación"
        action={
          <HelpButton title="Publicación">
            <p>
              La publicación crea una copia de solo lectura con un enlace compartible. Los cambios
              posteriores no se verán hasta volver a publicar.
            </p>
            <p>
              El visor público oculta el Gaussian splat por defecto; el visitante puede mostrarlo con
              el botón «Gaussian».
            </p>
          </HelpButton>
        }
      >
        {project.published ? (
          <>
            <div className="settings-status is-ok">
              <Sparkles size={14} />
              <span>Publicado · versión {project.published.version}</span>
            </div>
            <div className="prop-list">
              <div className="prop-row"><span>Fecha</span><strong>{formatDateTime(project.published.publishedAt)}</strong></div>
              <div className="prop-row"><span>Enlace</span><strong>/e/{project.published.publicId}</strong></div>
            </div>
            <div className="inline-actions">
              <Button
                size="sm"
                variant="secondary"
                onClick={() => window.open(`/e/${project.published?.publicId}`, '_blank')}
                icon={<ArrowUpRight size={13} />}
              >
                Abrir visor
              </Button>
              <Button size="sm" variant="outline" onClick={onPublish}>Publicar cambios</Button>
            </div>
          </>
        ) : (
          <>
            <Button size="sm" variant="primary" onClick={onPublish} icon={<Sparkles size={13} />}>
              Publicar espacio
            </Button>
          </>
        )}
      </Section>
    </>
  );
}

function ObjectInspector({
  project,
  object,
}: {
  project: Project;
  object: SceneObject;
}) {
  const updateObject = useEditorStore((state) => state.updateObject);
  const updateObjectTransform = useEditorStore((state) => state.updateObjectTransform);
  const setObjectOverride = useEditorStore((state) => state.setObjectOverride);
  const clearObjectOverrides = useEditorStore((state) => state.clearObjectOverrides);
  const deleteObject = useEditorStore((state) => state.deleteObject);
  const duplicateObject = useEditorStore((state) => state.duplicateObject);
  const assignObjectToExhibitor = useEditorStore((state) => state.assignObjectToExhibitor);
  const setSelection = useEditorStore((state) => state.setSelection);
  const toast = useUiStore((state) => state.toast);
  const modelUrl = object.source.type === 'glb' ? object.source.url : `primitive:${object.source.shape}`;
  const info = useModelInfoStore((state) => state.info[modelUrl]);
  const loading = useModelInfoStore((state) => state.loading[modelUrl]);
  const error = useModelInfoStore((state) => state.errors[modelUrl]);
  const ensure = useModelInfoStore((state) => state.ensure);
  const [realAxis, setRealAxis] = useState<'largest' | 'x' | 'y' | 'z'>('largest');

  useEffect(() => {
    ensure(modelUrl);
  }, [modelUrl, ensure]);

  const baseSize = object.size ?? info?.size;
  const dimensions = baseSize
    ? baseSize.map((value, index) => Math.abs(value * object.transform.scale[index]))
    : null;
  const referenceIndex = dimensions
    ? realAxis === 'largest'
      ? dimensions.indexOf(Math.max(...dimensions))
      : realAxis === 'x'
        ? 0
        : realAxis === 'y'
          ? 1
          : 2
    : 0;
  const referenceCm = dimensions ? dimensions[referenceIndex] * 100 : 0;

  const applyRealScale = (cm: number) => {
    if (!dimensions || !Number.isFinite(cm) || cm <= 0) return;
    const referenceMeters = dimensions[referenceIndex];
    if (referenceMeters <= 0.00001) return;
    const factor = cm / 100 / referenceMeters;
    updateObjectTransform(
      object.id,
      {
        scale: object.transform.scale.map((value) =>
          Math.max(0.001, Math.abs(value) * factor),
        ) as Vec3,
      },
      { coalesceKey: `real-scale:${object.id}` },
    );
  };

  const snapToFloor = () => {
    updateObjectTransform(object.id, {
      position: [object.transform.position[0], 0, object.transform.position[2]],
    });
    toast('Objeto apoyado en el piso.', 'success');
  };

  const snapToGrid = () => {
    const size = project.settings.gridSize;
    updateObjectTransform(object.id, {
      position: [
        snapValue(object.transform.position[0], size),
        object.transform.position[1],
        snapValue(object.transform.position[2], size),
      ],
    });
  };

  return (
    <>
      <Section
        title="Objeto"
        action={
          <div className="inline-actions">
            <IconButton
              label="Duplicar"
              icon={<Copy size={13} />}
              onClick={() => { duplicateObject(object.id); toast('Objeto duplicado.', 'success'); }}
            />
            <IconButton
              label="Eliminar"
              icon={<Trash2 size={13} />}
              onClick={() => { deleteObject(object.id); setSelection(null); toast('Objeto eliminado.', 'success'); }}
            />
          </div>
        }
      >
        <Field label="Nombre">
          <TextInput
            value={object.name}
            onChange={(event) => updateObject(object.id, { name: event.target.value }, { coalesceKey: `name:${object.id}` })}
          />
        </Field>
        <Field
          label="Código"
          hint="Referencia corta del objeto (por ejemplo el código del modelo 3D). Es independiente del nombre."
        >
          <TextInput
            value={object.code}
            placeholder={object.source.type === 'glb' ? object.source.file.replace(/\.glb$/i, '') : 'B1'}
            onChange={(event) => updateObject(object.id, { code: event.target.value }, { coalesceKey: `code:${object.id}` })}
          />
        </Field>
        <div className="grid-2">
          <Switch
            checked={object.showCode}
            onChange={(showCode) => updateObject(object.id, { showCode })}
            label="Mostrar código"
          />
          <Switch
            checked={object.showName}
            onChange={(showName) => updateObject(object.id, { showName })}
            label="Mostrar nombre"
          />
        </div>
        <div className="row-between">
          <Badge tone={object.source.type === 'glb' ? 'info' : 'neutral'}>
            {object.source.type === 'glb' ? 'GLB' : 'Forma básica'}
          </Badge>
          <span className="panel-note">
            {object.source.type === 'glb' ? object.source.file : object.source.shape}
          </span>
        </div>
        {object.source.type === 'glb' && error ? (
          <div className="settings-status is-error">No se pudo cargar: {error}</div>
        ) : null}
      </Section>

      <Section title="Transformación">
        <Field label="Posición (m)">
          <AxisInput
            value={object.transform.position}
            onChange={(position) => updateObjectTransform(object.id, { position }, { coalesceKey: `transform:${object.id}` })}
          />
        </Field>
        <Field label="Rotación Y">
          <NumberInput
            value={(object.transform.rotationY * 180) / Math.PI}
            onChange={(degrees) => updateObjectTransform(
              object.id,
              { rotationY: (degrees * Math.PI) / 180 },
              { coalesceKey: `rotate:${object.id}` },
            )}
            step={5}
            suffix="°"
          />
        </Field>
        <Field label="Escala">
          <AxisInput
            value={object.transform.scale}
            step={0.05}
            onChange={(scale) => updateObjectTransform(
              object.id,
              { scale: scale.map((value) => Math.max(0.01, value)) as Vec3 },
              { coalesceKey: `scale:${object.id}` },
            )}
          />
        </Field>
        <div className="inline-actions">
          <Button size="sm" variant="outline" onClick={snapToFloor} icon={<Box size={13} />}>Apoyar en piso</Button>
          <Button size="sm" variant="outline" onClick={snapToGrid} icon={<Sparkles size={13} />}>Alinear</Button>
        </div>
        <div className="grid-2">
          <Switch
            checked={object.visible}
            onChange={(visible) => updateObject(object.id, { visible })}
            label="Visible"
          />
          <Switch
            checked={object.locked}
            onChange={(locked) => updateObject(object.id, { locked })}
            label="Bloqueado"
          />
        </div>
      </Section>

      <Section
        title="Medidas reales"
        action={
          <HelpButton title="Medidas reales">
            <p>
              Es el tamaño del objeto ya escalado (tamaño del modelo × escala). La etiqueta sobre el
              objeto seleccionado en 3D muestra ancho, alto y fondo.
            </p>
            <p>
              Al cambiar la medida de referencia, la escala X/Y/Z se multiplica por el mismo factor
              para conservar las proporciones.
            </p>
          </HelpButton>
        }
      >
        {dimensions ? (
          <>
            <div className="prop-list">
              <div className="prop-row"><span>Ancho (X)</span><strong>{(dimensions[0] * 100).toFixed(1)} cm</strong></div>
              <div className="prop-row"><span>Alto (Y)</span><strong>{(dimensions[1] * 100).toFixed(1)} cm</strong></div>
              <div className="prop-row"><span>Fondo (Z)</span><strong>{(dimensions[2] * 100).toFixed(1)} cm</strong></div>
            </div>
            <Field label="Medida de referencia">
              <Select
                value={realAxis}
                onChange={(event) => setRealAxis(event.target.value as typeof realAxis)}
              >
                <option value="largest">Mayor dimensión</option>
                <option value="x">Ancho (X)</option>
                <option value="y">Alto (Y)</option>
                <option value="z">Fondo (Z)</option>
              </Select>
            </Field>
            <Field label="Medida real">
              <NumberInput
                value={Number(referenceCm.toFixed(2))}
                onChange={applyRealScale}
                step={1}
                min={0.1}
                suffix="cm"
              />
            </Field>
          </>
        ) : (
          <p className="panel-note">
            {object.source.type === 'glb'
              ? 'Cargando dimensiones del GLB…'
              : 'Sin dimensiones disponibles para esta forma.'}
          </p>
        )}
      </Section>

      <Section
        title="Expositor asociado"
        action={
          <HelpButton title="Expositor asociado">
            <p>
              El objeto usa el color de su expositor en el visor y puede pintarse con él según la
              configuración de «Vista y edición».
            </p>
          </HelpButton>
        }
      >
        <ExhibitorSelect
          project={project}
          value={object.exhibitorId}
          onChange={(exhibitorId) => assignObjectToExhibitor(object.id, exhibitorId)}
        />
      </Section>

      <Section
        title="Materiales"
        action={Object.keys(object.overrides).length ? (
          <Button size="sm" variant="ghost" onClick={() => clearObjectOverrides(object.id)} icon={<RotateCcw size={12} />}>
            Restablecer
          </Button>
        ) : null}
      >
        {loading ? <p className="panel-note">Leyendo materiales del modelo…</p> : null}
        {info?.materials.length ? (
          info.materials.map((slot) => {
            const override = object.overrides[slot.key] ?? {};
            return (
              <div className="material-card" key={slot.key}>
                <div className="material-card-head">
                  <span className="row" style={{ minWidth: 0 }}>
                    <span className="material-swatch" style={{ background: override.color ?? slot.color ?? '#888' }} />
                    <span style={{ overflow: 'hidden', textOverflow: 'ellipsis', whiteSpace: 'nowrap' }}>{slot.name}</span>
                  </span>
                  {override.visible === false ? <Badge tone="warning">oculto</Badge> : null}
                </div>
                <ColorInput
                  value={override.color ?? slot.color ?? '#d8d2c4'}
                  onChange={(color) => setObjectOverride(object.id, slot.key, { color }, { coalesceKey: `mat-color:${object.id}:${slot.key}` })}
                />
                <RangeInput
                  label="Rugosidad"
                  value={override.roughness ?? slot.roughness ?? 0.6}
                  onChange={(roughness) => setObjectOverride(object.id, slot.key, { roughness }, { coalesceKey: `mat-r:${object.id}:${slot.key}` })}
                  min={0}
                  max={1}
                  step={0.01}
                  format={(value) => value.toFixed(2)}
                />
                <RangeInput
                  label="Metalicidad"
                  value={override.metalness ?? slot.metalness ?? 0.02}
                  onChange={(metalness) => setObjectOverride(object.id, slot.key, { metalness }, { coalesceKey: `mat-m:${object.id}:${slot.key}` })}
                  min={0}
                  max={1}
                  step={0.01}
                  format={(value) => value.toFixed(2)}
                />
              </div>
            );
          })
        ) : !loading && !error ? (
          <p className="panel-note">Este modelo no declara materiales editables. Se conservan los materiales originales del GLB.</p>
        ) : null}
      </Section>
    </>
  );
}

function ExhibitorInspector({
  project,
  exhibitor,
}: {
  project: Project;
  exhibitor: Exhibitor;
}) {
  const updateExhibitor = useEditorStore((state) => state.updateExhibitor);
  const deleteExhibitor = useEditorStore((state) => state.deleteExhibitor);
  const assignObjectToExhibitor = useEditorStore((state) => state.assignObjectToExhibitor);
  const setEdge = useEditorStore((state) => state.setEdge);
  const updateInternalWall = useEditorStore((state) => state.updateInternalWall);
  const updateOpening = useEditorStore((state) => state.updateOpening);
  const setSelection = useEditorStore((state) => state.setSelection);
  const setActiveLevel = useEditorStore((state) => state.setActiveLevel);
  const setActiveSpace = useEditorStore((state) => state.setActiveSpace);
  const transformMode = useEditorStore((state) => state.transformMode);
  const setTransformMode = useEditorStore((state) => state.setTransformMode);
  const toast = useUiStore((state) => state.toast);
  const photoRef = useRef<HTMLInputElement>(null);
  const [uploading, setUploading] = useState(false);
  const photo = notionPhotoUrl(exhibitor);
  const level = getLevel(project, entityLevelId(project, exhibitor)) ?? project.levels[0];
  const associatedWallCount = level
    ? level.spaces.reduce(
        (total, space) =>
          total + space.edges.filter((edge) => edge.exhibitorId === exhibitor.id).length,
        0,
      ) + level.internalWalls.filter((wall) => wall.exhibitorId === exhibitor.id).length
    : 0;
  const associatedOpeningCount = level
    ? level.openings.filter((opening) => opening.exhibitorId === exhibitor.id).length
    : 0;

  const wallKindLabel = (wallId: string) =>
    findWallInProject(project, wallId)?.wall.internalWall ? 'muro libre' : 'muro perimetral';

  const activateForEdge = (space: Space) => {
    if (!level) return;
    if (level.id !== useEditorStore.getState().activeLevelId) setActiveLevel(level.id);
    if (space.id !== useEditorStore.getState().activeSpaceId) setActiveSpace(space.id);
  };

  const uploadPhoto = async (file: File | undefined) => {
    if (!file) return;
    setUploading(true);
    try {
      const result = await uploadExhibitorPhoto(file, {
        // Se adjunta a la página del proyecto para que la sincronización de
        // personas desde Notion no la sobrescriba; si no hay, a la ficha.
        notionBlockId: project.notionBlockId || exhibitor.notionBlockId,
      });
      if (result.notionBlockId) {
        updateExhibitor(exhibitor.id, {
          photoNotionBlockId: result.notionBlockId,
          photoUrl: undefined,
        });
      } else {
        updateExhibitor(exhibitor.id, { photoUrl: result.url, photoNotionBlockId: undefined });
      }
      toast('Fotografía actualizada.', 'success');
    } catch (error) {
      toast(`No se pudo subir la foto: ${(error as Error).message}`, 'error');
    } finally {
      setUploading(false);
      if (photoRef.current) photoRef.current.value = '';
    }
  };

  return (
    <>
      <Section
        title="Expositor"
        action={
          <IconButton
            label="Eliminar expositor"
            icon={<Trash2 size={13} />}
            onClick={() => { deleteExhibitor(exhibitor.id); setSelection(null); toast('Expositor eliminado.', 'success'); }}
          />
        }
      >
        {exhibitor.notionMissing ? (
          <div className="settings-status is-error">Esta persona ya no aparece en Notion. Puedes eliminarla o mantenerla manualmente.</div>
        ) : null}
        <Field label="Nombre">
          <TextInput
            value={exhibitor.name}
            onChange={(event) => updateExhibitor(exhibitor.id, { name: event.target.value })}
          />
        </Field>
        <Field label="Código o stand" hint="También se puede leer desde Notion con una línea «Stand: A-01».">
          <TextInput
            value={exhibitor.standCode}
            placeholder="A-01"
            onChange={(event) => updateExhibitor(exhibitor.id, { standCode: event.target.value })}
          />
        </Field>
        <Field label="Descripción">
          <TextArea
            value={exhibitor.description}
            onChange={(event) => updateExhibitor(exhibitor.id, { description: event.target.value })}
          />
        </Field>
        <Field
          label="Color del expositor"
          hint="Se usa en el marcador, en los aros y en la pintura de sus elementos."
        >
          <ColorInput
            value={exhibitor.color ?? DEFAULT_EXHIBITOR_COLOR}
            onChange={(color) => updateExhibitor(exhibitor.id, { color })}
          />
        </Field>
        {exhibitor.notionUrl ? (
          <a className="btn btn-outline btn-sm" href={exhibitor.notionUrl} target="_blank" rel="noreferrer">
            <ArrowUpRight size={13} /> Abrir ficha en Notion
          </a>
        ) : null}
      </Section>

      <Section title="Fotografía">
        {photo ? (
          <img className="inspector-photo" src={photo} alt={exhibitor.name} />
        ) : (
          <div className="inspector-photo-empty"><ImagePlus size={20} /><span>Sin fotografía</span></div>
        )}
        <div className="inline-actions">
          <Button
            size="sm"
            variant="secondary"
            onClick={() => photoRef.current?.click()}
            loading={uploading}
            icon={<ImagePlus size={13} />}
          >
            {photo ? 'Cambiar foto' : 'Subir foto'}
          </Button>
          {photo ? (
            <Button
              size="sm"
              variant="ghost"
              onClick={() => updateExhibitor(exhibitor.id, { photoUrl: undefined, photoNotionBlockId: undefined })}
              icon={<X size={13} />}
            >
              Quitar
            </Button>
          ) : null}
        </div>
        <input
          ref={photoRef}
          type="file"
          accept="image/*"
          hidden
          onChange={(event) => uploadPhoto(event.target.files?.[0])}
        />
      </Section>

      <Section
        title="Posición"
        action={
          <HelpButton title="Posición del expositor">
            <p>
              En la vista 3D también puedes seleccionar el marcador y arrastrar las flechas X/Z para
              moverlo con precisión sobre el piso.
            </p>
          </HelpButton>
        }
      >
        <div className="grid-2">
          <Field label="X">
            <NumberInput
              value={exhibitor.position.x}
              onChange={(x) => updateExhibitor(exhibitor.id, { position: { ...exhibitor.position, x } })}
              step={0.1}
              suffix="m"
            />
          </Field>
          <Field label="Z">
            <NumberInput
              value={exhibitor.position.z}
              onChange={(z) => updateExhibitor(exhibitor.id, { position: { ...exhibitor.position, z } })}
              step={0.1}
              suffix="m"
            />
          </Field>
        </div>
        <Field label="Cámara mira hacia">
          <NumberInput
            value={((exhibitor.rotation * 180) / Math.PI + 360) % 360}
            onChange={(degrees) => {
              const rotation = (degrees * Math.PI) / 180;
              // La cámara de la ficha se recalcula con el rumbo para que el
              // inspector y la llegada del visor no muestren cuadros distintos.
              const camera = headingCameraFor({ ...exhibitor, rotation }, project);
              updateExhibitor(exhibitor.id, {
                rotation,
                rotationCustom: true,
                cameraPosition: camera.position,
                cameraTarget: camera.target,
              });
            }}
            step={5}
            suffix="°"
          />
        </Field>
        <Field label="Distancia de llegada">
          <RangeInput
            label=""
            value={exhibitor.cameraDistance ?? DEFAULT_CAMERA_DISTANCE}
            min={1.5}
            max={10}
            step={0.1}
            format={(value) => `${value.toFixed(1)} m`}
            onChange={(cameraDistance) => {
              // También se actualiza la ficha para que el inspector y el visor
              // muestren el mismo plano.
              const camera = headingCameraFor({ ...exhibitor, cameraDistance }, project);
              updateExhibitor(exhibitor.id, {
                cameraDistance,
                // La distancia se mueve sobre la línea actual de la ficha (la
                // que el editor ve en el 3D): rumbo fijo y sólo se aleja/acerca.
                rotation: Math.atan2(
                  exhibitor.position.x - camera.position[0],
                  exhibitor.position.z - camera.position[2],
                ),
                rotationCustom: true,
                cameraPosition: camera.position,
                cameraTarget: camera.target,
              });
            }}
          />
        </Field>
        <Field label="Ajustar con el manipulador 3D">
          <div className="inline-actions">
            <Button
              size="sm"
              variant={transformMode === 'translate' ? 'primary' : 'outline'}
              onClick={() => setTransformMode('translate')}
            >
              Mover (G)
            </Button>
            <Button
              size="sm"
              variant={transformMode === 'rotate' ? 'primary' : 'outline'}
              onClick={() => setTransformMode('rotate')}
            >
              Rotar cámara (R)
            </Button>
          </div>
        </Field>
        <Field label="Origen del rumbo">
          <div className="inline-actions">
            <Button
              size="sm"
              variant={exhibitor.rotationCustom ? 'outline' : 'primary'}
              title="La cámara llega desde la dirección libre del plano."
              onClick={() => updateExhibitor(exhibitor.id, { rotationCustom: false })}
            >
              Automático
            </Button>
            <Button
              size="sm"
              variant={exhibitor.rotationCustom ? 'primary' : 'outline'}
              title="Rumbo elegido a mano con el manipulador."
              onClick={() => updateExhibitor(exhibitor.id, { rotationCustom: true })}
            >
              Manual
            </Button>
            <Button
              size="sm"
              variant="outline"
              onClick={() => {
                // El expositor mira hacia donde está la cámara del editor ahora
                // mismo: la cámara de llegada queda en esa misma línea.
                const camera = useEditorStore.getState().editorCameraView;
                const rotation = Math.atan2(
                  camera.position[0] - exhibitor.position.x,
                  camera.position[2] - exhibitor.position.z,
                );
                const arrival = headingCameraFor({ ...exhibitor, rotation }, project);
                updateExhibitor(exhibitor.id, {
                  rotation,
                  rotationCustom: true,
                  cameraPosition: arrival.position,
                  cameraTarget: arrival.target,
                });
                toast('Rumbo de cámara fijado desde el editor.', 'success');
              }}
            >
              Fijar desde la cámara
            </Button>
          </div>
        </Field>
        <p className="panel-note">
          «Automático» deja que el visor calcule desde qué lado llega la cámara
          sin chocar con muros; «Manual» usa la flecha que pusiste. El ángulo
          dice desde dónde llega la cámara, no hacia dónde mira. «Distancia de
          llegada» aleja o acerca la cámara al expositor: más metros, plano más
          abierto.
        </p>
        <Field label="Nivel">
          <Select
            value={exhibitor.levelId ?? level?.id ?? ''}
            onChange={(event) =>
              updateExhibitor(exhibitor.id, { levelId: event.target.value || null })
            }
          >
            {project.levels.map((entry) => (
              <option key={entry.id} value={entry.id}>
                {entry.name} · {entry.elevation.toFixed(2)} m
              </option>
            ))}
          </Select>
        </Field>
        <Switch
          checked={exhibitor.moveRelated}
          onChange={(moveRelated) => updateExhibitor(exhibitor.id, { moveRelated })}
          label="Mover con sus elementos"
          hint={
            exhibitor.moveRelated
              ? 'Activo: el expositor va agrupado con sus objetos y muros asociados.'
              : 'Inactivo: solo se mueve el marcador, el montaje se queda donde está.'
          }
        />
      </Section>

      <Section title="Cámara del punto de interés">
        <Field label="Posición de cámara">
          <AxisInput
            value={exhibitor.cameraPosition}
            step={0.25}
            onChange={(cameraPosition) => updateExhibitor(exhibitor.id, { cameraPosition })}
          />
        </Field>
        <Field label="Objetivo de cámara">
          <AxisInput
            value={exhibitor.cameraTarget}
            step={0.25}
            onChange={(cameraTarget) => updateExhibitor(exhibitor.id, { cameraTarget })}
          />
        </Field>
        <Button
          size="sm"
          variant="outline"
          icon={<Camera size={13} />}
          onClick={() => {
            const camera = defaultExhibitorCamera(
              exhibitor.position,
              levelVertices(level),
              level?.elevation ?? 0,
            );
            updateExhibitor(exhibitor.id, {
              cameraPosition: camera.position,
              cameraTarget: camera.target,
            });
          }}
        >
          Vista sugerida
        </Button>
      </Section>

      <Section title={`Objetos asociados (${exhibitor.relatedObjectIds.length})`}>
        <div className="related-list">
          {project.objects.map((object) => {
            const checked = object.exhibitorId === exhibitor.id || exhibitor.relatedObjectIds.includes(object.id);
            return (
              <label className="check-row" key={object.id}>
                <input
                  type="checkbox"
                  checked={checked}
                  onChange={(event) => assignObjectToExhibitor(object.id, event.target.checked ? exhibitor.id : null)}
                />
                <span>{object.name}</span>
              </label>
            );
          })}
          {project.objects.length === 0 ? <p className="panel-note">Aún no hay objetos en la escena.</p> : null}
        </div>
      </Section>

      <Section
        title={`Muros y aberturas asociados (${associatedWallCount + associatedOpeningCount})`}
        action={
          <HelpButton title="Muros y aberturas asociados">
            <p>
              Los elementos asociados adoptan el color del expositor en el visor. También puedes
              asignarlos desde el inspector de cada muro o abertura.
            </p>
          </HelpButton>
        }
      >
        <div className="related-list">
          {level?.spaces.map((space) =>
            space.edges.map((edge, index) => (
              <label className="check-row" key={edge.id}>
                <input
                  type="checkbox"
                  checked={edge.exhibitorId === exhibitor.id}
                  onChange={(event) => {
                    activateForEdge(space);
                    setEdge(index, {
                      exhibitorId: event.target.checked ? exhibitor.id : null,
                    });
                  }}
                />
                <span>
                  {space.name} · Segmento {index + 1}
                  {edge.wall ? '' : ' · acceso'}
                </span>
              </label>
            )),
          )}
          {level?.internalWalls.map((wall, index) => (
            <label className="check-row" key={wall.id}>
              <input
                type="checkbox"
                checked={wall.exhibitorId === exhibitor.id}
                onChange={(event) => {
                  if (level) setActiveLevel(level.id);
                  updateInternalWall(wall.id, {
                    exhibitorId: event.target.checked ? exhibitor.id : null,
                  });
                }}
              />
              <span>Muro libre {index + 1}</span>
            </label>
          ))}
          {level?.openings.map((opening, index) => (
            <label className="check-row" key={opening.id}>
              <input
                type="checkbox"
                checked={opening.exhibitorId === exhibitor.id}
                onChange={(event) =>
                  updateOpening(opening.id, {
                    exhibitorId: event.target.checked ? exhibitor.id : null,
                  })
                }
              />
              <span>
                {opening.kind === 'door' ? 'Puerta' : 'Ventana'} {index + 1} ·{' '}
                {wallKindLabel(opening.wallId)}
              </span>
            </label>
          ))}
        </div>
      </Section>

      {Object.keys(exhibitor.metadata).length ? (
        <Section title="Datos de Notion">
          <div className="prop-list">
            {Object.entries(exhibitor.metadata).map(([key, value]) => (
              <div className="prop-row" key={key}><span>{key}</span><strong>{value}</strong></div>
            ))}
          </div>
        </Section>
      ) : null}
    </>
  );
}

function LightInspector({ light }: { light: LightConfig }) {
  const updateLight = useEditorStore((state) => state.updateLight);
  const deleteLight = useEditorStore((state) => state.deleteLight);
  const setSelection = useEditorStore((state) => state.setSelection);
  const toast = useUiStore((state) => state.toast);
  const labels: Record<LightConfig['type'], string> = {
    ambient: 'Ambiental',
    hemisphere: 'Hemisférica',
    directional: 'Direccional',
    point: 'Puntual',
    spot: 'Foco',
  };

  return (
    <>
      <Section
        title="Luz"
        action={
          <IconButton
            label="Eliminar luz"
            icon={<Trash2 size={13} />}
            onClick={() => { deleteLight(light.id); setSelection(null); toast('Luz eliminada.', 'success'); }}
          />
        }
      >
        <div className="row-between">
          <Badge tone="warning">{labels[light.type]}</Badge>
          <Switch
            checked={light.enabled}
            onChange={(enabled) => updateLight(light.id, { enabled })}
            label="Activa"
          />
        </div>
        <Field label="Nombre">
          <TextInput
            value={light.name}
            onChange={(event) => updateLight(light.id, { name: event.target.value })}
          />
        </Field>
        <Field label="Color">
          <ColorInput value={light.color} onChange={(color) => updateLight(light.id, { color })} />
        </Field>
        <RangeInput
          label="Intensidad"
          value={light.intensity}
          onChange={(intensity) => updateLight(light.id, { intensity })}
          min={0}
          max={12}
          step={0.05}
          format={(value) => value.toFixed(2)}
        />
      </Section>

      <Section title="Posición y dirección">
        <Field label="Posición">
          <AxisInput
            value={light.position}
            step={0.25}
            onChange={(position) => updateLight(light.id, { position })}
          />
        </Field>
        {light.type === 'directional' || light.type === 'spot' ? (
          <Field label="Objetivo">
            <AxisInput
              value={light.target}
              step={0.25}
              onChange={(target) => updateLight(light.id, { target })}
            />
          </Field>
        ) : null}
        {light.type === 'point' || light.type === 'spot' ? (
          <Field label="Alcance">
            <NumberInput
              value={light.distance ?? 18}
              onChange={(distance) => updateLight(light.id, { distance })}
              step={1}
              min={0}
              suffix="m"
            />
          </Field>
        ) : null}
        {light.type === 'spot' ? (
          <>
            <RangeInput
              label="Ángulo"
              value={((light.angle ?? Math.PI / 5) * 180) / Math.PI}
              onChange={(degrees) => updateLight(light.id, { angle: (degrees * Math.PI) / 180 })}
              min={2}
              max={89}
              step={1}
              format={(value) => `${value.toFixed(0)}°`}
            />
            <RangeInput
              label="Penumbra"
              value={light.penumbra ?? 0.4}
              onChange={(penumbra) => updateLight(light.id, { penumbra })}
              min={0}
              max={1}
              step={0.01}
              format={(value) => value.toFixed(2)}
            />
          </>
        ) : null}
        <Switch
          checked={light.castShadow}
          onChange={(castShadow) => updateLight(light.id, { castShadow })}
          label="Proyectar sombras"
          hint="Usar con moderación para mantener el rendimiento."
        />
      </Section>
    </>
  );
}

function VertexInspector({
  project,
  index,
  spaceId,
}: {
  project: Project;
  index: number;
  spaceId?: string;
}) {
  const moveVertex = useEditorStore((state) => state.moveVertex);
  const removeVertex = useEditorStore((state) => state.removeVertex);
  const insertVertexOnEdge = useEditorStore((state) => state.insertVertexOnEdge);
  const setSelection = useEditorStore((state) => state.setSelection);
  const activeLevelId = useEditorStore((state) => state.activeLevelId);
  const activeSpaceId = useEditorStore((state) => state.activeSpaceId);
  const level = getLevel(project, activeLevelId);
  const space = getSpace(level, spaceId ?? activeSpaceId);
  const vertices = space?.vertices ?? [];
  const vertex = vertices[index];
  if (!vertex) return null;
  const next = vertices[(index + 1) % vertices.length];
  const spaceKey = space?.id ?? 'space';

  return (
    <Section title={`Vértice ${index + 1}`}>
      <div className="prop-list">
        <div className="prop-row"><span>Nivel</span><strong>{level?.name ?? '—'}</strong></div>
        <div className="prop-row"><span>Espacio</span><strong>{space?.name ?? '—'}</strong></div>
      </div>
      <div className="grid-2">
        <Field label="X">
          <NumberInput value={vertex.x} onChange={(x) => moveVertex(index, { ...vertex, x }, { coalesceKey: `vertex-x:${spaceKey}:${index}` })} step={0.1} suffix="m" />
        </Field>
        <Field label="Z">
          <NumberInput value={vertex.z} onChange={(z) => moveVertex(index, { ...vertex, z }, { coalesceKey: `vertex-z:${spaceKey}:${index}` })} step={0.1} suffix="m" />
        </Field>
      </div>
      <div className="prop-list">
        <div className="prop-row"><span>Borde siguiente</span><strong>{formatMeters(edgeLength(vertices, index), 2)}</strong></div>
        <div className="prop-row"><span>Borde anterior</span><strong>{formatMeters(edgeLength(vertices, (index - 1 + vertices.length) % vertices.length), 2)}</strong></div>
      </div>
      <div className="inline-actions">
        <Button
          size="sm"
          variant="outline"
          onClick={() => {
            if (!next) return;
            insertVertexOnEdge(index, { x: (vertex.x + next.x) / 2, z: (vertex.z + next.z) / 2 });
          }}
        >
          Insertar después
        </Button>
        <Button
          size="sm"
          variant="danger"
          disabled={vertices.length <= 3}
          onClick={() => { removeVertex(index); setSelection(null); }}
          icon={<Trash2 size={13} />}
        >
          Eliminar
        </Button>
      </div>
    </Section>
  );
}

function EdgeInspector({
  project,
  index,
  spaceId,
}: {
  project: Project;
  index: number;
  spaceId?: string;
}) {
  const setEdge = useEditorStore((state) => state.setEdge);
  const toggleWall = useEditorStore((state) => state.toggleWall);
  const insertVertexOnEdge = useEditorStore((state) => state.insertVertexOnEdge);
  const patchProject = useEditorStore((state) => state.patchProject);
  const addOpening = useEditorStore((state) => state.addOpening);
  const setSelection = useEditorStore((state) => state.setSelection);
  const activeLevelId = useEditorStore((state) => state.activeLevelId);
  const activeSpaceId = useEditorStore((state) => state.activeSpaceId);
  const toast = useUiStore((state) => state.toast);
  const level = getLevel(project, activeLevelId);
  const space = getSpace(level, spaceId ?? activeSpaceId);
  const vertices = space?.vertices ?? [];
  const edge = space?.edges[index];
  const a = vertices[index];
  const b = vertices[(index + 1) % vertices.length];
  if (!edge || !a || !b) return null;
  const length = wallLength(a, b);
  const openings = (level?.openings ?? []).filter((opening) => opening.wallId === edge.id);
  const spaceKey = space?.id ?? 'space';

  const applyToAll = () => {
    patchProject((draft) => {
      const target = draft.levels.find((entry) => entry.id === level?.id) ?? draft.levels[0];
      if (!target) return;
      target.spaces = target.spaces.map((entry) => ({
        ...entry,
        edges: entry.edges.map((value) => ({
          ...value,
          height: edge.height,
          thickness: edge.thickness,
          color: edge.color,
        })),
      }));
      target.internalWalls = target.internalWalls.map((entry) => ({
        ...entry,
        height: edge.height,
        thickness: edge.thickness,
        color: edge.color,
      }));
    });
    toast('Estilo aplicado a los muros del nivel activo.', 'success');
  };

  return (
    <Section title={`Segmento ${index + 1}`}>
      <div className="prop-list">
        <div className="prop-row"><span>Nivel</span><strong>{level?.name ?? '—'}</strong></div>
        <div className="prop-row"><span>Espacio</span><strong>{space?.name ?? '—'}</strong></div>
        <div className="prop-row"><span>Longitud</span><strong>{formatMeters(edgeLength(vertices, index), 2)}</strong></div>
        <div className="prop-row"><span>Desde</span><strong>{a.x.toFixed(2)}, {a.z.toFixed(2)}</strong></div>
        <div className="prop-row"><span>Hasta</span><strong>{b.x.toFixed(2)}, {b.z.toFixed(2)}</strong></div>
      </div>
      <Switch
        checked={edge.wall}
        onChange={() => toggleWall(index)}
        label="Muro"
        hint={edge.wall ? 'Segmento cerrado.' : 'Segmento abierto: funciona como acceso.'}
      />
      <div className="grid-2">
        <Field label="Altura">
          <NumberInput value={edge.height} onChange={(height) => setEdge(index, { height: Math.max(0.05, height) }, { coalesceKey: `edge-h:${index}` })} step={0.1} suffix="m" />
        </Field>
        <Field label="Grosor">
          <NumberInput value={edge.thickness} onChange={(thickness) => setEdge(index, { thickness: Math.max(0.02, thickness) }, { coalesceKey: `edge-t:${index}` })} step={0.01} suffix="m" />
        </Field>
      </div>
      <Field label="Color">
        <ColorInput value={edge.color} onChange={(color) => setEdge(index, { color }, { coalesceKey: `edge-c:${index}` })} />
      </Field>
      <Field label="Expositor asociado">
        <ExhibitorSelect
          project={project}
          value={edge.exhibitorId}
          onChange={(exhibitorId) => setEdge(index, { exhibitorId })}
        />
      </Field>
      {edge.wall ? (
        <>
          <div className="inline-actions">
            <Button
              size="sm"
              variant="outline"
              icon={<DoorOpen size={13} />}
              onClick={() => addOpening(edge.id, 'door', length / 2)}
            >
              Añadir puerta
            </Button>
            <Button
              size="sm"
              variant="outline"
              icon={<PanelTop size={13} />}
              onClick={() => addOpening(edge.id, 'window', length / 2)}
            >
              Añadir ventana
            </Button>
          </div>
          {openings.length ? (
            <div className="prop-list">
              {openings.map((opening) => (
                <div className="prop-row" key={opening.id}>
                  <span>{opening.kind === 'door' ? 'Puerta' : 'Ventana'} · {formatMeters(opening.width, 2)}</span>
                  <Button
                    size="sm"
                    variant="ghost"
                    onClick={() => setSelection({ type: 'opening', id: opening.id })}
                  >
                    Editar
                  </Button>
                </div>
              ))}
            </div>
          ) : null}
        </>
      ) : (
        <p className="panel-note">Activa el muro para poder añadir puertas o ventanas.</p>
      )}
      <div className="inline-actions">
        <Button
          size="sm"
          variant="outline"
          onClick={() => insertVertexOnEdge(index, { x: (a.x + b.x) / 2, z: (a.z + b.z) / 2 })}
        >
          Insertar vértice
        </Button>
        <Button size="sm" variant="ghost" onClick={applyToAll}>Aplicar a todos</Button>
      </div>
    </Section>
  );
}

function InternalWallInspector({
  project,
  wall,
}: {
  project: Project;
  wall: InternalWall;
}) {
  const updateInternalWall = useEditorStore((state) => state.updateInternalWall);
  const insertVertexOnInternalWall = useEditorStore((state) => state.insertVertexOnInternalWall);
  const deleteInternalWall = useEditorStore((state) => state.deleteInternalWall);
  const addOpening = useEditorStore((state) => state.addOpening);
  const setSelection = useEditorStore((state) => state.setSelection);
  const activeLevelId = useEditorStore((state) => state.activeLevelId);
  const toast = useUiStore((state) => state.toast);
  const level = getLevel(project, activeLevelId);
  const length = wallLength(wall.a, wall.b);
  const openings = (level?.openings ?? []).filter((opening) => opening.wallId === wall.id);
  const updatePoint = (key: 'a' | 'b', axis: 'x' | 'z', value: number) =>
    updateInternalWall(
      wall.id,
      { [key]: { ...wall[key], [axis]: value } },
      { coalesceKey: `wall-point:${wall.id}:${key}:${axis}` },
    );

  return (
    <Section
      title="Muro libre"
      action={
        <div className="panel-title-actions">
          <HelpButton title="Muro libre">
            <p>
              Los muros libres dividen el espacio sin modificar el contorno de la planta.
            </p>
            <p>
              En 2D puedes arrastrar sus nodos o hacer doble clic para insertar uno; en 3D,
              selecciona el muro y arrastra los tiradores de sus extremos.
            </p>
          </HelpButton>
          <IconButton
            label="Eliminar muro libre"
            icon={<Trash2 size={13} />}
            onClick={() => {
              deleteInternalWall(wall.id);
              setSelection(null);
              toast('Muro libre eliminado.', 'success');
            }}
          />
        </div>
      }
    >
      <div className="prop-list">
        <div className="prop-row"><span>Longitud</span><strong>{formatMeters(length, 2)}</strong></div>
        <div className="prop-row"><span>Aberturas</span><strong>{openings.length}</strong></div>
      </div>
      <div className="grid-2">
        <Field label="Inicio X">
          <NumberInput value={wall.a.x} onChange={(value) => updatePoint('a', 'x', value)} step={0.1} suffix="m" />
        </Field>
        <Field label="Inicio Z">
          <NumberInput value={wall.a.z} onChange={(value) => updatePoint('a', 'z', value)} step={0.1} suffix="m" />
        </Field>
        <Field label="Fin X">
          <NumberInput value={wall.b.x} onChange={(value) => updatePoint('b', 'x', value)} step={0.1} suffix="m" />
        </Field>
        <Field label="Fin Z">
          <NumberInput value={wall.b.z} onChange={(value) => updatePoint('b', 'z', value)} step={0.1} suffix="m" />
        </Field>
      </div>
      <div className="grid-2">
        <Field label="Altura">
          <NumberInput
            value={wall.height}
            onChange={(height) => updateInternalWall(wall.id, { height: Math.max(0.05, height) })}
            step={0.1}
            suffix="m"
          />
        </Field>
        <Field label="Grosor">
          <NumberInput
            value={wall.thickness}
            onChange={(thickness) => updateInternalWall(wall.id, { thickness: Math.max(0.02, thickness) })}
            step={0.01}
            suffix="m"
          />
        </Field>
      </div>
      <Field label="Color">
        <ColorInput
          value={wall.color}
          onChange={(color) => updateInternalWall(wall.id, { color }, { coalesceKey: `wall-color:${wall.id}` })}
        />
      </Field>
      <Field label="Expositor asociado">
        <ExhibitorSelect
          project={project}
          value={wall.exhibitorId}
          onChange={(exhibitorId) => updateInternalWall(wall.id, { exhibitorId })}
        />
      </Field>
      <div className="inline-actions">
        <Button
          size="sm"
          variant="outline"
          icon={<DoorOpen size={13} />}
          onClick={() => addOpening(wall.id, 'door', length / 2)}
        >
          Añadir puerta
        </Button>
        <Button
          size="sm"
          variant="outline"
          icon={<PanelTop size={13} />}
          onClick={() => addOpening(wall.id, 'window', length / 2)}
        >
          Añadir ventana
        </Button>
        <Button
          size="sm"
          variant="ghost"
          onClick={() => {
            insertVertexOnInternalWall(wall.id, {
              x: (wall.a.x + wall.b.x) / 2,
              z: (wall.a.z + wall.b.z) / 2,
            });
            toast('Nodo insertado en el muro libre.', 'success');
          }}
        >
          Insertar nodo
        </Button>
      </div>
      {openings.length ? (
        <div className="prop-list">
          {openings.map((opening) => (
            <div className="prop-row" key={opening.id}>
              <span>{opening.kind === 'door' ? 'Puerta' : 'Ventana'} · {formatMeters(opening.width, 2)}</span>
              <Button size="sm" variant="ghost" onClick={() => setSelection({ type: 'opening', id: opening.id })}>
                Editar
              </Button>
            </div>
          ))}
        </div>
      ) : null}
    </Section>
  );
}

function OpeningInspector({
  project,
  opening,
}: {
  project: Project;
  opening: WallOpening;
}) {
  const updateOpening = useEditorStore((state) => state.updateOpening);
  const deleteOpening = useEditorStore((state) => state.deleteOpening);
  const setSelection = useEditorStore((state) => state.setSelection);
  const toast = useUiStore((state) => state.toast);
  const found = findWallInProject(project, opening.wallId);
  const wall = found?.wall;
  const length = wall ? wallLength(wall.a, wall.b) : 0;
  const isDoor = opening.kind === 'door';

  return (
    <Section
      title={isDoor ? 'Puerta' : 'Ventana'}
      action={
        <div className="panel-title-actions">
          <HelpButton title="Aberturas">
            <p>
              La abertura se recorta en el muro y se mantiene al mover o cambiar el grosor del muro.
            </p>
            <p>
              En 3D puedes seleccionarla y arrastrar sus tiradores para moverla, cambiar su ancho o
              su altura.
            </p>
          </HelpButton>
          <IconButton
            label="Eliminar abertura"
            icon={<Trash2 size={13} />}
            onClick={() => {
              deleteOpening(opening.id);
              setSelection(null);
              toast('Abertura eliminada.', 'success');
            }}
          />
        </div>
      }
    >
      <div className="prop-list">
        <div className="prop-row">
          <span>Muro</span>
          <strong>{wall?.internalWall ? 'Muro libre' : 'Muro perimetral'}</strong>
        </div>
        <div className="prop-row"><span>Longitud del muro</span><strong>{formatMeters(length, 2)}</strong></div>
      </div>
      <Field label="Tipo">
        <Select
          value={opening.kind}
          onChange={(event) => {
            const kind = event.target.value as 'door' | 'window';
            updateOpening(opening.id, {
              kind,
              ...(kind === 'window' ? { sillHeight: opening.sillHeight || 1 } : { sillHeight: 0 }),
            });
          }}
        >
          <option value="door">Puerta</option>
          <option value="window">Ventana</option>
        </Select>
      </Field>
      <Field label="Posición desde el inicio">
        <NumberInput
          value={opening.offset}
          onChange={(offset) => updateOpening(
            opening.id,
            { offset: Math.max(opening.width / 2, Math.min(length - opening.width / 2, offset)) },
            { coalesceKey: `opening-offset:${opening.id}` },
          )}
          step={0.05}
          min={0}
          max={Math.max(length, 0.2)}
          suffix="m"
        />
      </Field>
      <div className="grid-2">
        <Field label="Ancho">
          <NumberInput
            value={opening.width}
            onChange={(width) => updateOpening(opening.id, { width: Math.max(0.2, width) })}
            step={0.05}
            min={0.2}
            suffix="m"
          />
        </Field>
        <Field label="Alto">
          <NumberInput
            value={opening.height}
            onChange={(height) => updateOpening(opening.id, { height: Math.max(0.2, height) })}
            step={0.05}
            min={0.2}
            suffix="m"
          />
        </Field>
      </div>
      {!isDoor ? (
        <Field label="Altura del alféizar">
          <NumberInput
            value={opening.sillHeight}
            onChange={(sillHeight) => updateOpening(opening.id, { sillHeight: Math.max(0, sillHeight) })}
            step={0.05}
            min={0}
            suffix="m"
          />
        </Field>
      ) : null}
      <Field label="Expositor asociado">
        <ExhibitorSelect
          project={project}
          value={opening.exhibitorId}
          onChange={(exhibitorId) => updateOpening(opening.id, { exhibitorId })}
        />
      </Field>
      <div className="inline-actions">
        <Button
          size="sm"
          variant="outline"
          onClick={() => updateOpening(opening.id, { offset: length / 2 })}
        >
          Centrar en el muro
        </Button>
      </div>
    </Section>
  );
}

function StairInspector({ project, stair }: { project: Project; stair: Stair }) {
  const updateStair = useEditorStore((state) => state.updateStair);
  const deleteStair = useEditorStore((state) => state.deleteStair);
  const setSelection = useEditorStore((state) => state.setSelection);
  const toast = useUiStore((state) => state.toast);
  const level = project.levels.find((entry) => entry.stairs.some((item) => item.id === stair.id));
  const metrics = stairMetrics(stair);
  const totalRun =
    stair.kind === 'straight'
      ? stair.steps * stair.tread
      : metrics.run1 + metrics.landingDepth + metrics.run2;
  const risky = metrics.risePerStep < 0.12 || metrics.risePerStep > 0.22 || stair.tread < 0.2;

  return (
    <Section
      title="Escalera"
      action={
        <IconButton
          label="Eliminar escalera"
          icon={<Trash2 size={13} />}
          onClick={() => {
            deleteStair(stair.id);
            setSelection(null);
            toast('Escalera eliminada.', 'success');
          }}
        />
      }
    >
      <div className="prop-list">
        <div className="prop-row"><span>Nivel</span><strong>{level?.name ?? '—'}</strong></div>
        <div className="prop-row"><span>Altura por peldaño</span><strong>{formatMeters(metrics.risePerStep, 3)}</strong></div>
        <div className="prop-row"><span>Longitud total</span><strong>{formatMeters(totalRun, 2)}</strong></div>
      </div>
      {risky ? (
        <div className="settings-status is-error">
          Revisa la comodidad: se recomienda una contrahuella de 12–22 cm y una huella ≥ 20 cm.
        </div>
      ) : null}
      <Field label="Nombre">
        <TextInput
          value={stair.name}
          onChange={(event) => updateStair(stair.id, { name: event.target.value })}
        />
      </Field>
      <div className="grid-2">
        <Field label="Tipo">
          <Select
            value={stair.kind}
            onChange={(event) =>
              updateStair(stair.id, { kind: event.target.value as Stair['kind'] })
            }
          >
            <option value="straight">Recta</option>
            <option value="l">En L</option>
            <option value="u">En U</option>
          </Select>
        </Field>
        <Field label="Sentido">
          <Select
            value={stair.direction}
            onChange={(event) =>
              updateStair(stair.id, { direction: event.target.value as Stair['direction'] })
            }
          >
            <option value="up">Sube</option>
            <option value="down">Baja</option>
          </Select>
        </Field>
      </div>
      <div className="grid-2">
        <Field label="Peldaños">
          <NumberInput
            value={stair.steps}
            onChange={(value) => updateStair(stair.id, { steps: Math.round(Math.max(2, value)) })}
            step={1}
            min={2}
            max={80}
          />
        </Field>
        <Field label="Altura total">
          <NumberInput
            value={stair.rise}
            onChange={(rise) => updateStair(stair.id, { rise: Math.max(0.2, rise) })}
            step={0.05}
            min={0.2}
            suffix="m"
          />
        </Field>
      </div>
      <div className="grid-2">
        <Field label="Ancho">
          <NumberInput
            value={stair.width}
            onChange={(width) => updateStair(stair.id, { width: Math.max(0.4, width) })}
            step={0.05}
            min={0.4}
            suffix="m"
          />
        </Field>
        <Field label="Huella">
          <NumberInput
            value={stair.tread}
            onChange={(tread) => updateStair(stair.id, { tread: Math.max(0.1, tread) })}
            step={0.01}
            min={0.1}
            suffix="m"
          />
        </Field>
      </div>
      {stair.kind !== 'straight' ? (
        <Field label="Descansillo">
          <NumberInput
            value={stair.landingDepth}
            onChange={(value) => updateStair(stair.id, { landingDepth: Math.max(0.2, value) })}
            step={0.05}
            min={0.2}
            suffix="m"
          />
        </Field>
      ) : null}
      <div className="grid-2">
        <Field label="Posición X">
          <NumberInput
            value={stair.position.x}
            onChange={(x) => updateStair(stair.id, { position: { ...stair.position, x } })}
            step={0.1}
            suffix="m"
          />
        </Field>
        <Field label="Posición Z">
          <NumberInput
            value={stair.position.z}
            onChange={(z) => updateStair(stair.id, { position: { ...stair.position, z } })}
            step={0.1}
            suffix="m"
          />
        </Field>
      </div>
      <Field label="Orientación">
        <NumberInput
          value={(stair.rotation * 180) / Math.PI}
          onChange={(degrees) => updateStair(stair.id, { rotation: (degrees * Math.PI) / 180 })}
          step={15}
          suffix="°"
        />
      </Field>
      <Switch
        checked={stair.railing}
        onChange={(railing) => updateStair(stair.id, { railing })}
        label="Barandilla"
      />
      <Field label="Color">
        <ColorInput
          value={stair.color}
          onChange={(color) => updateStair(stair.id, { color })}
        />
      </Field>
      <Switch
        checked={stair.visible}
        onChange={(visible) => updateStair(stair.id, { visible })}
        label="Visible"
      />
    </Section>
  );
}

function LevelInspector({ project, level }: { project: Project; level: Level }) {
  const updateLevel = useEditorStore((state) => state.updateLevel);
  const deleteLevel = useEditorStore((state) => state.deleteLevel);
  const duplicateLevel = useEditorStore((state) => state.duplicateLevel);
  const setSelection = useEditorStore((state) => state.setSelection);
  const setLevelGizmo = useEditorStore((state) => state.setLevelGizmo);
  const levelGizmoId = useEditorStore((state) => state.levelGizmoId);
  const levelGizmoMode = useEditorStore((state) => state.levelGizmoMode);
  const rotateLevelTo = useEditorStore((state) => state.rotateLevelTo);
  const centerLevelAt = useEditorStore((state) => state.centerLevelAt);
  const setView = useEditorStore((state) => state.setView);
  const toast = useUiStore((state) => state.toast);
  const area = level.spaces.reduce((total, space) => total + polygonArea(space.vertices), 0);
  const gizmoActive = levelGizmoId === level.id;
  const pivot = levelPivot(level);
  const degrees = (level.rotation * 180) / Math.PI;

  return (
    <Section title="Nivel">
      <Field label="Nombre">
        <TextInput
          value={level.name}
          onChange={(event) => updateLevel(level.id, { name: event.target.value })}
        />
      </Field>
      <Field label="Elevación" hint="Altura del suelo del nivel respecto a la planta baja.">
        <NumberInput
          value={level.elevation}
          onChange={(elevation) => updateLevel(level.id, { elevation })}
          step={0.1}
          suffix="m"
        />
      </Field>
      <div className="prop-list">
        <div className="prop-row"><span>Espacios</span><strong>{level.spaces.length}</strong></div>
        <div className="prop-row"><span>Escaleras</span><strong>{level.stairs.length}</strong></div>
        <div className="prop-row"><span>Área</span><strong>{formatArea(area)}</strong></div>
      </div>
      <Switch
        checked={level.visible}
        onChange={(visible) => updateLevel(level.id, { visible })}
        label="Visible en 3D"
      />
      <div className="panel-title">
        <span><Move size={12} /> Piso completo</span>
      </div>
      <p className="panel-note">
        Mueve o gira el nivel con todo lo que tiene encima para colocarlo sobre otro piso.
        Se hace con el gizmo de la vista 3D o arrastrando el centro en la planta.
      </p>
      <LevelReadout level={level} />
      <Field
        label="Giro"
        hint="Ángulo absoluto del piso. Escribe un valor para corregirlo de una vez."
      >
        <CommitNumberInput
          value={degrees}
          onCommit={(value) => rotateLevelTo(level.id, (value * Math.PI) / 180)}
          step={1}
          decimals={2}
          suffix="°"
        />
      </Field>
      <Field label="Centro X" hint="Posición del centro del piso en planta.">
        <CommitNumberInput
          value={pivot.x}
          onCommit={(x) => centerLevelAt(level.id, { x, z: pivot.z })}
          step={0.1}
          decimals={3}
          suffix="m"
        />
      </Field>
      <Field label="Centro Z">
        <CommitNumberInput
          value={pivot.z}
          onCommit={(z) => centerLevelAt(level.id, { x: pivot.x, z })}
          step={0.1}
          decimals={3}
          suffix="m"
        />
      </Field>
      <div className="inline-actions">
        <Button
          size="sm"
          variant="ghost"
          icon={<RotateCcw size={13} />}
          onClick={() => {
            rotateLevelTo(level.id, 0);
            toast('Giro del piso restablecido.', 'success');
          }}
        >
          Resetear giro
        </Button>
        <Button
          size="sm"
          variant="ghost"
          icon={<MapPin size={13} />}
          onClick={() => {
            centerLevelAt(level.id, { x: 0, z: 0 });
            toast('Piso centrado en el origen.', 'success');
          }}
        >
          Centrar
        </Button>
      </div>
      <div className="inline-actions">
        <Button
          size="sm"
          variant={gizmoActive && levelGizmoMode === 'translate' ? 'primary' : 'outline'}
          icon={<Move size={13} />}
          onClick={() => {
            setView('3d');
            setLevelGizmo(gizmoActive && levelGizmoMode === 'translate' ? null : level.id, 'translate');
          }}
        >
          Mover
        </Button>
        <Button
          size="sm"
          variant={gizmoActive && levelGizmoMode === 'rotate' ? 'primary' : 'outline'}
          icon={<RotateCw size={13} />}
          onClick={() => {
            setView('3d');
            setLevelGizmo(gizmoActive && levelGizmoMode === 'rotate' ? null : level.id, 'rotate');
          }}
        >
          Girar
        </Button>
      </div>
      <div className="inline-actions">
        <Button
          size="sm"
          variant="outline"
          icon={<CopyPlus size={13} />}
          onClick={() => {
            const id = duplicateLevel(level.id, { placement: 'same' });
            if (id) toast('Nivel duplicado al lado, a la misma elevación.', 'success');
          }}
        >
          Duplicar al lado
        </Button>
        <Button
          size="sm"
          variant="outline"
          icon={<MoveUp size={13} />}
          onClick={() => {
            const id = duplicateLevel(level.id, { placement: 'above' });
            if (id) toast('Nivel duplicado en un nivel superior.', 'success');
          }}
        >
          Arriba
        </Button>
        <Button
          size="sm"
          variant="outline"
          icon={<MoveDown size={13} />}
          onClick={() => {
            const id = duplicateLevel(level.id, { placement: 'below' });
            if (id) toast('Nivel duplicado en un nivel inferior.', 'success');
          }}
        >
          Abajo
        </Button>
      </div>
      <div className="inline-actions">
        <Button
          size="sm"
          variant="danger"
          icon={<Trash2 size={13} />}
          disabled={project.levels.length <= 1}
          onClick={() => {
            deleteLevel(level.id);
            setSelection(null);
            toast('Nivel eliminado.', 'success');
          }}
        >
          Eliminar
        </Button>
      </div>
    </Section>
  );
}

function SpaceInspector({ project, space }: { project: Project; space: Space }) {
  const updateSpace = useEditorStore((state) => state.updateSpace);
  const deleteSpace = useEditorStore((state) => state.deleteSpace);
  const setSelection = useEditorStore((state) => state.setSelection);
  const toast = useUiStore((state) => state.toast);
  const level = project.levels.find((entry) => entry.spaces.some((item) => item.id === space.id));

  return (
    <Section
      title="Espacio"
      action={
        <IconButton
          label="Eliminar espacio"
          icon={<Trash2 size={13} />}
          disabled={(level?.spaces.length ?? 0) <= 1}
          onClick={() => {
            deleteSpace(space.id);
            setSelection(null);
            toast('Espacio eliminado.', 'success');
          }}
        />
      }
    >
      <div className="prop-list">
        <div className="prop-row"><span>Nivel</span><strong>{level?.name ?? '—'}</strong></div>
        <div className="prop-row"><span>Área</span><strong>{formatArea(polygonArea(space.vertices))}</strong></div>
        <div className="prop-row"><span>Vértices</span><strong>{space.vertices.length}</strong></div>
      </div>
      <Field label="Nombre">
        <TextInput
          value={space.name}
          onChange={(event) => updateSpace(space.id, { name: event.target.value })}
        />
      </Field>
      <Field label="Color del suelo">
        <ColorInput value={space.color} onChange={(color) => updateSpace(space.id, { color })} />
      </Field>
      <Field label="Espesor del forjado (m)">
        <NumberInput
          value={space.thickness ?? 0.2}
          onChange={(thickness) => updateSpace(space.id, { thickness })}
          min={0.02}
          max={2}
          step={0.01}
          suffix="m"
        />
      </Field>
      <Switch
        checked={space.visible}
        onChange={(visible) => updateSpace(space.id, { visible })}
        label="Visible en 3D"
      />
    </Section>
  );
}

function HoleInspector({
  project,
  hole,
  spaceId,
}: {
  project: Project;
  hole: SpaceHole;
  spaceId?: string;
}) {
  const renameHole = useEditorStore((state) => state.renameHole);
  const deleteHole = useEditorStore((state) => state.deleteHole);
  const resizeHole = useEditorStore((state) => state.resizeHole);
  const setHoleCenter = useEditorStore((state) => state.setHoleCenter);
  const setSelection = useEditorStore((state) => state.setSelection);
  const activeLevelId = useEditorStore((state) => state.activeLevelId);
  // El corte puede estar en cualquier nivel (la pestaña «Cortes» los lista
  // todos), así que se busca en el proyecto entero y no solo en el activo.
  const owner = project.levels
    .flatMap((entry) => entry.spaces.map((item) => ({ level: entry, space: item })))
    .find(({ space }) => space.holes.some((item) => item.id === hole.id));
  const level = owner?.level ?? getLevel(project, activeLevelId);
  const space = owner?.space
    ?? level?.spaces.find((entry) => entry.id === spaceId);
  const bounds = polygonBounds(hole.vertices);

  return (
    <Section
      title="Hueco en el suelo"
      action={
        <IconButton
          label="Eliminar hueco"
          icon={<Trash2 size={13} />}
          onClick={() => {
            deleteHole(hole.id);
            setSelection(null);
          }}
        />
      }
    >
      <div className="prop-list">
        <div className="prop-row"><span>Nivel</span><strong>{level?.name ?? '—'}</strong></div>
        <div className="prop-row"><span>Espacio</span><strong>{space?.name ?? '—'}</strong></div>
        <div className="prop-row"><span>Vértices</span><strong>{hole.vertices.length}</strong></div>
        <div className="prop-row"><span>Ancho</span><strong>{formatMeters(bounds.width, 2)}</strong></div>
        <div className="prop-row"><span>Fondo</span><strong>{formatMeters(bounds.depth, 2)}</strong></div>
      </div>
      <Field label="Ancho (m)">
        <NumberInput
          value={Math.round(bounds.width * 100) / 100}
          onChange={(value) => resizeHole(hole.id, Math.max(0.2, value), bounds.depth)}
          step={0.05}
          min={0.2}
          max={40}
        />
      </Field>
      <Field label="Fondo (m)">
        <NumberInput
          value={Math.round(bounds.depth * 100) / 100}
          onChange={(value) => resizeHole(hole.id, bounds.width, Math.max(0.2, value))}
          step={0.05}
          min={0.2}
          max={40}
        />
      </Field>
      <Field label="Centro X">
        <NumberInput
          value={Math.round(bounds.center.x * 100) / 100}
          onChange={(value) => setHoleCenter(hole.id, { x: value, z: bounds.center.z })}
          step={0.05}
        />
      </Field>
      <Field label="Centro Z">
        <NumberInput
          value={Math.round(bounds.center.z * 100) / 100}
          onChange={(value) => setHoleCenter(hole.id, { x: bounds.center.x, z: value })}
          step={0.05}
        />
      </Field>
      <Field label="Nombre">
        <TextInput
          value={hole.name}
          onChange={(event) => renameHole(hole.id, event.target.value)}
        />
      </Field>
      <p className="panel-note">
        El hueco recorta el suelo de este espacio. Coloca una escalera sobre el corte para
        comunicar con el nivel inferior.
      </p>
    </Section>
  );
}

export function Inspector({
  project,
  onPublish,
  open = true,
}: {
  project: Project;
  onPublish: () => void;
  open?: boolean;
}) {
  const selection = useEditorStore((state) => state.selection);
  const setSelection = useEditorStore((state) => state.setSelection);
  const object = selection?.type === 'object'
    ? project.objects.find((entry) => entry.id === selection.id)
    : null;
  const exhibitor = selection?.type === 'exhibitor'
    ? project.exhibitors.find((entry) => entry.id === selection.id)
    : null;
  const light = selection?.type === 'light'
    ? project.lights.find((entry) => entry.id === selection.id)
    : null;
  const internalWall = selection?.type === 'internalWall'
    ? project.levels.flatMap((level) => level.internalWalls).find((entry) => entry.id === selection.id)
    : null;
  const opening = selection?.type === 'opening'
    ? project.levels.flatMap((level) => level.openings).find((entry) => entry.id === selection.id)
    : null;
  const stair = selection?.type === 'stair'
    ? project.levels.flatMap((level) => level.stairs).find((entry) => entry.id === selection.id)
    : null;
  const level = selection?.type === 'level'
    ? project.levels.find((entry) => entry.id === selection.id)
    : null;
  const space = selection?.type === 'space'
    ? project.levels.flatMap((entry) => entry.spaces).find((item) => item.id === selection.id)
    : null;
  const hole = selection?.type === 'hole'
    ? project.levels
        .flatMap((entry) => entry.spaces)
        .flatMap((item) => item.holes)
        .find((item) => item.id === selection.id)
    : null;

  let title = 'Proyecto';
  let subtitle = 'Configuración general del espacio';
  let icon: ReactNode = <MapPin size={14} />;

  if (object) {
    title = object.name || 'Objeto';
    subtitle = object.source.type === 'glb' ? object.source.file : 'Forma básica';
    icon = <Box size={14} />;
  } else if (exhibitor) {
    title = exhibitor.name || 'Expositor';
    subtitle = exhibitor.standCode || 'Punto de interés';
    icon = <Users size={14} />;
  } else if (light) {
    title = light.name || 'Luz';
    subtitle = 'Iluminación de la escena';
    icon = <Lightbulb size={14} />;
  } else if (selection?.type === 'vertex') {
    title = `Vértice ${selection.index + 1}`;
    subtitle = 'Geometría de la planta';
    icon = <MapPin size={14} />;
  } else if (selection?.type === 'edge') {
    title = `Segmento ${selection.index + 1}`;
    subtitle = 'Muro o acceso';
    icon = <MapPin size={14} />;
  } else if (internalWall) {
    title = 'Muro libre';
    subtitle = 'División interior';
    icon = <BrickWall size={14} />;
  } else if (opening) {
    title = opening.kind === 'door' ? 'Puerta' : 'Ventana';
    subtitle = 'Abertura en un muro';
    icon = opening.kind === 'door' ? <DoorOpen size={14} /> : <PanelTop size={14} />;
  } else if (stair) {
    title = stair.name || 'Escalera';
    subtitle = 'Escalera del nivel';
    icon = <ArrowUpRight size={14} />;
  } else if (level) {
    title = level.name || 'Nivel';
    subtitle = `Elevación ${level.elevation.toFixed(2)} m`;
    icon = <BrickWall size={14} />;
  } else if (space) {
    title = space.name || 'Espacio';
    subtitle = 'Recinto del nivel';
    icon = <MapPin size={14} />;
  } else if (hole) {
    title = hole.name || 'Hueco';
    subtitle = 'Corte en el suelo';
    icon = <MapPin size={14} />;
  }

  return (
    <aside className={`editor-inspector${open ? ' is-open' : ''}`}>
      <header className="inspector-head">
        <div>
          <h3>{icon} {title}</h3>
          <p>{subtitle}</p>
        </div>
        {selection ? (
          <IconButton label="Deseleccionar" icon={<X size={15} />} onClick={() => setSelection(null)} />
        ) : null}
      </header>
      <div className="inspector-body">
        {object ? (
          <ObjectInspector project={project} object={object} />
        ) : exhibitor ? (
          <ExhibitorInspector project={project} exhibitor={exhibitor} />
        ) : light ? (
          <LightInspector light={light} />
        ) : selection?.type === 'vertex' ? (
          <VertexInspector project={project} index={selection.index} spaceId={selection.spaceId} />
        ) : selection?.type === 'edge' ? (
          <EdgeInspector project={project} index={selection.index} spaceId={selection.spaceId} />
        ) : internalWall ? (
          <InternalWallInspector project={project} wall={internalWall} />
        ) : opening ? (
          <OpeningInspector project={project} opening={opening} />
        ) : stair ? (
          <StairInspector project={project} stair={stair} />
        ) : level ? (
          <LevelInspector project={project} level={level} />
        ) : space ? (
          <SpaceInspector project={project} space={space} />
        ) : hole ? (
          <HoleInspector
            project={project}
            hole={hole}
            spaceId={selection?.type === 'hole' ? selection.spaceId : undefined}
          />
        ) : (
          <ProjectInspector project={project} onPublish={onPublish} />
        )}
      </div>
    </aside>
  );
}
