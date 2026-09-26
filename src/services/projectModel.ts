/**
 * Pure Project rules behind the Projects surface: catalogue filtering and
 * grouping, workspace metrics, board movement, and form-to-record mapping.
 *
 * Nothing here reads React state, the clock, or the browser. Callers pass the
 * current instant or local date key so every rule is testable on its own.
 */
import {
  compareProjectCatalogueOrder,
  getOrderedProjectsInSection,
} from '../store/projectOrdering';
import type {
  Project,
  ProjectKind,
  ProjectPage,
  ProjectPreviewStyle,
  ProjectStatus,
  ProjectWorkflowState,
  Task,
  TaskPriority,
} from '../types/domain';

// ── Labels and options ──

export const PROJECT_STATUS_OPTIONS: readonly ProjectStatus[] = ['planning', 'active', 'blocked', 'completed', 'archived'];

export const PROJECT_KIND_OPTIONS: ReadonlyArray<{ value: ProjectKind; label: string }> = [
  { value: 'web_app', label: 'Web app' },
  { value: 'desktop_app', label: 'Desktop app' },
  { value: 'mobile_app', label: 'Mobile app' },
  { value: 'cli', label: 'CLI' },
  { value: 'service', label: 'Service' },
  { value: 'library', label: 'Library' },
  { value: 'automation', label: 'Automation' },
  { value: 'hardware', label: 'Hardware' },
  { value: 'research', label: 'Research' },
  { value: 'other', label: 'Other' },
];

export type ProjectCatalogFilter = 'all' | 'active' | 'live' | 'hardware' | 'reference';

export const PROJECT_CATALOG_FILTERS: ReadonlyArray<{ value: ProjectCatalogFilter; label: string }> = [
  { value: 'all', label: 'All' },
  { value: 'active', label: 'Active' },
  { value: 'live', label: 'Live' },
  { value: 'hardware', label: 'Hardware' },
  { value: 'reference', label: 'Reference' },
];

export type ProjectTab = 'overview' | 'board' | 'milestones' | 'inventory' | 'wiki';

export const PROJECT_TABS: ReadonlyArray<{ key: ProjectTab; label: string }> = [
  { key: 'overview', label: 'Overview' },
  { key: 'board', label: 'Board' },
  { key: 'milestones', label: 'Milestones' },
  { key: 'inventory', label: 'Inventory' },
  { key: 'wiki', label: 'Wiki' },
];

export type BoardColumn = ProjectWorkflowState | 'done';

export const BOARD_COLUMNS: ReadonlyArray<{ key: BoardColumn; label: string }> = [
  { key: 'backlog', label: 'Backlog' },
  { key: 'next_up', label: 'Next Up' },
  { key: 'in_progress', label: 'In Progress' },
  { key: 'blocked', label: 'Blocked' },
  { key: 'done', label: 'Done' },
];

/** Preview used for a new project until someone designs one. */
export const DEFAULT_PROJECT_PREVIEW_COLORS = {
  accentColor: '#777dff',
  backgroundColor: '#171b2e',
} as const;

export function getProjectStatusLabel(status: ProjectStatus): string {
  switch (status) {
    case 'planning': return 'Planning';
    case 'active': return 'Active';
    case 'blocked': return 'Blocked';
    case 'completed': return 'Completed';
    case 'archived': return 'Archived';
  }
}

/** Short, locale-formatted timestamp; returns unparseable input unchanged. */
export function formatProjectTimestamp(value: string | undefined): string {
  if (!value) return 'Not recorded';
  const parsed = new Date(value);
  if (Number.isNaN(parsed.getTime())) return value;
  return parsed.toLocaleString([], {
    month: 'short',
    day: 'numeric',
    hour: '2-digit',
    minute: '2-digit',
  });
}

/** Keyboard navigation between workspace tabs. Returns null for keys tabs ignore. */
export function getNextProjectTab(current: ProjectTab, key: string): ProjectTab | null {
  const currentIndex = PROJECT_TABS.findIndex(tab => tab.key === current);
  const last = PROJECT_TABS.length - 1;
  switch (key) {
    case 'ArrowRight': return PROJECT_TABS[(currentIndex + 1) % PROJECT_TABS.length].key;
    case 'ArrowLeft': return PROJECT_TABS[(currentIndex - 1 + PROJECT_TABS.length) % PROJECT_TABS.length].key;
    case 'Home': return PROJECT_TABS[0].key;
    case 'End': return PROJECT_TABS[last].key;
    default: return null;
  }
}

// ── Availability and catalogue ──

export interface ProjectAvailability {
  key: 'live' | 'reference';
  label: 'Live' | 'Reference';
}

/** True only for absolute http(s) URLs, the links Sabah One will open. */
export function isWebUrl(value: string): boolean {
  try {
    const url = new URL(value);
    return url.protocol === 'https:' || url.protocol === 'http:';
  } catch {
    return false;
  }
}

export function getProjectAvailability(project: Project): ProjectAvailability {
  const hasLiveLink = (project.links || []).some(link => (
    (link.kind === 'deployment' || link.kind === 'demo') && isWebUrl(link.url)
  ));
  if (hasLiveLink) return { key: 'live', label: 'Live' };
  return { key: 'reference', label: 'Reference' };
}

export function countLiveProjects(projects: readonly Project[]): number {
  return projects.filter(project => getProjectAvailability(project).key === 'live').length;
}

export interface ProjectCatalogueFilters {
  query: string;
  status: 'all' | ProjectStatus;
  kind: 'all' | ProjectKind;
  catalog: ProjectCatalogFilter;
  tag: 'all' | string;
}

export const DEFAULT_PROJECT_CATALOGUE_FILTERS: ProjectCatalogueFilters = {
  query: '',
  status: 'all',
  kind: 'all',
  catalog: 'all',
  tag: 'all',
};

export function hasActiveCatalogueFilters(filters: ProjectCatalogueFilters): boolean {
  return Boolean(
    filters.query.trim()
    || filters.status !== 'all'
    || filters.kind !== 'all'
    || filters.catalog !== 'all'
    || filters.tag !== 'all',
  );
}

function matchesQuery(project: Project, query: string): boolean {
  return !query
    || project.name.toLowerCase().includes(query)
    || project.summary.toLowerCase().includes(query)
    || project.tags.some(tag => tag.toLowerCase().includes(query))
    || (project.links || []).some(link => link.label.toLowerCase().includes(query));
}

function matchesCatalogFilter(project: Project, filter: ProjectCatalogFilter): boolean {
  switch (filter) {
    case 'all': return true;
    case 'active': return project.status === 'active' || project.status === 'planning';
    case 'live': return getProjectAvailability(project).key === 'live';
    case 'hardware': return project.kind === 'hardware';
    case 'reference': return getProjectAvailability(project).key === 'reference';
  }
}

export function filterProjects(projects: readonly Project[], filters: ProjectCatalogueFilters): Project[] {
  const query = filters.query.trim().toLowerCase();
  return projects.filter(project => (
    matchesQuery(project, query)
    && (filters.status === 'all' || project.status === filters.status)
    && (filters.kind === 'all' || project.kind === filters.kind)
    && (filters.tag === 'all' || project.tags.includes(filters.tag))
    && matchesCatalogFilter(project, filters.catalog)
  ));
}

/** Every tag used by any project, sorted for a filter menu. */
export function collectProjectTags(projects: readonly Project[]): string[] {
  const tags = new Set<string>();
  projects.forEach(project => project.tags.forEach(tag => tags.add(tag)));
  return [...tags].sort((left, right) => left.localeCompare(right));
}

export interface GroupedProjects {
  /** Catalogue sections, in persisted manual order. */
  pinned: Project[];
  projects: Project[];
  archived: Project[];
  /** Workspace rail groups for unpinned, unarchived projects. */
  active: Project[];
  blocked: Project[];
}

export function groupProjects(projects: Project[]): GroupedProjects {
  return {
    pinned: getOrderedProjectsInSection(projects, 'pinned'),
    projects: getOrderedProjectsInSection(projects, 'projects'),
    active: projects.filter(project => (
      !project.isPinned
      && (project.status === 'planning' || project.status === 'active' || project.status === 'completed')
    )).sort(compareProjectCatalogueOrder),
    blocked: projects.filter(project => (
      !project.isPinned && project.status === 'blocked'
    )).sort(compareProjectCatalogueOrder),
    archived: getOrderedProjectsInSection(projects, 'archived'),
  };
}

/** Archived results open automatically when a search or the Archived status could match them. */
export function shouldRevealArchived(
  filters: Pick<ProjectCatalogueFilters, 'query' | 'status'>,
  archivedCount: number,
): boolean {
  return archivedCount > 0 && Boolean(filters.query.trim() || filters.status === 'archived');
}

/** The first requested id that still names a project, or null. */
export function resolveProjectId(projects: readonly Project[], requestedId: string | null): string | null {
  return requestedId && projects.some(project => project.id === requestedId) ? requestedId : null;
}

// ── Project work ──

export interface ProjectWork {
  all: Task[];
  board: Task[];
  milestones: Task[];
}

export function getProjectWork(tasks: readonly Task[], projectId: string | null): ProjectWork {
  const all = tasks.filter(task => task.projectId === projectId);
  return {
    all,
    board: all.filter(task => task.category === 'task'),
    milestones: all.filter(task => task.category === 'goal'),
  };
}

export function countActiveProjectWork(tasks: readonly Task[], projectId: string): number {
  return tasks.filter(task => task.projectId === projectId && !task.completed).length;
}

export interface ProjectWorkSummary {
  openCount: number;
  blockedCount: number;
  overdueCount: number;
  completedCount: number;
  milestoneCount: number;
  activeMilestoneCount: number;
  completedMilestoneCount: number;
  /** Whole-number percentage of milestones completed; 0 when there are none. */
  milestoneProgress: number;
}

/** @param today the local `YYYY-MM-DD` key that due dates are compared against */
export function summarizeProjectWork(work: ProjectWork, today: string): ProjectWorkSummary {
  const completedMilestoneCount = work.milestones.filter(task => task.completed).length;
  return {
    openCount: work.all.filter(task => !task.completed).length,
    blockedCount: work.board.filter(task => !task.completed && task.workflowState === 'blocked').length,
    overdueCount: work.all.filter(task => !task.completed && task.dueDate && task.dueDate < today).length,
    completedCount: work.all.filter(task => task.completed).length,
    milestoneCount: work.milestones.length,
    activeMilestoneCount: work.milestones.length - completedMilestoneCount,
    completedMilestoneCount,
    milestoneProgress: work.milestones.length === 0
      ? 0
      : Math.round((completedMilestoneCount / work.milestones.length) * 100),
  };
}

export interface ProjectActivityItem {
  id: string;
  label: string;
  updatedAt: string;
  type: 'task' | 'page';
}

const RECENT_ACTIVITY_LIMIT = 6;

export function buildProjectActivity(projectTasks: readonly Task[], projectPages: readonly ProjectPage[]): ProjectActivityItem[] {
  return [
    ...projectTasks.map(task => ({ id: task.id, label: task.title, updatedAt: task.updatedAt, type: 'task' as const })),
    ...projectPages.map(page => ({ id: page.id, label: page.title, updatedAt: page.updatedAt, type: 'page' as const })),
  ]
    .sort((left, right) => right.updatedAt.localeCompare(left.updatedAt))
    .slice(0, RECENT_ACTIVITY_LIMIT);
}

/** Open milestones first, then by target date; undated milestones last. */
export function sortMilestones(milestones: readonly Task[]): Task[] {
  return [...milestones].sort((left, right) => {
    if (left.completed !== right.completed) return left.completed ? 1 : -1;
    return (left.dueDate || '9999-12-31').localeCompare(right.dueDate || '9999-12-31');
  });
}

// ── Board ──

export function getBoardColumn(task: Task): BoardColumn {
  if (task.completed) return 'done';
  return task.workflowState || 'backlog';
}

/** Manual board order first, then earliest due date, then most recently updated. */
export function sortBoardTasks(tasks: readonly Task[]): Task[] {
  return [...tasks].sort((left, right) => {
    const leftOrder = typeof left.boardOrder === 'number' ? left.boardOrder : Number.MAX_SAFE_INTEGER;
    const rightOrder = typeof right.boardOrder === 'number' ? right.boardOrder : Number.MAX_SAFE_INTEGER;
    if (leftOrder !== rightOrder) return leftOrder - rightOrder;
    if (left.dueDate && right.dueDate && left.dueDate !== right.dueDate) return left.dueDate.localeCompare(right.dueDate);
    return right.updatedAt.localeCompare(left.updatedAt);
  });
}

export type BoardTasksByColumn = Record<BoardColumn, Task[]>;

export function groupBoardTasks(boardTasks: readonly Task[]): BoardTasksByColumn {
  const columns: BoardTasksByColumn = { backlog: [], next_up: [], in_progress: [], blocked: [], done: [] };
  boardTasks.forEach(task => columns[getBoardColumn(task)].push(task));
  for (const column of BOARD_COLUMNS) columns[column.key] = sortBoardTasks(columns[column.key]);
  return columns;
}

/** The order value that places a card last in its column. */
export function getNextBoardOrder(columnTasks: readonly Task[], excludeTaskId?: string): number {
  const highest = columnTasks
    .filter(task => task.id !== excludeTaskId)
    .reduce((max, task) => Math.max(max, task.boardOrder ?? 0), 0);
  return highest + 1;
}

/** The neighbouring column in the given direction, or null at either end. */
export function getAdjacentBoardColumn(task: Task, direction: -1 | 1): BoardColumn | null {
  const current = getBoardColumn(task);
  const index = BOARD_COLUMNS.findIndex(column => column.key === current);
  const target = BOARD_COLUMNS[Math.min(Math.max(index + direction, 0), BOARD_COLUMNS.length - 1)].key;
  return target === current ? null : target;
}

/** Moving a card into Blocked asks why, unless a reason is already recorded. */
export function needsBlockedReason(task: Task, target: BoardColumn): boolean {
  return target === 'blocked' && !task.blockedReason;
}

export interface BoardMoveContext {
  /** ISO instant recorded as the completion time when a card reaches Done. */
  now: string;
  /** Order for the card in its new column (see getNextBoardOrder). */
  boardOrder: number;
  /** The answer to the blocked-reason question, when it was asked. */
  blockedReasonAnswer?: string | null;
}

export function buildBoardMoveUpdate(task: Task, target: BoardColumn, context: BoardMoveContext): Partial<Task> {
  if (target === 'done') {
    return { completed: true, completedAt: task.completedAt || context.now };
  }

  const leavingBlocked = task.workflowState === 'blocked' && target !== 'blocked';
  const blockedReason = needsBlockedReason(task, target)
    ? (context.blockedReasonAnswer || '').trim() || undefined
    : leavingBlocked ? undefined : task.blockedReason;

  return {
    completed: false,
    completedAt: undefined,
    workflowState: target,
    blockedReason,
    boardOrder: context.boardOrder,
  };
}

export interface BoardTaskDraft {
  title: string;
  dueDate: string;
  priority: TaskPriority;
}

export const EMPTY_BOARD_TASK_DRAFT: BoardTaskDraft = { title: '', dueDate: '', priority: 'medium' };

export type NewTask = Omit<Task, 'id' | 'createdAt' | 'updatedAt'>;

/** A new Backlog card, or null when the draft has no title. */
export function buildBoardTask(draft: BoardTaskDraft, projectId: string, boardOrder: number): NewTask | null {
  const title = draft.title.trim();
  if (!title) return null;
  return {
    title,
    description: '',
    completed: false,
    priority: draft.priority,
    category: 'task',
    dueDate: draft.dueDate || undefined,
    projectId,
    workflowState: 'backlog',
    boardOrder,
  };
}

// ── Milestones ──

export interface MilestoneDraft {
  title: string;
  description: string;
  dueDate: string;
  priority: TaskPriority;
}

export function milestoneDraftFrom(goal?: Task | null): MilestoneDraft {
  return {
    title: goal?.title || '',
    description: goal?.description || '',
    dueDate: goal?.dueDate || '',
    priority: goal?.priority || 'medium',
  };
}

/** The milestone record for a draft, keeping completion and goal tag when editing. Null without a title. */
export function buildMilestone(draft: MilestoneDraft, projectId: string, editing?: Task | null): NewTask | null {
  const title = draft.title.trim();
  if (!title) return null;
  return {
    title,
    description: draft.description.trim(),
    completed: editing?.completed ?? false,
    completedAt: editing?.completedAt,
    priority: draft.priority,
    category: 'goal',
    dueDate: draft.dueDate || undefined,
    goalTag: editing?.goalTag,
    projectId,
  };
}

// ── Wiki ──

/** A project's pages, overview first, then most recently updated. */
export function getProjectPages(pages: readonly ProjectPage[], projectId: string | null): ProjectPage[] {
  return pages
    .filter(page => page.projectId === projectId)
    .sort((left, right) => {
      if (left.isOverview !== right.isOverview) return left.isOverview ? -1 : 1;
      return right.updatedAt.localeCompare(left.updatedAt);
    });
}

export function searchProjectPages(pages: ProjectPage[], search: string): ProjectPage[] {
  const query = search.trim().toLowerCase();
  if (!query) return pages;
  return pages.filter(page => page.title.toLowerCase().includes(query) || page.content.toLowerCase().includes(query));
}

/** The requested page when it belongs to this list, else the first page. */
export function resolvePageId(pages: readonly ProjectPage[], requestedId: string | null): string | null {
  if (requestedId && pages.some(page => page.id === requestedId)) return requestedId;
  return pages[0]?.id || null;
}

export const NEW_WIKI_PAGE = {
  title: 'New Page',
  content: '# New Page\n\nAdd references, decisions, or setup notes here.',
} as const;

// ── Project editor ──

export interface ProjectDraft {
  name: string;
  summary: string;
  kind: ProjectKind;
  repositoryUrl: string;
  deploymentUrl: string;
  status: ProjectStatus;
  tagsInput: string;
  pinned: boolean;
}

export function projectDraftFrom(project?: Project | null): ProjectDraft {
  return {
    name: project?.name || '',
    summary: project?.summary || '',
    kind: project?.kind || 'other',
    repositoryUrl: project?.links?.find(link => link.kind === 'repository')?.url || '',
    deploymentUrl: project?.links?.find(link => link.kind === 'deployment')?.url || '',
    status: project?.status || 'active',
    tagsInput: project?.tags.join(', ') || '',
    pinned: project?.isPinned || false,
  };
}

/** Archived projects cannot stay pinned, so archiving a draft unpins it. */
export function withDraftStatus(draft: ProjectDraft, status: ProjectStatus): ProjectDraft {
  return { ...draft, status, pinned: status === 'archived' ? false : draft.pinned };
}

export function canSaveProjectDraft(draft: ProjectDraft): boolean {
  return Boolean(draft.name.trim());
}

/** Comma-separated tags, trimmed and de-duplicated in first-seen order. */
export function parseTagsInput(value: string): string[] {
  return [...new Set(value.split(',').map(tag => tag.trim()).filter(Boolean))];
}

export function getProjectInitials(name: string): string {
  return name.trim().split(/\s+/).slice(0, 2).map(part => part[0]?.toUpperCase()).join('');
}

export type ProjectReferenceFields = Pick<
  Project,
  'name' | 'summary' | 'kind' | 'links' | 'setupSteps' | 'runRecipes' | 'preview' | 'verifiedAt' | 'tags'
>;

/**
 * The reference fields a draft writes. The form edits only the repository and
 * live links; every other link, setup step, recipe, and preview is kept.
 */
export function buildProjectReference(draft: ProjectDraft, existing?: Project | null): ProjectReferenceFields {
  const name = draft.name.trim();
  const linkIdPrefix = existing?.catalogKey || 'custom';
  const repositoryUrl = draft.repositoryUrl.trim();
  const deploymentUrl = draft.deploymentUrl.trim();
  const retainedLinks = (existing?.links || []).filter(link => link.kind !== 'repository' && link.kind !== 'deployment');
  const preview: ProjectPreviewStyle = existing?.preview || {
    icon: getProjectInitials(name),
    ...DEFAULT_PROJECT_PREVIEW_COLORS,
  };

  return {
    name,
    summary: draft.summary.trim(),
    kind: draft.kind,
    links: [
      ...retainedLinks,
      ...(repositoryUrl ? [{ id: `${linkIdPrefix}:repository`, kind: 'repository' as const, label: 'GitHub repository', url: repositoryUrl }] : []),
      ...(deploymentUrl ? [{ id: `${linkIdPrefix}:deployment`, kind: 'deployment' as const, label: 'Live project', url: deploymentUrl }] : []),
    ],
    setupSteps: existing?.setupSteps || [],
    runRecipes: existing?.runRecipes || [],
    preview,
    verifiedAt: existing?.verifiedAt,
    tags: parseTagsInput(draft.tagsInput),
  };
}

export type NewProject = Omit<Project, 'id' | 'createdAt' | 'updatedAt'>;

export function buildNewProject(draft: ProjectDraft): NewProject {
  return {
    ...buildProjectReference(draft),
    status: draft.status,
    isPinned: draft.status !== 'archived' && draft.pinned,
  };
}

/**
 * The ordered writes that apply an edited draft to an existing project.
 * Archive and pin go through their own store operations because they move the
 * project between catalogue sections; undefined means "leave unchanged".
 */
export interface ProjectEditPlan {
  reference: ProjectReferenceFields;
  archived?: boolean;
  status?: ProjectStatus;
  pinned?: boolean;
}

export function planProjectEdit(project: Project, draft: ProjectDraft): ProjectEditPlan {
  const wasArchived = project.status === 'archived';
  const willBeArchived = draft.status === 'archived';
  const plan: ProjectEditPlan = { reference: buildProjectReference(draft, project) };
  if (wasArchived !== willBeArchived) plan.archived = willBeArchived;
  if (willBeArchived) return plan;

  // Unarchiving restores statusBeforeArchive; only write status when the draft asks for another one.
  if (!wasArchived || draft.status !== (project.statusBeforeArchive || 'active')) plan.status = draft.status;
  if (project.isPinned !== draft.pinned) plan.pinned = draft.pinned;
  return plan;
}
