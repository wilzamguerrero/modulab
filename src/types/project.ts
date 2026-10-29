import { z } from 'zod';

/** Coordenadas de planta en metros. x = derecha, z = profundidad (hacia el frente). */
export const vec2Schema = z.object({
  x: z.number().finite(),
  z: z.number().finite(),
});

export const vec3Schema = z.tuple([
  z.number().finite(),
  z.number().finite(),
  z.number().finite(),
]);

export const primitiveShapeSchema = z.enum(['box', 'sphere', 'cylinder', 'cone']);

export const catalogSourceSchema = z.discriminatedUnion('type', [
  z.object({
    type: z.literal('glb'),
    url: z.string().min(1),
    file: z.string().min(1),
    name: z.string().min(1),
  }),
  z.object({
    type: z.literal('primitive'),
    shape: primitiveShapeSchema,
    name: z.string().min(1),
  }),
]);

export const materialOverrideSchema = z
  .object({
    color: z.string().optional(),
    roughness: z.number().min(0).max(1).optional(),
    metalness: z.number().min(0).max(1).optional(),
    opacity: z.number().min(0).max(1).optional(),
    visible: z.boolean().optional(),
  })
  .partial();

export const objectTransformSchema = z.object({
  position: vec3Schema,
  rotationY: z.number().finite(),
  scale: vec3Schema,
});

export const sceneObjectSchema = z.object({
  id: z.string().min(1),
  name: z.string(),
  source: catalogSourceSchema,
  transform: objectTransformSchema,
  overrides: z.record(materialOverrideSchema).default({}),
  visible: z.boolean().default(true),
  size: vec3Schema.optional(),
  exhibitorId: z.string().nullable().optional(),
  locked: z.boolean().default(false),
});

export const edgeConfigSchema = z.object({
  id: z.string().min(1),
  wall: z.boolean().default(true),
  height: z.number().min(0.05).max(20).default(2.8),
  thickness: z.number().min(0.02).max(2).default(0.14),
  color: z.string().default('#e6e0d4'),
  /** Expositor al que pertenece este muro perimetral. */
  exhibitorId: z.string().nullable().optional(),
});

export const internalWallSchema = z.object({
  id: z.string().min(1),
  a: vec2Schema,
  b: vec2Schema,
  height: z.number().min(0.05).max(20).default(2.8),
  thickness: z.number().min(0.02).max(2).default(0.14),
  color: z.string().default('#e6e0d4'),
  /** Expositor al que pertenece este muro libre. */
  exhibitorId: z.string().nullable().optional(),
});

export const openingKindSchema = z.enum(['door', 'window']);

export const wallOpeningSchema = z.object({
  id: z.string().min(1),
  /** Id del borde perimetral o del muro libre al que pertenece. */
  wallId: z.string().min(1),
  kind: openingKindSchema.default('door'),
  /** Distancia desde el inicio del muro hasta el centro de la abertura. */
  offset: z.number().min(0).default(1),
  width: z.number().min(0.2).max(20).default(0.9),
  height: z.number().min(0.2).max(20).default(2.1),
  sillHeight: z.number().min(0).max(20).default(0),
  /** Expositor al que pertenece esta puerta o ventana. */
  exhibitorId: z.string().nullable().optional(),
});

export const floorPlanSchema = z.object({
  vertices: z.array(vec2Schema).default([]),
  color: z.string().default('#b8ae9d'),
  roughness: z.number().min(0).max(1).default(0.86),
  metalness: z.number().min(0).max(1).default(0.02),
});

export const defaultWallSchema = z.object({
  height: z.number().min(0.05).max(20).default(2.8),
  thickness: z.number().min(0.02).max(2).default(0.14),
  color: z.string().default('#e6e0d4'),
});

export const lightTypeSchema = z.enum([
  'ambient',
  'hemisphere',
  'directional',
  'point',
  'spot',
]);

export const lightConfigSchema = z.object({
  id: z.string().min(1),
  type: lightTypeSchema,
  name: z.string(),
  color: z.string().default('#ffffff'),
  intensity: z.number().min(0).max(50).default(1),
  position: vec3Schema.default([0, 5, 0]),
  target: vec3Schema.default([0, 0, 0]),
  distance: z.number().min(0).optional(),
  angle: z.number().min(0.01).max(Math.PI / 2).optional(),
  penumbra: z.number().min(0).max(1).optional(),
  castShadow: z.boolean().default(false),
  enabled: z.boolean().default(true),
});

export const exhibitorSchema = z.object({
  id: z.string().min(1),
  name: z.string(),
  standCode: z.string().default(''),
  description: z.string().default(''),
  /** Color con el que se identifica el expositor en el editor y el visor. */
  color: z.string().optional(),
  photoUrl: z.string().optional(),
  photoNotionBlockId: z.string().optional(),
  notionBlockId: z.string().optional(),
  notionUrl: z.string().optional(),
  position: vec2Schema.default({ x: 0, z: 0 }),
  rotation: z.number().default(0),
  cameraPosition: vec3Schema.default([4, 2, 4]),
  cameraTarget: vec3Schema.default([0, 1, 0]),
  relatedObjectIds: z.array(z.string()).default([]),
  visible: z.boolean().default(true),
  metadata: z.record(z.string(), z.string()).default({}),
  notionMissing: z.boolean().default(false),
});

export const projectCameraSchema = z.object({
  position: vec3Schema.default([12, 10, 14]),
  target: vec3Schema.default([0, 1, 0]),
  fov: z.number().min(20).max(100).default(50),
});

export const environmentFormatSchema = z.enum(['ply', 'splat', 'ksplat']);

/**
 * Entorno de Gaussian splat usado como referencia/ambiente. Solo se guarda la
 * referencia (URL o bloque de Notion) y su transformación; el binario vive en
 * Notion o en un hosting externo.
 */
export const environmentSchema = z.object({
  url: z.string().optional(),
  /** Bloque de Notion cuando el archivo se subió a Notion. */
  blockId: z.string().optional(),
  format: environmentFormatSchema.optional(),
  visible: z.boolean().default(true),
  /** Desplazamiento en metros. */
  position: vec3Schema.default([0, 0, 0]),
  /** Rotación en grados (X, Y, Z). */
  rotation: vec3Schema.default([0, 0, 0]),
  /** Escala uniforme. */
  scale: z.number().min(0.0001).default(1),
  opacity: z.number().min(0).max(1).default(1),
});

export const publishedInfoSchema = z.object({
  publicId: z.string().min(1),
  publishedAt: z.string(),
  version: z.number().int().min(1),
});

export const shadowQualitySchema = z.enum(['low', 'medium', 'high']);
export const exhibitorColorModeSchema = z.enum(['rings', 'paint', 'both']);

export const projectSettingsSchema = z.object({
  gridSize: z.number().min(0.05).max(2).default(0.25),
  snapToGrid: z.boolean().default(true),
  showGrid: z.boolean().default(true),
  autoSaveNotion: z.boolean().default(true),
  showDimensions: z.boolean().default(true),
  shadowQuality: shadowQualitySchema.default('medium'),
  /** Aros, pintura de elementos asociados o ambas cosas. */
  exhibitorColorMode: exhibitorColorModeSchema.default('rings'),
  /** Intensidad de la pintura de elementos asociados (0–1). */
  exhibitorColorOpacity: z.number().min(0).max(1).default(0.35),
});

/**
 * Punto de rotación: posición intermedia por la que pasa la cámara al viajar
 * entre expositores (pivote de transición). Si no hay ninguno, la cámara viaja
 * directo al expositor como hasta ahora.
 */
export const rotationPointSchema = z.object({
  id: z.string().min(1),
  name: z.string().default('Punto de rotación'),
  position: vec2Schema.default({ x: 0, z: 0 }),
});

export const projectSchema = z
  .object({
    schemaVersion: z.literal(1).default(1),
    id: z.string().min(1),
    name: z.string().min(1).default('Proyecto sin título'),
    description: z.string().default(''),
    event: z.string().default(''),
    createdAt: z.string().default(() => new Date().toISOString()),
    updatedAt: z.string().default(() => new Date().toISOString()),
    units: z.literal('m').default('m'),
    floor: floorPlanSchema.default({}),
    edges: z.array(edgeConfigSchema).default([]),
    internalWalls: z.array(internalWallSchema).default([]),
    openings: z.array(wallOpeningSchema).default([]),
    defaultWall: defaultWallSchema.default({}),
    objects: z.array(sceneObjectSchema).default([]),
    lights: z.array(lightConfigSchema).default([]),
    exhibitors: z.array(exhibitorSchema).default([]),
    rotationPoints: z.array(rotationPointSchema).default([]),
    camera: projectCameraSchema.default({}),
    environment: environmentSchema.default({}),
    notionBlockId: z.string().optional(),
    notionExhibitorsPageId: z.string().optional(),
    notionExhibitorsSourceName: z.string().optional(),
    notionLastSyncedAt: z.string().optional(),
    published: publishedInfoSchema.optional(),
    settings: projectSettingsSchema.default({}),
  })
  .passthrough();

export type Vec2 = z.infer<typeof vec2Schema>;
export type Vec3 = z.infer<typeof vec3Schema>;
export type PrimitiveShape = z.infer<typeof primitiveShapeSchema>;
export type CatalogSource = z.infer<typeof catalogSourceSchema>;
export type MaterialOverride = z.infer<typeof materialOverrideSchema>;
export type SceneObject = z.infer<typeof sceneObjectSchema>;
export type EdgeConfig = z.infer<typeof edgeConfigSchema>;
export type InternalWall = z.infer<typeof internalWallSchema>;
export type OpeningKind = z.infer<typeof openingKindSchema>;
export type WallOpening = z.infer<typeof wallOpeningSchema>;
export type FloorPlan = z.infer<typeof floorPlanSchema>;
export type LightConfig = z.infer<typeof lightConfigSchema>;
export type Exhibitor = z.infer<typeof exhibitorSchema>;
export type RotationPoint = z.infer<typeof rotationPointSchema>;
export type ProjectCamera = z.infer<typeof projectCameraSchema>;
export type Environment = z.infer<typeof environmentSchema>;
export type EnvironmentFormat = z.infer<typeof environmentFormatSchema>;
export type PublishedInfo = z.infer<typeof publishedInfoSchema>;
export type ShadowQuality = z.infer<typeof shadowQualitySchema>;
export type ExhibitorColorMode = z.infer<typeof exhibitorColorModeSchema>;
export type ProjectSettings = z.infer<typeof projectSettingsSchema>;
export type Project = z.infer<typeof projectSchema>;

export interface ProjectSummary {
  id: string;
  name: string;
  description: string;
  event: string;
  updatedAt: string;
  createdAt: string;
  objectCount: number;
  exhibitorCount: number;
  vertices: Vec2[];
  notionBlockId?: string;
  published?: PublishedInfo;
  thumbnail?: string;
}

export type Selection =
  | { type: 'vertex'; index: number }
  | { type: 'edge'; index: number }
  | { type: 'internalWall'; id: string }
  | { type: 'opening'; id: string }
  | { type: 'object'; id: string }
  | { type: 'light'; id: string }
  | { type: 'exhibitor'; id: string }
  | { type: 'rotationPoint'; id: string }
  | null;

export type EditorTool =
  | 'select'
  | 'draw'
  | 'wall'
  | 'internalWall'
  | 'door'
  | 'window'
  | 'exhibitor'
  | 'rotationPoint'
  | 'pan';
export type TransformMode = 'translate' | 'rotate' | 'scale';
export type EditorView = 'plan' | '3d';
export type PlanDrawMode = 'outline' | 'partition';

export interface CatalogItem {
  id: string;
  name: string;
  category: string;
  url?: string;
  file?: string;
  kind: 'glb' | 'primitive';
  shape?: PrimitiveShape;
  sizeBytes?: number;
  modifiedAt?: string;
}

export interface ModelMaterialSlot {
  key: string;
  name: string;
  color?: string;
  roughness?: number;
  metalness?: number;
}

export interface ModelInfo {
  url: string;
  size: Vec3;
  offset: Vec3;
  materials: ModelMaterialSlot[];
}
