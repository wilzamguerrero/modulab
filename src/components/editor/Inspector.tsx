import { useEffect, useRef, useState, type ReactNode } from 'react';
import {
  ArrowUpRight,
  Box,
  BrickWall,
  Camera,
  Copy,
  DoorOpen,
  ImagePlus,
  Lightbulb,
  MapPin,
  PanelTop,
  RotateCcw,
  Sparkles,
  Trash2,
  Users,
  X,
} from 'lucide-react';
import type {
  Exhibitor,
  ExhibitorColorMode,
  InternalWall,
  LightConfig,
  Project,
  SceneObject,
  ShadowQuality,
  Vec3,
  WallOpening,
} from '@/types/project';
import {
  Badge,
  Button,
  ColorInput,
  Field,
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
import { SHADOW_QUALITY_OPTIONS } from '@/data/shadows';
import { notionPhotoUrl } from '@/services/notion/notionService';
import { uploadExhibitorPhoto } from '@/services/assets/catalogService';
import { formatDateTime } from '@/utils/format';
import { edgeLength, formatArea, formatMeters, polygonArea, snapValue } from '@/utils/geometry';
import { getWallById, wallLength } from '@/utils/walls';
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
          onClick={() => setProjectCamera(cameraForVertices(project.floor.vertices))}
        >
          Ajustar a la planta
        </Button>
      </Section>

      <Section title="Vista y edición">
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
        <p className="panel-note">
          La pintura tiñe muros, aberturas y objetos asociados. Al seleccionar un expositor, sus
          elementos se resaltan siempre, aunque solo estén activos los aros.
        </p>
        <Switch
          checked={project.settings.showGrid}
          onChange={(showGrid) => setSettings({ showGrid })}
          label="Cuadrícula"
        />
        <Switch
          checked={project.settings.showDimensions}
          onChange={(showDimensions) => setSettings({ showDimensions })}
          label="Cotas de muros"
        />
        <Switch
          checked={project.settings.snapToGrid}
          onChange={(snapToGrid) => setSettings({ snapToGrid })}
          label="Ajuste a cuadrícula"
        />
      </Section>

      <Section title="Resumen">
        <div className="prop-list">
          <div className="prop-row"><span>Área</span><strong>{formatArea(polygonArea(project.floor.vertices))}</strong></div>
          <div className="prop-row"><span>Objetos</span><strong>{project.objects.length}</strong></div>
          <div className="prop-row"><span>Expositores</span><strong>{project.exhibitors.length}</strong></div>
          <div className="prop-row"><span>Luces</span><strong>{project.lights.length}</strong></div>
          <div className="prop-row"><span>Actualizado</span><strong>{formatDateTime(project.updatedAt)}</strong></div>
        </div>
      </Section>

      <Section title="Publicación">
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
            <p className="panel-note">
              La publicación crea una copia de solo lectura con un enlace compartible. Los cambios
              posteriores no se verán hasta volver a publicar.
            </p>
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

      {object.source.type === 'glb' ? (
        <Section title="Escala real">
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
              <p className="panel-note">
                Se calcula con el tamaño original del GLB. Al cambiarla, la escala X/Y/Z se
                multiplica por el mismo factor para conservar las proporciones del modelo.
              </p>
            </>
          ) : (
            <p className="panel-note">Cargando dimensiones del GLB…</p>
          )}
        </Section>
      ) : null}

      <Section title="Expositor asociado">
        <ExhibitorSelect
          project={project}
          value={object.exhibitorId}
          onChange={(exhibitorId) => assignObjectToExhibitor(object.id, exhibitorId)}
        />
        <p className="panel-note">
          El objeto usa el color de su expositor en el visor y puede pintarse con él según la
          configuración de «Vista y edición».
        </p>
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
  const toast = useUiStore((state) => state.toast);
  const photoRef = useRef<HTMLInputElement>(null);
  const [uploading, setUploading] = useState(false);
  const photo = notionPhotoUrl(exhibitor);
  const associatedWallCount =
    project.edges.filter((edge) => edge.exhibitorId === exhibitor.id).length +
    project.internalWalls.filter((wall) => wall.exhibitorId === exhibitor.id).length;
  const associatedOpeningCount = project.openings.filter(
    (opening) => opening.exhibitorId === exhibitor.id,
  ).length;

  const wallKindLabel = (wallId: string) =>
    getWallById(project, wallId)?.internalWall ? 'muro libre' : 'muro perimetral';

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

      <Section title="Posición">
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
        <Field label="Orientación">
          <NumberInput
            value={(exhibitor.rotation * 180) / Math.PI}
            onChange={(degrees) => updateExhibitor(exhibitor.id, { rotation: (degrees * Math.PI) / 180 })}
            step={5}
            suffix="°"
          />
        </Field>
        <p className="panel-note">
          En la vista 3D también puedes seleccionar el marcador y arrastrar las flechas X/Z para
          moverlo con precisión sobre el piso.
        </p>
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
            const camera = defaultExhibitorCamera(exhibitor.position, project.floor.vertices);
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
      >
        <div className="related-list">
          {project.edges.map((edge, index) => (
            <label className="check-row" key={edge.id}>
              <input
                type="checkbox"
                checked={edge.exhibitorId === exhibitor.id}
                onChange={(event) =>
                  setEdge(index, {
                    exhibitorId: event.target.checked ? exhibitor.id : null,
                  })
                }
              />
              <span>
                Segmento {index + 1}
                {edge.wall ? '' : ' · acceso'}
              </span>
            </label>
          ))}
          {project.internalWalls.map((wall, index) => (
            <label className="check-row" key={wall.id}>
              <input
                type="checkbox"
                checked={wall.exhibitorId === exhibitor.id}
                onChange={(event) =>
                  updateInternalWall(wall.id, {
                    exhibitorId: event.target.checked ? exhibitor.id : null,
                  })
                }
              />
              <span>Muro libre {index + 1}</span>
            </label>
          ))}
          {project.openings.map((opening, index) => (
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
        <p className="panel-note">
          Los elementos asociados adoptan el color del expositor en el visor. También puedes
          asignarlos desde el inspector de cada muro o abertura.
        </p>
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

function VertexInspector({ project, index }: { project: Project; index: number }) {
  const moveVertex = useEditorStore((state) => state.moveVertex);
  const removeVertex = useEditorStore((state) => state.removeVertex);
  const insertVertexOnEdge = useEditorStore((state) => state.insertVertexOnEdge);
  const setSelection = useEditorStore((state) => state.setSelection);
  const vertex = project.floor.vertices[index];
  if (!vertex) return null;
  const next = project.floor.vertices[(index + 1) % project.floor.vertices.length];

  return (
    <Section title={`Vértice ${index + 1}`}>
      <div className="grid-2">
        <Field label="X">
          <NumberInput value={vertex.x} onChange={(x) => moveVertex(index, { ...vertex, x }, { coalesceKey: `vertex-x:${index}` })} step={0.1} suffix="m" />
        </Field>
        <Field label="Z">
          <NumberInput value={vertex.z} onChange={(z) => moveVertex(index, { ...vertex, z }, { coalesceKey: `vertex-z:${index}` })} step={0.1} suffix="m" />
        </Field>
      </div>
      <div className="prop-list">
        <div className="prop-row"><span>Borde siguiente</span><strong>{formatMeters(edgeLength(project.floor.vertices, index), 2)}</strong></div>
        <div className="prop-row"><span>Borde anterior</span><strong>{formatMeters(edgeLength(project.floor.vertices, (index - 1 + project.floor.vertices.length) % project.floor.vertices.length), 2)}</strong></div>
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
          disabled={project.floor.vertices.length <= 3}
          onClick={() => { removeVertex(index); setSelection(null); }}
          icon={<Trash2 size={13} />}
        >
          Eliminar
        </Button>
      </div>
    </Section>
  );
}

function EdgeInspector({ project, index }: { project: Project; index: number }) {
  const setEdge = useEditorStore((state) => state.setEdge);
  const toggleWall = useEditorStore((state) => state.toggleWall);
  const insertVertexOnEdge = useEditorStore((state) => state.insertVertexOnEdge);
  const patchProject = useEditorStore((state) => state.patchProject);
  const addOpening = useEditorStore((state) => state.addOpening);
  const setSelection = useEditorStore((state) => state.setSelection);
  const toast = useUiStore((state) => state.toast);
  const edge = project.edges[index];
  const a = project.floor.vertices[index];
  const b = project.floor.vertices[(index + 1) % project.floor.vertices.length];
  if (!edge || !a || !b) return null;
  const length = wallLength(a, b);
  const openings = project.openings.filter((opening) => opening.wallId === edge.id);

  const applyToAll = () => {
    patchProject((draft) => {
      draft.edges = draft.edges.map((entry) => ({
        ...entry,
        height: edge.height,
        thickness: edge.thickness,
        color: edge.color,
      }));
      draft.internalWalls = draft.internalWalls.map((entry) => ({
        ...entry,
        height: edge.height,
        thickness: edge.thickness,
        color: edge.color,
      }));
    });
    toast('Estilo aplicado a todos los muros y divisiones.', 'success');
  };

  return (
    <Section title={`Segmento ${index + 1}`}>
      <div className="prop-list">
        <div className="prop-row"><span>Longitud</span><strong>{formatMeters(edgeLength(project.floor.vertices, index), 2)}</strong></div>
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
  const toast = useUiStore((state) => state.toast);
  const length = wallLength(wall.a, wall.b);
  const openings = project.openings.filter((opening) => opening.wallId === wall.id);
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
        <IconButton
          label="Eliminar muro libre"
          icon={<Trash2 size={13} />}
          onClick={() => {
            deleteInternalWall(wall.id);
            setSelection(null);
            toast('Muro libre eliminado.', 'success');
          }}
        />
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
      <p className="panel-note">
        Los muros libres dividen el espacio sin modificar el contorno de la planta. En 2D puedes
        arrastrar sus nodos o hacer doble clic para insertar uno; en 3D, selecciona el muro y arrastra
        los tiradores de sus extremos.
      </p>
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
  const wall = getWallById(project, opening.wallId);
  const length = wall ? wallLength(wall.a, wall.b) : 0;
  const isDoor = opening.kind === 'door';

  return (
    <Section
      title={isDoor ? 'Puerta' : 'Ventana'}
      action={
        <IconButton
          label="Eliminar abertura"
          icon={<Trash2 size={13} />}
          onClick={() => {
            deleteOpening(opening.id);
            setSelection(null);
            toast('Abertura eliminada.', 'success');
          }}
        />
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
      <p className="panel-note">
        La abertura se recorta en el muro y se mantiene al mover o cambiar el grosor del muro. En 3D
        puedes seleccionarla y arrastrar sus tiradores para moverla, cambiar su ancho o su altura.
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
    ? project.internalWalls.find((entry) => entry.id === selection.id)
    : null;
  const opening = selection?.type === 'opening'
    ? project.openings.find((entry) => entry.id === selection.id)
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
          <VertexInspector project={project} index={selection.index} />
        ) : selection?.type === 'edge' ? (
          <EdgeInspector project={project} index={selection.index} />
        ) : internalWall ? (
          <InternalWallInspector project={project} wall={internalWall} />
        ) : opening ? (
          <OpeningInspector project={project} opening={opening} />
        ) : (
          <ProjectInspector project={project} onPublish={onPublish} />
        )}
      </div>
    </aside>
  );
}
