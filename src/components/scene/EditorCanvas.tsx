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
import { RotationPointMarkers } from './RotationPointMarkers';
import { SceneSplat } from './SceneSplat';
import { MeasurementLayer } from './MeasurementLayer';
import { MeasurementTool } from './MeasurementTool';
import { MeasurementGizmo } from './MeasurementGizmo';
import { WallEditHandles } from './WallEditHandles';
import { useEditorStore } from '@/store/editorStore';
import { useUiStore } from '@/store/uiStore';
import { pointInPolygon, polygonBounds, snapPoint } from '@/utils/geometry';
import { getWallById, pointOffsetOnWall, type WallTarget } from '@/utils/walls';
import { isSceneDragClickBlocked } from './sceneDragGuard';

export type EditorViewMode =
  | 'project'
  | 'top'
  | 'front'
  | 'back'
  | 'left'
  | 'right'
  | 'iso';

export interface CameraRequest {
  mode: EditorViewMode;
  nonce: number;
}

/** Campo de visión reducido que emula una proyección ortográfica. */
const ORTHO_FOV = 6;

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

function CameraRig({
  project,
  request,
  orthographic,
}: {
  project: Project;
  request: CameraRequest;
  orthographic: boolean;
}) {
  const camera = useThree((state) => state.camera) as THREE.PerspectiveCamera;
  const controls = useThree((state) => state.controls) as
    | { target: THREE.Vector3; update: () => void }
    | null;
  const activeFov = orthographic ? ORTHO_FOV : project.camera.fov;
  const activeFovRef = useRef(activeFov);
  activeFovRef.current = activeFov;

  useEffect(() => {
    if (!controls) return;
    controls.target.set(project.camera.target[0], project.camera.target[1], project.camera.target[2]);
    controls.update();
    // Solo al montar: la cámara libre del usuario no debe resetearse con cada cambio.
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [controls]);

  // Alternar perspectiva ↔ ortográfica conservando el encuadre aparente.
  useEffect(() => {
    if (!controls || !('fov' in camera)) return;
    if (Math.abs(camera.fov - activeFov) < 1e-4) return;
    const offset = camera.position.clone().sub(controls.target);
    const distance = Math.max(offset.length(), 0.001);
    const ratio =
      Math.tan((camera.fov * Math.PI) / 360) / Math.tan((activeFov * Math.PI) / 360);
    offset.setLength(distance * ratio);
    camera.position.copy(controls.target).add(offset);
    camera.fov = activeFov;
    camera.updateProjectionMatrix();
    controls.update();
  }, [orthographic, activeFov, camera, controls]);

  useEffect(() => {
    const bounds = polygonBounds(project.floor.vertices);
    const center = bounds.center;
    const fov = activeFovRef.current;
    const fovRad = (fov * Math.PI) / 180;
    // Distancia que encuadra el recinto con el FOV activo.
    const fit =
      (Math.max(bounds.width, bounds.depth, 4) / (2 * Math.tan(fovRad / 2))) * 1.35;
    const eyeX = center.x;
    const eyeZ = center.z;
    const eyeY = 1.6;
    let position: [number, number, number];
    let target: [number, number, number];

    switch (request.mode) {
      case 'project': {
        const dir = new THREE.Vector3(
          project.camera.position[0] - project.camera.target[0],
          project.camera.position[1] - project.camera.target[1],
          project.camera.position[2] - project.camera.target[2],
        );
        if (dir.lengthSq() < 1e-6) dir.set(0.7, 0.7, 0.7);
        dir.normalize();
        target = [...project.camera.target];
        position = [
          target[0] + dir.x * fit,
          target[1] + dir.y * fit,
          target[2] + dir.z * fit,
        ];
        break;
      }
      case 'top':
        target = [eyeX, 0, eyeZ];
        position = [eyeX, fit, eyeZ + 0.001];
        break;
      case 'front':
        target = [eyeX, eyeY * 0.72, eyeZ];
        position = [eyeX, eyeY, eyeZ + fit];
        break;
      case 'back':
        target = [eyeX, eyeY * 0.72, eyeZ];
        position = [eyeX, eyeY, eyeZ - fit];
        break;
      case 'left':
        target = [eyeX, eyeY * 0.72, eyeZ];
        position = [eyeX - fit, eyeY, eyeZ];
        break;
      case 'right':
        target = [eyeX, eyeY * 0.72, eyeZ];
        position = [eyeX + fit, eyeY, eyeZ];
        break;
      case 'iso':
      default:
        target = [eyeX, 1, eyeZ];
        position = [eyeX + fit * 0.62, eyeY + fit * 0.62, eyeZ + fit * 0.62];
        break;
    }

    camera.position.set(position[0], position[1], position[2]);
    if ('fov' in camera) {
      camera.fov = fov;
      camera.updateProjectionMatrix();
    }
    if (controls) {
      controls.target.set(target[0], target[1], target[2]);
      controls.update();
    }
    // Importante: no depender de `project` ni de `project.floor.vertices` como
    // objetos. El store clona el proyecto en cada cambio y eso devolvía la
    // cámara a su posición inicial al mover un objeto o editar una ficha.
    // Solo se reacciona a una petición explícita de cámara.
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
  ]);

  return null;
}

function DebugBridge() {
  const camera = useThree((state) => state.camera);
  const scene = useThree((state) => state.scene);
  const gl = useThree((state) => state.gl);
  const controls = useThree((state) => state.controls) as
    | { target?: THREE.Vector3 }
    | null;

  useEffect(() => {
    if (!import.meta.env.DEV) return;
    const projectPoint = (point: [number, number, number]) => {
      const vector = new THREE.Vector3(point[0], point[1], point[2]).project(camera);
      const rect = gl.domElement.getBoundingClientRect();
      return {
        x: rect.left + (vector.x * 0.5 + 0.5) * rect.width,
        y: rect.top + (-vector.y * 0.5 + 0.5) * rect.height,
        z: vector.z,
      };
    };
    const debug = {
      camera: () => ({
        position: camera.position.toArray(),
        target: controls?.target?.toArray() ?? null,
      }),
      project: projectPoint,
      handles: () => {
        const result: Array<{
          label: string;
          world: number[];
          screen: { x: number; y: number; z: number };
        }> = [];
        scene.traverse((object) => {
          const label = object.userData?.modulabHandle;
          if (typeof label !== 'string') return;
          const world = object.getWorldPosition(new THREE.Vector3()).toArray();
          result.push({
            label,
            world,
            screen: projectPoint(world as [number, number, number]),
          });
        });
        return result;
      },
    };
    (window as unknown as { __modulabDebug?: typeof debug }).__modulabDebug = debug;
    return () => {
      if ((window as unknown as { __modulabDebug?: typeof debug }).__modulabDebug === debug) {
        delete (window as unknown as { __modulabDebug?: typeof debug }).__modulabDebug;
      }
    };
  }, [camera, controls, gl, scene]);

  return null;
}

function EditorSceneContents({
  project,
  cameraRequest,
  orthographic,
  active,
}: {
  project: Project;
  cameraRequest: CameraRequest;
  orthographic: boolean;
  active: boolean;
}) {
  const selection = useEditorStore((state) => state.selection);
  const setSelection = useEditorStore((state) => state.setSelection);
  const environmentPreview = useEditorStore((state) => state.environmentPreview);
  const environmentGizmo = useEditorStore((state) => state.environmentGizmo);
  const environmentGizmoMode = useEditorStore((state) => state.environmentGizmoMode);
  const setEnvironment = useEditorStore((state) => state.setEnvironment);
  const addObject = useEditorStore((state) => state.addObject);
  const addExhibitor = useEditorStore((state) => state.addExhibitor);
  const addRotationPoint = useEditorStore((state) => state.addRotationPoint);
  const addOpening = useEditorStore((state) => state.addOpening);
  const toggleWall = useEditorStore((state) => state.toggleWall);
  const toast = useUiStore((state) => state.toast);
  const shadowBounds = useMemo(
    () => polygonBounds(project.floor.vertices),
    [project.floor.vertices],
  );

  // La vista previa local (blob) tiene prioridad sobre la URL guardada.
  const sceneEnvironment = environmentPreview
    ? {
        ...project.environment,
        url: environmentPreview.url,
        format: environmentPreview.format ?? project.environment.format,
      }
    : project.environment;

  const handleFloorClick = (point: Vec2) => {
    // Un clic que cierra el arrastre de un gizmo no debe deseleccionar el objeto.
    if (isSceneDragClickBlocked()) return;
    const state = useEditorStore.getState();
    const activeProject = state.project;
    if (!activeProject) return;
    // La medida se gestiona con el picking global de MeasurementTool.
    if (state.measureMode) return;
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
    if (state.tool === 'rotationPoint') {
      const position = activeProject.settings.snapToGrid
        ? snapPoint(point, activeProject.settings.gridSize)
        : point;
      addRotationPoint(position);
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

  const selectedExhibitorId = selection?.type === 'exhibitor' ? selection.id : null;

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
        selectedExhibitorId={selectedExhibitorId}
        onFloorClick={handleFloorClick}
        onWallClick={handleWallClick}
        onOpeningClick={(id) => setSelection({ type: 'opening', id })}
      />
      <SceneSplat
        environment={sceneEnvironment}
        editable
        gizmoMode={environmentGizmo ? environmentGizmoMode : null}
        onTransform={(position, rotation, scale) => setEnvironment({ position, rotation, scale })}
      />
      <MeasurementLayer />
      <MeasurementTool />
      {active ? <MeasurementGizmo /> : null}
      <SceneObjects
        project={project}
        editable
        selectedObjectId={selection?.type === 'object' ? selection.id : null}
        selectedExhibitorId={selectedExhibitorId}
        onSelectObject={(id) => setSelection({ type: 'object', id })}
      />
      <WallEditHandles />
      <ExhibitorMarkers
        exhibitors={project.exhibitors}
        editor
        selectedId={selection?.type === 'exhibitor' ? selection.id : null}
        onSelect={(id) => setSelection({ type: 'exhibitor', id })}
      />
      <RotationPointMarkers
        points={project.rotationPoints}
        editor
        selectedId={selection?.type === 'rotationPoint' ? selection.id : null}
        onSelect={(id) => setSelection({ type: 'rotationPoint', id })}
      />
      <OrbitControls
        makeDefault
        enableDamping
        dampingFactor={0.08}
        minDistance={1}
        maxDistance={orthographic ? 4000 : 140}
        maxPolarAngle={Math.PI / 2 - 0.015}
      />
      <CameraRig project={project} request={cameraRequest} orthographic={orthographic} />
      <FloorDropHandler />
      <DebugBridge />
    </>
  );
}

export function EditorCanvas({
  project,
  cameraRequest,
  active = true,
  orthographic = false,
}: {
  project: Project;
  cameraRequest: CameraRequest;
  /** Mantiene el canvas montado pero pausa el render cuando la vista 2D lo cubre. */
  active?: boolean;
  /** Proyección casi ortográfica para ver la escena como en programas 3D. */
  orthographic?: boolean;
}) {
  const camera = useMemo(
    () => ({
      position: project.camera.position,
      fov: project.camera.fov,
      near: 0.05,
      far: 2000,
    }),
    // La cámara inicial solo se usa al montar el Canvas; los cambios se aplican con CameraRig.
    // eslint-disable-next-line react-hooks/exhaustive-deps
    [],
  );

  return (
    <div className="three-canvas" aria-hidden={!active}>
      <Canvas
        shadows="soft"
        dpr={[1, 2]}
        gl={{ antialias: true, powerPreference: 'high-performance' }}
        camera={camera}
        frameloop={active ? 'always' : 'demand'}
        onPointerMissed={() => {
          const state = useEditorStore.getState();
          if (state.pendingCatalogItem) return;
          state.setSelection(null);
          // Al hacer clic en el vacío se deselecciona la medida y su gizmo.
          state.setActiveMeasurement(null);
        }}
      >
        <EditorSceneContents
          project={project}
          cameraRequest={cameraRequest}
          orthographic={orthographic}
          active={active}
        />
      </Canvas>
    </div>
  );
}
