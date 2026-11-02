import { describe, expect, it } from 'vitest';
import { clipFloorPieces, floorPiecesArea } from './floorOutline';

const square = [
  { x: 0, z: 0 },
  { x: 4, z: 0 },
  { x: 4, z: 3 },
  { x: 0, z: 3 },
];

describe('recorte real del forjado', () => {
  it('sin huecos devuelve una sola pieza intacta', () => {
    const pieces = clipFloorPieces(square);
    expect(pieces).toHaveLength(1);
    expect(pieces![0].outer).toHaveLength(4);
    expect(pieces![0].holes).toHaveLength(0);
    expect(floorPiecesArea(pieces!)).toBeCloseTo(12, 6);
  });

  it('un hueco interior se convierte en un agujero de la pieza', () => {
    const hole = [
      { x: 1, z: 1 },
      { x: 2, z: 1 },
      { x: 2, z: 2 },
      { x: 1, z: 2 },
    ];
    const pieces = clipFloorPieces(square, [hole])!;
    expect(pieces).toHaveLength(1);
    expect(pieces[0].holes).toHaveLength(1);
    // El área descontada coincide con el hueco (12 - 1).
    expect(floorPiecesArea(pieces)).toBeCloseTo(11, 6);
  });

  it('un hueco apoyado en el borde abre ese lado y no deja franja', () => {
    // Hueco que llega justo al borde x = 4: antes quedaba una tira de losa
    // tapiándolo y la losa seguía siendo un agujero interior.
    const hole = [
      { x: 2, z: 1 },
      { x: 4, z: 1 },
      { x: 4, z: 2 },
      { x: 2, z: 2 },
    ];
    const pieces = clipFloorPieces(square, [hole])!;
    expect(pieces).toHaveLength(1);
    // Ya no es un hueco interior: el contorno se mete en la muesca.
    expect(pieces[0].holes).toHaveLength(0);
    expect(pieces[0].outer.length).toBeGreaterThan(4);
    expect(floorPiecesArea(pieces)).toBeCloseTo(10, 6);
    // Ningún vértice del contorno queda en el interior de la muesca.
    const insideMuesca = pieces[0].outer.filter(
      (point) => point.x > 2.001 && point.x < 3.999 && point.z > 1.001 && point.z < 1.999,
    );
    expect(insideMuesca).toHaveLength(0);
  });

  it('un corte que cruza el forjado lo parte en dos piezas', () => {
    const cut = [
      { x: 1, z: -1 },
      { x: 2, z: -1 },
      { x: 2, z: 4 },
      { x: 1, z: 4 },
    ];
    const pieces = clipFloorPieces(square, [cut])!;
    expect(pieces).toHaveLength(2);
    expect(floorPiecesArea(pieces)).toBeCloseTo(12 - 3, 6);
  });

  it('un corte que se come todo el forjado no deja geometría', () => {
    const cut = [
      { x: -1, z: -1 },
      { x: 5, z: -1 },
      { x: 5, z: 4 },
      { x: -1, z: 4 },
    ];
    expect(clipFloorPieces(square, [cut])).toBeNull();
  });

  it('ignora huecos degenerados sin romper el contorno', () => {
    const pieces = clipFloorPieces(square, [[{ x: 1, z: 1 }, { x: 2, z: 2 }]])!;
    expect(pieces).toHaveLength(1);
    expect(floorPiecesArea(pieces)).toBeCloseTo(12, 6);
  });

  it('acepta el contorno cerrado con el primer punto repetido', () => {
    const closed = [...square, { x: 0, z: 0 }];
    const pieces = clipFloorPieces(closed)!;
    expect(pieces).toHaveLength(1);
    expect(floorPiecesArea(pieces)).toBeCloseTo(12, 6);
  });

  it('no depende del sentido de giro del contorno ni del hueco', () => {
    const reversedSquare = [...square].reverse();
    const holeCW = [
      { x: 1, z: 1 },
      { x: 2, z: 1 },
      { x: 2, z: 2 },
      { x: 1, z: 2 },
    ];
    const holeCCW = [...holeCW].reverse();
    for (const outline of [square, reversedSquare]) {
      for (const hole of [holeCW, holeCCW]) {
        const pieces = clipFloorPieces(outline, [hole])!;
        expect(floorPiecesArea(pieces)).toBeCloseTo(11, 6);
      }
    }
  });

  it('la suma de piezas coincide con el área del contorno menos los huecos', () => {
    const holes = [
      [
        { x: 1, z: 1 },
        { x: 2, z: 1 },
        { x: 2, z: 2 },
        { x: 1, z: 2 },
      ],
      [
        { x: 2.5, z: 0.5 },
        { x: 3.5, z: 0.5 },
        { x: 3.5, z: 1.5 },
        { x: 2.5, z: 1.5 },
      ],
    ];
    const pieces = clipFloorPieces(square, holes)!;
    expect(floorPiecesArea(pieces)).toBeCloseTo(12 - 1 - 1, 6);
  });
});