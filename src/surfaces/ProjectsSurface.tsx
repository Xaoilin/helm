import { useEffect, useEffectEvent, useMemo, useState } from 'react';
import { useApp } from '../store/AppContext';
import { canUseDesktopProjectPaths, openProjectPath, pickProjectDirectory } from '../services/projectPaths';
import type { Project, ProjectPage, ProjectStatus, Task, TaskPriority } from '../types/domain';

type ProjectTab = 'overview' | 'board' | 'milestones' | 'wiki';
type BoardColumn = 'backlog' | 'next_up' | 'in_progress' | 'blocked' | 'done';

const PROJECT_STATUS_OPTIONS: ProjectStatus[] = ['planning', 'active', 'blocked', 'completed', 'archived'];
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
        Last updated {formatDateTime(page.updatedAt)}. Pages are stored locally as markdown-style notes.
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

export default function ProjectsSurface() {
  const app = useApp();
  const today = toLocalDateStr(new Date());

  const [activeTab, setActiveTab] = useState<ProjectTab>('overview');
  const [selectedProjectIdState, setSelectedProjectIdState] = useState<string | null>(null);
  const [searchQuery, setSearchQuery] = useState('');
  const [statusFilter, setStatusFilter] = useState<'all' | ProjectStatus>('all');
  const [tagFilter, setTagFilter] = useState<'all' | string>('all');
  const [showProjectForm, setShowProjectForm] = useState(false);
  const [editingProject, setEditingProject] = useState<Project | null>(null);
  const [projectName, setProjectName] = useState('');
  const [projectSummary, setProjectSummary] = useState('');
  const [projectLocalPath, setProjectLocalPath] = useState('');
  const [projectStatus, setProjectStatus] = useState<ProjectStatus>('active');
  const [projectTagsInput, setProjectTagsInput] = useState('');
  const [projectPinned, setProjectPinned] = useState(false);
  const [desktopPathActions, setDesktopPathActions] = useState(false);
  const [pathFeedback, setPathFeedback] = useState<string | null>(null);
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

  useEffect(() => {
    void canUseDesktopProjectPaths().then(setDesktopPathActions);
  }, []);

  const handleAssistantNavigation = useEffectEvent((requestId: string, revealProjectId?: string) => {
    if (revealProjectId && app.projects.some(project => project.id === revealProjectId)) {
      setSelectedProjectIdState(revealProjectId);
      setActiveTab('overview');
    }

    app.dismissAssistantNavigationRequest(requestId);
  });

  const availableTags = useMemo(() => {
    const tags = new Set<string>();
    app.projects.forEach(project => project.tags.forEach(tag => tags.add(tag)));
    return [...tags].sort((left, right) => left.localeCompare(right));
  }, [app.projects]);

  const filteredProjects = useMemo(() => {
    const query = searchQuery.trim().toLowerCase();
    return app.projects.filter(project => {
      const matchesQuery = !query
        || project.name.toLowerCase().includes(query)
        || project.summary.toLowerCase().includes(query)
        || project.tags.some(tag => tag.toLowerCase().includes(query));
      const matchesStatus = statusFilter === 'all' || project.status === statusFilter;
      const matchesTag = tagFilter === 'all' || project.tags.includes(tagFilter);
      return matchesQuery && matchesStatus && matchesTag;
    });
  }, [app.projects, searchQuery, statusFilter, tagFilter]);

  const selectedProjectId = useMemo(() => {
    if (selectedProjectIdState && filteredProjects.some(project => project.id === selectedProjectIdState)) {
      return selectedProjectIdState;
    }
    return filteredProjects[0]?.id || app.projects[0]?.id || null;
  }, [app.projects, filteredProjects, selectedProjectIdState]);

  const selectedProject = useMemo(
    () => app.projects.find(project => project.id === selectedProjectId) || null,
    [app.projects, selectedProjectId],
  );

  const selectedProjectTasks = useMemo(
    () => app.tasks.filter(task => task.projectId === selectedProjectId),
    [app.tasks, selectedProjectId],
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
    app.projectPages
      .filter(page => page.projectId === selectedProjectId)
      .sort((left, right) => {
        if (left.isOverview !== right.isOverview) return left.isOverview ? -1 : 1;
        return right.updatedAt.localeCompare(left.updatedAt);
      })
  ), [app.projectPages, selectedProjectId]);

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
    const request = app.assistantNavigationRequest;
    if (!request || request.surface !== 'projects') return;

    handleAssistantNavigation(request.id, request.surfaceState?.projects?.revealProjectId);
  }, [app.assistantNavigationRequest]);

  const groupedProjects = useMemo(() => ({
    pinned: filteredProjects.filter(project => project.isPinned),
    active: filteredProjects.filter(project => !project.isPinned && (project.status === 'planning' || project.status === 'active' || project.status === 'completed')),
    blocked: filteredProjects.filter(project => !project.isPinned && project.status === 'blocked'),
    archived: filteredProjects.filter(project => !project.isPinned && project.status === 'archived'),
  }), [filteredProjects]);

  const openCount = selectedProjectTasks.filter(task => !task.completed).length;
  const blockedCount = selectedProjectBoardTasks.filter(task => !task.completed && task.workflowState === 'blocked').length;
  const overdueCount = selectedProjectTasks.filter(task => !task.completed && task.dueDate && task.dueDate < today).length;
  const completedCount = selectedProjectTasks.filter(task => task.completed).length;
  const completedMilestones = selectedProjectMilestones.filter(task => task.completed).length;
  const recentActivity = buildProjectActivity(selectedProjectTasks, selectedProjectPages);

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
    setProjectLocalPath(project?.localPath || '');
    setProjectStatus(project?.status || 'active');
    setProjectTagsInput(project?.tags.join(', ') || '');
    setProjectPinned(project?.isPinned || false);
    setEditingProject(project || null);
  }

  function openCreateProject(): void {
    resetProjectForm(null);
    setShowProjectForm(true);
  }

  function openEditProject(project: Project): void {
    resetProjectForm(project);
    setShowProjectForm(true);
  }

  function saveProject(): void {
    if (!projectName.trim()) return;

    const payload = {
      name: projectName.trim(),
      summary: projectSummary.trim(),
      localPath: projectLocalPath.trim() || undefined,
      status: projectStatus,
      tags: parseTagsInput(projectTagsInput),
      isPinned: projectPinned,
    };

    if (editingProject) {
      app.updateProject(editingProject.id, payload);
      setSelectedProjectIdState(editingProject.id);
    } else {
      const createdId = app.addProject(payload);
      setSelectedProjectIdState(createdId);
      setActiveTab('overview');
    }

    setShowProjectForm(false);
  }

  async function browseForPath(): Promise<void> {
    const selectedPath = await pickProjectDirectory();
    if (selectedPath) {
      setProjectLocalPath(selectedPath);
      setPathFeedback(`Selected ${selectedPath}`);
    }
  }

  async function handleOpenProjectPath(path: string | undefined): Promise<void> {
    if (!path) return;
    try {
      await openProjectPath(path);
      setPathFeedback(`Opened ${path}`);
    } catch (error) {
      setPathFeedback(error instanceof Error ? error.message : 'Unable to open that local path.');
    }
  }

  async function handleCopyPath(path: string | undefined): Promise<void> {
    if (!path) return;
    await navigator.clipboard.writeText(path);
    setPathFeedback(`Copied ${path}`);
  }

  function addBoardTask(): void {
    if (!selectedProject || !newBoardTaskTitle.trim()) return;

    app.addTask({
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
      app.updateTask(task.id, {
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

    app.updateTask(task.id, {
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
      app.updateTask(editingMilestone.id, payload);
    } else {
      app.addTask(payload);
    }

    setShowMilestoneForm(false);
  }

  function createWikiPage(): void {
    if (!selectedProject) return;

    const pageId = app.addProjectPage({
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
          const projectTaskCount = app.tasks.filter(task => task.projectId === project.id && !task.completed).length;
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
            {app.projects.length === 0
              ? 'No projects yet'
              : `${app.projects.length} project${app.projects.length === 1 ? '' : 's'} tracked locally`}
          </div>
        </div>
        <button className="btn btn-primary" onClick={openCreateProject}>+ Add Project</button>
      </div>

      <div className="surface-body">
        {app.projects.length === 0 ? (
          <div className="empty-state" role="status">
            <div className="empty-icon">&#128736;</div>
            <h3>Turn HELM into your local project hub</h3>
            <p>Create a project to track a local path, plan work on a kanban board, capture milestones, and keep a lightweight wiki beside the tasks.</p>
            <button className="btn btn-primary" onClick={openCreateProject}>+ Create Project</button>
          </div>
        ) : (
          <div className="projects-layout">
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
                          if (window.confirm(`Remove project "${selectedProject.name}"? Linked tasks will stay in HELM but lose their project assignment.`)) {
                            app.removeProject(selectedProject.id);
                            setSelectedProjectIdState(null);
                          }
                        }}>Remove</button>
                      </div>
                    </div>

                    <div className="tabs">
                      <button className={`tab ${activeTab === 'overview' ? 'active' : ''}`} onClick={() => setActiveTab('overview')}>Overview</button>
                      <button className={`tab ${activeTab === 'board' ? 'active' : ''}`} onClick={() => setActiveTab('board')}>Board</button>
                      <button className={`tab ${activeTab === 'milestones' ? 'active' : ''}`} onClick={() => setActiveTab('milestones')}>Milestones</button>
                      <button className={`tab ${activeTab === 'wiki' ? 'active' : ''}`} onClick={() => setActiveTab('wiki')}>Wiki</button>
                    </div>
                  </div>

                  {activeTab === 'overview' && (
                    <div style={{ display: 'grid', gap: 16 }}>
                      <div className="projects-metrics-grid">
                        <MetricCard label="Open Work" value={String(openCount)} note="Incomplete tasks and milestones linked to this project." />
                        <MetricCard label="Blocked" value={String(blockedCount)} note="Kanban cards sitting in the blocked lane." />
                        <MetricCard label="Overdue" value={String(overdueCount)} note="Linked work with due dates before today." />
                        <MetricCard label="Completed" value={String(completedCount)} note="Work already finished inside this project." />
                      </div>

                      <div className="project-detail-grid">
                        <div className="card" style={{ padding: 18, display: 'grid', gap: 14 }}>
                          <div style={{ fontSize: 16, fontWeight: 700 }}>Local Project Reference</div>
                          <div style={{ fontSize: 13, color: '#8b8fa3' }}>
                            {selectedProject.localPath || 'No local path linked yet. Add one so the project becomes the front door to the code or docs on this machine.'}
                          </div>
                          <div style={{ display: 'flex', gap: 8, flexWrap: 'wrap' }}>
                            <button className="btn btn-secondary btn-sm" disabled={!selectedProject.localPath} onClick={() => { void handleOpenProjectPath(selectedProject.localPath); }}>Open Path</button>
                            <button className="btn btn-secondary btn-sm" disabled={!selectedProject.localPath} onClick={() => { void handleCopyPath(selectedProject.localPath); }}>Copy Path</button>
                            <button className="btn btn-secondary btn-sm" disabled={!desktopPathActions} onClick={() => openEditProject(selectedProject)}>
                              {desktopPathActions ? 'Browse in Edit' : 'Desktop only'}
                            </button>
                          </div>
                          <div style={{ fontSize: 12, color: '#6b6f85' }}>
                            {desktopPathActions
                              ? 'Desktop path actions are available in this build.'
                              : 'Directory picking and open-path actions are desktop-only. On web builds you can still paste and copy the path manually.'}
                          </div>
                          {pathFeedback && (
                            <div style={{ padding: 12, borderRadius: 12, background: '#141926', border: '1px solid #23283c', fontSize: 12, color: '#9ea4c5' }}>
                              {pathFeedback}
                            </div>
                          )}
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
                    <div className="project-board">
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
                                  <button className="btn btn-secondary btn-sm" onClick={() => moveTaskHorizontally(task, -1)} disabled={getBoardColumn(task) === 'backlog'}>&larr;</button>
                                  <button className="btn btn-secondary btn-sm" onClick={() => moveTaskHorizontally(task, 1)} disabled={getBoardColumn(task) === 'done'}>&rarr;</button>
                                  {getBoardColumn(task) !== 'done' ? (
                                    <button className="btn btn-secondary btn-sm" onClick={() => moveBoardTask(task, 'done')}>Done</button>
                                  ) : (
                                    <button className="btn btn-secondary btn-sm" onClick={() => moveBoardTask(task, 'backlog')}>Reopen</button>
                                  )}
                                  <button className="btn btn-danger btn-sm" onClick={() => {
                                    if (window.confirm(`Delete "${task.title}"?`)) {
                                      app.removeTask(task.id);
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
                    <div style={{ display: 'grid', gap: 16 }}>
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
                                    <button className="btn btn-secondary btn-sm" onClick={() => app.updateTask(goal.id, {
                                      completed: !goal.completed,
                                      completedAt: goal.completed ? undefined : new Date().toISOString(),
                                    })}>
                                      {goal.completed ? 'Reopen' : 'Complete'}
                                    </button>
                                    <button className="btn btn-secondary btn-sm" onClick={() => openMilestoneForm(goal)}>Edit</button>
                                    <button className="btn btn-danger btn-sm" onClick={() => {
                                      if (window.confirm(`Delete milestone "${goal.title}"?`)) {
                                        app.removeTask(goal.id);
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
                    <div className="project-wiki-layout">
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
                              app.updateProjectPage(selectedPage.id, {
                                title: title.trim() || 'Untitled Page',
                                content,
                              });
                            }}
                            onDelete={() => {
                              if (window.confirm(`Delete wiki page "${selectedPage.title}"?`)) {
                                app.removeProjectPage(selectedPage.id);
                              }
                            }}
                          />
                        ) : (
                          <div style={{ fontSize: 13, color: '#8b8fa3' }}>Select a page to edit your project wiki.</div>
                        )}
                      </div>
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
        )}
      </div>

      {showProjectForm && (
        <div className="modal-overlay" onClick={() => setShowProjectForm(false)}>
          <div className="modal" onClick={event => event.stopPropagation()} role="dialog" aria-modal="true" aria-label={editingProject ? 'Edit Project' : 'Add Project'}>
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
                <label htmlFor="project-status">Status</label>
                <select id="project-status" className="form-select" value={projectStatus} onChange={event => setProjectStatus(event.target.value as ProjectStatus)}>
                  {PROJECT_STATUS_OPTIONS.map(status => (
                    <option key={status} value={status}>{getStatusLabel(status)}</option>
                  ))}
                </select>
              </div>
              <div className="form-group">
                <label htmlFor="project-tags">Tags</label>
                <input id="project-tags" className="form-input" value={projectTagsInput} onChange={event => setProjectTagsInput(event.target.value)} placeholder="client, launch, frontend" />
              </div>
            </div>
            <div className="form-group">
              <label htmlFor="project-path">Local Path</label>
              <div style={{ display: 'grid', gridTemplateColumns: desktopPathActions ? '1fr auto' : '1fr', gap: 8 }}>
                <input id="project-path" className="form-input" value={projectLocalPath} onChange={event => setProjectLocalPath(event.target.value)} placeholder="C:\\Users\\you\\projects\\your-app" />
                {desktopPathActions && <button className="btn btn-secondary btn-sm" type="button" onClick={() => { void browseForPath(); }}>Browse</button>}
              </div>
            </div>
            <label style={{ display: 'flex', gap: 8, alignItems: 'center', fontSize: 13, color: '#cfd3e6' }}>
              <input type="checkbox" checked={projectPinned} onChange={event => setProjectPinned(event.target.checked)} />
              Pin this project in the portfolio rail
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
