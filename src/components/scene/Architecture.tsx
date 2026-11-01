import { useEffect, useMemo, useRef, useState } from 'react';
import * as THREE from 'three';
import { TransformControls } from '@react-three/drei';
import { useThree } from '@react-three/fiber';
import type { Level, Project, Space, Stair, Vec2 } from '@/types/project';
import { useEditorStore } from '@/store/editorStore';
import { snapValue } from '@/utils/geometry';
import { markSceneDragActive, markSceneDragEnd } from './sceneDragGuard';
import {
  getLevelWalls,
  getOpeningSpans,
  getWallPieces,
  wallDirection,
  wallLength,
  type WallTarget,
} from '@/utils/walls';
import { buildStairBoxes } from '@/utils/stairs';
import {
  exhibitorColor,
  exhibitorPaintAmount,
  findExhibitor,
  mixHexColors,
} from '@/utils/exhibitorColors';

/** Los muros se hunden unos centímetros en el piso para cerrar la junta. */
const WALL_FLOOR_OVERLAP = 0.02;

function floorGeometry(vertices: Vec2[], holes: Vec2[][] = []): THREE.BufferGeometry | null {
  if (vertices.length < 3) return null;
  const shape = new THREE.Shape(
    vertices.map((vertex) => new THREE.Vector2(vertex.x, -vertex.z)),
  );
  for (const hole of holes) {
    if (hole.length < 3) continue;
    shape.holes.push(
      new THREE.Path(hole.map((vertex) => new THREE.Vector2(vertex.x, -vertex.z))),
    );
  }
  const geometry = new THREE.ShapeGeometry(shape);
  geometry.rotateX(-Math.PI / 2);
  geometry.computeVertexNormals();
  return geometry;
}

export type FloorClickHandler = (
  point: Vec2,
  target: { levelId: string; spaceId: string },
) => void;

export function FloorMesh({
  space,
  levelId,
  onFloorClick,
}: {
  space: Space;
  levelId: string;
  onFloorClick?: FloorClickHandler;
}) {
  const geometry = useMemo(
    () => floorGeometry(space.vertices, space.holes.map((hole) => hole.vertices)),
    [space.vertices, space.holes],
  );

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
        onFloorClick(
          { x: event.point.x, z: event.point.z },
          { levelId, spaceId: space.id },
        );
      }}
    >
      <meshStandardMaterial
        color={space.color}
        roughness={space.roughness}
        metalness={space.metalness}
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

export function LevelWalls({
  project,
  level,
  selectedExhibitorId,
  onWallClick,
  onOpeningClick,
}: {
  project: Project;
  level: Level;
  selectedExhibitorId?: string | null;
  onWallClick?: (target: WallTarget, point: Vec2) => void;
  onOpeningClick?: (openingId: string) => void;
}) {
  const walls = useMemo(() => getLevelWalls(level), [level]);

  return (
    <group>
      {walls.map((wall) => {
        const length = wallLength(wall.a, wall.b);
        const direction = wallDirection(wall.a, wall.b);
        const angle = -Math.atan2(wall.b.z - wall.a.z, wall.b.x - wall.a.x);
        const openings = level.openings.filter((opening) => opening.wallId === wall.id);
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

/** Malla de una escalera (escalones, descansillos y barandillas). */
export function StairMesh({ stair }: { stair: Stair }) {
  const boxes = useMemo(() => buildStairBoxes(stair), [stair]);
  if (!stair.visible) return null;
  return (
    <group>
      {boxes.map((box, index) => (
        <mesh
          key={`${stair.id}-box-${index}`}
          position={box.position}
          rotation={box.rotation ?? [0, 0, 0]}
          castShadow
          receiveShadow
        >
          <boxGeometry args={box.size} />
          <meshStandardMaterial color={stair.color} roughness={0.72} metalness={0.04} />
        </mesh>
      ))}
    </group>
  );
}

/** Escalera editable en 3D: selección, arrastre en planta y giro. */
function EditableStair({
  stair,
  selected,
  onSelect,
}: {
  stair: Stair;
  selected: boolean;
  onSelect?: (id: string) => void;
}) {
  const [group, setGroup] = useState<THREE.Group | null>(null);
  const gizmoRef = useRef<any>(null);
  const transformMode = useEditorStore((state) => state.transformMode);
  const beginHistory = useEditorStore((state) => state.beginHistory);
  const commitHistory = useEditorStore((state) => state.commitHistory);
  const moveStair = useEditorStore((state) => state.moveStair);
  const updateStair = useEditorStore((state) => state.updateStair);
  const controls = useThree((state) => state.controls) as { enabled: boolean } | null;
  const boxes = useMemo(() => buildStairBoxes(stair), [stair]);

  const finishTransform = () => {
    if (!group) return;
    const project = useEditorStore.getState().project;
    const gridSize = project?.settings.gridSize ?? 0.25;
    const snap = project?.settings.snapToGrid ?? false;
    let x = group.position.x;
    let z = group.position.z;
    if (snap) {
      x = snapValue(x, gridSize);
      z = snapValue(z, gridSize);
    }
    const rotation = group.rotation.y;
    group.position.set(x, 0, z);
    moveStair(stair.id, { x, z }, { history: false, touch: false });
    updateStair(stair.id, { rotation }, { history: false, touch: false });
    commitHistory();
    if (controls) controls.enabled = true;
    markSceneDragEnd();
  };

  const finishRef = useRef(finishTransform);
  useEffect(() => {
    finishRef.current = finishTransform;
  });
  useEffect(() => {
    const gizmo = gizmoRef.current;
    if (!gizmo) return;
    const onDragging = (event: { value: boolean }) => {
      if (!event.value) finishRef.current();
    };
    gizmo.addEventListener('dragging-changed', onDragging);
    return () => gizmo.removeEventListener('dragging-changed', onDragging);
  }, [group, selected]);

  return (
    <>
      <group
        ref={setGroup}
        position={[stair.position.x, 0, stair.position.z]}
        rotation={[0, stair.rotation, 0]}
        onClick={(event) => {
          if (!onSelect) return;
          event.stopPropagation();
          onSelect(stair.id);
        }}
      >
        {boxes.map((box, index) => (
          <mesh
            key={`${stair.id}-box-${index}`}
            position={box.position}
            rotation={box.rotation ?? [0, 0, 0]}
            castShadow
            receiveShadow
          >
            <boxGeometry args={box.size} />
            <meshStandardMaterial
              color={selected ? '#d7ff4f' : stair.color}
              roughness={0.72}
              metalness={0.04}
            />
          </mesh>
        ))}
      </group>
      {selected && group ? (
        <TransformControls
          ref={gizmoRef}
          object={group}
          mode={transformMode}
          size={0.8}
          showY={false}
          onMouseDown={() => {
            markSceneDragActive();
            beginHistory();
            if (controls) controls.enabled = false;
          }}
          onMouseUp={finishTransform}
          onObjectChange={() => {
            if (!group) return;
            if (Math.abs(group.position.y) > 1e-4) group.position.y = 0;
          }}
        />
      ) : null}
    </>
  );
}

export function Architecture({
  project,
  selectedExhibitorId,
  selectedStairId,
  onSelectStair,
  onFloorClick,
  onWallClick,
  onOpeningClick,
}: {
  project: Project;
  selectedExhibitorId?: string | null;
  selectedStairId?: string | null;
  onSelectStair?: (id: string) => void;
  onFloorClick?: FloorClickHandler;
  onWallClick?: (target: WallTarget, point: Vec2) => void;
  onOpeningClick?: (openingId: string) => void;
}) {
  return (
    <group>
      {project.levels.map((level) => {
        if (!level.visible) return null;
        return (
          <group key={level.id} position={[0, level.elevation, 0]}>
            {level.spaces.map((space) =>
              space.visible ? (
                <FloorMesh
                  key={space.id}
                  space={space}
                  levelId={level.id}
                  onFloorClick={onFloorClick}
                />
              ) : null,
            )}
            <LevelWalls
              project={project}
              level={level}
              selectedExhibitorId={selectedExhibitorId}
              onWallClick={onWallClick}
              onOpeningClick={onOpeningClick}
            />
            {level.stairs.map((stair) =>
              onSelectStair ? (
                <EditableStair
                  key={stair.id}
                  stair={stair}
                  selected={selectedStairId === stair.id}
                  onSelect={onSelectStair}
                />
              ) : (
                <StairMesh key={stair.id} stair={stair} />
              ),
            )}
          </group>
        );
      })}
    </group>
  );
}
