import * as THREE from 'three';
import { clone as cloneSkeleton } from 'three/examples/jsm/utils/SkeletonUtils.js';
import type { CatalogItem } from '@/types/project';
import { loadGltf } from '@/services/assets/modelLoader';

const SIZE = 256;
let renderer: THREE.WebGLRenderer | null = null;
let scene: THREE.Scene | null = null;
let camera: THREE.PerspectiveCamera | null = null;
const cache = new Map<string, string>();
const pending = new Map<string, Promise<string>>();
let queue: Promise<unknown> = Promise.resolve();

function getRenderer(): THREE.WebGLRenderer {
  if (renderer) return renderer;
  renderer = new THREE.WebGLRenderer({
    antialias: true,
    alpha: true,
    preserveDrawingBuffer: true,
    powerPreference: 'low-power',
  });
  renderer.setSize(SIZE, SIZE, false);
  renderer.setPixelRatio(1);
  renderer.outputColorSpace = THREE.SRGBColorSpace;
  renderer.toneMapping = THREE.ACESFilmicToneMapping;
  renderer.toneMappingExposure = 1.15;
  renderer.setClearColor(0x000000, 0);
  return renderer;
}

function getScene(): THREE.Scene {
  if (scene) return scene;
  scene = new THREE.Scene();
  const hemi = new THREE.HemisphereLight(0xffffff, 0x3c4650, 1.8);
  scene.add(hemi);
  const key = new THREE.DirectionalLight(0xffffff, 3.2);
  key.position.set(2.5, 4.5, 3.5);
  scene.add(key);
  const fill = new THREE.DirectionalLight(0xb8d8ff, 1.4);
  fill.position.set(-3.5, 2.2, -2.5);
  scene.add(fill);
  const rim = new THREE.DirectionalLight(0xffe0b8, 1.1);
  rim.position.set(0, 2.5, -4);
  scene.add(rim);
  return scene;
}

function getCamera(): THREE.PerspectiveCamera {
  if (camera) return camera;
  camera = new THREE.PerspectiveCamera(32, 1, 0.01, 100);
  camera.position.set(1.55, 1.25, 2.25);
  camera.lookAt(0, 0, 0);
  return camera;
}

function primitiveMesh(item: CatalogItem): THREE.Object3D {
  switch (item.shape) {
    case 'sphere':
      return new THREE.Mesh(new THREE.SphereGeometry(0.5, 48, 32), new THREE.MeshStandardMaterial({ color: '#d8d2c4', roughness: 0.6 }));
    case 'cylinder':
      return new THREE.Mesh(new THREE.CylinderGeometry(0.5, 0.5, 1, 48), new THREE.MeshStandardMaterial({ color: '#d8d2c4', roughness: 0.55 }));
    case 'cone':
      return new THREE.Mesh(new THREE.ConeGeometry(0.55, 1, 48), new THREE.MeshStandardMaterial({ color: '#d8d2c4', roughness: 0.55 }));
    default:
      return new THREE.Mesh(new THREE.BoxGeometry(1, 1, 1), new THREE.MeshStandardMaterial({ color: '#d8d2c4', roughness: 0.7 }));
  }
}

function renderObject(root: THREE.Object3D, key: string): string {
  const activeScene = getScene();
  const activeCamera = getCamera();
  const activeRenderer = getRenderer();

  activeScene.updateMatrixWorld(true);
  const box = new THREE.Box3().setFromObject(root);
  const size = new THREE.Vector3();
  const center = new THREE.Vector3();
  if (box.isEmpty()) {
    size.set(1, 1, 1);
    center.set(0, 0.5, 0);
  } else {
    box.getSize(size);
    box.getCenter(center);
  }
  const maxDimension = Math.max(size.x, size.y, size.z, 0.01);
  const scale = 1.55 / maxDimension;
  root.scale.setScalar(scale);
  root.position.set(-center.x * scale, -center.y * scale, -center.z * scale);
  root.updateMatrixWorld(true);

  const disk = new THREE.Mesh(
    new THREE.CircleGeometry(0.82, 48),
    new THREE.MeshBasicMaterial({ color: 0x000000, transparent: true, opacity: 0.13, depthWrite: false }),
  );
  disk.rotation.x = -Math.PI / 2;
  disk.position.y = (-size.y * scale) / 2 - 0.005;

  activeScene.add(root);
  activeScene.add(disk);
  activeRenderer.render(activeScene, activeCamera);
  const dataUrl = activeRenderer.domElement.toDataURL('image/png');
  activeScene.remove(root);
  activeScene.remove(disk);
  disk.geometry.dispose();
  (disk.material as THREE.Material).dispose();
  cache.set(key, dataUrl);
  return dataUrl;
}

function thumbnailKey(item: CatalogItem): string {
  return `${item.id}:${item.modifiedAt ?? ''}:${item.url ?? ''}`;
}

async function generate(item: CatalogItem): Promise<string> {
  const key = thumbnailKey(item);
  const cached = cache.get(key);
  if (cached) return cached;

  if (item.kind === 'primitive') {
    return renderObject(primitiveMesh(item), key);
  }

  if (!item.url) throw new Error('El modelo no tiene URL.');
  const gltf = await loadGltf(item.url);
  const root = cloneSkeleton(gltf.scene) as THREE.Object3D;
  root.traverse((object) => {
    const light = object as THREE.Light;
    if (light.isLight || (object as THREE.Camera).isCamera) object.visible = false;
  });
  return renderObject(root, key);
}

export function getCatalogThumbnail(item: CatalogItem): Promise<string> {
  const key = thumbnailKey(item);
  const cached = cache.get(key);
  if (cached) return Promise.resolve(cached);
  const existing = pending.get(key);
  if (existing) return existing;
  const promise = new Promise<string>((resolve, reject) => {
    queue = queue
      .catch(() => undefined)
      .then(async () => {
        try {
          resolve(await generate(item));
        } catch (error) {
          reject(error);
        }
      });
  }).finally(() => {
    pending.delete(key);
  });
  pending.set(key, promise);
  return promise;
}

export function clearThumbnailCache(): void {
  cache.clear();
}
