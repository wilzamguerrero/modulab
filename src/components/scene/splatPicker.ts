import type * as THREE from 'three';

interface SplatInstance {
  viewer?: { raycaster?: unknown };
  splatMesh?: unknown;
}

let current: { instance: SplatInstance; ready: boolean } | null = null;

export function setSplatInstance(instance: unknown, ready: boolean): void {
  current = instance ? { instance: instance as SplatInstance, ready } : null;
}

/** Devuelve el punto 3D del splat bajo una posición de pantalla (px). */
export function pickSplat(
  camera: THREE.Camera,
  screenX: number,
  screenY: number,
  width: number,
  height: number,
): [number, number, number] | null {
  if (!current?.ready) return null;
  const raycaster = current.instance.viewer?.raycaster as
    | {
        setFromCameraAndScreenPosition: (
          camera: THREE.Camera,
          position: { x: number; y: number },
          dimensions: { x: number; y: number },
        ) => void;
        intersectSplatMesh: (mesh: unknown, out: any[]) => void;
      }
    | undefined;
  const splatMesh = current.instance.splatMesh;
  if (!raycaster || !splatMesh) return null;

  try {
    raycaster.setFromCameraAndScreenPosition(camera, { x: screenX, y: screenY }, { x: width, y: height });
    const hits: any[] = [];
    raycaster.intersectSplatMesh(splatMesh, hits);
    if (hits.length > 0 && hits[0]?.origin) {
      const origin = hits[0].origin as THREE.Vector3;
      return [origin.x, origin.y, origin.z];
    }
  } catch {
    // Si el splat aún no tiene árbol/raycast, se ignora.
  }
  return null;
}
