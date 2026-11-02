/**
 * `polygon-clipping@0.15.7` publica un bundle ESM que solo exporta por defecto
 * (`export { index as default }`), aunque sus tipos declaren las funciones como
 * exportaciones con nombre. Así, el código tipa y los tests pasan (vitest
 * resuelve el build CJS), pero el build de producción falla con
 * «"difference" is not exported by ...».
 *
 * Esta declaración refleja lo que el paquete sí exporta: el objeto completo por
 * defecto. Se importa ese objeto y se llama a `difference` sobre él.
 */
declare module 'polygon-clipping' {
  export type Pair = [number, number];
  export type Ring = Pair[];
  export type Polygon = Ring[];
  export type MultiPolygon = Polygon[];
  type Geom = Polygon | MultiPolygon;

  interface PolygonClipping {
    union(geom: Geom, ...geoms: Geom[]): MultiPolygon;
    intersection(geom: Geom, ...geoms: Geom[]): MultiPolygon;
    xor(geom: Geom, ...geoms: Geom[]): MultiPolygon;
    difference(subjectGeom: Geom, ...clipGeoms: Geom[]): MultiPolygon;
  }

  const polygonClipping: PolygonClipping;
  export default polygonClipping;
}