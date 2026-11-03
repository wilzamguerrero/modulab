import { z } from 'zod';

export const notionConfigStatusSchema = z.object({
  configured: z.boolean(),
  hasToken: z.boolean(),
  parentPageId: z.string(),
  parentPageTitle: z.string().optional(),
  maskedToken: z.string().optional(),
  /** Nombre del workspace devuelto por la autorización OAuth. */
  workspaceName: z.string().optional(),
  /** «oauth» si la sesión vino de autorizar la integración; «manual» si es un token pegado. */
  authMode: z.enum(['oauth', 'manual']).optional(),
  /** El servidor tiene NOTION_CLIENT_ID/SECRET y puede iniciar el flujo OAuth. */
  oauthAvailable: z.boolean().optional(),
  error: z.string().optional(),
});

export type NotionConfigStatus = z.infer<typeof notionConfigStatusSchema>;

export interface NotionPageOption {
  id: string;
  title: string;
  url: string;
  lastEditedTime?: string;
}

export interface NotionPagesResponse {
  pages: NotionPageOption[];
}

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
