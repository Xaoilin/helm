/**
 * Runtime contracts for the Spring Boot knowledge service (knowledge base, lifestyle tracker, projects
 * and their wiki). Responses are parsed straight into the app's domain types: an absent optional value
 * arrives as `null` and becomes `undefined`. `contracts/knowledge-service/*.json` holds one example per
 * response.
 */
import { z } from 'zod';
import type {
  KnowledgeEntry,
  KnowledgeSource,
  KnowledgeTopic,
  LifestyleItem,
  Project,
  ProjectLink,
  ProjectPage,
  ProjectPreviewStyle,
  ProjectRunRecipe,
  ProjectSetupStep,
} from '../../types/domain';
import { apiErrorSchema } from './contracts';

const instant = z.string().datetime({ offset: true });

/** A nullable value the app keeps as an optional field. */
function optional<T extends z.ZodType>(schema: T) {
  return schema.nullable().transform(value => value ?? undefined);
}

// ── Knowledge base ──

const knowledgeSourceSchema = z.object({
  type: z.enum(['quran', 'hadith', 'scholarly', 'other']),
  surah: optional(z.number().int()),
  ayahStart: optional(z.number().int()),
  ayahEnd: optional(z.number().int()),
  collection: optional(z.string()),
  hadithNumber: optional(z.string()),
  author: optional(z.string()),
  title: optional(z.string()),
  url: optional(z.string()),
}).transform((source): KnowledgeSource => source);

export const knowledgeTopicSchema = z.object({
  id: z.string(),
  name: z.string(),
  description: z.string(),
  icon: z.string(),
  color: z.string(),
  sortOrder: z.number().int(),
  createdAt: instant,
  updatedAt: instant,
}).transform((topic): KnowledgeTopic => topic);

export const knowledgeEntrySchema = z.object({
  id: z.string(),
  topicId: z.string(),
  title: z.string(),
  content: z.string(),
  sources: z.array(knowledgeSourceSchema),
  tags: z.array(z.string()),
  createdAt: instant,
  updatedAt: instant,
}).transform((entry): KnowledgeEntry => entry);

export const knowledgeSchema = z.object({
  topics: z.array(knowledgeTopicSchema),
  entries: z.array(knowledgeEntrySchema),
});

// ── Lifestyle ──

export const lifestyleItemSchema = z.object({
  id: z.string(),
  type: z.enum(['haram', 'major-sin', 'wajib-both', 'wajib-women', 'wajib-men', 'halal']),
  title: z.string(),
  notes: z.string(),
  status: z.enum(['struggling', 'working-on-it', 'avoiding', 'mastered', 'want-to-start', 'sometimes', 'practicing',
    'consistent']),
  sources: z.array(z.string()),
  sortOrder: z.number().int(),
  createdAt: instant,
  updatedAt: instant,
}).transform((item): LifestyleItem => item);

export const lifestyleSchema = z.object({ items: z.array(lifestyleItemSchema) });

// ── Projects ──

const projectLinkSchema = z.object({
  id: z.string(),
  kind: z.enum(['repository', 'deployment', 'documentation', 'demo', 'other']),
  label: z.string(),
  url: z.string(),
}).transform((link): ProjectLink => link);

const projectSetupStepSchema = z.object({
  id: z.string(),
  title: z.string(),
  description: z.string(),
  displayCode: optional(z.string()),
}).transform((step): ProjectSetupStep => step);

const projectRunRecipeSchema = z.object({
  id: z.string(),
  label: z.string(),
  displayCommand: z.string(),
  executable: z.string(),
  args: z.array(z.string()),
  workingDirectory: optional(z.string()),
  environment: optional(z.record(z.string(), z.string())),
  localUrl: optional(z.string()),
  prerequisites: optional(z.array(z.string())),
  mode: z.enum(['service', 'one_shot']),
}).transform((recipe): ProjectRunRecipe => recipe);

const projectPreviewSchema = z.object({
  icon: z.string(),
  accentColor: z.string(),
  backgroundColor: z.string(),
  coverImageUrl: optional(z.string()),
}).transform((preview): ProjectPreviewStyle => preview);

export const projectSchema = z.object({
  id: z.string(),
  catalogKey: z.string(),
  name: z.string(),
  kind: z.enum(['web_app', 'desktop_app', 'mobile_app', 'cli', 'service', 'library', 'automation', 'hardware',
    'research', 'other']),
  links: z.array(projectLinkSchema),
  setupSteps: z.array(projectSetupStepSchema),
  runRecipes: z.array(projectRunRecipeSchema),
  preview: projectPreviewSchema,
  verifiedAt: optional(instant),
  summary: z.string(),
  status: z.enum(['planning', 'active', 'blocked', 'completed', 'archived']),
  statusBeforeArchive: optional(z.enum(['planning', 'active', 'blocked', 'completed'])),
  tags: z.array(z.string()),
  isPinned: z.boolean(),
  sortOrder: z.number().int(),
  createdAt: instant,
  updatedAt: instant,
}).transform((project): Project => project);

export const projectPageSchema = z.object({
  id: z.string(),
  projectId: z.string(),
  title: z.string(),
  content: z.string(),
  isOverview: z.boolean(),
  createdAt: instant,
  updatedAt: instant,
}).transform((page): ProjectPage => page);

export const projectCatalogueSchema = z.object({
  projects: z.array(projectSchema),
  pages: z.array(projectPageSchema),
});

export const projectMatchesSchema = z.object({
  projects: z.array(z.object({ id: z.string(), catalogKey: z.string(), name: z.string() })),
});

export type ServiceKnowledge = z.infer<typeof knowledgeSchema>;
export type ServiceProjectCatalogue = z.infer<typeof projectCatalogueSchema>;

/** Every contracts/knowledge-service fixture and the schema its body must satisfy. */
export const KNOWLEDGE_CONTRACT_SCHEMAS: Record<string, z.ZodType> = {
  'knowledge-service/knowledge': knowledgeSchema,
  'knowledge-service/topic-saved': knowledgeTopicSchema,
  'knowledge-service/topic-deleted': z.null(),
  'knowledge-service/entry-saved': knowledgeEntrySchema,
  'knowledge-service/entry-deleted': z.null(),
  'knowledge-service/entry-invalid': apiErrorSchema,
  'knowledge-service/lifestyle': lifestyleSchema,
  'knowledge-service/lifestyle-item-saved': lifestyleItemSchema,
  'knowledge-service/lifestyle-item-moved': lifestyleSchema,
  'knowledge-service/lifestyle-order-saved': lifestyleSchema,
  'knowledge-service/lifestyle-order-changed': apiErrorSchema,
  'knowledge-service/lifestyle-item-deleted': z.null(),
  'knowledge-service/projects': projectCatalogueSchema,
  'knowledge-service/project-created': projectCatalogueSchema,
  'knowledge-service/project-reference-updated': projectCatalogueSchema,
  'knowledge-service/project-status-updated': projectCatalogueSchema,
  'knowledge-service/project-pinned': projectCatalogueSchema,
  'knowledge-service/project-archived': projectCatalogueSchema,
  'knowledge-service/projects-reordered': projectCatalogueSchema,
  'knowledge-service/project-order-changed': apiErrorSchema,
  'knowledge-service/project-deleted': projectCatalogueSchema,
  'knowledge-service/project-page-saved': projectPageSchema,
  'knowledge-service/project-page-deleted': z.null(),
  'knowledge-service/overview-page-required': apiErrorSchema,
  'knowledge-service/projects-resolved': projectMatchesSchema,
  'knowledge-service/agent-not-approved': apiErrorSchema,
  'knowledge-service/rate-limited': apiErrorSchema,
};
