import { useEffect } from 'react';
import * as THREE from 'three';
import { useThree } from '@react-three/fiber';
import { useEditorStore } from '@/store/editorStore';
import { pickSplat } from './splatPicker';

function hasMeasureAncestor(object: THREE.Object3D | null): boolean {
  let current: THREE.Object3D | null = object;
  while (current) {
    if (current.userData?.measureHelper) return true;
    current = current.parent;
  }
  return false;
}

/**
 * Herramienta de medida con picking sobre cualquier superficie (geometría y
 * splat). Un clic añade el punto A y el siguiente el B; arrastrar un extremo
 * existente lo reposiciona. Se apoya en `Raycaster` sobre la escena.
 */
export function MeasurementTool() {
  const { gl, camera, scene, controls } = useThree();

  useEffect(() => {
    const canvas = gl.domElement;
    const raycaster = new THREE.Raycaster();
    const pointer = new THREE.Vector2();
    const orbit = controls as unknown as { enabled: boolean } | null;
    let downAt: { x: number; y: number } | null = null;
    let moved = false;
    let drag: { id: string; end: 'a' | 'b' } | null = null;

    const setPointer = (event: PointerEvent) => {
      const rect = canvas.getBoundingClientRect();
      pointer.set(
        ((event.clientX - rect.left) / rect.width) * 2 - 1,
        -((event.clientY - rect.top) / rect.height) * 2 + 1,
      );
    };

    const pickPoint = (event: PointerEvent): THREE.Vector3 | null => {
      const rect = canvas.getBoundingClientRect();
      raycaster.setFromCamera(pointer, camera);

      let scenePoint: THREE.Vector3 | null = null;
      let sceneDistance = Infinity;
      for (const hit of raycaster.intersectObjects(scene.children, true)) {
        if (hasMeasureAncestor(hit.object)) continue;
        scenePoint = hit.point.clone();
        sceneDistance = hit.distance;
        break;
      }

      const splatHit = pickSplat(
        camera,
        event.clientX - rect.left,
        event.clientY - rect.top,
        rect.width,
        rect.height,
      );
      let splatPoint: THREE.Vector3 | null = null;
      let splatDistance = Infinity;
      if (splatHit) {
        splatPoint = new THREE.Vector3(splatHit[0], splatHit[1], splatHit[2]);
        splatDistance = camera.position.distanceTo(splatPoint);
      }

      if (scenePoint && splatPoint) return sceneDistance <= splatDistance ? scenePoint : splatPoint;
      return scenePoint ?? splatPoint;
    };

    const hitEndpoint = (event: PointerEvent): { id: string; end: 'a' | 'b' } | null => {
      const rect = canvas.getBoundingClientRect();
      const sx = event.clientX - rect.left;
      const sy = event.clientY - rect.top;
      const { measurements } = useEditorStore.getState();
      const projected = new THREE.Vector3();
      let best: { id: string; end: 'a' | 'b' } | null = null;
      let bestDistance = 16;
      for (const measurement of measurements) {
        for (const end of ['a', 'b'] as const) {
          const p = measurement[end];
          projected.set(p[0], p[1], p[2]).project(camera);
          const px = (projected.x * 0.5 + 0.5) * rect.width;
          const py = (-projected.y * 0.5 + 0.5) * rect.height;
          const distance = Math.hypot(px - sx, py - sy);
          if (distance < bestDistance) {
            bestDistance = distance;
            best = { id: measurement.id, end };
          }
        }
      }
      return best;
    };

    const onDown = (event: PointerEvent) => {
      if (!useEditorStore.getState().measureMode) return;
      downAt = { x: event.clientX, y: event.clientY };
      moved = false;
      const endpoint = hitEndpoint(event);
      if (endpoint) {
        drag = endpoint;
        if (orbit) orbit.enabled = false;
        event.preventDefault();
      }
    };

    const onMove = (event: PointerEvent) => {
      if (!downAt) return;
      if (Math.hypot(event.clientX - downAt.x, event.clientY - downAt.y) > 4) moved = true;
      if (drag) {
        setPointer(event);
        const point = pickPoint(event);
        if (point) {
          useEditorStore
            .getState()
            .updateMeasurementPoint(drag.id, drag.end, [point.x, point.y, point.z]);
        }
      }
    };

    const onUp = (event: PointerEvent) => {
      const state = useEditorStore.getState();
      if (drag) {
        drag = null;
        if (orbit) orbit.enabled = true;
        downAt = null;
        return;
      }
      if (state.measureMode && downAt && !moved) {
        setPointer(event);
        const point = pickPoint(event);
        if (point) state.addMeasurePoint([point.x, point.y, point.z]);
      }
      downAt = null;
    };

    canvas.addEventListener('pointerdown', onDown, { passive: false });
    window.addEventListener('pointermove', onMove);
    window.addEventListener('pointerup', onUp);
    return () => {
      canvas.removeEventListener('pointerdown', onDown);
      window.removeEventListener('pointermove', onMove);
      window.removeEventListener('pointerup', onUp);
      if (orbit) orbit.enabled = true;
    };
  }, [gl, camera, scene, controls]);

  return null;
}
