/**
 * A stateful stand-in for the knowledge service (knowledge base, lifestyle tracker, projects and wiki).
 * It keeps records in the service's JSON shapes and answers through the app's contract schemas, so it
 * cannot drift from contracts/knowledge-service. Writes are one record each (or one column or section
 * to reorder), like the real service; the shared write path in fake-services.ts applies the
 * Idempotency-Key rules.
 */
import type { Route } from '@playwright/test';
import type { z } from 'zod';
import type {
  KnowledgeEntry,
  KnowledgeTopic,
  LifestyleItem,
  Project,
  ProjectPage,
} from '../../src/types/domain';
import { apiErrorSchema } from '../../src/services/backend/contracts';
import {
  knowledgeEntrySchema,
  knowledgeSchema,
  knowledgeTopicSchema,
  lifestyleItemSchema,
  lifestyleSchema,
  projectCatalogueSchema,
  projectMatchesSchema,
  projectPageSchema,
} from '../../src/services/backend/knowledgeContracts';

type Json = Record<string, unknown>;

/** Scenario records in the app's shapes; the fake stores them in the service's shapes. */
export interface FakeKnowledgeSeed {
  knowledgeTopics?: Partial<KnowledgeTopic>[];
  knowledgeEntries?: Partial<KnowledgeEntry>[];
  lifestyleItems?: Partial<LifestyleItem>[];
  projects?: Partial<Project>[];
  projectPages?: Partial<ProjectPage>[];
}

export interface FakeKnowledge {
  topics: Json[];
  entries: Json[];
  items: Json[];
  projects: Json[];
  pages: Json[];
}

const SEEDED_AT = '2026-08-01T12:00:00.000Z';
const PRACTICE_TYPES = ['wajib-both', 'wajib-women', 'wajib-men', 'halal'];
const DEFAULT_PREVIEW = { icon: 'folder', accentColor: '#7c6cff', backgroundColor: '#171827', coverImageUrl: null };
const SECTIONS = ['pinned', 'projects', 'archived'] as const;

function section(project: Json): string {
  if (project.status === 'archived') return 'archived';
  return project.isPinned ? 'pinned' : 'projects';
}

function byPosition(left: Json, right: Json): number {
  return Number(left.sortOrder ?? Number.MAX_SAFE_INTEGER) - Number(right.sortOrder ?? Number.MAX_SAFE_INTEGER)
    || String(left.name ?? '').localeCompare(String(right.name ?? ''));
}

function inSection(projects: Json[], name: string): Json[] {
  return projects.filter(project => section(project) === name).sort(byPosition);
}

function renumber(records: Json[], at: string): void {
  records.forEach((record, index) => {
    if (record.sortOrder !== index) Object.assign(record, { sortOrder: index, updatedAt: at });
  });
}

function catalogueOrder(projects: Json[]): Json[] {
  return SECTIONS.flatMap(name => inSection(projects, name));
}

function nulls(record: Json, fields: string[]): Json {
  return { ...Object.fromEntries(fields.map(field => [field, null])),
    ...Object.fromEntries(Object.entries(record).filter(([, value]) => value !== undefined)) };
}

function source(value: Json): Json {
  return nulls(value, ['surah', 'ayahStart', 'ayahEnd', 'collection', 'hadithNumber', 'author', 'title', 'url']);
}

function project(value: Json, index: number): Json {
  const id = String(value.id ?? `project-${index + 1}`);
  const status = String(value.status ?? 'active');
  return {
    id,
    catalogKey: value.catalogKey || `custom:${id}`,
    name: value.name || `Project ${index + 1}`,
    kind: value.kind ?? 'other',
    links: value.links ?? [],
    setupSteps: ((value.setupSteps as Json[] | undefined) ?? []).map(step => nulls(step, ['displayCode'])),
    runRecipes: ((value.runRecipes as Json[] | undefined) ?? []).map(recipe => nulls({ args: [], mode: 'one_shot', ...recipe },
      ['workingDirectory', 'environment', 'localUrl', 'prerequisites'])),
    preview: { ...DEFAULT_PREVIEW, ...(value.preview as Json | undefined) },
    verifiedAt: value.verifiedAt ?? null,
    summary: value.summary ?? '',
    status,
    statusBeforeArchive: status === 'archived' ? value.statusBeforeArchive ?? null : null,
    tags: value.tags ?? [],
    isPinned: status !== 'archived' && value.isPinned === true,
    sortOrder: value.sortOrder ?? null,
    createdAt: value.createdAt ?? SEEDED_AT,
    updatedAt: value.updatedAt ?? SEEDED_AT,
  };
}

function page(value: Json): Json {
  return {
    title: 'Untitled Page', content: '', isOverview: false, createdAt: SEEDED_AT, updatedAt: SEEDED_AT,
    ...Object.fromEntries(Object.entries(value).filter(([, field]) => field !== undefined)),
  };
}

function overviewFor(projectRecord: Json, id: string): Json {
  return page({ id, projectId: projectRecord.id, title: 'Overview', content: `# ${projectRecord.name}`, isOverview: true,
    createdAt: projectRecord.createdAt, updatedAt: projectRecord.updatedAt });
}

export function createFakeKnowledge(seed: FakeKnowledgeSeed = {}): FakeKnowledge {
  const topics = (seed.knowledgeTopics ?? []).map((topic, index) => ({
    description: '', icon: '', color: '', sortOrder: index, createdAt: SEEDED_AT, updatedAt: SEEDED_AT, ...topic,
  })) as Json[];
  const entries = (seed.knowledgeEntries ?? []).map(entry => ({
    content: '', tags: [], createdAt: SEEDED_AT, updatedAt: SEEDED_AT, ...entry,
    sources: ((entry.sources ?? []) as unknown as Json[]).map(source),
  })) as Json[];
  const items = (seed.lifestyleItems ?? []).map((item, index) => ({
    notes: '', sortOrder: index, createdAt: SEEDED_AT, updatedAt: SEEDED_AT, ...item, sources: item.sources ?? [],
  })) as Json[];
  const projects = (seed.projects ?? []).map((value, index) => project(value as Json, index));
  for (const name of SECTIONS) renumber(inSection(projects, name), SEEDED_AT);
  const pages = (seed.projectPages ?? []).map(value => page(value as Json));
  for (const record of projects) {
    if (!pages.some(candidate => candidate.projectId === record.id && candidate.isOverview)) {
      pages.push(overviewFor(record, `${record.id}-overview`));
    }
  }
  return { topics, entries, items, projects, pages };
}

async function reply(route: Route, status: number, body: unknown, schema?: z.ZodType): Promise<void> {
  if (schema) schema.parse(body);
  await route.fulfill({ status, contentType: 'application/json', body: JSON.stringify(body) });
}

function upsert(records: Json[], record: Json): Json {
  const index = records.findIndex(existing => existing.id === record.id);
  if (index >= 0) records[index] = record;
  else records.push(record);
  return record;
}

function catalogue(knowledge: FakeKnowledge) {
  return { projects: catalogueOrder(knowledge.projects), pages: knowledge.pages };
}

export async function handleKnowledge(route: Route, knowledge: FakeKnowledge, method: string, path: string, url: URL,
  body: Json | null, now: Date): Promise<void> {
  const at = now.toISOString();
  const [domain, kind, id, action] = path.replace('/api/knowledge/v1/', '').split('/').map(decodeURIComponent);
  const notFound = () => reply(route, 404, { code: 'not_found', message: 'No such record.' }, apiErrorSchema);
  const conflict = (code: string) => reply(route, 409, { code, message: 'The list changed; reload.' }, apiErrorSchema);
  const stamped = (existing: Json | undefined, record: Json) => ({ ...record, createdAt: existing?.createdAt ?? at,
    updatedAt: at });

  if (domain === 'knowledge') {
    if (method === 'GET') return reply(route, 200, { topics: knowledge.topics, entries: knowledge.entries }, knowledgeSchema);
    const records = kind === 'topics' ? knowledge.topics : knowledge.entries;
    const existing = records.find(record => record.id === id);
    if (method === 'DELETE') {
      if (!existing) return notFound();
      if (kind === 'topics') knowledge.entries = knowledge.entries.filter(entry => entry.topicId !== id);
      records.splice(records.indexOf(existing), 1);
      return route.fulfill({ status: 204 });
    }
    if (kind === 'topics') {
      const sortOrder = body?.sortOrder ?? existing?.sortOrder ?? knowledge.topics.length;
      return reply(route, 200, upsert(records, stamped(existing, { ...body, id, sortOrder })), knowledgeTopicSchema);
    }
    if (!knowledge.topics.some(topic => topic.id === body?.topicId)) return notFound();
    const sources = ((body?.sources as Json[] | undefined) ?? []).map(source);
    return reply(route, 200, upsert(records, stamped(existing, { ...body, id, sources })), knowledgeEntrySchema);
  }

  if (domain === 'lifestyle') {
    const items = () => ({ items: [...knowledge.items].sort(byPosition) });
    const column = (type: unknown) => knowledge.items.filter(item => item.type === type).sort(byPosition);
    if (method === 'GET') return reply(route, 200, items(), lifestyleSchema);
    if (kind === 'order') {
      const current = column(body?.type).map(item => item.id);
      const ids = (body?.ids as string[] | undefined) ?? [];
      if (ids.length !== current.length || ids.some(itemId => !current.includes(itemId))) return conflict('lifestyle_order_changed');
      renumber(ids.map(itemId => knowledge.items.find(item => item.id === itemId)!), at);
      return reply(route, 200, items(), lifestyleSchema);
    }
    const existing = knowledge.items.find(item => item.id === id);
    if (method === 'DELETE') {
      if (!existing) return notFound();
      knowledge.items.splice(knowledge.items.indexOf(existing), 1);
      return route.fulfill({ status: 204 });
    }
    if (action === 'move') {
      if (!existing) return notFound();
      const fromType = existing.type;
      const samePractice = PRACTICE_TYPES.includes(String(fromType)) === PRACTICE_TYPES.includes(String(body?.type));
      Object.assign(existing, { type: body?.type, updatedAt: at,
        status: samePractice ? existing.status : PRACTICE_TYPES.includes(String(body?.type)) ? 'want-to-start' : 'struggling' });
      const target = column(body?.type).filter(item => item !== existing);
      target.splice(Math.min(Number(body?.position ?? target.length), target.length), 0, existing);
      renumber(target, at);
      renumber(column(fromType), at);
      return reply(route, 200, items(), lifestyleSchema);
    }
    const moved = !existing || existing.type !== body?.type;
    const sortOrder = moved ? column(body?.type).filter(item => item.id !== id).length : existing.sortOrder;
    const saved = upsert(knowledge.items, stamped(existing, { ...body, id, sortOrder }));
    if (existing && moved) renumber(column(existing.type), at);
    return reply(route, 200, saved, lifestyleItemSchema);
  }

  if (domain === 'projects') {
    if (method === 'GET' && kind === 'resolve') {
      const query = (url.searchParams.get('query') ?? '').toLowerCase();
      const matches = knowledge.projects.filter(record => String(record.name).toLowerCase().includes(query))
        .map(record => ({ id: record.id, catalogKey: record.catalogKey, name: record.name }));
      return reply(route, 200, { projects: matches }, projectMatchesSchema);
    }
    if (method === 'GET') return reply(route, 200, catalogue(knowledge), projectCatalogueSchema);
    if (kind === 'pages') {
      const existing = knowledge.pages.find(record => record.id === id);
      if (method === 'DELETE') {
        if (!existing) return notFound();
        if (existing.isOverview) return conflict('overview_page_required');
        knowledge.pages.splice(knowledge.pages.indexOf(existing), 1);
        return route.fulfill({ status: 204 });
      }
      if (body?.isOverview) {
        knowledge.pages.filter(record => record.projectId === body.projectId && record.id !== id)
          .forEach(record => Object.assign(record, { isOverview: false }));
      }
      const title = String(body?.title ?? '').trim() || 'Untitled Page';
      return reply(route, 200, upsert(knowledge.pages, stamped(existing, { ...body, id, title })), projectPageSchema);
    }
    if (kind === 'order') {
      const current = inSection(knowledge.projects, String(body?.section)).map(record => record.id);
      const ids = (body?.ids as string[] | undefined) ?? [];
      if (ids.length !== current.length || ids.some(projectId => !current.includes(projectId))) {
        return conflict('project_order_changed');
      }
      renumber(ids.map(projectId => knowledge.projects.find(record => record.id === projectId)!), at);
      return reply(route, 200, catalogue(knowledge), projectCatalogueSchema);
    }
    if (method === 'POST' && !kind) {
      const created = project({ ...body, createdAt: at, updatedAt: at, sortOrder: undefined }, knowledge.projects.length);
      created.sortOrder = inSection(knowledge.projects, section(created)).length;
      knowledge.projects.push(created);
      knowledge.pages.unshift(overviewFor(created, String(body?.overviewPageId)));
      return reply(route, 200, catalogue(knowledge), projectCatalogueSchema);
    }
    const existing = knowledge.projects.find(record => record.id === kind);
    if (!existing) return notFound();
    const move = (change: Json) => {
      const from = section(existing);
      Object.assign(existing, change, { updatedAt: at });
      renumber(inSection(knowledge.projects, from), at);
      if (section(existing) !== from) {
        const destination = inSection(knowledge.projects, section(existing)).filter(record => record !== existing);
        renumber([...destination, existing], at);
      }
    };
    if (method === 'DELETE') {
      knowledge.projects.splice(knowledge.projects.indexOf(existing), 1);
      knowledge.pages = knowledge.pages.filter(record => record.projectId !== existing.id);
      renumber(inSection(knowledge.projects, section(existing)), at);
    } else if (id === 'reference') {
      Object.assign(existing, project({ ...existing, ...body, id: existing.id, catalogKey: existing.catalogKey }, 0),
        { sortOrder: existing.sortOrder, updatedAt: at });
    } else if (id === 'status') {
      if (body?.status === 'archived' || existing.status === 'archived') return conflict('use_archive');
      Object.assign(existing, { status: body?.status, updatedAt: at });
    } else if (id === 'pinned') {
      if (body?.pinned && existing.status === 'archived') return conflict('project_archived');
      if (existing.isPinned !== body?.pinned) move({ isPinned: body?.pinned });
    } else if (id === 'archived') {
      if ((existing.status === 'archived') !== body?.archived) {
        move(body?.archived
          ? { status: 'archived', statusBeforeArchive: existing.status, isPinned: false }
          : { status: existing.statusBeforeArchive ?? 'active', statusBeforeArchive: null, isPinned: false });
      }
    } else {
      return notFound();
    }
    return reply(route, 200, catalogue(knowledge), projectCatalogueSchema);
  }
  return notFound();
}
