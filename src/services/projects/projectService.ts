import type { Project, ProjectSummary } from '@/types/project';
import {
  deleteLocalProject,
  getLocalProject,
  listLocalProjectSummaries,
  putLocalProject,
} from '@/services/storage/db';
import { duplicateProject, parseProject } from '@/data/projectSchema';
import { createProject } from '@/data/defaults';
import type { TemplateId } from '@/data/templates';
import { createId } from '@/utils/id';
import { apiGet, apiPost, apiPut } from '@/services/api';
import type {
  NotionProjectListItem,
  NotionProjectResponse,
  NotionProjectsResponse,
} from '@/types/notion';

export async function listProjects(): Promise<ProjectSummary[]> {
  return listLocalProjectSummaries();
}

export async function loadProject(id: string): Promise<Project | null> {
  return getLocalProject(id);
}

export async function saveProjectLocal(project: Project): Promise<void> {
  await putLocalProject(project);
}

export async function createAndSaveProject(options: {
  name: string;
  description?: string;
  event?: string;
  template?: TemplateId;
}): Promise<Project> {
  const project = createProject(options);
  await putLocalProject(project);
  return project;
}

export async function removeProject(id: string): Promise<void> {
  await deleteLocalProject(id);
}

export async function duplicateLocalProject(id: string): Promise<Project> {
  const source = await getLocalProject(id);
  if (!source) throw new Error('No se encontró el proyecto que quieres duplicar.');
  const copy = duplicateProject(source);
  await putLocalProject(copy);
  return copy;
}

export function exportProjectFile(project: Project): void {
  const blob = new Blob([JSON.stringify(project, null, 2)], { type: 'application/json' });
  const url = URL.createObjectURL(blob);
  const anchor = document.createElement('a');
  anchor.href = url;
  anchor.download = `${project.name.replace(/[^\w\-]+/g, '-').toLowerCase() || 'proyecto'}.modulab.json`;
  anchor.click();
  URL.revokeObjectURL(url);
}

export async function importProjectFile(file: File): Promise<Project> {
  const text = await file.text();
  const parsed = parseProject(JSON.parse(text));
  const imported = duplicateProject(parsed, parsed.name);
  imported.id = createId('prj');
  imported.createdAt = new Date().toISOString();
  imported.updatedAt = imported.createdAt;
  await putLocalProject(imported);
  return imported;
}

export async function listNotionProjects(): Promise<NotionProjectsResponse> {
  return apiGet<NotionProjectsResponse>('/api/notion/projects');
}

export async function loadProjectFromNotion(blockId: string): Promise<Project> {
  const response = await apiGet<NotionProjectResponse>(`/api/notion/projects/${encodeURIComponent(blockId)}`);
  if (!response.project) {
    throw new Error(
      `El bloque «${response.page.name}» no contiene todavía un proyecto de Modulab. Abre un proyecto nuevo y guárdalo en Notion para inicializarlo.`,
    );
  }
  const project = parseProject(response.project);
  if (!project.notionBlockId) project.notionBlockId = response.page.id;
  if (!project.name) project.name = response.page.name;
  await putLocalProject(project);
  return project;
}

export async function saveProjectToNotion(project: Project): Promise<Project> {
  const now = new Date().toISOString();
  if (project.notionBlockId) {
    await apiPut(`/api/notion/projects/${encodeURIComponent(project.notionBlockId)}`, {
      name: project.name,
      project,
    });
  } else {
    const response = await apiPost<{ page: NotionProjectListItem }>('/api/notion/projects', {
      name: project.name,
      project,
    });
    project.notionBlockId = response.page.id;
  }
  project.notionLastSyncedAt = now;
  await putLocalProject(project);
  return project;
}

export async function refreshProjectFromNotion(project: Project): Promise<Project> {
  if (!project.notionBlockId) throw new Error('Este proyecto no está vinculado a Notion.');
  const response = await apiGet<NotionProjectResponse>(
    `/api/notion/projects/${encodeURIComponent(project.notionBlockId)}`,
  );
  if (!response.project) throw new Error('La página de Notion no contiene datos de Modulab.');
  const remote = parseProject(response.project);
  remote.id = project.id;
  remote.notionBlockId = project.notionBlockId;
  remote.published = project.published;
  await putLocalProject(remote);
  return remote;
}

export async function archiveNotionProject(blockId: string): Promise<void> {
  await fetch(`/api/notion/projects/${encodeURIComponent(blockId)}`, { method: 'DELETE' }).then((res) => {
    if (!res.ok) throw new Error('No se pudo archivar el proyecto en Notion.');
  });
}

export async function findLocalProjectByNotionId(notionBlockId: string): Promise<Project | null> {
  const summaries = await listLocalProjectSummaries();
  const match = summaries.find((summary) => summary.notionBlockId === notionBlockId);
  return match ? getLocalProject(match.id) : null;
}
