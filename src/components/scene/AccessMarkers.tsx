import { useState } from 'react';
import * as THREE from 'three';
import { Html, TransformControls } from '@react-three/drei';
import { useThree } from '@react-three/fiber';
import type { AccessPoint, Project } from '@/types/project';
import { useEditorStore } from '@/store/editorStore';
import { snapValue } from '@/utils/geometry';
import {
  accessColor,
  accessKindLabel,
  accessShowsKindLabel,
  accessTitle,
} from '@/utils/accessPoints';
import { entityLevelId, levelElevationMap } from '@/utils/levels';
import { normalizeAngle } from '@/utils/levelTransform';
import {
  markSceneClickHandled,
  markScenePress,
  notifyGizmoPointerDown,
  shouldHandleElementClick,
} from './sceneDragGuard';

const MARKER_Y = 0.02;
const ARROW_SIZE = 0.19;
const ARROW_INSET = 0.28;

function AccessMarker({
  access,
  elevation = 0,
  selected,
  editor,
  showLabel = true,
  onSelect,
}: {
  access: AccessPoint;
  elevation?: number;
  selected: boolean;
  editor: boolean;
  showLabel?: boolean;
  onSelect?: (id: string) => void;
}) {
  const markerY = MARKER_Y + elevation;
  const [group, setGroup] = useState<THREE.Group | null>(null);
  const [headingRef, setHeadingRef] = useState<THREE.Object3D | null>(null);
  const beginHistory = useEditorStore((state) => state.beginHistory);
  const commitHistory = useEditorStore((state) => state.commitHistory);
  const moveAccess = useEditorStore((state) => state.moveAccess);
  const updateAccess = useEditorStore((state) => state.updateAccess);
  const transformMode = useEditorStore((state) => state.transformMode);
  const snap = useEditorStore((state) => state.project?.settings.snapToGrid ?? false);
  const gridSize = useEditorStore((state) => state.project?.settings.gridSize ?? 0.25);
  const controls = useThree((state) => state.controls) as { enabled: boolean } | null;
  const rotateMode = transformMode === 'rotate';
  // El aro de giro va algo elevado para que no quede enterrado en el forjado.
  const ROTATE_Y = 0.95;
  const color = accessColor(access);
  const title = accessTitle(access);
  const kindLabel = accessKindLabel(access.kind);
  const showKind = accessShowsKindLabel(access);

  const finishTransform = () => {
    if (!group) return;
    let x = group.position.x;
    let z = group.position.z;
    if (snap) {
      x = snapValue(x, gridSize);
      z = snapValue(z, gridSize);
    }
    group.position.set(x, markerY, z);
    moveAccess(access.id, { x, z }, { history: false });
    commitHistory();
    if (controls) controls.enabled = true;
  };

  const label = showLabel ? (
    <Html
      center
      position={[0, 2.85, 0]}
      zIndexRange={[100, 0]}
      style={{ pointerEvents: 'none' }}
    >
      <div
        className={`marker-label access-marker-label${selected ? ' is-selected' : ''}`}
        style={{ borderColor: color }}
      >
        <strong style={{ color }}>{title}</strong>
        {showKind ? <span>{kindLabel}</span> : null}
      </div>
    </Html>
  ) : null;

  return (
    <>
      <group
        ref={setGroup}
        position={[access.position.x, markerY, access.position.z]}
        onClick={(event) => {
          if (!onSelect) return;
          event.stopPropagation();
          if (!shouldHandleElementClick()) return;
          markSceneClickHandled();
          onSelect(access.id);
        }}
      >
        {/* Huella de la bandera en el suelo. */}
        <mesh
          rotation={[-Math.PI / 2, 0, 0]}
          position={[0, 0.045, 0]}
          onPointerOver={(event) => {
            event.stopPropagation();
            document.body.style.cursor = 'grab';
          }}
          onPointerOut={() => {
            document.body.style.cursor = 'auto';
          }}
        >
          <ringGeometry args={selected ? [0.32, 0.44, 40] : [0.2, 0.28, 40]} />
          <meshBasicMaterial
            color={color}
            transparent
            opacity={selected ? 0.95 : 0.5}
            depthWrite={false}
          />
        </mesh>

        {/* Mástil y bandera: el icono que distingue un acceso de un expositor. */}
        <mesh position={[0, 1.15, 0]}>
          <cylinderGeometry args={[0.022, 0.028, 2.3, 8]} />
          <meshBasicMaterial color={color} transparent opacity={selected ? 1 : 0.8} />
        </mesh>
        <mesh position={[0, 0.09, 0]}>
          <sphereGeometry args={[selected ? 0.09 : 0.065, 16, 12]} />
          <meshBasicMaterial color={color} />
        </mesh>
        <group rotation={[0, access.rotation, 0]}>
          <mesh position={[0.34, 2.12, 0]}>
            <planeGeometry args={[0.68, 0.36]} />
            <meshBasicMaterial
              color={color}
              transparent
              opacity={selected ? 1 : 0.85}
              side={THREE.DoubleSide}
              depthWrite={false}
            />
          </mesh>
          {/* «Entrada y salida»: dos banderas en sentidos opuestos. */}
          {access.kind === 'both' ? (
            <mesh position={[-0.34, 2.12, 0]} rotation={[0, Math.PI, 0]}>
              <planeGeometry args={[0.68, 0.36]} />
              <meshBasicMaterial
                color={color}
                transparent
                opacity={selected ? 1 : 0.85}
                side={THREE.DoubleSide}
                depthWrite={false}
              />
            </mesh>
          ) : null}
        </group>

        {/* Sentido del paso: la misma flecha de suelo que usa el expositor. */}
        <group position={[0, 0.05, 0]} rotation={[0, access.rotation, 0]}>
          <mesh
            rotation={[-Math.PI / 2, 0, -Math.PI / 2]}
            position={[0, 0, ARROW_INSET]}
            renderOrder={12}
          >
            <circleGeometry args={[ARROW_SIZE, 3]} />
            <meshBasicMaterial
              color={color}
              transparent
              opacity={selected ? 0.95 : 0.7}
              depthWrite={false}
              side={THREE.DoubleSide}
            />
          </mesh>
          {access.kind === 'both' ? (
            <mesh
              rotation={[-Math.PI / 2, 0, -Math.PI / 2]}
              position={[0, 0, -ARROW_INSET]}
              renderOrder={12}
            >
              <circleGeometry args={[ARROW_SIZE, 3]} />
              <meshBasicMaterial
                color={color}
                transparent
                opacity={selected ? 0.95 : 0.7}
                depthWrite={false}
                side={THREE.DoubleSide}
              />
            </mesh>
          ) : null}
        </group>

        {selected ? (
          <pointLight color={color} intensity={0.9} distance={3.2} position={[0, 1.5, 0]} />
        ) : null}
        {label}
      </group>

      {editor && selected ? (
        <group
          key={rotateMode ? 'rotate' : 'translate'}
          ref={setHeadingRef}
          position={[access.position.x, markerY + ROTATE_Y, access.position.z]}
          rotation={[0, access.rotation, 0]}
        />
      ) : null}

      {editor && selected && group ? (
        <TransformControls
          object={rotateMode && headingRef ? headingRef : group}
          mode={rotateMode ? 'rotate' : 'translate'}
          size={rotateMode ? 0.55 : 0.82}
          showX
          showY={rotateMode}
          showZ
          translationSnap={snap ? gridSize : null}
          rotationSnap={Math.PI / 12}
          onObjectChange={() => {
            if (rotateMode) {
              if (headingRef) {
                updateAccess(
                  access.id,
                  { rotation: normalizeAngle(headingRef.rotation.y) },
                  { history: false, touch: false },
                );
              }
              return;
            }
            if (group && Math.abs(group.position.y - markerY) > 1e-4) {
              group.position.y = markerY;
            }
            if (headingRef) {
              headingRef.position.set(group.position.x, markerY + ROTATE_Y, group.position.z);
            }
            moveAccess(
              access.id,
              { x: group.position.x, z: group.position.z },
              { history: false, touch: false },
            );
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

export function AccessMarkers({
  accesses,
  project,
  selectedId,
  editor = false,
  showLabels = true,
  onSelect,
}: {
  accesses: AccessPoint[];
  project?: Project;
  selectedId?: string | null;
  editor?: boolean;
  /** Etiqueta flotante con el nombre del acceso. */
  showLabels?: boolean;
  onSelect?: (id: string) => void;
}) {
  const elevations = project ? levelElevationMap(project) : {};
  return (
    <group>
      {accesses
        .filter((access) => access.visible)
        .map((access) => (
          <AccessMarker
            key={access.id}
            access={access}
            elevation={
              project ? elevations[entityLevelId(project, access) ?? ''] ?? 0 : 0
            }
            selected={selectedId === access.id}
            editor={editor}
            showLabel={showLabels}
            onSelect={onSelect}
          />
        ))}
    </group>
  );
}
