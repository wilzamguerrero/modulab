import { useEffect, useRef, useState } from 'react';
import * as THREE from 'three';
import { useThree, type ThreeEvent } from '@react-three/fiber';
import type { InternalWall, Level, Vec2, WallOpening } from '@/types/project';
import { useEditorStore } from '@/store/editorStore';
import { snapPoint, snapValue } from '@/utils/geometry';
import { getLevel, getSpace } from '@/utils/levels';
import { markSceneDragActive, markSceneDragEnd } from './sceneDragGuard';
import {
  getOpeningSpans,
  getWallById,
  pointAtWallOffset,
  pointOffsetOnWall,
  wallLength,
  type OpeningSpan,
  type WallDefinition,
} from '@/utils/walls';

const HANDLE_COLOR = '#d7ff4f';
const WIDTH_HANDLE_COLOR = '#7dd3fc';
const HEIGHT_HANDLE_COLOR = '#ffcc66';
const VERTEX_HANDLE_COLOR = '#9be7ff';
const MIN_OPENING_WIDTH = 0.2;
const MIN_OPENING_HEIGHT = 0.2;

function usePlanarDrag({
  elevation = 0,
  onStart,
  onMove,
  onEnd,
}: {
  elevation?: number;
  onStart: (event: PointerEvent) => void;
  onMove: (point: Vec2, event: PointerEvent) => void;
  onEnd: () => void;
}) {
  const camera = useThree((state) => state.camera);
  const gl = useThree((state) => state.gl);
  const controls = useThree((state) => state.controls) as { enabled: boolean } | null;
  const [active, setActive] = useState(false);
  const callbacks = useRef({ onStart, onMove, onEnd });
  callbacks.current = { onStart, onMove, onEnd };
  const raycaster = useRef(new THREE.Raycaster());
  const plane = useRef(new THREE.Plane(new THREE.Vector3(0, 1, 0), -elevation));
  plane.current.constant = -elevation;
  const hit = useRef(new THREE.Vector3());

  const start = (event: ThreeEvent<PointerEvent>) => {
    event.stopPropagation();
    event.nativeEvent.stopImmediatePropagation?.();
    event.nativeEvent.preventDefault();
    callbacks.current.onStart(event.nativeEvent);
    if (controls) controls.enabled = false;
    document.body.style.cursor = 'grabbing';
    setActive(true);
  };

  useEffect(() => {
    if (!active) return;
    const onPointerMove = (event: PointerEvent) => {
      const rect = gl.domElement.getBoundingClientRect();
      if (rect.width <= 0 || rect.height <= 0) return;
      const ndc = new THREE.Vector2(
        ((event.clientX - rect.left) / rect.width) * 2 - 1,
        -((event.clientY - rect.top) / rect.height) * 2 + 1,
      );
      raycaster.current.setFromCamera(ndc, camera);
      if (!raycaster.current.ray.intersectPlane(plane.current, hit.current)) return;
      callbacks.current.onMove({ x: hit.current.x, z: hit.current.z }, event);
    };
    const finish = () => {
      callbacks.current.onEnd();
      if (controls) controls.enabled = true;
      document.body.style.cursor = '';
      setActive(false);
    };
    window.addEventListener('pointermove', onPointerMove);
    window.addEventListener('pointerup', finish, { once: true });
    window.addEventListener('pointercancel', finish, { once: true });
    return () => {
      window.removeEventListener('pointermove', onPointerMove);
      window.removeEventListener('pointerup', finish);
      window.removeEventListener('pointercancel', finish);
      if (controls) controls.enabled = true;
      document.body.style.cursor = '';
    };
  }, [active, camera, controls, gl]);

  return { start, active };
}

export function useHistoryDrag(
  onStart: (event: PointerEvent) => void,
  onMove: (point: Vec2, event: PointerEvent) => void,
  elevation = 0,
) {
  const beginHistory = useEditorStore((state) => state.beginHistory);
  const commitHistory = useEditorStore((state) => state.commitHistory);
  const cancelHistory = useEditorStore((state) => state.cancelHistory);
  const moved = useRef(false);
  return usePlanarDrag({
    elevation,
    onStart: (event) => {
      moved.current = false;
      markSceneDragActive();
      beginHistory();
      onStart(event);
    },
    onMove: (point, event) => {
      moved.current = true;
      onMove(point, event);
    },
    onEnd: () => {
      if (moved.current) commitHistory();
      else cancelHistory();
      markSceneDragEnd();
    },
  });
}

export function Handle({
  position,
  color = HANDLE_COLOR,
  radius = 0.09,
  debugLabel,
  onPointerDown,
}: {
  position: [number, number, number];
  color?: string;
  radius?: number;
  debugLabel?: string;
  onPointerDown: (event: ThreeEvent<PointerEvent>) => void;
}) {
  return (
    <mesh
      position={position}
      renderOrder={30}
      userData={debugLabel ? { modulabHandle: debugLabel } : undefined}
      onPointerDown={onPointerDown}
    >
      <sphereGeometry args={[radius, 18, 14]} />
      <meshBasicMaterial
        color={color}
        depthTest={false}
        depthWrite={false}
        transparent
        opacity={0.96}
      />
    </mesh>
  );
}

/** Arrastra un vértice del perímetro (los muros iniciales) sobre el suelo. */
function FloorVertexHandle({
  index,
  spaceId,
  elevation,
}: {
  index: number;
  spaceId?: string;
  elevation: number;
}) {
  const moveVertex = useEditorStore((state) => state.moveVertex);
  const project = useEditorStore((state) => state.project);
  const activeLevelId = useEditorStore((state) => state.activeLevelId);
  const activeSpaceId = useEditorStore((state) => state.activeSpaceId);
  const snap = project?.settings.snapToGrid ?? false;
  const gridSize = project?.settings.gridSize ?? 0.25;
  const level = project ? getLevel(project, activeLevelId) : undefined;
  const space = getSpace(level, spaceId ?? activeSpaceId);
  const vertex = space?.vertices[index];
  const drag = useHistoryDrag(
    () => undefined,
    (point) => {
      const next = snap ? snapPoint(point, gridSize) : point;
      moveVertex(index, next, { history: false, touch: false });
    },
    elevation,
  );
  if (!vertex) return null;
  return (
    <Handle
      position={[vertex.x, elevation + 0.14, vertex.z]}
      color={VERTEX_HANDLE_COLOR}
      radius={0.12}
      onPointerDown={drag.start}
    />
  );
}

function WallEndpointHandle({
  wall,
  endpoint,
  elevation,
}: {
  wall: InternalWall;
  endpoint: 'a' | 'b';
  elevation: number;
}) {
  const moveInternalWallPoint = useEditorStore((state) => state.moveInternalWallPoint);
  const snap = useEditorStore((state) => state.project?.settings.snapToGrid ?? false);
  const gridSize = useEditorStore((state) => state.project?.settings.gridSize ?? 0.25);
  const drag = useHistoryDrag(
    () => undefined,
    (point) => {
      const next = snap ? snapPoint(point, gridSize) : point;
      moveInternalWallPoint(wall.id, endpoint, next, { history: false, touch: false });
    },
    elevation,
  );
  const point = wall[endpoint];
  return (
    <Handle
      position={[point.x, elevation + 0.14, point.z]}
      onPointerDown={drag.start}
      radius={0.11}
    />
  );
}

function OpeningHandle({
  opening,
  wall,
  span,
  kind,
  elevation,
}: {
  opening: WallOpening;
  wall: WallDefinition;
  span: OpeningSpan;
  kind: 'center' | 'start' | 'end' | 'height' | 'sill';
  elevation: number;
}) {
  const updateOpening = useEditorStore((state) => state.updateOpening);
  const snap = useEditorStore((state) => state.project?.settings.snapToGrid ?? false);
  const gridSize = useEditorStore((state) => state.project?.settings.gridSize ?? 0.25);
  const length = wallLength(wall.a, wall.b);
  const startOffset = useRef(span.start);
  const endOffset = useRef(span.end);
  const startY = useRef(0);
  const startHeight = useRef(opening.height);
  const startSill = useRef(opening.sillHeight);
  const midY = span.sill + (span.top - span.sill) / 2;
  const drag = useHistoryDrag(
    (event) => {
      startOffset.current = span.start;
      endOffset.current = span.end;
      startY.current = event.clientY;
      startHeight.current = opening.height;
      startSill.current = opening.sillHeight;
    },
    (point, event) => {
      if (kind === 'height' || kind === 'sill') {
        const delta = (startY.current - event.clientY) * 0.01;
        if (kind === 'height') {
          const next = snap
            ? snapValue(startHeight.current + delta, 0.05)
            : startHeight.current + delta;
          updateOpening(
            opening.id,
            { height: Math.max(MIN_OPENING_HEIGHT, Math.min(wall.height - opening.sillHeight, next)) },
            { history: false, touch: false },
          );
        } else {
          const next = snap
            ? snapValue(startSill.current + delta, 0.05)
            : startSill.current + delta;
          updateOpening(
            opening.id,
            { sillHeight: Math.max(0, Math.min(wall.height - opening.height, next)) },
            { history: false, touch: false },
          );
        }
        return;
      }
      const projected = pointOffsetOnWall(point, wall.a, wall.b);
      if (kind === 'center') {
        const next = snap ? snapValue(projected, gridSize) : projected;
        updateOpening(
          opening.id,
          { offset: Math.max(span.width / 2, Math.min(length - span.width / 2, next)) },
          { history: false, touch: false },
        );
        return;
      }
      if (kind === 'start') {
        const next = snap ? snapValue(projected, gridSize) : projected;
        const start = Math.max(0, Math.min(endOffset.current - MIN_OPENING_WIDTH, next));
        const width = endOffset.current - start;
        updateOpening(
          opening.id,
          { offset: start + width / 2, width },
          { history: false, touch: false },
        );
        return;
      }
      const next = snap ? snapValue(projected, gridSize) : projected;
      const end = Math.max(startOffset.current + MIN_OPENING_WIDTH, Math.min(length, next));
      const width = end - startOffset.current;
      updateOpening(
        opening.id,
        { offset: startOffset.current + width / 2, width },
        { history: false, touch: false },
      );
    },
    elevation,
  );

  const center = pointAtWallOffset(wall.a, wall.b, span.center);
  const start = pointAtWallOffset(wall.a, wall.b, span.start);
  const end = pointAtWallOffset(wall.a, wall.b, span.end);
  const liftY = (value: number) => value + elevation;
  if (kind === 'start') {
    return (
      <Handle
        position={[start.x, liftY(midY), start.z]}
        color={WIDTH_HANDLE_COLOR}
        radius={0.075}
        onPointerDown={drag.start}
      />
    );
  }
  if (kind === 'end') {
    return (
      <Handle
        position={[end.x, liftY(midY), end.z]}
        color={WIDTH_HANDLE_COLOR}
        radius={0.075}
        onPointerDown={drag.start}
      />
    );
  }
  if (kind === 'height') {
    return (
      <Handle
        position={[center.x, liftY(span.top + 0.07), center.z]}
        color={HEIGHT_HANDLE_COLOR}
        radius={0.075}
        onPointerDown={drag.start}
      />
    );
  }
  if (kind === 'sill') {
    return (
      <Handle
        position={[center.x, liftY(span.sill - 0.07), center.z]}
        color={HEIGHT_HANDLE_COLOR}
        radius={0.075}
        onPointerDown={drag.start}
      />
    );
  }
  return (
    <Handle
      position={[center.x, liftY(midY), center.z]}
      radius={0.095}
      onPointerDown={drag.start}
    />
  );
}

/** Mueve el hueco completo desde su centro y arrastra cada esquina. */
function HoleHandles({
  hole,
  elevation,
}: {
  hole: { id: string; vertices: Vec2[] };
  elevation: number;
}) {
  const moveHole = useEditorStore((state) => state.moveHole);
  const setHoleVertex = useEditorStore((state) => state.setHoleVertex);
  const project = useEditorStore((state) => state.project);
  const snap = project?.settings.snapToGrid ?? false;
  const gridSize = project?.settings.gridSize ?? 0.25;

  let minX = Infinity;
  let maxX = -Infinity;
  let minZ = Infinity;
  let maxZ = -Infinity;
  for (const vertex of hole.vertices) {
    minX = Math.min(minX, vertex.x);
    maxX = Math.max(maxX, vertex.x);
    minZ = Math.min(minZ, vertex.z);
    maxZ = Math.max(maxZ, vertex.z);
  }
  const center = { x: (minX + maxX) / 2, z: (minZ + maxZ) / 2 };
  const lastCenter = { current: center };

  const centerDrag = useHistoryDrag(
    () => {
      lastCenter.current = center;
    },
    (point) => {
      const next = snap ? snapPoint(point, gridSize) : point;
      const delta = { x: next.x - lastCenter.current.x, z: next.z - lastCenter.current.z };
      lastCenter.current = next;
      moveHole(hole.id, delta, { history: false, touch: false });
    },
    elevation,
  );

  return (
    <group>
      <Handle
        position={[center.x, elevation + 0.16, center.z]}
        color="#ffb199"
        radius={0.14}
        debugLabel={`hole-center-${hole.id}`}
        onPointerDown={centerDrag.start}
      />
      {hole.vertices.map((vertex, index) => (
        <HoleVertexHandle
          key={`${hole.id}-vertex-${index}`}
          holeId={hole.id}
          index={index}
          vertex={vertex}
          elevation={elevation}
          snap={snap}
          gridSize={gridSize}
          onMove={setHoleVertex}
        />
      ))}
    </group>
  );
}

function HoleVertexHandle({
  holeId,
  index,
  vertex,
  elevation,
  snap,
  gridSize,
  onMove,
}: {
  holeId: string;
  index: number;
  vertex: Vec2;
  elevation: number;
  snap: boolean;
  gridSize: number;
  onMove: (id: string, index: number, point: Vec2, options?: { history?: boolean; touch?: boolean }) => void;
}) {
  const drag = useHistoryDrag(
    () => undefined,
    (point) => {
      const next = snap ? snapPoint(point, gridSize) : point;
      onMove(holeId, index, next, { history: false, touch: false });
    },
    elevation,
  );
  return (
    <Handle
      position={[vertex.x, elevation + 0.14, vertex.z]}
      color="#ff8a65"
      radius={0.11}
      debugLabel={`hole-vertex-${holeId}-${index}`}
      onPointerDown={drag.start}
    />
  );
}

export function WallEditHandles() {
  const project = useEditorStore((state) => state.project);
  const selection = useEditorStore((state) => state.selection);
  const activeLevelId = useEditorStore((state) => state.activeLevelId);
  const activeSpaceId = useEditorStore((state) => state.activeSpaceId);
  if (!project || !selection) return null;
  const level: Level | undefined = getLevel(project, activeLevelId);
  if (!level) return null;
  const elevation = level.elevation;

  if (selection.type === 'vertex') {
    return (
      <FloorVertexHandle
        index={selection.index}
        spaceId={selection.spaceId ?? activeSpaceId ?? undefined}
        elevation={elevation}
      />
    );
  }

  if (selection.type === 'edge') {
    const space = getSpace(level, selection.spaceId ?? activeSpaceId);
    const count = space?.vertices.length ?? 0;
    if (selection.index < 0 || selection.index >= count) return null;
    const next = (selection.index + 1) % count;
    return (
      <group>
        <FloorVertexHandle index={selection.index} spaceId={space?.id} elevation={elevation} />
        <FloorVertexHandle index={next} spaceId={space?.id} elevation={elevation} />
      </group>
    );
  }

  if (selection.type === 'internalWall') {
    const wall = level.internalWalls.find((entry) => entry.id === selection.id);
    if (!wall) return null;
    return (
      <group>
        <WallEndpointHandle wall={wall} endpoint="a" elevation={elevation} />
        <WallEndpointHandle wall={wall} endpoint="b" elevation={elevation} />
      </group>
    );
  }

  if (selection.type === 'hole') {
    const space = level.spaces.find((entry) => entry.holes.some((hole) => hole.id === selection.id));
    const hole = space?.holes.find((entry) => entry.id === selection.id);
    if (!hole || hole.vertices.length < 3) return null;
    return <HoleHandles hole={hole} elevation={elevation} />;
  }

  if (selection.type === 'opening') {
    const found = project.levels
      .map((entry) => ({ level: entry, opening: entry.openings.find((o) => o.id === selection.id) }))
      .find((entry) => entry.opening);
    if (!found?.opening) return null;
    const opening = found.opening;
    const wall = getWallById(found.level, opening.wallId);
    if (!wall) return null;
    const length = wallLength(wall.a, wall.b);
    const span = getOpeningSpans(length, wall.height, [opening])[0];
    if (!span) return null;
    const openingElevation = found.level.elevation;
    return (
      <group>
        <OpeningHandle opening={opening} wall={wall} span={span} kind="center" elevation={openingElevation} />
        <OpeningHandle opening={opening} wall={wall} span={span} kind="start" elevation={openingElevation} />
        <OpeningHandle opening={opening} wall={wall} span={span} kind="end" elevation={openingElevation} />
        <OpeningHandle opening={opening} wall={wall} span={span} kind="height" elevation={openingElevation} />
        {opening.kind === 'window' ? (
          <OpeningHandle opening={opening} wall={wall} span={span} kind="sill" elevation={openingElevation} />
        ) : null}
      </group>
    );
  }

  return null;
}
