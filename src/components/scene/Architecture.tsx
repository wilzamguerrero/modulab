import { useEffect, useMemo } from 'react';
import * as THREE from 'three';
import type { Project, Vec2 } from '@/types/project';

/** Los muros se hunden unos centímetros en el piso para cerrar la junta. */
const WALL_FLOOR_OVERLAP = 0.02;

function floorGeometry(vertices: Vec2[]): THREE.BufferGeometry | null {
  if (vertices.length < 3) return null;
  const shape = new THREE.Shape(
    vertices.map((vertex) => new THREE.Vector2(vertex.x, -vertex.z)),
  );
  const geometry = new THREE.ShapeGeometry(shape);
  geometry.rotateX(-Math.PI / 2);
  geometry.computeVertexNormals();
  return geometry;
}

export function FloorMesh({
  project,
  onFloorClick,
}: {
  project: Project;
  onFloorClick?: (point: Vec2) => void;
}) {
  const geometry = useMemo(() => floorGeometry(project.floor.vertices), [project.floor.vertices]);

  useEffect(() => () => {
    geometry?.dispose();
  }, [geometry]);

  if (!geometry) return null;

  return (
    <mesh
      geometry={geometry}
      receiveShadow
      position={[0, 0, 0]}
      onClick={(event) => {
        if (!onFloorClick) return;
        event.stopPropagation();
        onFloorClick({ x: event.point.x, z: event.point.z });
      }}
    >
      <meshStandardMaterial
        color={project.floor.color}
        roughness={project.floor.roughness}
        metalness={project.floor.metalness}
        side={THREE.DoubleSide}
      />
    </mesh>
  );
}

export function Walls({
  project,
  onSelectEdge,
}: {
  project: Project;
  onSelectEdge?: (index: number) => void;
}) {
  const segments = useMemo(
    () =>
      project.floor.vertices.map((a, index) => {
        const b = project.floor.vertices[(index + 1) % project.floor.vertices.length];
        const dx = b.x - a.x;
        const dz = b.z - a.z;
        return {
          index,
          a,
          b,
          length: Math.hypot(dx, dz),
          angle: -Math.atan2(dz, dx),
          edge: project.edges[index],
        };
      }),
    [project.floor.vertices, project.edges],
  );

  return (
    <group>
      {segments.map((segment) => {
        const edge = segment.edge;
        if (!edge?.wall || segment.length < 0.001) return null;
        return (
          <mesh
            key={edge.id || segment.index}
            position={[
              (segment.a.x + segment.b.x) / 2,
              (edge.height - WALL_FLOOR_OVERLAP) / 2,
              (segment.a.z + segment.b.z) / 2,
            ]}
            rotation={[0, segment.angle, 0]}
            castShadow
            receiveShadow
            onClick={(event) => {
              if (!onSelectEdge) return;
              event.stopPropagation();
              onSelectEdge(segment.index);
            }}
          >
            <boxGeometry
              args={[segment.length, edge.height + WALL_FLOOR_OVERLAP, edge.thickness]}
            />
            <meshStandardMaterial color={edge.color} roughness={0.82} metalness={0.02} />
          </mesh>
        );
      })}
    </group>
  );
}

export function Architecture({
  project,
  onFloorClick,
  onSelectEdge,
}: {
  project: Project;
  onFloorClick?: (point: Vec2) => void;
  onSelectEdge?: (index: number) => void;
}) {
  return (
    <group>
      <FloorMesh project={project} onFloorClick={onFloorClick} />
      <Walls project={project} onSelectEdge={onSelectEdge} />
    </group>
  );
}
