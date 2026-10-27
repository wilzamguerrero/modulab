import { useEffect, useMemo, useRef, useState } from 'react';
import * as THREE from 'three';
import { useThree } from '@react-three/fiber';
import { TransformControls } from '@react-three/drei';
import type { MaterialOverride, PrimitiveShape, Project, SceneObject } from '@/types/project';
import {
  applyOverridesToMaterials,
  applyTintToMaterials,
  cloneModelScene,
  loadGltf,
  modelInfoFromScene,
} from '@/services/assets/modelLoader';
import { useEditorStore } from '@/store/editorStore';
import { useModelInfoStore } from '@/store/modelInfoStore';
import { snapValue } from '@/utils/geometry';
import {
  exhibitorColor,
  exhibitorPaintAmount,
  findExhibitor,
} from '@/utils/exhibitorColors';

interface ObjectTint {
  color: string;
  opacity: number;
}

function disposeCloneMaterials(root: THREE.Object3D) {
  const seen = new Set<THREE.Material>();
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

function PrimitiveModel({
  shape,
  overrides,
  tint,
}: {
  shape: PrimitiveShape;
  overrides: Record<string, MaterialOverride>;
  tint?: ObjectTint;
}) {
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
    material.color.set(override?.color ?? '#d8d2c4');
    material.roughness = override?.roughness ?? 0.66;
    material.metalness = override?.metalness ?? 0.03;
    material.opacity = override?.opacity ?? 1;
    material.transparent = material.opacity < 1;
    material.visible = override?.visible ?? true;
    if (tint) material.color.lerp(new THREE.Color(tint.color), tint.opacity);
    material.needsUpdate = true;
  }, [material, overrides, tint?.color, tint?.opacity]);

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
}: {
  url: string;
  object: SceneObject;
  overrides: Record<string, MaterialOverride>;
  tint?: ObjectTint;
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
    if (tint) applyTintToMaterials(root, tint.color, tint.opacity);
  }, [root, overrides, tint?.color, tint?.opacity]);

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

function ObjectModel({ object, tint }: { object: SceneObject; tint?: ObjectTint }) {
  if (object.source.type === 'primitive') {
    return <PrimitiveModel shape={object.source.shape} overrides={object.overrides} tint={tint} />;
  }
  return <GlbModel url={object.source.url} object={object} overrides={object.overrides} tint={tint} />;
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
    <mesh rotation={[-Math.PI / 2, 0, 0]} position={[0, 0.025, 0]}>
      <ringGeometry args={[radius, radius + (highlighted ? 0.09 : 0.055), 48]} />
      <meshBasicMaterial
        color={highlighted ? color : '#d7ff4f'}
        transparent
        opacity={highlighted ? 0.95 : 0.65}
        depthWrite={false}
      />
    </mesh>
  );
}

function EditableObjectInstance({
  object,
  selected,
  highlighted,
  tint,
  ringColor,
  onSelect,
}: {
  object: SceneObject;
  selected: boolean;
  highlighted?: boolean;
  tint?: ObjectTint;
  ringColor?: string;
  onSelect?: (id: string) => void;
}) {
  const [group, setGroup] = useState<THREE.Group | null>(null);
  const transformMode = useEditorStore((state) => state.transformMode);
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
    let y = Math.max(0, group.position.y);
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
  };

  return (
    <>
      <group
        ref={setGroup}
        position={object.transform.position}
        rotation={[0, object.transform.rotationY, 0]}
        scale={object.transform.scale}
        visible={object.visible}
        onClick={(event) => {
          if (!onSelect) return;
          event.stopPropagation();
          onSelect(object.id);
        }}
      >
        <ObjectModel object={object} tint={tint} />
        {selected || highlighted ? (
          <SelectionRing object={object} highlighted={highlighted} color={ringColor} />
        ) : null}
      </group>
      {selected && group ? (
        <TransformControls
          object={group}
          mode={transformMode}
          size={0.72}
          onMouseDown={() => {
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
  highlighted,
  tint,
  ringColor,
  onSelect,
}: {
  object: SceneObject;
  highlighted?: boolean;
  tint?: ObjectTint;
  ringColor?: string;
  onSelect?: (object: SceneObject) => void;
}) {
  return (
    <group
      position={object.transform.position}
      rotation={[0, object.transform.rotationY, 0]}
      scale={object.transform.scale}
      visible={object.visible}
      onClick={(event) => {
        if (!onSelect) return;
        event.stopPropagation();
        onSelect(object);
      }}
    >
      <ObjectModel object={object} tint={tint} />
      {highlighted ? <SelectionRing object={object} highlighted color={ringColor} /> : null}
    </group>
  );
}

export function SceneObjects({
  project,
  editable = false,
  selectedObjectId,
  selectedExhibitorId,
  onSelectObject,
  onSelectExhibitor,
}: {
  project: Project;
  editable?: boolean;
  selectedObjectId?: string | null;
  selectedExhibitorId?: string | null;
  onSelectObject?: (id: string) => void;
  onSelectExhibitor?: (id: string) => void;
}) {
  return (
    <group>
      {project.objects.map((object) => {
        const exhibitor = findExhibitor(project, object.exhibitorId);
        const paintAmount = exhibitorPaintAmount(
          project,
          object.exhibitorId,
          selectedExhibitorId,
        );
        const tint =
          exhibitor && paintAmount > 0
            ? { color: exhibitorColor(exhibitor), opacity: paintAmount }
            : undefined;
        const ringColor = exhibitor ? exhibitorColor(exhibitor) : undefined;
        return editable ? (
          <EditableObjectInstance
            key={object.id}
            object={object}
            selected={selectedObjectId === object.id}
            tint={tint}
            ringColor={ringColor}
            onSelect={onSelectObject}
          />
        ) : (
          <ReadOnlyObjectInstance
            key={object.id}
            object={object}
            highlighted={Boolean(
              selectedExhibitorId && object.exhibitorId === selectedExhibitorId,
            )}
            tint={tint}
            ringColor={ringColor}
            onSelect={(entry) => {
              if (entry.exhibitorId) onSelectExhibitor?.(entry.exhibitorId);
            }}
          />
        );
      })}
    </group>
  );
}
