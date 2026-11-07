import type { Exhibitor, Project, Vec2 } from '@/types/project';
import { exhibitorCameraFromHeading, isExhibitorCameraUsable } from '@/data/defaults';
import { pointInPolygon } from '@/utils/geometry';
import { entityLevelId, getLevel, levelVertices } from '@/utils/levels';

export type ExhibitorCamera = { position: [number, number, number]; target: [number, number, number] };

export const SCHEMA_DEFAULT_CAMERA_POSITION: [number, number, number] = [4, 2, 4];
export const SCHEMA_DEFAULT_CAMERA_TARGET: [number, number, number] = [0, 1, 0];

/** Cámara de llegada fijada por el rumbo (la flecha del expositor). */
export function headingCameraFor(exhibitor: Exhibitor, project: Project): ExhibitorCamera {
  const level = getLevel(project, entityLevelId(project, exhibitor));
  return exhibitorCameraFromHeading(
    exhibitor.position,
    exhibitor.rotation,
    levelVertices(level),
    level?.elevation ?? 0,
    3.2,
    sideOffsetsFor(exhibitor, project),
  );
}

/**
 * Distancia lateral de cada objeto asociado al expositor respecto a la línea
 * de su rumbo (positiva al lado «derecho» del rumbo). El encuadre de llegada
 * la usa para no dejar el montaje fuera de plano.
 */
export function sideOffsetsFor(exhibitor: Exhibitor, project: Project): number[] {
  const dir = { x: Math.sin(exhibitor.rotation), z: Math.cos(exhibitor.rotation) };
  const offsets: number[] = [];
  for (const object of project.objects) {
    const assigned =
      object.exhibitorId === exhibitor.id ||
      exhibitor.relatedObjectIds.includes(object.id);
    if (!assigned || object.visible === false) continue;
    if (object.levelId && object.levelId !== entityLevelId(project, exhibitor)) continue;
    const dx = object.transform.position[0] - exhibitor.position.x;
    const dz = object.transform.position[2] - exhibitor.position.z;
    // Proyección sobre la perpendicular al rumbo (positiva hacia el lado que
    // apunta `left` = perpendicular izquierda). El encuadre se centra luego
    // entre ambos extremos.
    offsets.push(dx * dir.z - dz * dir.x);
  }
  return offsets;
}

export function isSchemaDefaultCamera(
  position: [number, number, number],
  target: [number, number, number],
): boolean {
  return (
    position[0] === SCHEMA_DEFAULT_CAMERA_POSITION[0] &&
    position[1] === SCHEMA_DEFAULT_CAMERA_POSITION[1] &&
    position[2] === SCHEMA_DEFAULT_CAMERA_POSITION[2] &&
    target[0] === SCHEMA_DEFAULT_CAMERA_TARGET[0] &&
    target[1] === SCHEMA_DEFAULT_CAMERA_TARGET[1] &&
    target[2] === SCHEMA_DEFAULT_CAMERA_TARGET[2]
  );
}

export function sameVec(a: [number, number, number], b: [number, number, number]): boolean {
  return Math.abs(a[0] - b[0]) < 1e-3 && Math.abs(a[1] - b[1]) < 1e-3 && Math.abs(a[2] - b[2]) < 1e-3;
}

/** Varios expositores que comparten exactamente la misma cámara guardada. */
export function sharesCameraWithOther(exhibitor: Exhibitor, project: Project): boolean {
  return project.exhibitors.some(
    (entry) =>
      entry.id !== exhibitor.id &&
      entry.visible &&
      sameVec(entry.cameraPosition, exhibitor.cameraPosition) &&
      sameVec(entry.cameraTarget, exhibitor.cameraTarget),
  );
}

/**
 * Cámara de llegada de un expositor en el visor público.
 *
 * Si el expositor tiene rumbo propio, la cámara se coloca DETRÁS de él a lo
 * largo de su flecha y mira al stand. Sin rumbo se usa la cámara guardada en
 * la ficha, salvo que sea imposible (fuera del recinto, bajo el piso, pegada
 * al objetivo o compartida con otra ficha).
 */
export function focusCameraFor(
  exhibitor: Exhibitor,
  project: Project,
): ExhibitorCamera {
  if (exhibitor.rotationCustom || Math.abs(exhibitor.rotation) > 1e-3) {
    return headingCameraFor(exhibitor, project);
  }
  const level = getLevel(project, entityLevelId(project, exhibitor));
  const vertices = levelVertices(level);
  const elevation = level?.elevation ?? 0;
  const position = exhibitor.cameraPosition;
  const target = exhibitor.cameraTarget;
  const distance = Math.hypot(
    position[0] - target[0],
    position[1] - target[1],
    position[2] - target[2],
  );
  const targetInside =
    vertices.length < 3 || pointInPolygon({ x: target[0], z: target[2] }, vertices);
  if (
    finiteVector(position) &&
    finiteVector(target) &&
    !isSchemaDefaultCamera(position, target) &&
    !sharesCameraWithOther(exhibitor, project) &&
    position[1] >= elevation + 0.35 &&
    distance >= 0.8 &&
    targetInside &&
    isExhibitorCameraUsable(position, vertices)
  ) {
    return { position, target };
  }
  // Sin rumbo ni cámara válida: vista frontal (rumbo 0 = desde +Z).
  return exhibitorCameraFromHeading(
    exhibitor.position,
    0,
    vertices,
    elevation,
    3.2,
    sideOffsetsFor(exhibitor, project),
  );
}

function finiteVector(vector: [number, number, number]): boolean {
  return vector.every((value) => Number.isFinite(value));
}

export type { Vec2 };
