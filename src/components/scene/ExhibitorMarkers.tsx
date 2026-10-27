import { useState } from 'react';
import * as THREE from 'three';
import { Html, TransformControls } from '@react-three/drei';
import { useThree } from '@react-three/fiber';
import type { Exhibitor } from '@/types/project';
import { useEditorStore } from '@/store/editorStore';
import { snapValue } from '@/utils/geometry';
import { exhibitorColor } from '@/utils/exhibitorColors';

const MARKER_Y = 0.02;

function ExhibitorMarker({
  exhibitor,
  selected,
  editor,
  onSelect,
}: {
  exhibitor: Exhibitor;
  selected: boolean;
  editor: boolean;
  onSelect?: (id: string) => void;
}) {
  const [group, setGroup] = useState<THREE.Group | null>(null);
  const beginHistory = useEditorStore((state) => state.beginHistory);
  const commitHistory = useEditorStore((state) => state.commitHistory);
  const moveExhibitor = useEditorStore((state) => state.moveExhibitor);
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
    group.position.set(x, MARKER_Y, z);
    moveExhibitor(exhibitor.id, { x, z }, { history: false });
    commitHistory();
    if (controls) controls.enabled = true;
  };

  return (
    <>
      <group
        ref={setGroup}
        position={[exhibitor.position.x, MARKER_Y, exhibitor.position.z]}
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
        {editor ? (
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
            if (group && Math.abs(group.position.y - MARKER_Y) > 1e-4) {
              group.position.y = MARKER_Y;
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
  selectedId,
  editor = false,
  onSelect,
}: {
  exhibitors: Exhibitor[];
  selectedId?: string | null;
  editor?: boolean;
  onSelect?: (id: string) => void;
}) {
  return (
    <group>
      {exhibitors
        .filter((exhibitor) => exhibitor.visible)
        .map((exhibitor) => (
          <ExhibitorMarker
            key={exhibitor.id}
            exhibitor={exhibitor}
            selected={selectedId === exhibitor.id}
            editor={editor}
            onSelect={onSelect}
          />
        ))}
    </group>
  );
}
