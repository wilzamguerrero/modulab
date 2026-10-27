import { describe, expect, it } from 'vitest';
import * as THREE from 'three';
import { applyOverridesToMaterials, applyTintToMaterials, cloneModelScene } from './modelLoader';

function sceneWithMaterial(): { scene: THREE.Scene; mesh: THREE.Mesh } {
  const material = new THREE.MeshStandardMaterial({
    name: 'Material original',
    color: '#b04a2f',
    roughness: 0.82,
    metalness: 0.12,
    opacity: 1,
    transparent: false,
  });
  const mesh = new THREE.Mesh(new THREE.BoxGeometry(1, 1, 1), material);
  const scene = new THREE.Scene();
  scene.add(mesh);
  return { scene, mesh };
}

function clonedMaterial(mesh: THREE.Mesh): THREE.MeshStandardMaterial {
  return mesh.material as THREE.MeshStandardMaterial;
}

describe('sobrescrituras de materiales', () => {
  it('restaura los valores originales del GLB al borrar una sobrescritura', () => {
    const { scene, mesh } = sceneWithMaterial();
    const clone = cloneModelScene(scene);
    const clonedMesh = clone.children[0] as THREE.Mesh;
    const material = clonedMaterial(clonedMesh);

    applyOverridesToMaterials(clone, {
      '0:Material original': {
        color: '#00ff00',
        roughness: 0.1,
        metalness: 0.9,
        opacity: 0.4,
        visible: false,
      },
    });

    expect(material.color.getHexString()).toBe('00ff00');
    expect(material.roughness).toBe(0.1);
    expect(material.metalness).toBe(0.9);
    expect(material.opacity).toBe(0.4);
    expect(material.transparent).toBe(true);
    expect(material.visible).toBe(false);

    applyOverridesToMaterials(clone, {});

    expect(material.color.getHexString()).toBe('b04a2f');
    expect(material.roughness).toBe(0.82);
    expect(material.metalness).toBe(0.12);
    expect(material.opacity).toBe(1);
    expect(material.transparent).toBe(false);
    expect(material.visible).toBe(true);

    // El original no se modifica: cada instancia tiene su propia copia.
    expect((mesh.material as THREE.MeshStandardMaterial).color.getHexString()).toBe('b04a2f');
    expect((mesh.material as THREE.MeshStandardMaterial).roughness).toBe(0.82);
  });

  it('aplica solo las propiedades sobrescritas y conserva el resto del original', () => {
    const { scene } = sceneWithMaterial();
    const clone = cloneModelScene(scene);

    applyOverridesToMaterials(clone, { '0:Material original': { roughness: 0.25 } });

    const material = clonedMaterial(clone.children[0] as THREE.Mesh);
    expect(material.roughness).toBe(0.25);
    expect(material.color.getHexString()).toBe('b04a2f');
    expect(material.metalness).toBe(0.12);
  });

  it('tiñe los materiales de una instancia sin modificar el original', () => {
    const { scene, mesh } = sceneWithMaterial();
    const clone = cloneModelScene(scene);
    applyTintToMaterials(clone, '#00ff00', 0.5);
    const material = clonedMaterial(clone.children[0] as THREE.Mesh);
    expect(material.color.equals(new THREE.Color('#b04a2f'))).toBe(false);
    expect((mesh.material as THREE.MeshStandardMaterial).color.getHexString()).toBe('b04a2f');
  });
});
