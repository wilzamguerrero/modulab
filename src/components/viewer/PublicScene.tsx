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
import { polygonBounds } from '@/utils/geometry';

export interface ViewerCameraCommand {
  mode: 'reset' | 'focus' | 'top';
  nonce: number;
  position?: Vec3;
  target?: Vec3;
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

    if (command.mode === 'focus' && command.position && command.target) {
      controls.setLookAt(
        command.position[0],
        command.position[1],
        command.position[2],
        command.target[0],
        command.target[1],
        command.target[2],
        animate,
      );
      return;
    }

    if (command.mode === 'top') {
      const bounds = polygonBounds(project.floor.vertices);
      const height = Math.max(bounds.width, bounds.depth, 6) * 1.25 + 5;
      controls.setLookAt(
        bounds.center.x,
        height,
        bounds.center.z + 0.02,
        bounds.center.x,
        0,
        bounds.center.z,
        animate,
      );
      return;
    }

    controls.setLookAt(
      project.camera.position[0],
      project.camera.position[1],
      project.camera.position[2],
      project.camera.target[0],
      project.camera.target[1],
      project.camera.target[2],
      animate,
    );
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
  onSelectExhibitor,
  onClearSelection,
}: {
  project: Project;
  selectedExhibitorId: string | null;
  cameraCommand: ViewerCameraCommand;
  onSelectExhibitor: (id: string) => void;
  onClearSelection: () => void;
}) {
  const shadowBounds = useMemo(
    () => polygonBounds(project.floor.vertices),
    [project.floor.vertices],
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
        <Architecture project={project} />
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
