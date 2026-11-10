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
  /**
   * Código corto con el que se identifica el objeto en la escena (por ejemplo
   * el código del stand o el del catálogo: `b1`). Es independiente del nombre y
   * se puede editar a mano.
   */
  code: z.string().default(''),
  /** Muestra el código junto al objeto en el editor y en el visor. */
  showCode: z.boolean().default(true),
  /** Muestra el nombre del objeto junto al objeto. */
  showName: z.boolean().default(false),
  source: catalogSourceSchema,
  transform: objectTransformSchema,
  overrides: z.record(materialOverrideSchema).default({}),
  visible: z.boolean().default(true),
  size: vec3Schema.optional(),
  exhibitorId: z.string().nullable().optional(),
  /** Nivel al que pertenece el objeto (su Y es relativa a la elevación). */
  levelId: z.string().nullable().optional(),
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

/** Hueco recortado en el suelo de un espacio (p. ej. para una escalera). */
export const spaceHoleSchema = z.object({
  id: z.string().min(1),
  name: z.string().default('Hueco'),
  vertices: z.array(vec2Schema).default([]),
});

/**
 * Un espacio o recinto dentro de un nivel: un contorno cerrado con su propio
 * suelo y sus muros perimetrales (`edges` va en paralelo a `vertices`).
 */
export const spaceSchema = z.object({
  id: z.string().min(1),
  name: z.string().default('Espacio'),
  vertices: z.array(vec2Schema).default([]),
  edges: z.array(edgeConfigSchema).default([]),
  holes: z.array(spaceHoleSchema).default([]),
  color: z.string().default('#b8ae9d'),
  roughness: z.number().min(0).max(1).default(0.86),
  metalness: z.number().min(0).max(1).default(0.02),
  /**
   * Espesor del forjado en metros. El suelo no es un plano: es una losa cuyo
   * cara superior coincide con la elevación del nivel y cuyo canto cuelga
   * `thickness` por debajo. Los huecos la atraviesan de lado a lado.
   */
  thickness: z.number().min(0.02).max(2).default(0.2),
  visible: z.boolean().default(true),
});

export const stairKindSchema = z.enum(['straight', 'l', 'u']);
export const stairDirectionSchema = z.enum(['up', 'down']);

/**
 * Escalera situada en un nivel. `position` es la base del primer tramo y
 * `rotation` el giro en Y (radianes). La altura total (`rise`) se reparte
 * entre `steps` escalones de huella `tread`.
 */
export const stairSchema = z.object({
  id: z.string().min(1),
  name: z.string().default('Escalera'),
  position: vec2Schema.default({ x: 0, z: 0 }),
  rotation: z.number().finite().default(0),
  kind: stairKindSchema.default('straight'),
  direction: stairDirectionSchema.default('up'),
  width: z.number().min(0.4).max(6).default(1),
  steps: z.number().int().min(2).max(80).default(16),
  rise: z.number().min(0.2).max(30).default(2.8),
  tread: z.number().min(0.1).max(1).default(0.28),
  landingDepth: z.number().min(0).max(6).default(1.1),
  railing: z.boolean().default(true),
  color: z.string().default('#c9c2b4'),
  visible: z.boolean().default(true),
});

export const levelSchema = z.object({
  id: z.string().min(1),
  name: z.string().default('Nivel'),
  /** Elevación del suelo del nivel en metros. Puede ser negativa. */
  elevation: z.number().finite().default(0),
  /**
   * Giro acumulado del piso completo, en radianes. La geometría ya está girada
   * en el espacio; este valor sirve para mostrarlo en el inspector y para poder
   * corregirlo a mano (girar «hasta» X grados en vez de «X grados más»).
   */
  rotation: z.number().finite().default(0),
  spaces: z.array(spaceSchema).default([]),
  internalWalls: z.array(internalWallSchema).default([]),
  openings: z.array(wallOpeningSchema).default([]),
  stairs: z.array(stairSchema).default([]),
  visible: z.boolean().default(true),
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

/** Tipo de acceso: entrada, salida o las dos cosas en el mismo punto. */
export const accessKindSchema = z.enum(['entrance', 'exit', 'both']);

/**
 * Bandera de entrada o salida del recinto. Es independiente del expositor:
 * marca un punto del recorrido con una etiqueta, un color y un sentido de paso.
 * Se puede duplicar para tener la entrada y la salida en sitios distintos.
 */
export const accessPointSchema = z.object({
  id: z.string().min(1),
  /** Etiqueta visible sobre la bandera (p. ej. «Entrada principal»). */
  name: z.string().default('Entrada'),
  kind: accessKindSchema.default('entrance'),
  /** Color de la bandera y de su marcador en planta. */
  color: z.string().optional(),
  position: vec2Schema.default({ x: 0, z: 0 }),
  /** Hacia dónde apunta el paso (radianes). 0° = +Z. */
  rotation: z.number().default(0),
  /** Nivel en el que se sitúa el acceso. */
  levelId: z.string().nullable().optional(),
  visible: z.boolean().default(true),
});

/** Tipo de contenido de la galería de un expositor o del evento. */
export const mediaKindSchema = z.enum(['image', 'video', 'pdf', 'file']);

/**
 * Elemento de la galería. El binario no viaja dentro del proyecto: se guarda
 * en Notion y aquí solo queda su bloque y unos metadatos para poder listarlo.
 * `url` se usa cuando el archivo vive fuera de Notion.
 */
export const mediaItemSchema = z.object({
  id: z.string().min(1),
  kind: mediaKindSchema.default('file'),
  /** Nombre visible (normalmente el nombre del archivo). */
  name: z.string().default(''),
  /** Pie de foto o descripción opcional. */
  caption: z.string().default(''),
  url: z.string().optional(),
  notionBlockId: z.string().optional(),
  mimeType: z.string().optional(),
  sizeBytes: z.number().min(0).optional(),
  createdAt: z.string().optional(),
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
  /**
   * Galería ampliada: varias imágenes, vídeos y documentos PDF. La fotografía
   * principal de arriba se conserva como portada de la ficha.
   */
  media: z.array(mediaItemSchema).optional(),
  notionBlockId: z.string().optional(),
  notionUrl: z.string().optional(),
  position: vec2Schema.default({ x: 0, z: 0 }),
  /**
   * Hacia dónde mira la cámara al llegar al stand (radianes). 0° = desde +Z.
   */
  rotation: z.number().default(0),
  /**
   * Si es true, la llegada usa exactamente ese rumbo. Si es false, la cámara
   * sigue eligiendo el ángulo más despejado (comportamiento histórico).
   */
  rotationCustom: z.boolean().optional(),
  /**
   * Valor histórico por ficha: la llegada del visor usa ahora la distancia
   * global `project.readerCameraDistance`. Se conserva para no romper los
   * proyectos ya publicados.
   */
  cameraDistance: z.number().min(1).max(12).optional(),
  /** Nivel en el que se sitúa el expositor. */
  levelId: z.string().nullable().optional(),
  cameraPosition: vec3Schema.default([4, 2, 4]),
  cameraTarget: vec3Schema.default([0, 1, 0]),
  relatedObjectIds: z.array(z.string()).default([]),
  /**
   * Si es true, mover el expositor arrastra sus elementos asociados (objetos y
   * muros asignados), como si formaran un grupo. Se desactiva cuando solo se
   * quiere reubicar el punto de interés sin tocar el montaje.
   */
  moveRelated: z.boolean().default(false),
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

/**
 * Elementos flotantes que el visitante puede encender en el visor público.
 * Cada uno arranca encendido o apagado según lo configure el expositor.
 */
export const readerVisibilitySchema = z.object({
  /** Códigos y nombres de los objetos. */
  labels: z.boolean().default(false),
  /** Nombres de los expositores sobre sus marcadores. */
  names: z.boolean().default(false),
  /** Cotas A/H/F de los objetos del expositor seleccionado. */
  measurements: z.boolean().default(false),
  /** Entorno Gaussian splat. */
  splat: z.boolean().default(false),
});

export type ReaderVisibility = z.infer<typeof readerVisibilitySchema>;

/**
 * Cómo se muestran los nombres de los expositores en el visor público.
 * `all` = todos a la vez; `selected` = al elegir un expositor se oculta el
 * nombre del resto para no tapar la escena; `always` = los nombres nunca se
 * ocultan, ni siquiera en el modo «solo el elegido».
 */
export const readerNameModeSchema = z.enum(['all', 'selected', 'always']);

/** Aspecto de la escena mientras hay un expositor elegido. */
export const readerSpotlightModeSchema = z.enum([
  /** Sin cambios: la escena conserva sus materiales. */
  'off',
  /** Solo el expositor elegido mantiene su color; el resto pasa a blanco. */
  'neutral',
  /**
   * Solo los demás expositores se tiñen con el color elegido; el edificio
   * (pisos, muros, ventanas) conserva los materiales del editor.
   */
  'tint',
  /** Solo la ficha elegida se ve; los demás expositores se ocultan. */
  'solo',
]);

export type ReaderSpotlightMode = z.infer<typeof readerSpotlightModeSchema>;

/** Encuadre al abrir el visor público: la vista activa o todo el recinto. */
export const readerEntryViewSchema = z.enum(['view', 'overview']);

export type ReaderEntryView = z.infer<typeof readerEntryViewSchema>;

export const projectSettingsSchema = z.object({
  gridSize: z.number().min(0.05).max(2).default(0.25),
  snapToGrid: z.boolean().default(true),
  showGrid: z.boolean().default(true),
  autoSaveNotion: z.boolean().default(true),
  showDimensions: z.boolean().default(true),
  /**
   * Medidas en vivo mientras se dibuja o se edita (largo de tramos, ancho de
   * muros, medidas de objetos). Asistencia de trabajo, no una cotas de
   * presentación: el visor público no las muestra.
   */
  showLiveMeasurements: z.boolean().default(true),
  shadowQuality: shadowQualitySchema.default('medium'),
  /** Aros, pintura de elementos asociados o ambas cosas. */
  exhibitorColorMode: exhibitorColorModeSchema.default('rings'),
  /** Intensidad de la pintura de elementos asociados (0–1). */
  exhibitorColorOpacity: z.number().min(0).max(1).default(0.35),
  /** Qué elementos arrancan activos en la barra del visor público. */
  readerVisibility: readerVisibilitySchema.default({}),
  /** Nombres de expositores: todos a la vez o solo el elegido. */
  readerNameMode: readerNameModeSchema.default('all'),
  /** Atmósfera al seleccionar un expositor (color del elegido vs. resto). */
  readerSpotlight: readerSpotlightModeSchema.default('off'),
  /**
   * Color al que se lleva el entorno cuando hay un expositor elegido en modo
   * `neutral` / `solo`. Blanco por defecto.
   */
  readerSpotlightColor: z
    .string()
    .regex(/^#[0-9a-f]{6}$/i)
    .default('#ffffff'),
  /**
   * Duración (segundos) del fundido del entorno hacia el color neutro al
   * elegir un expositor. 0 = cambio instantáneo.
   */
  readerSpotlightBlendSeconds: z.number().min(0).max(10).default(0.6),
  /**
   * Mantiene en el visor público los materiales del entorno tal como están en
   * el editor: piso del espacio, fondo del recinto y cristales de ventanas.
   * Con `false` se usa el fondo oscuro neutro del visor.
   */
  readerKeepEnvironment: z.boolean().default(false),
  /** Encuadre con el que abre el enlace público. */
  readerEntryView: readerEntryViewSchema.default('view'),
});

/**
 * Vista de lectura: cámara guardada en el editor para mostrarla como punto de
 * partida en el visor público. Se guarda con nombre para poder volver a ella.
 */
export const readerViewSchema = z.object({
  id: z.string().min(1),
  name: z.string().default('Vista'),
  position: vec3Schema.default([12, 10, 14]),
  target: vec3Schema.default([0, 1, 0]),
  fov: z.number().min(20).max(100).default(50),
  /**
   * Nivel al que pertenece la vista. Los expositores de ese nivel pasan por
   * aquí al viajar entre stands; sin nivel, la vista sirve a todo el proyecto.
   */
  levelId: z.string().nullable().optional(),
  createdAt: z.string().optional(),
});

export type ReaderView = z.infer<typeof readerViewSchema>;

export const projectSchema = z
  .object({
    schemaVersion: z.literal(2).default(2),
    id: z.string().min(1),
    name: z.string().min(1).default('Proyecto sin título'),
    description: z.string().default(''),
    event: z.string().default(''),
    /**
     * Imagen cuadrada del evento que se muestra junto al logo de Modulab en el
     * visor público. Se recomienda una imagen 1:1.
     */
    eventImage: mediaItemSchema.optional(),
    createdAt: z.string().default(() => new Date().toISOString()),
    updatedAt: z.string().default(() => new Date().toISOString()),
    units: z.literal('m').default('m'),
    /** Niveles del edificio. Cada nivel contiene sus espacios, muros y escaleras. */
    levels: z.array(levelSchema).default([]),
    defaultWall: defaultWallSchema.default({}),
    objects: z.array(sceneObjectSchema).default([]),
    lights: z.array(lightConfigSchema).default([]),
    exhibitors: z.array(exhibitorSchema).default([]),
    /** Banderas de entrada y salida del recinto. */
    accesses: z.array(accessPointSchema).default([]),
    camera: projectCameraSchema.default({}),
    /**
     * Vistas de lectura del editor: cada una es una cámara guardada que se
     * puede elegir para el visor público.
     */
    readerViews: z.array(readerViewSchema).default([]),
    /** Vista de lectura activa (la que abre el visor público al entrar). */
    activeReaderViewId: z.string().optional(),
    /**
     * Distancia (metros) a la que se coloca la cámara detrás del expositor al
     * llegar al stand en el visor público. Más metros = plano más abierto,
     * siempre sobre la línea de la flecha. Por defecto 3,2 m.
     */
    readerCameraDistance: z.number().min(1).max(20).default(3.2),
    /**
     * Duración (segundos) del vuelo entre stands en el visor público. Más
     * segundos = recorrido más pausado.
     */
    readerTravelSeconds: z.number().min(0.5).max(10).default(2.2),
    /**
     * Pausa (segundos) al llegar a la vista de lectura durante el viaje entre
     * stands. 0 = el viaje pasa por la vista sin detenerse (comportamiento
     * anterior); con más segundos la cámara se posa en la vista, respira un
     * momento y sigue hasta el expositor.
     */
    readerHoldSeconds: z.number().min(0).max(10).default(0),
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
export type Space = z.infer<typeof spaceSchema>;
export type SpaceHole = z.infer<typeof spaceHoleSchema>;
export type StairKind = z.infer<typeof stairKindSchema>;
export type StairDirection = z.infer<typeof stairDirectionSchema>;
export type Stair = z.infer<typeof stairSchema>;
export type Level = z.infer<typeof levelSchema>;
export type LightConfig = z.infer<typeof lightConfigSchema>;
export type AccessKind = z.infer<typeof accessKindSchema>;
export type AccessPoint = z.infer<typeof accessPointSchema>;
export type Exhibitor = z.infer<typeof exhibitorSchema>;
export type MediaKind = z.infer<typeof mediaKindSchema>;
export type MediaItem = z.infer<typeof mediaItemSchema>;
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
  | { type: 'vertex'; index: number; spaceId?: string }
  | { type: 'edge'; index: number; spaceId?: string }
  | { type: 'internalWall'; id: string }
  | { type: 'opening'; id: string }
  | { type: 'object'; id: string }
  | { type: 'light'; id: string }
  | { type: 'exhibitor'; id: string }
  | { type: 'access'; id: string }
  | { type: 'stair'; id: string }
  | { type: 'level'; id: string }
  | { type: 'space'; id: string }
  | { type: 'hole'; id: string; spaceId?: string }
  | null;

export type EditorTool =
  | 'select'
  | 'draw'
  | 'wall'
  | 'internalWall'
  | 'door'
  | 'window'
  | 'stair'
  | 'hole'
  | 'exhibitor'
  | 'access'
  | 'pan';
export type TransformMode = 'translate' | 'rotate' | 'scale';
export type EditorView = 'plan' | '3d';
export type PlanDrawMode = 'outline' | 'partition' | 'space' | 'hole';

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
