import { useRef, useState } from 'react';
import { Globe2, HardDriveUpload, Upload } from 'lucide-react';
import type { Project, Vec3 } from '@/types/project';
import { Badge, Button, Field, NumberInput, Select, Switch, TextInput } from '@/components/ui';
import { useEditorStore } from '@/store/editorStore';
import { useUiStore } from '@/store/uiStore';
import { detectSplatFormat, uploadSplatToNotion } from '@/services/assets/splatService';

const FORMAT_LABEL: Record<string, string> = { ply: 'PLY', splat: 'SPLAT', ksplat: 'KSPLAT' };

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

export function EnvironmentPanel({ project }: { project: Project }) {
  const setEnvironment = useEditorStore((state) => state.setEnvironment);
  const setEnvironmentPreview = useEditorStore((state) => state.setEnvironmentPreview);
  const environmentPreview = useEditorStore((state) => state.environmentPreview);
  const environmentGizmo = useEditorStore((state) => state.environmentGizmo);
  const environmentGizmoMode = useEditorStore((state) => state.environmentGizmoMode);
  const setEnvironmentGizmo = useEditorStore((state) => state.setEnvironmentGizmo);
  const setEnvironmentGizmoMode = useEditorStore((state) => state.setEnvironmentGizmoMode);
  const measureMode = useEditorStore((state) => state.measureMode);
  const toggleMeasureMode = useEditorStore((state) => state.toggleMeasureMode);
  const measurements = useEditorStore((state) => state.measurements);
  const clearMeasurements = useEditorStore((state) => state.clearMeasurements);
  const measureAxis = useEditorStore((state) => state.measureAxis);
  const setMeasureAxis = useEditorStore((state) => state.setMeasureAxis);
  const measureSnap = useEditorStore((state) => state.measureSnap);
  const setMeasureSnap = useEditorStore((state) => state.setMeasureSnap);
  const toast = useUiStore((state) => state.toast);

  const [urlInput, setUrlInput] = useState(project.environment.url ?? '');
  const [selectedFile, setSelectedFile] = useState<File | null>(null);
  const [uploading, setUploading] = useState(false);
  const [progress, setProgress] = useState(0);
  const [realLength, setRealLength] = useState(1.5);
  const fileRef = useRef<HTMLInputElement>(null);
  const env = project.environment;

  const lastMeasurement = measurements[measurements.length - 1];
  const measuredLast = lastMeasurement
    ? Math.hypot(
        lastMeasurement.b[0] - lastMeasurement.a[0],
        lastMeasurement.b[1] - lastMeasurement.a[1],
        lastMeasurement.b[2] - lastMeasurement.a[2],
      )
    : 0;

  const calibrate = () => {
    if (!lastMeasurement || measuredLast <= 0) {
      toast('Crea una medida en el splat antes de calibrar.', 'warning');
      return;
    }
    if (!(realLength > 0)) {
      toast('Introduce una longitud real válida.', 'warning');
      return;
    }
    const factor = realLength / measuredLast;
    setEnvironment({ scale: env.scale * factor });
    toast(`Escala ajustada ×${factor.toFixed(3)}. Vuelve a medir para verificar.`, 'success');
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
    ? 'Vista previa local'
    : env.blockId
      ? 'Desde Notion'
      : env.url
        ? 'URL externa'
        : 'Sin entorno';

  return (
    <div>
      <section className="panel-section">
        <div className="panel-title">
          <span><Globe2 size={12} /> Entorno (Gaussian splat)</span>
          <Badge tone={environmentPreview ? 'accent' : 'neutral'}>{status}</Badge>
        </div>

        <Field label="1 · Archivo local (vista previa)" hint="Se muestra al instante, sin subir nada. Funciona en local.">
          <input
            ref={fileRef}
            type="file"
            accept=".ply,.splat,.ksplat"
            style={{ display: 'none' }}
            onChange={(event) => chooseLocalFile(event.target.files?.[0])}
          />
          <Button size="sm" icon={<HardDriveUpload size={13} />} onClick={() => fileRef.current?.click()}>
            Elegir archivo local
          </Button>
          {selectedFile ? (
            <p className="panel-note" style={{ marginTop: 6 }}>
              {selectedFile.name} · {(selectedFile.size / (1024 * 1024)).toFixed(1)} MB
            </p>
          ) : null}
        </Field>

        <Field
          label="2 · Subir a Notion"
          hint={
            project.notionBlockId
              ? 'Se adjunta a la página del proyecto. Los archivos grandes se suben por partes (10 MB). La subida requiere el despliegue en Cloudflare.'
              : 'Vincula el proyecto a Notion para poder subirlo.'
          }
        >
          <Button
            size="sm"
            variant="secondary"
            icon={<Upload size={13} />}
            loading={uploading}
            onClick={uploadSelected}
          >
            {uploading ? `Subiendo… ${Math.round(progress * 100)}%` : 'Subir a Notion'}
          </Button>
        </Field>

        <Field label="3 · Ver desde Notion" hint="Recarga el entorno guardado en Notion sin tener el archivo en local.">
          <Button size="sm" variant="ghost" onClick={viewFromNotion}>
            Ver desde Notion
          </Button>
        </Field>

        <Field label="URL externa (opcional)" hint="Enlace directo a un .ksplat/.splat/.ply con CORS.">
          <TextInput
            value={urlInput}
            onChange={(event) => setUrlInput(event.target.value)}
            placeholder="https://…/escena.ksplat"
          />
        </Field>
        <div className="inline-actions">
          <Button size="sm" variant="secondary" onClick={applyUrl}>Cargar URL</Button>
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

        <Field
          label="Formato del archivo"
          hint="Necesario cuando la URL no tiene extensión (por ejemplo /api/splat/…)."
        >
          <Select
            value={env.format ?? ''}
            onChange={(event) =>
              setEnvironment({
                format: (event.target.value || undefined) as typeof env.format,
              })
            }
          >
            <option value="">Detectar por extensión</option>
            <option value="ply">PLY</option>
            <option value="splat">SPLAT</option>
            <option value="ksplat">KSPLAT</option>
          </Select>
        </Field>

        <Switch
          checked={env.visible}
          onChange={(visible) => setEnvironment({ visible })}
          label="Mostrar entorno"
          hint="Visible en el editor y en la publicación."
        />
      </section>

      <section className="panel-section">
        <div className="panel-title"><span>Alinear y medir</span></div>
        <Switch
          checked={environmentGizmo}
          onChange={setEnvironmentGizmo}
          label="Gizmo 3D del entorno"
          hint="Mueve, rota o escala el splat directamente en la escena 3D."
        />
        <div className="inline-actions">
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
        <Switch
          checked={measureMode}
          onChange={() => toggleMeasureMode()}
          label="Herramienta de medida"
          hint="Clic sobre la superficie (o el splat) para el punto A y otro para el B. Arrastra un extremo para moverlo."
        />
        <Switch
          checked={measureSnap}
          onChange={setMeasureSnap}
          label="Pegar a la superficie (snap)"
          hint="Desactívalo para colocar los puntos libremente, sin que salten a la superficie del splat."
        />
        <Field label="Bloquear el segundo punto a un eje">
          <div className="inline-actions">
            <Button
              size="sm"
              variant={measureAxis === 'none' ? 'primary' : 'outline'}
              onClick={() => setMeasureAxis('none')}
            >
              Libre
            </Button>
            <Button
              size="sm"
              variant={measureAxis === 'x' ? 'primary' : 'outline'}
              onClick={() => setMeasureAxis('x')}
            >
              X · ancho
            </Button>
            <Button
              size="sm"
              variant={measureAxis === 'y' ? 'primary' : 'outline'}
              onClick={() => setMeasureAxis('y')}
            >
              Y · alto
            </Button>
            <Button
              size="sm"
              variant={measureAxis === 'z' ? 'primary' : 'outline'}
              onClick={() => setMeasureAxis('z')}
            >
              Z · fondo
            </Button>
          </div>
        </Field>
        <p className="panel-note">
          Atajos: X/Y/Z bloquean el eje y L lo libera. Mantén Shift para colocar sin snap.
          {lastMeasurement
            ? ` Última: ${measuredLast.toFixed(2)} m (ΔX ${(
                lastMeasurement.b[0] - lastMeasurement.a[0]
              ).toFixed(2)} · ΔY ${(lastMeasurement.b[1] - lastMeasurement.a[1]).toFixed(
                2,
              )} · ΔZ ${(lastMeasurement.b[2] - lastMeasurement.a[2]).toFixed(2)}).`
            : ''}
        </p>
        <Button size="sm" variant="ghost" onClick={clearMeasurements}>
          Borrar medidas ({measurements.length})
        </Button>

        <Field
          label="Calibrar escala con la última medida"
          hint={
            lastMeasurement
              ? `Medida actual: ${measuredLast.toFixed(2)} m. Escribe la longitud real de ese tramo y reescala el splat.`
              : 'Crea una medida sobre el splat y luego indica su longitud real.'
          }
        >
          <div className="inline-actions">
            <NumberInput value={realLength} step={0.05} min={0} suffix="m" onChange={setRealLength} />
            <Button size="sm" variant="secondary" onClick={calibrate}>
              Aplicar medida real
            </Button>
          </div>
        </Field>
        <p className="panel-note">Escala actual del entorno: ×{env.scale.toFixed(3)}</p>
        <p className="panel-note">
          Para recortar lados del splat, hazlo en Supersplat y vuelve a subir el archivo (la librería no
          permite recortar en tiempo real).
        </p>
      </section>

      <section className="panel-section">
        <div className="panel-title"><span>Transformación</span></div>
        <Field label="Posición (m)">
          <Vec3Field value={env.position} onChange={(position) => setEnvironment({ position })} />
        </Field>
        <Field label="Rotación (grados)">
          <Vec3Field value={env.rotation} onChange={(rotation) => setEnvironment({ rotation })} step={5} />
        </Field>
        <Field label="Escala">
          <NumberInput value={env.scale} step={0.1} min={0.0001} onChange={(scale) => setEnvironment({ scale })} />
        </Field>
        <Button
          size="sm"
          variant="ghost"
          onClick={() => setEnvironment({ position: [0, 0, 0], rotation: [0, 0, 0], scale: 1 })}
        >
          Restablecer transformación
        </Button>
        <p className="panel-note">
          Usa la posición, rotación y escala para alinear el entorno con la planta y los muros.
        </p>
      </section>
    </div>
  );
}
