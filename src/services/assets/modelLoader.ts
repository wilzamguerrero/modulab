import * as THREE from 'three';
import { GLTFLoader, type GLTF } from 'three/examples/jsm/loaders/GLTFLoader.js';
import { DRACOLoader } from 'three/examples/jsm/loaders/DRACOLoader.js';
import { MeshoptDecoder } from 'three/examples/jsm/libs/meshopt_decoder.module.js';
import { clone as cloneSkeleton } from 'three/examples/jsm/utils/SkeletonUtils.js';
import type { ModelInfo, ModelMaterialSlot, Vec3 } from '@/types/project';

let dracoLoader: DRACOLoader | null = null;

function getDracoLoader(): DRACOLoader {
  if (!dracoLoader) {
    dracoLoader = new DRACOLoader();
    dracoLoader.setDecoderPath('/draco/');
  }
  return dracoLoader;
}

export function configureGltfLoader(loader: GLTFLoader): GLTFLoader {
  const marker = loader as GLTFLoader & { __modulabConfigured?: boolean };
  if (marker.__modulabConfigured) return loader;
  try {
    loader.setDRACOLoader(getDracoLoader());
    loader.setMeshoptDecoder(MeshoptDecoder);
  } catch {
    // Algunos builds de three no exponen estos métodos; se usa el loader básico.
  }
  marker.__modulabConfigured = true;
  return loader;
}

const gltfCache = new Map<string, Promise<GLTF>>();

export function loadGltf(url: string): Promise<GLTF> {
  const cached = gltfCache.get(url);
  if (cached) return cached;
  const loader = configureGltfLoader(new GLTFLoader());
  const promise = loader.loadAsync(url).catch((error) => {
    gltfCache.delete(url);
    throw error;
  });
  gltfCache.set(url, promise);
  return promise;
}

export function clearGltfCache(url?: string): void {
  if (url) gltfCache.delete(url);
  else gltfCache.clear();
}

function materialSlot(material: THREE.Material, index: number): ModelMaterialSlot {
  const standard = material as THREE.MeshStandardMaterial;
  const name = material.name?.trim() || `Material ${index + 1}`;
  return {
    key: `${index}:${name}`,
    name,
    color: standard.color ? `#${standard.color.getHexString()}` : undefined,
    roughness: typeof standard.roughness === 'number' ? standard.roughness : undefined,
    metalness: typeof standard.metalness === 'number' ? standard.metalness : undefined,
  };
}

export function modelInfoFromScene(url: string, scene: THREE.Object3D): ModelInfo {
  scene.updateMatrixWorld(true);
  const box = new THREE.Box3().setFromObject(scene);
  const size = new THREE.Vector3();
  const center = new THREE.Vector3();
  if (box.isEmpty()) {
    size.set(1, 1, 1);
    center.set(0, 0.5, 0);
  } else {
    box.getSize(size);
    box.getCenter(center);
  }
  if (!Number.isFinite(size.x) || size.x <= 0) size.x = 1;
  if (!Number.isFinite(size.y) || size.y <= 0) size.y = 1;
  if (!Number.isFinite(size.z) || size.z <= 0) size.z = 1;

  const slots: ModelMaterialSlot[] = [];
  const seen = new Set<string>();
  scene.traverse((object) => {
    const mesh = object as THREE.Mesh;
    if (!mesh.isMesh || !mesh.material) return;
    const materials = Array.isArray(mesh.material) ? mesh.material : [mesh.material];
    for (const material of materials) {
      if (!material || seen.has(material.uuid)) continue;
      seen.add(material.uuid);
      slots.push(materialSlot(material, slots.length));
    }
  });

  return {
    url,
    size: [size.x, size.y, size.z] as Vec3,
    offset: [-center.x, -box.min.y, -center.z] as Vec3,
    materials: slots,
  };
}

const modelInfoCache = new Map<string, Promise<ModelInfo>>();
const resolvedModelInfo = new Map<string, ModelInfo>();

export function getModelInfo(url: string): Promise<ModelInfo> {
  const cached = modelInfoCache.get(url);
  if (cached) return cached;
  const promise = loadGltf(url)
    .then((gltf) => {
      const info = modelInfoFromScene(url, gltf.scene);
      resolvedModelInfo.set(url, info);
      return info;
    })
    .catch((error) => {
      modelInfoCache.delete(url);
      resolvedModelInfo.delete(url);
      throw error;
    });
  modelInfoCache.set(url, promise);
  return promise;
}

export function getCachedModelInfo(url: string): ModelInfo | undefined {
  return resolvedModelInfo.get(url);
}

interface MaterialBaseline {
  color?: number;
  roughness?: number;
  metalness?: number;
  opacity: number;
  transparent: boolean;
  visible: boolean;
}

/**
 * Guarda los valores originales de cada material clonado. Las sobrescrituras se
 * aplican sobre una copia restaurada, de modo que borrar una propiedad en el
 * inspector recupera el valor real del GLB en vez de conservar el último cambio.
 */
const materialBaselines = new WeakMap<THREE.Material, MaterialBaseline>();

function captureMaterialBaseline(material: THREE.Material): void {
  if (materialBaselines.has(material)) return;
  const standard = material as THREE.MeshStandardMaterial;
  materialBaselines.set(material, {
    color: standard.color ? standard.color.getHex() : undefined,
    roughness: typeof standard.roughness === 'number' ? standard.roughness : undefined,
    metalness: typeof standard.metalness === 'number' ? standard.metalness : undefined,
    opacity: material.opacity,
    transparent: material.transparent,
    visible: material.visible,
  });
}

function restoreMaterialBaseline(material: THREE.Material): void {
  const baseline = materialBaselines.get(material);
  if (!baseline) {
    // Un material ajeno al clon (por ejemplo, creado por una integración externa):
    // su estado actual pasa a ser la referencia.
    captureMaterialBaseline(material);
    return;
  }
  const standard = material as THREE.MeshStandardMaterial;
  if (baseline.color !== undefined && standard.color) standard.color.setHex(baseline.color);
  if (baseline.roughness !== undefined) standard.roughness = baseline.roughness;
  if (baseline.metalness !== undefined) standard.metalness = baseline.metalness;
  if (material.transparent !== baseline.transparent) material.needsUpdate = true;
  material.opacity = baseline.opacity;
  material.transparent = baseline.transparent;
  material.visible = baseline.visible;
}

export function cloneModelScene(scene: THREE.Object3D): THREE.Object3D {
  const clone = cloneSkeleton(scene) as THREE.Object3D;
  clone.traverse((object) => {
    const mesh = object as THREE.Mesh;
    if (!mesh.isMesh) return;
    if (Array.isArray(mesh.material)) {
      mesh.material = mesh.material.map((material) => {
        const cloned = material.clone();
        captureMaterialBaseline(cloned);
        return cloned;
      });
    } else if (mesh.material) {
      const cloned = mesh.material.clone();
      captureMaterialBaseline(cloned);
      mesh.material = cloned;
    }
    mesh.castShadow = true;
    mesh.receiveShadow = true;
  });
  return clone;
}

/**
 * Tiñe temporalmente los materiales de una instancia con el color de su
 * expositor. Se aplica después de las sobrescrituras para que el color
 * original pueda recuperarse al desactivar la pintura.
 */
export function applyTintToMaterials(root: THREE.Object3D, color: string, opacity: number): void {
  const ratio = Math.max(0, Math.min(1, Number.isFinite(opacity) ? opacity : 0));
  if (ratio <= 0) return;
  const tint = new THREE.Color(color);
  const seen = new Set<string>();
  root.traverse((object) => {
    const mesh = object as THREE.Mesh;
    if (!mesh.isMesh || !mesh.material) return;
    const materials = Array.isArray(mesh.material) ? mesh.material : [mesh.material];
    for (const material of materials) {
      if (!material || seen.has(material.uuid)) continue;
      seen.add(material.uuid);
      const standard = material as THREE.MeshStandardMaterial;
      if (!standard.color) continue;
      standard.color.lerp(tint, ratio);
      material.needsUpdate = true;
    }
  });
}

export function applyOverridesToMaterials(
  root: THREE.Object3D,
  overrides: Record<string, import('@/types/project').MaterialOverride>,
): void {
  const seen = new Set<string>();
  let index = 0;
  root.traverse((object) => {
    const mesh = object as THREE.Mesh;
    if (!mesh.isMesh || !mesh.material) return;
    const materials = Array.isArray(mesh.material) ? mesh.material : [mesh.material];
    for (const material of materials) {
      if (!material || seen.has(material.uuid)) continue;
      seen.add(material.uuid);
      const name = material.name?.trim() || `Material ${index + 1}`;
      const override = overrides[`${index}:${name}`];
      index++;
      restoreMaterialBaseline(material);
      if (!override) continue;
      const standard = material as THREE.MeshStandardMaterial;
      if (override.color && standard.color) standard.color.set(override.color);
      if (typeof override.roughness === 'number') standard.roughness = override.roughness;
      if (typeof override.metalness === 'number') standard.metalness = override.metalness;
      if (typeof override.opacity === 'number') {
        const transparent = override.opacity < 1;
        if (material.transparent !== transparent) material.needsUpdate = true;
        material.opacity = override.opacity;
        material.transparent = transparent;
      }
      if (typeof override.visible === 'boolean') material.visible = override.visible;
    }
  });
}
