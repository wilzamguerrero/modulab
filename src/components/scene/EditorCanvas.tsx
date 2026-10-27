import { useEffect, useMemo, useRef } from 'react';
import * as THREE from 'three';
import { Canvas, useThree } from '@react-three/fiber';
import { OrbitControls } from '@react-three/drei';
import type { CatalogItem, Project, Vec2 } from '@/types/project';
import { Architecture } from './Architecture';
import { SceneLights } from './SceneLights';
import { SceneEnvironment } from './SceneEnvironment';
import { SceneShadows } from './SceneShadows';
import { SceneObjects } from './SceneObjects';
import { ExhibitorMarkers } from './ExhibitorMarkers';
import { useEditorStore } from '@/store/editorStore';
import { useUiStore } from '@/store/uiStore';
import { pointInPolygon, polygonBounds, snapPoint } from '@/utils/geometry';
import { getWallById, pointOffsetOnWall, type WallTarget } from '@/utils/walls';

export interface CameraRequest {
  mode: 'project' | 'top';
  nonce: number;
}

function FloorDropHandler() {
  const gl = useThree((state) => state.gl);
  const camera = useThree((state) => state.camera);
  const addObject = useEditorStore((state) => state.addObject);
  const toast = useUiStore((state) => state.toast);

  useEffect(() => {
    const canvas = gl.domElement;
    const raycaster = new THREE.Raycaster();
    const plane = new THREE.Plane(new THREE.Vector3(0, 1, 0), 0);
    const point = new THREE.Vector3();

    const onDragOver = (event: DragEvent) => {
      if (!event.dataTransfer?.types.includes('application/x-modulab-catalog')) return;
      event.preventDefault();
      event.dataTransfer.dropEffect = 'copy';
    };

    const onDrop = (event: DragEvent) => {
      const raw = event.dataTransfer?.getData('application/x-modulab-catalog');
      if (!raw) return;
      event.preventDefault();
      let item: CatalogItem;
      try {
        item = JSON.parse(raw) as CatalogItem;
      } catch {
        return;
      }
      const rect = canvas.getBoundingClientRect();
      const ndc = new THREE.Vector2(
        ((event.clientX - rect.left) / rect.width) * 2 - 1,
        -((event.clientY - rect.top) / rect.height) * 2 + 1,
      );
      raycaster.setFromCamera(ndc, camera);
      if (!raycaster.ray.intersectPlane(plane, point)) return;
      const project = useEditorStore.getState().project;
      if (!project) return;
      if (
        project.floor.vertices.length >= 3 &&
        !pointInPolygon({ x: point.x, z: point.z }, project.floor.vertices)
      ) {
        toast('Suelta el objeto dentro de la planta para colocarlo.', 'warning');
        return;
      }
      const position = project.settings.snapToGrid
        ? snapPoint({ x: point.x, z: point.z }, project.settings.gridSize)
        : { x: point.x, z: point.z };
      const id = addObject(item, position);
      if (id) toast(`«${item.name}» añadido a la escena.`, 'success');
    };

    canvas.addEventListener('dragover', onDragOver);
    canvas.addEventListener('drop', onDrop);
    return () => {
      canvas.removeEventListener('dragover', onDragOver);
      canvas.removeEventListener('drop', onDrop);
    };
  }, [gl, camera, addObject, toast]);

  return null;
}

function CameraRig({ project, request }: { project: Project; request: CameraRequest }) {
  const camera = useThree((state) => state.camera);
  const controls = useThree((state) => state.controls) as
    | { target: THREE.Vector3; update: () => void }
    | null;

  useEffect(() => {
    if (!controls) return;
    controls.target.set(project.camera.target[0], project.camera.target[1], project.camera.target[2]);
    controls.update();
    // Solo al montar: la cámara libre del usuario no debe resetearse con cada cambio.
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [controls]);

  useEffect(() => {
    if (request.mode === 'project') {
      camera.position.set(...project.camera.position);
      if (controls) {
        controls.target.set(...project.camera.target);
        controls.update();
      }
      if ('fov' in camera) {
        camera.fov = project.camera.fov;
        camera.updateProjectionMatrix();
      }
      return;
    }
    const bounds = polygonBounds(project.floor.vertices);
    const fov = 'fov' in camera ? camera.fov : 50;
    const distance = Math.max(bounds.width, bounds.depth, 4) / (2 * Math.tan((fov * Math.PI) / 360)) * 1.15;
    camera.position.set(bounds.center.x, distance, bounds.center.z + 0.02);
    if (controls) {
      controls.target.set(bounds.center.x, 0, bounds.center.z);
      controls.update();
    }
    // Importante: no depender de `project` ni de `project.floor.vertices` como
    // objetos. El store clona el proyecto en cada cambio y eso devolvía la
    // cámara a su posición inicial al mover un objeto o editar una ficha.
    // Solo se reacciona a una petición explícita de cámara o a un cambio real
    // de los valores de la cámara inicial.
  }, [
    request.nonce,
    request.mode,
    camera,
    controls,
    project.camera.position[0],
    project.camera.position[1],
    project.camera.position[2],
    project.camera.target[0],
    project.camera.target[1],
    project.camera.target[2],
    project.camera.fov,
  ]);

  return null;
}

function EditorSceneContents({
  project,
  cameraRequest,
}: {
  project: Project;
  cameraRequest: CameraRequest;
}) {
  const selection = useEditorStore((state) => state.selection);
  const setSelection = useEditorStore((state) => state.setSelection);
  const addObject = useEditorStore((state) => state.addObject);
  const addExhibitor = useEditorStore((state) => state.addExhibitor);
  const addOpening = useEditorStore((state) => state.addOpening);
  const toggleWall = useEditorStore((state) => state.toggleWall);
  const toast = useUiStore((state) => state.toast);
  const shadowBounds = useMemo(
    () => polygonBounds(project.floor.vertices),
    [project.floor.vertices],
  );

  const handleFloorClick = (point: Vec2) => {
    const state = useEditorStore.getState();
    const activeProject = state.project;
    if (!activeProject) return;
    if (state.pendingCatalogItem) {
      const position = activeProject.settings.snapToGrid
        ? snapPoint(point, activeProject.settings.gridSize)
        : point;
      const id = addObject(state.pendingCatalogItem, position);
      if (id) toast(`«${state.pendingCatalogItem.name}» colocado.`, 'success');
      return;
    }
    if (state.tool === 'exhibitor') {
      const position = activeProject.settings.snapToGrid
        ? snapPoint(point, activeProject.settings.gridSize)
        : point;
      addExhibitor(position);
      return;
    }
    if (state.tool === 'wall') {
      toast('Selecciona un muro de la escena para abrirlo o cerrarlo.', 'info');
      return;
    }
    if (state.tool === 'door' || state.tool === 'window') {
      toast('Haz clic sobre un muro para colocar la abertura.', 'info');
      return;
    }
    if (state.tool === 'internalWall') {
      toast('Los muros libres se dibujan en la vista de planta.', 'info');
      return;
    }
    setSelection(null);
  };

  const handleWallClick = (target: WallTarget, point: Vec2) => {
    const state = useEditorStore.getState();
    const activeProject = state.project;
    if (!activeProject) return;
    if (state.tool === 'door' || state.tool === 'window') {
      const wall = getWallById(
        activeProject,
        target.type === 'edge' ? activeProject.edges[target.index]?.id ?? '' : target.id,
      );
      if (!wall) return;
      addOpening(wall.id, state.tool, pointOffsetOnWall(point, wall.a, wall.b));
      return;
    }
    if (state.tool === 'wall' && target.type === 'edge') {
      toggleWall(target.index);
      setSelection({ type: 'edge', index: target.index });
      return;
    }
    setSelection(
      target.type === 'edge'
        ? { type: 'edge', index: target.index }
        : { type: 'internalWall', id: target.id },
    );
  };

  return (
    <>
      <color attach="background" args={['#0a0d10']} />
      <fog attach="fog" args={['#0a0d10', 35, 120]} />
      <ambientLight color="#aeb9c4" intensity={0.22} />
      <SceneEnvironment intensity={0.06} />
      <SceneShadows quality={project.settings.shadowQuality} />
      <SceneLights
        lights={project.lights}
        editor
        selectedLightId={selection?.type === 'light' ? selection.id : null}
        onSelectLight={(id) => setSelection({ type: 'light', id })}
        shadowQuality={project.settings.shadowQuality}
        shadowBounds={shadowBounds}
      />
      <gridHelper args={[80, 80, '#1d252d', '#12181d']} position={[0, -0.015, 0]} />
      <Architecture
        project={project}
        onFloorClick={handleFloorClick}
        onWallClick={handleWallClick}
      />
      <SceneObjects
        project={project}
        editable
        selectedObjectId={selection?.type === 'object' ? selection.id : null}
        onSelectObject={(id) => setSelection({ type: 'object', id })}
      />
      <ExhibitorMarkers
        exhibitors={project.exhibitors}
        editor
        selectedId={selection?.type === 'exhibitor' ? selection.id : null}
        onSelect={(id) => setSelection({ type: 'exhibitor', id })}
      />
      <OrbitControls
        makeDefault
        enableDamping
        dampingFactor={0.08}
        minDistance={1}
        maxDistance={140}
        maxPolarAngle={Math.PI / 2 - 0.015}
      />
      <CameraRig project={project} request={cameraRequest} />
      <FloorDropHandler />
    </>
  );
}

export function EditorCanvas({
  project,
  cameraRequest,
}: {
  project: Project;
  cameraRequest: CameraRequest;
}) {
  const camera = useMemo(
    () => ({
      position: project.camera.position,
      fov: project.camera.fov,
      near: 0.05,
      far: 500,
    }),
    // La cámara inicial solo se usa al montar el Canvas; los cambios se aplican con CameraRig.
    // eslint-disable-next-line react-hooks/exhaustive-deps
    [],
  );

  return (
    <div className="three-canvas">
      <Canvas
        shadows="soft"
        dpr={[1, 2]}
        gl={{ antialias: true, powerPreference: 'high-performance' }}
        camera={camera}
        onPointerMissed={() => {
          const state = useEditorStore.getState();
          if (!state.pendingCatalogItem) state.setSelection(null);
        }}
      >
        <EditorSceneContents project={project} cameraRequest={cameraRequest} />
      </Canvas>
    </div>
  );
}
