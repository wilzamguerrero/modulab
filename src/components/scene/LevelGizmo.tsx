import { useEffect, useMemo, useRef, useState } from 'react';
import * as THREE from 'three';
import { TransformControls } from '@react-three/drei';
import { useThree } from '@react-three/fiber';
import type { Level, Project, Vec2 } from '@/types/project';
import { useEditorStore } from '@/store/editorStore';
import { snapValue } from '@/utils/geometry';
import { levelPivot } from '@/utils/levelTransform';
import { markSceneDragActive, markSceneDragEnd } from './sceneDragGuard';

interface DragStart {
  /** Pivote desde el que empezó el arrastre. */
  pivot: Vec2;
  /** Proyecto tal como estaba al empezar, base de todas las previsualizaciones. */
  base: Project;
}

/**
 * Gizmo para mover y girar un piso completo con todo su contenido.
 *
 * Se apoya en el `TransformControls` que ya usa el editor para objetos y
 * expositores, pero trabaja a partir de una instantánea tomada al empezar el
 * arrastre: en cada frame se recalcula el nivel desde esa base con el delta
 * actual (el piso se ve moverse en vivo) y al soltar se cierra el paso de
 * historial. Al no aplicar deltas sobre datos que ya cambiaron, no se acumula
 * desfase (el defecto que hacía que los cortes se desfasaran al moverlos).
 */
export function LevelGizmo({
  project,
  level,
  mode,
}: {
  project: Project;
  level: Level;
  mode: 'translate' | 'rotate';
}) {
  const pivot = useMemo(() => levelPivot(level), [level]);
  const [handle, setHandle] = useState<THREE.Group | null>(null);
  const handleY = level.elevation + 0.05;
  const startRef = useRef<DragStart | null>(null);
  const draggingRef = useRef(false);
  const committedRef = useRef(false);

  const previewLevelTransform = useEditorStore((state) => state.previewLevelTransform);
  const beginHistory = useEditorStore((state) => state.beginHistory);
  const commitHistory = useEditorStore((state) => state.commitHistory);
  const cancelHistory = useEditorStore((state) => state.cancelHistory);
  const snap = project.settings.snapToGrid;
  const gridSize = project.settings.gridSize;
  const controls = useThree((state) => state.controls) as { enabled: boolean } | null;

  // El marcador vuelve a su sitio cuando no se está arrastrando: es solo un
  // mango. Durante el arrastre manda el cursor, no el pivote recalculado.
  useEffect(() => {
    if (!handle || draggingRef.current) return;
    handle.position.set(pivot.x, handleY, pivot.z);
    handle.rotation.set(0, 0, 0);
    const current = useEditorStore.getState().project;
    if (current) {
      startRef.current = {
        pivot: { x: pivot.x, z: pivot.z },
        base: current,
      };
    }
    committedRef.current = false;
  }, [handle, pivot.x, pivot.z, handleY]);

  const resetHandle = () => {
    if (!handle) return;
    handle.position.set(pivot.x, handleY, pivot.z);
    handle.rotation.set(0, 0, 0);
  };

  const readTransform = () => {
    const start = startRef.current;
    if (!handle || !start) return null;
    let x = handle.position.x;
    let z = handle.position.z;
    if (snap && mode === 'translate') {
      x = snapValue(x, gridSize);
      z = snapValue(z, gridSize);
    }
    return {
      delta: { x: x - start.pivot.x, z: z - start.pivot.z },
      angle: handle.rotation.y,
      pivot: start.pivot,
    };
  };

  const commit = () => {
    draggingRef.current = false;
    const start = startRef.current;
    const transform = readTransform();
    const moved =
      transform !== null &&
      (Math.abs(transform.delta.x) > 1e-6 ||
        Math.abs(transform.delta.z) > 1e-6 ||
        Math.abs(transform.angle) > 1e-6);
    if (start && transform && moved && !committedRef.current) {
      committedRef.current = true;
      // Aplicar el valor final exacto (el último frame puede no coincidir con
      // el del soltado) y cerrar el paso de historial con la instantánea
      // tomada en `beginHistory`.
      previewLevelTransform(level.id, start.base, transform);
      commitHistory();
    } else if (!moved) {
      cancelHistory();
    }
    resetHandle();
    if (controls) controls.enabled = true;
    markSceneDragEnd();
  };

  return (
    <>
      <group ref={setHandle} position={[pivot.x, handleY, pivot.z]}>
        {/* Mango visible del gizmo: un disco translúcido sobre el centro del
            forjado, para saber qué piso se está moviendo. */}
        <mesh>
          <cylinderGeometry args={[0.16, 0.16, 0.02, 24]} />
          <meshBasicMaterial color="#d7ff4f" transparent opacity={0.35} depthWrite={false} />
        </mesh>
      </group>
      {handle ? (
        <TransformControls
          object={handle}
          mode={mode}
          size={0.9}
          showX={mode === 'translate'}
          showY={mode === 'rotate'}
          showZ={mode === 'translate'}
          space="world"
          translationSnap={snap ? gridSize : null}
          rotationSnap={snap ? Math.PI / 12 : null}
          onMouseDown={() => {
            markSceneDragActive();
            beginHistory();
            draggingRef.current = true;
            committedRef.current = false;
            if (controls) controls.enabled = false;
            const current = useEditorStore.getState().project;
            if (current) {
              startRef.current = {
                pivot: { x: pivot.x, z: pivot.z },
                base: structuredClone(current),
              };
            }
          }}
          onMouseUp={commit}
          onObjectChange={() => {
            if (!handle) return;
            // El piso no se inclina ni sube con el gizmo: la cota es del nivel.
            if (mode === 'translate' && Math.abs(handle.position.y - handleY) > 1e-4) {
              handle.position.y = handleY;
            }
            if (mode === 'rotate') {
              handle.rotation.x = 0;
              handle.rotation.z = 0;
            }
            const start = startRef.current;
            const transform = readTransform();
            if (!draggingRef.current || !start || !transform) return;
            if (
              Math.abs(transform.delta.x) < 1e-6 &&
              Math.abs(transform.delta.z) < 1e-6 &&
              Math.abs(transform.angle) < 1e-6
            ) {
              return;
            }
            // Previsualización en vivo: el piso sigue al cursor.
            previewLevelTransform(level.id, start.base, transform);
          }}
        />
      ) : null}
    </>
  );
}