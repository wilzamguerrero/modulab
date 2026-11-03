import type { Exhibitor, Project, Vec2 } from '@/types/project';

/**
 * Desplaza en planta todos los elementos asignados a un expositor (los que se
 * resaltan con su color en el visor): objetos asociados, muros perimetrales
 * marcados con `exhibitorId` y muros libres. Las aberturas viajan con su muro.
 *
 * Se usa cuando el expositor tiene la opción «mover con sus elementos» activa:
 * arrastrar el marcador (en planta o en 3D) o escribir una posición nueva en el
 * inspector mueve también el montaje, como si estuvieran agrupados.
 *
 * Los vértices compartidos entre muros perimetrales se desplazan una sola vez
 * (se acumula el conjunto de índices), para no deformar el contorno al doble.
 */
export function translateAssignedElements(
  draft: Project,
  exhibitor: Pick<Exhibitor, 'id' | 'relatedObjectIds'>,
  delta: Vec2,
): void {
  const { x, z } = delta;
  if (x === 0 && z === 0) return;

  for (const object of draft.objects) {
    const assigned =
      object.exhibitorId === exhibitor.id ||
      exhibitor.relatedObjectIds.includes(object.id);
    if (!assigned) continue;
    object.transform = {
      ...object.transform,
      position: [
        object.transform.position[0] + x,
        object.transform.position[1],
        object.transform.position[2] + z,
      ],
    };
  }

  for (const level of draft.levels) {
    for (const space of level.spaces) {
      if (space.vertices.length < 3) continue;
      const vertexIndexes = new Set<number>();
      space.edges.forEach((edge, index) => {
        if (edge.exhibitorId !== exhibitor.id) return;
        vertexIndexes.add(index);
        vertexIndexes.add((index + 1) % space.vertices.length);
      });
      if (vertexIndexes.size) {
        for (const vertexIndex of vertexIndexes) {
          const vertex = space.vertices[vertexIndex];
          space.vertices[vertexIndex] = { x: vertex.x + x, z: vertex.z + z };
        }
      }
    }
    for (const wall of level.internalWalls) {
      if (wall.exhibitorId !== exhibitor.id) continue;
      wall.a = { x: wall.a.x + x, z: wall.a.z + z };
      wall.b = { x: wall.b.x + x, z: wall.b.z + z };
    }
  }
}
