import { useEffect, useMemo, useRef } from 'react';
import * as THREE from 'three';
import { TransformControls } from '@react-three/drei';
import { useThree } from '@react-three/fiber';
import { useEditorStore } from '@/store/editorStore';

type Vec = [number, number, number];

/**
 * Gizmo (flechas X/Y/Z) para desplazar la medida activa completa. Se apoya en
 * `TransformControls` para que el usuario vea el eje en el que está moviendo,
 * igual que el resto de gizmos del editor.
 */
export function MeasurementGizmo() {
  const activeId = useEditorStore((state) => state.activeMeasurementId);
  const measurement = useEditorStore((state) =>
    state.measurements.find((entry) => entry.id === state.activeMeasurementId) ?? null,
  );
  const moveMeasurement = useEditorStore((state) => state.moveMeasurement);
  const beginHistory = useEditorStore((state) => state.beginHistory);
  const commitHistory = useEditorStore((state) => state.commitHistory);
  const cancelHistory = useEditorStore((state) => state.cancelHistory);
  const snap = useEditorStore((state) => state.project?.settings.snapToGrid ?? false);
  const gridSize = useEditorStore((state) => state.project?.settings.gridSize ?? 0.25);
  const controls = useThree((state) => state.controls) as { enabled: boolean } | null;

  const pivot = useMemo(() => new THREE.Object3D(), []);
  const gizmoRef = useRef<any>(null);
  const dragRef = useRef<{ a: Vec; b: Vec; mid: THREE.Vector3; moved: boolean } | null>(null);

  const aKey = measurement?.a.join(',') ?? '';
  const bKey = measurement?.b.join(',') ?? '';

  // Mantén el pivote en el punto medio cuando no se arrastra.
  useEffect(() => {
    if (!measurement || dragRef.current) return;
    pivot.position.set(
      (measurement.a[0] + measurement.b[0]) / 2,
      (measurement.a[1] + measurement.b[1]) / 2,
      (measurement.a[2] + measurement.b[2]) / 2,
    );
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [aKey, bKey, pivot]);

  useEffect(() => {
    const gizmo = gizmoRef.current;
    if (!gizmo) return;
    const onDragging = (event: { value: boolean }) => {
      if (event.value) {
        if (!measurement) return;
        const mid = new THREE.Vector3(
          (measurement.a[0] + measurement.b[0]) / 2,
          (measurement.a[1] + measurement.b[1]) / 2,
          (measurement.a[2] + measurement.b[2]) / 2,
        );
        dragRef.current = {
          a: [measurement.a[0], measurement.a[1], measurement.a[2]],
          b: [measurement.b[0], measurement.b[1], measurement.b[2]],
          mid: mid.clone(),
          moved: false,
        };
        beginHistory();
        if (controls) controls.enabled = false;
      } else {
        const drag = dragRef.current;
        dragRef.current = null;
        if (controls) controls.enabled = true;
        if (drag?.moved) commitHistory();
        else cancelHistory();
        // Reajusta el pivote al nuevo punto medio.
        if (measurement) {
          pivot.position.set(
            (measurement.a[0] + measurement.b[0]) / 2,
            (measurement.a[1] + measurement.b[1]) / 2,
            (measurement.a[2] + measurement.b[2]) / 2,
          );
        }
      }
    };
    gizmo.addEventListener('dragging-changed', onDragging);
    return () => gizmo.removeEventListener('dragging-changed', onDragging);
  }, [measurement, beginHistory, commitHistory, cancelHistory, controls, pivot]);

  if (!activeId || !measurement) return null;

  return (
    <>
      <primitive object={pivot} />
      <TransformControls
        ref={gizmoRef}
        object={pivot}
        mode="translate"
        size={0.7}
        translationSnap={snap ? gridSize : null}
        onObjectChange={() => {
          const drag = dragRef.current;
          if (!drag) return;
          const dx = pivot.position.x - drag.mid.x;
          const dy = pivot.position.y - drag.mid.y;
          const dz = pivot.position.z - drag.mid.z;
          if (Math.abs(dx) + Math.abs(dy) + Math.abs(dz) < 1e-6) return;
          drag.moved = true;
          moveMeasurement(
            activeId,
            [drag.a[0] + dx, drag.a[1] + dy, drag.a[2] + dz],
            [drag.b[0] + dx, drag.b[1] + dy, drag.b[2] + dz],
          );
        }}
      />
    </>
  );
}
