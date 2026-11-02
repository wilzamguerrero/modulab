import { describe, expect, it } from 'vitest';
import { clipFloorPieces, floorPiecesArea } from './floorOutline';

/**
 * El forjado se resta de verdad con los cortes: esta suite comprueba que un
 * corte apoyado en el borde abre ese lado (no deja una franja fina de losa) y
 * que un corte que cruza el piso lo parte en piezas. Es lo que hace que en el
 * 3D el lado del piso se vea abierto y no tapado.
 */
describe('recorte del forjado', () => {
  const square = [
    { x: 0, z: 0 },
    { x: 4, z: 0 },
    { x: 4, z: 3 },
    { x: 0, z: 3 },
  ];

  it('sin cortes devuelve una sola pieza con toda el área', () => {
    const pieces = clipFloorPieces(square);
    expect(pieces).not.toBeNull();
    expect(pieces).toHaveLength(1);
    expect(pieces?.[0].holes).toHaveLength(0);
    expect(floorPiecesArea(pieces!)).toBeCloseTo(12, 6);
  });

  it('un corte interior no abre ningún borde y deja un hueco', () => {
    const pieces = clipFloorPieces(square, [
      [
        { x: 1, z: 1 },
        { x: 2, z: 1 },
        { x: 2, z: 2 },
        { x: 1, z: 2 },
      ],
    ]);
    expect(pieces).toHaveLength(1);
    expect(pieces?.[0].holes).toHaveLength(1);
    expect(pieces?.[0].outer).toHaveLength(4);
    expect(floorPiecesArea(pieces!)).toBeCloseTo(11, 6);
  });

  it('un corte pegado al borde abre ese lado, sin huecos ni franja', () => {
    // Corte que va de x = 1 a x = 4 (el borde) y z de 1 a 2.
    const pieces = clipFloorPieces(square, [
      [
        { x: 1, z: 1 },
        { x: 4, z: 1 },
        { x: 4, z: 2 },
        { x: 1, z: 2 },
      ],
    ]);
    expect(pieces).toHaveLength(1);
    expect(pieces?.[0].holes).toHaveLength(0);
    // 12 m² del piso menos 3 m² del corte que llega hasta el borde.
    expect(floorPiecesArea(pieces!)).toBeCloseTo(9, 6);
    // Los vértices de la muesca no dejan nada dentro de esa zona en el borde.
    expect(pieces?.[0].outer.length).toBeGreaterThan(4);
  });

  it('un corte que cruza el piso lo parte en dos piezas', () => {
    const pieces = clipFloorPieces(square, [
      [
        { x: 1, z: -1 },
        { x: 2, z: -1 },
        { x: 2, z: 4 },
        { x: 1, z: 4 },
      ],
    ]);
    expect(pieces).toHaveLength(2);
    // El corte (1 m × 3 m) atraviesa el fondo entero: 12 − 3 = 9 m².
    expect(floorPiecesArea(pieces!)).toBeCloseTo(9, 6);
  });

  it('un corte que se come todo el piso devuelve null', () => {
    expect(
      clipFloorPieces(square, [
        [
          { x: -1, z: -1 },
          { x: 5, z: -1 },
          { x: 5, z: 4 },
          { x: -1, z: 4 },
        ],
      ]),
    ).toBeNull();
  });

  it('ignora cortes degenerados de menos de 3 puntos', () => {
    const pieces = clipFloorPieces(square, [
      [{ x: 1, z: 1 }],
      [
        { x: 1, z: 1 },
        { x: 2, z: 2 },
      ],
    ]);
    expect(pieces).toHaveLength(1);
    expect(floorPiecesArea(pieces!)).toBeCloseTo(12, 6);
  });
});