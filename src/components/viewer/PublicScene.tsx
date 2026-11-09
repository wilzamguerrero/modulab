import {
  createContext,
  useContext,
  useEffect,
  useMemo,
  useRef,
  useState,
  type ReactNode,
} from 'react';
import * as THREE from 'three';
import { Canvas, useFrame } from '@react-three/fiber';
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
import { NEUTRAL_HIGHLIGHT_COLOR, mixHexColors } from '@/utils/exhibitorColors';
import { stepSpotlightTarget } from '@/utils/spotlightBlend';

export interface ViewerCameraCommand {
  mode: 'reset' | 'focus' | 'top';
  nonce: number;
  position?: Vec3;
  target?: Vec3;
  /**
   * Punto de paso del vuelo (la vista de lectura del nivel). Por defecto no es
   * una parada: la cámara lo atraviesa dentro de un mismo movimiento continuo
   * hacia el destino. Con `holdSeconds` > 0 se detiene ahí ese tiempo.
   */
  via?: { position: Vec3; target: Vec3 }[];
  /**
   * Segundos que la cámara descansa en la vista de paso antes de seguir hasta
   * el expositor. 0 = atraviesa sin pausa.
   */
  holdSeconds?: number;
  /** Campo de visión de la vista de lectura, si la hay. */
  fov?: number;
  /**
   * Giro (radianes) de la planta cuando `mode = 'top'`. Permite volver a pulsar
   * «vista superior» y ver el plano desde otro ángulo sin salir de la vista
   * cenital.
   */
  topAngle?: number;
}

/** Duración del vuelo entre stands por defecto, en milisegundos. */
const DEFAULT_TRAVEL_DURATION_MS = 2200;

/** Elevación máxima (metros) de la cámara durante la respiración. */
const HOLD_BREATH_LIFT = 0.09;
/** Duración de un ciclo de respiración, en milisegundos. */
const HOLD_BREATH_PERIOD_MS = 2600;

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

/** Curva de avance suave y estrictamente creciente, de 0 a 1. */
function smoothProgress(value: number): number {
  const clamped = Math.min(1, Math.max(0, value));
  return clamped < 0.5 ? 4 * clamped ** 3 : 1 - (-2 * clamped + 2) ** 3 / 2;
}

/**
 * Tramo de Hermite: de `from` a `to` con las velocidades dadas en los extremos
 * (en unidades de avance por unidad de la variable `u`). Con pendientes iguales
 * a la media el tramo es recto; con 0 en un extremo, frena suave.
 */
function hermiteSegment(
  from: number,
  slopeFrom: number,
  to: number,
  slopeTo: number,
  u: number,
): number {
  const u2 = u * u;
  const u3 = u2 * u;
  return (
    (2 * u3 - 3 * u2 + 1) * from +
    (u3 - 2 * u2 + u) * slopeFrom +
    (-2 * u3 + 3 * u2) * to +
    (u3 - u2) * slopeTo
  );
}

/**
 * Avance del recorrido (0 → 1) cuando hay pausa en la vista.
 *
 * Tres tramos: vuelo hasta la vista, pausa y vuelo hasta el expositor. La
 * clave es que la pausa entra y sale con la MISMA velocidad que llevaban los
 * vuelos en ese punto: así no hay frenada antes de la pausa ni arranque
 * después, y el recorrido se siente como un único movimiento que se ralentiza
 * al pasar por la vista. La pausa no se congela: avanza despacio (una fracción
 * pequeña del camino). El resultado es siempre creciente, sin saltos.
 */
function travelProgressWithHold(t: number, travelShare: number, holdShare: number): number {
  if (t <= 0) return 0;
  if (t >= 1) return 1;
  // Mitad del tiempo de vuelo para cada tramo (ida a la vista y salida).
  const legShare = travelShare / 2;
  // Fracción del camino que se recorre durante la pausa: pequeña, pero
  // perceptible, para que la parada se sienta viva.
  const passSpan = Math.min(0.08, legShare * 0.5);
  const entry = 0.5 - passSpan / 2;
  const exit = 0.5 + passSpan / 2;
  // Velocidad compartida en los bordes de la pausa (avance por unidad de t).
  const edgeSpeed = passSpan / holdShare;

  if (t < legShare) {
    const u = t / legShare;
    // Sale de 0 (velocidad 0) y llega a la pausa ya en marcha, con `edgeSpeed`.
    return hermiteSegment(0, 0, entry, edgeSpeed * legShare, u);
  }
  if (t < legShare + holdShare) {
    const u = (t - legShare) / holdShare;
    // Con la misma pendiente en ambos extremos e igual al avance total, el
    // tramo es una deriva a velocidad constante: ni frena al entrar ni al salir.
    return hermiteSegment(entry, edgeSpeed * holdShare, exit, edgeSpeed * holdShare, u);
  }
  const u = (t - legShare - holdShare) / legShare;
  // Retoma desde `edgeSpeed` y frena al llegar al expositor.
  return hermiteSegment(exit, edgeSpeed * legShare, 1, 0, u);
}

/**
 * Altura de la respiración durante la pausa, en función del avance de la propia
 * pausa (`pause`, de 0 a 1). Vale exactamente 0 al entrar y al salir, así que
 * se suma al vuelo sin ningún salto aunque la cámara esté en movimiento.
 */
function breathLift(pause: number): number {
  // Un solo ciclo: sube y baja una vez durante la pausa. El seno ya vale 0 en
  // los extremos, así que no hay salto al entrar ni al salir.
  return Math.sin(pause * Math.PI * 2) * Math.sin(pause * Math.PI);
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
      // Un pequeño desplazamiento respecto al centro fija la orientación del
      // plano: girándolo alrededor del centro, la vista sigue siendo cenital
      // pero se mira desde otro ángulo.
      const angle = command.topAngle ?? 0;
      const tilt = 0.02;
      position = [
        bounds.center.x + Math.sin(angle) * tilt,
        height,
        bounds.center.z + Math.cos(angle) * tilt,
      ];
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

    // Vista superior: se anima como un giro alrededor de la planta. Cada
    // pulsación orbita 90° desde el ángulo actual, así la rotación se ve
    // continua en vez de un salto seco de la orientación.
    if (command.mode === 'top') {
      const center: [number, number, number] = [target[0], 0, target[2]];
      const endAngle = command.topAngle ?? 0;
      const tilt = 0.02;
      const travelMs = Math.max(
        300,
        (project.readerTravelSeconds ?? DEFAULT_TRAVEL_DURATION_MS / 1000) * 1000,
      );
      const fromPosition = controls.getPosition(new THREE.Vector3());
      const fromTarget = controls.getTarget(new THREE.Vector3());
      const startAngle = Math.atan2(
        fromPosition.x - center[0],
        fromPosition.z - center[2],
      );
      const startRadius = Math.hypot(
        fromPosition.x - center[0],
        fromPosition.z - center[2],
      );
      const startHeight = fromPosition.y;
      // Giro más corto hasta el ángulo pedido (90° por pulsación).
      const delta = Math.atan2(
        Math.sin(endAngle - startAngle),
        Math.cos(endAngle - startAngle),
      );
      const startedAt = performance.now();
      let frame = 0;
      let cancelled = false;
      const step = () => {
        if (cancelled) return;
        const t = Math.min(1, (performance.now() - startedAt) / travelMs);
        const s = smoothProgress(t);
        const radius = startRadius + (tilt - startRadius) * s;
        const azimuth = startAngle + delta * s;
        const y = startHeight + (position[1] - startHeight) * s;
        controls.setLookAt(
          center[0] + Math.sin(azimuth) * radius,
          y,
          center[2] + Math.cos(azimuth) * radius,
          fromTarget.x + (center[0] - fromTarget.x) * s,
          fromTarget.y * (1 - s),
          fromTarget.z + (center[2] - fromTarget.z) * s,
          false,
        );
        if (t < 1) frame = requestAnimationFrame(step);
      };
      frame = requestAnimationFrame(step);
      return () => {
        cancelled = true;
        cancelAnimationFrame(frame);
      };
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
    // Pausa en la vista de paso: solo tiene sentido con un punto intermedio.
    // No es un alto en seco: el viaje va y vuelve a frenar en la vista, se
    // queda ahí `holdSeconds` avanzando muy despacio, y retoma el vuelo sin
    // arrancar de cero.
    const hold = waypoints.length ? Math.max(0, (command.holdSeconds ?? 0) * 1000) : 0;
    const totalMs = travelDuration + hold;
    // Tiempo en el que la cámara está en la pausa (para el borneo).
    const holdStart = travelDuration / 2;
    const holdEnd = holdStart + hold;
    const start = performance.now();
    let frame = 0;
    let cancelled = false;
    const step = () => {
      if (cancelled) return;
      const elapsed = performance.now() - start;
      const t = Math.min(1, elapsed / totalMs);
      // Avance del recorrido (0 → 1) en una sola curva monótona: no retrocede
      // nunca y no tiene saltos.
      const eased = hold > 0 && waypoints.length
        ? travelProgressWithHold(t, travelDuration / totalMs, hold / totalMs)
        : smoothProgress(t);
      let viewPosition = sampleCurve(control, eased);
      let viewTarget = sampleCurve(targetControl, eased);
      // Respiración: un borneo leve siempre que la pausa esté activa y se esté
      // en la vista, fundido en los bordes para que no tenga esquinas.
      if (hold > 0 && waypoints.length && elapsed >= holdStart && elapsed < holdEnd) {
        const lift = breathLift((elapsed - holdStart) / hold) * HOLD_BREATH_LIFT;
        viewPosition = [viewPosition[0], viewPosition[1] + lift, viewPosition[2]];
        viewTarget = [
          viewTarget[0],
          viewTarget[1] + lift * 0.55,
          viewTarget[2],
        ];
      }
      controls.setLookAt(
        viewPosition[0],
        viewPosition[1],
        viewPosition[2],
        viewTarget[0],
        viewTarget[1],
        viewTarget[2],
        false,
      );
      // La animación dura `travelDuration + hold` y termina justo al llegar al
      // expositor.
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

const DEFAULT_SCENE_BACKGROUND = '#070a0c';
/**
 * Fondo y niebla del editor. Con «mantener el entorno» el visor público usa
 * estos valores para que piso, muros y ventanas se lean igual que al editar.
 */
const EDITOR_SCENE_BACKGROUND = '#0a0d10';
const EDITOR_FOG: [string, number, number] = [EDITOR_SCENE_BACKGROUND, 35, 160];

/**
 * Progreso (0–1) del fundido del entorno hacia el color neutro. Se resuelve
 * cada fotograma dentro del lienzo y se publica por contexto: las piezas lo
 * leen sin que toda la escena se vuelva a renderizar por cada paso.
 */
const SpotlightContext = createContext(0);
const SpotlightColorContext = createContext(NEUTRAL_HIGHLIGHT_COLOR);
const SpotlightStoreContext = createContext<{ current: number } | null>(null);

function useSpotlightProgress(): number {
  return useContext(SpotlightContext);
}

/** Progreso vivo fuera de React (fondos, materiales de modelos). */
function useSpotlightStore() {
  return useContext(SpotlightStoreContext);
}

function SpotlightScope({
  target,
  blendSeconds,
  neutralColor,
  baseBackground = DEFAULT_SCENE_BACKGROUND,
  children,
}: {
  target: number;
  blendSeconds: number;
  neutralColor: string;
  /** Fondo de partida: el del visor o el del editor si se conserva el entorno. */
  baseBackground?: string;
  children: ReactNode;
}) {
  const progress = useRef(target === 1 ? 1 : 0);
  const store = useRef(progress.current);
  const [rendered, setRendered] = useState(progress.current);
  const background = useRef<string | null>(null);

  useFrame((state, delta) => {
    const next = stepSpotlightTarget(progress.current, target, delta * 1000, blendSeconds);
    if (next === progress.current) return;
    progress.current = next;
    store.current = next;
    setRendered(next);
    // El fondo de la escena acompaña al fundido con el mismo color neutro
    // mezclado sobre el fondo oscuro de base (sin destello).
    const scene = state.scene;
    if (progress.current <= 0) {
      if (background.current !== baseBackground) {
        background.current = baseBackground;
        if (scene.background instanceof THREE.Color) {
          scene.background.set(baseBackground);
        }
      }
      return;
    }
    const mixed = mixHexColors(baseBackground, neutralColor, progress.current);
    background.current = mixed;
    if (scene.background instanceof THREE.Color) scene.background.set(mixed);
    else scene.background = new THREE.Color(mixed);
  });

  return (
    <SpotlightStoreContext.Provider value={store}>
      <SpotlightColorContext.Provider value={neutralColor}>
        <SpotlightContext.Provider value={rendered}>
          {children}
        </SpotlightContext.Provider>
      </SpotlightColorContext.Provider>
    </SpotlightStoreContext.Provider>
  );
}

/** Edificio, objetos y marcadores con el fundido aplicado. */
function SceneContent({
  project,
  selectedExhibitorId,
  showSplat,
  showObjectLabels,
  showExhibitorNames,
  showMeasurements,
  nameMode,
  spotlight,
  onSelectExhibitor,
}: {
  project: Project;
  selectedExhibitorId: string | null;
  showSplat: boolean;
  showObjectLabels: boolean;
  showExhibitorNames: boolean;
  showMeasurements: boolean;
  nameMode: 'all' | 'selected' | 'always';
  spotlight: 'off' | 'neutral' | 'tint' | 'solo';
  onSelectExhibitor: (id: string) => void;
}) {
  const progress = useSpotlightProgress();
  const neutralColor = useContext(SpotlightColorContext);
  // En `tint` el edificio conserva sus materiales: solo los demás expositores
  // (marcadores y objetos asociados) toman el color elegido, así que el fundido
  // del entorno no se aplica y el tinte va directo.
  const buildingProgress = spotlight === 'tint' ? 0 : progress;
  const objectsProgress =
    spotlight === 'tint' ? (selectedExhibitorId ? 1 : 0) : progress;
  const environment = useMemo(
    () => ({ ...project.environment, visible: project.environment.visible && showSplat }),
    [project.environment, showSplat],
  );
  return (
    <>
      <Architecture
        project={project}
        selectedExhibitorId={selectedExhibitorId}
        highlightOthers={buildingProgress}
        neutralColor={neutralColor}
      />
      <SceneSplat environment={environment} />
      <SceneObjects
        project={project}
        selectedExhibitorId={selectedExhibitorId}
        showLabels={showObjectLabels}
        showMeasurements={showMeasurements}
        highlightOthers={objectsProgress}
        neutralColor={neutralColor}
        onSelectExhibitor={onSelectExhibitor}
      />
      <ExhibitorMarkers
        exhibitors={project.exhibitors}
        project={project}
        selectedId={selectedExhibitorId}
        showLabels={showExhibitorNames}
        nameMode={nameMode}
        spotlight={spotlight}
        spotlightProgress={progress}
        neutralColor={neutralColor}
        onSelect={onSelectExhibitor}
      />
    </>
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
  nameMode = 'all',
  spotlight = 'off',
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
  /**
   * `selected`: con un expositor elegido solo se ve el nombre de ese.
   * `always`: los nombres no se ocultan nunca.
   */
  nameMode?: 'all' | 'selected' | 'always';
  /**
   * Atmósfera al elegir un expositor: `neutral` deja el entorno en blanco
   * (solo el elegido conserva su color), `tint` tiñe solo a los demás
   * expositores y `solo` oculta además el resto.
   */
  spotlight?: 'off' | 'neutral' | 'tint' | 'solo';
  onSelectExhibitor: (id: string) => void;
  onClearSelection: () => void;
}) {
  const shadowBounds = useMemo(() => projectBounds(project), [project]);
  // El fundido de la escena solo tiene sentido con un expositor elegido y con
  // uno de los modos activos; sin él el progreso vuelve a 0 (colores propios).
  // `tint` no funde el edificio: solo recolorea los demás marcadores.
  const spotlightTarget =
    spotlight !== 'off' && spotlight !== 'tint' && Boolean(selectedExhibitorId) ? 1 : 0;
  const spotlightColor = project.settings.readerSpotlightColor ?? '#ffffff';
  const spotlightBlend = project.settings.readerSpotlightBlendSeconds ?? 0.6;
  // «Mantener el entorno»: el visor arranca con el fondo y la niebla del
  // editor, de modo que piso, muros y cristales se vean como al editar.
  const keepEnvironment = project.settings.readerKeepEnvironment ?? false;
  const background = keepEnvironment ? EDITOR_SCENE_BACKGROUND : DEFAULT_SCENE_BACKGROUND;
  const fog: [string, number, number] = keepEnvironment
    ? EDITOR_FOG
    : [DEFAULT_SCENE_BACKGROUND, 38, 130];

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
        <color attach="background" args={[background]} />
        <fog attach="fog" args={fog} />
        <ambientLight color="#aeb9c4" intensity={keepEnvironment ? 0.22 : 0.15} />
        <SceneEnvironment intensity={0.06} />
        <SceneShadows quality={project.settings.shadowQuality} />
        <SceneLights
          lights={project.lights}
          shadowQuality={project.settings.shadowQuality}
          shadowBounds={shadowBounds}
        />
        <SpotlightScope
          target={spotlightTarget}
          blendSeconds={spotlightBlend}
          neutralColor={spotlightColor}
          baseBackground={background}
        >
          <SceneContent
            project={project}
            selectedExhibitorId={selectedExhibitorId}
            showSplat={showSplat}
            showObjectLabels={showObjectLabels}
            showExhibitorNames={showExhibitorNames}
            showMeasurements={showMeasurements}
            nameMode={nameMode}
            spotlight={spotlight}
            onSelectExhibitor={onSelectExhibitor}
          />
        </SpotlightScope>
        <ViewerCamera project={project} command={cameraCommand} />
      </Canvas>
    </div>
  );
}
