import type {
  EdgeConfig,
  InternalWall,
  LightConfig,
  OpeningKind,
  Project,
  ProjectCamera,
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
  const edges = vertices.map(() => createEdgeConfig());
  const now = new Date().toISOString();
  const camera = cameraForVertices(vertices);
  return {
    schemaVersion: 1,
    id: createId('prj'),
    name: options.name.trim() || 'Proyecto sin título',
    description: options.description?.trim() ?? '',
    event: options.event?.trim() ?? '',
    createdAt: now,
    updatedAt: now,
    units: 'm',
    floor: {
      vertices,
      color: DEFAULT_FLOOR_COLOR,
      roughness: 0.86,
      metalness: 0.02,
    },
    edges,
    internalWalls: [],
    openings: [],
    defaultWall: {
      height: DEFAULT_WALL_HEIGHT,
      thickness: DEFAULT_WALL_THICKNESS,
      color: DEFAULT_WALL_COLOR,
    },
    objects: [],
    lights: createDefaultLights(),
    exhibitors: [],
    camera,
    settings: {
      gridSize: 0.25,
      snapToGrid: true,
      showGrid: true,
      autoSaveNotion: true,
      showDimensions: true,
      shadowQuality: 'medium',
    },
  };
}

export function planCenter(project: Project): Vec2 {
  if (project.floor.vertices.length === 0) return { x: 0, z: 0 };
  return polygonCentroid(project.floor.vertices);
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
): { position: Vec3; target: Vec3 } {
  const target: Vec3 = [position.x, 1.15, position.z];
  if (vertices.length < 3 || !pointInPolygon(position, vertices)) {
    // Sin planta válida (o con el marcador fuera del recinto) una vista
    // elevada evita atravesar muros y sigue mostrando el punto seleccionado.
    return {
      position: [position.x, 4.2, position.z + 0.02],
      target: [position.x, 0.8, position.z],
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
        position: [bestForRadius.position.x, 1.9, bestForRadius.position.z],
        target,
      };
    }
  }

  // Último recurso: vista elevada, por encima de los muros, siempre despejada.
  return {
    position: [position.x, 4.2, position.z + 0.02],
    target: [position.x, 0.8, position.z],
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
