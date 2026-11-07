import { useEffect, useMemo, useRef } from 'react';
import * as THREE from 'three';
import { Canvas, useFrame, useThree } from '@react-three/fiber';
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
import { LevelGizmo } from './LevelGizmo';
import { MeasurementLayer } from './MeasurementLayer';
import { MeasurementTool } from './MeasurementTool';
import { MeasurementGizmo } from './MeasurementGizmo';
import { WallEditHandles } from './WallEditHandles';
import { useEditorStore } from '@/store/editorStore';
import { useUiStore } from '@/store/uiStore';
import { pointInPolygon, snapPoint } from '@/utils/geometry';
import {
  findWallInProject,
  pointOffsetOnWall,
  type WallTarget,
} from '@/utils/walls';
import {
  getLevel,
  levelElevation,
  pointInLevel,
  projectBounds,
} from '@/utils/levels';
import {
  clearPressedHandle,
  clickStartedOnGizmo,
  getPressedHandle,
  isSceneDragClickBlocked,
  markSceneClickHandled,
  notifyScenePointerDown,
  pickElementAt,
  setClickCandidates,
} from './sceneDragGuard';
import { levelElevationMap } from '@/utils/levels';

export type EditorViewMode =
  | 'project'
  | 'top'
  | 'front'
  | 'back'
  | 'left'
  | 'right'
  | 'iso';

export interface CameraRequest {
  mode: EditorViewMode | 'custom';
  nonce: number;
  /** Encuadre exacto para `mode: 'custom'` (vistas de lectura). */
  position?: [number, number, number];
  target?: [number, number, number];
}

/**
 * Niebla adaptativa: se aleja con la cámara para que las vistas lejanas y
 * ortográficas no oscurezcan toda la escena (como en Blender/Maya).
 */
function AdaptiveFog() {
  const camera = useThree((state) => state.camera);
  const controls = useThree((state) => state.controls) as { target?: THREE.Vector3 } | null;
  const fogRef = useRef<THREE.Fog | null>(null);

  useFrame(() => {
    const fog = fogRef.current;
    if (!fog) return;
    // En proyección ortográfica la cámara se ubica lejos pero sin perspectiva:
    // la niebla por distancia oscurecería la escena, así que se desactiva.
    if ((camera as THREE.OrthographicCamera).isOrthographicCamera) {
      fog.near = 1e6;
      fog.far = 2e6;
      return;
    }
    const distance = controls?.target
      ? camera.position.distanceTo(controls.target)
      : camera.position.length();
    fog.near = Math.max(35, distance * 0.9);
    fog.far = Math.max(160, distance * 2.6);
  });

  return <fog ref={fogRef} attach="fog" args={['#0a0d10', 35, 160]} />;
}

/** Activa/desactiva el modo alámbrico en la geometría de la escena. */
function WireframeController() {
  const scene = useThree((state) => state.scene);
  const wireframe = useUiStore((state) => state.wireframe);
  const project = useEditorStore((state) => state.project);

  useEffect(() => {
    const materials = new Set<THREE.Material>();
    scene.traverse((object) => {
      const mesh = object as THREE.Mesh;
      if (!mesh.isMesh) return;
      const list = Array.isArray(mesh.material) ? mesh.material : [mesh.material];
      for (const material of list) {
        if (!material) continue;
        const standard = material as THREE.MeshStandardMaterial;
        if (!standard.isMeshStandardMaterial && !(standard as unknown as { isMeshPhysicalMaterial?: boolean }).isMeshPhysicalMaterial) {
          continue;
        }
        materials.add(material);
      }
    });
    for (const material of materials) {
      const standard = material as THREE.MeshStandardMaterial;
      if (standard.wireframe !== wireframe) {
        standard.wireframe = wireframe;
        standard.needsUpdate = true;
      }
    }
  }, [wireframe, scene, project]);

  return null;
}

/**
 * Cuadrícula estilo Maya. En perspectiva se dibuja en el suelo (XZ), como en
 * cualquier visor 3D. En proyección ortográfica se alinea al plano de la
 * pantalla (perpendicular a la cámara), de modo que se ve plana y de frente en
 * cualquier vista: en frontal queda como un plano vertical XY, en perfil como
 * YZ y en superior como el suelo XZ. Como no se ve en fuga, deja de parecer
 * una cuadrícula en perspectiva.
 */
function SceneGrid({ orthographic }: { orthographic: boolean }) {
  const camera = useThree((state) => state.camera);
  const controls = useThree((state) => state.controls) as { target?: THREE.Vector3 } | null;
  const gridRef = useRef<THREE.GridHelper>(null);
  const basis = useMemo(
    () => ({
      right: new THREE.Vector3(),
      up: new THREE.Vector3(),
      back: new THREE.Vector3(),
      matrix: new THREE.Matrix4(),
    }),
    [],
  );

  useEffect(() => {
    const grid = gridRef.current;
    if (!grid) return;
    const material = grid.material as THREE.LineBasicMaterial;
    material.fog = false;
    material.needsUpdate = true;
  }, []);

  useFrame(() => {
    const grid = gridRef.current;
    if (!grid) return;
    const target = controls?.target;
    const tx = target?.x ?? 0;
    const ty = target?.y ?? 0;
    const tz = target?.z ?? 0;

    if (!orthographic) {
      // Perspectiva: cuadrícula del suelo centrada en la XZ del objetivo.
      grid.position.set(tx, -0.015, tz);
      grid.quaternion.identity();
      return;
    }

    // Ortográfica: cuadrícula alineada al plano de la pantalla. La grilla local
    // vive en XZ con normal +Y; mapeamos su X a la derecha de la cámara, su Y a
    // la normal (hacia la cámara) y su Z al "arriba" de la cámara negado, así
    // queda plana y de frente. La base resultante es dextrógira para que el
    // giro sea una rotación válida.
    camera.updateMatrixWorld();
    const e = camera.matrixWorld.elements;
    basis.right.set(e[0], e[1], e[2]);
    basis.back.set(e[8], e[9], e[10]);
    basis.up.set(e[4], e[5], e[6]).negate();
    basis.matrix.makeBasis(basis.right, basis.back, basis.up);
    grid.quaternion.setFromRotationMatrix(basis.matrix);
    grid.position.set(tx, ty, tz);
  });

  return <gridHelper ref={gridRef} args={[160, 160, '#2b3640', '#161d23']} />;
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
      const state = useEditorStore.getState();
      const project = state.project;
      if (!project) return;
      const activeLevel = getLevel(project, state.activeLevelId);
      const elevation = levelElevation(project, state.activeLevelId);
      plane.constant = -elevation;
      raycaster.setFromCamera(ndc, camera);
      if (!raycaster.ray.intersectPlane(plane, point)) return;
      if (activeLevel && !pointInLevel(activeLevel, { x: point.x, z: point.z })) {
        toast('Suelta el objeto dentro de la planta del nivel activo.', 'warning');
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
  const set = useThree((state) => state.set);
  const size = useThree((state) => state.size);
  const defaultCamera = useThree((state) => state.camera);
  const controls = useThree((state) => state.controls) as
    | { target: THREE.Vector3; update: () => void }
    | null;

  const fov = project.camera.fov;
  const fovRad = (fov * Math.PI) / 180;
  const aspect = size.width / Math.max(size.height, 1);

  // Cámara en perspectiva original del Canvas (se conserva para alternar).
  const perspRef = useRef<THREE.PerspectiveCamera | null>(null);
  // Cámara ortográfica real: proyección paralela, sin convergencia de muros.
  const orthoCam = useMemo(
    () => new THREE.OrthographicCamera(-1, 1, 1, -1, 0.05, 8000),
    [],
  );
  const halfHeightRef = useRef(5);
  // Último objetivo conocido: sirve para restaurarlo cuando OrbitControls se
  // recrea al cambiar de cámara (su target vuelve a (0,0,0)).
  const lastTargetRef = useRef(new THREE.Vector3(...project.camera.target));
  const syncedControlsRef = useRef(controls);

  const applyOrthoFrustum = (halfHeight: number) => {
    const h = Math.max(0.05, halfHeight);
    halfHeightRef.current = h;
    const halfW = h * aspect;
    orthoCam.left = -halfW;
    orthoCam.right = halfW;
    orthoCam.top = h;
    orthoCam.bottom = -h;
    orthoCam.updateProjectionMatrix();
  };

  // Guarda la cámara en perspectiva del Canvas una sola vez.
  useEffect(() => {
    if (!perspRef.current && defaultCamera instanceof THREE.PerspectiveCamera) {
      perspRef.current = defaultCamera;
    }
  }, [defaultCamera]);

  // Restaura el objetivo en un OrbitControls recién creado y recuerda cuál es
  // el activo para no leer su target temporal (0,0,0) en el primer frame.
  useEffect(() => {
    if (!controls) return;
    controls.target.copy(lastTargetRef.current);
    controls.update();
    syncedControlsRef.current = controls;
  }, [controls]);

  useFrame(() => {
    if (controls && controls === syncedControlsRef.current) {
      lastTargetRef.current.copy(controls.target);
    }
    // La cámara activa se publica en el store para que «Guardar vista de
    // lectura» pueda capturar exactamente el encuadre que se está viendo.
    const cam = defaultCamera;
    if (!cam) return;
    const fov = cam instanceof THREE.PerspectiveCamera ? cam.fov : project.camera.fov;
    const previous = useEditorStore.getState().editorCameraView;
    const position = [cam.position.x, cam.position.y, cam.position.z] as [number, number, number];
    const target = [lastTargetRef.current.x, lastTargetRef.current.y, lastTargetRef.current.z] as [
      number,
      number,
      number,
    ];
    const changed =
      Math.abs(previous.position[0] - position[0]) > 1e-3 ||
      Math.abs(previous.position[1] - position[1]) > 1e-3 ||
      Math.abs(previous.position[2] - position[2]) > 1e-3 ||
      Math.abs(previous.target[0] - target[0]) > 1e-3 ||
      Math.abs(previous.target[1] - target[1]) > 1e-3 ||
      Math.abs(previous.target[2] - target[2]) > 1e-3 ||
      Math.abs(previous.fov - fov) > 0.01;
    if (changed) {
      useEditorStore.getState().setEditorCameraView({ position, target, fov });
    }
  });

  // Intercambia la cámara activa conservando el punto de vista y el objetivo.
  useEffect(() => {
    const persp = perspRef.current;
    if (!persp) return;
    const desired: THREE.PerspectiveCamera | THREE.OrthographicCamera = orthographic
      ? orthoCam
      : persp;
    if (defaultCamera === desired) {
      if (orthographic) applyOrthoFrustum(halfHeightRef.current);
      return;
    }
    const target = lastTargetRef.current.clone();
    const from = defaultCamera;
    desired.position.copy(from.position);
    desired.up.copy(from.up);
    desired.lookAt(target);
    if (orthographic) {
      // Perspectiva → ortográfica: mismo tamaño aparente a la distancia actual.
      const distance = from.position.distanceTo(target);
      applyOrthoFrustum(distance * Math.tan(fovRad / 2));
    } else if (desired instanceof THREE.PerspectiveCamera) {
      // Ortográfica → perspectiva: ajusta la distancia para igualar la altura
      // visible que tenía el frustum ortográfico.
      const targetDist = Math.max(0.05, halfHeightRef.current / Math.tan(fovRad / 2));
      const dir = desired.position.clone().sub(target);
      if (dir.lengthSq() < 1e-6) dir.set(0.7, 0.7, 0.7);
      dir.setLength(targetDist);
      desired.position.copy(target).add(dir);
      desired.up.set(0, 1, 0);
      desired.lookAt(target);
      desired.aspect = aspect;
      desired.fov = fov;
      desired.updateProjectionMatrix();
    }
    set({ camera: desired });
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [orthographic, defaultCamera]);

  // Encuadra la cámara ante una petición explícita de vista.
  useEffect(() => {
    const bounds = projectBounds(project);
    const center = bounds.center;
    const span = Math.max(bounds.width, bounds.depth, 4);
    const eyeX = center.x;
    const eyeZ = center.z;
    const eyeY = 1.6;
    const showH = 3.4;

    // Distancias de posicionamiento (la ortográfica no escala con la distancia,
    // así que se aleja lo suficiente para no recortar la escena).
    const perspDist = (span / (2 * Math.tan(fovRad / 2))) * 1.35;
    // La ortográfica no escala con la distancia: basta separarla lo justo para
    // dejar la escena delante del plano cercano (sin activar la niebla).
    const orthoDist = span * 1.5 + 30;
    const dist = orthographic ? orthoDist : perspDist;

    let position: [number, number, number];
    let target: [number, number, number];
    let fitW = span;
    let fitH = showH;

    switch (request.mode) {
      case 'custom': {
        // Vista de lectura: se aplica tal cual se guardó, sin reencuadrar.
        target = request.target ?? [...project.camera.target];
        position = request.position ?? [...project.camera.position];
        fitW = span;
        fitH = showH;
        break;
      }
      case 'project': {
        // Restaura exactamente la cámara guardada del proyecto.
        target = [...project.camera.target];
        position = [...project.camera.position];
        fitW = span;
        fitH = showH;
        break;
      }
      case 'top':
        target = [eyeX, 0, eyeZ];
        position = [eyeX, dist, eyeZ + 0.0001];
        fitW = bounds.width;
        fitH = bounds.depth;
        break;
      // Vistas ortogonales horizontales: cámara y objetivo a la misma altura
      // para que la cuadrícula quede perfectamente de frente (como en Maya).
      case 'front':
        target = [eyeX, eyeY, eyeZ];
        position = [eyeX, eyeY, eyeZ + dist];
        fitW = bounds.width;
        fitH = showH;
        break;
      case 'back':
        target = [eyeX, eyeY, eyeZ];
        position = [eyeX, eyeY, eyeZ - dist];
        fitW = bounds.width;
        fitH = showH;
        break;
      case 'left':
        target = [eyeX, eyeY, eyeZ];
        position = [eyeX - dist, eyeY, eyeZ];
        fitW = bounds.depth;
        fitH = showH;
        break;
      case 'right':
        target = [eyeX, eyeY, eyeZ];
        position = [eyeX + dist, eyeY, eyeZ];
        fitW = bounds.depth;
        fitH = showH;
        break;
      case 'iso':
      default:
        target = [eyeX, 1, eyeZ];
        position = [eyeX + dist * 0.62, eyeY + dist * 0.62, eyeZ + dist * 0.62];
        fitW = span * 0.95;
        fitH = span * 0.95;
        break;
    }

    const cam: THREE.Camera | null = orthographic ? orthoCam : perspRef.current;
    if (cam) {
      cam.position.set(position[0], position[1], position[2]);
      cam.up.set(0, 1, 0);
      cam.lookAt(target[0], target[1], target[2]);
      if (cam instanceof THREE.PerspectiveCamera) {
        cam.aspect = aspect;
        cam.fov = fov;
        cam.updateProjectionMatrix();
      }
    }
    if (orthographic) {
      let halfW = fitW / 2;
      let halfH = fitH / 2;
      if (halfW / halfH < aspect) halfW = halfH * aspect;
      else halfH = halfW / aspect;
      applyOrthoFrustum(halfH * 1.12);
    }
    lastTargetRef.current.set(target[0], target[1], target[2]);
    if (controls) {
      controls.target.set(target[0], target[1], target[2]);
      controls.update();
      syncedControlsRef.current = controls;
    }
    // Importante: no depender de `project` ni de `project.floor.vertices` como
    // objetos. El store clona el proyecto en cada cambio y eso devolvía la
    // cámara a su posición inicial al mover un objeto o editar una ficha.
    // Solo se reacciona a una petición explícita de cámara.
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [request.nonce]);

  // Mantén el aspecto correcto al redimensionar (ortográfica y perspectiva).
  useEffect(() => {
    if (orthographic) applyOrthoFrustum(halfHeightRef.current);
    else if (perspRef.current) {
      perspRef.current.aspect = aspect;
      perspRef.current.updateProjectionMatrix();
    }
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [size.width, size.height, orthographic]);

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
  showExhibitorNames,
  showObjectLabels,
}: {
  project: Project;
  cameraRequest: CameraRequest;
  orthographic: boolean;
  active: boolean;
  showExhibitorNames: boolean;
  showObjectLabels: boolean;
}) {
  const selection = useEditorStore((state) => state.selection);
  const setSelection = useEditorStore((state) => state.setSelection);
  const environmentPreview = useEditorStore((state) => state.environmentPreview);
  const environmentGizmo = useEditorStore((state) => state.environmentGizmo);
  const environmentGizmoMode = useEditorStore((state) => state.environmentGizmoMode);
  const levelGizmoMode = useEditorStore((state) => state.levelGizmoMode);
  const levelGizmoId = useEditorStore((state) => state.levelGizmoId);
  const setEnvironment = useEditorStore((state) => state.setEnvironment);
  const addObject = useEditorStore((state) => state.addObject);
  const addExhibitor = useEditorStore((state) => state.addExhibitor);
  const addRotationPoint = useEditorStore((state) => state.addRotationPoint);
  const addOpening = useEditorStore((state) => state.addOpening);
  const addStair = useEditorStore((state) => state.addStair);
  const toggleWall = useEditorStore((state) => state.toggleWall);
  const setActiveLevel = useEditorStore((state) => state.setActiveLevel);
  const setActiveSpace = useEditorStore((state) => state.setActiveSpace);
  const toast = useUiStore((state) => state.toast);
  const shadowBounds = useMemo(() => projectBounds(project), [project]);
  const gizmoLevel = levelGizmoId
    ? project.levels.find((level) => level.id === levelGizmoId) ?? null
    : null;

  // La vista previa local (blob) tiene prioridad sobre la URL guardada.
  const sceneEnvironment = environmentPreview
    ? {
        ...project.environment,
        url: environmentPreview.url,
        format: environmentPreview.format ?? project.environment.format,
      }
    : project.environment;

  const handleFloorClick = (
    point: Vec2,
    target: { levelId: string; spaceId: string },
  ) => {
    // Un clic que cierra el arrastre de un gizmo no debe deseleccionar el objeto.
    if (isSceneDragClickBlocked()) return;
    const state = useEditorStore.getState();
    const activeProject = state.project;
    if (!activeProject) return;
    // La medida se gestiona con el picking global de MeasurementTool.
    if (state.measureMode) return;
    // Al hacer clic en el suelo se activa ese nivel/espacio para colocar en él.
    if (state.activeLevelId !== target.levelId) setActiveLevel(target.levelId);
    if (state.activeSpaceId !== target.spaceId) setActiveSpace(target.spaceId);
    if (state.tool === 'stair') {
      const position = activeProject.settings.snapToGrid
        ? snapPoint(point, activeProject.settings.gridSize)
        : point;
      addStair(position);
      return;
    }
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
    // Clic dentro de un hueco del nivel activo: lo selecciona para editarlo.
    if (state.tool === 'select') {
      const level = activeProject.levels.find((entry) => entry.id === state.activeLevelId)
        ?? activeProject.levels[0];
      const hole = level?.spaces
        .flatMap((space) => space.holes.map((entry) => ({ hole: entry, space })))
        .find(({ hole: entry, space }) =>
          space.vertices.length >= 3
          && pointInPolygon(point, space.vertices)
          && pointInPolygon(point, entry.vertices),
        );
      if (hole) {
        setActiveSpace(hole.space.id);
        setSelection({ type: 'hole', id: hole.hole.id, spaceId: hole.space.id });
        return;
      }
      // Clic sobre el forjado en modo selección: se activa el piso y su gizmo, que
      // ya lo enciende `setSelection` al seleccionar un nivel.
      setSelection({ type: 'level', id: target.levelId });
      return;
    }
    setSelection(null);
  };

  const selectedExhibitorId = selection?.type === 'exhibitor' ? selection.id : null;

  const handleWallClick = (target: WallTarget, point: Vec2) => {
    const state = useEditorStore.getState();
    const activeProject = state.project;
    if (!activeProject) return;

    let wallId = target.type === 'internalWall' ? target.id : '';
    if (target.type === 'edge') {
      const level = getLevel(activeProject, state.activeLevelId);
      const space = level?.spaces.find((entry) => entry.id === target.spaceId);
      wallId = space?.edges[target.index]?.id ?? '';
    }
    const found = wallId ? findWallInProject(activeProject, wallId) : undefined;
    if (found) {
      if (state.activeLevelId !== found.level.id) setActiveLevel(found.level.id);
      const spaceId = found.wall.spaceId;
      if (spaceId && useEditorStore.getState().activeSpaceId !== spaceId) {
        setActiveSpace(spaceId);
      }
    }

    if (state.tool === 'door' || state.tool === 'window') {
      if (!found) return;
      addOpening(
        found.wall.id,
        state.tool,
        pointOffsetOnWall(point, found.wall.a, found.wall.b),
      );
      return;
    }
    if (state.tool === 'wall' && target.type === 'edge') {
      toggleWall(target.index);
      setSelection({ type: 'edge', index: target.index, spaceId: target.spaceId });
      return;
    }
    setSelection(
      target.type === 'edge'
        ? { type: 'edge', index: target.index, spaceId: target.spaceId }
        : { type: 'internalWall', id: target.id },
    );
  };

  return (
    <>
      <color attach="background" args={['#0a0d10']} />
      <AdaptiveFog />
      <WireframeController />
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
      {/* Cuadrícula adaptativa + ejes de orientación (estilo 3D). */}
      {project.settings.showGrid ? <SceneGrid orthographic={orthographic} /> : null}
      <axesHelper args={[2]} position={[0, 0.012, 0]} />
      <Architecture
        project={project}
        selectedExhibitorId={selectedExhibitorId}
        selectedStairId={selection?.type === 'stair' ? selection.id : null}
        onSelectStair={(id) => {
          const found = project.levels.find((level) => level.stairs.some((stair) => stair.id === id));
          if (found) {
            const current = useEditorStore.getState();
            if (current.activeLevelId !== found.id) setActiveLevel(found.id);
          }
          setSelection({ type: 'stair', id });
        }}
        onFloorClick={handleFloorClick}
        onWallClick={handleWallClick}
        onOpeningClick={(id) => setSelection({ type: 'opening', id })}
      />
      {gizmoLevel ? (
        <LevelGizmo project={project} level={gizmoLevel} mode={levelGizmoMode} />
      ) : null}
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
        showLabels={showObjectLabels}
        onSelectObject={(id) => setSelection({ type: 'object', id })}
      />
      <WallEditHandles />
      <ExhibitorMarkers
        exhibitors={project.exhibitors}
        project={project}
        editor
        showLabels={showExhibitorNames}
        selectedId={selection?.type === 'exhibitor' ? selection.id : null}
        onSelect={(id) => setSelection({ type: 'exhibitor', id })}
      />
      <RotationPointMarkers
        points={project.rotationPoints}
        project={project}
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
        maxPolarAngle={orthographic ? Math.PI / 2 : Math.PI / 2 - 0.015}
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
  showExhibitorNames = true,
  showObjectLabels = true,
}: {
  project: Project;
  cameraRequest: CameraRequest;
  /** Mantiene el canvas montado pero pausa el render cuando la vista 2D lo cubre. */
  active?: boolean;
  /** Proyección casi ortográfica para ver la escena como en programas 3D. */
  orthographic?: boolean;
  /** Muestra los nombres de los expositores sobre sus marcadores. */
  showExhibitorNames?: boolean;
  /** Muestra las etiquetas de código/nombre de los objetos. */
  showObjectLabels?: boolean;
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

  // Clic determinista: al soltar un clic sin arrastre el lienzo elige el
  // elemento más cercano bajo el cursor. No depende del orden en que R3F
  // entrega `onClick` entre el piso y las piezas, que era lo que hacía que a
  // veces seleccionara y a veces no.
  const wrapperRef = useRef<HTMLDivElement | null>(null);
  const pressRef = useRef<{ x: number; y: number } | null>(null);
  const sceneStateRef = useRef<{ camera: THREE.Camera } | null>(null);
  /** El clic nació sobre un gizmo: la cámara no debe girar con ese arrastre. */
  const gizmoPressRef = useRef(false);

  useEffect(() => {
    if (!active) return;
    const element = wrapperRef.current;
    if (!element) return;
    const onDown = (event: PointerEvent) => {
      notifyScenePointerDown();
      gizmoPressRef.current = false;
      gizmoCheckQueued = false;
      pressRef.current = { x: event.clientX, y: event.clientY };
      // Pulsar la flecha de rumbo o el círculo de un expositor lo selecciona;
      // la herramienta (mover/rotar) la elige el usuario con G/R, como en los
      // objetos. El gesto no se convierte en arrastre del marcador.
      const handle = getPressedHandle();
      if (handle) {
        pressRef.current = null;
        clearPressedHandle();
        useEditorStore.getState().setSelection({ type: 'exhibitor', id: handle });
      }
    };
    const onUp = (event: PointerEvent) => {
      const press = pressRef.current;
      pressRef.current = null;

      if (!press || event.button !== 0) return;
      if (Math.hypot(event.clientX - press.x, event.clientY - press.y) > 5) return;
      // Solo cuentan los clics sobre el lienzo 3D (ni HUD ni menús flotantes).
      const target = event.target as Node | null;
      if (!target || !element.contains(target) || !(target as Element).closest('canvas')) return;
      if (clickStartedOnGizmo() || isSceneDragClickBlocked(0)) return;
      if (gizmoPressRef.current) return;
      const state = useEditorStore.getState();
      if (state.tool !== 'select' || state.pendingCatalogItem) return;
      const canvas = element.querySelector('canvas');
      if (!canvas || !sceneStateRef.current) return;
      const id = pickElementAt(event.clientX, event.clientY, canvas, sceneStateRef.current.camera);
      if (!id) return;
      markSceneClickHandled();
      const exhibitor = state.project?.exhibitors.find((entry) => entry.id === id);
      if (exhibitor) {
        state.setSelection({ type: 'exhibitor', id });
        return;
      }
      const point = state.project?.rotationPoints.find((entry) => entry.id === id);
      if (point) {
        state.setSelection({ type: 'rotationPoint', id });
        return;
      }
      state.setSelection({ type: 'object', id });
    };
    // En captura: corre antes que los manejadores de R3F, así la pieza queda
    // seleccionada aunque después el piso reciba el mismo clic.
    element.addEventListener('pointerdown', onDown, true);
    element.addEventListener('pointerup', onUp, true);
    // `notifyGizmoPointerDown` llega por el burbujeo de este mismo lienzo: se
    // difiere una microtarea al final del evento para leer si la pulsación
    // empezó sobre un manipulado y así no robarle el clic a la manija.
    let gizmoCheckQueued = false;
    const queueGizmoCheck = () => {
      if (gizmoCheckQueued) return;
      gizmoCheckQueued = true;
      queueMicrotask(() => {
        gizmoPressRef.current = clickStartedOnGizmo();
      });
    };
    element.addEventListener('pointerdown', queueGizmoCheck);
    return () => {
      element.removeEventListener('pointerdown', onDown, true);
      element.removeEventListener('pointerup', onUp, true);
      element.removeEventListener('pointerdown', queueGizmoCheck);
    };
  }, [active]);

  // Candidatos al clic: marcadores de expositores, puntos de rotación y
  // objetos visibles, cada uno a la altura del suelo de su nivel.
  const clickPoints = useMemo(() => {
    const elevations = levelElevationMap(project);
    const points: { id: string; point: THREE.Vector3 }[] = [];
    for (const exhibitor of project.exhibitors) {
      if (!exhibitor.visible) continue;
      const y = (elevations[exhibitor.levelId ?? ''] ?? 0) + 0.02;
      points.push({
        id: exhibitor.id,
        point: new THREE.Vector3(exhibitor.position.x, y, exhibitor.position.z),
      });
    }
    for (const point of project.rotationPoints) {
      const y = (elevations[point.levelId ?? ''] ?? 0) + 0.02;
      points.push({ id: point.id, point: new THREE.Vector3(point.position.x, y, point.position.z) });
    }
    for (const object of project.objects) {
      if (!object.visible) continue;
      const y = (elevations[object.levelId ?? ''] ?? 0) + object.transform.position[1];
      points.push({
        id: object.id,
        point: new THREE.Vector3(
          object.transform.position[0],
          y,
          object.transform.position[2],
        ),
      });
    }
    return points;
  }, [project.exhibitors, project.objects, project.rotationPoints, project.levels]);

  useEffect(() => {
    setClickCandidates(active ? clickPoints : null);
    return () => setClickCandidates(null);
  }, [active, clickPoints]);

  return (
    <div ref={wrapperRef} className="three-canvas" aria-hidden={!active}>
      <Canvas
        shadows="soft"
        dpr={[1, 2]}
        gl={{ antialias: true, powerPreference: 'high-performance' }}
        camera={camera}
        frameloop={active ? 'always' : 'demand'}
        onCreated={(state) => {
          sceneStateRef.current = { camera: state.camera };
        }}
        onPointerMissed={(event) => {
          const state = useEditorStore.getState();
          if (state.pendingCatalogItem) return;
          // El clic sobre el vacío no debe deseleccionar si empezó en un gizmo:
          // R3F también entrega `onPointerMissed` al soltar un arrastre del gizmo.
          if (clickStartedOnGizmo() || isSceneDragClickBlocked(0)) return;
          // Con elementos bajo el cursor, el seleccionador del lienzo decide.
          const canvas = wrapperRef.current?.querySelector('canvas');
          if (
            canvas &&
            event &&
            sceneStateRef.current &&
            pickElementAt(event.clientX, event.clientY, canvas, sceneStateRef.current.camera)
          ) {
            return;
          }
          // Clic en el vacío: se deselecciona la medida y su gizmo. La
          // selección no se toca aquí: si fue sobre una pieza, esa pieza queda
          // seleccionada (aunque esté fuera de la cámara y no haya objeto tras
          // el cursor); deseleccionar exige pulsar el piso o el vacío.
          state.setActiveMeasurement(null);
        }}
      >
        <EditorSceneContents
          project={project}
          cameraRequest={cameraRequest}
          orthographic={orthographic}
          active={active}
          showExhibitorNames={showExhibitorNames}
          showObjectLabels={showObjectLabels}
        />
      </Canvas>
    </div>
  );
}
