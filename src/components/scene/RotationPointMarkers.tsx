import { useState } from 'react';
import * as THREE from 'three';
import { Html, TransformControls } from '@react-three/drei';
import { useThree } from '@react-three/fiber';
import type { Project, RotationPoint } from '@/types/project';
import { useEditorStore } from '@/store/editorStore';
import { snapValue } from '@/utils/geometry';
import { entityLevelId, levelElevationMap } from '@/utils/levels';
import {
  markSceneClickHandled,
  markScenePress,
  notifyGizmoPointerDown,
  shouldHandleElementClick,
} from './sceneDragGuard';

const MARKER_Y = 0.02;
const ROTATION_COLOR = '#b48cff';

function RotationMarker({
  point,
  elevation = 0,
  selected,
  editor,
  onSelect,
}: {
  point: RotationPoint;
  elevation?: number;
  selected: boolean;
  editor: boolean;
  onSelect?: (id: string) => void;
}) {
  const markerY = MARKER_Y + elevation;
  const [group, setGroup] = useState<THREE.Group | null>(null);
  const beginHistory = useEditorStore((state) => state.beginHistory);
  const commitHistory = useEditorStore((state) => state.commitHistory);
  const moveRotationPoint = useEditorStore((state) => state.moveRotationPoint);
  const snap = useEditorStore((state) => state.project?.settings.snapToGrid ?? false);
  const gridSize = useEditorStore((state) => state.project?.settings.gridSize ?? 0.25);
  const controls = useThree((state) => state.controls) as { enabled: boolean } | null;

  const finishTransform = () => {
    if (!group) return;
    let x = group.position.x;
    let z = group.position.z;
    if (snap) {
      x = snapValue(x, gridSize);
      z = snapValue(z, gridSize);
    }
    group.position.set(x, markerY, z);
    moveRotationPoint(point.id, { x, z }, { history: false });
    commitHistory();
    if (controls) controls.enabled = true;
  };

  return (
    <>
      <group
        ref={setGroup}
        position={[point.position.x, markerY, point.position.z]}
        onClick={(event) => {
          if (!onSelect) return;
          event.stopPropagation();
          if (!shouldHandleElementClick()) return;
          markSceneClickHandled();
          onSelect(point.id);
        }}
      >
        <mesh rotation={[-Math.PI / 2, 0, 0]} position={[0, 0.03, 0]}>
          <ringGeometry args={selected ? [0.3, 0.42, 6] : [0.2, 0.28, 6]} />
          <meshBasicMaterial
            color={ROTATION_COLOR}
            transparent
            opacity={selected ? 0.95 : 0.5}
            depthWrite={false}
          />
        </mesh>
        <mesh position={[0, 0.9, 0]} rotation={[0, 0, Math.PI / 4]}>
          <boxGeometry args={[0.16, 0.16, 0.16]} />
          <meshBasicMaterial color={ROTATION_COLOR} transparent opacity={0.85} depthWrite={false} />
        </mesh>
        {/* Poste y flecha de dirección: marca hacia dónde mira la parada, que
            es lo que verá el visitante al pasar por este punto al viajar. */}
        <mesh position={[0, 0.45, 0]}>
          <cylinderGeometry args={[0.01, 0.01, 0.9, 6]} />
          <meshBasicMaterial color={ROTATION_COLOR} transparent opacity={0.45} depthWrite={false} />
        </mesh>
        <group rotation={[0, -point.heading, 0]}>
          <mesh position={[0, 0.06, 0.34]} rotation={[Math.PI / 2, 0, 0]}>
            <coneGeometry args={[0.09, 0.24, 8]} />
            <meshBasicMaterial
              color={ROTATION_COLOR}
              transparent
              opacity={selected ? 0.95 : 0.6}
              depthWrite={false}
            />
          </mesh>
        </group>
        {/* Arco de giro: el segmento en planta que la cámara repasa. */}
        <mesh rotation={[-Math.PI / 2, 0, 0]} position={[0, 0.02, 0]}>
          <ringGeometry args={[0.42, 0.46, 32, 1, 0, Math.PI * 0.5]} />
          <meshBasicMaterial
            color={ROTATION_COLOR}
            transparent
            opacity={selected ? 0.8 : 0.25}
            depthWrite={false}
          />
        </mesh>
        {editor ? (
          <Html center position={[0, 1.25, 0]} zIndexRange={[100, 0]} style={{ pointerEvents: 'none' }}>
            <div
              className={`marker-label${selected ? ' is-selected' : ''}`}
              style={{ borderColor: ROTATION_COLOR }}
            >
              <strong style={{ color: ROTATION_COLOR }}>{point.name || 'Punto de rotación'}</strong>
            </div>
          </Html>
        ) : null}
      </group>
      {editor && selected && group ? (
        <TransformControls
          object={group}
          mode="translate"
          size={0.8}
          showX
          showY={false}
          showZ
          translationSnap={snap ? gridSize : null}
          onObjectChange={() => {
            if (group && Math.abs(group.position.y - markerY) > 1e-4) {
              group.position.y = markerY;
            }
          }}
          onMouseDown={() => {
            notifyGizmoPointerDown();
            markScenePress();
            beginHistory();
            if (controls) controls.enabled = false;
          }}
          onMouseUp={finishTransform}
        />
      ) : null}
    </>
  );
}

export function RotationPointMarkers({
  points,
  project,
  selectedId,
  editor = false,
  onSelect,
}: {
  points: RotationPoint[];
  project?: Project;
  selectedId?: string | null;
  editor?: boolean;
  onSelect?: (id: string) => void;
}) {
  const elevations = project ? levelElevationMap(project) : {};
  return (
    <group>
      {points.map((point) => (
        <RotationMarker
          key={point.id}
          point={point}
          elevation={project ? elevations[entityLevelId(project, point) ?? ''] ?? 0 : 0}
          selected={selectedId === point.id}
          editor={editor}
          onSelect={onSelect}
        />
      ))}
    </group>
  );
}
