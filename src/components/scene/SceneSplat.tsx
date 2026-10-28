import { useEffect, useRef, useState } from 'react';
import * as THREE from 'three';
import { useThree } from '@react-three/fiber';
import { Html, TransformControls } from '@react-three/drei';
import type { Environment, TransformMode, Vec3 } from '@/types/project';
import { setSplatInstance } from './splatPicker';
import { useSplatStatus } from '@/store/splatStatusStore';

const DEG = 180 / Math.PI;

function SplatStatusOverlay() {
  const status = useSplatStatus((state) => state.status);
  const progress = useSplatStatus((state) => state.progress);
  const errorMessage = useSplatStatus((state) => state.error);
  if (status !== 'loading' && status !== 'error') return null;

  const percent = progress > 0 ? Math.round(progress <= 1 ? progress * 100 : progress) : 0;

  return (
    <Html fullscreen zIndexRange={[250, 0]} style={{ pointerEvents: 'none' }}>
      <div
        style={{
          position: 'absolute',
          inset: 0,
          display: 'flex',
          alignItems: 'center',
          justifyContent: 'center',
        }}
      >
        <div
          style={{
            background: 'rgba(10, 13, 16, 0.9)',
            border: '1px solid #2a3540',
            color: status === 'error' ? '#ff8a8a' : '#d7e1ea',
            padding: '10px 16px',
            borderRadius: 8,
            fontSize: 13,
            letterSpacing: 0.2,
            maxWidth: 380,
            textAlign: 'center',
            boxShadow: '0 8px 24px rgba(0,0,0,0.4)',
          }}
        >
          {status === 'loading'
            ? `Cargando Gaussian splat…${percent ? ` ${percent}%` : ''}`
            : `No se pudo cargar el Gaussian splat${
                errorMessage ? `: ${errorMessage}` : ''
              }. Revisa la URL, el formato (PLY/SPLAT/KSPLAT) o vuelve a subir el archivo.`}
        </div>
      </div>
    </Html>
  );
}

function EnvironmentGizmo({
  group,
  mode,
  controls,
  onCommit,
}: {
  group: THREE.Group;
  mode: TransformMode;
  controls: { enabled: boolean } | null;
  onCommit: () => void;
}) {
  const ref = useRef<any>(null);
  const commit = () => {
    onCommit();
    if (controls) controls.enabled = true;
  };

  useEffect(() => {
    const gizmo = ref.current;
    if (!gizmo) return;
    const onDragging = (event: { value: boolean }) => {
      if (event.value) {
        if (controls) controls.enabled = false;
      } else {
        commit();
      }
    };
    gizmo.addEventListener('dragging-changed', onDragging);
    return () => {
      gizmo.removeEventListener('dragging-changed', onDragging);
      if (controls) controls.enabled = true;
    };
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [group, controls, mode]);

  return (
    <TransformControls
      ref={ref}
      object={group}
      mode={mode}
      size={0.9}
      onMouseDown={() => {
        if (controls) controls.enabled = false;
      }}
      onMouseUp={commit}
    />
  );
}

/**
 * Renderiza un entorno de Gaussian splat dentro de la misma escena y cámara de
 * React Three Fiber, usando `DropInViewer` de @mkkellogg/gaussian-splats-3d.
 *
 * - `sharedMemoryForWorkers` desactivado (SharedArrayBuffer requiere COOP/COEP).
 * - Expone la instancia a `splatPicker` para medir sobre la superficie del splat.
 * - Muetra un indicador "Cargando Gaussian splat…" mientras se carga.
 * - `gizmoMode` muestra el gizmo de transformación (solo en el editor).
 */
export function SceneSplat({
  environment,
  editable = false,
  gizmoMode = null,
  onTransform,
}: {
  environment: Environment;
  editable?: boolean;
  gizmoMode?: TransformMode | null;
  onTransform?: (position: Vec3, rotationDeg: Vec3, scale: number) => void;
}) {
  const [group, setGroup] = useState<THREE.Group | null>(null);
  const controls = useThree((state) => state.controls) as { enabled: boolean } | null;
  const setStatus = useSplatStatus((state) => state.setStatus);
  const { url, format, visible } = environment;

  useEffect(() => {
    if (!visible || !url) {
      setGroup(null);
      setStatus('idle');
      return;
    }

    let cancelled = false;
    let instance: import('@mkkellogg/gaussian-splats-3d').DropInViewer | null = null;
    setStatus('loading', { progress: 0 });

    (async () => {
      try {
        const GS = await import('@mkkellogg/gaussian-splats-3d');
        if (cancelled) return;

        instance = new GS.DropInViewer({
          sharedMemoryForWorkers: false,
          gpuAcceleratedSort: false,
        });
        setGroup(instance as unknown as THREE.Group);
        setSplatInstance(instance, false);

        const sceneFormat = format
          ? format === 'ply'
            ? GS.SceneFormat.Ply
            : format === 'splat'
              ? GS.SceneFormat.Splat
              : GS.SceneFormat.KSplat
          : undefined;

        await instance.addSplatScene(url, {
          format: sceneFormat,
          showLoadingUI: false,
          splatAlphaRemovalThreshold: 1,
          onProgress: (percent: number) => {
            if (!cancelled) setStatus('loading', { progress: percent });
          },
        });
        if (cancelled) return;

        // No capturar clics normales; la medida usa el raycaster interno.
        instance.traverse((child: THREE.Object3D) => {
          child.raycast = () => {};
        });
        setSplatInstance(instance, true);
        setStatus('ready');
      } catch (error) {
        console.error('[modulab] No se pudo cargar el entorno splat:', error);
        if (!cancelled) setStatus('error', { error: (error as Error).message });
      }
    })();

    return () => {
      cancelled = true;
      setSplatInstance(null, false);
      try {
        instance?.dispose();
      } catch {
        // Ignorar errores de liberación.
      }
      setGroup(null);
      setStatus('idle');
    };
  }, [url, format, visible, setStatus]);

  // Aplica la transformación imperativamente para convivir con el gizmo.
  useEffect(() => {
    if (!group) return;
    group.position.set(environment.position[0], environment.position[1], environment.position[2]);
    group.rotation.set(
      environment.rotation[0] / DEG,
      environment.rotation[1] / DEG,
      environment.rotation[2] / DEG,
    );
    group.scale.setScalar(environment.scale);
    group.updateMatrixWorld();
  }, [group, environment.position, environment.rotation, environment.scale]);

  return (
    <>
      {group ? <primitive object={group} frustumCulled={false} /> : null}
      {editable && gizmoMode && group ? (
        <EnvironmentGizmo
          group={group}
          mode={gizmoMode}
          controls={controls}
          onCommit={() =>
            onTransform?.(
              [group.position.x, group.position.y, group.position.z],
              [group.rotation.x * DEG, group.rotation.y * DEG, group.rotation.z * DEG],
              group.scale.x,
            )
          }
        />
      ) : null}
      <SplatStatusOverlay />
    </>
  );
}
