import * as THREE from 'three';
import type { Vec2 } from '@/types/project';

/** Espesor mínimo razonable de una losa (2 cm). */
export const MIN_FLOOR_THICKNESS = 0.02;
export const MAX_FLOOR_THICKNESS = 2;

export function clampFloorThickness(thickness: number): number {
  if (!Number.isFinite(thickness)) return 0.2;
  return Math.min(MAX_FLOOR_THICKNESS, Math.max(MIN_FLOOR_THICKNESS, thickness));
}

/**
 * Construye el forjado de un espacio como un **sólido** de espesor `thickness`,
 * no como un plano: la cara superior queda en y = 0 (la elevación del nivel) y
 * el canto cuelga hacia abajo. Los huecos se perforan de lado a lado, así que se
 * ven como un agujero real con sus jambas en lugar de un recorte plano.
 *
 * La geometría resultante tiene dos grupos, listos para dos materiales:
 * - grupo 0: caras horizontales (piso arriba, envés abajo);
 * - grupo 1: caras verticales (canto de la losa y jambas de los huecos).
 */
export function floorSlabGeometry(
  vertices: Vec2[],
  holes: Vec2[][] = [],
  thickness = 0.2,
): THREE.BufferGeometry | null {
  if (vertices.length < 3) return null;
  const toPlane = (point: Vec2) => new THREE.Vector2(point.x, -point.z);
  const shape = new THREE.Shape(vertices.map(toPlane));
  for (const hole of holes) {
    if (hole.length < 3) continue;
    const outline = hole.map(toPlane);
    // ExtrudeGeometry normaliza el contorno exterior a sentido horario, así que
    // los huecos tienen que ir en sentido antihorario. Si un hueco llega con el
    // mismo giro que su contorno, sus jambas quedarían mirando hacia dentro del
    // material (el agujero se vería a través). Se corrige aquí.
    if (THREE.ShapeUtils.isClockWise(outline)) outline.reverse();
    shape.holes.push(new THREE.Path(outline));
  }
  const depth = clampFloorThickness(thickness);
  const geometry = new THREE.ExtrudeGeometry(shape, {
    depth,
    bevelEnabled: false,
    curveSegments: 1,
    steps: 1,
  });
  // El extruido avanza sobre +Z del plano del contorno; al tumbarlo en XZ crece
  // hacia arriba, así que se desplaza para que la cara superior caiga en y = 0.
  geometry.rotateX(-Math.PI / 2);
  geometry.translate(0, -depth, 0);
  geometry.computeBoundingBox();
  geometry.computeBoundingSphere();
  return geometry;
}