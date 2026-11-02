import { describe, expect, it } from 'vitest';
import * as THREE from 'three';
import {
  MAX_FLOOR_THICKNESS,
  MIN_FLOOR_THICKNESS,
  clampFloorThickness,
  floorSlabGeometry,
} from './floorGeometry';

const square = [
  { x: 0, z: 0 },
  { x: 4, z: 0 },
  { x: 4, z: 3 },
  { x: 0, z: 3 },
];

describe('forjado con espesor', () => {
  it('la cara superior queda en y = 0 y el canto cuelga el espesor pedido', () => {
    for (const thickness of [0.05, 0.2, 0.45]) {
      const geometry = floorSlabGeometry(square, [], thickness);
      expect(geometry).not.toBeNull();
      const box = geometry!.boundingBox!;
      expect(box.max.y).toBeCloseTo(0, 6);
      expect(box.min.y).toBeCloseTo(-thickness, 6);
      // La losa conserva la planta de origen (x = 0..4, z = 0..3).
      expect(box.min.x).toBeCloseTo(0, 6);
      expect(box.max.x).toBeCloseTo(4, 6);
      expect(box.min.z).toBeCloseTo(0, 6);
      expect(box.max.z).toBeCloseTo(3, 6);
      geometry!.dispose();
    }
  });

  it('separa las caras horizontales del canto en dos grupos de material', () => {
    const geometry = floorSlabGeometry(square, [], 0.2);
    expect(geometry).not.toBeNull();
    const groups = geometry!.groups;
    expect(groups).toHaveLength(2);
    expect(groups[0].materialIndex).toBe(0);
    expect(groups[1].materialIndex).toBe(1);
    // Ambos grupos llevan triángulos (ninguno queda vacío).
    expect(groups[0].count).toBeGreaterThan(0);
    expect(groups[1].count).toBeGreaterThan(0);
    geometry!.dispose();
  });

  it('perfora el hueco de lado a lado: el volumen se reparte en el perímetro', () => {
    const hole = [
      { x: 1, z: 1 },
      { x: 2, z: 1 },
      { x: 2, z: 2 },
      { x: 1, z: 2 },
    ];
    const solid = floorSlabGeometry(square, [], 0.3)!;
    const pierced = floorSlabGeometry(square, [hole], 0.3)!;
    // El hueco añade jambas: más caras verticales que la losa sin hueco.
    expect(pierced.groups[1].count).toBeGreaterThan(solid.groups[1].count);
    // La caja envolvente no cambia: el hueco está dentro del contorno.
    expect(pierced.boundingBox!.min.y).toBeCloseTo(solid.boundingBox!.min.y, 6);
    expect(pierced.boundingBox!.max.x).toBeCloseTo(solid.boundingBox!.max.x, 6);
    solid.dispose();
    pierced.dispose();
  });

  it('nunca genera un plano: el espesor tiene un mínimo', () => {
    const geometry = floorSlabGeometry(square, [], 0)!;
    expect(geometry).not.toBeNull();
    const height = geometry!.boundingBox!.max.y - geometry!.boundingBox!.min.y;
    expect(height).toBeCloseTo(MIN_FLOOR_THICKNESS, 6);
    geometry!.dispose();
  });

  it('acota el espesor al rango editable', () => {
    expect(clampFloorThickness(0)).toBeCloseTo(MIN_FLOOR_THICKNESS);
    expect(clampFloorThickness(-3)).toBeCloseTo(MIN_FLOOR_THICKNESS);
    expect(clampFloorThickness(99)).toBeCloseTo(MAX_FLOOR_THICKNESS);
    expect(clampFloorThickness(0.25)).toBeCloseTo(0.25);
    expect(clampFloorThickness(Number.NaN)).toBeCloseTo(0.2);
  });

  it('no genera geometría con menos de tres vértices', () => {
    expect(floorSlabGeometry([], [], 0.2)).toBeNull();
    expect(floorSlabGeometry([{ x: 0, z: 0 }, { x: 1, z: 1 }], [], 0.2)).toBeNull();
  });

  it('el canto mira hacia fuera del contorno (no queda invisible)', () => {
    const geometry = floorSlabGeometry(square, [], 0.2)!;
    const normal = geometry.getAttribute('normal');
    const position = geometry.getAttribute('position');
    const side = geometry.groups[1];
    const center = { x: 2, z: 1.5 };
    let checked = 0;
    for (let vertex = side.start; vertex < side.start + side.count; vertex += 1) {
      const nx = normal.getX(vertex);
      const nz = normal.getZ(vertex);
      // Solo las caras verticales del perímetro.
      if (Math.abs(nx) < 0.9 && Math.abs(nz) < 0.9) continue;
      const dx = position.getX(vertex) - center.x;
      const dz = position.getZ(vertex) - center.z;
      expect(nx * dx + nz * dz).toBeGreaterThan(0);
      checked += 1;
    }
    expect(checked).toBeGreaterThan(0);
    geometry.dispose();
  });

  it('las jambas del hueco miran hacia dentro del hueco', () => {
    const hole = [
      { x: 1, z: 1 },
      { x: 2, z: 1 },
      { x: 2, z: 2 },
      { x: 1, z: 2 },
    ];
    const geometry = floorSlabGeometry(square, [hole], 0.2)!;
    const normal = geometry.getAttribute('normal');
    const position = geometry.getAttribute('position');
    const side = geometry.groups[1];
    const holeCenter = { x: 1.5, z: 1.5 };
    let checked = 0;
    for (let vertex = side.start; vertex < side.start + side.count; vertex += 1) {
      const x = position.getX(vertex);
      const z = position.getZ(vertex);
      // Vértices de la jamba: sobre el borde del hueco (x = 1..2, z = 1..2).
      const onHole = x >= 1 - 1e-6 && x <= 2 + 1e-6 && z >= 1 - 1e-6 && z <= 2 + 1e-6;
      const nearEdge = Math.abs(x - 1) < 1e-6 || Math.abs(x - 2) < 1e-6
        || Math.abs(z - 1) < 1e-6 || Math.abs(z - 2) < 1e-6;
      if (!onHole || !nearEdge) continue;
      const nx = normal.getX(vertex);
      const nz = normal.getZ(vertex);
      if (Math.abs(nx) < 0.9 && Math.abs(nz) < 0.9) continue;
      // Apuntan hacia el centro del hueco (material a la espalda).
      expect(nx * (holeCenter.x - x) + nz * (holeCenter.z - z)).toBeGreaterThan(0);
      checked += 1;
    }
    expect(checked).toBeGreaterThan(0);
    geometry.dispose();
  });

  it('los huecos degenerados se ignoran sin romper el sólido', () => {
    const geometry = floorSlabGeometry(square, [[{ x: 1, z: 1 }, { x: 2, z: 2 }]], 0.2);
    expect(geometry).not.toBeNull();
    expect(geometry!.boundingBox!.max.y).toBeCloseTo(0, 6);
    geometry!.dispose();
  });

  it('el piso mira hacia arriba y el envés hacia abajo (sólido cerrado)', () => {
    const geometry = floorSlabGeometry(square, [], 0.2)!;
    const normal = geometry.getAttribute('normal');
    const position = geometry.getAttribute('position');
    const horizontal = geometry.groups[0];
    let up = 0;
    let down = 0;
    for (let vertex = horizontal.start; vertex < horizontal.start + horizontal.count; vertex += 1) {
      const ny = normal.getY(vertex);
      const y = position.getY(vertex);
      if (ny > 0.99) {
        up += 1;
        // La cara que mira hacia arriba es la que se pisa: está en y = 0.
        expect(y).toBeCloseTo(0, 6);
      }
      if (ny < -0.99) {
        down += 1;
        // El envés queda al fondo del canto.
        expect(y).toBeCloseTo(-0.2, 6);
      }
    }
    // Hay caras horizontales de los dos sentidos: no es una superficie abierta.
    expect(up).toBeGreaterThan(0);
    expect(down).toBeGreaterThan(0);
    // Y ninguna cara horizontal queda tumbada (normales laterales).
    expect(up + down).toBe(horizontal.count);
    geometry.dispose();
  });

  it('acepta la geometría en three.js sin errores de índices', () => {
    const geometry = floorSlabGeometry(square, [], 0.2)!;
    const position = geometry.getAttribute('position');
    const normal = geometry.getAttribute('normal');
    expect(position.count).toBeGreaterThan(0);
    expect(normal.count).toBe(position.count);
    // ExtrudeGeometry es no indexada: los grupos deben caber en el buffer.
    const indexed = geometry.getIndex();
    if (indexed) {
      const maxIndex = Math.max(...Array.from(indexed.array as ArrayLike<number>));
      expect(maxIndex).toBeLessThan(position.count);
    }
    for (const group of geometry.groups) {
      expect(group.start).toBeGreaterThanOrEqual(0);
      expect(group.count).toBeGreaterThan(0);
      expect((group.start + group.count) / 3).toBeLessThanOrEqual(position.count);
    }
    geometry.dispose();
  });
});