import { useEffect, useMemo, useRef } from 'react';
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
import { polygonBounds } from '@/utils/geometry';

export interface ViewerCameraCommand {
  mode: 'reset' | 'focus' | 'top';
  nonce: number;
  position?: Vec3;
  target?: Vec3;
  /** Punto de rotación intermedio por el que pasa la cámara antes del destino. */
  via?: { position: Vec3; target: Vec3 };
}

function ViewerCamera({
  project,
  command,
}: {
  project: Project;
  command: ViewerCameraCommand;
}) {
  const controlsRef = useRef<CameraControlsImpl>(null);

  useEffect(() => {
    const controls = controlsRef.current;
    if (!controls) return;
    const animate = command.nonce > 0;

    let position: [number, number, number] | undefined;
    let target: [number, number, number] | undefined;

    if (command.mode === 'focus' && command.position && command.target) {
      position = command.position;
      target = command.target;
    } else if (command.mode === 'top') {
      const bounds = polygonBounds(project.floor.vertices);
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

    if (command.via && animate) {
      let cancelled = false;
      goTo(command.via.position, command.via.target)
        .then(() => {
          if (!cancelled) return goTo(position, target);
          return undefined;
        })
        .catch(() => {
          if (!cancelled) goTo(position, target);
        });
      return () => {
        cancelled = true;
      };
    }

    goTo(position, target);
    return undefined;
  }, [command, project]);

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
  onSelectExhibitor,
  onClearSelection,
}: {
  project: Project;
  selectedExhibitorId: string | null;
  cameraCommand: ViewerCameraCommand;
  /** El splat se mantiene oculto por defecto en el visor público. */
  showSplat?: boolean;
  onSelectExhibitor: (id: string) => void;
  onClearSelection: () => void;
}) {
  const shadowBounds = useMemo(
    () => polygonBounds(project.floor.vertices),
    [project.floor.vertices],
  );
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
          onSelectExhibitor={onSelectExhibitor}
        />
        <ExhibitorMarkers
          exhibitors={project.exhibitors}
          selectedId={selectedExhibitorId}
          onSelect={onSelectExhibitor}
        />
        <ViewerCamera project={project} command={cameraCommand} />
      </Canvas>
    </div>
  );
}
