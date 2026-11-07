import { useState } from 'react';
import * as THREE from 'three';
import { Html, TransformControls } from '@react-three/drei';
import { useThree } from '@react-three/fiber';
import type { Exhibitor, Project } from '@/types/project';
import { useEditorStore } from '@/store/editorStore';
import { snapValue } from '@/utils/geometry';
import { exhibitorColor } from '@/utils/exhibitorColors';
import { entityLevelId, levelElevationMap } from '@/utils/levels';
import { normalizeAngle } from '@/utils/levelTransform';

const MARKER_Y = 0.02;

function ExhibitorMarker({
  exhibitor,
  elevation = 0,
  selected,
  editor,
  showLabels,
  onSelect,
}: {
  exhibitor: Exhibitor;
  elevation?: number;
  selected: boolean;
  editor: boolean;
  showLabels: boolean;
  onSelect?: (id: string) => void;
}) {
  const markerY = MARKER_Y + elevation;
  const [group, setGroup] = useState<THREE.Group | null>(null);
  const beginHistory = useEditorStore((state) => state.beginHistory);
  const commitHistory = useEditorStore((state) => state.commitHistory);
  const moveExhibitor = useEditorStore((state) => state.moveExhibitor);
  const updateExhibitor = useEditorStore((state) => state.updateExhibitor);
  // Giro de la cámara: el anillo del marcador actúa como manija del gizmo de
  // rotación (solo eje Y), que se enciende al pulsarlo.
  const [showHeadingHandle, setShowHeadingHandle] = useState(false);
  const [headingRef, setHeadingRef] = useState<THREE.Object3D | null>(null);
  const snap = useEditorStore((state) => state.project?.settings.snapToGrid ?? false);
  const gridSize = useEditorStore((state) => state.project?.settings.gridSize ?? 0.25);
  const controls = useThree((state) => state.controls) as { enabled: boolean } | null;
  // El expositor conserva siempre su color asignado; la selección se marca con
  // tamaño, opacidad y un halo, no cambiando el tono a amarillo.
  const color = exhibitorColor(exhibitor);

  const finishTransform = () => {
    if (!group) return;
    let x = group.position.x;
    let z = group.position.z;
    if (snap) {
      x = snapValue(x, gridSize);
      z = snapValue(z, gridSize);
    }
    group.position.set(x, markerY, z);
    moveExhibitor(exhibitor.id, { x, z }, { history: false });
    commitHistory();
    if (controls) controls.enabled = true;
  };

  return (
    <>
      <group
        ref={setGroup}
        position={[exhibitor.position.x, markerY, exhibitor.position.z]}
        onClick={(event) => {
          if (!onSelect) return;
          event.stopPropagation();
          onSelect(exhibitor.id);
        }}
      >
        <mesh rotation={[-Math.PI / 2, 0, 0]} position={[0, 0.03, 0]}>
          <ringGeometry args={selected ? [0.34, 0.46, 40] : [0.22, 0.3, 40]} />
          <meshBasicMaterial
            color={color}
            transparent
            opacity={selected ? 0.95 : 0.55}
            depthWrite={false}
          />
        </mesh>
        <mesh position={[0, 0.72, 0]}>
          <cylinderGeometry args={[0.012, 0.012, 1.44, 6]} />
          <meshBasicMaterial color={color} transparent opacity={0.5} depthWrite={false} />
        </mesh>
        <mesh position={[0, 1.48, 0]}>
          <sphereGeometry args={[selected ? 0.11 : 0.075, 16, 12]} />
          <meshBasicMaterial color={color} />
        </mesh>
        {selected ? (
          <pointLight color={color} intensity={1} distance={3.4} position={[0, 1.5, 0]} />
        ) : null}
        {showLabels ? (
          <Html
            center
            position={[0, 2.05, 0]}
            zIndexRange={[100, 0]}
            style={{ pointerEvents: 'none' }}
          >
            <div
              className={`marker-label${selected ? ' is-selected' : ''}`}
              style={{ borderColor: color }}
            >
              <strong style={{ color }}>{exhibitor.name || 'Expositor'}</strong>
              {exhibitor.standCode ? <span>{exhibitor.standCode}</span> : null}
            </div>
          </Html>
        ) : null}
      </group>
      {/* Dirección de la cámara de llegada: una flecha a ras de suelo que
          sale del expositor hacia donde estará la cámara. El anillo dibuja la
          zona de llegada, para ver el encuadre completo en planta. */}
      {editor ? (
        <group
          position={[exhibitor.position.x, markerY, exhibitor.position.z]}
          rotation={[0, exhibitor.rotation, 0]}
        >
          <mesh rotation={[-Math.PI / 2, 0, 0]} position={[0, 0.035, 0.85]}>
            <planeGeometry args={[selected ? 0.08 : 0.05, selected ? 1.3 : 0.95]} />
            <meshBasicMaterial
              color={color}
              transparent
              opacity={exhibitor.rotationCustom ? (selected ? 0.9 : 0.6) : selected ? 0.5 : 0.3}
              depthWrite={false}
            />
          </mesh>
          <mesh rotation={[-Math.PI / 2, 0, Math.PI]} position={[0, 0.04, 1.1]}>
            <coneGeometry args={[selected ? 0.16 : 0.11, selected ? 0.4 : 0.3, 4]} />
            <meshBasicMaterial color={color} transparent opacity={selected ? 0.95 : 0.7} depthWrite={false} />
          </mesh>
          {/* Zona de llegada: anillo fino al radio de la cámara (3,2 m). */}
          <mesh rotation={[-Math.PI / 2, 0, 0]} position={[0, 0.03, 0]}>
            <ringGeometry args={[3.16, 3.2, 64, 1, -0.6, 1.2]} />
            <meshBasicMaterial
              color={color}
              transparent
              opacity={selected ? 0.35 : 0.12}
              depthWrite={false}
            />
          </mesh>
          <mesh
            rotation={[-Math.PI / 2, 0, 0]}
            position={[0, 0.02, 0]}
            onPointerOver={(event) => {
              event.stopPropagation();
              document.body.style.cursor = 'grab';
            }}
            onPointerOut={() => {
              document.body.style.cursor = 'auto';
            }}
            onPointerDown={(event) => {
              event.stopPropagation();
              setShowHeadingHandle(true);
            }}
          >
            <ringGeometry args={[0.34, 0.5, 48]} />
            <meshBasicMaterial color={color} transparent opacity={selected ? 0.3 : 0.15} depthWrite={false} />
          </mesh>
        </group>
      ) : null}
      {editor && selected && showHeadingHandle ? (
        <group
          ref={setHeadingRef}
          position={[exhibitor.position.x, markerY, exhibitor.position.z]}
          rotation={[0, exhibitor.rotation, 0]}
        />
      ) : null}
      {editor && selected && showHeadingHandle ? (
        <TransformControls
          object={headingRef ?? undefined}
          mode="rotate"
          size={0.7}
          showX={false}
          showY
          showZ={false}
          rotationSnap={Math.PI / 12}
          onObjectChange={() => {
            if (!headingRef) return;
            updateExhibitor(
              exhibitor.id,
              { rotation: normalizeAngle(headingRef.rotation.y) },
              { history: false, touch: false },
            );
          }}
          onMouseDown={() => {
            beginHistory();
            if (controls) controls.enabled = false;
          }}
          onMouseUp={() => {
            commitHistory();
            if (controls) controls.enabled = true;
            setShowHeadingHandle(false);
          }}
        />
      ) : null}
      {editor && selected && group ? (
        <TransformControls
          object={group}
          mode="translate"
          size={0.82}
          showX
          showY={false}
          showZ
          translationSnap={snap ? gridSize : null}
          onObjectChange={() => {
            if (group && Math.abs(group.position.y - markerY) > 1e-4) {
              group.position.y = markerY;
            }
            // Con la opción de grupo activa, los elementos asociados siguen al
            // marcador en tiempo real durante el arrastre (no solo al soltar).
            if (group && exhibitor.moveRelated) {
              moveExhibitor(
                exhibitor.id,
                { x: group.position.x, z: group.position.z },
                { history: false, touch: false },
              );
            }
          }}
          onMouseDown={() => {
            beginHistory();
            if (controls) controls.enabled = false;
          }}
          onMouseUp={finishTransform}
        />
      ) : null}
    </>
  );
}

export function ExhibitorMarkers({
  exhibitors,
  project,
  selectedId,
  editor = false,
  showLabels = editor,
  onSelect,
}: {
  exhibitors: Exhibitor[];
  project?: Project;
  selectedId?: string | null;
  editor?: boolean;
  /** Muestra el nombre del expositor flotando sobre el marcador. */
  showLabels?: boolean;
  onSelect?: (id: string) => void;
}) {
  const elevations = project ? levelElevationMap(project) : {};
  return (
    <group>
      {exhibitors
        .filter((exhibitor) => exhibitor.visible)
        .map((exhibitor) => (
          <ExhibitorMarker
            key={exhibitor.id}
            exhibitor={exhibitor}
            elevation={
              project ? elevations[entityLevelId(project, exhibitor) ?? ''] ?? 0 : 0
            }
            selected={selectedId === exhibitor.id}
            editor={editor}
            showLabels={showLabels}
            onSelect={onSelect}
          />
        ))}
    </group>
  );
}
