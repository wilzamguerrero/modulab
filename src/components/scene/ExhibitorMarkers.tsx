import { useState } from 'react';
import * as THREE from 'three';
import { Html, TransformControls } from '@react-three/drei';
import { useThree } from '@react-three/fiber';
import type { Exhibitor, Project } from '@/types/project';
import { notifyHandlePointerDown } from './sceneDragGuard';
import { useEditorStore } from '@/store/editorStore';
import { snapValue } from '@/utils/geometry';
import {
  blendTowardNeutral,
  isDimmedBySelection,
  shouldShowExhibitorName,
} from '@/utils/exhibitorColors';
import {
  markSceneClickHandled,
  markScenePress,
  notifyGizmoPointerDown,
  shouldHandleElementClick,
} from './sceneDragGuard';
import { exhibitorColor } from '@/utils/exhibitorColors';
import { entityLevelId, levelElevationMap } from '@/utils/levels';
import { normalizeAngle } from '@/utils/levelTransform';

const MARKER_Y = 0.02;
/**
 * Flecha de rumbo: base en el centro del marcador y punta un poco fuera del
 * anillo, para que se lea hacia dónde apunta sin confundirse con el círculo.
 */
const ARROW_SIZE = 0.2;
const ARROW_INSET = 0.3;

function ExhibitorMarker({
  exhibitor,
  elevation = 0,
  selected,
  editor,
  showLabels,
  showNameLabel = true,
  hidden = false,
  keepLabelWhenHidden = false,
  muted = 0,
  neutralColor = '#ffffff',
  onSelect,
}: {
  exhibitor: Exhibitor;
  elevation?: number;
  selected: boolean;
  editor: boolean;
  showLabels: boolean;
  /** Con «solo el elegido», el nombre del resto de expositores se oculta. */
  showNameLabel?: boolean;
  /** Modo «solo el elegido»: este expositor no es el elegido y no se dibuja. */
  hidden?: boolean;
  /**
   * «Nombres siempre visibles»: aunque el marcador se oculte, su nombre sigue
   * flotando en la escena.
   */
  keepLabelWhenHidden?: boolean;
  /**
   * Progreso (0–1) con el que el marcador del resto pierde su color: así el
   * cambio acompaña al fundido del entorno.
   */
  muted?: number;
  /** Color del fundido neutro. */
  neutralColor?: string;
  onSelect?: (id: string) => void;
}) {
  const markerY = MARKER_Y + elevation;
  const [group, setGroup] = useState<THREE.Group | null>(null);
  const beginHistory = useEditorStore((state) => state.beginHistory);
  const commitHistory = useEditorStore((state) => state.commitHistory);
  const moveExhibitor = useEditorStore((state) => state.moveExhibitor);
  const updateExhibitor = useEditorStore((state) => state.updateExhibitor);
  // Igual que los objetos: el manipulador alterna con la herramienta global
  // entre mover (G) y rotar (R). En «rotar», el expositor gira el rumbo de su
  // cámara; la posición no cambia.
  const transformMode = useEditorStore((state) => state.transformMode);
  const [headingRef, setHeadingRef] = useState<THREE.Object3D | null>(null);
  const snap = useEditorStore((state) => state.project?.settings.snapToGrid ?? false);
  const gridSize = useEditorStore((state) => state.project?.settings.gridSize ?? 0.25);
  const controls = useThree((state) => state.controls) as { enabled: boolean } | null;
  const headingRotate = transformMode === 'rotate';
  // El aro de giro va un poco elevado: a ras de suelo su mitad queda enterrada
  // en la losa y el verde no se ve.
  const ROTATE_Y = 0.9;
  // El expositor conserva siempre su color asignado; la selección se marca con
  // tamaño, opacidad y un halo, no cambiando el tono a amarillo. En modo
  // «solo el elegido» los demás pierden el color y quedan en blanco.
  const color = blendTowardNeutral(exhibitorColor(exhibitor), neutralColor, muted);

  const finishTransform = () => {
    if (!group) return;
    let x = group.position.x;
    let z = group.position.z;
    if (snap) {
      x = snapValue(x, gridSize);
      z = snapValue(z, gridSize);
    }
    group.position.set(x, markerY, z);
    moveExhibitor(exhibitor.id, { x, z }, { history: false });
    commitHistory();
    if (controls) controls.enabled = true;
  };

  const nameLabel =
    showLabels && showNameLabel ? (
      <Html
        center
        position={[0, 2.05, 0]}
        zIndexRange={[100, 0]}
        style={{ pointerEvents: 'none' }}
      >
        <div
          className={`marker-label${selected ? ' is-selected' : ''}`}
          style={{ borderColor: color }}
        >
          <strong style={{ color }}>{exhibitor.name || 'Expositor'}</strong>
          {exhibitor.standCode ? <span>{exhibitor.standCode}</span> : null}
        </div>
      </Html>
    ) : null;

  return (
    <>
      {hidden ? (
        // «Nombres siempre visibles»: el marcador desaparece pero su nombre
        // sigue flotando en la escena.
        keepLabelWhenHidden && nameLabel ? (
          <group position={[exhibitor.position.x, markerY, exhibitor.position.z]}>
            {nameLabel}
          </group>
        ) : null
      ) : (
      <group
        ref={setGroup}
        position={[exhibitor.position.x, markerY, exhibitor.position.z]}
        onClick={(event) => {
          if (!onSelect) return;
          event.stopPropagation();
          if (!shouldHandleElementClick()) return;
          markSceneClickHandled();
          onSelect(exhibitor.id);
        }}
      >
        <mesh
          rotation={[-Math.PI / 2, 0, 0]}
          position={[0, 0.045, 0]}
          onPointerOver={(event) => {
            event.stopPropagation();
            document.body.style.cursor = 'grab';
          }}
          onPointerOut={() => {
            document.body.style.cursor = 'auto';
          }}
          onPointerDown={() => {
            // El círculo del expositor es la propia manija de giro del rumbo.
            notifyHandlePointerDown(exhibitor.id);
          }}
        >
          <ringGeometry args={selected ? [0.34, 0.46, 40] : [0.22, 0.3, 40]} />
          <meshBasicMaterial
            color={color}
            transparent
            opacity={selected ? 0.95 : 0.55}
            depthWrite={false}
          />
        </mesh>
        <mesh position={[0, 0.72, 0]}>
          <cylinderGeometry args={[0.012, 0.012, 1.44, 6]} />
          <meshBasicMaterial color={color} transparent opacity={0.5} depthWrite={false} />
        </mesh>
        <mesh position={[0, 1.48, 0]}>
          <sphereGeometry args={[selected ? 0.11 : 0.075, 16, 12]} />
          <meshBasicMaterial color={color} />
        </mesh>
        {selected ? (
          <pointLight color={color} intensity={1} distance={3.4} position={[0, 1.5, 0]} />
        ) : null}
        {/* Hacia dónde mira la cámara: un triángulo centrado en el marcador
            que gira con el expositor, siempre dentro del círculo. */}
        <group
          position={[0, 0.05, 0]}
          rotation={[0, exhibitor.rotation, 0]}
          onPointerOver={(event) => {
            event.stopPropagation();
            document.body.style.cursor = 'grab';
          }}
          onPointerOut={() => {
            document.body.style.cursor = 'auto';
          }}
          onPointerDown={() => {
            notifyHandlePointerDown(exhibitor.id);
          }}
        >
          {/* Mismo tamaño con o sin selección: la flecha del rumbo es una
              referencia de dirección, no una manija. Así la planta 2D y el 3D
              dibujan exactamente el mismo triángulo. */}
          <mesh
            rotation={[-Math.PI / 2, 0, -Math.PI / 2]}
            position={[0, 0, ARROW_INSET]}
            renderOrder={12}
          >
            <circleGeometry args={[ARROW_SIZE, 3]} />
            <meshBasicMaterial
              color={color}
              transparent
              opacity={exhibitor.rotationCustom ? (selected ? 1 : 0.9) : selected ? 0.8 : 0.55}
              depthWrite={false}
              side={THREE.DoubleSide}
            />
          </mesh>
        </group>
        {nameLabel}
      </group>
      )}
      {editor && selected ? (
        <group
          key={headingRotate ? 'rotate' : 'translate'}
          ref={setHeadingRef}
          position={[exhibitor.position.x, markerY + ROTATE_Y, exhibitor.position.z]}
          rotation={[0, exhibitor.rotation, 0]}
        />
      ) : null}
      {editor && selected && group ? (
        <TransformControls
          object={headingRotate && headingRef ? headingRef : group}
          mode={headingRotate ? 'rotate' : 'translate'}
          size={headingRotate ? 0.55 : 0.82}
          // Trasladar: solo en planta (X/Z). Rotar: solo el eje vertical (Y),
          // que es el rumbo de la cámara.
          showX
          showY={headingRotate}
          showZ
          translationSnap={snap ? gridSize : null}
          rotationSnap={Math.PI / 12}
          onObjectChange={() => {
            if (headingRotate) {
              // Rotar: solo cambia hacia dónde mira la cámara del expositor;
              // la posición no se toca (el helper está elevado solo para
              // verse, no para mover el marcador).
              if (headingRef) {
                updateExhibitor(
                  exhibitor.id,
                  { rotation: normalizeAngle(headingRef.rotation.y), rotationCustom: true },
                  { history: false, touch: false },
                );
              }
              return;
            }
            if (group && Math.abs(group.position.y - markerY) > 1e-4) {
              group.position.y = markerY;
            }
            // El helper del rumbo vive elevado para que el aro se vea; al
            // mover el expositor ese helper sigue su posición de suelo.
            if (headingRef) {
              headingRef.position.set(group.position.x, markerY + ROTATE_Y, group.position.z);
            }
            // Con la opción de grupo activa, los elementos asociados siguen al
            // marcador en tiempo real durante el arrastre (no solo al soltar).
            if (group && exhibitor.moveRelated) {
              moveExhibitor(
                exhibitor.id,
                { x: group.position.x, z: group.position.z },
                { history: false, touch: false },
              );
            }
          }}
          onMouseDown={() => {
            notifyGizmoPointerDown();
            markScenePress();
            beginHistory();
            if (controls) controls.enabled = false;
          }}
          onMouseUp={finishTransform}
        />
      ) : null}
    </>
  );
}

export function ExhibitorMarkers({
  exhibitors,
  project,
  selectedId,
  editor = false,
  showLabels = editor,
  nameMode = 'all',
  spotlight = 'off',
  spotlightProgress = 0,
  neutralColor = '#ffffff',
  onSelect,
}: {
  exhibitors: Exhibitor[];
  project?: Project;
  selectedId?: string | null;
  editor?: boolean;
  /** Muestra el nombre del expositor flotando sobre el marcador. */
  showLabels?: boolean;
  /**
   * `selected`: con un expositor elegido solo se ve su nombre. `always`: los
   * nombres no se ocultan nunca, aunque el resto de marcadores desaparezca.
   */
  nameMode?: 'all' | 'selected' | 'always';
  /**
   * `neutral`: el marcador del resto pierde su color (la escena se blanquea
   * aparte). `tint`: solo los demás expositores toman el color elegido y el
   * edificio conserva sus materiales. `solo`: además, los demás expositores no
   * se dibujan.
   */
  spotlight?: 'off' | 'neutral' | 'tint' | 'solo';
  /** Progreso (0–1) del fundido: el color del resto lo sigue al suavizarse. */
  spotlightProgress?: number;
  neutralColor?: string;
  onSelect?: (id: string) => void;
}) {
  const elevations = project ? levelElevationMap(project) : {};
  return (
    <group>
      {exhibitors
        .filter((exhibitor) => exhibitor.visible)
        .map((exhibitor) => (
          <ExhibitorMarker
            key={exhibitor.id}
            exhibitor={exhibitor}
            elevation={
              project ? elevations[entityLevelId(project, exhibitor) ?? ''] ?? 0 : 0
            }
            selected={selectedId === exhibitor.id}
            editor={editor}
            showLabels={showLabels}
            showNameLabel={shouldShowExhibitorName(nameMode, exhibitor.id, selectedId)}
            hidden={spotlight === 'solo' && isDimmedBySelection(selectedId, exhibitor.id)}
            keepLabelWhenHidden={nameMode === 'always'}
            muted={
              // `tint` no toca el edificio: solo los demás marcadores toman el
              // color elegido, y lo hacen de golpe (no hay fundido que seguir).
              spotlight === 'tint'
                ? isDimmedBySelection(selectedId, exhibitor.id)
                  ? 1
                  : 0
                : spotlight !== 'off' && isDimmedBySelection(selectedId, exhibitor.id)
                  ? spotlightProgress
                  : 0
            }
            neutralColor={neutralColor}
            onSelect={onSelect}
          />
        ))}
    </group>
  );
}
