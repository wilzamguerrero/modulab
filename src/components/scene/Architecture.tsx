import { useEffect, useLayoutEffect, useMemo, useRef, useState } from 'react';
import * as THREE from 'three';
import { TransformControls } from '@react-three/drei';
import { useThree } from '@react-three/fiber';
import type { Level, Project, Space, Stair, Vec2 } from '@/types/project';
import { useEditorStore } from '@/store/editorStore';
import { snapValue } from '@/utils/geometry';
import {
  elementPickUnder,
  selectionJustChanged,
  markSceneDragActive,
  markSceneDragEnd,
  notifyGizmoPointerDown,
} from './sceneDragGuard';
import {
  getLevelWalls,
  getOpeningSpans,
  getWallPieces,
  wallDirection,
  wallLength,
  type WallTarget,
} from '@/utils/walls';
import { buildStairBoxes } from '@/utils/stairs';
import { fitStairToLevels } from '@/utils/levels';
import { floorSlabGeometry } from '@/utils/floorGeometry';
import {
  exhibitorColor,
  NEUTRAL_HIGHLIGHT_COLOR,
  exhibitorPaintAmount,
  isDimmedBySelection,
  findExhibitor,
  mixHexColors,
} from '@/utils/exhibitorColors';

/** Los muros se hunden unos centímetros en el piso para cerrar la junta. */
const WALL_FLOOR_OVERLAP = 0.02;

/** Espesor de forjado que se usa si un espacio antiguo llega sin el campo. */
const FALLBACK_FLOOR_THICKNESS = 0.2;

/**
 * Oscurece un color hexadecimal. Se hace en espacio lineal (lo que hace
 * three.js al construir `Color` desde un string), así que el resultado se lee
 * como "el mismo material con menos luz" y no como un tinte lavado.
 */
function shadeHex(color: string, factor: number): string {
  return `#${new THREE.Color(color).multiplyScalar(factor).getHexString()}`;
}

export type FloorClickHandler = (
  point: Vec2,
  target: { levelId: string; spaceId: string },
) => void;

export function FloorMesh({
  space,
  levelId,
  neutral = false,
  onFloorClick,
}: {
  space: Space;
  levelId: string;
  /** Modo «solo el elegido»: el forjado se pinta blanco. */
  neutral?: boolean;
  onFloorClick?: FloorClickHandler;
}) {
  const thickness = space.thickness ?? FALLBACK_FLOOR_THICKNESS;
  const geometry = useMemo(
    () =>
      floorSlabGeometry(
        space.vertices,
        space.holes.map((hole) => hole.vertices),
        thickness,
      ),
    [space.vertices, space.holes, thickness],
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
        // Si el clic cae sobre una pieza (expositor, punto de rotación, objeto),
        // el piso no hace nada: el seleccionador del lienzo ya eligió la pieza.
        if (elementPickUnder(event) !== null) return;
        event.stopPropagation();
        // Si este mismo clic acaba de seleccionar algo, el piso no lo pisa.
        if (selectionJustChanged(150)) return;
        onFloorClick(
          { x: event.point.x, z: event.point.z },
          { levelId, spaceId: space.id },
        );
      }}
    >
      {/* Grupo 0: caras horizontales (piso arriba, envés abajo). */}
      <meshStandardMaterial
        attach="material-0"
        color={neutral ? NEUTRAL_HIGHLIGHT_COLOR : space.color}
        roughness={neutral ? 0.8 : space.roughness}
        metalness={neutral ? 0.02 : space.metalness}
      />
      {/* Grupo 1: canto de la losa y jambas de los huecos, un tono más oscuro. */}
      <meshStandardMaterial
        attach="material-1"
        color={neutral ? shadeHex(NEUTRAL_HIGHLIGHT_COLOR, 0.82) : shadeHex(space.color, 0.72)}
        roughness={neutral ? 0.82 : Math.min(1, space.roughness + 0.08)}
        metalness={neutral ? 0.02 : space.metalness}
      />
    </mesh>
  );
}

/**
 * Superficie invisible sobre cada corte del forjado.
 *
 * Desde que la losa se resta de verdad, dentro de un hueco no hay suelo que
 * golpear con el rayo: sin esto, hacer clic sobre un corte en 3D no seleccionaba
 * nada. El captador reutiliza `onFloorClick`, que ya sabe reconocer cuándo el
 * punto cae dentro de un hueco.
 */
function HolePicker({
  space,
  levelId,
  onFloorClick,
}: {
  space: Space;
  levelId: string;
  onFloorClick?: FloorClickHandler;
}) {
  const geometries = useMemo(
    () =>
      space.holes
        .filter((hole) => hole.vertices.length >= 3)
        .map((hole) => {
          const shape = new THREE.Shape(hole.vertices.map((point) => new THREE.Vector2(point.x, -point.z)));
          const geometry = new THREE.ShapeGeometry(shape);
          geometry.rotateX(-Math.PI / 2);
          return { id: hole.id, geometry };
        }),
    [space.holes],
  );

  useEffect(
    () => () => {
      for (const entry of geometries) entry.geometry.dispose();
    },
    [geometries],
  );

  if (!onFloorClick) return null;

  return (
    <>
      {geometries.map((entry) => (
        <mesh
          key={entry.id}
          geometry={entry.geometry}
          position={[0, 0.002, 0]}
          onClick={(event) => {
            event.stopPropagation();
            onFloorClick(
              { x: event.point.x, z: event.point.z },
              { levelId, spaceId: space.id },
            );
          }}
        >
          <meshBasicMaterial transparent opacity={0} depthWrite={false} />
        </mesh>
      ))}
    </>
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
  highlightOthers = false,
  onWallClick,
  onOpeningClick,
}: {
  project: Project;
  level: Level;
  selectedExhibitorId?: string | null;
  /** Modo «solo el elegido»: muros de otros expositores en blanco. */
  highlightOthers?: boolean;
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
        // Con un expositor elegido, los muros que no son suyos pasan a blanco.
        const wallDimmed = highlightOthers && isDimmedBySelection(selectedExhibitorId, wall.exhibitorId);
        const wallColor = wallDimmed
          ? NEUTRAL_HIGHLIGHT_COLOR
          : wallExhibitor && wallPaint > 0
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
              const openingDimmed =
                highlightOthers &&
                isDimmedBySelection(selectedExhibitorId, span.opening.exhibitorId);
              const paintAmount = paintColor && !openingDimmed ? openingPaint : 0;
              const glassColor = openingDimmed
                ? '#e9f2f8'
                : paintColor
                  ? mixHexColors('#bfe8ff', paintColor, paintAmount)
                  : '#bfe8ff';
              const thresholdColor = openingDimmed
                ? '#e6e6e6'
                : paintColor
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
export function StairMesh({ stair, neutral = false }: { stair: Stair; neutral?: boolean }) {
  const boxes = useMemo(() => buildStairBoxes(stair), [stair]);
  if (!stair.visible) return null;
  return (
    <group
      position={[stair.position.x, 0, stair.position.z]}
      rotation={[0, stair.rotation, 0]}
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
            color={neutral ? NEUTRAL_HIGHLIGHT_COLOR : stair.color}
            roughness={neutral ? 0.8 : 0.72}
            metalness={neutral ? 0.02 : 0.04}
          />
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
  // Mientras se arrastra con el gizmo, la malla manda sobre el estado. Al
  // soltar se devuelve el control al store (ver `dragging`).
  const dragging = useRef(false);

  // La malla de la escalera debe seguir siempre a `stair.position`/`rotation`
  // del store (undo/redo, edición en el inspector, etc.). Solo el propio grupo
  // de la escalera se sincroniza: el grupo del nivel lleva la elevación del
  // piso en su Y y no se toca aquí.
  useLayoutEffect(() => {
    if (!group || dragging.current) return;
    group.position.set(stair.position.x, 0, stair.position.z);
    group.rotation.set(0, stair.rotation, 0);
  }, [
    group,
    stair.position.x,
    stair.position.z,
    stair.rotation,
    stair.kind,
    stair.steps,
    stair.tread,
    stair.width,
    stair.rise,
  ]);

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
    group.rotation.set(0, rotation, 0);
    dragging.current = false;
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
            onClick={(event) => {
              if (!onSelect) return;
              event.stopPropagation();
              onSelect(stair.id);
            }}
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
            dragging.current = true;
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
  highlightOthers = false,
  onSelectStair,
  onFloorClick,
  onWallClick,
  onOpeningClick,
}: {
  project: Project;
  selectedExhibitorId?: string | null;
  /** Modo «solo el elegido»: pisos, muros y escaleras pasan a blanco. */
  highlightOthers?: boolean;
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
          // La Y de este grupo ES la elevación del piso: forjado, muros,
          // aberturas y escaleras cuelgan de aquí. Ningún hijo debe escribir en
          // `parent.position` (hundiría el nivel entero al suelo).
          <group key={level.id} position={[0, level.elevation, 0]}>
            {level.spaces.map((space) =>
              space.visible ? (
                <group key={space.id}>
                  <FloorMesh
                    space={space}
                    levelId={level.id}
                    neutral={highlightOthers}
                    onFloorClick={onFloorClick}
                  />
                  <HolePicker
                    space={space}
                    levelId={level.id}
                    onFloorClick={onFloorClick}
                  />
                </group>
              ) : null,
            )}
            <LevelWalls
              project={project}
              level={level}
              selectedExhibitorId={selectedExhibitorId}
              highlightOthers={highlightOthers}
              onWallClick={onWallClick}
              onOpeningClick={onOpeningClick}
            />
            {level.stairs.map((rawStair) => {
              const stair = fitStairToLevels(project, level, rawStair);
              return onSelectStair ? (
                <EditableStair
                  key={stair.id}
                  stair={stair}
                  selected={selectedStairId === stair.id}
                  onSelect={onSelectStair}
                />
              ) : (
                <StairMesh key={stair.id} stair={stair} neutral={highlightOthers} />
              );
            })}
          </group>
        );
      })}
    </group>
  );
}
