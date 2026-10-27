import { beforeEach, describe, expect, it, vi } from 'vitest';
import type { NotionPerson } from '@/types/notion';
import { createProject } from '@/data/defaults';

vi.mock('@/services/api', () => ({
  apiGet: vi.fn(),
  apiPost: vi.fn(),
  apiPut: vi.fn(),
  apiDelete: vi.fn(),
}));

import { apiGet } from '@/services/api';
import { syncPeopleIntoProject } from './notionService';

const people: NotionPerson[] = [
  {
    notionBlockId: 'person-1',
    name: 'Ana Actualizada',
    description: '',
    standCode: '',
    notionUrl: 'https://www.notion.so/person-1',
    metadata: {},
  },
  {
    notionBlockId: 'person-2',
    name: 'Nueva Persona',
    description: 'Descripción nueva',
    standCode: 'B-02',
    notionUrl: 'https://www.notion.so/person-2',
    metadata: { rol: 'Estudiante' },
  },
];

describe('sincronización de personas de Notion', () => {
  beforeEach(() => {
    vi.mocked(apiGet).mockReset();
    vi.mocked(apiGet).mockResolvedValue({
      people,
      pageId: 'page-1',
      pageTitle: 'Personas del evento',
    });
  });

  it('actualiza, añade y marca ausencias sin tocar los expositores manuales', async () => {
    const project = createProject({ name: 'Prueba', template: 'rectangle' });
    project.exhibitors = [
      {
        id: 'exp_manual',
        name: 'Expositor manual',
        standCode: 'M-01',
        description: 'No viene de Notion',
        position: { x: 1, z: 1 },
        rotation: 0,
        cameraPosition: [4, 2, 4],
        cameraTarget: [0, 1, 0],
        relatedObjectIds: [],
        visible: true,
        metadata: {},
        notionMissing: false,
      },
      {
        id: 'exp_linked',
        name: 'Ana Antigua',
        standCode: 'A-99',
        description: 'Texto que debe desaparecer',
        notionBlockId: 'person-1',
        position: { x: -1, z: -1 },
        rotation: 0,
        cameraPosition: [4, 2, 4],
        cameraTarget: [0, 1, 0],
        relatedObjectIds: [],
        visible: true,
        metadata: { rol: 'Antiguo' },
        notionMissing: false,
      },
      {
        id: 'exp_missing',
        name: 'Persona eliminada',
        standCode: 'Z-01',
        description: '',
        notionBlockId: 'person-gone',
        position: { x: 2, z: -2 },
        rotation: 0,
        cameraPosition: [4, 2, 4],
        cameraTarget: [0, 1, 0],
        relatedObjectIds: [],
        visible: true,
        metadata: {},
        notionMissing: false,
      },
    ];

    const result = await syncPeopleIntoProject(project, 'page-1');
    const byId = new Map(result.project.exhibitors.map((exhibitor) => [exhibitor.id, exhibitor]));

    expect(result.added).toBe(1);
    expect(result.updated).toBe(1);
    expect(result.missing).toBe(1);
    expect(result.total).toBe(2);

    const manual = byId.get('exp_manual');
    expect(manual?.notionMissing).toBe(false);
    expect(manual?.description).toBe('No viene de Notion');

    const linked = byId.get('exp_linked');
    expect(linked?.name).toBe('Ana Actualizada');
    expect(linked?.description).toBe('');
    expect(linked?.standCode).toBe('');
    expect(linked?.metadata).toEqual({});
    expect(linked?.notionMissing).toBe(false);

    expect(byId.get('exp_missing')?.notionMissing).toBe(true);
    expect(result.project.exhibitors.some((exhibitor) => exhibitor.name === 'Nueva Persona')).toBe(true);
  });
});
