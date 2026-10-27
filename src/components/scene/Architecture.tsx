import { useEffect, useMemo } from 'react';
import * as THREE from 'three';
import type { Project, Vec2 } from '@/types/project';
import {
  getOpeningSpans,
  getWallPieces,
  wallDirection,
  wallLength,
  type WallTarget,
} from '@/utils/walls';
import {
  exhibitorColor,
  exhibitorPaintAmount,
  findExhibitor,
  mixHexColors,
} from '@/utils/exhibitorColors';

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

function WallPieceMesh({
  piece,
  wall,
  color,
  direction,
  angle,
  target,
  onWallClick,
}: {
  piece: { start: number; length: number; bottom: number; height: number };
  wall: { a: Vec2; height: number; thickness: number };
  color: string;
  direction: { x: number; z: number };
  angle: number;
  target: WallTarget;
  onWallClick?: (target: WallTarget, point: Vec2) => void;
}) {
  const sinksIntoFloor = piece.bottom <= 0.001;
  const renderHeight = piece.height + (sinksIntoFloor ? WALL_FLOOR_OVERLAP : 0);
  const centerY = sinksIntoFloor
    ? (piece.height - WALL_FLOOR_OVERLAP) / 2
    : piece.bottom + piece.height / 2;
  const centerOffset = piece.start + piece.length / 2;
  return (
    <mesh
      position={[
        wall.a.x + direction.x * centerOffset,
        centerY,
        wall.a.z + direction.z * centerOffset,
      ]}
      rotation={[0, angle, 0]}
      castShadow
      receiveShadow
      onClick={(event) => {
        if (!onWallClick) return;
        event.stopPropagation();
        onWallClick(target, { x: event.point.x, z: event.point.z });
      }}
    >
      <boxGeometry args={[piece.length, renderHeight, wall.thickness]} />
      <meshStandardMaterial color={color} roughness={0.82} metalness={0.02} />
    </mesh>
  );
}

export function Walls({
  project,
  selectedExhibitorId,
  onWallClick,
  onOpeningClick,
}: {
  project: Project;
  selectedExhibitorId?: string | null;
  onWallClick?: (target: WallTarget, point: Vec2) => void;
  onOpeningClick?: (openingId: string) => void;
}) {
  const walls = useMemo(() => {
    return project.edges.flatMap((edge, index) => {
      if (!edge.wall) return [];
      const a = project.floor.vertices[index];
      const b = project.floor.vertices[(index + 1) % project.floor.vertices.length];
      if (!a || !b || wallLength(a, b) < 0.001) return [];
      return [{
        id: edge.id,
        target: { type: 'edge', index } as WallTarget,
        a,
        b,
        height: edge.height,
        thickness: edge.thickness,
        color: edge.color,
        exhibitorId: edge.exhibitorId ?? null,
      }];
    }).concat(
      project.internalWalls
        .filter((wall) => wallLength(wall.a, wall.b) >= 0.001)
        .map((wall) => ({
          id: wall.id,
          target: { type: 'internalWall', id: wall.id } as WallTarget,
          a: wall.a,
          b: wall.b,
          height: wall.height,
          thickness: wall.thickness,
          color: wall.color,
          exhibitorId: wall.exhibitorId ?? null,
        })),
    );
  }, [project.edges, project.floor.vertices, project.internalWalls]);

  return (
    <group>
      {walls.map((wall) => {
        const length = wallLength(wall.a, wall.b);
        const direction = wallDirection(wall.a, wall.b);
        const angle = -Math.atan2(wall.b.z - wall.a.z, wall.b.x - wall.a.x);
        const openings = project.openings.filter((opening) => opening.wallId === wall.id);
        const pieces = getWallPieces(length, wall.height, openings);
        const spans = getOpeningSpans(length, wall.height, openings);
        const wallExhibitor = findExhibitor(project, wall.exhibitorId);
        const wallPaint = exhibitorPaintAmount(project, wall.exhibitorId, selectedExhibitorId);
        const wallColor = wallExhibitor && wallPaint > 0
          ? mixHexColors(wall.color, exhibitorColor(wallExhibitor), wallPaint)
          : wall.color;
        return (
          <group key={wall.id}>
            {pieces.map((piece, index) => (
              <WallPieceMesh
                key={`${wall.id}-piece-${index}`}
                piece={piece}
                wall={wall}
                color={wallColor}
                direction={direction}
                angle={angle}
                target={wall.target}
                onWallClick={onWallClick}
              />
            ))}
            {spans.map((span) => {
              const centerOffset = span.center;
              const position: [number, number, number] = [
                wall.a.x + direction.x * centerOffset,
                span.sill + (span.top - span.sill) / 2,
                wall.a.z + direction.z * centerOffset,
              ];
              const openingExhibitor = findExhibitor(project, span.opening.exhibitorId);
              const openingPaint = exhibitorPaintAmount(
                project,
                span.opening.exhibitorId,
                selectedExhibitorId,
              );
              const paintColor = openingExhibitor ? exhibitorColor(openingExhibitor) : undefined;
              const paintAmount = paintColor ? openingPaint : 0;
              const glassColor = paintColor
                ? mixHexColors('#bfe8ff', paintColor, paintAmount)
                : '#bfe8ff';
              const thresholdColor = paintColor
                ? mixHexColors('#8b7c65', paintColor, paintAmount)
                : '#8b7c65';
              const openingHeight = Math.max(0.02, span.top - span.sill);
              const overlay = paintColor && paintAmount > 0 ? (
                <mesh position={position} rotation={[0, angle, 0]} renderOrder={2}>
                  <boxGeometry args={[span.width * 0.96, openingHeight * 0.96, 0.014]} />
                  <meshStandardMaterial
                    color={paintColor}
                    roughness={0.38}
                    metalness={0.02}
                    transparent
                    opacity={Math.min(0.55, 0.12 + paintAmount * 0.38)}
                    depthWrite={false}
                  />
                </mesh>
              ) : null;
              const hitbox = onOpeningClick ? (
                <mesh
                  position={position}
                  rotation={[0, angle, 0]}
                  onClick={(event) => {
                    event.stopPropagation();
                    onOpeningClick(span.opening.id);
                  }}
                >
                  <boxGeometry
                    args={[span.width, openingHeight, Math.max(wall.thickness * 1.2, 0.16)]}
                  />
                  <meshBasicMaterial transparent opacity={0} depthWrite={false} />
                </mesh>
              ) : null;
              if (span.opening.kind === 'window') {
                return (
                  <group key={`${span.opening.id}-window`}>
                    {hitbox}
                    <mesh position={position} rotation={[0, angle, 0]}>
                      <boxGeometry args={[span.width, openingHeight, 0.018]} />
                      <meshStandardMaterial
                        color={glassColor}
                        roughness={0.12}
                        metalness={0.05}
                        transparent
                        opacity={0.24 + paintAmount * 0.18}
                        depthWrite={false}
                      />
                    </mesh>
                    {overlay}
                  </group>
                );
              }
              return (
                <group key={`${span.opening.id}-door`}>
                  {hitbox}
                  <mesh
                    position={[position[0], 0.012, position[2]]}
                    rotation={[0, angle, 0]}
                    receiveShadow
                  >
                    <boxGeometry
                      args={[span.width, 0.024, Math.max(wall.thickness * 1.08, 0.08)]}
                    />
                    <meshStandardMaterial color={thresholdColor} roughness={0.9} metalness={0} />
                  </mesh>
                  {overlay}
                </group>
              );
            })}
          </group>
        );
      })}
    </group>
  );
}

export function Architecture({
  project,
  selectedExhibitorId,
  onFloorClick,
  onWallClick,
  onOpeningClick,
}: {
  project: Project;
  selectedExhibitorId?: string | null;
  onFloorClick?: (point: Vec2) => void;
  onWallClick?: (target: WallTarget, point: Vec2) => void;
  onOpeningClick?: (openingId: string) => void;
}) {
  return (
    <group>
      <FloorMesh project={project} onFloorClick={onFloorClick} />
      <Walls
        project={project}
        selectedExhibitorId={selectedExhibitorId}
        onWallClick={onWallClick}
        onOpeningClick={onOpeningClick}
      />
    </group>
  );
}
