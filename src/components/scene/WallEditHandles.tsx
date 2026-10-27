import { useEffect, useRef, useState } from 'react';
import * as THREE from 'three';
import { useThree, type ThreeEvent } from '@react-three/fiber';
import type { InternalWall, Vec2, WallOpening } from '@/types/project';
import { useEditorStore } from '@/store/editorStore';
import { snapPoint, snapValue } from '@/utils/geometry';
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
const MIN_OPENING_WIDTH = 0.2;
const MIN_OPENING_HEIGHT = 0.2;

function usePlanarDrag({
  onStart,
  onMove,
  onEnd,
}: {
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
  const plane = useRef(new THREE.Plane(new THREE.Vector3(0, 1, 0), 0));
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

function useHistoryDrag(
  onStart: (event: PointerEvent) => void,
  onMove: (point: Vec2, event: PointerEvent) => void,
) {
  const beginHistory = useEditorStore((state) => state.beginHistory);
  const commitHistory = useEditorStore((state) => state.commitHistory);
  const cancelHistory = useEditorStore((state) => state.cancelHistory);
  const moved = useRef(false);
  return usePlanarDrag({
    onStart: (event) => {
      moved.current = false;
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
    },
  });
}

function Handle({
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

function WallEndpointHandle({
  wall,
  endpoint,
}: {
  wall: InternalWall;
  endpoint: 'a' | 'b';
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
  );
  const point = wall[endpoint];
  return (
    <Handle
      position={[point.x, 0.14, point.z]}
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
}: {
  opening: WallOpening;
  wall: WallDefinition;
  span: OpeningSpan;
  kind: 'center' | 'start' | 'end' | 'height' | 'sill';
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
  );

  const center = pointAtWallOffset(wall.a, wall.b, span.center);
  const start = pointAtWallOffset(wall.a, wall.b, span.start);
  const end = pointAtWallOffset(wall.a, wall.b, span.end);
  if (kind === 'start') {
    return (
      <Handle
        position={[start.x, midY, start.z]}
        color={WIDTH_HANDLE_COLOR}
        radius={0.075}
        onPointerDown={drag.start}
      />
    );
  }
  if (kind === 'end') {
    return (
      <Handle
        position={[end.x, midY, end.z]}
        color={WIDTH_HANDLE_COLOR}
        radius={0.075}
        onPointerDown={drag.start}
      />
    );
  }
  if (kind === 'height') {
    return (
      <Handle
        position={[center.x, span.top + 0.07, center.z]}
        color={HEIGHT_HANDLE_COLOR}
        radius={0.075}
        onPointerDown={drag.start}
      />
    );
  }
  if (kind === 'sill') {
    return (
      <Handle
        position={[center.x, span.sill - 0.07, center.z]}
        color={HEIGHT_HANDLE_COLOR}
        radius={0.075}
        onPointerDown={drag.start}
      />
    );
  }
  return (
    <Handle
      position={[center.x, midY, center.z]}
      radius={0.095}
      onPointerDown={drag.start}
    />
  );
}

export function WallEditHandles() {
  const project = useEditorStore((state) => state.project);
  const selection = useEditorStore((state) => state.selection);
  if (!project || !selection) return null;

  if (selection.type === 'internalWall') {
    const wall = project.internalWalls.find((entry) => entry.id === selection.id);
    if (!wall) return null;
    return (
      <group>
        <WallEndpointHandle wall={wall} endpoint="a" />
        <WallEndpointHandle wall={wall} endpoint="b" />
      </group>
    );
  }

  if (selection.type === 'opening') {
    const opening = project.openings.find((entry) => entry.id === selection.id);
    if (!opening) return null;
    const wall = getWallById(project, opening.wallId);
    if (!wall) return null;
    const length = wallLength(wall.a, wall.b);
    const span = getOpeningSpans(length, wall.height, [opening])[0];
    if (!span) return null;
    return (
      <group>
        <OpeningHandle opening={opening} wall={wall} span={span} kind="center" />
        <OpeningHandle opening={opening} wall={wall} span={span} kind="start" />
        <OpeningHandle opening={opening} wall={wall} span={span} kind="end" />
        <OpeningHandle opening={opening} wall={wall} span={span} kind="height" />
        {opening.kind === 'window' ? (
          <OpeningHandle opening={opening} wall={wall} span={span} kind="sill" />
        ) : null}
      </group>
    );
  }

  return null;
}
