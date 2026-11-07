import {
  useCallback,
  useEffect,
  useId,
  useMemo,
  useRef,
  useState,
  type MouseEvent as ReactMouseEvent,
  type PointerEvent as ReactPointerEvent,
} from 'react';
import { Check, Maximize, Minus, Plus, X } from 'lucide-react';
import type { Project, SceneObject, Space, Stair, Vec2, WallOpening } from '@/types/project';
import { useEditorStore } from '@/store/editorStore';
import { useUiStore } from '@/store/uiStore';
import {
  distance,
  edgeLength,
  formatArea,
  formatMeters,
  pointInPolygon,
  polygonArea,
  polygonBounds,
  snapPoint,
  snapValue,
  validatePolygon,
} from '@/utils/geometry';
import {
  entityLevelId,
  getLevel,
  getSpace,
  levelAllVertices,
  levelBounds,
  pointInLevel,
} from '@/utils/levels';
import {
  stairFootprintBounds,
  stairFootprintRects,
  transformStairPoint,
} from '@/utils/stairs';
import {
  getOpeningSpans,
  getSolidRanges,
  pointAtWallOffset,
  pointOffsetOnWall,
  wallDirection,
  wallLength,
} from '@/utils/walls';
import { Button } from '@/components/ui';
import { clipFloorPieces } from '@/utils/floorOutline';
import { levelPivot } from '@/utils/levelTransform';
import { LevelReadout } from '@/components/editor/LevelReadout';
import {
  exhibitorColor,
  exhibitorPaintAmount,
  findExhibitor,
  hexToRgba,
  mixHexColors,
  paintedExhibitorColor,
} from '@/utils/exhibitorColors';

interface Viewport {
  x: number;
  y: number;
  width: number;
  height: number;
}

type DragState =
  | { type: 'pan'; startClient: { x: number; y: number }; startViewport: Viewport }
  | { type: 'vertex'; index: number }
  | { type: 'internalWallPoint'; id: string; endpoint: 'a' | 'b' }
  | { type: 'object'; id: string; offset: Vec2 }
  | { type: 'exhibitor'; id: string; offset: Vec2 }
  | { type: 'rotationPoint'; id: string; offset: Vec2 }
  | { type: 'stair'; id: string; offset: Vec2 }
  | { type: 'holeRect'; start: Vec2 }
  | {
      type: 'hole';
      id: string;
      /** Punto bajo el cursor al empezar el arrastre (sin snappear). */
      startPointer: Vec2;
      /** Centro del hueco al empezar el arrastre. */
      startCenter: Vec2;
    }
  | { type: 'holeVertex'; id: string; index: number }
  | {
      /** Arrastre del piso completo desde el gizmo de la planta. */
      type: 'level';
      levelId: string;
      mode: 'translate' | 'rotate';
      /** Punto bajo el cursor al empezar el arrastre. */
      startPointer: Vec2;
      /** Pivote del giro (centro del piso), fijado al empezar. */
      pivot: Vec2;
      /** Ángulo del cursor respecto al pivote al empezar. */
      startAngle: number;
      /** Proyecto al empezar, base de todas las previsualizaciones. */
      base: Project;
    };

/** Anillo de puntos como sub-trayecto SVG cerrado. */
function ringToPath(ring: Vec2[]): string {
  if (ring.length < 3) return '';
  return `M ${ring.map((point) => `${point.x} ${point.z}`).join(' L ')} Z`;
}

function fitViewport(vertices: Vec2[]): Viewport {
  if (vertices.length === 0) {
    return { x: -6, y: -5, width: 12, height: 10 };
  }
  const bounds = polygonBounds(vertices);
  const padding = Math.max(bounds.width, bounds.depth) * 0.16 + 1;
  return {
    x: bounds.minX - padding,
    y: bounds.minZ - padding,
    width: Math.max(bounds.width + padding * 2, 4),
    height: Math.max(bounds.depth + padding * 2, 4),
  };
}

/**
 * Cota provisional de dibujo: línea paralela al tramo con su longitud, para
 * ver el largo mientras se traza un contorno, una división o un muro libre.
 */
function LiveDimension({
  a,
  b,
  textSize,
  offset,
  color = '#d7ff4f',
}: {
  a: Vec2;
  b: Vec2;
  textSize: number;
  offset?: number;
  color?: string;
}) {
  const length = distance(a, b);
  if (length < 0.02) return null;
  const ux = (b.x - a.x) / length;
  const uz = (b.z - a.z) / length;
  const nx = -uz;
  const nz = ux;
  const gap = offset ?? Math.max(textSize * 1.2, 0.12);
  const p1 = { x: a.x + nx * gap, z: a.z + nz * gap };
  const p2 = { x: b.x + nx * gap, z: b.z + nz * gap };
  const tick = Math.max(textSize * 0.3, 0.035);
  const stroke = Math.max(textSize * 0.07, 0.008);
  const mid = { x: (p1.x + p2.x) / 2, z: (p1.z + p2.z) / 2 };
  return (
    <g pointerEvents="none">
      <line x1={a.x} y1={a.z} x2={p1.x} y2={p1.z} stroke={color} strokeOpacity={0.3} strokeWidth={stroke} />
      <line x1={b.x} y1={b.z} x2={p2.x} y2={p2.z} stroke={color} strokeOpacity={0.3} strokeWidth={stroke} />
      <line x1={p1.x} y1={p1.z} x2={p2.x} y2={p2.z} stroke={color} strokeWidth={stroke} />
      <line x1={p1.x - ux * tick} y1={p1.z - uz * tick} x2={p1.x + ux * tick} y2={p1.z + uz * tick} stroke={color} strokeWidth={stroke} />
      <line x1={p2.x - ux * tick} y1={p2.z - uz * tick} x2={p2.x + ux * tick} y2={p2.z + uz * tick} stroke={color} strokeWidth={stroke} />
      <MeasureChip
        x={mid.x + nx * textSize * 0.9}
        z={mid.z + nz * textSize * 0.9}
        text={formatMeters(length, 2)}
        textSize={textSize}
        color={color}
      />
    </g>
  );
}

/** Texto de medida con halo oscuro para que se lea sobre cualquier relleno. */
function MeasureChip({
  x,
  z,
  text,
  textSize,
  color = '#d7ff4f',
}: {
  x: number;
  z: number;
  text: string;
  textSize: number;
  color?: string;
}) {
  return (
    <text
      x={x}
      y={z}
      textAnchor="middle"
      dominantBaseline="middle"
      fill={color}
      fontSize={textSize * 0.95}
      fontFamily="var(--mono)"
      stroke="rgba(9,12,15,.9)"
      strokeWidth={textSize * 0.26}
      style={{ paintOrder: 'stroke' }}
      pointerEvents="none"
    >
      {text}
    </text>
  );
}

/** Punto medio de un tramo, desplazado en perpendicular para colocar la cota. */
function segmentLabelPoint(a: Vec2, b: Vec2, offset: number): Vec2 {
  const length = Math.max(distance(a, b), 1e-6);
  return {
    x: (a.x + b.x) / 2 - ((b.z - a.z) / length) * offset,
    z: (a.z + b.z) / 2 + ((b.x - a.x) / length) * offset,
  };
}

/**
 * Cota sobre la planta. Va con fondo oscuro y borde para que se lea encima de
 * muros, forjados y rejilla: antes solo había un texto suelto y se perdía.
 */
function PlanDimension({
  x,
  z,
  text,
  textSize,
  emphasis = false,
}: {
  x: number;
  z: number;
  text: string;
  textSize: number;
  emphasis?: boolean;
}) {
  const width = text.length * textSize * 0.62 + textSize * 1.15;
  const height = textSize * 1.6;
  return (
    <g transform={`translate(${x} ${z})`} pointerEvents="none">
      <rect
        x={-width / 2}
        y={-height / 2}
        width={width}
        height={height}
        rx={height * 0.32}
        fill={emphasis ? 'rgba(22, 28, 12, .93)' : 'rgba(9, 12, 15, .84)'}
        stroke={emphasis ? '#d7ff4f' : 'rgba(255,255,255,.24)'}
        strokeWidth={Math.max(height * 0.045, 0.004)}
      />
      <text
        textAnchor="middle"
        dominantBaseline="middle"
        fill={emphasis ? '#d7ff4f' : 'rgba(255,255,255,.84)'}
        fontSize={textSize * 0.86}
        fontFamily="var(--mono)"
      >
        {text}
      </text>
    </g>
  );
}

/** Símbolos de puertas y ventanas sobre un muro de la planta. */
function OpeningMarks({
  a,
  b,
  height,
  thickness,
  openings,
  selectedId,
  textSize,
  hitWidth,
  paintColorFor,
  showMeasurements = false,
  onSelect,
}: {
  a: Vec2;
  b: Vec2;
  height: number;
  thickness: number;
  openings: WallOpening[];
  selectedId?: string | null;
  textSize: number;
  hitWidth: number;
  paintColorFor?: (opening: WallOpening) => string | undefined;
  /** Muestra ancho × alto de la abertura seleccionada. */
  showMeasurements?: boolean;
  onSelect?: (id: string) => void;
}) {
  const length = wallLength(a, b);
  const spans = getOpeningSpans(length, height, openings);
  if (!spans.length) return null;
  const direction = wallDirection(a, b);
  const normal = { x: -direction.z, z: direction.x };
  return (
    <>
      {spans.map((span) => {
        const p1 = pointAtWallOffset(a, b, span.start);
        const p2 = pointAtWallOffset(a, b, span.end);
        const center = pointAtWallOffset(a, b, span.center);
        const selected = selectedId === span.opening.id;
        const painted = paintColorFor?.(span.opening);
        const color = selected
          ? '#d7ff4f'
          : painted ?? (span.opening.kind === 'door' ? '#e8c98a' : '#7dd3fc');
        const tick = Math.max(thickness * 1.1, 0.055);
        const leafEnd = {
          x: p1.x + normal.x * span.width,
          z: p1.z + normal.z * span.width,
        };
        return (
          <g key={span.opening.id} data-opening-id={span.opening.id}>
            {span.opening.kind === 'door' ? (
              <>
                <line
                  x1={p1.x}
                  y1={p1.z}
                  x2={p2.x}
                  y2={p2.z}
                  stroke="rgba(232,201,138,.4)"
                  strokeWidth={Math.max(textSize * 0.1, 0.008)}
                  strokeDasharray={`${textSize * 0.7} ${textSize * 0.55}`}
                  pointerEvents="none"
                />
                <line
                  x1={p1.x}
                  y1={p1.z}
                  x2={leafEnd.x}
                  y2={leafEnd.z}
                  stroke={color}
                  strokeWidth={Math.max(textSize * 0.12, 0.012)}
                  pointerEvents="none"
                />
                <path
                  d={`M ${leafEnd.x} ${leafEnd.z} A ${span.width} ${span.width} 0 0 1 ${p2.x} ${p2.z}`}
                  fill="none"
                  stroke={color}
                  strokeWidth={Math.max(textSize * 0.08, 0.007)}
                  opacity={0.75}
                  pointerEvents="none"
                />
              </>
            ) : (
              <>
                <line
                  x1={p1.x}
                  y1={p1.z}
                  x2={p2.x}
                  y2={p2.z}
                  stroke={color}
                  strokeWidth={Math.max(thickness * 0.38, 0.018)}
                  opacity={0.8}
                  pointerEvents="none"
                />
                <line
                  x1={p1.x + normal.x * thickness * 0.55}
                  y1={p1.z + normal.z * thickness * 0.55}
                  x2={p2.x + normal.x * thickness * 0.55}
                  y2={p2.z + normal.z * thickness * 0.55}
                  stroke={color}
                  strokeWidth={Math.max(textSize * 0.06, 0.005)}
                  opacity={0.65}
                  pointerEvents="none"
                />
              </>
            )}
            <line
              x1={p1.x - normal.x * tick}
              y1={p1.z - normal.z * tick}
              x2={p1.x + normal.x * tick}
              y2={p1.z + normal.z * tick}
              stroke={color}
              strokeWidth={Math.max(textSize * 0.1, 0.008)}
              pointerEvents="none"
            />
            <line
              x1={p2.x - normal.x * tick}
              y1={p2.z - normal.z * tick}
              x2={p2.x + normal.x * tick}
              y2={p2.z + normal.z * tick}
              stroke={color}
              strokeWidth={Math.max(textSize * 0.1, 0.008)}
              pointerEvents="none"
            />
            {selected ? (
              <circle
                cx={center.x}
                cy={center.z}
                r={Math.max(textSize * 0.4, 0.045)}
                fill={color}
                opacity={0.9}
                pointerEvents="none"
              />
            ) : null}
            {selected && showMeasurements ? (
              <MeasureChip
                x={center.x + normal.x * textSize * 1.7}
                z={center.z + normal.z * textSize * 1.7}
                text={`${formatMeters(span.width, 2)} × ${formatMeters(span.opening.height, 2)}`}
                textSize={textSize}
                color={color}
              />
            ) : null}
            <line
              x1={p1.x}
              y1={p1.z}
              x2={p2.x}
              y2={p2.z}
              stroke="transparent"
              strokeWidth={hitWidth}
              style={{ cursor: onSelect ? 'pointer' : 'default' }}
              pointerEvents={onSelect ? 'stroke' : 'none'}
              onClick={(event) => {
                if (!onSelect) return;
                event.stopPropagation();
                onSelect(span.opening.id);
              }}
            />
          </g>
        );
      })}
    </>
  );
}

export function PlanEditor2D({
  showObjectLabels = true,
  showExhibitorNames = true,
}: {
  /** Etiquetas de código/nombre de los objetos en la planta. */
  showObjectLabels?: boolean;
  /** Nombres de los expositores en la planta. */
  showExhibitorNames?: boolean;
} = {}) {
  const project = useEditorStore((state) => state.project);
  const selection = useEditorStore((state) => state.selection);
  const tool = useEditorStore((state) => state.tool);
  const pendingCatalogItem = useEditorStore((state) => state.pendingCatalogItem);
  const setTool = useEditorStore((state) => state.setTool);
  const setSelection = useEditorStore((state) => state.setSelection);
  const addObject = useEditorStore((state) => state.addObject);
  const addExhibitor = useEditorStore((state) => state.addExhibitor);
  const addRotationPoint = useEditorStore((state) => state.addRotationPoint);
  const moveVertex = useEditorStore((state) => state.moveVertex);
  const updateObjectTransform = useEditorStore((state) => state.updateObjectTransform);
  const moveExhibitor = useEditorStore((state) => state.moveExhibitor);
  const moveRotationPoint = useEditorStore((state) => state.moveRotationPoint);
  const toggleWall = useEditorStore((state) => state.toggleWall);
  const beginHistory = useEditorStore((state) => state.beginHistory);
  const commitHistory = useEditorStore((state) => state.commitHistory);
  const replacePlan = useEditorStore((state) => state.replacePlan);
  const planDrawMode = useEditorStore((state) => state.planDrawMode);
  const setPlanDrawMode = useEditorStore((state) => state.setPlanDrawMode);
  const addInternalWall = useEditorStore((state) => state.addInternalWall);
  const addInternalWallLoop = useEditorStore((state) => state.addInternalWallLoop);
  const moveInternalWallPoint = useEditorStore((state) => state.moveInternalWallPoint);
  const insertVertexOnInternalWall = useEditorStore((state) => state.insertVertexOnInternalWall);
  const addOpening = useEditorStore((state) => state.addOpening);
  const activeLevelId = useEditorStore((state) => state.activeLevelId);
  const activeSpaceId = useEditorStore((state) => state.activeSpaceId);
  const setActiveLevel = useEditorStore((state) => state.setActiveLevel);
  const setActiveSpace = useEditorStore((state) => state.setActiveSpace);
  const addSpace = useEditorStore((state) => state.addSpace);
  const addHole = useEditorStore((state) => state.addHole);
  const cutRectHole = useEditorStore((state) => state.cutRectHole);
  const setHoleCenter = useEditorStore((state) => state.setHoleCenter);
  const setHoleVertex = useEditorStore((state) => state.setHoleVertex);
  const addStair = useEditorStore((state) => state.addStair);
  const moveStair = useEditorStore((state) => state.moveStair);
  const previewLevelTransform = useEditorStore((state) => state.previewLevelTransform);
  const clearLevelDragReadout = useEditorStore((state) => state.clearLevelDragReadout);
  const levelGizmoId = useEditorStore((state) => state.levelGizmoId);
  const levelGizmoMode = useEditorStore((state) => state.levelGizmoMode);
  const setLevelGizmoMode = useEditorStore((state) => state.setLevelGizmoMode);
  const toast = useUiStore((state) => state.toast);

  const gridId = `plan-grid-${useId().replace(/:/g, '')}`;
  const majorId = `plan-major-${useId().replace(/:/g, '')}`;
  const svgRef = useRef<SVGSVGElement>(null);
  const dragRef = useRef<DragState | null>(null);
  const movedRef = useRef(false);
  /** Puntero capturado por el arrastre, para soltarlo al terminar. */
  const pressedPointerRef = useRef<number | null>(null);
  const suppressClickRef = useRef(false);
  const lastProjectId = useRef(project?.id ?? '');

  const activeLevel = project ? getLevel(project, activeLevelId) : undefined;
  const activeSpace = getSpace(activeLevel, activeSpaceId);
  const [viewport, setViewport] = useState<Viewport>(() =>
    fitViewport(activeSpace?.vertices ?? []),
  );
  const [draft, setDraft] = useState<Vec2[]>([]);
  const [hover, setHover] = useState<Vec2 | null>(null);
  const [rectDraft, setRectDraft] = useState<Vec2[] | null>(null);
  const rectRef = useRef<Vec2[] | null>(null);
  const [wallStart, setWallStart] = useState<Vec2 | null>(null);
  const [spaceDown, setSpaceDown] = useState(false);
  const lastScope = useRef(`${activeLevelId ?? ''}:${activeSpaceId ?? ''}`);

  const vertices = activeSpace?.vertices ?? [];
  const edges = activeSpace?.edges ?? [];
  const spaces = activeLevel?.spaces ?? [];
  const internalWalls = activeLevel?.internalWalls ?? [];
  const levelOpenings = activeLevel?.openings ?? [];
  const stairs = activeLevel?.stairs ?? [];
  const settings = project?.settings;
  const snap = settings?.snapToGrid ?? false;
  const gridSize = settings?.gridSize ?? 0.25;
  const showDimensions = settings?.showDimensions ?? true;
  /**
   * Medidas de trabajo: largo y ancho de lo que se está dibujando o editando.
   * Van aparte de las cotas de presentación para poder verlas sin tener las
   * cotas encima de toda la planta.
   */
  const showLive = settings?.showLiveMeasurements ?? true;
  const showGrid = settings?.showGrid ?? true;

  useEffect(() => {
    if (!project) return;
    const scope = `${activeLevelId ?? ''}:${activeSpaceId ?? ''}`;
    if (lastProjectId.current === project.id && lastScope.current === scope) return;
    lastProjectId.current = project.id;
    lastScope.current = scope;
    const level = getLevel(project, activeLevelId);
    setViewport(fitViewport(levelBounds(level).width ? levelAllVertices(level) : []));
    setDraft([]);
    setWallStart(null);
    setHover(null);
  }, [project, activeLevelId, activeSpaceId]);

  useEffect(() => {
    if (tool !== 'draw') setDraft([]);
    if (tool !== 'internalWall') setWallStart(null);
    if (tool !== 'draw' && tool !== 'internalWall') setHover(null);
  }, [tool]);

  const toWorld = useCallback((clientX: number, clientY: number): Vec2 => {
    const svg = svgRef.current;
    if (!svg) return { x: 0, z: 0 };
    const matrix = svg.getScreenCTM();
    if (!matrix) return { x: 0, z: 0 };
    const point = svg.createSVGPoint();
    point.x = clientX;
    point.y = clientY;
    const world = point.matrixTransform(matrix.inverse());
    return { x: world.x, z: world.y };
  }, []);

  const snapPointIfNeeded = useCallback(
    (point: Vec2) => (snap ? snapPoint(point, gridSize) : point),
    [snap, gridSize],
  );

  const snapToPlanPoint = useCallback(
    (point: Vec2) => {
      const threshold = Math.max(viewport.width / 55, 0.18);
      const level = project ? getLevel(project, activeLevelId) : undefined;
      const candidates: Vec2[] = [
        ...levelAllVertices(level),
        ...(level?.internalWalls.flatMap((wall) => [wall.a, wall.b]) ?? []),
        ...(level?.stairs.map((stair) => stair.position) ?? []),
      ];
      let closest: Vec2 | null = null;
      let closestDistance = threshold;
      for (const candidate of candidates) {
        const candidateDistance = distance(point, candidate);
        if (candidateDistance < closestDistance) {
          closest = candidate;
          closestDistance = candidateDistance;
        }
      }
      if (closest) return { ...closest };
      return snap ? snapPoint(point, gridSize) : point;
    },
    [project, activeLevelId, viewport.width, snap, gridSize],
  );

  const zoomAt = useCallback((factor: number, center?: Vec2) => {
    setViewport((current) => {
      const anchorX = center?.x ?? current.x + current.width / 2;
      const anchorZ = center?.z ?? current.y + current.height / 2;
      const width = Math.min(Math.max(current.width * factor, 1.5), 350);
      const scale = width / current.width;
      return {
        x: anchorX - (anchorX - current.x) * scale,
        y: anchorZ - (anchorZ - current.y) * scale,
        width,
        height: current.height * scale,
      };
    });
  }, []);

  useEffect(() => {
    const svg = svgRef.current;
    if (!svg) return;
    const onWheel = (event: WheelEvent) => {
      event.preventDefault();
      const point = toWorld(event.clientX, event.clientY);
      zoomAt(Math.exp(event.deltaY * 0.0012), point);
    };
    svg.addEventListener('wheel', onWheel, { passive: false });
    return () => svg.removeEventListener('wheel', onWheel);
  }, [toWorld, zoomAt]);

  const closeDraft = useCallback(() => {
    if (draft.length < 3) {
      toast('Añade al menos 3 vértices para cerrar el contorno.', 'warning');
      return;
    }
    const validation = validatePolygon(draft);
    if (!validation.valid) {
      toast(validation.errors[0] || 'La planta no es válida.', 'error');
      return;
    }
    if (planDrawMode === 'space') {
      const id = addSpace(draft.map((point) => ({ ...point })));
      if (!id) {
        toast('No se pudo crear el espacio.', 'error');
        return;
      }
      setViewport(fitViewport(levelAllVertices(activeLevel).concat(draft)));
      setDraft([]);
      setHover(null);
      setTool('select');
      toast('Espacio creado en el nivel activo.', 'success');
      return;
    }
    if (planDrawMode === 'hole') {
      if (!draft.every((point) => pointInPolygon(point, vertices))) {
        toast('El corte debe quedar dentro del espacio activo.', 'warning');
        return;
      }
      const id = addHole(draft.map((point) => ({ ...point })));
      if (!id) {
        toast('No se pudo crear el hueco.', 'error');
        return;
      }
      setDraft([]);
      setHover(null);
      setTool('select');
      toast('Hueco recortado en el suelo. Coloca la escalera en el corte.', 'success');
      return;
    }
    const canPartition = vertices.length >= 3;
    if (canPartition && planDrawMode === 'partition') {
      if (!draft.every((point) => pointInLevel(activeLevel, point))) {
        toast('La división debe quedar dentro de algún espacio del nivel.', 'warning');
        return;
      }
      const ids = addInternalWallLoop(draft.map((point) => ({ ...point })));
      if (!ids.length) {
        toast('No se pudo crear la división.', 'error');
        return;
      }
      setDraft([]);
      setHover(null);
      setTool('select');
      toast('División añadida. La planta, los objetos y los muros existentes se conservaron.', 'success');
      return;
    }
    replacePlan(draft.map((point) => ({ ...point })));
    setViewport(fitViewport(draft));
    setDraft([]);
    setHover(null);
    setTool('select');
    toast('Contorno del espacio reemplazado. Las divisiones interiores se conservaron.', 'success');
  }, [
    draft,
    vertices,
    planDrawMode,
    activeLevel,
    addSpace,
    addHole,
    addInternalWallLoop,
    replacePlan,
    setTool,
    toast,
  ]);

  useEffect(() => {
    const isEditableTarget = (target: EventTarget | null) => {
      const element = target as HTMLElement | null;
      return Boolean(
        element &&
          (element.tagName === 'INPUT' ||
            element.tagName === 'TEXTAREA' ||
            element.tagName === 'SELECT' ||
            element.isContentEditable),
      );
    };
    const onKeyDown = (event: KeyboardEvent) => {
      if (isEditableTarget(event.target)) return;
      if (event.code === 'Space') {
        setSpaceDown(true);
        if (tool === 'pan') event.preventDefault();
      }
      if (tool === 'draw') {
        if (event.key === 'Enter') {
          event.preventDefault();
          closeDraft();
        }
        if (event.key === 'Backspace') {
          event.preventDefault();
          setDraft((current) => current.slice(0, -1));
        }
        if (event.key === 'Escape') {
          event.preventDefault();
          setDraft([]);
          setHover(null);
        }
      }
      if (tool === 'internalWall' && event.key === 'Escape') {
        event.preventDefault();
        setWallStart(null);
        setHover(null);
      }
    };
    const onKeyUp = (event: KeyboardEvent) => {
      if (event.code === 'Space') setSpaceDown(false);
    };
    window.addEventListener('keydown', onKeyDown);
    window.addEventListener('keyup', onKeyUp);
    return () => {
      window.removeEventListener('keydown', onKeyDown);
      window.removeEventListener('keyup', onKeyUp);
    };
  }, [tool, closeDraft]);

  if (!project) return null;

  const finishDrag = () => {
    const drag = dragRef.current;
    if (drag?.type === 'holeRect') {
      const corners = rectRef.current;
      rectRef.current = null;
      setRectDraft(null);
      if (corners && movedRef.current) {
        const width = Math.abs(corners[2].x - corners[0].x);
        const depth = Math.abs(corners[2].z - corners[0].z);
        if (width < 0.2 || depth < 0.2) {
          toast('El corte es demasiado pequeño.', 'warning');
        } else if (cutRectHole(corners)) {
          toast('Corte hecho en el piso superior. Coloca la escalera debajo.', 'success');
        } else {
          toast('El corte debe quedar dentro de un espacio del nivel superior.', 'warning');
        }
      }
    }
    if (drag && drag.type !== 'pan' && drag.type !== 'holeRect') commitHistory();
    if (drag?.type === 'level') clearLevelDragReadout();
    if (movedRef.current) {
      suppressClickRef.current = true;
      window.setTimeout(() => {
        suppressClickRef.current = false;
      }, 0);
    }
    dragRef.current = null;
    movedRef.current = false;
  };

  const beginDrag = (event: ReactPointerEvent, drag: DragState) => {
    dragRef.current = drag;
    movedRef.current = false;
    pressedPointerRef.current = event.pointerId;
    svgRef.current?.setPointerCapture(event.pointerId);
  };

  const onPointerDown = (event: ReactPointerEvent<SVGSVGElement>) => {
    if (event.button === 0 && tool === 'draw' && planDrawMode === 'hole' && !spaceDown) {
      const start = snapToPlanPoint(toWorld(event.clientX, event.clientY));
      rectRef.current = null;
      beginDrag(event, { type: 'holeRect', start });
      return;
    }
    if (event.button === 1 || (event.button === 0 && (tool === 'pan' || spaceDown))) {
      event.preventDefault();
      beginDrag(event, {
        type: 'pan',
        startClient: { x: event.clientX, y: event.clientY },
        startViewport: viewport,
      });
    }
  };

  const onPointerMove = (event: ReactPointerEvent<SVGSVGElement>) => {
    const point = toWorld(event.clientX, event.clientY);
    const drag = dragRef.current;
    if (!drag) {
      if (tool === 'draw' || tool === 'internalWall') setHover(snapToPlanPoint(point));
      return;
    }
    if (drag.type === 'holeRect') {
      const end = snapToPlanPoint(point);
      const start = drag.start;
      if (distance(start, end) > 0.05) movedRef.current = true;
      const corners = [
        { x: start.x, z: start.z },
        { x: end.x, z: start.z },
        { x: end.x, z: end.z },
        { x: start.x, z: end.z },
      ];
      rectRef.current = corners;
      setRectDraft(corners);
      return;
    }
    if (drag.type === 'pan') {
      const start = toWorld(drag.startClient.x, drag.startClient.y);
      const dx = point.x - start.x;
      const dz = point.z - start.z;
      if (Math.abs(dx) + Math.abs(dz) > 0.01) movedRef.current = true;
      setViewport({
        ...drag.startViewport,
        x: drag.startViewport.x - dx,
        y: drag.startViewport.y - dz,
      });
      return;
    }
    if (!movedRef.current) {
      beginHistory();
      movedRef.current = true;
    }
    if (drag.type === 'vertex') {
      moveVertex(drag.index, snapPointIfNeeded(point), { history: false, touch: false });
      return;
    }
    if (drag.type === 'internalWallPoint') {
      moveInternalWallPoint(drag.id, drag.endpoint, snapPointIfNeeded(point), {
        history: false,
        touch: false,
      });
      return;
    }
    if (drag.type === 'object') {
      const next = snapPointIfNeeded({
        x: point.x + drag.offset.x,
        z: point.z + drag.offset.z,
      });
      const object = useEditorStore.getState().project?.objects.find((entry) => entry.id === drag.id);
      if (!object) return;
      updateObjectTransform(
        drag.id,
        { position: [next.x, object.transform.position[1], next.z] },
        { history: false, touch: false },
      );
      return;
    }
    if (drag.type === 'exhibitor') {
      const next = snapPointIfNeeded({
        x: point.x + drag.offset.x,
        z: point.z + drag.offset.z,
      });
      moveExhibitor(drag.id, next, { history: false, touch: false });
      return;
    }
    if (drag.type === 'rotationPoint') {
      const next = snapPointIfNeeded({
        x: point.x + drag.offset.x,
        z: point.z + drag.offset.z,
      });
      moveRotationPoint(drag.id, next, { history: false, touch: false });
      return;
    }
    if (drag.type === 'stair') {
      const next = snapPointIfNeeded({
        x: point.x + drag.offset.x,
        z: point.z + drag.offset.z,
      });
      moveStair(drag.id, next, { history: false, touch: false });
      return;
    }
    if (drag.type === 'hole') {
      movedRef.current = true;
      // Se recoloca el centro del hueco a partir del punto de partida del
      // arrastre, no acumulando deltas: así el corte sigue al cursor sin
      // desfase aunque el snap o el temblor del puntero cambien el delta.
      // El snap se aplica al centro resultante (no al puntero) para que el
      // corte quede sobre la retícula como el resto de elementos.
      const target = {
        x: drag.startCenter.x + (point.x - drag.startPointer.x),
        z: drag.startCenter.z + (point.z - drag.startPointer.z),
      };
      setHoleCenter(drag.id, snapPointIfNeeded(target), { history: false, touch: false });
      return;
    }
    if (drag.type === 'holeVertex') {
      movedRef.current = true;
      setHoleVertex(drag.id, drag.index, snapPointIfNeeded(point), { history: false, touch: false });
      return;
    }
    if (drag.type === 'level') {
      movedRef.current = true;
      if (drag.mode === 'translate') {
        // Se recoloca desde el inicio del arrastre: el cursor marca cuánto se
        // movió el piso, sin acumular deriva entre frames.
        const delta = { x: point.x - drag.startPointer.x, z: point.z - drag.startPointer.z };
        previewLevelTransform(drag.levelId, drag.base, {
          delta: snap
            ? { x: snapValue(delta.x, gridSize), z: snapValue(delta.z, gridSize) }
            : delta,
          angle: 0,
          pivot: drag.pivot,
        });
      } else {
        // En planta la Y del SVG apunta hacia +Z, así que el ángulo medido por
        // `atan2` crece en sentido horario; el nivel gira en el sentido de
        // three.js (positivo = antihorario visto desde arriba), de ahí el signo.
        const angle = drag.startAngle
          - Math.atan2(point.z - drag.pivot.z, point.x - drag.pivot.x);
        previewLevelTransform(drag.levelId, drag.base, {
          delta: { x: 0, z: 0 },
          angle: snap ? snapValue(angle, Math.PI / 12) : angle,
          pivot: drag.pivot,
        });
      }
      return;
    }
  };

  const onPointerUp = () => {
    // Un clic sobre un elemento no debe dejar «enganchado» el arrastre: al
    // mover el ratón después, la pieza no sigue al cursor por accidente. Solo
    // se cierra el arrastre si el puntero se movió de verdad.
    if (dragRef.current && !movedRef.current) {
      dragRef.current = null;
      if (pressedPointerRef.current != null) {
        try {
          svgRef.current?.releasePointerCapture(pressedPointerRef.current);
        } catch {
          // El puntero ya se soltó solo; no hay nada que liberar.
        }
      }
      pressedPointerRef.current = null;
      return;
    }
    pressedPointerRef.current = null;
    finishDrag();
  };
  const onPointerLeave = () => {
    if (!dragRef.current) setHover(null);
  };

  const onClick = (event: ReactMouseEvent<SVGSVGElement>) => {
    if (suppressClickRef.current) {
      suppressClickRef.current = false;
      return;
    }
    const rawPoint = toWorld(event.clientX, event.clientY);
    const point = snapPointIfNeeded(rawPoint);
    const state = useEditorStore.getState();

    if (state.tool === 'draw') {
      const drawPoint = snapToPlanPoint(rawPoint);
      const first = draft[0];
      const rect = svgRef.current?.getBoundingClientRect();
      const closeDistance = rect ? (viewport.width / Math.max(rect.width, 1)) * 14 : 0.25;
      if (first && draft.length >= 3 && distance(drawPoint, first) <= closeDistance) {
        closeDraft();
        return;
      }
      if (draft.some((entry) => distance(entry, drawPoint) < 0.02)) return;
      setDraft((current) => [...current, drawPoint]);
      setHover(drawPoint);
      return;
    }

    if (state.tool === 'internalWall') {
      const wallPoint = snapToPlanPoint(rawPoint);
      if (!wallStart) {
        setWallStart(wallPoint);
        setHover(wallPoint);
        return;
      }
      if (distance(wallStart, wallPoint) <= 0.08) return;
      const id = addInternalWall(wallStart, wallPoint);
      if (id) {
        setWallStart(wallPoint);
        setHover(wallPoint);
      }
      return;
    }

    if (state.tool === 'door' || state.tool === 'window') {
      toast('Haz clic sobre un muro para colocar la abertura.', 'warning');
      return;
    }

    if (state.pendingCatalogItem) {
      if (activeLevel && (activeLevel.spaces.some((s) => s.vertices.length >= 3)) && !pointInLevel(activeLevel, point)) {
        toast('Coloca el objeto dentro de un espacio del nivel activo.', 'warning');
        return;
      }
      const id = addObject(state.pendingCatalogItem, point);
      if (id) toast(`«${state.pendingCatalogItem.name}» colocado.`, 'success');
      return;
    }

    if (state.tool === 'stair') {
      if (activeLevel && (activeLevel.spaces.some((s) => s.vertices.length >= 3)) && !pointInLevel(activeLevel, point)) {
        toast('Coloca la escalera dentro de un espacio del nivel activo.', 'warning');
        return;
      }
      addStair(point);
      return;
    }

    if (state.tool === 'exhibitor') {
      if (activeLevel && (activeLevel.spaces.some((s) => s.vertices.length >= 3)) && !pointInLevel(activeLevel, point)) {
        toast('Coloca el expositor dentro de un espacio del nivel activo.', 'warning');
        return;
      }
      addExhibitor(point);
      return;
    }

    if (state.tool === 'rotationPoint') {
      if (activeLevel && (activeLevel.spaces.some((s) => s.vertices.length >= 3)) && !pointInLevel(activeLevel, point)) {
        toast('Coloca el punto de rotación dentro de un espacio del nivel activo.', 'warning');
        return;
      }
      addRotationPoint(point);
      return;
    }

    // Clic sobre el forjado en modo selección: se selecciona el piso completo
    // para moverlo o girarlo en 3D con el gizmo, que `setSelection` enciende al
    // seleccionar un nivel. Fuera de la planta se deselecciona, como siempre.
    if (
      state.tool === 'select' &&
      activeLevel &&
      activeSpace &&
      activeSpace.vertices.length >= 3 &&
      pointInPolygon(point, activeSpace.vertices)
    ) {
      setSelection({ type: 'level', id: activeLevel.id });
      return;
    }

    setSelection(null);
  };

  const onLevelGizmoPointerDown = (
    event: ReactPointerEvent,
    mode: 'translate' | 'rotate',
    pivot: Vec2,
  ) => {
    if (tool !== 'select' || !activeLevel) return;
    event.stopPropagation();
    event.preventDefault();
    const current = useEditorStore.getState().project;
    if (!current) return;
    const point = toWorld(event.clientX, event.clientY);
    beginDrag(event, {
      type: 'level',
      levelId: activeLevel.id,
      mode,
      startPointer: point,
      pivot: { ...pivot },
      startAngle: Math.atan2(point.z - pivot.z, point.x - pivot.x),
      base: structuredClone(current),
    });
    setSelection({ type: 'level', id: activeLevel.id });
  };

  const onHolePointerDown = (event: ReactPointerEvent, holeId: string) => {
    if (tool !== 'select') return;
    event.stopPropagation();
    event.preventDefault();
    const hole = activeSpace?.holes.find((entry) => entry.id === holeId);
    if (!hole || hole.vertices.length < 3) return;
    const bounds = polygonBounds(hole.vertices);
    beginDrag(event, {
      type: 'hole',
      id: holeId,
      startPointer: toWorld(event.clientX, event.clientY),
      startCenter: bounds.center,
    });
    setSelection({ type: 'hole', id: holeId, spaceId: activeSpace?.id });
  };

  const onHoleVertexPointerDown = (event: ReactPointerEvent, holeId: string, index: number) => {
    if (tool !== 'select') return;
    event.stopPropagation();
    event.preventDefault();
    beginDrag(event, { type: 'holeVertex', id: holeId, index });
    setSelection({ type: 'hole', id: holeId, spaceId: activeSpace?.id });
  };

  const onVertexPointerDown = (event: ReactPointerEvent, index: number) => {
    if (tool !== 'select') return;
    event.stopPropagation();
    event.preventDefault();
    beginDrag(event, { type: 'vertex', index });
    setSelection({ type: 'vertex', index, spaceId: activeSpace?.id });
  };

  const onInternalWallPointPointerDown = (
    event: ReactPointerEvent,
    id: string,
    endpoint: 'a' | 'b',
  ) => {
    if (tool !== 'select') return;
    event.stopPropagation();
    event.preventDefault();
    beginDrag(event, { type: 'internalWallPoint', id, endpoint });
    setSelection({ type: 'internalWall', id });
  };

  const onObjectPointerDown = (event: ReactPointerEvent, object: SceneObject) => {
    if (tool !== 'select') return;
    event.stopPropagation();
    event.preventDefault();
    const point = toWorld(event.clientX, event.clientY);
    beginDrag(event, {
      type: 'object',
      id: object.id,
      offset: {
        x: object.transform.position[0] - point.x,
        z: object.transform.position[2] - point.z,
      },
    });
    setSelection({ type: 'object', id: object.id });
  };

  const onExhibitorPointerDown = (event: ReactPointerEvent, id: string, position: Vec2) => {
    if (tool !== 'select') return;
    event.stopPropagation();
    event.preventDefault();
    const point = toWorld(event.clientX, event.clientY);
    beginDrag(event, {
      type: 'exhibitor',
      id,
      offset: { x: position.x - point.x, z: position.z - point.z },
    });
    setSelection({ type: 'exhibitor', id });
  };

  const onRotationPointPointerDown = (event: ReactPointerEvent, id: string, position: Vec2) => {
    if (tool !== 'select') return;
    event.stopPropagation();
    event.preventDefault();
    const point = toWorld(event.clientX, event.clientY);
    beginDrag(event, {
      type: 'rotationPoint',
      id,
      offset: { x: position.x - point.x, z: position.z - point.z },
    });
    setSelection({ type: 'rotationPoint', id });
  };

  const onStairPointerDown = (event: ReactPointerEvent, stair: Stair) => {
    if (tool !== 'select') return;
    event.stopPropagation();
    event.preventDefault();
    const point = toWorld(event.clientX, event.clientY);
    beginDrag(event, {
      type: 'stair',
      id: stair.id,
      offset: { x: stair.position.x - point.x, z: stair.position.z - point.z },
    });
    setSelection({ type: 'stair', id: stair.id });
  };

  const handleEdgeClick = (event: ReactMouseEvent, index: number) => {
    if (tool === 'internalWall') return;
    event.stopPropagation();
    if ((tool === 'door' || tool === 'window') && event.detail > 1) return;
    const edge = activeSpace?.edges[index];
    const a = vertices[index];
    const b = vertices[(index + 1) % vertices.length];
    if (!edge || !a || !b) return;
    if (tool === 'door' || tool === 'window') {
      if (!edge.wall) {
        toast('Activa este borde como muro antes de añadir una abertura.', 'warning');
        return;
      }
      const point = toWorld(event.clientX, event.clientY);
      addOpening(edge.id, tool, pointOffsetOnWall(point, a, b));
      return;
    }
    // En el segundo clic de un doble clic no se vuelve a alternar el muro;
    // el doble clic (solo en modo selección) se encarga de esa acción.
    if (tool === 'wall' && event.detail > 1) return;
    if (tool === 'wall') {
      toggleWall(index);
    }
    setSelection({ type: 'edge', index, spaceId: activeSpace?.id });
  };

  const handleInternalWallClick = (event: ReactMouseEvent, wallId: string) => {
    if (tool === 'internalWall') return;
    event.stopPropagation();
    if ((tool === 'door' || tool === 'window') && event.detail > 1) return;
    const wall = internalWalls.find((entry) => entry.id === wallId);
    if (!wall) return;
    if (tool === 'door' || tool === 'window') {
      const point = toWorld(event.clientX, event.clientY);
      addOpening(wall.id, tool, pointOffsetOnWall(point, wall.a, wall.b));
      return;
    }
    setSelection({ type: 'internalWall', id: wall.id });
  };

  const handleOpeningSelect = (id: string) => {
    setSelection({ type: 'opening', id });
  };

  const area = vertices.length >= 3 ? polygonArea(vertices) : 0;
  const wallCount = spaces.reduce(
    (total, space) => total + space.edges.filter((edge) => edge.wall).length,
    0,
  ) + internalWalls.length;
  const validation = validatePolygon(vertices);
  const textSize = Math.max(viewport.width / 115, 0.11);
  const hitWidth = Math.max(viewport.width / 90, 0.22);
  const vertexRadius = Math.max(viewport.width / 230, 0.055);
  const sameSpace = (spaceId?: string) => !spaceId || spaceId === activeSpace?.id;
  const selectedVertex =
    selection?.type === 'vertex' && sameSpace(selection.spaceId) ? selection.index : null;
  const selectedEdge =
    selection?.type === 'edge' && sameSpace(selection.spaceId) ? selection.index : null;
  const selectedInternalWall = selection?.type === 'internalWall' ? selection.id : null;
  const selectedOpening = selection?.type === 'opening' ? selection.id : null;
  const selectedHole = selection?.type === 'hole' ? selection.id : null;
  /**
   * Forjado ya restado: los cortes pegados al borde dejan ese lado abierto en
   * la planta igual que en el 3D, en vez de quedar como una mancha encima.
   */
  const floorPieces = useMemo(() => {
    if (vertices.length < 3) return [];
    const pieces = clipFloorPieces(
      vertices,
      (activeSpace?.holes ?? []).map((hole) => hole.vertices),
    );
    return pieces ?? [];
  }, [vertices, activeSpace?.holes]);
  const selectedExhibitorId = selection?.type === 'exhibitor' ? selection.id : null;
  /**
   * Gizmo del piso en planta: al hacer clic sobre el forjado se selecciona el
   * nivel y aparece este control, igual que en 3D, para moverlo o girarlo
   * entero sin pasar por los botones del panel de niveles.
   */
  const levelGizmoActive =
    tool === 'select' && levelGizmoId !== null && levelGizmoId === activeLevel?.id;
  const levelGizmoPivot = levelGizmoActive && activeLevel ? levelPivot(activeLevel) : null;
  const openingPaintColor = (opening: WallOpening) => {
    const exhibitor = findExhibitor(project, opening.exhibitorId);
    const amount = exhibitorPaintAmount(project, opening.exhibitorId, selectedExhibitorId);
    if (!exhibitor || amount <= 0) return undefined;
    const base = opening.kind === 'door' ? '#e8c98a' : '#7dd3fc';
    return mixHexColors(base, exhibitorColor(exhibitor), amount);
  };
  const dimExisting = tool === 'draw' && planDrawMode === 'outline' && draft.length > 0;
  const rectSize = rectDraft && rectDraft.length >= 3
    ? {
        width: Math.abs(rectDraft[2].x - rectDraft[0].x),
        depth: Math.abs(rectDraft[2].z - rectDraft[0].z),
        center: {
          x: (rectDraft[0].x + rectDraft[2].x) / 2,
          z: (rectDraft[0].z + rectDraft[2].z) / 2,
        },
      }
    : null;

  /**
   * Resumen del contorno en construcción: largo del tramo actual, área que ya
   * encierra y perímetro. Se muestra en la barra de acciones mientras se dibuja.
   */
  const draftLive = useMemo(() => {
    if (!draft.length) return null;
    const last = draft[draft.length - 1];
    const segment = hover ? distance(last, hover) : 0;
    const perimeter =
      draft.reduce(
        (total, point, index) =>
          index === 0 ? total : total + distance(draft[index - 1], point),
        0,
      ) + (hover ? distance(last, hover) : 0);
    const area = draft.length >= 3 ? Math.abs(polygonArea(draft)) : 0;
    return {
      segment,
      area,
      perimeter,
      color:
        planDrawMode === 'space'
          ? '#7dd3fc'
          : planDrawMode === 'hole'
            ? '#ff8a65'
            : planDrawMode === 'partition'
              ? '#c4b5fd'
              : undefined,
    };
  }, [draft, hover, planDrawMode]);

  const objectFootprints = useMemo(
    () =>
      project.objects
        .filter((object) => entityLevelId(project, object) === activeLevel?.id)
        .map((object) => {
        const size = object.size ?? [0.8, 1, 0.8];
        return {
          object,
          width: Math.max(size[0] * Math.abs(object.transform.scale[0]), 0.18),
          depth: Math.max(size[2] * Math.abs(object.transform.scale[2]), 0.18),
        };
      }),
    [project, activeLevel],
  );

  return (
    <div className="plan-wrap">
      <svg
        ref={svgRef}
        className={`plan-svg${tool === 'select' ? ' is-select' : ''}${tool === 'pan' || spaceDown ? ' is-panning' : ''}`}
        viewBox={`${viewport.x} ${viewport.y} ${viewport.width} ${viewport.height}`}
        preserveAspectRatio="xMidYMid meet"
        onPointerDown={onPointerDown}
        onPointerMove={onPointerMove}
        onPointerUp={onPointerUp}
        onPointerCancel={onPointerUp}
        onPointerLeave={onPointerLeave}
        onClick={onClick}
        onContextMenu={(event) => event.preventDefault()}
      >
        <defs>
          <pattern
            id={gridId}
            width={gridSize}
            height={gridSize}
            patternUnits="userSpaceOnUse"
          >
            <path
              d={`M ${gridSize} 0 L 0 0 0 ${gridSize}`}
              fill="none"
              stroke="rgba(255,255,255,.055)"
              strokeWidth={Math.max(viewport.width / 1500, 0.004)}
            />
          </pattern>
          <pattern
            id={majorId}
            width={gridSize * 5}
            height={gridSize * 5}
            patternUnits="userSpaceOnUse"
          >
            <path
              d={`M ${gridSize * 5} 0 L 0 0 0 ${gridSize * 5}`}
              fill="none"
              stroke="rgba(255,255,255,.1)"
              strokeWidth={Math.max(viewport.width / 1100, 0.005)}
            />
          </pattern>
        </defs>

        <rect
          x={viewport.x}
          y={viewport.y}
          width={viewport.width}
          height={viewport.height}
          fill="#090c0f"
        />
        {showGrid ? (
          <>
            <rect
              x={viewport.x}
              y={viewport.y}
              width={viewport.width}
              height={viewport.height}
              fill={`url(#${gridId})`}
            />
            <rect
              x={viewport.x}
              y={viewport.y}
              width={viewport.width}
              height={viewport.height}
              fill={`url(#${majorId})`}
            />
          </>
        ) : null}

        <line
          x1={viewport.x}
          y1={0}
          x2={viewport.x + viewport.width}
          y2={0}
          stroke="rgba(255,255,255,.08)"
          strokeWidth={Math.max(viewport.width / 1400, 0.004)}
        />
        <line
          x1={0}
          y1={viewport.y}
          x2={0}
          y2={viewport.y + viewport.height}
          stroke="rgba(255,255,255,.08)"
          strokeWidth={Math.max(viewport.width / 1400, 0.004)}
        />

        {spaces
          .filter((space) => space.id !== activeSpace?.id && space.vertices.length >= 3)
          .map((space) => (
            <polygon
              key={space.id}
              points={space.vertices.map((point) => `${point.x},${point.z}`).join(' ')}
              fill={space.color}
              fillOpacity={0.08}
              stroke="rgba(255,255,255,.16)"
              strokeWidth={Math.max(viewport.width / 1200, 0.005)}
              strokeDasharray={`${viewport.width / 140} ${viewport.width / 200}`}
              style={{ cursor: tool === 'select' ? 'pointer' : 'default' }}
              onClick={(event) => {
                if (tool !== 'select') return;
                event.stopPropagation();
                setActiveSpace(space.id);
              }}
            />
          ))}

        {vertices.length >= 3 ? (
          <g opacity={dimExisting ? 0.35 : 1}>
            {floorPieces.map((piece, pieceIndex) => (
              <path
                key={`floor-piece-${pieceIndex}`}
                d={[piece.outer, ...piece.holes].map(ringToPath).join(' ')}
                fill={activeSpace?.color ?? '#b8ae9d'}
                fillOpacity={0.22}
                fillRule="evenodd"
                stroke="rgba(255,255,255,.16)"
                strokeWidth={Math.max(viewport.width / 1000, 0.006)}
                strokeLinejoin="round"
              />
            ))}
            {edges.map((edge, index) => {
              const a = vertices[index];
              const b = vertices[(index + 1) % vertices.length];
              if (!a || !b) return null;
              const isSelected = selectedEdge === index;
              const isOpen = !edge.wall;
              const length = edgeLength(vertices, index);
              const edgeOpenings = isOpen
                ? []
                : levelOpenings.filter((opening) => opening.wallId === edge.id);
              const ranges = isOpen ? [] : getSolidRanges(length, edgeOpenings);
              const wallColor = isSelected
                ? '#d7ff4f'
                : paintedExhibitorColor(project, edge.exhibitorId, edge.color, selectedExhibitorId);
              const wallWidth = Math.max(edge.thickness, viewport.width / 800);
              return (
                <g key={edge.id || index}>
                  {isOpen ? (
                    <line
                      x1={a.x}
                      y1={a.z}
                      x2={b.x}
                      y2={b.z}
                      stroke={isSelected ? '#d7ff4f' : 'rgba(255,255,255,.35)'}
                      strokeWidth={Math.max(viewport.width / 900, 0.012)}
                      strokeDasharray={`${viewport.width / 160} ${viewport.width / 220}`}
                      strokeLinecap="butt"
                      opacity={0.8}
                      pointerEvents="none"
                    />
                  ) : (
                    ranges.map((range, rangeIndex) => {
                      const p1 = pointAtWallOffset(a, b, range.start);
                      const p2 = pointAtWallOffset(a, b, range.end);
                      return (
                        <line
                          key={`${edge.id}-solid-${rangeIndex}`}
                          data-edge-id={edge.id}
                          x1={p1.x}
                          y1={p1.z}
                          x2={p2.x}
                          y2={p2.z}
                          stroke={wallColor}
                          strokeWidth={wallWidth}
                          strokeLinecap="butt"
                          opacity={0.94}
                          pointerEvents="none"
                        />
                      );
                    })
                  )}
                  <line
                    data-edge-hit={edge.id}
                    x1={a.x}
                    y1={a.z}
                    x2={b.x}
                    y2={b.z}
                    stroke="transparent"
                    strokeWidth={hitWidth}
                    style={{ cursor: 'pointer' }}
                    onClick={(event) => handleEdgeClick(event, index)}
                    onDoubleClick={(event) => {
                      event.stopPropagation();
                      if (tool === 'wall' || tool === 'door' || tool === 'window' || tool === 'internalWall') return;
                      toggleWall(index);
                      setSelection({ type: 'edge', index, spaceId: activeSpace?.id });
                    }}
                  />
                  {!isOpen ? (
                    <OpeningMarks
                      a={a}
                      b={b}
                      height={edge.height}
                      thickness={edge.thickness}
                      openings={edgeOpenings}
                      selectedId={selectedOpening}
                      textSize={textSize}
                      hitWidth={hitWidth}
                      paintColorFor={openingPaintColor}
                      showMeasurements={showLive}
                      onSelect={tool === 'internalWall' ? undefined : handleOpeningSelect}
                    />
                  ) : null}
                  {showDimensions ? (
                    <text
                      x={(a.x + b.x) / 2 + (-(b.z - a.z) / Math.max(length, 0.001)) * textSize * 1.4}
                      y={(a.z + b.z) / 2 + ((b.x - a.x) / Math.max(length, 0.001)) * textSize * 1.4}
                      textAnchor="middle"
                      dominantBaseline="middle"
                      fill="rgba(255,255,255,.55)"
                      fontSize={textSize}
                      fontFamily="var(--mono)"
                      pointerEvents="none"
                    >
                      {formatMeters(length, 2)}
                    </text>
                  ) : null}
                </g>
              );
            })}
          </g>
        ) : null}

        {internalWalls.map((wall) => {
          const selected = selectedInternalWall === wall.id;
          const length = wallLength(wall.a, wall.b);
          if (length <= 0.01) return null;
          const wallOpenings = levelOpenings.filter((opening) => opening.wallId === wall.id);
          const ranges = getSolidRanges(length, wallOpenings);
          const wallColor = selected
            ? '#d7ff4f'
            : paintedExhibitorColor(project, wall.exhibitorId, wall.color, selectedExhibitorId);
          const wallWidth = Math.max(wall.thickness, viewport.width / 800);
          const direction = wallDirection(wall.a, wall.b);
          const center = pointAtWallOffset(wall.a, wall.b, length / 2);
          return (
            <g key={wall.id}>
              {ranges.map((range, rangeIndex) => {
                const p1 = pointAtWallOffset(wall.a, wall.b, range.start);
                const p2 = pointAtWallOffset(wall.a, wall.b, range.end);
                return (
                  <line
                    key={`${wall.id}-solid-${rangeIndex}`}
                    data-internal-wall-id={wall.id}
                    x1={p1.x}
                    y1={p1.z}
                    x2={p2.x}
                    y2={p2.z}
                    stroke={wallColor}
                    strokeWidth={wallWidth}
                    strokeLinecap="butt"
                    opacity={0.94}
                    pointerEvents="none"
                  />
                );
              })}
              <line
                data-internal-wall-hit={wall.id}
                x1={wall.a.x}
                y1={wall.a.z}
                x2={wall.b.x}
                y2={wall.b.z}
                stroke="transparent"
                strokeWidth={hitWidth}
                style={{ cursor: 'pointer' }}
                onClick={(event) => handleInternalWallClick(event, wall.id)}
                onDoubleClick={(event) => {
                  event.stopPropagation();
                  if (tool !== 'select') return;
                  const point = toWorld(event.clientX, event.clientY);
                  const offset = pointOffsetOnWall(point, wall.a, wall.b);
                  if (offset <= 0.1 || length - offset <= 0.1) return;
                  insertVertexOnInternalWall(
                    wall.id,
                    pointAtWallOffset(wall.a, wall.b, offset),
                  );
                  toast(
                    'Nodo insertado. Arrastra los nodos del muro para cambiar su forma.',
                    'success',
                  );
                }}
              >
                <title>Doble clic para insertar un nodo</title>
              </line>
              <OpeningMarks
                a={wall.a}
                b={wall.b}
                height={wall.height}
                thickness={wall.thickness}
                openings={wallOpenings}
                selectedId={selectedOpening}
                textSize={textSize}
                hitWidth={hitWidth}
                paintColorFor={openingPaintColor}
                showMeasurements={showLive}
                onSelect={tool === 'internalWall' ? undefined : handleOpeningSelect}
              />
              {showDimensions ? (
                <text
                  x={center.x - direction.z * textSize * 1.4}
                  y={center.z + direction.x * textSize * 1.4}
                  textAnchor="middle"
                  dominantBaseline="middle"
                  fill={selected ? '#d7ff4f' : 'rgba(255,255,255,.55)'}
                  fontSize={textSize}
                  fontFamily="var(--mono)"
                  pointerEvents="none"
                >
                  {formatMeters(length, 2)}
                </text>
              ) : null}
            </g>
          );
        })}

        {/* Cortes de suelo. Se dibujan por encima del forjado y de los muros y
            con un área de acierto generosa: el contorno es fino y, si el corte
            está pegado al borde, antes costaba acertar cuál de los dos se
            seleccionaba. El área de acierto va antes de las escaleras para no
            taparlas, porque el corte suele estar justo debajo de ellas. */}
        {(activeSpace?.holes ?? [])
          .filter((hole) => hole.vertices.length >= 3)
          .map((hole) => (
            <polygon
              key={`hole-hit-${hole.id}`}
              points={hole.vertices.map((point) => `${point.x},${point.z}`).join(' ')}
              fill="none"
              stroke="none"
              strokeWidth={hitWidth}
              data-hole-hit={hole.id}
              pointerEvents="all"
              style={{ cursor: tool === 'select' ? 'move' : 'default' }}
              onPointerDown={(event) => onHolePointerDown(event, hole.id)}
              onClick={(event) => {
                if (tool !== 'select') return;
                event.stopPropagation();
                setSelection({ type: 'hole', id: hole.id, spaceId: activeSpace?.id });
              }}
            >
              <title>{tool === 'select' ? `${hole.name} · arrastra para mover` : hole.name}</title>
            </polygon>
          ))}

        {stairs.map((stair) => {
          if (!stair.visible) return null;
          const selected = selection?.type === 'stair' && selection.id === stair.id;
          const rects = stairFootprintRects(stair);
          const bounds = stairFootprintBounds(stair);
          const run = stair.kind === 'straight'
            ? stair.steps * stair.tread
            : Math.max(0.6, stair.steps * stair.tread * 0.5);
          const start = transformStairPoint(stair, { x: 0, z: 0 });
          const end = transformStairPoint(stair, { x: 0, z: run });
          const length = Math.max(distance(start, end), 0.001);
          const ux = (end.x - start.x) / length;
          const uz = (end.z - start.z) / length;
          const head = Math.max(viewport.width / 90, 0.16);
          return (
            <g
              key={stair.id}
              data-stair-id={stair.id}
              style={{ cursor: tool === 'select' ? 'grab' : 'default' }}
              onPointerDown={(event) => onStairPointerDown(event, stair)}
              onClick={(event) => {
                if (tool !== 'select') return;
                event.stopPropagation();
                setSelection({ type: 'stair', id: stair.id });
              }}
            >
              {rects.map((rect, index) => {
                const points = [
                  { x: rect.x0, z: rect.z0 },
                  { x: rect.x1, z: rect.z0 },
                  { x: rect.x1, z: rect.z1 },
                  { x: rect.x0, z: rect.z1 },
                ]
                  .map((corner) => transformStairPoint(stair, corner))
                  .map((corner) => `${corner.x},${corner.z}`)
                  .join(' ');
                return (
                  <polygon
                    key={`${stair.id}-rect-${index}`}
                    points={points}
                    fill={selected ? 'rgba(215,255,79,.3)' : 'rgba(201,194,180,.24)'}
                    stroke={selected ? '#d7ff4f' : 'rgba(255,255,255,.45)'}
                    strokeWidth={Math.max(viewport.width / 1300, 0.008)}
                    strokeLinejoin="round"
                  />
                );
              })}
              <line
                x1={start.x}
                y1={start.z}
                x2={end.x}
                y2={end.z}
                stroke={selected ? '#d7ff4f' : 'rgba(255,255,255,.7)'}
                strokeWidth={Math.max(viewport.width / 1100, 0.012)}
                pointerEvents="none"
              />
              <polyline
                points={[
                  { x: end.x - ux * head - uz * head * 0.6, z: end.z - uz * head + ux * head * 0.6 },
                  { x: end.x, z: end.z },
                  { x: end.x - ux * head + uz * head * 0.6, z: end.z - uz * head - ux * head * 0.6 },
                ].map((point) => `${point.x},${point.z}`).join(' ')}
                fill="none"
                stroke={selected ? '#d7ff4f' : 'rgba(255,255,255,.7)'}
                strokeWidth={Math.max(viewport.width / 1100, 0.012)}
                pointerEvents="none"
              />
              <text
                x={bounds.center.x}
                y={bounds.center.z}
                textAnchor="middle"
                dominantBaseline="middle"
                fill={selected ? '#d7ff4f' : 'rgba(255,255,255,.75)'}
                fontSize={textSize * 0.9}
                fontFamily="var(--mono)"
                pointerEvents="none"
              >
                {stair.name}
              </text>
            </g>
          );
        })}

        {/* Contorno de los cortes. Se pinta por encima del forjado y de las
            escaleras para que se vea siempre, pero sin capturar eventos: la
            zona de acierto está más abajo, antes de las escaleras, para que
            una escalera apoyada sobre el corte siga siendo seleccionable. */}
        {(activeSpace?.holes ?? [])
          .filter((hole) => hole.vertices.length >= 3)
          .map((hole) => {
            const isSelected = selectedHole === hole.id;
            return (
              <polygon
                key={`hole-outline-${hole.id}`}
                points={hole.vertices.map((point) => `${point.x},${point.z}`).join(' ')}
                fill="none"
                stroke={isSelected ? '#ff8a65' : 'rgba(255,138,101,.8)'}
                strokeWidth={Math.max(viewport.width / 1100, 0.008)}
                strokeDasharray={`${viewport.width / 150} ${viewport.width / 220}`}
                pointerEvents="none"
              />
            );
          })}

        {selectedHole && tool === 'select'
          ? (activeSpace?.holes ?? [])
              .find((hole) => hole.id === selectedHole)
              ?.vertices.map((vertex, index) => (
                <circle
                  key={`hole-vertex-${selectedHole}-${index}`}
                  cx={vertex.x}
                  cy={vertex.z}
                  r={vertexRadius}
                  fill="#ff8a65"
                  stroke="#0e1114"
                  strokeWidth={Math.max(viewport.width / 1400, 0.006)}
                  style={{ cursor: 'grab' }}
                  onPointerDown={(event) => onHoleVertexPointerDown(event, selectedHole, index)}
                />
              ))
          : null}

        {selectedInternalWall && tool === 'select'
          ? (() => {
              const wall = internalWalls.find((entry) => entry.id === selectedInternalWall);
              if (!wall) return null;
              return (['a', 'b'] as const).map((endpoint) => {
                const point = wall[endpoint];
                return (
                  <circle
                    key={`${wall.id}-${endpoint}-handle`}
                    data-wall-id={wall.id}
                    data-wall-endpoint={endpoint}
                    cx={point.x}
                    cy={point.z}
                    r={vertexRadius * 1.2}
                    fill="#0e1114"
                    stroke="#d7ff4f"
                    strokeWidth={Math.max(viewport.width / 1400, 0.006)}
                    style={{ cursor: 'grab' }}
                    onPointerDown={(event) =>
                      onInternalWallPointPointerDown(event, wall.id, endpoint)
                    }
                    onClick={(event) => {
                      event.stopPropagation();
                      setSelection({ type: 'internalWall', id: wall.id });
                    }}
                  />
                );
              });
            })()
          : null}

        {objectFootprints.map(({ object, width, depth }) => {
          const selected = selection?.type === 'object' && selection.id === object.id;
          const exhibitor = findExhibitor(project, object.exhibitorId);
          const paintAmount = exhibitorPaintAmount(
            project,
            object.exhibitorId,
            selectedExhibitorId,
          );
          const paintColor = exhibitor && paintAmount > 0 ? exhibitorColor(exhibitor) : undefined;
          return (
            <g
              key={object.id}
              transform={`translate(${object.transform.position[0]} ${object.transform.position[2]}) rotate(${-(object.transform.rotationY * 180) / Math.PI})`}
              opacity={object.visible ? 1 : 0.35}
              style={{ cursor: tool === 'select' ? 'move' : 'pointer' }}
              onPointerDown={(event) => onObjectPointerDown(event, object)}
              onClick={(event) => {
                event.stopPropagation();
                setSelection({ type: 'object', id: object.id });
              }}
            >
              <rect
                x={-width / 2}
                y={-depth / 2}
                width={width}
                height={depth}
                rx={Math.min(width, depth) * 0.08}
                fill={
                  selected
                    ? 'rgba(215,255,79,.2)'
                    : paintColor
                      ? hexToRgba(paintColor, 0.18 + paintAmount * 0.25)
                      : 'rgba(255,255,255,.09)'
                }
                stroke={selected ? '#d7ff4f' : paintColor ?? 'rgba(255,255,255,.4)'}
                strokeWidth={Math.max(viewport.width / 1000, 0.006)}
              />
              {selected && showLive ? (
                <MeasureChip
                  x={0}
                  z={depth / 2 + textSize * 0.95}
                  text={`${formatMeters(width, 2)} × ${formatMeters(depth, 2)}`}
                  textSize={textSize}
                />
              ) : null}
              {showObjectLabels &&
              width * (viewport.width / Math.max(svgRef.current?.clientWidth ?? 800, 1)) > 34 ? (
                <text
                  x={0}
                  y={0}
                  textAnchor="middle"
                  dominantBaseline="middle"
                  fill="rgba(255,255,255,.7)"
                  fontSize={textSize * 0.85}
                  pointerEvents="none"
                >
                  {(() => {
                    // Misma regla que en 3D: código y/o nombre, cada uno con su
                    // interruptor del inspector.
                    const code = (object.code ?? '').trim();
                    const name = (object.name ?? '').trim();
                    const text = object.showCode && code
                      ? object.showName && name
                        ? `${code} · ${name}`
                        : code
                      : object.showName && name
                        ? name
                        : '';
                    if (!text) return null;
                    return text.length > 18 ? `${text.slice(0, 17)}…` : text;
                  })()}
                </text>
              ) : null}
            </g>
          );
        })}

        {project.exhibitors
          .filter((exhibitor) => entityLevelId(project, exhibitor) === activeLevel?.id)
          .map((exhibitor) => {
          const selected = selection?.type === 'exhibitor' && selection.id === exhibitor.id;
          const radius = Math.max(viewport.width / 120, 0.18);
          const color = exhibitor.notionMissing
            ? '#ff5d5d'
            : selected
              ? '#d7ff4f'
              : exhibitorColor(exhibitor);
          return (
            <g
              key={exhibitor.id}
              data-exhibitor-id={exhibitor.id}
              transform={`translate(${exhibitor.position.x} ${exhibitor.position.z})`}
              opacity={exhibitor.visible ? 1 : 0.35}
              style={{ cursor: tool === 'select' ? 'move' : 'pointer' }}
              onPointerDown={(event) => onExhibitorPointerDown(event, exhibitor.id, exhibitor.position)}
              onClick={(event) => {
                event.stopPropagation();
                setSelection({ type: 'exhibitor', id: exhibitor.id });
              }}
            >
              <circle
                r={radius}
                fill={
                  exhibitor.notionMissing
                    ? 'rgba(255,93,93,.25)'
                    : selected
                      ? 'rgba(215,255,79,.35)'
                      : hexToRgba(color, 0.2)
                }
                stroke={color}
                strokeWidth={Math.max(viewport.width / 900, 0.012)}
                strokeDasharray={exhibitor.notionMissing ? `${radius * 0.35} ${radius * 0.25}` : undefined}
              />
              <circle r={radius * 0.3} fill={color} />
              {/* Cámara de llegada: un cono sólido apunta hacia donde está la
                  cámara (fuera del stand) y su base ancha es el objetivo. Solo
                  se dibuja el rumbo; el campo de visión visible es el del
                  propio cono, como un icono de cámara en un plano. */}
              <g
                transform={`rotate(${(exhibitor.rotation * 180) / Math.PI})`}
                opacity={exhibitor.rotationCustom ? 1 : 0.55}
              >
                <path
                  d={`M 0 ${-radius * 0.22} L 0 ${radius * 0.22} L ${radius * 2.1} ${radius * 0.95} L ${radius * 2.1} ${-radius * 0.95} Z`}
                  fill={hexToRgba(color, selected ? 0.22 : 0.12)}
                  stroke={hexToRgba(color, selected ? 0.85 : 0.45)}
                  strokeWidth={Math.max(viewport.width / 1200, 0.008)}
                  strokeLinejoin="round"
                />
                <path
                  d={`M ${radius * 1.75} ${-radius * 0.16} L ${radius * 2.45} ${-radius * 0.16} L ${radius * 2.45} ${radius * 0.16} L ${radius * 2.1} ${radius * 0.16} L ${radius * 2.1} ${radius * 0.55} L ${radius * 1.75} ${radius * 0.55} Z`}
                  fill={color}
                  opacity={selected ? 1 : 0.8}
                  pointerEvents="none"
                />
              </g>
              {showExhibitorNames ? (
                <text
                  x={0}
                  y={-radius * 1.55}
                  textAnchor="middle"
                  fill={selected ? '#d7ff4f' : color}
                  fontSize={textSize * 0.9}
                  fontFamily="var(--font)"
                  pointerEvents="none"
                >
                  {exhibitor.name || 'Expositor'}
                  {exhibitor.standCode ? ` · ${exhibitor.standCode}` : ''}
                </text>
              ) : null}
            </g>
          );
        })}

        {project.rotationPoints
          .filter((point) => entityLevelId(project, point) === activeLevel?.id)
          .map((point) => {
          const selected = selection?.type === 'rotationPoint' && selection.id === point.id;
          const radius = Math.max(viewport.width / 170, 0.13);
          const color = selected ? '#d7ff4f' : '#b48cff';
          return (
            <g
              key={point.id}
              data-rotation-point-id={point.id}
              transform={`translate(${point.position.x} ${point.position.z})`}
              style={{ cursor: tool === 'select' ? 'move' : 'pointer' }}
              onPointerDown={(event) => onRotationPointPointerDown(event, point.id, point.position)}
              onClick={(event) => {
                event.stopPropagation();
                setSelection({ type: 'rotationPoint', id: point.id });
              }}
            >
              <rect
                x={-radius}
                y={-radius}
                width={radius * 2}
                height={radius * 2}
                transform="rotate(45)"
                fill={selected ? 'rgba(215,255,79,.3)' : 'rgba(180,140,255,.16)'}
                stroke={color}
                strokeWidth={Math.max(viewport.width / 900, 0.012)}
              />
              <circle r={radius * 0.32} fill={color} />
              {/* Flecha de dirección: hacia dónde mira la parada al viajar. */}
              <g transform={`rotate(${(point.heading * 180) / Math.PI})`}>
                <path
                  d={`M ${radius * 0.55} 0 L ${radius * 1.05} ${-radius * 0.34} L ${radius * 1.05} ${radius * 0.34} Z`}
                  fill={color}
                  opacity={selected ? 1 : 0.8}
                  pointerEvents="none"
                />
              </g>
              {selected ? (
                // Radio de la parada: pulso tenue alrededor del punto.
                <circle
                  r={radius * 2.6}
                  fill="none"
                  stroke={color}
                  strokeOpacity={0.28}
                  strokeWidth={Math.max(viewport.width / 1400, 0.006)}
                  strokeDasharray={`${radius * 0.5} ${radius * 0.4}`}
                  pointerEvents="none"
                />
              ) : null}
              <text
                x={0}
                y={-radius * 2}
                textAnchor="middle"
                fill={color}
                fontSize={textSize * 0.9}
                fontFamily="var(--font)"
                pointerEvents="none"
              >
                {point.name || 'Punto de rotación'}
              </text>
            </g>
          );
        })}

        {vertices.map((vertex, index) => {
          const selected = selectedVertex === index;
          return (
            <g key={`vertex-${index}`}>
              {selected ? (
                <circle
                  cx={vertex.x}
                  cy={vertex.z}
                  r={vertexRadius * 2.2}
                  fill="rgba(215,255,79,.12)"
                />
              ) : null}
              <circle
                cx={vertex.x}
                cy={vertex.z}
                r={selected ? vertexRadius * 1.45 : vertexRadius}
                fill={selected ? '#d7ff4f' : '#0e1114'}
                stroke={selected ? '#d7ff4f' : 'rgba(215,255,79,.8)'}
                strokeWidth={Math.max(viewport.width / 1400, 0.006)}
                style={{ cursor: tool === 'select' ? 'grab' : 'pointer' }}
                onPointerDown={(event) => onVertexPointerDown(event, index)}
                onClick={(event) => {
                  if (tool !== 'select') return;
                  event.stopPropagation();
                  setSelection({ type: 'vertex', index });
                }}
              />
            </g>
          );
        })}

        {/* Gizmo del piso en planta. Se dibuja sobre todo lo demás para poder
            arrastrarlo sin que lo tape otro elemento. */}
        {levelGizmoActive && levelGizmoPivot ? (
          <g>
            <circle
              cx={levelGizmoPivot.x}
              cy={levelGizmoPivot.z}
              r={Math.max(viewport.width / 60, 0.4)}
              fill="none"
              stroke="rgba(215,255,79,.45)"
              strokeWidth={Math.max(viewport.width / 1600, 0.005)}
              strokeDasharray={`${viewport.width / 200} ${viewport.width / 260}`}
              pointerEvents="none"
            />
            {levelGizmoMode === 'translate' ? (
              <g
                data-level-gizmo="translate"
                style={{ cursor: 'move' }}
                onPointerDown={(event) => onLevelGizmoPointerDown(event, 'translate', levelGizmoPivot)}
                onClick={(event) => event.stopPropagation()}
              >
                <line
                  x1={levelGizmoPivot.x - Math.max(viewport.width / 40, 0.6)}
                  y1={levelGizmoPivot.z}
                  x2={levelGizmoPivot.x + Math.max(viewport.width / 40, 0.6)}
                  y2={levelGizmoPivot.z}
                  stroke="#ff5d5d"
                  strokeWidth={Math.max(viewport.width / 900, 0.012)}
                  pointerEvents="none"
                />
                <line
                  x1={levelGizmoPivot.x}
                  y1={levelGizmoPivot.z - Math.max(viewport.width / 40, 0.6)}
                  x2={levelGizmoPivot.x}
                  y2={levelGizmoPivot.z + Math.max(viewport.width / 40, 0.6)}
                  stroke="#5dbaff"
                  strokeWidth={Math.max(viewport.width / 900, 0.012)}
                  pointerEvents="none"
                />
                <circle
                  cx={levelGizmoPivot.x}
                  cy={levelGizmoPivot.z}
                  r={Math.max(viewport.width / 120, 0.18)}
                  fill="rgba(215,255,79,.22)"
                  stroke="#d7ff4f"
                  strokeWidth={Math.max(viewport.width / 900, 0.012)}
                />
              </g>
            ) : (
              <g
                data-level-gizmo="rotate"
                style={{ cursor: 'grab' }}
                onPointerDown={(event) => onLevelGizmoPointerDown(event, 'rotate', levelGizmoPivot)}
                onClick={(event) => event.stopPropagation()}
              >
                <circle
                  cx={levelGizmoPivot.x}
                  cy={levelGizmoPivot.z}
                  r={Math.max(viewport.width / 60, 0.4)}
                  fill="rgba(215,255,79,.08)"
                  stroke="#d7ff4f"
                  strokeWidth={Math.max(viewport.width / 700, 0.016)}
                  strokeDasharray={`${viewport.width / 160} ${viewport.width / 240}`}
                />
                <circle
                  cx={levelGizmoPivot.x + Math.max(viewport.width / 60, 0.4)}
                  cy={levelGizmoPivot.z}
                  r={Math.max(viewport.width / 190, 0.1)}
                  fill="#d7ff4f"
                />
              </g>
            )}
            <g
              transform={`translate(${levelGizmoPivot.x} ${levelGizmoPivot.z + Math.max(viewport.width / 26, 0.9)})`}
              style={{ cursor: 'pointer' }}
              onPointerDown={(event) => {
                event.stopPropagation();
                event.preventDefault();
                setLevelGizmoMode(levelGizmoMode === 'translate' ? 'rotate' : 'translate');
              }}
              onClick={(event) => event.stopPropagation()}
            >
              <rect
                x={-(viewport.width / 18)}
                y={-textSize * 0.85}
                width={viewport.width / 9}
                height={textSize * 1.7}
                rx={textSize * 0.35}
                fill="rgba(14,17,20,.88)"
                stroke="#d7ff4f"
                strokeWidth={Math.max(viewport.width / 1800, 0.005)}
              />
              <text
                x={0}
                y={0}
                textAnchor="middle"
                dominantBaseline="middle"
                fill="#d7ff4f"
                fontSize={textSize * 0.78}
                fontFamily="var(--mono)"
                pointerEvents="none"
              >
                {levelGizmoMode === 'translate' ? 'Mover piso ▸ girar' : 'Girar piso ▸ mover'}
              </text>
            </g>
          </g>
        ) : null}

        {tool === 'draw' ? (
          <g>
            {rectDraft ? (
              <polygon
                points={rectDraft.map((point) => `${point.x},${point.z}`).join(' ')}
                fill="rgba(255,138,101,.18)"
                stroke="#ff8a65"
                strokeWidth={Math.max(viewport.width / 700, 0.018)}
              />
            ) : null}
            {showLive && rectSize ? (
              <MeasureChip
                x={rectSize.center.x}
                z={rectSize.center.z}
                text={`${formatMeters(rectSize.width, 2)} × ${formatMeters(rectSize.depth, 2)}`}
                textSize={textSize}
                color="#ff8a65"
              />
            ) : null}
            {showLive && rectDraft && rectDraft.length >= 3 ? (
              <>
                <LiveDimension a={rectDraft[0]} b={rectDraft[1]} textSize={textSize} color="#ff8a65" />
                <LiveDimension a={rectDraft[1]} b={rectDraft[2]} textSize={textSize} color="#ff8a65" />
                <LiveDimension a={rectDraft[2]} b={rectDraft[3]} textSize={textSize} color="#ff8a65" />
                <LiveDimension a={rectDraft[3]} b={rectDraft[0]} textSize={textSize} color="#ff8a65" />
              </>
            ) : null}
            {draft.length >= 2 ? (
              <polygon
                points={draft.map((point) => `${point.x},${point.z}`).join(' ')}
                fill="rgba(215,255,79,.08)"
                stroke="none"
              />
            ) : null}
            {draft.length >= 1 ? (
              <polyline
                points={draft.map((point) => `${point.x},${point.z}`).join(' ')}
                fill="none"
                stroke="#d7ff4f"
                strokeWidth={Math.max(viewport.width / 700, 0.018)}
                strokeLinejoin="round"
              />
            ) : null}
            {draft.length >= 1 && hover ? (
              <line
                x1={draft[draft.length - 1].x}
                y1={draft[draft.length - 1].z}
                x2={hover.x}
                y2={hover.z}
                stroke="rgba(215,255,79,.6)"
                strokeWidth={Math.max(viewport.width / 900, 0.012)}
                strokeDasharray={`${viewport.width / 180} ${viewport.width / 240}`}
              />
            ) : null}
            {showLive && draft.length >= 1 && hover ? (
              <LiveDimension
                a={draft[draft.length - 1]}
                b={hover}
                textSize={textSize}
                color={draftLive?.color}
              />
            ) : null}
            {/* Ejes del tramo que se está trazando: Δx / Δz medidos desde el
                último vértice, cada uno en su cota. */}
            {showLive && draft.length >= 1 && hover ? (
              <>
                <LiveDimension
                  a={{ x: draft[draft.length - 1].x, z: draft[draft.length - 1].z }}
                  b={{ x: hover.x, z: draft[draft.length - 1].z }}
                  textSize={textSize}
                  color="rgba(215,255,79,.5)"
                />
                <LiveDimension
                  a={{ x: hover.x, z: draft[draft.length - 1].z }}
                  b={hover}
                  textSize={textSize}
                  color="rgba(215,255,79,.5)"
                />
              </>
            ) : null}
            {/* Cierre hacia el primer vértice: largo y ancho con los que
                quedaría el contorno al pulsar sobre el punto de origen. */}
            {showLive &&
            draft.length >= 3 &&
            hover &&
            distance(hover, draft[0]) < viewport.width / 35 ? (
              <LiveDimension
                a={hover}
                b={draft[0]}
                textSize={textSize}
                color="rgba(215,255,79,.75)"
              />
            ) : null}
            {draft.length >= 3 && hover && distance(hover, draft[0]) < viewport.width / 35 ? (
              <line
                x1={hover.x}
                y1={hover.z}
                x2={draft[0].x}
                y2={draft[0].z}
                stroke="rgba(215,255,79,.85)"
                strokeWidth={Math.max(viewport.width / 900, 0.012)}
              />
            ) : null}
            {draft.map((point, index) => (
              <circle
                key={`draft-${index}`}
                cx={point.x}
                cy={point.z}
                r={index === 0 && draft.length >= 3 ? vertexRadius * 1.7 : vertexRadius}
                fill={index === 0 ? '#d7ff4f' : '#0e1114'}
                stroke="#d7ff4f"
                strokeWidth={Math.max(viewport.width / 1200, 0.008)}
                pointerEvents="none"
              />
            ))}
          </g>
        ) : null}

        {tool === 'internalWall' ? (
          <g>
            {wallStart && hover ? (
              <line
                x1={wallStart.x}
                y1={wallStart.z}
                x2={hover.x}
                y2={hover.z}
                stroke="#d7ff4f"
                strokeWidth={Math.max(viewport.width / 700, 0.018)}
                strokeDasharray={`${viewport.width / 180} ${viewport.width / 240}`}
                pointerEvents="none"
              />
            ) : null}
            {showLive && wallStart && hover ? (
              <LiveDimension a={wallStart} b={hover} textSize={textSize} />
            ) : null}
            {wallStart ? (
              <circle
                cx={wallStart.x}
                cy={wallStart.z}
                r={vertexRadius * 1.4}
                fill="#d7ff4f"
                stroke="#d7ff4f"
                strokeWidth={Math.max(viewport.width / 1200, 0.008)}
                pointerEvents="none"
              />
            ) : null}
          </g>
        ) : null}
      </svg>

      <div className="plan-hud">
        <span><strong>{activeLevel?.name ?? '—'}</strong> · {activeSpace?.name ?? 'sin espacio'}</span>
        <span><strong>{formatArea(area)}</strong> área</span>
        <span><strong>{vertices.length}</strong> vértices</span>
        <span><strong>{wallCount}</strong> muros</span>
        <span><strong>{internalWalls.length}</strong> divisiones</span>
        <span><strong>{levelOpenings.length}</strong> aberturas</span>
        {!validation.valid ? <span className="status-error">planta incompleta</span> : null}
      </div>

      {/* Lectura numérica del piso: centímetros movidos y grados girados, para
          poder corregirlo sin adivinar. Solo cuando el piso está en el gizmo. */}
      {levelGizmoActive && activeLevel ? (
        <div className="plan-level-readout">
          <LevelReadout level={activeLevel} />
          <span className="plan-level-readout-hint">
            {levelGizmoMode === 'translate'
              ? 'Arrastra el centro para mover el piso.'
              : 'Arrastra el anillo para girar el piso.'}
          </span>
        </div>
      ) : null}

      <div className="plan-scale">
        <span>Ancho visible</span>
        <strong>{viewport.width.toFixed(1)} m</strong>
        <span>cuadrícula {gridSize} m</span>
      </div>

      <div className="plan-zoom">
        <button type="button" title="Acercar" onClick={() => zoomAt(0.82)}><Plus size={15} /></button>
        <button type="button" title="Alejar" onClick={() => zoomAt(1.22)}><Minus size={15} /></button>
        <button
          type="button"
          title="Ajustar al nivel"
          onClick={() => {
            const all = levelAllVertices(activeLevel);
            setViewport(fitViewport(all.length ? all : vertices));
          }}
        >
          <Maximize size={15} />
        </button>
      </div>

      {tool === 'draw' ? (
        <div className="plan-draw-mode">
          <span>Al cerrar:</span>
          <button
            type="button"
            className={planDrawMode === 'partition' ? 'is-active' : ''}
            onClick={() => setPlanDrawMode('partition')}
            disabled={vertices.length < 3}
          >
            Añadir división
          </button>
          <button
            type="button"
            className={planDrawMode === 'outline' ? 'is-active' : ''}
            onClick={() => setPlanDrawMode('outline')}
          >
            Reemplazar contorno
          </button>
          <button
            type="button"
            className={planDrawMode === 'space' ? 'is-active' : ''}
            onClick={() => setPlanDrawMode('space')}
          >
            Nuevo espacio
          </button>
          <button
            type="button"
            className={planDrawMode === 'hole' ? 'is-active' : ''}
            onClick={() => setPlanDrawMode('hole')}
            disabled={vertices.length < 3}
          >
            Hueco en el suelo
          </button>
        </div>
      ) : null}

      {tool === 'draw' && draft.length > 0 ? (
        <div className="plan-draw-actions">
          <span>
            {showLive && draftLive && draftLive.segment > 0 ? (
              <><strong>{formatMeters(draftLive.segment, 2)}</strong> tramo · </>
            ) : null}
            {showLive && draftLive && draftLive.area > 0 ? (
              <><strong>{formatArea(draftLive.area)}</strong> · </>
            ) : null}
            {showLive && draftLive && draftLive.perimeter > 0 ? (
              <><strong>{formatMeters(draftLive.perimeter, 2)}</strong> perímetro · </>
            ) : null}
            {draft.length} vértice{draft.length === 1 ? '' : 's'} · Enter para{' '}
            {planDrawMode === 'space'
              ? 'crear el espacio'
              : planDrawMode === 'hole'
                ? 'recortar el hueco'
                : planDrawMode === 'partition' && vertices.length >= 3
                  ? 'añadir la división'
                  : 'cerrar'}
          </span>
          <Button size="sm" variant="ghost" onClick={() => { setDraft([]); setHover(null); }} icon={<X size={13} />}>
            Descartar
          </Button>
          <Button size="sm" variant="primary" onClick={closeDraft} icon={<Check size={13} />} disabled={draft.length < 3}>
            {planDrawMode === 'space'
              ? 'Crear espacio'
              : planDrawMode === 'hole'
                ? 'Recortar hueco'
                : planDrawMode === 'partition' && vertices.length >= 3
                  ? 'Añadir división'
                  : 'Cerrar contorno'}
          </Button>
        </div>
      ) : null}

      {tool === 'internalWall' && wallStart ? (
        <div className="plan-draw-actions">
          <span>
            {showLive && wallStart && hover ? (
              <><strong>{formatMeters(distance(wallStart, hover), 2)}</strong> · </>
            ) : null}
            Muro libre · sigue haciendo clic para encadenar tramos
          </span>
          <Button
            size="sm"
            variant="ghost"
            onClick={() => { setWallStart(null); setHover(null); }}
            icon={<X size={13} />}
          >
            Terminar
          </Button>
        </div>
      ) : null}

      <div className="plan-help">
        {tool === 'draw' ? (
          <>
            <strong>Dibujar:</strong> haz clic para añadir vértices. Cierra haciendo clic en el primer
            punto o pulsa Enter. «Añadir división» crea muros interiores, «Reemplazar contorno»
            redibuja el espacio activo y «Nuevo espacio» crea otro recinto en el mismo nivel.
          </>
        ) : tool === 'stair' ? (
          <>
            <strong>Escalera:</strong> haz clic dentro de un espacio para colocarla. Ajusta tipo
            (recta, L o U), peldaños, altura, ancho, huella y barandilla en el inspector.
          </>
        ) : tool === 'internalWall' ? (
          <>
            <strong>Muro libre:</strong> haz clic para iniciar un tramo y vuelve a hacer clic para
            terminarlo o encadenar otro. Esc termina la cadena. Selecciona un muro libre y arrastra
            sus nodos, o haz doble clic sobre él para insertar un nodo y cambiar su forma.
          </>
        ) : tool === 'door' || tool === 'window' ? (
          <>
            <strong>{tool === 'door' ? 'Puerta' : 'Ventana'}:</strong> haz clic sobre un muro
            perimetral o una división para colocar la abertura. Después selecciónala en 2D o 3D para
            moverla y cambiar su ancho y altura con los tiradores o el inspector.
          </>
        ) : tool === 'wall' ? (
          <>
            <strong>Muro / acceso:</strong> haz clic en un borde para abrirlo o cerrarlo. Los bordes
            abiertos se muestran discontinuos.
          </>
        ) : tool === 'exhibitor' ? (
          <>
            <strong>Expositor:</strong> haz clic dentro de la planta para crear un punto de interés.
            Luego completa su ficha en el panel derecho.
          </>
        ) : tool === 'rotationPoint' ? (
          <>
            <strong>Punto de rotación:</strong> haz clic dentro de la planta para colocar un pivote.
            La cámara pasará por el más cercano al viajar entre expositores. Puedes añadir varios.
          </>
        ) : tool === 'pan' ? (
          <>
            <strong>Mover vista:</strong> arrastra para desplazarte. Rueda del ratón para acercar o
            alejar. Espacio también permite pan temporal.
          </>
        ) : pendingCatalogItem ? (
          <>
            <strong>{pendingCatalogItem.name}:</strong> haz clic en la planta para colocarlo. Pulsa
            Esc para cancelar.
          </>
        ) : (
          <>
            <strong>Seleccionar:</strong> arrastra vértices, nodos de muros libres, muebles o
            expositores. Haz doble clic en un muro libre para insertar un nodo. Arrastra el fondo
            con la rueda pulsada (o con Espacio) para mover la vista.
          </>
        )}
      </div>

      {pendingCatalogItem ? (
        <div className="plan-pending">
          <span className="plan-pending-dot" />
          Colocando <strong>{pendingCatalogItem.name}</strong>
          <button type="button" onClick={() => useEditorStore.getState().setPendingCatalogItem(null)}>
            <X size={12} /> Cancelar
          </button>
        </div>
      ) : null}

      {vertices.length === 0 && tool !== 'draw' ? (
        <div className="plan-empty">
          <strong>Este espacio está vacío</strong>
          <p>Dibuja su contorno o crea un espacio nuevo desde el panel de planta.</p>
          <Button
            size="sm"
            variant="primary"
            onClick={() => {
              setPlanDrawMode('outline');
              setTool('draw');
            }}
            icon={<Plus size={13} />}
          >
            Dibujar contorno
          </Button>
        </div>
      ) : null}
    </div>
  );
}
