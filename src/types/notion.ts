import { z } from 'zod';

export const notionConfigStatusSchema = z.object({
  configured: z.boolean(),
  hasToken: z.boolean(),
  parentPageId: z.string(),
  parentPageTitle: z.string().optional(),
  maskedToken: z.string().optional(),
  error: z.string().optional(),
});

export type NotionConfigStatus = z.infer<typeof notionConfigStatusSchema>;

export interface NotionProjectListItem {
  id: string;
  name: string;
  type: 'toggle' | 'child_page';
  url: string;
  createdTime?: string;
  lastEditedTime?: string;
}

export interface NotionPerson {
  notionBlockId: string;
  name: string;
  description: string;
  standCode: string;
  photoNotionBlockId?: string;
  notionUrl: string;
  metadata: Record<string, string>;
}

export interface NotionProjectsResponse {
  projects: NotionProjectListItem[];
  parentPageId: string;
  parentPageTitle?: string;
}

export interface NotionProjectResponse {
  project: unknown | null;
  page: NotionProjectListItem;
  error?: string;
}

export interface NotionExhibitorsResponse {
  people: NotionPerson[];
  pageId: string;
  pageTitle?: string;
}
