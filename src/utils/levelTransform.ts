import type { Level, Project, SceneObject, Vec2 } from '@/types/project';

/** Centro sobre el que gira un nivel: centro del área de sus espacios. */
export interface LevelPivot {
  x: number;
  z: number;
}

function ringCentroid(vertices: Vec2[]): Vec2 {
  if (vertices.length === 0) return { x: 0, z: 0 };
  let sum = 0;
  let cx = 0;
  let cz = 0;
  for (let index = 0; index < vertices.length; index += 1) {
    const a = vertices[index];
    const b = vertices[(index + 1) % vertices.length];
    const cross = a.x * b.z - b.x * a.z;
    sum += cross;
    cx += (a.x + b.x) * cross;
    cz += (a.z + b.z) * cross;
  }
  if (Math.abs(sum) < 1e-9) {
    const total = vertices.reduce(
      (acc, vertex) => ({ x: acc.x + vertex.x, z: acc.z + vertex.z }),
      { x: 0, z: 0 },
    );
    return { x: total.x / vertices.length, z: total.z / vertices.length };
  }
  return { x: cx / (3 * sum), z: cz / (3 * sum) };
}

/**
 * Punto de giro de un nivel. Se usa el centroide ponderado por área de todos sus
 * espacios (los huecos no aportan superficie), de modo que girar un piso lo hace
 * alrededor de sí mismo y no alrededor del origen del proyecto. Si el nivel no
 * tiene espacios se cae a la media de sus elementos sueltos.
 */
export function levelPivot(level: Level): LevelPivot {
  const spaces = level.spaces.filter((space) => space.vertices.length >= 3);
  if (spaces.length) {
    let area = 0;
    let x = 0;
    let z = 0;
    for (const space of spaces) {
      const centroid = ringCentroid(space.vertices);
      let spaceArea = 0;
      for (let index = 0; index < space.vertices.length; index += 1) {
        const a = space.vertices[index];
        const b = space.vertices[(index + 1) % space.vertices.length];
        spaceArea += a.x * b.z - b.x * a.z;
      }
      spaceArea = Math.abs(spaceArea) / 2;
      area += spaceArea;
      x += centroid.x * spaceArea;
      z += centroid.z * spaceArea;
    }
    if (area > 1e-9) return { x: x / area, z: z / area };
  }
  const points = [
    ...level.spaces.flatMap((space) => space.vertices),
    ...level.internalWalls.flatMap((wall) => [wall.a, wall.b]),
    ...level.stairs.map((stair) => stair.position),
  ];
  if (!points.length) return { x: 0, z: 0 };
  return {
    x: points.reduce((total, point) => total + point.x, 0) / points.length,
    z: points.reduce((total, point) => total + point.z, 0) / points.length,
  };
}

/** Gira un punto alrededor de un pivote. `angle` en radianes, sentido de Y. */
export function rotateAround(point: Vec2, pivot: LevelPivot, angle: number): Vec2 {
  const cos = Math.cos(angle);
  const sin = Math.sin(angle);
  const dx = point.x - pivot.x;
  const dz = point.z - pivot.z;
  // Mismo convenio que la rotación en Y de three.js vista en planta.
  return {
    x: pivot.x + dx * cos + dz * sin,
    z: pivot.z - dx * sin + dz * cos,
  };
}

/** Aplica un desplazamiento y un giro (alrededor de `pivot`) a un punto. */
export function transformPoint(
  point: Vec2,
  delta: LevelPivot,
  pivot: LevelPivot,
  angle: number,
): Vec2 {
  const rotated = rotateAround(point, pivot, angle);
  return { x: rotated.x + delta.x, z: rotated.z + delta.z };
}

export interface LevelTransform {
  /** Desplazamiento en planta, en metros. */
  delta: LevelPivot;
  /** Giro en radianes alrededor de `pivot`. */
  angle: number;
  /** Pivote del giro. Normalmente `levelPivot(level)` del estado inicial. */
  pivot: LevelPivot;
}

/**
 * Mueve y gira un nivel completo: espacios (con sus muros perimetrales,
 * `edges`, que van en paralelo a los vértices), muros libres, huecos del suelo,
 * escaleras, y todo lo que está apoyado en ese piso (objetos, expositores y
 * puntos de rotación), para que al desplazar un piso se lleve su contenido.
 */
export function applyLevelTransform(
  project: Project,
  levelId: string,
  transform: LevelTransform,
): void {
  const level = project.levels.find((entry) => entry.id === levelId);
  if (!level) return;
  const { delta, angle, pivot } = transform;
  const mapPoint = (point: Vec2) => transformPoint(point, delta, pivot, angle);

  // El giro acumulado del piso se guarda para poder mostrarlo y corregirlo.
  if (Math.abs(angle) > 1e-9) {
    level.rotation = normalizeAngle((level.rotation ?? 0) + angle);
  }

  for (const space of level.spaces) {
    space.vertices = space.vertices.map(mapPoint);
    for (const hole of space.holes) {
      hole.vertices = hole.vertices.map(mapPoint);
    }
  }
  for (const wall of level.internalWalls) {
    wall.a = mapPoint(wall.a);
    wall.b = mapPoint(wall.b);
  }
  for (const stair of level.stairs) {
    stair.position = mapPoint(stair.position);
    if (Math.abs(angle) > 1e-9) {
      stair.rotation = normalizeAngle(stair.rotation + angle);
    }
  }
  for (const object of project.objects) {
    if (object.levelId !== levelId) continue;
    const [x, y, z] = object.transform.position;
    const next = mapPoint({ x, z });
    object.transform.position = [next.x, y, next.z];
    if (Math.abs(angle) > 1e-9) {
      object.transform.rotationY = normalizeAngle(object.transform.rotationY + angle);
    }
  }
  for (const exhibitor of project.exhibitors) {
    if (exhibitor.levelId !== levelId) continue;
    exhibitor.position = mapPoint(exhibitor.position);
    if (Math.abs(angle) > 1e-9) {
      exhibitor.rotation = normalizeAngle(exhibitor.rotation + angle);
      // La cámara guardada del expositor también forma parte del piso: si se
      // girara el nivel sin ella, el visor miraría hacia otro lado.
      const [px, py, pz] = exhibitor.cameraPosition;
      const [tx, ty, tz] = exhibitor.cameraTarget;
      const camera = mapPoint({ x: px, z: pz });
      const target = mapPoint({ x: tx, z: tz });
      exhibitor.cameraPosition = [camera.x, py, camera.z];
      exhibitor.cameraTarget = [target.x, ty, target.z];
    }
  }
  // Las banderas de entrada/salida pertenecen al piso: se desplazan y giran con
  // él, incluido el sentido de paso.
  for (const access of project.accesses) {
    if (access.levelId !== levelId) continue;
    access.position = mapPoint(access.position);
    if (Math.abs(angle) > 1e-9) {
      access.rotation = normalizeAngle(access.rotation + angle);
    }
  }
  // Las vistas de lectura guardan posición absoluta de cámara: al mover el
  // nivel se desplazan junto con él para no quedar flotando en otro sitio.
  for (const view of project.readerViews ?? []) {
    if (view.levelId !== levelId) continue;
    const position = mapPoint({ x: view.position[0], z: view.position[2] });
    const target = mapPoint({ x: view.target[0], z: view.target[2] });
    view.position = [position.x, view.position[1], position.z];
    view.target = [target.x, view.target[1], target.z];
  }
}

/** Deja un ángulo en (-π, π] para que el inspector no muestre 12 rad. */
export function normalizeAngle(angle: number): number {
  const twoPi = Math.PI * 2;
  let value = angle % twoPi;
  if (value <= -Math.PI) value += twoPi;
  if (value > Math.PI) value -= twoPi;
  return value;
}

/** Elementos del nivel que se mueven con él (para avisos y resúmenes). */
export function levelContents(project: Project, levelId: string): {
  spaces: number;
  walls: number;
  stairs: number;
  holes: number;
  objects: number;
  exhibitors: number;
  accesses: number;
  readerViews: number;
} {
  const level = project.levels.find((entry) => entry.id === levelId);
  const objects: SceneObject[] = project.objects.filter((object) => object.levelId === levelId);
  const exhibitors = project.exhibitors.filter((exhibitor) => exhibitor.levelId === levelId);
  const accesses = project.accesses.filter((access) => access.levelId === levelId);
  const views = (project.readerViews ?? []).filter((view) => view.levelId === levelId);
  return {
    spaces: level?.spaces.length ?? 0,
    walls: level?.internalWalls.length ?? 0,
    stairs: level?.stairs.length ?? 0,
    holes: level?.spaces.reduce((total, space) => total + space.holes.length, 0) ?? 0,
    objects: objects.length,
    exhibitors: exhibitors.length,
    accesses: accesses.length,
    readerViews: views.length,
  };
}