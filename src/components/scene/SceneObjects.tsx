import { useEffect, useMemo, useRef, useState, type CSSProperties } from 'react';
import * as THREE from 'three';
import { useThree } from '@react-three/fiber';
import { Html, TransformControls } from '@react-three/drei';
import type { MaterialOverride, MediaItem, PrimitiveShape, Project, SceneObject } from '@/types/project';
import { mediaItemUrl } from '@/services/assets/mediaService';
import {
  applyOverridesToMaterials,
  applyTintToMaterials,
  applyWhiteoutToMaterials,
  cloneModelScene,
  loadGltf,
  modelInfoFromScene,
} from '@/services/assets/modelLoader';
import { useEditorStore } from '@/store/editorStore';
import { useModelInfoStore } from '@/store/modelInfoStore';
import { snapValue } from '@/utils/geometry';
import { entityLevelId, levelElevationMap } from '@/utils/levels';
import {
  markSceneDragActive,
  markSceneClickHandled,
  markSceneDragEnd,
  markScenePress,
  notifyGizmoPointerDown,
  shouldHandleElementClick,
} from './sceneDragGuard';
import {
  NEUTRAL_HIGHLIGHT_COLOR,
  exhibitorColor,
  exhibitorPaintAmount,
  findExhibitor,
  highlightNeutralAmount,
} from '@/utils/exhibitorColors';

interface ObjectTint {
  color: string;
  opacity: number;
}

const DIMENSION_LABEL_STYLE: CSSProperties = {
  background: 'rgba(10, 13, 16, 0.9)',
  border: '1px solid #d7ff4f',
  color: '#d7ff4f',
  padding: '2px 7px',
  borderRadius: 4,
  fontSize: 11,
  lineHeight: 1.2,
  whiteSpace: 'nowrap',
  fontFamily: 'var(--mono)',
};

/**
 * Etiqueta flotante del objeto con su código y/o su nombre. El código es la
 * referencia corta del modelo (`b1`, el del catálogo) y el nombre es el texto
 * libre que se edita en el inspector; cada uno se enciende por separado.
 */
function ObjectLabel({
  object,
  position,
  selected,
  ringColor,
}: {
  object: SceneObject;
  position: [number, number, number];
  selected?: boolean;
  ringColor?: string;
}) {
  const code = (object.code ?? '').trim();
  const name = (object.name ?? '').trim();
  const showCode = object.showCode && code.length > 0;
  const showName = object.showName && name.length > 0;
  if (!showCode && !showName) return null;
  return (
    <Html center position={position} zIndexRange={[100, 0]} style={{ pointerEvents: 'none' }}>
      <div
        className={`marker-label${selected ? ' is-selected' : ''}`}
        style={ringColor ? { borderColor: ringColor } : undefined}
      >
        {showCode ? (
          <strong style={ringColor ? { color: ringColor } : undefined}>{code}</strong>
        ) : null}
        {showName ? <span>{name}</span> : null}
      </div>
    </Html>
  );
}

function disposeCloneMaterials(root: THREE.Object3D) {  const seen = new Set<THREE.Material>();
  root.traverse((object) => {
    const mesh = object as THREE.Mesh;
    if (!mesh.isMesh) return;
    const materials = Array.isArray(mesh.material) ? mesh.material : [mesh.material];
    for (const material of materials) {
      if (material && !seen.has(material)) {
        seen.add(material);
        material.dispose();
      }
    }
  });
}

/**
 * Araña metálica con un impreso largo colgado: el soporte es un arnés de
 * tubos y el impreso es un paño vertical con la imagen del cliente.
 *
 * El paño se adapta a la imagen: se mantiene el alto útil (1,60 m) y el ancho
 * se ensancha o se recorta en función de la relación de aspecto real del
 * archivo, así un diseño vertical y uno apaisado cuelgan sin deformarse.
 *
 * La geometría se construye en el rango 0..1 de alto y se escala con el
 * `size` del objeto (0.60 × 1.60 m por defecto), igual que las demás formas.
 */
/**
 * Araña metálica con un impreso largo colgado.
 *
 * La pieza es un marco rectangular (dos postes y dos travesaños) con el paño
 * del impreso tensado dentro. No lleva patas: en la referencia el soporte es
 * un marco plano que se apoya en el suelo.
 *
 * El paño se adapta a la imagen: el marco conserva las medidas reales del
 * producto (0.60 × 1.60 m) y la imagen se ajusta dentro sin deformarse
 * (`object-fit: contain`), dejando el aire que haga falta a los lados.
 *
 * La geometría se construye en el rango 0..1 y se escala con el `size` del
 * objeto, igual que las demás formas.
 */
function SpiderModel({
  banner,
  tint,
  neutralColor,
  size,
}: {
  banner?: MediaItem;
  tint?: ObjectTint;
  neutralColor?: string;
  /** Medidas reales del objeto (se usan para dibujar el marco a escala). */
  size?: [number, number, number];
}) {
  const url = mediaItemUrl(banner);

  // Relación de aspecto real de la imagen (ancho / alto). Mientras llega se
  // usa la del producto de referencia (60 × 160 ≈ 0.375).
  const [aspect, setAspect] = useState(0.375);
  const [texture, setTexture] = useState<THREE.Texture | null>(null);
  const [textureError, setTextureError] = useState(false);

  useEffect(() => {
    setAspect(0.375);
    setTexture(null);
    setTextureError(false);
    if (!url) return;

    let cancelled = false;
    // Se carga con un <img> normal (mismo origen, sin CORS) y se sube a una
    // textura de Three. Con `TextureLoader` + crossOrigin la petición al proxy
    // de Notion fallaba y el paño quedaba en negro.
    const image = new Image();
    image.decoding = 'async';
    image.onload = () => {
      if (cancelled) return;
      const ratio = image.naturalHeight > 0 ? image.naturalWidth / image.naturalHeight : 0.375;
      setAspect(Math.min(Math.max(ratio, 0.1), 6));
      const loaded = new THREE.Texture(image);
      loaded.colorSpace = THREE.SRGBColorSpace;
      loaded.anisotropy = 8;
      loaded.needsUpdate = true;
      setTexture(loaded);
    };
    image.onerror = () => {
      if (!cancelled) setTextureError(true);
    };
    image.src = url;

    return () => {
      cancelled = true;
    };
  }, [url]);

  useEffect(() => () => texture?.dispose(), [texture]);

  // El modo neutro (lectura) aclara los muebles del expositor, pero el
  // impreso es contenido: su imagen no debe perder opacidad ni aclararse.
  // Solo se atenúa el marco, igual que `applyWhiteoutToMaterials` respeta
  // los materiales de texto.
  const frameDimmed = tint && tint.color === neutralColor ? tint.opacity : 0;

  // Tinta: sin expositor asignado el marco es metal gris; al elegir un
  // expositor se pinta como el resto de sus piezas.
  const frameColor = useMemo(() => {
    const base = new THREE.Color('#8f959c');
    if (!tint || tint.opacity <= 0.001) return `#${base.getHexString()}`;
    base.lerp(new THREE.Color(tint.color), tint.opacity);
    return `#${base.getHexString()}`;
  }, [tint?.color, tint?.opacity]);

  // En modo neutro el marco tira a blanco en vez de teñirse de un color.
  const railColor = useMemo(() => {
    if (frameDimmed <= 0.001) return frameColor;
    const base = new THREE.Color(frameColor);
    base.lerp(new THREE.Color('#f2f0eb'), Math.min(1, frameDimmed));
    return `#${base.getHexString()}`;
  }, [frameColor, frameDimmed]);

  // El marco toma la forma del impreso: se conserva el alto real del objeto
  // (160 cm por defecto) y el ancho sale de la proporción de la imagen. Así un
  // impreso cuadrado queda cuadrado, uno vertical queda alargado y uno
  // apaisado queda ancho, sin deformar nunca la imagen.
  const frameHeight = Math.max(size?.[1] ?? 1.6, 0.05);
  // Se limita a 3× el alto para que una panorámica extrema no invada el stand.
  const frameWidth = Math.min(Math.max(frameHeight * aspect, 0.08), frameHeight * 3);
  const barRadius = Math.min(frameWidth, frameHeight) * 0.017;

  // El paño llena el marco: como el marco ya tiene la proporción de la imagen,
  // ésta se muestra completa de lado a lado.
  const innerWidth = frameWidth * 0.94;
  const innerHeight = frameHeight * 0.94;

  return (
    <group>
      {/* Marco: dos postes verticales y dos travesaños. */}
      {[-1, 1].map((side) => (
        <mesh
          key={`post-${side}`}
          position={[(side * frameWidth) / 2, frameHeight / 2, 0]}
          castShadow
        >
          <cylinderGeometry args={[barRadius, barRadius, frameHeight, 12]} />
          <meshStandardMaterial color={railColor} roughness={0.35} metalness={0.85} />
        </mesh>
      ))}
      {[0, frameHeight].map((y) => (
        <mesh
          key={`rail-${y}`}
          position={[0, y, 0]}
          rotation={[0, 0, Math.PI / 2]}
          castShadow
        >
          <cylinderGeometry args={[barRadius, barRadius, frameWidth, 12]} />
          <meshStandardMaterial color={railColor} roughness={0.35} metalness={0.85} />
        </mesh>
      ))}

      {/*
        Impreso por las dos caras. El mismo dibujo se monta dos veces: una de
        cara al frente y otra girada 180° para la parte de atrás. Así la imagen
        se ve igual desde los dos lados (con DoubleSide la cara trasera salía
        reflejada) y el paño no tapa a la otra al mirar desde atrás.
      */}
      {[0, Math.PI].map((rotationY, index) => (
        <mesh
          key={`print-${index}`}
          position={[0, frameHeight / 2, index === 0 ? 0.006 : -0.006]}
          rotation={[0, rotationY, 0]}
          castShadow
        >
          <planeGeometry args={[innerWidth, innerHeight]} />
          {texture ? (
            <meshBasicMaterial
              map={texture}
              transparent={false}
              opacity={1}
              toneMapped={false}
            />
          ) : (
            <meshStandardMaterial
              color={textureError ? '#6b3a3a' : '#c9c4b8'}
              transparent={false}
              opacity={1}
              roughness={0.9}
              metalness={0.02}
              side={THREE.DoubleSide}
            />
          )}
        </mesh>
      ))}

    </group>
  );
}

function PrimitiveModel({
  shape,
  overrides,
  tint,
  neutralColor,
  banner,
  size,
}: {
  shape: PrimitiveShape;
  overrides: Record<string, MaterialOverride>;
  tint?: ObjectTint;
  neutralColor?: string;
  /** Impreso de la araña (solo se usa con `shape === 'spider'`). */
  banner?: MediaItem;
  /** Medidas del objeto, para dibujar la araña a escala real. */
  size?: [number, number, number];
}) {
  // La araña tiene su propia geometría (arnés + paño texturizado), así que se
  // resuelve antes de crear los recursos de las formas simples.
  if (shape === 'spider') {
    return (
      <SpiderModel
        banner={banner}
        tint={tint}
        neutralColor={neutralColor}
        size={size}
      />
    );
  }
  const geometry = useMemo(() => {
    switch (shape) {
      case 'sphere':
        return new THREE.SphereGeometry(0.5, 40, 28);
      case 'cylinder':
        return new THREE.CylinderGeometry(0.5, 0.5, 1, 40);
      case 'cone':
        return new THREE.ConeGeometry(0.55, 1, 40);
      default:
        return new THREE.BoxGeometry(1, 1, 1);
    }
  }, [shape]);
  const material = useMemo(
    () =>
      new THREE.MeshStandardMaterial({
        name: 'Primitive',
        color: '#d8d2c4',
        roughness: 0.66,
        metalness: 0.03,
      }),
    [],
  );

  useEffect(() => {
    const override = overrides['0:Primitive'];
    // `tint` es la pintura del expositor; `whiteout` lo que no es el elegido.
    const whiteout = tint && tint.color === neutralColor ? tint.opacity : 0;
    const paint = whiteout > 0 ? 0 : (tint?.opacity ?? 0);
    material.color.set(override?.color ?? '#d8d2c4');
    if (whiteout > 0 && tint) material.color.lerp(new THREE.Color(tint.color), whiteout);
    if (paint > 0 && tint) material.color.lerp(new THREE.Color(tint.color), paint);
    material.roughness = whiteout > 0 ? 0.78 : (override?.roughness ?? 0.66);
    material.metalness = whiteout > 0 ? 0.02 : (override?.metalness ?? 0.03);
    material.opacity = override?.opacity ?? 1;
    material.transparent = material.opacity < 1;
    material.visible = override?.visible ?? true;
    material.needsUpdate = true;
  }, [material, overrides, neutralColor, tint?.color, tint?.opacity]);

  useEffect(
    () => () => {
      geometry.dispose();
      material.dispose();
    },
    [geometry, material],
  );

  return <mesh geometry={geometry} material={material} position={[0, 0.5, 0]} castShadow receiveShadow />;
}

function GlbModel({
  url,
  object,
  overrides,
  tint,
  neutralColor,
}: {
  url: string;
  object: SceneObject;
  overrides: Record<string, MaterialOverride>;
  tint?: ObjectTint;
  /** Color del tinte neutro: con él el modelo se blanquea en lugar de pintarse. */
  neutralColor?: string;
}) {
  const [root, setRoot] = useState<THREE.Object3D | null>(null);
  const [offset, setOffset] = useState<[number, number, number]>([0, 0, 0]);
  const [error, setError] = useState<string | null>(null);

  useEffect(() => {
    let cancelled = false;
    let localRoot: THREE.Object3D | null = null;
    setRoot(null);
    setError(null);

    loadGltf(url)
      .then((gltf) => {
        if (cancelled) return;
        localRoot = cloneModelScene(gltf.scene);
        localRoot.traverse((child) => {
          const light = child as THREE.Light;
          const camera = child as THREE.Camera;
          if (light.isLight || camera.isCamera) child.visible = false;
        });
        const box = new THREE.Box3().setFromObject(localRoot);
        if (!box.isEmpty()) {
          const center = new THREE.Vector3();
          const size = new THREE.Vector3();
          box.getSize(size);
          box.getCenter(center);
          setOffset([-center.x, -box.min.y, -center.z]);
          const current = useEditorStore
            .getState()
            .project?.objects.find((entry) => entry.id === object.id);
          if (current && !current.size) {
            useEditorStore.getState().setObjectSize(object.id, [
              Math.max(size.x, 0.01),
              Math.max(size.y, 0.01),
              Math.max(size.z, 0.01),
            ]);
          }
        }
        useModelInfoStore.getState().register(modelInfoFromScene(url, localRoot));
        applyOverridesToMaterials(localRoot, overrides);
        setRoot(localRoot);
      })
      .catch((loadError: Error) => {
        if (!cancelled) setError(loadError.message || 'No se pudo cargar el modelo GLB.');
      });

    return () => {
      cancelled = true;
      if (localRoot) disposeCloneMaterials(localRoot);
    };
    // Las sobrescrituras se aplican en el efecto siguiente.
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [url, object.id]);

  useEffect(() => {
    if (!root) return;
    applyOverridesToMaterials(root, overrides);
    if (tint && tint.color === neutralColor) {
      applyWhiteoutToMaterials(root, tint.color, tint.opacity);
    } else if (tint) {
      applyTintToMaterials(root, tint.color, tint.opacity);
    }
  }, [root, overrides, neutralColor, tint?.color, tint?.opacity]);

  if (error) {
    return (
      <group position={[0, 0.5, 0]}>
        <mesh castShadow>
          <boxGeometry args={[0.7, 1, 0.7]} />
          <meshStandardMaterial color="#7c2d2d" roughness={0.7} wireframe />
        </mesh>
      </group>
    );
  }

  if (!root) {
    return (
      <mesh position={[0, 0.25, 0]}>
        <boxGeometry args={[0.45, 0.5, 0.45]} />
        <meshStandardMaterial color="#3b4650" transparent opacity={0.55} />
      </mesh>
    );
  }

  return <primitive object={root} position={offset} />;
}

function ObjectModel({
  object,
  tint,
  neutralColor,
}: {
  object: SceneObject;
  tint?: ObjectTint;
  neutralColor?: string;
}) {
  if (object.source.type === 'primitive') {
    return (
      <PrimitiveModel
        shape={object.source.shape}
        overrides={object.overrides}
        tint={tint}
        neutralColor={neutralColor}
        banner={object.banner}
        size={object.size}
      />
    );
  }
  return (
    <GlbModel
      url={object.source.url}
      object={object}
      overrides={object.overrides}
      tint={tint}
      neutralColor={neutralColor}
    />
  );
}

function SelectionRing({
  object,
  highlighted,
  color = '#d7ff4f',
}: {
  object: SceneObject;
  highlighted?: boolean;
  color?: string;
}) {
  const size = object.size ?? [0.8, 1, 0.8];
  const radius =
    Math.max(
      Math.abs(size[0] * object.transform.scale[0]),
      Math.abs(size[2] * object.transform.scale[2]),
    ) *
      0.62 +
    0.18;
  return (
    <>
    <mesh rotation={[-Math.PI / 2, 0, 0]} position={[0, 0.025, 0]} renderOrder={12}>
      <ringGeometry args={[radius, radius + (highlighted ? 0.09 : 0.055), 48]} />
      <meshBasicMaterial
        color={highlighted ? color : '#d7ff4f'}
        transparent
        opacity={highlighted ? 0.95 : 0.65}
        depthWrite={false}
      />
    </mesh>
    {/* Aro de agarre invisible: la pieza seleccionada recibe el clic antes que
        el piso, también al entrar o salir de la escena. */}
    <mesh rotation={[-Math.PI / 2, 0, 0]} position={[0, 0.024, 0]} renderOrder={12}>
      <ringGeometry args={[0, radius + 0.12, 32]} />
      <meshBasicMaterial transparent opacity={0} depthWrite={false} colorWrite={false} />
    </mesh>
    </>
  );
}

function EditableObjectInstance({
  object,
  elevation = 0,
  selected,
  highlighted,
  tint,
  ringColor,
  showLabels,
  neutralColor,
  onSelect,
}: {
  object: SceneObject;
  elevation?: number;
  selected: boolean;
  highlighted?: boolean;
  tint?: ObjectTint;
  ringColor?: string;
  showLabels: boolean;
  neutralColor?: string;
  onSelect?: (id: string) => void;
}) {
  const [group, setGroup] = useState<THREE.Group | null>(null);
  const gizmoRef = useRef<any>(null);
  const transformMode = useEditorStore((state) => state.transformMode);
  // Las cotas del objeto seleccionado son medidas de trabajo (del editor), así
  // que las gobierna «Medidas al editar» y no las cotas de presentación del
  // visor público.
  const showMeasurements = useEditorStore(
    (state) => state.project?.settings.showLiveMeasurements ?? true,
  );
  const beginHistory = useEditorStore((state) => state.beginHistory);
  const commitHistory = useEditorStore((state) => state.commitHistory);
  const updateObjectTransform = useEditorStore((state) => state.updateObjectTransform);
  const controls = useThree((state) => state.controls) as { enabled: boolean } | null;

  const finishTransform = () => {
    if (!group) return;
    const project = useEditorStore.getState().project;
    const gridSize = project?.settings.gridSize ?? 0.25;
    const snap = project?.settings.snapToGrid ?? false;
    let x = group.position.x;
    let y = Math.max(0, group.position.y - elevation);
    let z = group.position.z;
    if (snap) {
      x = snapValue(x, gridSize);
      z = snapValue(z, gridSize);
    }
    updateObjectTransform(
      object.id,
      {
        position: [x, y, z],
        rotationY: group.rotation.y,
        scale: [
          Math.max(0.01, group.scale.x),
          Math.max(0.01, group.scale.y),
          Math.max(0.01, group.scale.z),
        ],
      },
      { history: false },
    );
    commitHistory();
    if (controls) controls.enabled = true;
    markSceneDragEnd();
  };

  // `onMouseUp` no siempre se dispara; confirmamos el fin del arrastre también
  // con el evento del propio gizmo para no perder la transformación.
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

  const dimensions = object.size
    ? object.size.map((value, index) => Math.abs(value * object.transform.scale[index]))
    : null;

  return (
    <>
      <group
        ref={setGroup}
        position={[
          object.transform.position[0],
          object.transform.position[1] + elevation,
          object.transform.position[2],
        ]}
        rotation={[0, object.transform.rotationY, 0]}
        scale={object.transform.scale}
        visible={object.visible}
        onClick={(event) => {
          if (!onSelect) return;
          event.stopPropagation();
          // Siempre selecciona el objeto bajo el cursor, aunque el piso también
          // reciba el clic (sube su `renderOrder` y gana el más cercano).
          if (!shouldHandleElementClick()) return;
          markSceneClickHandled();
          onSelect(object.id);
        }}
      >
        <ObjectModel object={object} tint={tint} neutralColor={neutralColor} />
        {selected || highlighted ? (
          <SelectionRing object={object} highlighted={highlighted} color={ringColor} />
        ) : null}
      </group>
      {selected && dimensions && showMeasurements ? (
        <Html
          center
          position={[
            object.transform.position[0],
            object.transform.position[1] + elevation + dimensions[1] + 0.24,
            object.transform.position[2],
          ]}
          zIndexRange={[110, 0]}
          style={{ pointerEvents: 'none' }}
        >
          <div style={DIMENSION_LABEL_STYLE}>
            A {dimensions[0].toFixed(2)} · H {dimensions[1].toFixed(2)} · F{' '}
            {dimensions[2].toFixed(2)} m
          </div>
        </Html>
      ) : null}
      {showLabels ? (
        <ObjectLabel
          object={object}
          selected={selected}
          ringColor={ringColor}
          position={[
            object.transform.position[0],
            object.transform.position[1] +
              elevation +
              (dimensions ? dimensions[1] : Math.abs(object.transform.scale[1])) +
              (selected && dimensions ? 0.62 : 0.32),
            object.transform.position[2],
          ]}
        />
      ) : null}
      {selected && group ? (
        <TransformControls
          ref={gizmoRef}
          object={group}
          mode={transformMode}
          size={0.72}
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

function ReadOnlyObjectInstance({
  object,
  elevation = 0,
  highlighted,
  tint,
  ringColor,
  showLabels,
  showMeasurements,
  neutralColor,
  onSelect,
}: {
  object: SceneObject;
  elevation?: number;
  highlighted?: boolean;
  tint?: ObjectTint;
  ringColor?: string;
  showLabels: boolean;
  /** Cotas del objeto resaltado en la vista de solo lectura. */
  showMeasurements?: boolean;
  /** Color del tinte neutro («solo el elegido»). */
  neutralColor?: string;
  onSelect?: (object: SceneObject) => void;
}) {
  const height = object.size ? Math.abs(object.size[1] * object.transform.scale[1]) : 1;
  const dimensions = object.size
    ? object.size.map((value, index) => Math.abs(value * object.transform.scale[index]))
    : null;
  return (
    <>
      <group
        position={[
          object.transform.position[0],
          object.transform.position[1] + elevation,
          object.transform.position[2],
        ]}
        rotation={[0, object.transform.rotationY, 0]}
        scale={object.transform.scale}
        visible={object.visible}
        onClick={(event) => {
          if (!onSelect) return;
          event.stopPropagation();
          onSelect(object);
        }}
      >
        <ObjectModel object={object} tint={tint} neutralColor={neutralColor} />
        {highlighted ? <SelectionRing object={object} highlighted color={ringColor} /> : null}
      </group>
      {highlighted && dimensions && showMeasurements ? (
        <Html
          center
          position={[
            object.transform.position[0],
            object.transform.position[1] + elevation + dimensions[1] + 0.24,
            object.transform.position[2],
          ]}
          zIndexRange={[110, 0]}
          style={{ pointerEvents: 'none' }}
        >
          <div style={DIMENSION_LABEL_STYLE}>
            A {dimensions[0].toFixed(2)} · H {dimensions[1].toFixed(2)} · F{' '}
            {dimensions[2].toFixed(2)} m
          </div>
        </Html>
      ) : null}
      {showLabels ? (
        <ObjectLabel
          object={object}
          selected={highlighted}
          ringColor={ringColor}
          position={[
            object.transform.position[0],
            object.transform.position[1] + elevation + height + 0.3,
            object.transform.position[2],
          ]}
        />
      ) : null}
    </>
  );
}

export function SceneObjects({
  project,
  editable = false,
  selectedObjectId,
  selectedExhibitorId,
  showLabels = true,
  showMeasurements = false,
  highlightOthers = false,
  neutralColor = NEUTRAL_HIGHLIGHT_COLOR,
  onSelectObject,
  onSelectExhibitor,
}: {
  project: Project;
  editable?: boolean;
  selectedObjectId?: string | null;
  selectedExhibitorId?: string | null;
  /** Etiquetas de código/nombre de los objetos en la vista de solo lectura. */
  showLabels?: boolean;
  /** Cotas de los objetos del expositor seleccionado en solo lectura. */
  showMeasurements?: boolean;
  /**
   * Visor público: con un expositor elegido, sus objetos conservan el color y
   * el resto se lleva al color neutro. Un número (0–1) es el progreso del
   * fundido, que permite hacer el cambio suave.
   */
  highlightOthers?: boolean | number;
  /** Color al que se lleva lo que no es el expositor elegido. */
  neutralColor?: string;
  onSelectObject?: (id: string) => void;
  onSelectExhibitor?: (id: string) => void;
}) {
  const elevations = useMemo(() => levelElevationMap(project), [project]);
  return (
    <group>
      {project.objects.map((object) => {
        const elevation = elevations[entityLevelId(project, object) ?? ''] ?? 0;
        const exhibitor = findExhibitor(project, object.exhibitorId);
        const neutralAmount = highlightNeutralAmount(
          selectedExhibitorId,
          object.exhibitorId,
          highlightOthers,
        );
        const paintAmount = exhibitorPaintAmount(
          project,
          object.exhibitorId,
          selectedExhibitorId,
        );
        const tint = neutralAmount > 0
          ? { color: neutralColor, opacity: neutralAmount }
          : exhibitor && paintAmount > 0
            ? { color: exhibitorColor(exhibitor), opacity: paintAmount }
            : undefined;
        const ringColor = exhibitor ? exhibitorColor(exhibitor) : undefined;
        return editable ? (
          <EditableObjectInstance
            key={object.id}
            object={object}
            elevation={elevation}
            selected={selectedObjectId === object.id}
            tint={tint}
            ringColor={ringColor}
            showLabels={showLabels}
            neutralColor={neutralColor}
            onSelect={onSelectObject}
          />
        ) : (
          <ReadOnlyObjectInstance
            key={object.id}
            object={object}
            elevation={elevation}
            highlighted={Boolean(
              selectedExhibitorId && object.exhibitorId === selectedExhibitorId,
            )}
            tint={tint}
            ringColor={ringColor}
            showLabels={showLabels}
            showMeasurements={showMeasurements}
            neutralColor={neutralColor}
            onSelect={(entry) => {
              if (entry.exhibitorId) onSelectExhibitor?.(entry.exhibitorId);
            }}
          />
        );
      })}
    </group>
  );
}
