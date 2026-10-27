import type { Exhibitor, Project, Vec2 } from '@/types/project';
import type { NotionConfigStatus, NotionExhibitorsResponse, NotionPerson } from '@/types/notion';
import { apiDelete, apiGet, apiPost } from '@/services/api';
import { defaultExhibitorCamera } from '@/data/defaults';
import { createId } from '@/utils/id';
import { distanceToSegment, pointInPolygon, polygonBounds } from '@/utils/geometry';

export function getNotionStatus(): Promise<NotionConfigStatus> {
  return apiGet<NotionConfigStatus>('/api/notion/config');
}

export function saveNotionConfig(input: {
  notionSecret?: string;
  parentPageId?: string;
}): Promise<NotionConfigStatus & { success: boolean }> {
  return apiPost('/api/notion/config', input);
}

export function clearNotionConfig(): Promise<{ success: boolean }> {
  return apiDelete('/api/notion/config');
}

export async function fetchNotionPeople(pageId: string): Promise<NotionExhibitorsResponse> {
  // refresh=1 evita la caché de 30 s del servidor: al sincronizar a mano deben
  // llegar los cambios que se acaban de hacer en Notion.
  return apiGet<NotionExhibitorsResponse>(
    `/api/notion/people?pageId=${encodeURIComponent(pageId)}&refresh=1`,
  );
}

export function notionPhotoUrl(exhibitor: Pick<Exhibitor, 'photoNotionBlockId' | 'photoUrl'>): string | undefined {
  if (exhibitor.photoNotionBlockId) {
    return `/api/notion/image/${encodeURIComponent(exhibitor.photoNotionBlockId)}`;
  }
  return exhibitor.photoUrl;
}

function isPositionFree(project: Project, point: Vec2, occupied: Vec2[]): boolean {
  const vertices = project.floor.vertices;
  if (vertices.length >= 3) {
    if (!pointInPolygon(point, vertices)) return false;
    for (let i = 0; i < vertices.length; i++) {
      const a = vertices[i];
      const b = vertices[(i + 1) % vertices.length];
      if (distanceToSegment(point, a, b) < 0.65) return false;
    }
  }
  return !occupied.some((other) => Math.hypot(other.x - point.x, other.z - point.z) < 1.15);
}

function suggestPosition(project: Project, occupied: Vec2[]): Vec2 {
  const bounds = polygonBounds(project.floor.vertices);
  const center = bounds.center;
  const step = 1.35;
  const candidates: Vec2[] = [{ ...center }];
  for (let ring = 1; ring <= 10; ring++) {
    const count = ring * 8;
    for (let i = 0; i < count; i++) {
      const angle = (i / count) * Math.PI * 2 + ring * 0.35;
      candidates.push({
        x: center.x + Math.cos(angle) * step * ring,
        z: center.z + Math.sin(angle) * step * ring,
      });
    }
  }
  const free = candidates.find((candidate) => isPositionFree(project, candidate, occupied));
  if (free) return { x: Math.round(free.x * 100) / 100, z: Math.round(free.z * 100) / 100 };
  return { x: center.x, z: center.z };
}

export interface SyncResult {
  project: Project;
  added: number;
  updated: number;
  missing: number;
  total: number;
  pageTitle?: string;
}

export async function syncPeopleIntoProject(
  project: Project,
  pageIdOverride?: string,
): Promise<SyncResult> {
  const pageId = (pageIdOverride || project.notionExhibitorsPageId || project.notionBlockId || '').trim();
  if (!pageId) {
    throw new Error(
      'Indica la página de Notion que contiene el toggle list de personas o vincula antes el proyecto a Notion.',
    );
  }
  const response = await fetchNotionPeople(pageId);
  const people = response.people;
  const existingByNotionId = new Map<string, Exhibitor>();
  for (const exhibitor of project.exhibitors) {
    if (exhibitor.notionBlockId) existingByNotionId.set(exhibitor.notionBlockId, exhibitor);
  }
  const seen = new Set<string>();
  const occupied: Vec2[] = project.exhibitors.map((exhibitor) => exhibitor.position);
  let added = 0;
  let updated = 0;

  // Solo las fichas que proceden de Notion pueden quedar «sin coincidencia».
  // Los expositores creados a mano en Modulab no dependen de Notion.
  const nextExhibitors = project.exhibitors.map((exhibitor) => ({
    ...exhibitor,
    notionMissing: Boolean(exhibitor.notionBlockId),
  }));

  for (const person of people) {
    seen.add(person.notionBlockId);
    const index = nextExhibitors.findIndex((exhibitor) => exhibitor.notionBlockId === person.notionBlockId);
    if (index >= 0) {
      const current = nextExhibitors[index];
      nextExhibitors[index] = {
        ...current,
        name: person.name || current.name,
        // Los campos se reemplazan (no se fusionan) para que borrar un dato en
        // Notion también lo borre al volver a sincronizar.
        description: person.description,
        standCode: person.standCode,
        photoNotionBlockId: person.photoNotionBlockId,
        notionUrl: person.notionUrl,
        metadata: { ...person.metadata },
        notionMissing: false,
      };
      updated++;
    } else {
      const position = suggestPosition(project, occupied);
      occupied.push(position);
      const camera = defaultExhibitorCamera(position, project.floor.vertices);
      nextExhibitors.push({
        id: createId('exp'),
        name: person.name,
        standCode: person.standCode,
        description: person.description,
        photoNotionBlockId: person.photoNotionBlockId,
        notionBlockId: person.notionBlockId,
        notionUrl: person.notionUrl,
        position,
        rotation: 0,
        cameraPosition: camera.position,
        cameraTarget: camera.target,
        relatedObjectIds: [],
        visible: true,
        metadata: person.metadata,
        notionMissing: false,
      });
      added++;
    }
  }

  const missing = nextExhibitors.filter(
    (exhibitor) => exhibitor.notionBlockId && !seen.has(exhibitor.notionBlockId),
  ).length;

  return {
    project: {
      ...project,
      exhibitors: nextExhibitors,
      notionExhibitorsPageId: pageId,
      notionExhibitorsSourceName: response.pageTitle,
      notionLastSyncedAt: new Date().toISOString(),
      updatedAt: new Date().toISOString(),
    },
    added,
    updated,
    missing,
    total: people.length,
    pageTitle: response.pageTitle,
  };
}

export function personToExhibitor(
  person: NotionPerson,
  position: Vec2,
  vertices: Vec2[] = [],
): Exhibitor {
  const camera = defaultExhibitorCamera(position, vertices);
  return {
    id: createId('exp'),
    name: person.name,
    standCode: person.standCode,
    description: person.description,
    photoNotionBlockId: person.photoNotionBlockId,
    notionBlockId: person.notionBlockId,
    notionUrl: person.notionUrl,
    position,
    rotation: 0,
    cameraPosition: camera.position,
    cameraTarget: camera.target,
    relatedObjectIds: [],
    visible: true,
    metadata: person.metadata,
    notionMissing: false,
  };
}
