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
import type { SceneObject, Vec2 } from '@/types/project';
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
  validatePolygon,
} from '@/utils/geometry';
import { Button } from '@/components/ui';

interface Viewport {
  x: number;
  y: number;
  width: number;
  height: number;
}

type DragState =
  | { type: 'pan'; startClient: { x: number; y: number }; startViewport: Viewport }
  | { type: 'vertex'; index: number }
  | { type: 'object'; id: string; offset: Vec2 }
  | { type: 'exhibitor'; id: string; offset: Vec2 };

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

export function PlanEditor2D() {
  const project = useEditorStore((state) => state.project);
  const selection = useEditorStore((state) => state.selection);
  const tool = useEditorStore((state) => state.tool);
  const pendingCatalogItem = useEditorStore((state) => state.pendingCatalogItem);
  const setTool = useEditorStore((state) => state.setTool);
  const setSelection = useEditorStore((state) => state.setSelection);
  const addObject = useEditorStore((state) => state.addObject);
  const addExhibitor = useEditorStore((state) => state.addExhibitor);
  const moveVertex = useEditorStore((state) => state.moveVertex);
  const updateObjectTransform = useEditorStore((state) => state.updateObjectTransform);
  const moveExhibitor = useEditorStore((state) => state.moveExhibitor);
  const toggleWall = useEditorStore((state) => state.toggleWall);
  const beginHistory = useEditorStore((state) => state.beginHistory);
  const commitHistory = useEditorStore((state) => state.commitHistory);
  const replacePlan = useEditorStore((state) => state.replacePlan);
  const toast = useUiStore((state) => state.toast);

  const gridId = `plan-grid-${useId().replace(/:/g, '')}`;
  const majorId = `plan-major-${useId().replace(/:/g, '')}`;
  const svgRef = useRef<SVGSVGElement>(null);
  const dragRef = useRef<DragState | null>(null);
  const movedRef = useRef(false);
  const suppressClickRef = useRef(false);
  const lastProjectId = useRef(project?.id ?? '');

  const [viewport, setViewport] = useState<Viewport>(() =>
    fitViewport(project?.floor.vertices ?? []),
  );
  const [draft, setDraft] = useState<Vec2[]>([]);
  const [hover, setHover] = useState<Vec2 | null>(null);
  const [spaceDown, setSpaceDown] = useState(false);

  const vertices = project?.floor.vertices ?? [];
  const settings = project?.settings;
  const snap = settings?.snapToGrid ?? false;
  const gridSize = settings?.gridSize ?? 0.25;
  const showDimensions = settings?.showDimensions ?? true;
  const showGrid = settings?.showGrid ?? true;

  useEffect(() => {
    if (!project || lastProjectId.current === project.id) return;
    lastProjectId.current = project.id;
    setViewport(fitViewport(project.floor.vertices));
    setDraft([]);
  }, [project]);

  useEffect(() => {
    if (tool !== 'draw') {
      setDraft([]);
      setHover(null);
    }
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
    replacePlan(draft.map((point) => ({ ...point })));
    setViewport(fitViewport(draft));
    setDraft([]);
    setHover(null);
    setTool('select');
    toast('Planta actualizada. Los muros se generaron de nuevo.', 'success');
  }, [draft, replacePlan, setTool, toast]);

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
    if (drag && drag.type !== 'pan') commitHistory();
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
    svgRef.current?.setPointerCapture(event.pointerId);
  };

  const onPointerDown = (event: ReactPointerEvent<SVGSVGElement>) => {
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
      if (tool === 'draw') setHover(snapPointIfNeeded(point));
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
    }
  };

  const onPointerUp = () => finishDrag();
  const onPointerLeave = () => {
    if (!dragRef.current) setHover(null);
  };

  const onClick = (event: ReactMouseEvent<SVGSVGElement>) => {
    if (suppressClickRef.current) {
      suppressClickRef.current = false;
      return;
    }
    const point = snapPointIfNeeded(toWorld(event.clientX, event.clientY));
    const state = useEditorStore.getState();

    if (state.tool === 'draw') {
      const first = draft[0];
      const rect = svgRef.current?.getBoundingClientRect();
      const closeDistance = rect ? (viewport.width / Math.max(rect.width, 1)) * 14 : 0.25;
      if (first && draft.length >= 3 && distance(point, first) <= closeDistance) {
        closeDraft();
        return;
      }
      if (draft.some((entry) => distance(entry, point) < 0.02)) return;
      setDraft((current) => [...current, point]);
      setHover(point);
      return;
    }

    if (state.pendingCatalogItem) {
      if (vertices.length >= 3 && !pointInPolygon(point, vertices)) {
        toast('Coloca el objeto dentro de la planta.', 'warning');
        return;
      }
      const id = addObject(state.pendingCatalogItem, point);
      if (id) toast(`«${state.pendingCatalogItem.name}» colocado.`, 'success');
      return;
    }

    if (state.tool === 'exhibitor') {
      if (vertices.length >= 3 && !pointInPolygon(point, vertices)) {
        toast('Coloca el expositor dentro de la planta.', 'warning');
        return;
      }
      addExhibitor(point);
      return;
    }

    setSelection(null);
  };

  const onVertexPointerDown = (event: ReactPointerEvent, index: number) => {
    if (tool !== 'select') return;
    event.stopPropagation();
    event.preventDefault();
    beginDrag(event, { type: 'vertex', index });
    setSelection({ type: 'vertex', index });
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

  const handleEdgeClick = (event: ReactMouseEvent, index: number) => {
    event.stopPropagation();
    // En el segundo clic de un doble clic no se vuelve a alternar el muro;
    // el doble clic (solo en modo selección) se encarga de esa acción.
    if (tool === 'wall' && event.detail > 1) return;
    if (tool === 'wall') {
      toggleWall(index);
    }
    setSelection({ type: 'edge', index });
  };

  const area = vertices.length >= 3 ? polygonArea(vertices) : 0;
  const wallCount = project.edges.filter((edge) => edge.wall).length;
  const validation = validatePolygon(vertices);
  const textSize = Math.max(viewport.width / 115, 0.11);
  const hitWidth = Math.max(viewport.width / 90, 0.22);
  const vertexRadius = Math.max(viewport.width / 230, 0.055);
  const selectedVertex =
    selection?.type === 'vertex' ? selection.index : null;
  const selectedEdge = selection?.type === 'edge' ? selection.index : null;
  const dimExisting = tool === 'draw' && draft.length > 0;

  const objectFootprints = useMemo(
    () =>
      project.objects.map((object) => {
        const size = object.size ?? [0.8, 1, 0.8];
        return {
          object,
          width: Math.max(size[0] * Math.abs(object.transform.scale[0]), 0.18),
          depth: Math.max(size[2] * Math.abs(object.transform.scale[2]), 0.18),
        };
      }),
    [project.objects],
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

        {vertices.length >= 3 ? (
          <g opacity={dimExisting ? 0.35 : 1}>
            <polygon
              points={vertices.map((point) => `${point.x},${point.z}`).join(' ')}
              fill={project.floor.color}
              fillOpacity={0.22}
              stroke="rgba(255,255,255,.16)"
              strokeWidth={Math.max(viewport.width / 1000, 0.006)}
              strokeLinejoin="round"
            />
            {project.edges.map((edge, index) => {
              const a = vertices[index];
              const b = vertices[(index + 1) % vertices.length];
              if (!a || !b) return null;
              const isSelected = selectedEdge === index;
              const isOpen = !edge.wall;
              return (
                <g key={edge.id || index}>
                  <line
                    x1={a.x}
                    y1={a.z}
                    x2={b.x}
                    y2={b.z}
                    stroke={isSelected ? '#d7ff4f' : isOpen ? 'rgba(255,255,255,.35)' : edge.color}
                    strokeWidth={isOpen ? Math.max(viewport.width / 900, 0.012) : Math.max(edge.thickness, viewport.width / 800)}
                    strokeDasharray={isOpen ? `${viewport.width / 160} ${viewport.width / 220}` : undefined}
                    strokeLinecap="butt"
                    opacity={isOpen ? 0.8 : 0.92}
                    pointerEvents="none"
                  />
                  <line
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
                      if (tool === 'wall') return;
                      toggleWall(index);
                      setSelection({ type: 'edge', index });
                    }}
                  />
                  {showDimensions ? (
                    <text
                      x={(a.x + b.x) / 2 + (-(b.z - a.z) / Math.max(edgeLength(vertices, index), 0.001)) * textSize * 1.4}
                      y={(a.z + b.z) / 2 + ((b.x - a.x) / Math.max(edgeLength(vertices, index), 0.001)) * textSize * 1.4}
                      textAnchor="middle"
                      dominantBaseline="middle"
                      fill="rgba(255,255,255,.55)"
                      fontSize={textSize}
                      fontFamily="var(--mono)"
                      pointerEvents="none"
                    >
                      {formatMeters(edgeLength(vertices, index), 2)}
                    </text>
                  ) : null}
                </g>
              );
            })}
          </g>
        ) : null}

        {objectFootprints.map(({ object, width, depth }) => {
          const selected = selection?.type === 'object' && selection.id === object.id;
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
                fill={selected ? 'rgba(215,255,79,.2)' : 'rgba(255,255,255,.09)'}
                stroke={selected ? '#d7ff4f' : 'rgba(255,255,255,.4)'}
                strokeWidth={Math.max(viewport.width / 1000, 0.006)}
              />
              {width * (viewport.width / Math.max(svgRef.current?.clientWidth ?? 800, 1)) > 34 ? (
                <text
                  x={0}
                  y={0}
                  textAnchor="middle"
                  dominantBaseline="middle"
                  fill="rgba(255,255,255,.7)"
                  fontSize={textSize * 0.85}
                  pointerEvents="none"
                >
                  {object.name.length > 18 ? `${object.name.slice(0, 17)}…` : object.name}
                </text>
              ) : null}
            </g>
          );
        })}

        {project.exhibitors.map((exhibitor) => {
          const selected = selection?.type === 'exhibitor' && selection.id === exhibitor.id;
          const radius = Math.max(viewport.width / 120, 0.18);
          return (
            <g
              key={exhibitor.id}
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
                fill={exhibitor.notionMissing ? 'rgba(255,93,93,.25)' : selected ? 'rgba(215,255,79,.35)' : 'rgba(125,211,252,.2)'}
                stroke={exhibitor.notionMissing ? '#ff5d5d' : selected ? '#d7ff4f' : '#7dd3fc'}
                strokeWidth={Math.max(viewport.width / 900, 0.012)}
                strokeDasharray={exhibitor.notionMissing ? `${radius * 0.35} ${radius * 0.25}` : undefined}
              />
              <circle r={radius * 0.3} fill={selected ? '#d7ff4f' : '#7dd3fc'} />
              <text
                x={0}
                y={-radius * 1.55}
                textAnchor="middle"
                fill={selected ? '#d7ff4f' : 'rgba(220,240,250,.78)'}
                fontSize={textSize * 0.9}
                fontFamily="var(--font)"
                pointerEvents="none"
              >
                {exhibitor.name || 'Expositor'}
                {exhibitor.standCode ? ` · ${exhibitor.standCode}` : ''}
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
                  event.stopPropagation();
                  setSelection({ type: 'vertex', index });
                }}
              />
            </g>
          );
        })}

        {tool === 'draw' ? (
          <g>
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
      </svg>

      <div className="plan-hud">
        <span><strong>{formatArea(area)}</strong> área</span>
        <span><strong>{vertices.length}</strong> vértices</span>
        <span><strong>{wallCount}</strong> muros</span>
        {!validation.valid ? <span className="status-error">planta incompleta</span> : null}
      </div>

      <div className="plan-scale">
        <span>Ancho visible</span>
        <strong>{viewport.width.toFixed(1)} m</strong>
        <span>cuadrícula {gridSize} m</span>
      </div>

      <div className="plan-zoom">
        <button type="button" title="Acercar" onClick={() => zoomAt(0.82)}><Plus size={15} /></button>
        <button type="button" title="Alejar" onClick={() => zoomAt(1.22)}><Minus size={15} /></button>
        <button type="button" title="Ajustar a la planta" onClick={() => setViewport(fitViewport(vertices))}><Maximize size={15} /></button>
      </div>

      {tool === 'draw' && draft.length > 0 ? (
        <div className="plan-draw-actions">
          <span>{draft.length} vértice{draft.length === 1 ? '' : 's'} · Enter para cerrar</span>
          <Button size="sm" variant="ghost" onClick={() => { setDraft([]); setHover(null); }} icon={<X size={13} />}>
            Descartar
          </Button>
          <Button size="sm" variant="primary" onClick={closeDraft} icon={<Check size={13} />} disabled={draft.length < 3}>
            Cerrar contorno
          </Button>
        </div>
      ) : null}

      <div className="plan-help">
        {tool === 'draw' ? (
          <>
            <strong>Dibujar contorno:</strong> haz clic para añadir vértices. Cierra haciendo clic en el
            primer punto o pulsa Enter. Retroceso borra el último vértice.
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
            <strong>Seleccionar:</strong> arrastra vértices, muebles o expositores. Arrastra el fondo
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
          <strong>La planta está vacía</strong>
          <p>Usa «Dibujar contorno» o reemplaza la planta por una plantilla desde el panel de planta.</p>
          <Button size="sm" variant="primary" onClick={() => setTool('draw')} icon={<Plus size={13} />}>
            Dibujar contorno
          </Button>
        </div>
      ) : null}
    </div>
  );
}
