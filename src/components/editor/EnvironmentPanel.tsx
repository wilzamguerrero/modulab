import { useRef, useState } from 'react';
import { Globe2, HardDriveUpload, Ruler, Trash2, Upload } from 'lucide-react';
import type { Project, Vec3 } from '@/types/project';
import {
  Badge,
  Button,
  Field,
  HelpButton,
  Modal,
  NumberInput,
  Select,
  Switch,
  TextInput,
} from '@/components/ui';
import { useEditorStore } from '@/store/editorStore';
import { useUiStore } from '@/store/uiStore';
import { detectSplatFormat, uploadSplatToNotion } from '@/services/assets/splatService';

function Vec3Field({
  value,
  onChange,
  step = 0.1,
}: {
  value: Vec3;
  onChange: (value: Vec3) => void;
  step?: number;
}) {
  return (
    <div className="inline-actions">
      {(['X', 'Y', 'Z'] as const).map((axis, index) => (
        <NumberInput
          key={axis}
          value={value[index]}
          step={step}
          suffix={axis}
          onChange={(next) => {
            const updated = [...value] as Vec3;
            updated[index] = next;
            onChange(updated);
          }}
        />
      ))}
    </div>
  );
}

function measurementDistance(a: Vec3, b: Vec3): number {
  return Math.hypot(b[0] - a[0], b[1] - a[1], b[2] - a[2]);
}

export function EnvironmentPanel({ project }: { project: Project }) {
  const setEnvironment = useEditorStore((state) => state.setEnvironment);
  const setEnvironmentPreview = useEditorStore((state) => state.setEnvironmentPreview);
  const environmentPreview = useEditorStore((state) => state.environmentPreview);
  const environmentGizmo = useEditorStore((state) => state.environmentGizmo);
  const environmentGizmoMode = useEditorStore((state) => state.environmentGizmoMode);
  const setEnvironmentGizmo = useEditorStore((state) => state.setEnvironmentGizmo);
  const setEnvironmentGizmoMode = useEditorStore((state) => state.setEnvironmentGizmoMode);
  const setView = useEditorStore((state) => state.setView);
  const measureMode = useEditorStore((state) => state.measureMode);
  const toggleMeasureMode = useEditorStore((state) => state.toggleMeasureMode);
  const measurements = useEditorStore((state) => state.measurements);
  const clearMeasurements = useEditorStore((state) => state.clearMeasurements);
  const measureAxis = useEditorStore((state) => state.measureAxis);
  const setMeasureAxis = useEditorStore((state) => state.setMeasureAxis);
  const measureSnap = useEditorStore((state) => state.measureSnap);
  const setMeasureSnap = useEditorStore((state) => state.setMeasureSnap);
  const activeMeasurementId = useEditorStore((state) => state.activeMeasurementId);
  const setActiveMeasurement = useEditorStore((state) => state.setActiveMeasurement);
  const deleteMeasurement = useEditorStore((state) => state.deleteMeasurement);
  const selection = useEditorStore((state) => state.selection);
  const updateObjectTransform = useEditorStore((state) => state.updateObjectTransform);
  const toast = useUiStore((state) => state.toast);

  const [urlInput, setUrlInput] = useState(project.environment.url ?? '');
  const [selectedFile, setSelectedFile] = useState<File | null>(null);
  const [uploading, setUploading] = useState(false);
  const [progress, setProgress] = useState(0);
  const [calibrateId, setCalibrateId] = useState<string | null>(null);
  const [calibrateTarget, setCalibrateTarget] = useState<'splat' | 'object'>('splat');
  const [targetLength, setTargetLength] = useState(1.8);
  const fileRef = useRef<HTMLInputElement>(null);
  const env = project.environment;

  const selectedObject =
    selection?.type === 'object'
      ? project.objects.find((entry) => entry.id === selection.id) ?? null
      : null;
  const calibrationMeasurement = calibrateId
    ? measurements.find((measurement) => measurement.id === calibrateId) ?? null
    : null;
  const calibrationMeasured = calibrationMeasurement
    ? measurementDistance(calibrationMeasurement.a, calibrationMeasurement.b)
    : 0;
  const calibrationFactor =
    calibrationMeasured > 0 && targetLength > 0 ? targetLength / calibrationMeasured : 1;

  const openCalibration = (id: string) => {
    const measurement = measurements.find((entry) => entry.id === id);
    if (!measurement) return;
    setCalibrateId(id);
    setTargetLength(Number(measurementDistance(measurement.a, measurement.b).toFixed(2)));
    setCalibrateTarget('splat');
  };

  const applyCalibration = () => {
    if (!calibrationMeasurement || calibrationMeasured <= 0 || !(targetLength > 0)) {
      toast('Indica una longitud real válida.', 'warning');
      return;
    }
    const factor = calibrationFactor;
    if (calibrateTarget === 'object') {
      if (!selectedObject) {
        toast('Selecciona un objeto para reescalarlo.', 'warning');
        return;
      }
      updateObjectTransform(
        selectedObject.id,
        {
          scale: selectedObject.transform.scale.map((value) =>
            Math.max(0.001, value * factor),
          ) as Vec3,
        },
        { coalesceKey: `calibrate:${selectedObject.id}` },
      );
      toast(`Objeto reescalado ×${factor.toFixed(3)}.`, 'success');
    } else {
      setEnvironment({ scale: env.scale * factor });
      toast(`Entorno reescalado ×${factor.toFixed(3)}.`, 'success');
    }
    setCalibrateId(null);
  };

  const clearPreview = () => {
    // El store revoca el blob URL anterior al reemplazarlo por null.
    setEnvironmentPreview(null);
    setSelectedFile(null);
  };

  const chooseLocalFile = (file?: File) => {
    if (!file) return;
    const url = URL.createObjectURL(file);
    setSelectedFile(file);
    // El blob vive en el store, así que el splat sigue visible aunque cambies
    // de pestaña o de vista (no se revoca al desmontar este panel).
    setEnvironmentPreview({ url, format: detectSplatFormat(file.name) });
    setEnvironment({ visible: true });
    toast('Vista previa local cargada.', 'success');
  };

  const applyUrl = () => {
    const url = urlInput.trim();
    if (!url) {
      clearPreview();
      setEnvironment({ url: undefined, blockId: undefined });
      return;
    }
    clearPreview();
    // Si la URL no trae extensión (p. ej. /api/splat/<id>) conservamos el
    // formato ya conocido; si no, la librería no podría interpretar el archivo.
    const detected = detectSplatFormat(url);
    setEnvironment({
      url,
      blockId: undefined,
      format: detected ?? project.environment.format,
      visible: true,
    });
    toast('Entorno actualizado desde URL.', 'success');
  };

  const uploadSelected = async () => {
    if (!selectedFile) {
      toast('Elige primero un archivo local.', 'warning');
      return;
    }
    if (!project.notionBlockId) {
      toast('Vincula el proyecto a Notion para subir el entorno.', 'warning');
      return;
    }
    setUploading(true);
    setProgress(0);
    try {
      const result = await uploadSplatToNotion(selectedFile, {
        parentBlockId: project.notionBlockId,
        onProgress: setProgress,
      });
      setEnvironment({
        url: result.url,
        blockId: result.blockId,
        format: detectSplatFormat(selectedFile.name),
        visible: true,
      });
      setUrlInput(result.url);
      clearPreview();
      toast('Entorno subido a Notion.', 'success');
    } catch (error) {
      toast(`No se pudo subir el entorno: ${(error as Error).message}`, 'error');
    } finally {
      setUploading(false);
      setProgress(0);
      if (fileRef.current) fileRef.current.value = '';
    }
  };

  const viewFromNotion = () => {
    clearPreview();
    const url = env.url ?? (env.blockId ? `/api/splat/${encodeURIComponent(env.blockId)}` : undefined);
    if (url) {
      setEnvironment({ url, visible: true });
      setUrlInput(url);
      toast('Mostrando entorno desde Notion.', 'success');
    }
  };

  const status = environmentPreview
    ? 'Local'
    : env.blockId
      ? 'Notion'
      : env.url
        ? 'URL'
        : 'Sin entorno';

  return (
    <div>
      <section className="panel-section">
        <div className="panel-title">
          <span><Globe2 size={12} /> Entorno</span>
          <span className="panel-title-actions">
            <HelpButton title="Entorno (Gaussian splat)">
              <p>
                Usa un Gaussian splat como referencia del espacio real. Puedes cargarlo de tres
                formas:
              </p>
              <ul>
                <li><strong>Archivo local:</strong> se muestra al instante, sin subir nada.</li>
                <li><strong>Subir:</strong> lo adjunta a la página del proyecto en Notion (requiere
                  Notion configurado y, para archivos grandes, plan de pago).</li>
                <li><strong>URL / Notion:</strong> carga un archivo ya alojado. Si la URL no tiene
                  extensión (por ejemplo <code>/api/splat/…</code>) indica el formato.</li>
              </ul>
              <p>
                «Mostrar entorno» lo oculta o muestra sin volver a descargarlo. El splat se puede
                mover, rotar y escalar en «Alinear».
              </p>
            </HelpButton>
            <Badge tone={environmentPreview ? 'accent' : 'neutral'}>{status}</Badge>
          </span>
        </div>

        <input
          ref={fileRef}
          type="file"
          accept=".ply,.splat,.ksplat"
          style={{ display: 'none' }}
          onChange={(event) => chooseLocalFile(event.target.files?.[0])}
        />
        <div className="inline-actions">
          <Button size="sm" icon={<HardDriveUpload size={13} />} onClick={() => fileRef.current?.click()}>
            Archivo local
          </Button>
          <Button
            size="sm"
            variant="secondary"
            icon={<Upload size={13} />}
            loading={uploading}
            onClick={uploadSelected}
          >
            {uploading ? `${Math.round(progress * 100)}%` : 'Subir'}
          </Button>
          <Button size="sm" variant="ghost" onClick={viewFromNotion}>
            Ver en Notion
          </Button>
        </div>
        {selectedFile ? (
          <p className="panel-note">
            {selectedFile.name} · {(selectedFile.size / (1024 * 1024)).toFixed(1)} MB
          </p>
        ) : null}

        <div className="inline-actions">
          <TextInput
            className="grow"
            value={urlInput}
            onChange={(event) => setUrlInput(event.target.value)}
            placeholder="https://…/escena.ksplat"
          />
          <Button size="sm" variant="secondary" onClick={applyUrl}>Cargar</Button>
        </div>

        <div className="grid-2">
          <Field label="Formato">
            <Select
              value={env.format ?? ''}
              onChange={(event) =>
                setEnvironment({
                  format: (event.target.value || undefined) as typeof env.format,
                })
              }
            >
              <option value="">Auto</option>
              <option value="ply">PLY</option>
              <option value="splat">SPLAT</option>
              <option value="ksplat">KSPLAT</option>
            </Select>
          </Field>
          <Field label="Escala">
            <NumberInput
              value={env.scale}
              step={0.1}
              min={0.0001}
              onChange={(scale) => setEnvironment({ scale })}
            />
          </Field>
        </div>

        <Switch
          checked={env.visible}
          onChange={(visible) => setEnvironment({ visible })}
          label="Mostrar entorno"
        />
        <div className="inline-actions">
          <Button
            size="sm"
            variant="ghost"
            onClick={() => {
              clearPreview();
              setEnvironment({ url: undefined, blockId: undefined });
              setUrlInput('');
            }}
          >
            Quitar entorno
          </Button>
        </div>
      </section>

      <section className="panel-section">
        <div className="panel-title">
          <span>Alinear</span>
          <span className="panel-title-actions">
            <HelpButton title="Alinear el entorno">
              <p>Mueve, rota o escala el splat para que coincida con la planta y los muros.</p>
              <ul>
                <li><strong>Gizmo:</strong> muestra las flechas/anillos directamente en la escena 3D.</li>
                <li><strong>Posición, rotación y escala</strong> ajustan el splat por valores exactos.</li>
              </ul>
            </HelpButton>
          </span>
        </div>
        <div className="inline-actions">
          <Button
            size="sm"
            variant={environmentGizmo ? 'primary' : 'outline'}
            onClick={() => setEnvironmentGizmo(!environmentGizmo)}
          >
            Gizmo
          </Button>
          <Button
            size="sm"
            variant={environmentGizmoMode === 'translate' ? 'primary' : 'outline'}
            onClick={() => setEnvironmentGizmoMode('translate')}
          >
            Mover
          </Button>
          <Button
            size="sm"
            variant={environmentGizmoMode === 'rotate' ? 'primary' : 'outline'}
            onClick={() => setEnvironmentGizmoMode('rotate')}
          >
            Rotar
          </Button>
          <Button
            size="sm"
            variant={environmentGizmoMode === 'scale' ? 'primary' : 'outline'}
            onClick={() => setEnvironmentGizmoMode('scale')}
          >
            Escalar
          </Button>
        </div>
        <Field label="Posición (m)">
          <Vec3Field value={env.position} onChange={(position) => setEnvironment({ position })} />
        </Field>
        <Field label="Rotación (°)">
          <Vec3Field value={env.rotation} onChange={(rotation) => setEnvironment({ rotation })} step={5} />
        </Field>
        <Button
          size="sm"
          variant="ghost"
          onClick={() => setEnvironment({ position: [0, 0, 0], rotation: [0, 0, 0], scale: 1 })}
        >
          Restablecer
        </Button>
      </section>

      <section className="panel-section">
        <div className="panel-title">
          <span><Ruler size={12} /> Medidas</span>
          <span className="panel-title-actions">
            <HelpButton title="Herramienta de medida">
              <ul>
                <li>Actívala y haz clic en la superficie (o el splat) para el punto A y otro para el B.</li>
                <li>Arrastra un extremo para moverlo o el <strong>punto central</strong> para desplazar
                  toda la medida.</li>
                <li><strong>Snap</strong> pega los puntos a la superficie; desactívalo para colocarlos
                  libremente.</li>
                <li><strong>X/Y/Z</strong> bloquean el segundo punto a un eje (ancho, alto o fondo).
                  Atajos: X/Y/Z y L para liberar; Shift coloca sin snap.</li>
                <li>Con <strong>Snap desactivado</strong> y un eje activo, el primer punto se apoya en
                  el suelo: crea <strong>cotas de altura o ancho libres</strong> sin referencia. Puedes
                  crear tantas como quieras.</li>
                <li>La lista permite seleccionar una medida para resaltarla o eliminarla.</li>
                <li><strong>Calibrar escala</strong> reescala el entorno o el objeto seleccionado a
                  partir de una medida y su longitud real (factor proporcional).</li>
              </ul>
            </HelpButton>
            <Badge tone={measurements.length ? 'accent' : 'neutral'}>{measurements.length}</Badge>
          </span>
        </div>

        <div className="inline-actions">
          <Button
            size="sm"
            variant={measureMode ? 'primary' : 'outline'}
            icon={<Ruler size={13} />}
            onClick={() => {
              setView('3d');
              toggleMeasureMode();
            }}
          >
            {measureMode ? 'Desactivar' : 'Medir'}
          </Button>
          <Button
            size="sm"
            variant="ghost"
            disabled={!measurements.length}
            onClick={clearMeasurements}
          >
            Borrar todas
          </Button>
        </div>

        <div className="inline-actions">
          <Button size="sm" variant={measureAxis === 'none' ? 'primary' : 'outline'} onClick={() => setMeasureAxis('none')}>
            Libre
          </Button>
          <Button size="sm" variant={measureAxis === 'x' ? 'primary' : 'outline'} onClick={() => setMeasureAxis('x')}>
            X
          </Button>
          <Button size="sm" variant={measureAxis === 'y' ? 'primary' : 'outline'} onClick={() => setMeasureAxis('y')}>
            Y
          </Button>
          <Button size="sm" variant={measureAxis === 'z' ? 'primary' : 'outline'} onClick={() => setMeasureAxis('z')}>
            Z
          </Button>
          <Button
            size="sm"
            variant={measureSnap ? 'primary' : 'outline'}
            onClick={() => setMeasureSnap(!measureSnap)}
          >
            Snap
          </Button>
        </div>

        {measurements.length ? (
          <div className="measure-list">
            {measurements.map((measurement, index) => {
              const active = activeMeasurementId === measurement.id;
              return (
                <div key={measurement.id} className={`measure-list-item${active ? ' is-active' : ''}`}>
                  <button
                    type="button"
                    className="measure-list-main"
                    onClick={() => {
                      setView('3d');
                      setActiveMeasurement(active ? null : measurement.id);
                    }}
                  >
                    <span>Medida {index + 1}</span>
                    <strong>{measurementDistance(measurement.a, measurement.b).toFixed(2)} m</strong>
                  </button>
                  <button
                    type="button"
                    className="measure-list-cal"
                    title="Calibrar escala con esta medida"
                    onClick={() => openCalibration(measurement.id)}
                  >
                    <Ruler size={12} />
                  </button>
                  <button
                    type="button"
                    className="measure-list-del"
                    title="Eliminar medida"
                    onClick={() => deleteMeasurement(measurement.id)}
                  >
                    <Trash2 size={12} />
                  </button>
                </div>
              );
            })}
          </div>
        ) : (
          <p className="panel-note">Sin medidas todavía.</p>
        )}

        <Button
          size="sm"
          variant="secondary"
          icon={<Ruler size={13} />}
          disabled={!measurements.length}
          onClick={() => {
            const id =
              activeMeasurementId ?? measurements[measurements.length - 1]?.id;
            if (id) openCalibration(id);
          }}
        >
          Calibrar escala…
        </Button>
      </section>

      <Modal
        open={Boolean(calibrationMeasurement)}
        onClose={() => setCalibrateId(null)}
        title="Calibrar escala"
        size="sm"
        footer={
          <>
            <Button variant="ghost" onClick={() => setCalibrateId(null)}>Cancelar</Button>
            <Button variant="primary" onClick={applyCalibration}>Aplicar</Button>
          </>
        }
      >
        {calibrationMeasurement ? (
          <>
            <div className="prop-list">
              <div className="prop-row">
                <span>Medida actual</span>
                <strong>{calibrationMeasured.toFixed(2)} m</strong>
              </div>
            </div>
            <Field label="Debería medir">
              <NumberInput
                value={targetLength}
                step={0.05}
                min={0.01}
                suffix="m"
                onChange={setTargetLength}
              />
            </Field>
            <p className="panel-note">
              Factor ×{calibrationFactor.toFixed(3)} · escala proporcional (puedes deshacer con Ctrl+Z)
            </p>
            <Field label="Aplicar a">
              <Select
                value={calibrateTarget}
                onChange={(event) =>
                  setCalibrateTarget(event.target.value as 'splat' | 'object')
                }
              >
                <option value="splat">Entorno (Gaussian splat)</option>
                <option value="object" disabled={!selectedObject}>
                  {selectedObject
                    ? `Objeto: ${selectedObject.name}`
                    : 'Objeto seleccionado (ninguno)'}
                </option>
              </Select>
            </Field>
          </>
        ) : null}
      </Modal>
    </div>
  );
}
