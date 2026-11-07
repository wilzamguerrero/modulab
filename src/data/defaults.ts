import type {
  EdgeConfig,
  InternalWall,
  Level,
  LightConfig,
  OpeningKind,
  Project,
  ProjectCamera,
  Space,
  Stair,
  Vec2,
  Vec3,
  WallOpening,
} from '@/types/project';
import { createId } from '@/utils/id';
import {
  distanceToSegment,
  pointInPolygon,
  polygonBounds,
  polygonCentroid,
} from '@/utils/geometry';
import { getTemplate, type TemplateId } from './templates';

export const DEFAULT_FLOOR_COLOR = '#b8ae9d';
export const DEFAULT_FLOOR_THICKNESS = 0.2;
export const DEFAULT_WALL_COLOR = '#e6e0d4';
export const DEFAULT_WALL_HEIGHT = 2.8;
export const DEFAULT_WALL_THICKNESS = 0.14;

export function createEdgeConfig(overrides: Partial<EdgeConfig> = {}): EdgeConfig {
  return {
    id: createId('edge'),
    wall: true,
    height: DEFAULT_WALL_HEIGHT,
    thickness: DEFAULT_WALL_THICKNESS,
    color: DEFAULT_WALL_COLOR,
    exhibitorId: null,
    ...overrides,
  };
}

export function createSpace(vertices: Vec2[], overrides: Partial<Space> = {}): Space {
  return {
    id: createId('spc'),
    name: 'Espacio',
    vertices: vertices.map((vertex) => ({ ...vertex })),
    edges: vertices.map(() => createEdgeConfig()),
    holes: [],
    color: DEFAULT_FLOOR_COLOR,
    roughness: 0.86,
    metalness: 0.02,
    thickness: DEFAULT_FLOOR_THICKNESS,
    visible: true,
    ...overrides,
  };
}

export function createLevel(
  name: string,
  elevation: number,
  overrides: Partial<Level> = {},
): Level {
  return {
    id: createId('lvl'),
    name,
    elevation,
    rotation: 0,
    spaces: [],
    internalWalls: [],
    openings: [],
    stairs: [],
    visible: true,
    ...overrides,
  };
}

export function createStair(
  position: Vec2,
  overrides: Partial<Stair> = {},
): Stair {
  return {
    id: createId('stair'),
    name: 'Escalera',
    position: { ...position },
    rotation: 0,
    kind: 'straight',
    direction: 'up',
    width: 1,
    steps: 16,
    rise: DEFAULT_WALL_HEIGHT,
    tread: 0.28,
    landingDepth: 1.1,
    railing: true,
    color: '#c9c2b4',
    visible: true,
    ...overrides,
  };
}

export function createInternalWall(
  a: Vec2,
  b: Vec2,
  overrides: Partial<InternalWall> = {},
): InternalWall {
  return {
    id: createId('wall'),
    a: { ...a },
    b: { ...b },
    height: DEFAULT_WALL_HEIGHT,
    thickness: DEFAULT_WALL_THICKNESS,
    color: DEFAULT_WALL_COLOR,
    exhibitorId: null,
    ...overrides,
  };
}

export function openingDefaults(kind: OpeningKind): Pick<WallOpening, 'width' | 'height' | 'sillHeight'> {
  return kind === 'door'
    ? { width: 0.9, height: 2.1, sillHeight: 0 }
    : { width: 1.2, height: 1.2, sillHeight: 1 };
}

export function createDefaultLights(): LightConfig[] {
  return [
    {
      id: createId('light'),
      type: 'hemisphere',
      name: 'Luz ambiental',
      color: '#ffffff',
      intensity: 0.7,
      position: [0, 8, 0],
      target: [0, 0, 0],
      castShadow: false,
      enabled: true,
    },
    {
      id: createId('light'),
      type: 'directional',
      name: 'Luz principal',
      color: '#fff4df',
      intensity: 2.1,
      position: [8, 12, 8],
      target: [0, 0, 0],
      castShadow: true,
      enabled: true,
    },
  ];
}

export function cameraForVertices(vertices: Vec2[], targetHeight = 1.2): ProjectCamera {
  const bounds = polygonBounds(vertices);
  const size = Math.max(bounds.width, bounds.depth, 8);
  return {
    position: [
      bounds.center.x + size * 0.85,
      size * 0.75,
      bounds.center.z + size * 1.05,
    ] as Vec3,
    target: [bounds.center.x, targetHeight, bounds.center.z] as Vec3,
    fov: 50,
  };
}

export function createProject(options: {
  name: string;
  description?: string;
  event?: string;
  template?: TemplateId;
}): Project {
  const template = getTemplate(options.template ?? 'rectangle');
  const vertices = template.vertices.map((vertex) => ({ ...vertex }));
  const now = new Date().toISOString();
  const camera = cameraForVertices(vertices);
  const baseLevel = createLevel('Planta baja', 0, {
    spaces: [createSpace(vertices, { name: 'Espacio 1' })],
  });
  return {
    schemaVersion: 2,
    id: createId('prj'),
    name: options.name.trim() || 'Proyecto sin título',
    description: options.description?.trim() ?? '',
    event: options.event?.trim() ?? '',
    createdAt: now,
    updatedAt: now,
    units: 'm',
    levels: [baseLevel],
    defaultWall: {
      height: DEFAULT_WALL_HEIGHT,
      thickness: DEFAULT_WALL_THICKNESS,
      color: DEFAULT_WALL_COLOR,
    },
    objects: [],
    lights: createDefaultLights(),
    exhibitors: [],
    camera,
    readerViews: [],
    environment: {
      visible: true,
      position: [0, 0, 0],
      rotation: [0, 0, 0],
      scale: 1,
      opacity: 1,
    },
    settings: {
      gridSize: 0.25,
      snapToGrid: true,
      showGrid: true,
      autoSaveNotion: true,
      showDimensions: true,
      showLiveMeasurements: true,
      shadowQuality: 'medium',
      exhibitorColorMode: 'rings',
      exhibitorColorOpacity: 0.35,
    },
  };
}

export function planCenter(
  project: Project,
  levelId?: string | null,
  spaceId?: string | null,
): Vec2 {
  const level = levelId
    ? project.levels.find((entry) => entry.id === levelId) ?? project.levels[0]
    : project.levels[0];
  const space = spaceId
    ? level?.spaces.find((entry) => entry.id === spaceId) ?? level?.spaces[0]
    : level?.spaces[0];
  if (!space || space.vertices.length === 0) return { x: 0, z: 0 };
  return polygonCentroid(space.vertices);
}

function wallClearance(point: Vec2, vertices: Vec2[]): number {
  let clearance = Number.POSITIVE_INFINITY;
  for (let index = 0; index < vertices.length; index++) {
    const a = vertices[index];
    const b = vertices[(index + 1) % vertices.length];
    clearance = Math.min(clearance, distanceToSegment(point, a, b));
  }
  return clearance;
}

/** Comprueba que el segmento cámara→punto no atraviese un patio o hueco cóncavo. */
function segmentStaysInside(a: Vec2, b: Vec2, vertices: Vec2[]): boolean {
  const steps = 18;
  for (let step = 1; step < steps; step++) {
    const t = step / steps;
    const point = {
      x: a.x + (b.x - a.x) * t,
      z: a.z + (b.z - a.z) * t,
    };
    if (!pointInPolygon(point, vertices)) return false;
  }
  return true;
}

export function isExhibitorCameraUsable(position: Vec3, vertices: Vec2[]): boolean {
  if (vertices.length < 3) return true;
  const point = { x: position[0], z: position[2] };
  if (!pointInPolygon(point, vertices)) return false;
  return wallClearance(point, vertices) >= 0.25;
}

/**
 * Busca una cámara de ficha dentro del recinto. Evita el caso habitual de una
 * cámara situada detrás de un muro en plantas cóncavas o estrechas.
 */
export function defaultExhibitorCamera(
  position: Vec2,
  vertices: Vec2[] = [],
  elevation = 0,
): { position: Vec3; target: Vec3 } {
  const target: Vec3 = [position.x, 1.15 + elevation, position.z];
  if (vertices.length < 3 || !pointInPolygon(position, vertices)) {
    // Sin planta válida (o con el marcador fuera del recinto) una vista
    // elevada evita atravesar muros y sigue mostrando el punto seleccionado.
    return {
      position: [position.x, 4.2 + elevation, position.z + 0.02],
      target: [position.x, 0.8 + elevation, position.z],
    };
  }

  // Se prueban primero las distancias largas: una cámara demasiado cerca del
  // expositor (o del mueble asociado) tapa la ficha aunque esté dentro del piso.
  for (const radius of [3.5, 2.8, 2.1, 1.5]) {
    let bestForRadius: { position: Vec2; clearance: number } | null = null;
    for (let index = 0; index < 16; index++) {
      const angle = (index / 16) * Math.PI * 2 + Math.PI / 16;
      const candidate = {
        x: position.x + Math.cos(angle) * radius,
        z: position.z + Math.sin(angle) * radius,
      };
      if (!pointInPolygon(candidate, vertices)) continue;
      if (!segmentStaysInside(position, candidate, vertices)) continue;
      const clearance = wallClearance(candidate, vertices);
      if (clearance < 0.45) continue;
      if (!bestForRadius || clearance > bestForRadius.clearance) {
        bestForRadius = { position: candidate, clearance };
      }
    }
    if (bestForRadius) {
      return {
        position: [bestForRadius.position.x, 1.9 + elevation, bestForRadius.position.z],
        target,
      };
    }
  }

  // Último recurso: vista elevada, por encima de los muros, siempre despejada.
  return {
    position: [position.x, 4.2 + elevation, position.z + 0.02],
    target: [position.x, 0.8 + elevation, position.z],
  };
}

/**
 * Desplaza el objetivo de la cámara hacia el montaje lateral del expositor.
 *
 * `sideOffsets` son las distancias (en metros, con signo) de los objetos
 * asociados respecto a la línea del rumbo: negativas a un lado, positivas al
 * otro. Así un expositor con carteles a su derecha recibe un encuadre que los
 * incluye en vez de dejarlos fuera de plano. Se limita a ±1,6 m para no perder
 * al propio expositor.
 */
function sideFocus(
  position: Vec2,
  dir: { x: number; z: number },
  sideOffsets: number[],
  depthOffsets: number[] = [],
): Vec2 {
  if (!sideOffsets.length && !depthOffsets.length) return { ...position };
  const min = sideOffsets.length ? Math.min(...sideOffsets) : 0;
  const max = sideOffsets.length ? Math.max(...sideOffsets) : 0;
  // El expositor pesa más que el montaje: a lo sumo se desplaza 1,6 m y sólo
  // cuando el montaje está realmente a un lado, no alineado con el rumbo.
  const center = Math.max(-1.6, Math.min(1.6, (min + max) / 2));
  // Perpendicular al rumbo (izquierda del expositor = −perpendicular).
  const left = { x: dir.z, z: -dir.x };
  // Sólo se avanza para incluir montaje DELANTE del expositor (lo que se ve
  // tras la flecha). Lo que está detrás (carteles, muros del stand) queda
  // entre la cámara y el expositor y no debe empujar el encuadre al fondo.
  const ahead = depthOffsets.length ? Math.max(...depthOffsets) : 0;
  const depth = Math.max(0, Math.min(1.2, ahead * 0.5));
  return {
    x: position.x + left.x * center + dir.x * depth,
    z: position.z + left.z * center + dir.z * depth,
  };
}

/**
 * Cámara de llegada de un expositor a partir de un rumbo (radianes).
 *
 * `rotation` del expositor es hacia dónde mira la cámara al llegar al stand:
 * 0° = vista frontal desde +Z, 90° = desde +X, etc. Se coloca la cámara en
 * esa dirección a la distancia pedida, sin atravesar muros; si no cabe, se
 * eleva por encima de ellos. Es el encuadre que guarda el botón «Fijar desde
 * la cámara del editor» y el que se dibuja como cono en la planta.
 */
export function exhibitorCameraFromHeading(
  position: Vec2,
  rotation: number,
  vertices: Vec2[] = [],
  elevation = 0,
  distance = 3.2,
  sideOffsets: number[] = [],
  depthOffsets: number[] = [],
): { position: Vec3; target: Vec3 } {
  const eyeHeight = 1.9 + elevation;
  // Dirección a la que mira el expositor (misma convención que la flecha de la
  // planta y que el triángulo 3D: 0° = +Z, 90° = +X).
  const dir = { x: Math.sin(rotation), z: Math.cos(rotation) };
  // Si hay montaje a los lados del expositor (carteles, mostrador), el objetivo
  // se desplaza hacia ellos para que la ficha no quede recortada.
  const focus = sideFocus(position, dir, sideOffsets, depthOffsets);
  const target: Vec3 = [focus.x, 1.15 + elevation, focus.z];
  // La cámara se pone DETRÁS del expositor, al otro lado de su espalda, y
  // mira en su misma dirección: el objetivo queda sobre el marcador (o sobre
  // el montaje que lo acompaña). Así el fondo es lo que señala la flecha.
  const lookTarget: Vec3 = [focus.x, 1.05 + elevation, focus.z];
  const inside = vertices.length < 3 || pointInPolygon(position, vertices);

  const isFree = (candidate: Vec2) =>
    vertices.length < 3 ||
    (pointInPolygon(candidate, vertices) &&
      segmentStaysInside(position, candidate, vertices) &&
      wallClearance(candidate, vertices) >= 0.4);
  // Sólo se acepta mirar desde la línea de la flecha (detrás del expositor).
  // Los laterales se prueban más cerca: sirven de último recurso cuando el
  // rumbo choca con una pared, nunca de primera opción.
  const radii = [distance, distance * 0.8, distance * 0.6, distance * 0.45, distance * 0.32];
  const behind = { x: -dir.x, z: -dir.z };
  if (inside) {
    for (const radius of radii) {
      const candidate = {
        x: position.x + behind.x * radius,
        z: position.z + behind.z * radius,
      };
      if (!isFree(candidate)) continue;
      return { position: [candidate.x, eyeHeight, candidate.z], target: lookTarget };
    }
    // La espalda del expositor queda pegada a un muro (o fuera del recinto):
    // la cámara sigue DETRÁS de él sobre la línea de la flecha y sólo gana
    // altura para ver por encima. Nunca se pasa al lateral ni al frente.
    return {
      position: [position.x + behind.x * 1.2, eyeHeight + 1.6, position.z + behind.z * 1.2],
      target: lookTarget,
    };
  }
  // Fuera del recinto o bloqueado: vista elevada detrás del expositor.
  return {
    position: [position.x - dir.x * 0.6, 4.2 + elevation, position.z - dir.z * 0.6],
    target: lookTarget,
  };
}

export const PRIMITIVE_CATALOG = [
  { shape: 'box' as const, name: 'Cubo', size: [1, 1, 1] as Vec3, color: '#d8d2c4' },
  { shape: 'sphere' as const, name: 'Esfera', size: [1, 1, 1] as Vec3, color: '#d8d2c4' },
  { shape: 'cylinder' as const, name: 'Cilindro', size: [1, 1, 1] as Vec3, color: '#d8d2c4' },
  { shape: 'cone' as const, name: 'Cono', size: [1, 1, 1] as Vec3, color: '#d8d2c4' },
];

export function primitiveSize(shape: string): Vec3 {
  switch (shape) {
    case 'sphere':
      return [1, 1, 1];
    case 'cylinder':
      return [1, 1, 1];
    case 'cone':
      return [1, 1, 1];
    default:
      return [1, 1, 1];
  }
}
