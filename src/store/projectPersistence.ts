import { v4 as uuid } from 'uuid';
import type {
  Project,
  ProjectKind,
  ProjectLink,
  ProjectLinkKind,
  ProjectPreviewStyle,
  ProjectRunRecipe,
  ProjectSetupStep,
  ProjectStatus,
  ProjectStatusBeforeArchive,
} from '../types/domain';

const VALID_PROJECT_STATUSES = new Set<ProjectStatus>(['planning', 'active', 'blocked', 'completed', 'archived']);
const VALID_PROJECT_STATUSES_BEFORE_ARCHIVE = new Set<ProjectStatusBeforeArchive>([
  'planning',
  'active',
  'blocked',
  'completed',
]);
const VALID_PROJECT_KINDS = new Set<ProjectKind>([
  'web_app',
  'desktop_app',
  'mobile_app',
  'cli',
  'service',
  'library',
  'automation',
  'hardware',
  'research',
  'other',
]);
const VALID_PROJECT_LINK_KINDS = new Set<ProjectLinkKind>([
  'repository',
  'deployment',
  'documentation',
  'demo',
  'other',
]);
const COLOR_PATTERN = /^#[0-9a-f]{6}(?:[0-9a-f]{2})?$/i;
const ENVIRONMENT_KEY_PATTERN = /^[A-Za-z_][A-Za-z0-9_]*$/;
const SENSITIVE_ENVIRONMENT_KEY_PATTERN = /(api.?key|access.?token|refresh.?token|secret|password|credential|private.?key)/i;
const WINDOWS_ABSOLUTE_PATH_PATTERN = /^[A-Za-z]:[\\/]/;
const WINDOWS_UNC_PATH_PATTERN = /^\\\\[^\\]/;
const DEFAULT_PREVIEW: ProjectPreviewStyle = {
  icon: 'folder',
  accentColor: '#7c6cff',
  backgroundColor: '#171827',
};

type UnknownRecord = Record<string, unknown>;
export type SharedProjectRecord = Project;

export interface LegacyWorkspaceRecord {
  id?: unknown;
  name?: unknown;
  description?: unknown;
  isPrimary?: unknown;
  createdAt?: unknown;
  updatedAt?: unknown;
}

function isRecord(value: unknown): value is UnknownRecord {
  return Boolean(value) && typeof value === 'object' && !Array.isArray(value);
}

function trimmedString(value: unknown): string {
  return typeof value === 'string' ? value.trim() : '';
}

function normalizeTimestamp(value: unknown, fallback: string): string {
  const candidate = trimmedString(value);
  return candidate && Number.isFinite(Date.parse(candidate)) ? candidate : fallback;
}

function normalizeOptionalTimestamp(value: unknown): string | undefined {
  const candidate = trimmedString(value);
  return candidate && Number.isFinite(Date.parse(candidate)) ? candidate : undefined;
}

function normalizeOptionalSortOrder(value: unknown): number | undefined {
  return typeof value === 'number' && Number.isSafeInteger(value) && value >= 0
    ? value
    : undefined;
}

function normalizeTags(value: unknown): string[] {
  if (!Array.isArray(value)) return [];
  return [...new Set(value
    .filter((tag): tag is string => typeof tag === 'string')
    .map(tag => tag.trim())
    .filter(Boolean))];
}

function normalizeCatalogKey(value: unknown, projectId: string): string {
  const candidate = trimmedString(value);
  return candidate || `custom:${projectId}`;
}

function normalizeProjectKind(value: unknown): ProjectKind {
  return typeof value === 'string' && VALID_PROJECT_KINDS.has(value as ProjectKind)
    ? value as ProjectKind
    : 'other';
}

function normalizeProjectLinkKind(value: unknown): ProjectLinkKind {
  return typeof value === 'string' && VALID_PROJECT_LINK_KINDS.has(value as ProjectLinkKind)
    ? value as ProjectLinkKind
    : 'other';
}

function normalizeWebUrl(value: unknown): string | null {
  const candidate = trimmedString(value);
  if (!candidate) return null;

  try {
    const parsed = new URL(candidate);
    return parsed.protocol === 'https:' || parsed.protocol === 'http:' ? parsed.toString() : null;
  } catch {
    return null;
  }
}

function normalizeLinks(value: unknown, catalogKey: string): ProjectLink[] {
  if (!Array.isArray(value)) return [];

  return value.flatMap((item, index) => {
    if (!isRecord(item)) return [];
    const url = normalizeWebUrl(item.url);
    if (!url) return [];

    return [{
      id: trimmedString(item.id) || `${catalogKey}:link:${index + 1}`,
      kind: normalizeProjectLinkKind(item.kind),
      label: trimmedString(item.label) || `Link ${index + 1}`,
      url,
    }];
  });
}

function normalizeSetupSteps(value: unknown, catalogKey: string): ProjectSetupStep[] {
  if (!Array.isArray(value)) return [];

  return value.flatMap((item, index) => {
    if (typeof item === 'string') {
      const title = item.trim();
      return title
        ? [{
          id: `${catalogKey}:setup:${index + 1}`,
          title,
          description: '',
        }]
        : [];
    }

    if (!isRecord(item)) return [];
    const title = trimmedString(item.title);
    const description = trimmedString(item.description);
    const displayCode = trimmedString(item.displayCode);
    if (!title && !description && !displayCode) return [];

    return [{
      id: trimmedString(item.id) || `${catalogKey}:setup:${index + 1}`,
      title: title || `Step ${index + 1}`,
      description,
      ...(displayCode ? { displayCode } : {}),
    }];
  });
}

export function isAbsoluteFilesystemPath(value: unknown): boolean {
  const candidate = trimmedString(value);
  return candidate.startsWith('/')
    || WINDOWS_ABSOLUTE_PATH_PATTERN.test(candidate)
    || WINDOWS_UNC_PATH_PATTERN.test(candidate);
}

function normalizeRelativeWorkingDirectory(value: unknown): string | undefined {
  const candidate = trimmedString(value);
  if (!candidate) return undefined;
  if (isAbsoluteFilesystemPath(candidate)) return undefined;
  if (candidate === '..' || candidate.startsWith('../') || candidate.startsWith('..\\')) return undefined;
  return candidate;
}

function normalizeEnvironment(value: unknown): Record<string, string> | undefined {
  if (!isRecord(value)) return undefined;

  const entries = Object.entries(value).flatMap(([key, entryValue]) => {
    if (!ENVIRONMENT_KEY_PATTERN.test(key) || SENSITIVE_ENVIRONMENT_KEY_PATTERN.test(key)) return [];
    return typeof entryValue === 'string' ? [[key, entryValue] as const] : [];
  });

  return entries.length > 0 ? Object.fromEntries(entries) : undefined;
}

function normalizeRunRecipes(value: unknown, catalogKey: string): ProjectRunRecipe[] {
  if (!Array.isArray(value)) return [];

  return value.flatMap((item, index) => {
    if (!isRecord(item)) return [];
    const executable = trimmedString(item.executable);
    if (!executable || isAbsoluteFilesystemPath(executable)) return [];

    const args = Array.isArray(item.args)
      ? item.args.filter((arg): arg is string => typeof arg === 'string')
      : [];
    const workingDirectory = normalizeRelativeWorkingDirectory(item.workingDirectory);
    const environment = normalizeEnvironment(item.environment);
    const localUrl = normalizeWebUrl(item.localUrl);
    const prerequisites = Array.isArray(item.prerequisites)
      ? [...new Set(item.prerequisites
        .filter((entry): entry is string => typeof entry === 'string')
        .map(entry => entry.trim())
        .filter(Boolean))]
      : [];
    const mode = item.mode === 'service' ? 'service' : 'one_shot';

    return [{
      id: trimmedString(item.id) || `${catalogKey}:run:${index + 1}`,
      label: trimmedString(item.label) || executable,
      displayCommand: trimmedString(item.displayCommand) || [executable, ...args].join(' '),
      executable,
      args,
      ...(workingDirectory ? { workingDirectory } : {}),
      ...(environment ? { environment } : {}),
      ...(localUrl ? { localUrl } : {}),
      ...(prerequisites.length > 0 ? { prerequisites } : {}),
      mode,
    }];
  });
}

function normalizeColor(value: unknown, fallback: string): string {
  const candidate = trimmedString(value);
  return COLOR_PATTERN.test(candidate) ? candidate.toLowerCase() : fallback;
}

function normalizePreview(value: unknown): ProjectPreviewStyle {
  if (!isRecord(value)) return { ...DEFAULT_PREVIEW };
  const coverImageUrl = normalizeWebUrl(value.coverImageUrl);
  return {
    icon: trimmedString(value.icon).slice(0, 40) || DEFAULT_PREVIEW.icon,
    accentColor: normalizeColor(value.accentColor, DEFAULT_PREVIEW.accentColor),
    backgroundColor: normalizeColor(value.backgroundColor, DEFAULT_PREVIEW.backgroundColor),
    ...(coverImageUrl ? { coverImageUrl } : {}),
  };
}

export function normalizeProjectRecord(
  value: unknown,
  fallbackName = 'New Project',
  now = new Date().toISOString(),
): Project {
  const record = isRecord(value) ? value : {};
  const id = trimmedString(record.id) || uuid();
  const catalogKey = normalizeCatalogKey(record.catalogKey, id);
  const createdAt = normalizeTimestamp(record.createdAt, now);
  const updatedAt = normalizeTimestamp(record.updatedAt, createdAt);
  const status = typeof record.status === 'string' && VALID_PROJECT_STATUSES.has(record.status as ProjectStatus)
    ? record.status as ProjectStatus
    : 'active';
  const statusBeforeArchive = status === 'archived'
    && typeof record.statusBeforeArchive === 'string'
    && VALID_PROJECT_STATUSES_BEFORE_ARCHIVE.has(record.statusBeforeArchive as ProjectStatusBeforeArchive)
    ? record.statusBeforeArchive as ProjectStatusBeforeArchive
    : undefined;
  const sortOrder = normalizeOptionalSortOrder(record.sortOrder);

  return {
    id,
    catalogKey,
    name: trimmedString(record.name) || fallbackName,
    kind: normalizeProjectKind(record.kind),
    links: normalizeLinks(record.links, catalogKey),
    setupSteps: normalizeSetupSteps(record.setupSteps, catalogKey),
    runRecipes: normalizeRunRecipes(record.runRecipes, catalogKey),
    preview: normalizePreview(record.preview),
    verifiedAt: normalizeOptionalTimestamp(record.verifiedAt),
    summary: trimmedString(record.summary),
    status,
    ...(statusBeforeArchive ? { statusBeforeArchive } : {}),
    tags: normalizeTags(record.tags),
    isPinned: status !== 'archived' && record.isPinned === true,
    ...(sortOrder !== undefined ? { sortOrder } : {}),
    createdAt,
    updatedAt,
  };
}

export function normalizeProjectRecords(value: unknown, now = new Date().toISOString()): Project[] {
  if (!Array.isArray(value)) return [];

  const seenIds = new Set<string>();
  const seenCatalogKeys = new Set<string>();
  return value
    .map((project, index) => normalizeProjectRecord(project, `Project ${index + 1}`, now))
    .filter(project => {
      if (seenIds.has(project.id) || seenCatalogKeys.has(project.catalogKey || '')) return false;
      seenIds.add(project.id);
      seenCatalogKeys.add(project.catalogKey || '');
      return true;
    });
}

export function migrateLegacyWorkspaceRecord(
  value: LegacyWorkspaceRecord,
  index: number,
  now = new Date().toISOString(),
): UnknownRecord {
  const id = trimmedString(value.id) || uuid();
  const createdAt = normalizeTimestamp(value.createdAt, now);
  return {
    id,
    name: trimmedString(value.name) || `Project ${index + 1}`,
    summary: trimmedString(value.description),
    status: 'active',
    tags: [],
    isPinned: value.isPrimary === true,
    createdAt,
    updatedAt: normalizeTimestamp(value.updatedAt, createdAt),
  };
}

export function serializeSharedProject(project: Project): SharedProjectRecord {
  const normalized = normalizeProjectRecord(project, 'Project', project.createdAt || new Date().toISOString());
  return {
    id: normalized.id,
    catalogKey: normalized.catalogKey,
    name: normalized.name,
    kind: normalized.kind,
    links: normalized.links,
    setupSteps: normalized.setupSteps,
    runRecipes: normalized.runRecipes,
    preview: normalized.preview,
    verifiedAt: normalized.verifiedAt,
    summary: normalized.summary,
    status: normalized.status,
    ...(normalized.statusBeforeArchive ? { statusBeforeArchive: normalized.statusBeforeArchive } : {}),
    tags: normalized.tags,
    isPinned: normalized.isPinned,
    ...(normalized.sortOrder !== undefined ? { sortOrder: normalized.sortOrder } : {}),
    createdAt: normalized.createdAt,
    updatedAt: normalized.updatedAt,
  };
}

export function serializeSharedProjects(value: unknown): SharedProjectRecord[] {
  return Array.isArray(value)
    ? value.map(project => serializeSharedProject(project as Project))
    : [];
}
