/**
 * Typed calls to the knowledge service (`/api/knowledge/v1`), the system of record for the knowledge
 * base, the lifestyle tracker and the project catalogue with its wiki. Record IDs are chosen here, so a
 * retried create never makes a second record; every write names one record (or one column or section to
 * reorder) and carries an Idempotency-Key. Positions are worked out by the service from what it stores.
 */
import type { z } from 'zod';
import { KNOWLEDGE_BACKEND_URL } from '../../config';
import type {
  KnowledgeEntry,
  KnowledgeTopic,
  LifestyleItem,
  LifestyleType,
  Project,
  ProjectCatalogueSection,
  ProjectPage,
  ProjectStatus,
} from '../../types/domain';
import { newWriteKey } from './idempotencyKeys';
import {
  knowledgeEntrySchema,
  knowledgeSchema,
  knowledgeTopicSchema,
  lifestyleItemSchema,
  lifestyleSchema,
  projectCatalogueSchema,
  projectPageSchema,
  type ServiceKnowledge,
  type ServiceProjectCatalogue,
} from './knowledgeContracts';
import { callService } from './serviceClient';

const BASE = '/api/knowledge/v1';

export function isKnowledgeServiceEnabled(): boolean {
  return Boolean(KNOWLEDGE_BACKEND_URL.trim());
}

function path(...segments: string[]): string {
  return `${BASE}/${segments.map(segment => encodeURIComponent(segment)).join('/')}`;
}

function write<T>(method: 'POST' | 'PUT' | 'DELETE', to: string, schema: z.ZodType<T> | null,
  body?: unknown): Promise<T> {
  return callService<T>(KNOWLEDGE_BACKEND_URL, method, to, schema, body, { idempotencyKey: newWriteKey() });
}

/** Optional values the app keeps as `undefined` are sent as JSON null (absent). */
function withoutUndefined<T extends object>(value: T): T {
  return JSON.parse(JSON.stringify(value)) as T;
}

// ── Knowledge base ──

export type TopicInput = Omit<KnowledgeTopic, 'id' | 'sortOrder' | 'createdAt' | 'updatedAt'> & { sortOrder?: number };
export type EntryInput = Omit<KnowledgeEntry, 'id' | 'createdAt' | 'updatedAt'>;

export function getKnowledge(): Promise<ServiceKnowledge> {
  return callService(KNOWLEDGE_BACKEND_URL, 'GET', `${BASE}/knowledge`, knowledgeSchema);
}

export function saveKnowledgeTopic(id: string, topic: TopicInput): Promise<KnowledgeTopic> {
  return write('PUT', path('knowledge', 'topics', id), knowledgeTopicSchema, withoutUndefined(topic));
}

/** Deletes the topic and every entry in it. */
export function deleteKnowledgeTopic(id: string): Promise<void> {
  return write('DELETE', path('knowledge', 'topics', id), null);
}

export function saveKnowledgeEntry(id: string, entry: EntryInput): Promise<KnowledgeEntry> {
  return write('PUT', path('knowledge', 'entries', id), knowledgeEntrySchema, withoutUndefined(entry));
}

export function deleteKnowledgeEntry(id: string): Promise<void> {
  return write('DELETE', path('knowledge', 'entries', id), null);
}

// ── Lifestyle ──

export type LifestyleItemInput = Pick<LifestyleItem, 'type' | 'title' | 'notes' | 'status'> & { sources: string[] };

export async function getLifestyleItems(): Promise<LifestyleItem[]> {
  return (await callService(KNOWLEDGE_BACKEND_URL, 'GET', `${BASE}/lifestyle`, lifestyleSchema)).items;
}

/** Creates the item at the end of its column, or replaces it (a changed type moves it to the end of the new one). */
export function saveLifestyleItem(id: string, item: LifestyleItemInput): Promise<LifestyleItem> {
  return write('PUT', path('lifestyle', 'items', id), lifestyleItemSchema, item);
}

/** Moves an item into a column at a position (the end when absent); returns every item. */
export async function moveLifestyleItem(id: string, type: LifestyleType, position?: number): Promise<LifestyleItem[]> {
  return (await write('POST', `${path('lifestyle', 'items', id)}/move`, lifestyleSchema,
    withoutUndefined({ type, position }))).items;
}

/** Puts a column in this order; the IDs must be exactly the column's items. Returns every item. */
export async function reorderLifestyleColumn(type: LifestyleType, ids: string[]): Promise<LifestyleItem[]> {
  return (await write('POST', `${BASE}/lifestyle/order`, lifestyleSchema, { type, ids })).items;
}

export function deleteLifestyleItem(id: string): Promise<void> {
  return write('DELETE', path('lifestyle', 'items', id), null);
}

// ── Projects ──

export type NewProjectInput = Omit<Project, 'id' | 'createdAt' | 'updatedAt' | 'sortOrder' | 'statusBeforeArchive'>;
export type ProjectReferenceInput = Pick<Project,
  'name' | 'summary' | 'kind' | 'links' | 'setupSteps' | 'runRecipes' | 'preview' | 'verifiedAt' | 'tags'>;
export type ProjectPageInput = Pick<ProjectPage, 'projectId' | 'title' | 'content' | 'isOverview'>;

export function getProjectCatalogue(): Promise<ServiceProjectCatalogue> {
  return callService(KNOWLEDGE_BACKEND_URL, 'GET', `${BASE}/projects`, projectCatalogueSchema);
}

/** Adds a project at the end of its section with its overview page; returns the whole catalogue. */
export function createProject(id: string, overviewPageId: string, project: NewProjectInput): Promise<ServiceProjectCatalogue> {
  return write('POST', `${BASE}/projects`, projectCatalogueSchema, withoutUndefined({ ...project, id, overviewPageId }));
}

export function updateProjectReference(id: string, reference: ProjectReferenceInput): Promise<ServiceProjectCatalogue> {
  return write('PUT', `${path('projects', id)}/reference`, projectCatalogueSchema, withoutUndefined(reference));
}

export function setProjectStatus(id: string, status: ProjectStatus): Promise<ServiceProjectCatalogue> {
  return write('PUT', `${path('projects', id)}/status`, projectCatalogueSchema, { status });
}

export function setProjectPinned(id: string, pinned: boolean): Promise<ServiceProjectCatalogue> {
  return write('PUT', `${path('projects', id)}/pinned`, projectCatalogueSchema, { pinned });
}

export function setProjectArchived(id: string, archived: boolean): Promise<ServiceProjectCatalogue> {
  return write('PUT', `${path('projects', id)}/archived`, projectCatalogueSchema, { archived });
}

/** Puts a catalogue section in this order; the IDs must be exactly the section's projects. */
export function reorderProjects(section: ProjectCatalogueSection, ids: string[]): Promise<ServiceProjectCatalogue> {
  return write('POST', `${BASE}/projects/order`, projectCatalogueSchema, { section, ids });
}

/** Deletes one project with its wiki pages. */
export function deleteProject(id: string): Promise<ServiceProjectCatalogue> {
  return write('DELETE', `${path('projects', id)}?confirm=true`, projectCatalogueSchema);
}

export function saveProjectPage(id: string, page: ProjectPageInput): Promise<ProjectPage> {
  return write('PUT', path('projects', 'pages', id), projectPageSchema, page);
}

/** Deletes a wiki page; a project's overview page cannot be deleted. */
export function deleteProjectPage(id: string): Promise<void> {
  return write('DELETE', path('projects', 'pages', id), null);
}
