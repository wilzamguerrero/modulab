import { useEffect } from 'react';
import * as THREE from 'three';
import { useThree } from '@react-three/fiber';
import { type MeasureAxis, useEditorStore } from '@/store/editorStore';
import { pickSplat } from './splatPicker';

function hasMeasureAncestor(object: THREE.Object3D | null): boolean {
  let current: THREE.Object3D | null = object;
  while (current) {
    if (current.userData?.measureHelper) return true;
    current = current.parent;
  }
  return false;
}

function isEditableTarget(target: EventTarget | null): boolean {
  const element = target as HTMLElement | null;
  return Boolean(
    element &&
      (element.tagName === 'INPUT' ||
        element.tagName === 'TEXTAREA' ||
        element.tagName === 'SELECT' ||
        element.isContentEditable),
  );
}

function constrainPoint(
  base: THREE.Vector3,
  anchor: [number, number, number] | null,
  axis: MeasureAxis,
): THREE.Vector3 {
  if (!anchor || axis === 'none') return base;
  if (axis === 'x') return new THREE.Vector3(base.x, anchor[1], anchor[2]);
  if (axis === 'y') return new THREE.Vector3(anchor[0], base.y, anchor[2]);
  return new THREE.Vector3(anchor[0], anchor[1], base.z);
}

/**
 * Herramienta de medida con picking sobre la superficie del splat/geometría o
 * con colocación libre (sin snap). El segundo punto puede bloquearse a un eje
 * (X ancho, Y alto, Z fondo) para trazar una línea recta precisa.
 *
 * Atajos mientras la herramienta está activa: X/Y/Z bloquean el eje, L lo
 * libera y mantener Shift coloca sin pegar a la superficie.
 */
export function MeasurementTool() {
  const { gl, camera, scene, controls } = useThree();

  useEffect(() => {
    const canvas = gl.domElement;
    const raycaster = new THREE.Raycaster();
    const pointer = new THREE.Vector2();
    const orbit = controls as unknown as {
      enabled: boolean;
      target?: THREE.Vector3;
    } | null;
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

    const intersectSurface = (event: PointerEvent): THREE.Vector3 | null => {
      const rect = canvas.getBoundingClientRect();

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

    /**
     * Punto bajo el cursor según el modo actual. Con `snap` se pega a la
     * superficie; sin él se proyecta sobre un plano orientado a la cámara que
     * pasa por el punto de anclaje. Con eje activo solo se toma esa coordenada.
     */
    const pickPoint = (
      event: PointerEvent,
      anchor: [number, number, number] | null,
      axis: MeasureAxis,
      snap: boolean,
    ): THREE.Vector3 | null => {
      setPointer(event);
      raycaster.setFromCamera(pointer, camera);

      const surface = intersectSurface(event);

      const direction = new THREE.Vector3();
      camera.getWorldDirection(direction);
      const reference = anchor
        ? new THREE.Vector3(anchor[0], anchor[1], anchor[2])
        : orbit?.target?.clone() ?? new THREE.Vector3(0, 0, 0);
      const plane = new THREE.Plane().setFromNormalAndCoplanarPoint(direction, reference);
      const free = new THREE.Vector3();
      const hasFree = raycaster.ray.intersectPlane(plane, free);

      const base = snap ? surface ?? (hasFree ? free : null) : (hasFree ? free : surface);
      if (!base) return null;
      return constrainPoint(base, anchor, axis);
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

    const otherEndpoint = (id: string, end: 'a' | 'b'): [number, number, number] | null => {
      const measurement = useEditorStore
        .getState()
        .measurements.find((entry) => entry.id === id);
      if (!measurement) return null;
      return end === 'a' ? measurement.b : measurement.a;
    };

    const onDown = (event: PointerEvent) => {
      const state = useEditorStore.getState();
      if (!state.measureMode || state.view !== '3d') return;
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
      const state = useEditorStore.getState();
      const snap = state.measureSnap && !event.shiftKey;

      if (!downAt) {
        // Guía en vivo desde el primer punto hasta el cursor.
        if (state.measureMode && state.view === '3d' && state.measurePending) {
          const point = pickPoint(event, state.measurePending, state.measureAxis, snap);
          state.setMeasureHover(point ? [point.x, point.y, point.z] : null);
        }
        return;
      }
      if (Math.hypot(event.clientX - downAt.x, event.clientY - downAt.y) > 4) moved = true;
      if (drag) {
        const point = pickPoint(event, otherEndpoint(drag.id, drag.end), state.measureAxis, snap);
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
        const snap = state.measureSnap && !event.shiftKey;
        const point = pickPoint(event, state.measurePending, state.measureAxis, snap);
        if (point) state.addMeasurePoint([point.x, point.y, point.z]);
      }
      downAt = null;
    };

    const onKeyDown = (event: KeyboardEvent) => {
      if (event.ctrlKey || event.metaKey || event.altKey) return;
      if (isEditableTarget(event.target)) return;
      const state = useEditorStore.getState();
      if (!state.measureMode || state.view !== '3d') return;
      const key = event.key.toLowerCase();
      if (key === 'x') state.setMeasureAxis('x');
      else if (key === 'y') state.setMeasureAxis('y');
      else if (key === 'z') state.setMeasureAxis('z');
      else if (key === 'l') state.setMeasureAxis('none');
    };

    const onLeave = () => {
      if (!drag) useEditorStore.getState().setMeasureHover(null);
    };

    canvas.addEventListener('pointerdown', onDown, { passive: false });
    canvas.addEventListener('pointerleave', onLeave);
    window.addEventListener('pointermove', onMove);
    window.addEventListener('pointerup', onUp);
    window.addEventListener('keydown', onKeyDown);
    return () => {
      canvas.removeEventListener('pointerdown', onDown);
      canvas.removeEventListener('pointerleave', onLeave);
      window.removeEventListener('pointermove', onMove);
      window.removeEventListener('pointerup', onUp);
      window.removeEventListener('keydown', onKeyDown);
      if (orbit) orbit.enabled = true;
    };
  }, [gl, camera, scene, controls]);

  return null;
}
