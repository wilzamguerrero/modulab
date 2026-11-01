import type { Project } from '@/types/project';
import { apiGet, apiPost } from '@/services/api';
import { parseProject } from '@/data/projectSchema';
import { publicIdFor } from '@/utils/slug';
import { validatePolygon } from '@/utils/geometry';
import { putLocalProject } from '@/services/storage/db';

export interface PublishedDocument {
  publicId: string;
  publishedAt: string;
  version: number;
  project: Project;
}

export interface PublishCheck {
  ok: boolean;
  label: string;
  detail: string;
}

function validateProject(project: Project) {
  const spaces = project.levels
    .filter((level) => level.visible)
    .flatMap((level) => level.spaces)
    .filter((space) => space.vertices.length >= 3);
  const validations = spaces.map((space) => validatePolygon(space.vertices));
  const valid = validations.some((entry) => entry.valid);
  const area = validations.reduce((sum, entry) => sum + (entry.valid ? entry.area : 0), 0);
  const firstError = validations.find((entry) => !entry.valid)?.errors[0];
  const wallCount = project.levels.reduce(
    (sum, level) =>
      sum +
      level.spaces.reduce(
        (edgeSum, space) => edgeSum + space.edges.filter((edge) => edge.wall).length,
        0,
      ) +
      level.internalWalls.length,
    0,
  );
  return { valid, area, firstError, wallCount };
}

export function getPublishChecks(project: Project): PublishCheck[] {
  const validation = validateProject(project);
  return [
    {
      ok: project.name.trim().length > 0,
      label: 'Nombre del proyecto',
      detail: project.name.trim() ? project.name : 'Añade un nombre para compartir la experiencia.',
    },
    {
      ok: validation.valid,
      label: 'Planta válida',
      detail: validation.valid
        ? `${validation.area.toFixed(1)} m² de recinto`
        : validation.firstError || 'La planta no es válida.',
    },
    {
      ok: validation.wallCount > 0,
      label: 'Muros generados',
      detail: validation.wallCount > 0
        ? `${validation.wallCount} segmentos con muro`
        : 'Todos los segmentos están abiertos.',
    },
    {
      ok: project.objects.length > 0,
      label: 'Mobiliario colocado',
      detail: `${project.objects.length} objeto${project.objects.length === 1 ? '' : 's'} en escena`,
    },
    {
      ok: project.exhibitors.length > 0,
      label: 'Expositores',
      detail: `${project.exhibitors.length} punto${project.exhibitors.length === 1 ? '' : 's'} de interés`,
    },
  ];
}

export async function publishProject(project: Project): Promise<{ published: Project; url: string }> {
  const validation = validateProject(project);
  if (!validation.valid) {
    throw new Error(validation.firstError || 'La planta no es válida.');
  }
  if (!project.name.trim()) throw new Error('El proyecto necesita un nombre.');

  const publicId = project.published?.publicId || publicIdFor(project.name, project.id);
  const version = (project.published?.version || 0) + 1;
  const publishedAt = new Date().toISOString();
  const snapshot = structuredClone(project);
  delete (snapshot as Partial<Project>).published;

  await apiPost('/api/publish', {
    publicId,
    project: snapshot,
    notionBlockId: project.notionBlockId,
    version,
    publishedAt,
  });

  const published: Project = {
    ...project,
    published: { publicId, publishedAt, version },
    updatedAt: publishedAt,
  };
  await putLocalProject(published);
  return {
    published,
    url: `${window.location.origin}/e/${publicId}`,
  };
}

export async function fetchPublished(publicId: string): Promise<PublishedDocument> {
  const document = await apiGet<PublishedDocument>(`/api/published/${encodeURIComponent(publicId)}`);
  const project = parseProject(document.project);
  return { ...document, project };
}

export function shareUrl(publicId: string): string {
  return `${window.location.origin}/e/${publicId}`;
}

export function publicPath(publicId: string): string {
  return `/e/${publicId}`;
}
