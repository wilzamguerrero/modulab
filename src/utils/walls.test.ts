import { describe, expect, it } from 'vitest';
import type { WallOpening } from '@/types/project';
import { getOpeningSpans, getSolidRanges, getWallPieces, pointOffsetOnWall } from './walls';

const door: WallOpening = {
  id: 'door',
  wallId: 'wall',
  kind: 'door',
  offset: 2.5,
  width: 1,
  height: 2.1,
  sillHeight: 0,
};

const windowOpening: WallOpening = {
  id: 'window',
  wallId: 'wall',
  kind: 'window',
  offset: 2.5,
  width: 1,
  height: 1.2,
  sillHeight: 1,
};

describe('geometría de muros y aberturas', () => {
  it('proyecta un punto sobre el muro y limita el resultado', () => {
    expect(pointOffsetOnWall({ x: 2, z: 0.3 }, { x: 0, z: 0 }, { x: 5, z: 0 })).toBe(2);
    expect(pointOffsetOnWall({ x: -2, z: 0 }, { x: 0, z: 0 }, { x: 5, z: 0 })).toBe(0);
    expect(pointOffsetOnWall({ x: 9, z: 0 }, { x: 0, z: 0 }, { x: 5, z: 0 })).toBe(5);
  });

  it('calcula el tramo normalizado de una abertura', () => {
    const [span] = getOpeningSpans(5, 2.8, [door]);
    expect(span.start).toBe(2);
    expect(span.end).toBe(3);
    expect(span.center).toBe(2.5);
    expect(span.sill).toBe(0);
    expect(span.top).toBe(2.1);
  });

  it('genera piezas sólidas alrededor de una ventana', () => {
    const pieces = getWallPieces(5, 2.8, [windowOpening]);
    expect(pieces).toHaveLength(4);
    expect(pieces[0]).toEqual({ start: 0, length: 2, bottom: 0, height: 2.8 });
    expect(pieces[1]).toEqual({ start: 2, length: 1, bottom: 0, height: 1 });
    expect(pieces[2].start).toBe(2);
    expect(pieces[2].length).toBe(1);
    expect(pieces[2].bottom).toBeCloseTo(2.2);
    expect(pieces[2].height).toBeCloseTo(0.6);
    expect(pieces[3]).toEqual({ start: 3, length: 2, bottom: 0, height: 2.8 });
  });

  it('recorta aberturas solapadas para no duplicar geometría', () => {
    const first: WallOpening = { ...door, id: 'first', offset: 1.5, width: 2 };
    const second: WallOpening = { ...door, id: 'second', offset: 3, width: 2 };
    const spans = getOpeningSpans(5, 2.8, [first, second]);
    expect(spans).toHaveLength(2);
    expect(spans[0].start).toBe(0.5);
    expect(spans[0].end).toBe(2.5);
    expect(spans[1].start).toBe(2.5);
    expect(spans[1].end).toBe(4);
  });

  it('devuelve los tramos macizos entre aberturas', () => {
    expect(getSolidRanges(5, [door])).toEqual([
      { start: 0, end: 2 },
      { start: 3, end: 5 },
    ]);
  });
});
