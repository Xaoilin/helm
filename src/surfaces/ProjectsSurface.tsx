import {
  useCallback,
  useEffect,
  useEffectEvent,
  useMemo,
  useRef,
  useState,
  type KeyboardEvent as ReactKeyboardEvent,
} from 'react';
import {
  DragDropProvider,
  type DragEndEvent,
  type DragStartEvent,
} from '@dnd-kit/react';
import { arrayMove } from '@dnd-kit/helpers';
import { isSortable } from '@dnd-kit/react/sortable';
import {
  ProjectCard,
  ProjectReferenceDrawer,
  type ProjectMoveDirection,
} from '../components/projects/ProjectCatalog';
import {
  getProjectAvailability,
  type ProjectCatalogFilter,
} from '../components/projects/projectCatalogModel';
import { useShell } from "../store/ShellContext";
import { useProjectContext } from "../store/contexts/ProjectContext";
import { useTaskContext } from "../store/contexts/TaskContext";
import { useProjectRemovalWorkflow } from '../store/workflows/useProjectRemovalWorkflow';
import { ProjectInventorySection } from './InventorySurface';
import {
  compareProjectCatalogueOrder,
  getOrderedProjectsInSection,
} from '../store/projectOrdering';
import type {
  Project,
  ProjectCatalogueSection,
  ProjectKind,
  ProjectPage,
  ProjectStatus,
  Task,
  TaskPriority,
} from '../types/domain';

type ProjectTab = 'overview' | 'board' | 'milestones' | 'inventory' | 'wiki';
type BoardColumn = 'backlog' | 'next_up' | 'in_progress' | 'blocked' | 'done';

const PROJECT_STATUS_OPTIONS: ProjectStatus[] = ['planning', 'active', 'blocked', 'completed', 'archived'];
const PROJECT_KIND_OPTIONS: Array<{ value: ProjectKind; label: string }> = [
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
const PROJECT_CATALOG_FILTERS: Array<{ value: ProjectCatalogFilter; label: string }> = [
  { value: 'all', label: 'All' },
  { value: 'active', label: 'Active' },
  { value: 'live', label: 'Live' },
  { value: 'hardware', label: 'Hardware' },
  { value: 'reference', label: 'Reference' },
];
const PROJECT_TABS: Array<{ key: ProjectTab; label: string }> = [
  { key: 'overview', label: 'Overview' },
  { key: 'board', label: 'Board' },
  { key: 'milestones', label: 'Milestones' },
  { key: 'inventory', label: 'Inventory' },
  { key: 'wiki', label: 'Wiki' },
];
const BOARD_COLUMNS: Array<{ key: BoardColumn; label: string }> = [
  { key: 'backlog', label: 'Backlog' },
  { key: 'next_up', label: 'Next Up' },
  { key: 'in_progress', label: 'In Progress' },
  { key: 'blocked', label: 'Blocked' },
  { key: 'done', label: 'Done' },
];
const BOARD_COLUMN_SEQUENCE: BoardColumn[] = BOARD_COLUMNS.map(column => column.key);

function toLocalDateStr(date: Date): string {
  return `${date.getFullYear()}-${String(date.getMonth() + 1).padStart(2, '0')}-${String(date.getDate()).padStart(2, '0')}`;
}

function formatDateTime(value: string | undefined): string {
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

function parseTagsInput(value: string): string[] {
  return [...new Set(value.split(',').map(tag => tag.trim()).filter(Boolean))];
}

function getBoardColumn(task: Task): BoardColumn {
  if (task.completed) return 'done';
  return task.workflowState || 'backlog';
}

function getStatusLabel(status: ProjectStatus): string {
  switch (status) {
    case 'planning': return 'Planning';
    case 'active': return 'Active';
    case 'blocked': return 'Blocked';
    case 'completed': return 'Completed';
    case 'archived': return 'Archived';
  }
}

function getStatusTone(status: ProjectStatus): { background: string; color: string; border: string } {
  switch (status) {
    case 'planning':
      return { background: 'rgba(59, 130, 246, 0.12)', color: '#93c5fd', border: 'rgba(59, 130, 246, 0.4)' };
    case 'active':
      return { background: 'rgba(34, 197, 94, 0.12)', color: '#86efac', border: 'rgba(34, 197, 94, 0.35)' };
    case 'blocked':
      return { background: 'rgba(245, 158, 11, 0.12)', color: '#fcd34d', border: 'rgba(245, 158, 11, 0.35)' };
    case 'completed':
      return { background: 'rgba(168, 85, 247, 0.12)', color: '#d8b4fe', border: 'rgba(168, 85, 247, 0.35)' };
    case 'archived':
      return { background: 'rgba(107, 114, 128, 0.12)', color: '#d1d5db', border: 'rgba(107, 114, 128, 0.35)' };
  }
}

function sortProjectTasks(tasks: Task[]): Task[] {
  return [...tasks].sort((left, right) => {
    const leftOrder = typeof left.boardOrder === 'number' ? left.boardOrder : Number.MAX_SAFE_INTEGER;
    const rightOrder = typeof right.boardOrder === 'number' ? right.boardOrder : Number.MAX_SAFE_INTEGER;
    if (leftOrder !== rightOrder) return leftOrder - rightOrder;
    if (left.dueDate && right.dueDate && left.dueDate !== right.dueDate) return left.dueDate.localeCompare(right.dueDate);
    return right.updatedAt.localeCompare(left.updatedAt);
  });
}

function buildProjectActivity(projectTasks: Task[], projectPages: ProjectPage[]): Array<{ id: string; label: string; updatedAt: string; type: 'task' | 'page' }> {
  return [
    ...projectTasks.map(task => ({
      id: task.id,
      label: task.title,
      updatedAt: task.updatedAt,
      type: 'task' as const,
    })),
    ...projectPages.map(page => ({
      id: page.id,
      label: page.title,
      updatedAt: page.updatedAt,
      type: 'page' as const,
    })),
  ]
    .sort((left, right) => right.updatedAt.localeCompare(left.updatedAt))
    .slice(0, 6);
}

function StatusPill({ status }: { status: ProjectStatus }) {
  const tone = getStatusTone(status);
  return (
    <span
      style={{
        display: 'inline-flex',
        alignItems: 'center',
        gap: 6,
        padding: '4px 10px',
        borderRadius: 999,
        border: `1px solid ${tone.border}`,
        background: tone.background,
        color: tone.color,
        fontSize: 12,
        fontWeight: 600,
      }}
    >
      {getStatusLabel(status)}
    </span>
  );
}

function MetricCard({ label, value, note }: { label: string; value: string; note?: string }) {
  return (
    <div className="card" style={{ padding: 16 }}>
      <div style={{ fontSize: 11, textTransform: 'uppercase', letterSpacing: 0.6, color: '#6b6f85', marginBottom: 8 }}>{label}</div>
      <div style={{ fontSize: 28, fontWeight: 700, color: '#f5f7ff' }}>{value}</div>
      {note && <div style={{ fontSize: 12, color: '#8b8fa3', marginTop: 6 }}>{note}</div>}
    </div>
  );
}

function ProjectWikiEditor({
  page,
  onSave,
  onDelete,
}: {
  page: ProjectPage;
  onSave: (title: string, content: string) => void;
  onDelete: () => void;
}) {
  const [titleDraft, setTitleDraft] = useState(page.title);
  const [contentDraft, setContentDraft] = useState(page.content);

  return (
    <>
      <div style={{ display: 'flex', justifyContent: 'space-between', gap: 12, flexWrap: 'wrap', alignItems: 'center' }}>
        <div style={{ fontSize: 16, fontWeight: 700 }}>
          {page.isOverview ? 'Project Overview Page' : 'Project Wiki Page'}
        </div>
        <div className="actions-row" style={{ margin: 0 }}>
          <button className="btn btn-secondary btn-sm" onClick={() => onSave(titleDraft, contentDraft)}>Save Page</button>
          {!page.isOverview && (
            <button className="btn btn-danger btn-sm" onClick={onDelete}>Delete</button>
          )}
        </div>
      </div>

      <div style={{ fontSize: 12, color: '#8b8fa3' }}>
        Last updated {formatDateTime(page.updatedAt)}. Pages are account-backed markdown-style notes.
      </div>

      <input className="form-input" value={titleDraft} onChange={event => setTitleDraft(event.target.value)} placeholder="Page title" />
      <div className="project-wiki-editor">
        <textarea
          className="form-input"
          value={contentDraft}
          onChange={event => setContentDraft(event.target.value)}
          style={{ minHeight: 320 }}
          placeholder="Write markdown notes, commands, setup steps, and decisions here."
        />
        <div style={{ padding: 16, borderRadius: 14, background: '#121620', border: '1px solid #23283c' }}>
          <div style={{ fontSize: 11, textTransform: 'uppercase', letterSpacing: 0.7, color: '#6b6f85', marginBottom: 10 }}>Preview</div>
          <pre style={{ margin: 0, whiteSpace: 'pre-wrap', wordBreak: 'break-word', fontFamily: 'inherit', color: '#e5e7eb', lineHeight: 1.6 }}>
            {contentDraft || 'Nothing written yet.'}
          </pre>
        </div>
      </div>
    </>
  );
}

function ProjectCatalogueSectionView({
  section,
  title,
  description,
  projects,
  collapsed = false,
  collapsible = false,
  reorderEnabled,
  onToggleCollapsed,
  getActiveWorkCount,
  onOpen,
  onPinChange,
  onArchiveChange,
  onReorder,
  onAnnounce,
}: {
  section: ProjectCatalogueSection;
  title: string;
  description: string;
  projects: Project[];
  collapsed?: boolean;
  collapsible?: boolean;
  reorderEnabled: boolean;
  onToggleCollapsed?: () => void;
  getActiveWorkCount: (projectId: string) => number;
  onOpen: (project: Project) => void;
  onPinChange: (project: Project, pinned: boolean) => void;
  onArchiveChange: (project: Project, archived: boolean) => void;
  onReorder: (section: ProjectCatalogueSection, orderedIds: string[]) => void;
  onAnnounce: (message: string) => void;
}) {
  const sectionTitleId = `project-section-${section}-title`;
  const sectionGridId = `project-section-${section}-grid`;
  const orderedIds = projects.map(project => project.id);

  function moveProject(project: Project, direction: ProjectMoveDirection): void {
    const currentIndex = orderedIds.indexOf(project.id);
    const nextIndex = direction === 'earlier' ? currentIndex - 1 : currentIndex + 1;
    if (!reorderEnabled || currentIndex < 0 || nextIndex < 0 || nextIndex >= orderedIds.length) return;
    onReorder(section, arrayMove(orderedIds, currentIndex, nextIndex));
    onAnnounce(`${project.name} moved to position ${nextIndex + 1} of ${orderedIds.length} in ${title}.`);
  }

  function handleDragStart(event: DragStartEvent): void {
    const sourceId = event.operation.source?.id;
    const sourceIndex = orderedIds.findIndex(id => id === String(sourceId));
    const sourceProject = projects[sourceIndex];
    if (sourceProject) {
      onAnnounce(`Picked up ${sourceProject.name}, position ${sourceIndex + 1} of ${projects.length} in ${title}.`);
    }
  }

  function handleDragEnd(event: DragEndEvent): void {
    const source = event.operation.source;
    if (!isSortable(source)) {
      onAnnounce('Project order was not changed.');
      return;
    }
    const sourceProject = projects.find(project => project.id === String(source.id));

    if (event.canceled) {
      if (sourceProject) onAnnounce(`Reordering ${sourceProject.name} cancelled.`);
      return;
    }
    if (
      !sourceProject
      || source.initialGroup !== section
      || source.group !== section
      || source.initialIndex < 0
      || source.index < 0
      || source.initialIndex >= orderedIds.length
      || source.index >= orderedIds.length
    ) {
      onAnnounce('Project order was not changed.');
      return;
    }
    if (source.initialIndex === source.index) {
      onAnnounce(`${sourceProject.name} remains at position ${source.index + 1} of ${projects.length}.`);
      return;
    }

    onReorder(section, arrayMove(orderedIds, source.initialIndex, source.index));
    onAnnounce(`${sourceProject.name} moved to position ${source.index + 1} of ${projects.length} in ${title}.`);
    requestAnimationFrame(() => {
      Array.from(document.querySelectorAll<HTMLButtonElement>('[data-project-drag-id]'))
        .find(button => button.dataset.projectDragId === sourceProject.id)
        ?.focus();
    });
  }

  return (
    <section className={`project-catalog-section project-catalog-section-${section}`} aria-labelledby={sectionTitleId}>
      <header className="project-catalog-section-header">
        <div>
          <div className="project-catalog-section-title-row">
            <h2 id={sectionTitleId}>{title}</h2>
            <span>{projects.length}</span>
          </div>
          <p>{description}</p>
        </div>
        {collapsible && (
          <button
            type="button"
            className="project-archive-disclosure"
            aria-expanded={!collapsed}
            aria-controls={sectionGridId}
            disabled={projects.length === 0}
            onClick={onToggleCollapsed}
          >
            {collapsed ? 'Show archived' : 'Hide archived'}
            <span aria-hidden="true" className={collapsed ? '' : 'is-open'}>⌄</span>
          </button>
        )}
      </header>

      <div id={sectionGridId} className="project-catalog-section-body" hidden={collapsed}>
        {!collapsed && projects.length > 0 && (
          <DragDropProvider onDragStart={handleDragStart} onDragEnd={handleDragEnd}>
            <div className="project-catalog-grid" role="list">
              {projects.map((project, index) => (
                <ProjectCard
                  key={project.id}
                  project={project}
                  activeWorkCount={getActiveWorkCount(project.id)}
                  section={section}
                  index={index}
                  sectionSize={projects.length}
                  reorderEnabled={reorderEnabled}
                  onOpen={onOpen}
                  onPinChange={pinned => onPinChange(project, pinned)}
                  onArchiveChange={archived => onArchiveChange(project, archived)}
                  onMove={direction => moveProject(project, direction)}
                />
              ))}
            </div>
          </DragDropProvider>
        )}
        {!collapsed && projects.length === 0 && (
          <p className="project-catalog-section-empty">
            {section === 'archived' ? 'No archived projects.' : `No ${title.toLowerCase()} in this view.`}
          </p>
        )}
      </div>
    </section>
  );
}

export default function ProjectsSurface() {
  const shell = useShell();
  const projects = useProjectContext();
  const setProjectPinnedInStore = projects.setProjectPinned;
  const setProjectArchivedInStore = projects.setProjectArchived;
  const reorderProjectSectionInStore = projects.reorderProjectSection;
  const tasks = useTaskContext();
  const removeProject = useProjectRemovalWorkflow();
  const today = toLocalDateStr(new Date());

  const [activeTab, setActiveTab] = useState<ProjectTab>('overview');
  const [selectedProjectIdState, setSelectedProjectIdState] = useState<string | null>(null);
  const [detailProjectId, setDetailProjectId] = useState<string | null>(null);
  const [managedProjectId, setManagedProjectId] = useState<string | null>(null);
  const [searchQuery, setSearchQuery] = useState('');
  const [statusFilter, setStatusFilter] = useState<'all' | ProjectStatus>('all');
  const [kindFilter, setKindFilter] = useState<'all' | ProjectKind>('all');
  const [catalogFilter, setCatalogFilter] = useState<ProjectCatalogFilter>('all');
  const [tagFilter, setTagFilter] = useState<'all' | string>('all');
  const [archivedExpanded, setArchivedExpanded] = useState(false);
  const [catalogAnnouncement, setCatalogAnnouncement] = useState('');
  const [showProjectForm, setShowProjectForm] = useState(false);
  const [editingProject, setEditingProject] = useState<Project | null>(null);
  const [projectName, setProjectName] = useState('');
  const [projectSummary, setProjectSummary] = useState('');
  const [projectKind, setProjectKind] = useState<ProjectKind>('other');
  const [projectRepositoryUrl, setProjectRepositoryUrl] = useState('');
  const [projectDeploymentUrl, setProjectDeploymentUrl] = useState('');
  const [projectStatus, setProjectStatus] = useState<ProjectStatus>('active');
  const [projectTagsInput, setProjectTagsInput] = useState('');
  const [projectPinned, setProjectPinned] = useState(false);
  const [draggedTaskId, setDraggedTaskId] = useState<string | null>(null);
  const [newBoardTaskTitle, setNewBoardTaskTitle] = useState('');
  const [newBoardTaskDueDate, setNewBoardTaskDueDate] = useState('');
  const [newBoardTaskPriority, setNewBoardTaskPriority] = useState<TaskPriority>('medium');
  const [showMilestoneForm, setShowMilestoneForm] = useState(false);
  const [editingMilestone, setEditingMilestone] = useState<Task | null>(null);
  const [milestoneTitle, setMilestoneTitle] = useState('');
  const [milestoneDescription, setMilestoneDescription] = useState('');
  const [milestoneDueDate, setMilestoneDueDate] = useState('');
  const [milestonePriority, setMilestonePriority] = useState<TaskPriority>('medium');
  const [wikiSearch, setWikiSearch] = useState('');
  const [selectedPageIdState, setSelectedPageIdState] = useState<string | null>(null);
  const managementBackButtonRef = useRef<HTMLButtonElement>(null);
  const managementReturnFocusProjectId = useRef<string | null>(null);
  const projectFormRef = useRef<HTMLDivElement>(null);
  const projectFormReturnFocus = useRef<HTMLElement | null>(null);
  const projectFormFallbackProjectId = useRef<string | null>(null);

  useEffect(() => {
    if (managedProjectId) {
      managementBackButtonRef.current?.focus();
      return;
    }

    const returnProjectId = managementReturnFocusProjectId.current;
    if (!returnProjectId) return;
    managementReturnFocusProjectId.current = null;
    Array.from(document.querySelectorAll<HTMLElement>('[data-project-open-id]'))
      .find(element => element.dataset.projectOpenId === returnProjectId)
      ?.focus();
  }, [managedProjectId]);

  useEffect(() => {
    if (!showProjectForm || !projectFormRef.current) return;
    const dialog = projectFormRef.current;
    const focusNameInput = () => dialog.querySelector<HTMLElement>('#project-name')?.focus();
    focusNameInput();

    function handleKeyDown(event: KeyboardEvent) {
      if (event.key === 'Escape') {
        event.preventDefault();
        setShowProjectForm(false);
        return;
      }
      if (event.key !== 'Tab') return;

      const focusable = Array.from(dialog.querySelectorAll<HTMLElement>(
        'a[href], button:not([disabled]), input:not([disabled]), select:not([disabled]), textarea:not([disabled]), [tabindex]:not([tabindex="-1"])',
      )).filter(element => !element.hasAttribute('hidden'));
      if (focusable.length === 0) return;
      const first = focusable[0];
      const last = focusable[focusable.length - 1];
      if (event.shiftKey && document.activeElement === first) {
        event.preventDefault();
        last?.focus();
      } else if (!event.shiftKey && document.activeElement === last) {
        event.preventDefault();
        first?.focus();
      }
    }

    document.addEventListener('keydown', handleKeyDown);
    return () => {
      document.removeEventListener('keydown', handleKeyDown);
      const returnTarget = projectFormReturnFocus.current;
      if (returnTarget?.isConnected) {
        returnTarget.focus();
        return;
      }
      const fallbackId = projectFormFallbackProjectId.current;
      if (fallbackId) {
        Array.from(document.querySelectorAll<HTMLElement>('[data-project-open-id]'))
          .find(element => element.dataset.projectOpenId === fallbackId)
          ?.focus();
      }
    };
  }, [showProjectForm]);

  const handleAssistantNavigation = useEffectEvent((requestId: string, revealProjectId?: string) => {
    if (revealProjectId && projects.projects.some(project => project.id === revealProjectId)) {
      setSelectedProjectIdState(revealProjectId);
      setDetailProjectId(revealProjectId);
      setManagedProjectId(null);
      setActiveTab('overview');
      setSearchQuery('');
      setStatusFilter('all');
      setKindFilter('all');
      setCatalogFilter('all');
      setTagFilter('all');
    }

    shell.dismissAssistantNavigationRequest(requestId);
  });

  const availableTags = useMemo(() => {
    const tags = new Set<string>();
    projects.projects.forEach(project => project.tags.forEach(tag => tags.add(tag)));
    return [...tags].sort((left, right) => left.localeCompare(right));
  }, [projects.projects]);

  const filteredProjects = useMemo(() => {
    const query = searchQuery.trim().toLowerCase();
    return projects.projects.filter(project => {
      const availability = getProjectAvailability(project);
      const matchesQuery = !query
        || project.name.toLowerCase().includes(query)
        || project.summary.toLowerCase().includes(query)
        || project.tags.some(tag => tag.toLowerCase().includes(query))
        || (project.links || []).some(link => link.label.toLowerCase().includes(query));
      const matchesStatus = statusFilter === 'all' || project.status === statusFilter;
      const matchesKind = kindFilter === 'all' || project.kind === kindFilter;
      const matchesTag = tagFilter === 'all' || project.tags.includes(tagFilter);
      const matchesCatalogFilter = catalogFilter === 'all'
        || (catalogFilter === 'active' && (project.status === 'active' || project.status === 'planning'))
        || (catalogFilter === 'live' && availability.key === 'live')
        || (catalogFilter === 'hardware' && project.kind === 'hardware')
        || (catalogFilter === 'reference' && availability.key === 'reference');
      return matchesQuery && matchesStatus && matchesKind && matchesTag && matchesCatalogFilter;
    });
  }, [projects.projects, catalogFilter, kindFilter, searchQuery, statusFilter, tagFilter]);

  const selectedProjectId = useMemo(() => {
    const requestedId = managedProjectId || detailProjectId || selectedProjectIdState;
    return requestedId && projects.projects.some(project => project.id === requestedId)
      ? requestedId
      : null;
  }, [projects.projects, detailProjectId, managedProjectId, selectedProjectIdState]);

  const selectedProject = useMemo(
    () => projects.projects.find(project => project.id === selectedProjectId) || null,
    [projects.projects, selectedProjectId],
  );
  const detailProject = useMemo(
    () => projects.projects.find(project => project.id === detailProjectId) || null,
    [projects.projects, detailProjectId],
  );

  const selectedProjectTasks = useMemo(
    () => tasks.tasks.filter(task => task.projectId === selectedProjectId),
    [tasks.tasks, selectedProjectId],
  );
  const selectedProjectBoardTasks = useMemo(
    () => selectedProjectTasks.filter(task => task.category === 'task'),
    [selectedProjectTasks],
  );
  const selectedProjectMilestones = useMemo(
    () => selectedProjectTasks.filter(task => task.category === 'goal'),
    [selectedProjectTasks],
  );
  const selectedProjectPages = useMemo(() => (
    projects.projectPages
      .filter(page => page.projectId === selectedProjectId)
      .sort((left, right) => {
        if (left.isOverview !== right.isOverview) return left.isOverview ? -1 : 1;
        return right.updatedAt.localeCompare(left.updatedAt);
      })
  ), [projects.projectPages, selectedProjectId]);

  const selectedPageId = useMemo(() => {
    if (selectedPageIdState && selectedProjectPages.some(page => page.id === selectedPageIdState)) {
      return selectedPageIdState;
    }
    return selectedProjectPages[0]?.id || null;
  }, [selectedPageIdState, selectedProjectPages]);

  const selectedPage = useMemo(
    () => selectedProjectPages.find(page => page.id === selectedPageId) || null,
    [selectedProjectPages, selectedPageId],
  );

  useEffect(() => {
    const request = shell.assistantNavigationRequest;
    if (!request || request.surface !== 'projects') return;

    handleAssistantNavigation(request.id, request.surfaceState?.projects?.revealProjectId);
  }, [shell.assistantNavigationRequest]);

  const closeProjectDetails = useCallback(() => {
    setDetailProjectId(null);
  }, []);

  const groupedProjects = useMemo(() => ({
    pinned: getOrderedProjectsInSection(filteredProjects, 'pinned'),
    projects: getOrderedProjectsInSection(filteredProjects, 'projects'),
    active: filteredProjects.filter(project => (
      project.status !== 'archived'
      && !project.isPinned
      && (project.status === 'planning' || project.status === 'active' || project.status === 'completed')
    )).sort(compareProjectCatalogueOrder),
    blocked: filteredProjects.filter(project => (
      !project.isPinned && project.status === 'blocked'
    )).sort(compareProjectCatalogueOrder),
    archived: getOrderedProjectsInSection(filteredProjects, 'archived'),
  }), [filteredProjects]);
  const isCatalogueFiltered = Boolean(
    searchQuery.trim()
    || statusFilter !== 'all'
    || kindFilter !== 'all'
    || catalogFilter !== 'all'
    || tagFilter !== 'all',
  );

  useEffect(() => {
    if (
      groupedProjects.archived.length > 0
      && (searchQuery.trim() || statusFilter === 'archived')
    ) {
      setArchivedExpanded(true);
    }
  }, [groupedProjects.archived.length, searchQuery, statusFilter]);

  const clearCatalogueFilters = useCallback(() => {
    setSearchQuery('');
    setStatusFilter('all');
    setKindFilter('all');
    setCatalogFilter('all');
    setTagFilter('all');
  }, []);

  const focusProjectControl = useCallback((
    projectId: string,
    control: 'pin' | 'unarchive',
  ) => {
    requestAnimationFrame(() => {
      const selector = control === 'pin' ? '[data-project-pin-id]' : '[data-project-unarchive-id]';
      const dataKey = control === 'pin' ? 'projectPinId' : 'projectUnarchiveId';
      Array.from(document.querySelectorAll<HTMLButtonElement>(selector))
        .find(button => button.dataset[dataKey] === projectId)
        ?.focus();
    });
  }, []);

  const changeProjectPinned = useCallback((
    project: Project,
    pinned: boolean,
    focusCard = true,
  ) => {
    setProjectPinnedInStore(project.id, pinned);
    setCatalogAnnouncement(`${project.name} ${pinned ? 'pinned' : 'unpinned'}.`);
    if (focusCard) focusProjectControl(project.id, 'pin');
  }, [focusProjectControl, setProjectPinnedInStore]);

  const changeProjectArchived = useCallback((
    project: Project,
    archived: boolean,
    focusCard = true,
  ) => {
    setProjectArchivedInStore(project.id, archived);
    setCatalogAnnouncement(`${project.name} ${archived ? 'archived' : 'restored to Projects'}.`);
    if (archived) {
      clearCatalogueFilters();
      setArchivedExpanded(true);
    } else if (statusFilter === 'archived') {
      setStatusFilter('all');
    }
    if (focusCard) focusProjectControl(project.id, archived ? 'unarchive' : 'pin');
  }, [clearCatalogueFilters, focusProjectControl, setProjectArchivedInStore, statusFilter]);

  const reorderProjects = useCallback((
    section: ProjectCatalogueSection,
    orderedIds: string[],
  ) => {
    reorderProjectSectionInStore(section, orderedIds);
  }, [reorderProjectSectionInStore]);

  const openCount = selectedProjectTasks.filter(task => !task.completed).length;
  const blockedCount = selectedProjectBoardTasks.filter(task => !task.completed && task.workflowState === 'blocked').length;
  const overdueCount = selectedProjectTasks.filter(task => !task.completed && task.dueDate && task.dueDate < today).length;
  const completedCount = selectedProjectTasks.filter(task => task.completed).length;
  const completedMilestones = selectedProjectMilestones.filter(task => task.completed).length;
  const recentActivity = buildProjectActivity(selectedProjectTasks, selectedProjectPages);
  const liveProjectCount = projects.projects.filter(project => {
    return getProjectAvailability(project).key === 'live';
  }).length;

  const wikiResults = useMemo(() => {
    const query = wikiSearch.trim().toLowerCase();
    if (!query) return selectedProjectPages;
    return selectedProjectPages.filter(page =>
      page.title.toLowerCase().includes(query)
      || page.content.toLowerCase().includes(query),
    );
  }, [selectedProjectPages, wikiSearch]);

  const boardTasksByColumn = useMemo(() => {
    const map: Record<BoardColumn, Task[]> = {
      backlog: [],
      next_up: [],
      in_progress: [],
      blocked: [],
      done: [],
    };

    selectedProjectBoardTasks.forEach(task => {
      map[getBoardColumn(task)].push(task);
    });

    return {
      backlog: sortProjectTasks(map.backlog),
      next_up: sortProjectTasks(map.next_up),
      in_progress: sortProjectTasks(map.in_progress),
      blocked: sortProjectTasks(map.blocked),
      done: sortProjectTasks(map.done),
    };
  }, [selectedProjectBoardTasks]);

  function getNextBoardOrder(column: Exclude<BoardColumn, 'done'>, excludeTaskId?: string): number {
    const tasks = boardTasksByColumn[column].filter(task => task.id !== excludeTaskId);
    const highest = tasks.reduce((max, task) => Math.max(max, task.boardOrder ?? 0), 0);
    return highest + 1;
  }

  function resetProjectForm(project?: Project | null): void {
    setProjectName(project?.name || '');
    setProjectSummary(project?.summary || '');
    setProjectKind(project?.kind || 'other');
    setProjectRepositoryUrl(project?.links?.find(link => link.kind === 'repository')?.url || '');
    setProjectDeploymentUrl(project?.links?.find(link => link.kind === 'deployment')?.url || '');
    setProjectStatus(project?.status || 'active');
    setProjectTagsInput(project?.tags.join(', ') || '');
    setProjectPinned(project?.isPinned || false);
    setEditingProject(project || null);
  }

  function openCreateProject(): void {
    projectFormReturnFocus.current = document.activeElement instanceof HTMLElement
      ? document.activeElement
      : null;
    projectFormFallbackProjectId.current = null;
    resetProjectForm(null);
    setShowProjectForm(true);
  }

  function openEditProject(project: Project): void {
    projectFormReturnFocus.current = document.activeElement instanceof HTMLElement
      ? document.activeElement
      : null;
    projectFormFallbackProjectId.current = project.id;
    resetProjectForm(project);
    setShowProjectForm(true);
  }

  function saveProject(): void {
    if (!projectName.trim()) return;

    const existingLinks = editingProject?.links || [];
    const retainedLinks = existingLinks.filter(link => link.kind !== 'repository' && link.kind !== 'deployment');
    const repositoryUrl = projectRepositoryUrl.trim();
    const deploymentUrl = projectDeploymentUrl.trim();
    const referencePayload = {
      name: projectName.trim(),
      summary: projectSummary.trim(),
      kind: projectKind,
      links: [
        ...retainedLinks,
        ...(repositoryUrl ? [{
          id: `${editingProject?.catalogKey || 'custom'}:repository`,
          kind: 'repository' as const,
          label: 'GitHub repository',
          url: repositoryUrl,
        }] : []),
        ...(deploymentUrl ? [{
          id: `${editingProject?.catalogKey || 'custom'}:deployment`,
          kind: 'deployment' as const,
          label: 'Live project',
          url: deploymentUrl,
        }] : []),
      ],
      setupSteps: editingProject?.setupSteps || [],
      runRecipes: editingProject?.runRecipes || [],
      preview: editingProject?.preview || {
        icon: projectName.trim().split(/\s+/).slice(0, 2).map(part => part[0]?.toUpperCase()).join(''),
        accentColor: '#777dff',
        backgroundColor: '#171b2e',
      },
      verifiedAt: editingProject?.verifiedAt,
      tags: parseTagsInput(projectTagsInput),
    };

    if (editingProject) {
      const wasArchived = editingProject.status === 'archived';
      const willBeArchived = projectStatus === 'archived';
      projects.updateProject(editingProject.id, referencePayload);
      if (wasArchived !== willBeArchived) {
        changeProjectArchived(editingProject, willBeArchived, false);
      }
      if (!willBeArchived) {
        if (!wasArchived || projectStatus !== (editingProject.statusBeforeArchive || 'active')) {
          projects.updateProject(editingProject.id, { status: projectStatus });
        }
        if (editingProject.isPinned !== projectPinned) {
          changeProjectPinned(editingProject, projectPinned, false);
        }
      }
      setSelectedProjectIdState(editingProject.id);
    } else {
      const createdId = projects.addProject({
        ...referencePayload,
        status: projectStatus,
        isPinned: projectStatus !== 'archived' && projectPinned,
      });
      setSelectedProjectIdState(createdId);
      setActiveTab('overview');
    }

    setShowProjectForm(false);
  }


  async function copyProjectReference(value: string, label: string): Promise<void> {
    try {
      await navigator.clipboard.writeText(value);
      setCatalogAnnouncement(`Copied ${label}.`);
    } catch {
      setCatalogAnnouncement(`Unable to copy ${label}.`);
    }
  }

  function handleProjectTabKeyDown(
    event: ReactKeyboardEvent<HTMLButtonElement>,
    currentTab: ProjectTab,
  ): void {
    const currentIndex = PROJECT_TABS.findIndex(tab => tab.key === currentTab);
    let nextIndex = currentIndex;
    if (event.key === 'ArrowRight') nextIndex = (currentIndex + 1) % PROJECT_TABS.length;
    else if (event.key === 'ArrowLeft') nextIndex = (currentIndex - 1 + PROJECT_TABS.length) % PROJECT_TABS.length;
    else if (event.key === 'Home') nextIndex = 0;
    else if (event.key === 'End') nextIndex = PROJECT_TABS.length - 1;
    else return;

    event.preventDefault();
    const nextTab = PROJECT_TABS[nextIndex].key;
    setActiveTab(nextTab);
    requestAnimationFrame(() => document.getElementById(`project-tab-${nextTab}`)?.focus());
  }

  function addBoardTask(): void {
    if (!selectedProject || !newBoardTaskTitle.trim()) return;

    tasks.addTask({
      title: newBoardTaskTitle.trim(),
      description: '',
      completed: false,
      priority: newBoardTaskPriority,
      category: 'task',
      dueDate: newBoardTaskDueDate || undefined,
      projectId: selectedProject.id,
      workflowState: 'backlog',
      boardOrder: getNextBoardOrder('backlog'),
    });

    setNewBoardTaskTitle('');
    setNewBoardTaskDueDate('');
    setNewBoardTaskPriority('medium');
  }

  function moveBoardTask(task: Task, targetColumn: BoardColumn): void {
    if (targetColumn === 'done') {
      tasks.updateTask(task.id, {
        completed: true,
        completedAt: task.completedAt || new Date().toISOString(),
      });
      return;
    }

    const leavingBlocked = task.workflowState === 'blocked' && targetColumn !== 'blocked';
    const enteringBlocked = targetColumn === 'blocked' && !task.blockedReason;
    const blockedReason = enteringBlocked
      ? (window.prompt('What is blocking this task?', task.blockedReason || '') || '').trim() || undefined
      : leavingBlocked ? undefined : task.blockedReason;

    tasks.updateTask(task.id, {
      completed: false,
      completedAt: undefined,
      workflowState: targetColumn,
      blockedReason,
      boardOrder: getNextBoardOrder(targetColumn, task.id),
    });
  }

  function moveTaskHorizontally(task: Task, direction: -1 | 1): void {
    const currentColumn = getBoardColumn(task);
    const currentIndex = BOARD_COLUMN_SEQUENCE.indexOf(currentColumn);
    const targetIndex = Math.min(Math.max(currentIndex + direction, 0), BOARD_COLUMN_SEQUENCE.length - 1);
    const targetColumn = BOARD_COLUMN_SEQUENCE[targetIndex];
    if (targetColumn !== currentColumn) {
      moveBoardTask(task, targetColumn);
    }
  }

  function openMilestoneForm(goal?: Task): void {
    setEditingMilestone(goal || null);
    setMilestoneTitle(goal?.title || '');
    setMilestoneDescription(goal?.description || '');
    setMilestoneDueDate(goal?.dueDate || '');
    setMilestonePriority(goal?.priority || 'medium');
    setShowMilestoneForm(true);
  }

  function saveMilestone(): void {
    if (!selectedProject || !milestoneTitle.trim()) return;

    const payload = {
      title: milestoneTitle.trim(),
      description: milestoneDescription.trim(),
      completed: editingMilestone?.completed ?? false,
      completedAt: editingMilestone?.completedAt,
      priority: milestonePriority,
      category: 'goal' as const,
      dueDate: milestoneDueDate || undefined,
      goalTag: editingMilestone?.goalTag,
      projectId: selectedProject.id,
    };

    if (editingMilestone) {
      tasks.updateTask(editingMilestone.id, payload);
    } else {
      tasks.addTask(payload);
    }

    setShowMilestoneForm(false);
  }

  function createWikiPage(): void {
    if (!selectedProject) return;

    const pageId = projects.addProjectPage({
      projectId: selectedProject.id,
      title: 'New Page',
      content: '# New Page\n\nAdd references, decisions, or setup notes here.',
      isOverview: false,
    });
    setSelectedPageIdState(pageId);
    setActiveTab('wiki');
  }

  const renderProjectList = (title: string, projects: Project[]) => {
    if (projects.length === 0) return null;

    return (
      <div style={{ display: 'grid', gap: 8 }}>
        <div style={{ fontSize: 11, textTransform: 'uppercase', letterSpacing: 0.7, color: '#6b6f85' }}>{title}</div>
        {projects.map(project => {
          const projectTaskCount = tasks.tasks.filter(task => task.projectId === project.id && !task.completed).length;
          return (
            <button
              key={project.id}
              type="button"
              onClick={() => setSelectedProjectIdState(project.id)}
              style={{
                textAlign: 'left',
                padding: 14,
                borderRadius: 14,
                border: selectedProjectId === project.id ? '1px solid #4f5bff' : '1px solid #23283c',
                background: selectedProjectId === project.id ? 'rgba(79, 91, 255, 0.12)' : '#121620',
                color: '#f5f7ff',
                cursor: 'pointer',
              }}
            >
              <div style={{ display: 'flex', justifyContent: 'space-between', gap: 8, alignItems: 'center' }}>
                <div style={{ fontWeight: 600, fontSize: 14 }}>{project.name}</div>
                {project.isPinned && <span style={{ color: '#fbbf24', fontSize: 13 }}>Pinned</span>}
              </div>
              <div style={{ fontSize: 12, color: '#8b8fa3', marginTop: 6 }}>
                {project.summary || 'No summary yet.'}
              </div>
              <div style={{ display: 'flex', justifyContent: 'space-between', gap: 8, alignItems: 'center', marginTop: 10, flexWrap: 'wrap' }}>
                <StatusPill status={project.status} />
                <span style={{ fontSize: 12, color: '#8b8fa3' }}>{projectTaskCount} active item{projectTaskCount === 1 ? '' : 's'}</span>
              </div>
            </button>
          );
        })}
      </div>
    );
  };

  return (
    <>
      <div className="surface-header">
        <div>
          <h1>Projects</h1>
          <div className="subtitle">
            {projects.projects.length === 0
              ? 'No projects yet'
              : `${projects.projects.length} project${projects.projects.length === 1 ? '' : 's'} in your reference catalogue`}
          </div>
        </div>
        <button className="btn btn-primary" onClick={openCreateProject}>+ Add Project</button>
      </div>

      <div className="surface-body">
        {projects.projects.length === 0 ? (
          <div className="empty-state" role="status">
            <div className="empty-icon">&#128736;</div>
            <h3>Build your project reference catalogue</h3>
            <p>Create a project to keep its live link, repository, setup notes, and management workspace easy to find again.</p>
            <button className="btn btn-primary" onClick={openCreateProject}>+ Create Project</button>
          </div>
        ) : managedProjectId ? (
          <>
            <div className="project-management-toolbar">
              <button
                ref={managementBackButtonRef}
                type="button"
                className="btn btn-secondary btn-sm"
                onClick={() => {
                  managementReturnFocusProjectId.current = managedProjectId;
                  setManagedProjectId(null);
                  setSelectedProjectIdState(null);
                  setActiveTab('overview');
                }}
              >
                ← Back to all projects
              </button>
              <span>Management workspace</span>
            </div>
          <div className="projects-layout project-management-layout">
            <aside className="card" style={{ padding: 18, display: 'grid', gap: 16 }}>
              <div style={{ display: 'grid', gap: 10 }}>
                <input
                  className="form-input"
                  value={searchQuery}
                  onChange={event => setSearchQuery(event.target.value)}
                  placeholder="Search projects, tags, or summaries"
                  aria-label="Search projects"
                />
                <div style={{ display: 'grid', gridTemplateColumns: '1fr 1fr', gap: 8 }}>
                  <select className="form-select" value={statusFilter} onChange={event => setStatusFilter(event.target.value as typeof statusFilter)}>
                    <option value="all">All statuses</option>
                    {PROJECT_STATUS_OPTIONS.map(status => (
                      <option key={status} value={status}>{getStatusLabel(status)}</option>
                    ))}
                  </select>
                  <select className="form-select" value={tagFilter} onChange={event => setTagFilter(event.target.value)}>
                    <option value="all">All tags</option>
                    {availableTags.map(tag => (
                      <option key={tag} value={tag}>{tag}</option>
                    ))}
                  </select>
                </div>
                <button className="btn btn-secondary" onClick={openCreateProject}>Quick add project</button>
              </div>

              <div style={{ display: 'grid', gap: 16, alignContent: 'start' }}>
                {renderProjectList('Pinned', groupedProjects.pinned)}
                {renderProjectList('Active Portfolio', groupedProjects.active)}
                {renderProjectList('Blocked', groupedProjects.blocked)}
                {renderProjectList('Archived', groupedProjects.archived)}
                {filteredProjects.length === 0 && (
                  <div style={{ fontSize: 13, color: '#8b8fa3' }}>
                    No projects match the current filters.
                  </div>
                )}
              </div>
            </aside>

            <section style={{ display: 'grid', gap: 16 }}>
              {selectedProject ? (
                <>
                  <div className="card" style={{ padding: 20, display: 'grid', gap: 16 }}>
                    <div style={{ display: 'flex', justifyContent: 'space-between', gap: 16, alignItems: 'flex-start', flexWrap: 'wrap' }}>
                      <div style={{ display: 'grid', gap: 10 }}>
                        <div style={{ display: 'flex', alignItems: 'center', gap: 10, flexWrap: 'wrap' }}>
                          <h2 style={{ margin: 0 }}>{selectedProject.name}</h2>
                          <StatusPill status={selectedProject.status} />
                          {selectedProject.isPinned && <span className="tag tag-primary">Pinned</span>}
                        </div>
                        <div style={{ color: '#9ea4c5', maxWidth: 760 }}>
                          {selectedProject.summary || 'Add a short brief so the project overview explains what this workspace is for.'}
                        </div>
                        <div style={{ display: 'flex', gap: 8, flexWrap: 'wrap' }}>
                          {selectedProject.tags.length > 0 ? selectedProject.tags.map(tag => (
                            <span key={tag} className="tag tag-connected">{tag}</span>
                          )) : <span style={{ fontSize: 12, color: '#6b6f85' }}>No tags yet</span>}
                        </div>
                      </div>
                      <div className="actions-row" style={{ margin: 0 }}>
                        <button className="btn btn-secondary btn-sm" onClick={() => openEditProject(selectedProject)}>Edit Project</button>
                        <button className="btn btn-danger btn-sm" onClick={() => {
                          if (window.confirm(`Remove project "${selectedProject.name}"? Linked tasks will stay in Sabah One but lose their project assignment.`)) {
                            removeProject(selectedProject.id);
                            setSelectedProjectIdState(null);
                          }
                        }}>Remove</button>
                      </div>
                    </div>

                    <div className="tabs" role="tablist" aria-label={`${selectedProject.name} management`}>
                      {PROJECT_TABS.map(tab => (
                        <button
                          key={tab.key}
                          id={`project-tab-${tab.key}`}
                          className={`tab ${activeTab === tab.key ? 'active' : ''}`}
                          type="button"
                          role="tab"
                          aria-selected={activeTab === tab.key}
                          aria-controls={`project-panel-${tab.key}`}
                          tabIndex={activeTab === tab.key ? 0 : -1}
                          onClick={() => setActiveTab(tab.key)}
                          onKeyDown={event => handleProjectTabKeyDown(event, tab.key)}
                        >
                          {tab.label}
                        </button>
                      ))}
                    </div>
                  </div>

                  {activeTab === 'overview' && (
                    <div
                      id="project-panel-overview"
                      role="tabpanel"
                      aria-labelledby="project-tab-overview"
                      tabIndex={0}
                      style={{ display: 'grid', gap: 16 }}
                    >
                      <div className="projects-metrics-grid">
                        <MetricCard label="Open Work" value={String(openCount)} note="Incomplete tasks and milestones linked to this project." />
                        <MetricCard label="Blocked" value={String(blockedCount)} note="Kanban cards sitting in the blocked lane." />
                        <MetricCard label="Overdue" value={String(overdueCount)} note="Linked work with due dates before today." />
                        <MetricCard label="Completed" value={String(completedCount)} note="Work already finished inside this project." />
                      </div>

                      <div className="project-detail-grid">
                        <div className="card" style={{ padding: 18, display: 'grid', gap: 14 }}>
                          <div style={{ fontSize: 16, fontWeight: 700 }}>Project References</div>
                          <div style={{ fontSize: 13, color: '#8b8fa3' }}>
                            Open the account-backed web links and keep setup guidance with the project.
                          </div>
                          <div style={{ display: 'flex', gap: 8, flexWrap: 'wrap' }}>
                            {(selectedProject.links || []).filter(link => link.url).map(link => (
                              <a key={link.id} className="btn btn-secondary btn-sm" href={link.url} target="_blank" rel="noreferrer">
                                {link.label}
                              </a>
                            ))}
                            {(selectedProject.links || []).length === 0 && (
                              <span style={{ fontSize: 12, color: '#6b6f85' }}>No web links recorded yet.</span>
                            )}
                          </div>
                        </div>

                        <div className="card" style={{ padding: 18, display: 'grid', gap: 12 }}>
                          <div style={{ fontSize: 16, fontWeight: 700 }}>Milestone Snapshot</div>
                          <div style={{ fontSize: 13, color: '#8b8fa3' }}>
                            {selectedProjectMilestones.length === 0
                              ? 'No milestones yet. Use project-linked goals to mark major outcomes.'
                              : `${completedMilestones} of ${selectedProjectMilestones.length} milestones completed.`}
                          </div>
                          <div style={{ display: 'grid', gap: 10 }}>
                            {selectedProjectMilestones.slice(0, 4).map(goal => (
                              <div key={goal.id} style={{ padding: 12, borderRadius: 12, background: '#141926', border: '1px solid #23283c' }}>
                                <div style={{ display: 'flex', justifyContent: 'space-between', gap: 8 }}>
                                  <div style={{ fontWeight: 600, color: '#f5f7ff' }}>{goal.title}</div>
                                  <span className={`tag ${goal.completed ? 'tag-connected' : 'tag-primary'}`}>{goal.completed ? 'Done' : 'Active'}</span>
                                </div>
                                <div style={{ fontSize: 12, color: '#8b8fa3', marginTop: 6 }}>
                                  {goal.dueDate ? `Target ${goal.dueDate}` : 'No target date'}
                                </div>
                              </div>
                            ))}
                          </div>
                        </div>

                        <div className="card" style={{ padding: 18, display: 'grid', gap: 12 }}>
                          <div style={{ fontSize: 16, fontWeight: 700 }}>Recent Activity</div>
                          {recentActivity.length === 0 ? (
                            <div style={{ fontSize: 13, color: '#8b8fa3' }}>No recent task or wiki updates yet.</div>
                          ) : (
                            recentActivity.map(item => (
                              <div key={`${item.type}-${item.id}`} style={{ padding: 12, borderRadius: 12, background: '#141926', border: '1px solid #23283c' }}>
                                <div style={{ display: 'flex', justifyContent: 'space-between', gap: 8, alignItems: 'center' }}>
                                  <div style={{ fontWeight: 600 }}>{item.label}</div>
                                  <span className="tag tag-disconnected">{item.type === 'task' ? 'Task' : 'Wiki'}</span>
                                </div>
                                <div style={{ fontSize: 12, color: '#8b8fa3', marginTop: 6 }}>{formatDateTime(item.updatedAt)}</div>
                              </div>
                            ))
                          )}
                        </div>
                      </div>
                    </div>
                  )}

                  {activeTab === 'board' && (
                    <div
                      id="project-panel-board"
                      className="project-board"
                      role="tabpanel"
                      aria-labelledby="project-tab-board"
                      tabIndex={0}
                    >
                      {BOARD_COLUMNS.map(column => {
                        const columnTasks = boardTasksByColumn[column.key];
                        return (
                          <div
                            key={column.key}
                            className="card"
                            style={{ padding: 16, display: 'grid', gap: 12, alignContent: 'start', minHeight: 420 }}
                            onDragOver={event => event.preventDefault()}
                            onDrop={event => {
                              event.preventDefault();
                              const task = selectedProjectBoardTasks.find(item => item.id === draggedTaskId);
                              if (task) moveBoardTask(task, column.key);
                              setDraggedTaskId(null);
                            }}
                          >
                            <div style={{ display: 'flex', justifyContent: 'space-between', gap: 8, alignItems: 'center' }}>
                              <div style={{ fontWeight: 700 }}>{column.label}</div>
                              <span style={{ fontSize: 12, color: '#8b8fa3' }}>{columnTasks.length}</span>
                            </div>

                            {column.key === 'backlog' && (
                              <div style={{ display: 'grid', gap: 8, padding: 12, borderRadius: 12, border: '1px dashed #30364d', background: '#141926' }}>
                                <input
                                  className="form-input"
                                  value={newBoardTaskTitle}
                                  onChange={event => setNewBoardTaskTitle(event.target.value)}
                                  placeholder="Quick add task"
                                />
                                <div style={{ display: 'grid', gridTemplateColumns: '1fr 1fr auto', gap: 8 }}>
                                  <input className="form-input" type="date" value={newBoardTaskDueDate} onChange={event => setNewBoardTaskDueDate(event.target.value)} />
                                  <select className="form-select" value={newBoardTaskPriority} onChange={event => setNewBoardTaskPriority(event.target.value as TaskPriority)}>
                                    <option value="high">High</option>
                                    <option value="medium">Medium</option>
                                    <option value="low">Low</option>
                                  </select>
                                  <button className="btn btn-primary btn-sm" onClick={addBoardTask} disabled={!newBoardTaskTitle.trim()}>Add</button>
                                </div>
                              </div>
                            )}

                            {columnTasks.length === 0 && (
                              <div style={{ fontSize: 12, color: '#6b6f85', padding: 12, borderRadius: 12, background: '#111520' }}>
                                {column.key === 'done' ? 'Completed cards land here automatically.' : 'No cards in this column yet.'}
                              </div>
                            )}

                            {columnTasks.map(task => (
                              <article
                                key={task.id}
                                draggable
                                onDragStart={() => setDraggedTaskId(task.id)}
                                onDragEnd={() => setDraggedTaskId(null)}
                                style={{
                                  padding: 14,
                                  borderRadius: 14,
                                  background: '#141926',
                                  border: '1px solid #23283c',
                                  display: 'grid',
                                  gap: 10,
                                  cursor: 'grab',
                                }}
                              >
                                <div style={{ display: 'flex', justifyContent: 'space-between', gap: 8, alignItems: 'flex-start' }}>
                                  <div style={{ fontWeight: 600, color: '#f5f7ff' }}>{task.title}</div>
                                  <span className={`tag ${task.priority === 'high' ? 'tag-overdue' : task.priority === 'medium' ? 'tag-primary' : 'tag-connected'}`}>{task.priority}</span>
                                </div>
                                {task.description && <div style={{ fontSize: 12, color: '#8b8fa3' }}>{task.description}</div>}
                                <div style={{ display: 'flex', gap: 8, flexWrap: 'wrap', fontSize: 12, color: '#8b8fa3' }}>
                                  {task.dueDate && <span>{task.completed ? `Completed ${task.completedAt ? formatDateTime(task.completedAt) : task.dueDate}` : `Due ${task.dueDate}`}</span>}
                                  {!task.dueDate && task.completed && task.completedAt && <span>Completed {formatDateTime(task.completedAt)}</span>}
                                </div>
                                {getBoardColumn(task) === 'blocked' && (
                                  <div style={{ fontSize: 12, color: '#fca5a5', padding: 10, borderRadius: 10, background: 'rgba(239, 68, 68, 0.08)', border: '1px solid rgba(239, 68, 68, 0.22)' }}>
                                    {task.blockedReason || 'No blocked reason recorded.'}
                                  </div>
                                )}
                                <div style={{ display: 'flex', gap: 6, flexWrap: 'wrap' }}>
                                  <button className="btn btn-secondary btn-sm" aria-label={`Move ${task.title} to the previous column`} onClick={() => moveTaskHorizontally(task, -1)} disabled={getBoardColumn(task) === 'backlog'}>&larr;</button>
                                  <button className="btn btn-secondary btn-sm" aria-label={`Move ${task.title} to the next column`} onClick={() => moveTaskHorizontally(task, 1)} disabled={getBoardColumn(task) === 'done'}>&rarr;</button>
                                  {getBoardColumn(task) !== 'done' ? (
                                    <button className="btn btn-secondary btn-sm" onClick={() => moveBoardTask(task, 'done')}>Done</button>
                                  ) : (
                                    <button className="btn btn-secondary btn-sm" onClick={() => moveBoardTask(task, 'backlog')}>Reopen</button>
                                  )}
                                  <button className="btn btn-danger btn-sm" onClick={() => {
                                    if (window.confirm(`Delete "${task.title}"?`)) {
                                      tasks.removeTask(task.id);
                                    }
                                  }}>Delete</button>
                                </div>
                              </article>
                            ))}
                          </div>
                        );
                      })}
                    </div>
                  )}

                  {activeTab === 'milestones' && (
                    <div
                      id="project-panel-milestones"
                      role="tabpanel"
                      aria-labelledby="project-tab-milestones"
                      tabIndex={0}
                      style={{ display: 'grid', gap: 16 }}
                    >
                      <div className="card" style={{ padding: 18, display: 'flex', justifyContent: 'space-between', gap: 12, flexWrap: 'wrap', alignItems: 'center' }}>
                        <div>
                          <div style={{ fontSize: 16, fontWeight: 700 }}>Project Milestones</div>
                          <div style={{ fontSize: 13, color: '#8b8fa3' }}>
                            Track major outcomes using project-linked goals so Tasks and Projects stay in sync.
                          </div>
                        </div>
                        <button className="btn btn-primary" onClick={() => openMilestoneForm()}>+ Add Milestone</button>
                      </div>

                      <div className="projects-metrics-grid">
                        <MetricCard label="Active Milestones" value={String(selectedProjectMilestones.filter(goal => !goal.completed).length)} />
                        <MetricCard label="Completed Milestones" value={String(completedMilestones)} />
                        <MetricCard label="Progress" value={selectedProjectMilestones.length === 0 ? '0%' : `${Math.round((completedMilestones / selectedProjectMilestones.length) * 100)}%`} />
                      </div>

                      {selectedProjectMilestones.length === 0 ? (
                        <div className="empty-state" role="status">
                          <div className="empty-icon">&#127919;</div>
                          <h3>No milestones yet</h3>
                          <p>Capture the big outcomes here, then drive the board work underneath them.</p>
                          <button className="btn btn-primary" onClick={() => openMilestoneForm()}>+ Add Milestone</button>
                        </div>
                      ) : (
                        <div style={{ display: 'grid', gap: 12 }}>
                          {selectedProjectMilestones
                            .slice()
                            .sort((left, right) => {
                              if (left.completed !== right.completed) return left.completed ? 1 : -1;
                              return (left.dueDate || '9999-12-31').localeCompare(right.dueDate || '9999-12-31');
                            })
                            .map(goal => (
                              <div key={goal.id} className="card" style={{ padding: 18 }}>
                                <div style={{ display: 'flex', justifyContent: 'space-between', gap: 12, alignItems: 'flex-start', flexWrap: 'wrap' }}>
                                  <div style={{ display: 'grid', gap: 8 }}>
                                    <div style={{ display: 'flex', gap: 8, flexWrap: 'wrap', alignItems: 'center' }}>
                                      <div style={{ fontSize: 16, fontWeight: 700, textDecoration: goal.completed ? 'line-through' : 'none' }}>{goal.title}</div>
                                      <span className={`tag ${goal.completed ? 'tag-connected' : 'tag-primary'}`}>{goal.completed ? 'Done' : 'Active'}</span>
                                      <span className={`tag ${goal.priority === 'high' ? 'tag-overdue' : goal.priority === 'medium' ? 'tag-primary' : 'tag-connected'}`}>{goal.priority}</span>
                                    </div>
                                    {goal.description && <div style={{ fontSize: 13, color: '#9ea4c5' }}>{goal.description}</div>}
                                    <div style={{ fontSize: 12, color: '#8b8fa3' }}>
                                      {goal.dueDate ? `Target date ${goal.dueDate}` : 'No target date'}
                                      {goal.completedAt ? ` · Completed ${formatDateTime(goal.completedAt)}` : ''}
                                    </div>
                                  </div>
                                  <div className="actions-row" style={{ margin: 0 }}>
                                    <button className="btn btn-secondary btn-sm" onClick={() => tasks.updateTask(goal.id, {
                                      completed: !goal.completed,
                                      completedAt: goal.completed ? undefined : new Date().toISOString(),
                                    })}>
                                      {goal.completed ? 'Reopen' : 'Complete'}
                                    </button>
                                    <button className="btn btn-secondary btn-sm" onClick={() => openMilestoneForm(goal)}>Edit</button>
                                    <button className="btn btn-danger btn-sm" onClick={() => {
                                      if (window.confirm(`Delete milestone "${goal.title}"?`)) {
                                        tasks.removeTask(goal.id);
                                      }
                                    }}>Delete</button>
                                  </div>
                                </div>
                              </div>
                            ))}
                        </div>
                      )}
                    </div>
                  )}

                  {activeTab === 'wiki' && (
                    <div
                      id="project-panel-wiki"
                      className="project-wiki-layout"
                      role="tabpanel"
                      aria-labelledby="project-tab-wiki"
                      tabIndex={0}
                    >
                      <div className="card" style={{ padding: 18, display: 'grid', gap: 12, alignContent: 'start' }}>
                        <div style={{ display: 'grid', gap: 8 }}>
                          <div style={{ fontSize: 16, fontWeight: 700 }}>Wiki Pages</div>
                          <input
                            className="form-input"
                            value={wikiSearch}
                            onChange={event => setWikiSearch(event.target.value)}
                            placeholder="Search wiki"
                          />
                        </div>
                        <button className="btn btn-secondary btn-sm" onClick={createWikiPage}>+ New Page</button>
                        <div style={{ display: 'grid', gap: 8 }}>
                          {wikiResults.map(page => (
                            <button
                              key={page.id}
                              type="button"
                              onClick={() => setSelectedPageIdState(page.id)}
                              style={{
                                textAlign: 'left',
                                padding: 12,
                                borderRadius: 12,
                                border: selectedPageId === page.id ? '1px solid #4f5bff' : '1px solid #23283c',
                                background: selectedPageId === page.id ? 'rgba(79, 91, 255, 0.12)' : '#121620',
                                color: '#f5f7ff',
                                cursor: 'pointer',
                              }}
                            >
                              <div style={{ display: 'flex', justifyContent: 'space-between', gap: 8 }}>
                                <div style={{ fontWeight: 600 }}>{page.title}</div>
                                {page.isOverview && <span className="tag tag-connected">Overview</span>}
                              </div>
                              <div style={{ fontSize: 11, color: '#8b8fa3', marginTop: 6 }}>{formatDateTime(page.updatedAt)}</div>
                            </button>
                          ))}
                          {wikiResults.length === 0 && <div style={{ fontSize: 13, color: '#8b8fa3' }}>No wiki pages match this search.</div>}
                        </div>
                      </div>

                      <div className="card" style={{ padding: 18, display: 'grid', gap: 12 }}>
                        {selectedPage ? (
                          <ProjectWikiEditor
                            key={selectedPage.id}
                            page={selectedPage}
                            onSave={(title, content) => {
                              projects.updateProjectPage(selectedPage.id, {
                                title: title.trim() || 'Untitled Page',
                                content,
                              });
                            }}
                            onDelete={() => {
                              if (window.confirm(`Delete wiki page "${selectedPage.title}"?`)) {
                                projects.removeProjectPage(selectedPage.id);
                              }
                            }}
                          />
                        ) : (
                          <div style={{ fontSize: 13, color: '#8b8fa3' }}>Select a page to edit your project wiki.</div>
                        )}
                      </div>
                    </div>
                  )}

                  {activeTab === 'inventory' && (
                    <div
                      id="project-panel-inventory"
                      role="tabpanel"
                      aria-labelledby="project-tab-inventory"
                      tabIndex={0}
                    >
                      <ProjectInventorySection
                        catalogKey={selectedProject.catalogKey || `custom:${selectedProject.id}`}
                        projectName={selectedProject.name}
                      />
                    </div>
                  )}
                </>
              ) : (
                <div className="card" style={{ padding: 20, color: '#8b8fa3' }}>
                  Pick a project from the portfolio rail to open its board, milestones, and wiki.
                </div>
              )}
            </section>
          </div>
          </>
        ) : (
          <div className="projects-catalog-shell">
            <section className="projects-catalog-intro" aria-labelledby="projects-catalog-title">
              <div>
                <h2 id="projects-catalog-title">Your work, easy to find again.</h2>
                <p>
                  Keep account-backed project references, live links, setup notes, and planning work together.
                  Sabah One keeps the reference visible without turning every project into a task board.
                </p>
              </div>
              <div className="projects-catalog-stats" aria-label="Project catalogue summary">
                <div className="projects-catalog-stat"><strong>{projects.projects.length}</strong><span>Projects</span></div>
                <div className="projects-catalog-stat"><strong>{liveProjectCount}</strong><span>Live</span></div>
              </div>
            </section>

            <section className="projects-catalog-toolbar" aria-label="Filter projects">
              <div className="projects-catalog-search-row">
                <label className="project-filter-field">
                  <span>Search projects</span>
                  <input
                    className="form-input"
                    value={searchQuery}
                    onChange={event => setSearchQuery(event.target.value)}
                    placeholder="Projects, links, tags, or summaries"
                  />
                </label>
                <label className="project-filter-field">
                  <span>Type</span>
                  <select className="form-select" value={kindFilter} onChange={event => setKindFilter(event.target.value as typeof kindFilter)}>
                    <option value="all">All project types</option>
                    {PROJECT_KIND_OPTIONS.map(option => (
                      <option key={option.value} value={option.value}>{option.label}</option>
                    ))}
                  </select>
                </label>
                <label className="project-filter-field">
                  <span>Status</span>
                  <select className="form-select" value={statusFilter} onChange={event => setStatusFilter(event.target.value as typeof statusFilter)}>
                    <option value="all">All statuses</option>
                    {PROJECT_STATUS_OPTIONS.map(status => (
                      <option key={status} value={status}>{getStatusLabel(status)}</option>
                    ))}
                  </select>
                </label>
              </div>
              <div className="projects-filter-chips" aria-label="Quick project filters">
                {PROJECT_CATALOG_FILTERS.map(filter => (
                  <button
                    key={filter.value}
                    className={`project-filter-chip ${catalogFilter === filter.value ? 'active' : ''}`}
                    type="button"
                    aria-pressed={catalogFilter === filter.value}
                    onClick={() => setCatalogFilter(filter.value)}
                  >
                    {filter.label}
                  </button>
                ))}
              </div>
              {availableTags.length > 0 && (
                <label className="project-filter-field project-tag-filter">
                  <span>Tag</span>
                  <select className="form-select" value={tagFilter} onChange={event => setTagFilter(event.target.value)}>
                    <option value="all">All tags</option>
                    {availableTags.map(tag => <option key={tag} value={tag}>{tag}</option>)}
                  </select>
                </label>
              )}
            </section>

            <section className="project-catalog-results">
              <div className="project-catalog-results-header">
                <div>
                  <h2>{catalogFilter === 'all' ? 'Project catalogue' : PROJECT_CATALOG_FILTERS.find(filter => filter.value === catalogFilter)?.label}</h2>
                  {isCatalogueFiltered && (
                    <button
                      type="button"
                      className="project-reorder-filter-note"
                      onClick={clearCatalogueFilters}
                    >
                      Clear filters to reorder
                    </button>
                  )}
                </div>
                <span role="status" aria-live="polite" aria-atomic="true">
                  {filteredProjects.length} result{filteredProjects.length === 1 ? '' : 's'}
                </span>
              </div>
              <p id="project-reorder-instructions" className="project-sr-only">
                Use the Reorder button to move this project. Press Space or Enter to pick it up,
                use the arrow keys to change its position, then press Space or Enter to drop.
                Press Escape to cancel.
              </p>
              <div className="project-sr-only" role="status" aria-live="assertive" aria-atomic="true">
                {catalogAnnouncement}
              </div>
              {filteredProjects.length > 0 ? (
                <div className="project-catalog-sections">
                  {groupedProjects.pinned.length > 0 && (
                    <ProjectCatalogueSectionView
                      section="pinned"
                      title="Pinned"
                      description="Your quickest access to priority projects."
                      projects={groupedProjects.pinned}
                      reorderEnabled={!isCatalogueFiltered}
                      getActiveWorkCount={projectId => tasks.tasks.filter(task => task.projectId === projectId && !task.completed).length}
                      onOpen={openedProject => {
                        setSelectedProjectIdState(openedProject.id);
                        setDetailProjectId(openedProject.id);
                      }}
                      onPinChange={(project, pinned) => changeProjectPinned(project, pinned)}
                      onArchiveChange={(project, archived) => changeProjectArchived(project, archived)}
                      onReorder={reorderProjects}
                      onAnnounce={setCatalogAnnouncement}
                    />
                  )}
                  {groupedProjects.projects.length > 0 && (
                    <ProjectCatalogueSectionView
                      section="projects"
                      title="Projects"
                      description="Active, planned, blocked, and completed work."
                      projects={groupedProjects.projects}
                      reorderEnabled={!isCatalogueFiltered}
                      getActiveWorkCount={projectId => tasks.tasks.filter(task => task.projectId === projectId && !task.completed).length}
                      onOpen={openedProject => {
                        setSelectedProjectIdState(openedProject.id);
                        setDetailProjectId(openedProject.id);
                      }}
                      onPinChange={(project, pinned) => changeProjectPinned(project, pinned)}
                      onArchiveChange={(project, archived) => changeProjectArchived(project, archived)}
                      onReorder={reorderProjects}
                      onAnnounce={setCatalogAnnouncement}
                    />
                  )}
                  <ProjectCatalogueSectionView
                    section="archived"
                    title="Archived"
                    description="Out of the way, but always recoverable."
                    projects={groupedProjects.archived}
                    collapsed={!archivedExpanded}
                    collapsible
                    reorderEnabled={!isCatalogueFiltered}
                    onToggleCollapsed={() => setArchivedExpanded(current => !current)}
                    getActiveWorkCount={projectId => tasks.tasks.filter(task => task.projectId === projectId && !task.completed).length}
                    onOpen={openedProject => {
                      setSelectedProjectIdState(openedProject.id);
                      setDetailProjectId(openedProject.id);
                    }}
                    onPinChange={(project, pinned) => changeProjectPinned(project, pinned)}
                    onArchiveChange={(project, archived) => changeProjectArchived(project, archived)}
                    onReorder={reorderProjects}
                    onAnnounce={setCatalogAnnouncement}
                  />
                </div>
              ) : (
                <div className="project-empty-filter" role="status">
                  <div>
                    <strong>No projects match these filters.</strong>
                    <p>Clear the search or choose All to see the complete catalogue.</p>
                    <button
                      className="btn btn-secondary btn-sm"
                      type="button"
                      onClick={clearCatalogueFilters}
                    >
                      Clear filters
                    </button>
                  </div>
                </div>
              )}
            </section>
          </div>
        )}
      </div>

      {detailProject && !managedProjectId && (
        <ProjectReferenceDrawer
          project={detailProject}
          activeWorkCount={selectedProjectTasks.filter(task => !task.completed).length}
          milestoneCount={selectedProjectMilestones.length}
          feedback={catalogAnnouncement || undefined}
          onClose={closeProjectDetails}
          onEdit={() => {
            setDetailProjectId(null);
            openEditProject(detailProject);
          }}
          onManage={() => {
            setDetailProjectId(null);
            setManagedProjectId(detailProject.id);
            setSelectedProjectIdState(detailProject.id);
            setActiveTab('overview');
          }}
          onCopy={(value, label) => { void copyProjectReference(value, label); }}
          onPinChange={pinned => changeProjectPinned(detailProject, pinned, false)}
          onArchiveChange={archived => changeProjectArchived(detailProject, archived, false)}
        />
      )}

      {showProjectForm && (
        <div className="modal-overlay" onClick={() => setShowProjectForm(false)}>
          <div ref={projectFormRef} className="modal" onClick={event => event.stopPropagation()} role="dialog" aria-modal="true" aria-label={editingProject ? 'Edit Project' : 'Add Project'}>
            <h2>{editingProject ? 'Edit Project' : 'Add Project'}</h2>
            <div className="form-group">
              <label htmlFor="project-name">Name</label>
              <input id="project-name" className="form-input" value={projectName} onChange={event => setProjectName(event.target.value)} placeholder="Project name" autoFocus />
            </div>
            <div className="form-group">
              <label htmlFor="project-summary">Summary</label>
              <textarea id="project-summary" className="form-input" value={projectSummary} onChange={event => setProjectSummary(event.target.value)} placeholder="What is this project for?" />
            </div>
            <div style={{ display: 'grid', gridTemplateColumns: '1fr 1fr', gap: 12 }}>
              <div className="form-group">
                <label htmlFor="project-kind">Type</label>
                <select id="project-kind" className="form-select" value={projectKind} onChange={event => setProjectKind(event.target.value as ProjectKind)}>
                  {PROJECT_KIND_OPTIONS.map(option => (
                    <option key={option.value} value={option.value}>{option.label}</option>
                  ))}
                </select>
              </div>
              <div className="form-group">
                <label htmlFor="project-status">Status</label>
                <select
                  id="project-status"
                  className="form-select"
                  value={projectStatus}
                  onChange={event => {
                    const nextStatus = event.target.value as ProjectStatus;
                    setProjectStatus(nextStatus);
                    if (nextStatus === 'archived') setProjectPinned(false);
                  }}
                >
                  {PROJECT_STATUS_OPTIONS.map(status => (
                    <option key={status} value={status}>{getStatusLabel(status)}</option>
                  ))}
                </select>
              </div>
            </div>
            <div style={{ display: 'grid', gridTemplateColumns: '1fr 1fr', gap: 12 }}>
              <div className="form-group" style={{ gridColumn: '1 / -1' }}>
                <label htmlFor="project-tags">Tags</label>
                <input id="project-tags" className="form-input" value={projectTagsInput} onChange={event => setProjectTagsInput(event.target.value)} placeholder="client, launch, frontend" />
              </div>
              <div className="form-group">
                <label htmlFor="project-repository">Repository URL</label>
                <input id="project-repository" className="form-input" type="url" value={projectRepositoryUrl} onChange={event => setProjectRepositoryUrl(event.target.value)} placeholder="https://github.com/…" />
              </div>
              <div className="form-group">
                <label htmlFor="project-deployment">Live URL</label>
                <input id="project-deployment" className="form-input" type="url" value={projectDeploymentUrl} onChange={event => setProjectDeploymentUrl(event.target.value)} placeholder="https://…" />
              </div>
            </div>
            <label style={{ display: 'flex', gap: 8, alignItems: 'center', fontSize: 13, color: '#cfd3e6' }}>
              <input
                type="checkbox"
                checked={projectPinned}
                disabled={projectStatus === 'archived'}
                onChange={event => setProjectPinned(event.target.checked)}
              />
              {projectStatus === 'archived'
                ? 'Archived projects cannot be pinned'
                : 'Pin this project at the top of the catalogue'}
            </label>
            <div className="modal-actions">
              <button className="btn btn-secondary" onClick={() => setShowProjectForm(false)}>Cancel</button>
              <button className="btn btn-primary" onClick={saveProject} disabled={!projectName.trim()}>
                {editingProject ? 'Save Project' : 'Create Project'}
              </button>
            </div>
          </div>
        </div>
      )}

      {showMilestoneForm && (
        <div className="modal-overlay" onClick={() => setShowMilestoneForm(false)}>
          <div className="modal" onClick={event => event.stopPropagation()} role="dialog" aria-modal="true" aria-label={editingMilestone ? 'Edit Milestone' : 'Add Milestone'}>
            <h2>{editingMilestone ? 'Edit Milestone' : 'Add Milestone'}</h2>
            <div className="form-group">
              <label htmlFor="milestone-title">Title</label>
              <input id="milestone-title" className="form-input" value={milestoneTitle} onChange={event => setMilestoneTitle(event.target.value)} placeholder="Milestone title" autoFocus />
            </div>
            <div className="form-group">
              <label htmlFor="milestone-description">Description</label>
              <textarea id="milestone-description" className="form-input" value={milestoneDescription} onChange={event => setMilestoneDescription(event.target.value)} placeholder="What outcome defines this milestone?" />
            </div>
            <div style={{ display: 'grid', gridTemplateColumns: '1fr 1fr', gap: 12 }}>
              <div className="form-group">
                <label htmlFor="milestone-due">Target Date</label>
                <input id="milestone-due" className="form-input" type="date" value={milestoneDueDate} onChange={event => setMilestoneDueDate(event.target.value)} />
              </div>
              <div className="form-group">
                <label htmlFor="milestone-priority">Priority</label>
                <select id="milestone-priority" className="form-select" value={milestonePriority} onChange={event => setMilestonePriority(event.target.value as TaskPriority)}>
                  <option value="high">High</option>
                  <option value="medium">Medium</option>
                  <option value="low">Low</option>
                </select>
              </div>
            </div>
            <div className="modal-actions">
              <button className="btn btn-secondary" onClick={() => setShowMilestoneForm(false)}>Cancel</button>
              <button className="btn btn-primary" onClick={saveMilestone} disabled={!milestoneTitle.trim()}>
                {editingMilestone ? 'Save Milestone' : 'Create Milestone'}
              </button>
            </div>
          </div>
        </div>
      )}
    </>
  );
}
