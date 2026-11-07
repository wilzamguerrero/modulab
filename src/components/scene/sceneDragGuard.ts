/**
 * Evita que el clic de fin de arrastre (gizmo o tiradores) se propague al piso
 * y deseleccione el elemento. R3F entrega el clic a todos los objetos
 * intersectados bajo el puntero, incluido el piso detrás del gizmo.
 */
import * as THREE from 'three';

let active = false;
let releasedAt = 0;
/**
 * Arrastre que de verdad movió la pieza. Un simple clic sobre un objeto ya
 * seleccionado también dispara `dragging-changed` al soltarse; ese clic debe
 * llegar al elemento (seleccionar / ver propiedades), no al piso.
 */
let draggedSincePress = false;

export function markScenePress(): void {
  draggedSincePress = false;
}

export function markSceneDragActive(): void {
  active = true;
  draggedSincePress = true;
  clickHadDrag = true;
}

/**
 * `clean` = el gesto terminó sin mover nada (clic): se suelta el candado y el
 * clic sigue su curso normal.
 */
export function markSceneDragEnd(clean = false): void {
  active = false;
  releasedAt = typeof performance !== 'undefined' ? performance.now() : Date.now();
  if (clean) draggedSincePress = false;
}

export function isSceneDragClickBlocked(windowMs = 300): boolean {
  if (active) return true;
  if (!draggedSincePress) return false;
  const now = typeof performance !== 'undefined' ? performance.now() : Date.now();
  return now - releasedAt < windowMs;
}

/**
 * Selección de un solo clic, a nivel de lienzo.
 *
 * R3F entrega `onClick` a todos los objetos bajo el cursor (el piso incluye),
 * y el orden depende del `renderOrder`: por eso a veces el clic seleccionaba
 * el elemento y a veces el piso lo soltaba. Con esto el clic elige el elemento
 * más cercano a la cámara por delante de todo lo demás, y un clic que empezó
 * en un gizmo no selecciona nada.
 */
let clickHadDrag = false;
let pressStartedOnGizmo = false;
/** ¿La selección ya se resolvió con esta pulsación? */
let clickResolved = false;
let lastClickHandled = -1;

function now(): number {
  return typeof performance !== 'undefined' ? performance.now() : Date.now();
}

export function notifyScenePointerDown(): void {
  pressStartedOnGizmo = false;
  clickHadDrag = false;
  clickResolved = false;
}

export function notifyGizmoPointerDown(): void {
  // Cualquier pulsación sobre un gizmo (manipulador o tirador) marca el clic.
  pressStartedOnGizmo = true;
}

export function notifySceneDragMoved(): void {
  clickHadDrag = true;
}

export function notifySceneClickHandled(): void {
  lastClickHandled = now();
  clickResolved = true;
}

/** Un elemento acaba de quedar seleccionado con este clic. */
export const markSceneClickHandled = notifySceneClickHandled;

/**
 * ¿Un clic acaba de cambiar la selección? Lo usan los objetos que también
 * reciben el mismo clic (forjado, muros) para no pisar la selección nueva.
 */
export function selectionJustChanged(windowMs = 150): boolean {
  return lastClickHandled >= 0 && now() - lastClickHandled < windowMs;
}

/**
 * Manija pulsada (flecha de rumbo o aro de un expositor). Se recuerda aquí
 * porque la selección la resuelve el lienzo con su propio rayo, que no ve las
 * manijas.
 */
let pressedHandle: string | null = null;

export function notifyHandlePointerDown(id: string): void {
  pressedHandle = id;
}

export function getPressedHandle(): string | null {
  return pressedHandle;
}

export function clearPressedHandle(): void {
  pressedHandle = null;
}

export function clickStartedOnGizmo(): boolean {
  return pressStartedOnGizmo;
}

/**
 * ¿Este `onClick` de elemento debe usarse para seleccionar? Solo el primero del
 * gesto; los demás se ignoran para que un clic no encadene varias selecciones.
 */
export function shouldHandleElementClick(): boolean {
  if (pressStartedOnGizmo || clickHadDrag || clickResolved) return false;
  notifySceneClickHandled();
  return true;
}

/** El clic sobre el vacío/piso solo deselecciona si nadie más lo usó ni hubo arrastre. */
export function shouldHandleBackgroundClick(): boolean {
  if (pressStartedOnGizmo || clickHadDrag) return true;
  return now() - lastClickHandled >= 60;
}

/**
 * Detección de elementos para el clic: se lanza desde el propio lienzo al
 * soltar un clic sin arrastre. Así el clic no depende del orden en que R3F
 * reparte `onClick` entre el piso y las piezas: gana siempre el marcador más
 * cercano a la cámara que caiga bajo el cursor.
 */
type ClickCandidate = { id: string; point: THREE.Vector3 };

let clickCandidates: ClickCandidate[] | null = null;
const pickRaycaster = new THREE.Raycaster();
const pickSphere = new THREE.Sphere();
const pickPlane = new THREE.Plane();
const pickWorld = new THREE.Vector3();

export function setClickCandidates(candidates: ClickCandidate[] | null): void {
  clickCandidates = candidates;
}

/** Elemento bajo el puntero en el contexto de R3F (usa la cámara real). */
export function elementPickUnder(event: { ray?: THREE.Ray; camera: THREE.Camera }): string | null {
  if (!event.ray) return null;
  return pickAlongRay(event.ray, event.camera);
}

/** Devuelve el id del elemento bajo el cursor, o null si el clic dio al vacío. */
export function pickElementAt(
  clientX: number,
  clientY: number,
  domElement: HTMLElement,
  camera: THREE.Camera,
): string | null {
  if (!clickCandidates || !clickCandidates.length) return null;
  const rect = domElement.getBoundingClientRect();
  if (rect.width <= 0 || rect.height <= 0) return null;
  const ndc = new THREE.Vector2(
    ((clientX - rect.left) / rect.width) * 2 - 1,
    -((clientY - rect.top) / rect.height) * 2 + 1,
  );
  pickRaycaster.setFromCamera(ndc, camera);
  return pickAlongRay(pickRaycaster.ray, camera);
}

function pickAlongRay(ray: THREE.Ray, camera: THREE.Camera): string | null {
  if (!clickCandidates || !clickCandidates.length) return null;

  // Cada elemento es una esfera de agarre a la altura del suelo del nivel del
  // cursor: se corta el rayo con ese plano para que una vista en planta a ras
  // de suelo siga funcionando aunque el marcador esté ligeramente elevado.
  let best: { id: string; distance: number } | null = null;
  for (const candidate of clickCandidates) {
    const world = pickWorld.copy(candidate.point);
    const radius = 0.5;
    pickSphere.set(world, radius);
    if (!ray.intersectsSphere(pickSphere)) continue;
    pickPlane.setFromNormalAndCoplanarPoint(new THREE.Vector3(0, 1, 0), world);
    const hit = new THREE.Vector3();
    if (ray.intersectPlane(pickPlane, hit) && hit.distanceTo(world) > radius) continue;
    const distance = camera.position.distanceTo(world);
    if (!best || distance < best.distance) best = { id: candidate.id, distance };
  }
  return best?.id ?? null;
}
