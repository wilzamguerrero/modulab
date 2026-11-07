import { useEffect, useMemo, useRef } from 'react';
import * as THREE from 'three';
import { Canvas } from '@react-three/fiber';
import {
  CameraControls,
  type CameraControls as CameraControlsImpl,
} from '@react-three/drei';
import type { Project, Vec3 } from '@/types/project';
import { Architecture } from '@/components/scene/Architecture';
import { SceneLights } from '@/components/scene/SceneLights';
import { SceneEnvironment } from '@/components/scene/SceneEnvironment';
import { SceneShadows } from '@/components/scene/SceneShadows';
import { SceneObjects } from '@/components/scene/SceneObjects';
import { ExhibitorMarkers } from '@/components/scene/ExhibitorMarkers';
import { SceneSplat } from '@/components/scene/SceneSplat';
import { projectBounds } from '@/utils/levels';

export interface ViewerCameraCommand {
  mode: 'reset' | 'focus' | 'top';
  nonce: number;
  position?: Vec3;
  target?: Vec3;
  /**
   * Punto de paso del vuelo (la vista de lectura del nivel). No es una parada:
   * la cámara lo atraviesa dentro de un mismo movimiento continuo hacia el
   * destino.
   */
  via?: { position: Vec3; target: Vec3 }[];
  /** Campo de visión de la vista de lectura, si la hay. */
  fov?: number;
}

/** Duración del vuelo entre stands por defecto, en milisegundos. */
const DEFAULT_TRAVEL_DURATION_MS = 2200;

type Point3 = [number, number, number];

/**
 * Bézier de paso: con `[p0, ...medios, pn]` construye una curva que arranca en
 * p0, termina en pn y pasa por los puntos intermedios en fracciones regulares
 * del recorrido. Así el punto de paso se atraviesa sin detener el movimiento.
 */
function buildTravelCurve(points: Point3[]): Point3[] {
  if (points.length <= 2) return points;
  // Con un único punto intermedio en t = 0,5 la curva de Bézier cuadrática
  // pasa exactamente por él si se toma como control ponderado.
  const [start, middle, end] = points;
  return [start, [2 * middle[0] - (start[0] + end[0]) / 2, 2 * middle[1] - (start[1] + end[1]) / 2, 2 * middle[2] - (start[2] + end[2]) / 2], end];
}

function sampleCurve(points: Point3[], t: number): Point3 {
  if (points.length === 0) return [0, 0, 0];
  if (points.length === 1) return points[0];
  if (points.length === 2) {
    return [
      points[0][0] + (points[1][0] - points[0][0]) * t,
      points[0][1] + (points[1][1] - points[0][1]) * t,
      points[0][2] + (points[1][2] - points[0][2]) * t,
    ];
  }
  const [a, b, c] = points;
  const u = 1 - t;
  return [
    u * u * a[0] + 2 * u * t * b[0] + t * t * c[0],
    u * u * a[1] + 2 * u * t * b[1] + t * t * c[1],
    u * u * a[2] + 2 * u * t * b[2] + t * t * c[2],
  ];
}

function ViewerCamera({
  project,
  command,
}: {
  project: Project;
  command: ViewerCameraCommand | null;
}) {
  const controlsRef = useRef<CameraControlsImpl>(null);

  useEffect(() => {
    const controls = controlsRef.current;
    if (!controls || !command) return;
    // `nonce: 0` es la cámara de entrada: se aplica de golpe, sin viaje.
    const animate = command.nonce > 0;

    let position: [number, number, number] | undefined;
    let target: [number, number, number] | undefined;

    if (command.mode === 'focus' && command.position && command.target) {
      position = command.position;
      target = command.target;
    } else if (command.mode === 'top') {
      const bounds = projectBounds(project);
      const height = Math.max(bounds.width, bounds.depth, 6) * 1.25 + 5;
      position = [bounds.center.x, height, bounds.center.z + 0.02];
      target = [bounds.center.x, 0, bounds.center.z];
    } else {
      position = project.camera.position;
      target = project.camera.target;
    }

    if (!position || !target) return;

    const goTo = (
      nextPosition: [number, number, number],
      nextTarget: [number, number, number],
    ) =>
      controls.setLookAt(
        nextPosition[0],
        nextPosition[1],
        nextPosition[2],
        nextTarget[0],
        nextTarget[1],
        nextTarget[2],
        animate,
      );

    if (!animate) {
      goTo(position, target);
      return undefined;
    }

    // Un solo vuelo continuo hacia el expositor, con la vista de lectura como
    // punto de paso (no como parada). La trayectoria es una Bézier que parte
    // de la cámara actual, pasa por el punto de paso y termina en la llegada;
    // se recorre con una sola curva de velocidad suave desde el inicio hasta
    // el final, así no hay frenada ni espera a mitad de camino.
    const waypoints = (command.via ?? [])
      .map((stop) => ({ position: stop.position, target: stop.target }))
      .filter((stop) => stop.position && stop.target)
      .slice(0, 1);
    const fromPosition = controls.getPosition(new THREE.Vector3());
    const fromTarget = controls.getTarget(new THREE.Vector3());
    const control = buildTravelCurve([
      [fromPosition.x, fromPosition.y, fromPosition.z],
      ...waypoints.map((stop) => stop.position),
      position,
    ]);
    const targetControl = buildTravelCurve([
      [fromTarget.x, fromTarget.y, fromTarget.z],
      ...waypoints.map((stop) => stop.target),
      target,
    ]);
    // Velocidad del viaje: la fija el editor en «Vistas → velocidad».
    const travelDuration = Math.max(
      300,
      (project.readerTravelSeconds ?? DEFAULT_TRAVEL_DURATION_MS / 1000) * 1000,
    );
    const start = performance.now();
    let frame = 0;
    let cancelled = false;
    const step = () => {
      if (cancelled) return;
      const t = Math.min(1, (performance.now() - start) / travelDuration);
      const eased = t < 0.5 ? 4 * t * t * t : 1 - (-2 * t + 2) ** 3 / 2;
      const nextPosition = sampleCurve(control, eased);
      const nextTarget = sampleCurve(targetControl, eased);
      controls.setLookAt(
        nextPosition[0],
        nextPosition[1],
        nextPosition[2],
        nextTarget[0],
        nextTarget[1],
        nextTarget[2],
        false,
      );
      if (t < 1) frame = requestAnimationFrame(step);
    };
    frame = requestAnimationFrame(step);
    return () => {
      cancelled = true;
      cancelAnimationFrame(frame);
    };
  }, [command, project]);

  // La vista de lectura puede traer su propio campo de visión (zoom).
  useEffect(() => {
    const controls = controlsRef.current;
    const fov = command?.fov;
    if (!controls || !fov) return;
    const camera = controls.camera;
    if (!(camera instanceof THREE.PerspectiveCamera)) return;
    if (Math.abs(camera.fov - fov) < 0.01) return;
    camera.fov = fov;
    camera.updateProjectionMatrix();
  }, [command]);

  return (
    <CameraControls
      ref={controlsRef}
      makeDefault
      smoothTime={0.75}
      draggingSmoothTime={0.08}
      minDistance={0.8}
      maxDistance={160}
      maxPolarAngle={Math.PI / 2 - 0.02}
    />
  );
}

export function PublicScene({
  project,
  selectedExhibitorId,
  cameraCommand,
  showSplat = false,
  showObjectLabels = false,
  showExhibitorNames = false,
  showMeasurements = false,
  onSelectExhibitor,
  onClearSelection,
}: {
  project: Project;
  selectedExhibitorId: string | null;
  cameraCommand: ViewerCameraCommand | null;
  /** El splat se mantiene oculto por defecto en el visor público. */
  showSplat?: boolean;
  /** Etiquetas de código/nombre de los objetos. Ocultas por defecto. */
  showObjectLabels?: boolean;
  /** Nombres flotantes de los expositores sobre sus marcadores. */
  showExhibitorNames?: boolean;
  /** Cotas A/H/F de los objetos del expositor seleccionado. */
  showMeasurements?: boolean;
  onSelectExhibitor: (id: string) => void;
  onClearSelection: () => void;
}) {
  const shadowBounds = useMemo(() => projectBounds(project), [project]);
  const environment = useMemo(
    () => ({ ...project.environment, visible: project.environment.visible && showSplat }),
    [project.environment, showSplat],
  );

  return (
    <div className="three-canvas">
      <Canvas
        shadows="soft"
        dpr={[1, 2]}
        gl={{ antialias: true, powerPreference: 'high-performance' }}
        camera={{
          position: project.camera.position,
          fov: project.camera.fov,
          near: 0.05,
          far: 500,
        }}
        onPointerMissed={onClearSelection}
      >
        <color attach="background" args={['#070a0c']} />
        <fog attach="fog" args={['#070a0c', 38, 130]} />
        <ambientLight color="#aeb9c4" intensity={0.15} />
        <SceneEnvironment intensity={0.06} />
        <SceneShadows quality={project.settings.shadowQuality} />
        <SceneLights
          lights={project.lights}
          shadowQuality={project.settings.shadowQuality}
          shadowBounds={shadowBounds}
        />
        <Architecture project={project} selectedExhibitorId={selectedExhibitorId} />
        <SceneSplat environment={environment} />
        <SceneObjects
          project={project}
          selectedExhibitorId={selectedExhibitorId}
          showLabels={showObjectLabels}
          showMeasurements={showMeasurements}
          onSelectExhibitor={onSelectExhibitor}
        />
        <ExhibitorMarkers
          exhibitors={project.exhibitors}
          project={project}
          selectedId={selectedExhibitorId}
          showLabels={showExhibitorNames}
          onSelect={onSelectExhibitor}
        />
        <ViewerCamera project={project} command={cameraCommand} />
      </Canvas>
    </div>
  );
}
