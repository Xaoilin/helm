import { v4 as uuid } from 'uuid';
import type {
  Project,
  ProjectDeviceBinding,
  ProjectDeviceBindingSource,
  ProjectKind,
  ProjectLink,
  ProjectLinkKind,
  ProjectPreviewStyle,
  ProjectRunProfile,
  ProjectRunRecipe,
  ProjectSetupStep,
  ProjectStatus,
  ProjectStatusBeforeArchive,
} from '../types/domain';

export const PROJECT_DEVICE_BINDINGS_STORE_KEY = 'projectDeviceBindings' as const;
export const PROJECT_PENDING_LEGACY_PATHS_STORE_KEY = 'projectPendingLegacyPaths' as const;

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
const VALID_BINDING_SOURCES = new Set<ProjectDeviceBindingSource>(['legacy', 'user']);
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
export type SharedProjectRecord = Omit<Project, 'localPath'>;

export interface LegacyWorkspaceRecord {
  id?: unknown;
  name?: unknown;
  path?: unknown;
  description?: unknown;
  isPrimary?: unknown;
  createdAt?: unknown;
  updatedAt?: unknown;
}

export interface PendingLegacyProjectPath {
  catalogKey: string;
  projectRoot: string;
  capturedAt: string;
}

export interface LegacyProjectPathMigrationResult {
  bindings: ProjectDeviceBinding[];
  pendingPaths: PendingLegacyProjectPath[];
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

export function isAbsoluteProjectRoot(value: unknown): boolean {
  const candidate = trimmedString(value);
  return candidate.startsWith('/')
    || WINDOWS_ABSOLUTE_PATH_PATTERN.test(candidate)
    || WINDOWS_UNC_PATH_PATTERN.test(candidate);
}

function normalizeRelativeWorkingDirectory(value: unknown): string | undefined {
  const candidate = trimmedString(value);
  if (!candidate) return undefined;
  if (isAbsoluteProjectRoot(candidate)) return undefined;
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
    if (!executable || isAbsoluteProjectRoot(executable)) return [];

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
    localPath: trimmedString(value.path) || undefined,
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

function normalizeRunProfile(value: unknown): ProjectRunProfile | null {
  if (!isRecord(value)) return null;

  const profileId = trimmedString(value.profileId);
  const projectId = trimmedString(value.projectId);
  const recipeId = trimmedString(value.recipeId);
  const projectRoot = trimmedString(value.projectRoot);
  const workingDirectory = trimmedString(value.workingDirectory);
  const executable = trimmedString(value.executable);
  const fingerprint = trimmedString(value.fingerprint);
  const approvedAt = normalizeOptionalTimestamp(value.approvedAt);
  if (
    !profileId
    || !projectId
    || !recipeId
    || !isAbsoluteProjectRoot(projectRoot)
    || !isAbsoluteProjectRoot(workingDirectory)
    || !executable
    || !fingerprint
    || !approvedAt
  ) {
    return null;
  }

  return {
    profileId,
    projectId,
    recipeId,
    projectRoot,
    workingDirectory,
    executable,
    args: Array.isArray(value.args)
      ? value.args.filter((arg): arg is string => typeof arg === 'string')
      : [],
    environment: normalizeEnvironment(value.environment) || {},
    fingerprint,
    approvedAt,
  };
}

export function normalizeProjectDeviceBinding(
  value: unknown,
  now = new Date().toISOString(),
): ProjectDeviceBinding | null {
  if (!isRecord(value)) return null;

  const catalogKey = trimmedString(value.catalogKey);
  const projectRoot = trimmedString(value.projectRoot);
  if (!catalogKey || !isAbsoluteProjectRoot(projectRoot)) return null;

  const source = typeof value.source === 'string'
    && VALID_BINDING_SOURCES.has(value.source as ProjectDeviceBindingSource)
    ? value.source as ProjectDeviceBindingSource
    : 'user';
  const adoptedAt = normalizeTimestamp(value.adoptedAt, now);

  return {
    catalogKey,
    projectRoot,
    source,
    adoptedAt,
    updatedAt: normalizeTimestamp(value.updatedAt, adoptedAt),
    runProfiles: Array.isArray(value.runProfiles)
      ? value.runProfiles.map(normalizeRunProfile).filter((profile): profile is ProjectRunProfile => profile !== null)
      : [],
  };
}

export function normalizeProjectDeviceBindings(
  value: unknown,
  now = new Date().toISOString(),
): ProjectDeviceBinding[] {
  if (!Array.isArray(value)) return [];

  const byCatalogKey = new Map<string, ProjectDeviceBinding>();
  value.forEach(item => {
    const normalized = normalizeProjectDeviceBinding(item, now);
    if (normalized) byCatalogKey.set(normalized.catalogKey, normalized);
  });
  return [...byCatalogKey.values()];
}

export function normalizePendingLegacyProjectPaths(
  value: unknown,
  now = new Date().toISOString(),
): PendingLegacyProjectPath[] {
  if (!Array.isArray(value)) return [];

  const byCatalogKey = new Map<string, PendingLegacyProjectPath>();
  value.forEach(item => {
    if (!isRecord(item)) return;
    const catalogKey = trimmedString(item.catalogKey);
    const projectRoot = trimmedString(item.projectRoot);
    if (!catalogKey || !isAbsoluteProjectRoot(projectRoot)) return;
    byCatalogKey.set(catalogKey, {
      catalogKey,
      projectRoot,
      capturedAt: normalizeTimestamp(item.capturedAt, now),
    });
  });
  return [...byCatalogKey.values()];
}

export async function migrateLegacyProjectDeviceBindings(
  sourceRecords: unknown,
  projects: Project[],
  existingBindings: ProjectDeviceBinding[],
  existingPendingPaths: PendingLegacyProjectPath[],
  canonicalizeProjectRoot: (projectRoot: string) => Promise<string | null>,
  now = new Date().toISOString(),
): Promise<LegacyProjectPathMigrationResult> {
  const bindings = new Map(existingBindings.map(binding => [binding.catalogKey, binding]));
  const projectCatalogKeys = new Set(
    projects
      .map(project => project.catalogKey)
      .filter((catalogKey): catalogKey is string => Boolean(catalogKey)),
  );
  const pendingPaths = new Map(
    existingPendingPaths
      .filter(pending => projectCatalogKeys.has(pending.catalogKey))
      .map(pending => [pending.catalogKey, pending]),
  );

  if (Array.isArray(sourceRecords)) {
    for (const [index, value] of sourceRecords.entries()) {
      if (!isRecord(value)) continue;
      const sourceId = trimmedString(value.id);
      const sourceCatalogKey = trimmedString(value.catalogKey)
        || (sourceId ? `custom:${sourceId}` : '');
      const project = sourceId || sourceCatalogKey
        ? projects.find(candidate => (
          (sourceId && candidate.id === sourceId)
          || (sourceCatalogKey && candidate.catalogKey === sourceCatalogKey)
        ))
        : projects[index];
      const catalogKey = project?.catalogKey;
      const legacyPath = trimmedString(value.localPath);
      if (!catalogKey || !isAbsoluteProjectRoot(legacyPath) || bindings.has(catalogKey)) continue;
      pendingPaths.set(catalogKey, {
        catalogKey,
        projectRoot: legacyPath,
        capturedAt: normalizeTimestamp(value.updatedAt, now),
      });
    }
  }

  for (const [catalogKey, pending] of pendingPaths) {
    if (bindings.has(catalogKey)) {
      pendingPaths.delete(catalogKey);
      continue;
    }
    let canonicalRoot: string | null = null;
    try {
      canonicalRoot = await canonicalizeProjectRoot(pending.projectRoot);
    } catch {
      canonicalRoot = null;
    }
    if (typeof canonicalRoot !== 'string' || !isAbsoluteProjectRoot(canonicalRoot)) continue;

    bindings.set(catalogKey, {
      catalogKey,
      projectRoot: canonicalRoot,
      source: 'legacy',
      adoptedAt: pending.capturedAt,
      updatedAt: pending.capturedAt,
      runProfiles: [],
    });
    pendingPaths.delete(catalogKey);
  }

  return {
    bindings: [...bindings.values()],
    pendingPaths: [...pendingPaths.values()],
  };
}

export function upsertProjectDeviceRoot(
  bindings: ProjectDeviceBinding[],
  catalogKey: string,
  projectRoot: string,
  source: ProjectDeviceBindingSource = 'user',
  now = new Date().toISOString(),
): ProjectDeviceBinding[] {
  const normalizedCatalogKey = catalogKey.trim();
  const normalizedProjectRoot = projectRoot.trim();
  if (!normalizedCatalogKey || !isAbsoluteProjectRoot(normalizedProjectRoot)) return bindings;

  const existing = bindings.find(binding => binding.catalogKey === normalizedCatalogKey);
  const nextBinding: ProjectDeviceBinding = {
    catalogKey: normalizedCatalogKey,
    projectRoot: normalizedProjectRoot,
    source,
    adoptedAt: existing?.adoptedAt || now,
    updatedAt: now,
    runProfiles: existing?.runProfiles || [],
  };

  return [
    nextBinding,
    ...bindings.filter(binding => binding.catalogKey !== normalizedCatalogKey),
  ];
}

export function upsertProjectRunProfile(
  bindings: ProjectDeviceBinding[],
  catalogKey: string,
  profile: ProjectRunProfile,
  now = new Date().toISOString(),
): ProjectDeviceBinding[] {
  const binding = bindings.find(item => item.catalogKey === catalogKey);
  const normalizedProfile = normalizeRunProfile(profile);
  if (!binding || !normalizedProfile) return bindings;

  return bindings.map(item => (
    item.catalogKey === catalogKey
      ? {
        ...item,
        updatedAt: now,
        runProfiles: [
          normalizedProfile,
          ...item.runProfiles.filter(existing => existing.profileId !== normalizedProfile.profileId),
        ],
      }
      : item
  ));
}
