import { describe, expect, it } from 'vitest';
import {
  DEFAULT_PROJECT_CATALOGUE_FILTERS,
  buildBoardMoveUpdate,
  buildBoardTask,
  buildMilestone,
  buildNewProject,
  buildProjectActivity,
  buildProjectReference,
  canSaveProjectDraft,
  collectProjectTags,
  countLiveProjects,
  filterProjects,
  getAdjacentBoardColumn,
  getBoardColumn,
  getNextBoardOrder,
  getNextProjectTab,
  getProjectAvailability,
  getProjectPages,
  getProjectWork,
  groupBoardTasks,
  groupProjects,
  hasActiveCatalogueFilters,
  milestoneDraftFrom,
  needsBlockedReason,
  parseTagsInput,
  planProjectEdit,
  projectDraftFrom,
  resolvePageId,
  resolveProjectId,
  searchProjectPages,
  shouldRevealArchived,
  sortMilestones,
  summarizeProjectWork,
  withDraftStatus,
  type ProjectCatalogueFilters,
} from '../services/projectModel';
import { makeTask } from './fixtures';
import { makeProject, makeProjectPage } from './projectFixtures';

const NOW = '2026-09-26T09:00:00.000Z';

function filters(changes: Partial<ProjectCatalogueFilters>): ProjectCatalogueFilters {
  return { ...DEFAULT_PROJECT_CATALOGUE_FILTERS, ...changes };
}

describe('project availability', () => {
  it('treats only an http(s) deployment or demo link as live', () => {
    const live = makeProject({ links: [{ id: 'l', kind: 'deployment', label: 'Live', url: 'https://atlas.example' }] });
    const repoOnly = makeProject({ links: [{ id: 'r', kind: 'repository', label: 'Repo', url: 'https://github.com/x/y' }] });
    const unsafe = makeProject({ links: [{ id: 'd', kind: 'demo', label: 'Demo', url: 'javascript:alert(1)' }] });

    expect(getProjectAvailability(live).key).toBe('live');
    expect(getProjectAvailability(repoOnly).key).toBe('reference');
    expect(getProjectAvailability(unsafe).key).toBe('reference');
    expect(countLiveProjects([live, repoOnly, unsafe])).toBe(1);
  });
});

describe('catalogue filtering', () => {
  const atlas = makeProject({ id: 'atlas', name: 'Atlas', tags: ['home'], status: 'active' });
  const forge = makeProject({ id: 'forge', name: 'Forge', kind: 'hardware', tags: ['Workshop'], status: 'planning', summary: 'Bench tools' });
  const vault = makeProject({ id: 'vault', name: 'Vault', tags: [], status: 'archived', links: [{ id: 'v', kind: 'documentation', label: 'Runbook', url: 'https://docs.example' }] });
  const all = [atlas, forge, vault];

  it('keeps everything with the default filters and reports no active filter', () => {
    expect(filterProjects(all, DEFAULT_PROJECT_CATALOGUE_FILTERS)).toEqual(all);
    expect(hasActiveCatalogueFilters(DEFAULT_PROJECT_CATALOGUE_FILTERS)).toBe(false);
    expect(hasActiveCatalogueFilters(filters({ query: '   ' }))).toBe(false);
  });

  it('searches names, summaries, tags, and link labels case-insensitively', () => {
    expect(filterProjects(all, filters({ query: 'BENCH' }))).toEqual([forge]);
    expect(filterProjects(all, filters({ query: 'workshop' }))).toEqual([forge]);
    expect(filterProjects(all, filters({ query: 'runbook' }))).toEqual([vault]);
  });

  it('combines status, kind, tag, and quick filters', () => {
    expect(filterProjects(all, filters({ status: 'archived' }))).toEqual([vault]);
    expect(filterProjects(all, filters({ kind: 'hardware' }))).toEqual([forge]);
    expect(filterProjects(all, filters({ tag: 'home' }))).toEqual([atlas]);
    expect(filterProjects(all, filters({ catalog: 'active' }))).toEqual([atlas, forge]);
    expect(filterProjects(all, filters({ catalog: 'hardware' }))).toEqual([forge]);
    expect(filterProjects(all, filters({ catalog: 'live' }))).toEqual([]);
    expect(filterProjects(all, filters({ catalog: 'reference', tag: 'home' }))).toEqual([atlas]);
  });

  it('collects each tag once in sorted order', () => {
    expect(collectProjectTags([atlas, forge, makeProject({ tags: ['home', 'alpha'] })])).toEqual(['alpha', 'home', 'Workshop']);
  });

  it('reveals archived results only for a search or the Archived status', () => {
    expect(shouldRevealArchived(filters({ query: 'vault' }), 1)).toBe(true);
    expect(shouldRevealArchived(filters({ status: 'archived' }), 1)).toBe(true);
    expect(shouldRevealArchived(filters({ query: 'vault' }), 0)).toBe(false);
    expect(shouldRevealArchived(filters({ kind: 'cli' }), 1)).toBe(false);
  });
});

describe('catalogue grouping', () => {
  it('places projects in pinned, projects, archived, and workspace rail groups', () => {
    const pinned = makeProject({ id: 'p', name: 'Pinned', isPinned: true });
    const planning = makeProject({ id: 'b', name: 'Beta', status: 'planning' });
    const active = makeProject({ id: 'a', name: 'Alpha', status: 'active' });
    const blocked = makeProject({ id: 'x', name: 'Blocked', status: 'blocked' });
    const archived = makeProject({ id: 'z', name: 'Old', status: 'archived' });

    const grouped = groupProjects([pinned, planning, active, blocked, archived]);

    expect(grouped.pinned.map(project => project.id)).toEqual(['p']);
    expect(grouped.projects.map(project => project.id)).toEqual(['a', 'b', 'x']);
    expect(grouped.active.map(project => project.id)).toEqual(['a', 'b']);
    expect(grouped.blocked.map(project => project.id)).toEqual(['x']);
    expect(grouped.archived.map(project => project.id)).toEqual(['z']);
  });

  it('honours persisted manual order before names', () => {
    const zed = makeProject({ id: 'z', name: 'Zed', sortOrder: 0 });
    const amy = makeProject({ id: 'a', name: 'Amy', sortOrder: 1 });
    expect(groupProjects([amy, zed]).projects.map(project => project.id)).toEqual(['z', 'a']);
  });

  it('resolves a requested id only while that project exists', () => {
    const projects = [makeProject({ id: 'atlas' })];
    expect(resolveProjectId(projects, 'atlas')).toBe('atlas');
    expect(resolveProjectId(projects, 'removed')).toBeNull();
    expect(resolveProjectId(projects, null)).toBeNull();
  });
});

describe('project work summary', () => {
  const tasks = [
    makeTask({ id: 'open', projectId: 'atlas', dueDate: '2026-09-25' }),
    makeTask({ id: 'due-today', projectId: 'atlas', dueDate: '2026-09-26' }),
    makeTask({ id: 'blocked', projectId: 'atlas', workflowState: 'blocked' }),
    makeTask({ id: 'done', projectId: 'atlas', completed: true, dueDate: '2026-01-01' }),
    makeTask({ id: 'goal-open', projectId: 'atlas', category: 'goal', workflowState: 'blocked' }),
    makeTask({ id: 'goal-done', projectId: 'atlas', category: 'goal', completed: true }),
    makeTask({ id: 'goal-done-2', projectId: 'atlas', category: 'goal', completed: true }),
    makeTask({ id: 'elsewhere', projectId: 'forge' }),
  ];

  it('splits a project\'s tasks into board cards and milestones', () => {
    const work = getProjectWork(tasks, 'atlas');
    expect(work.all).toHaveLength(7);
    expect(work.board.map(task => task.id)).toEqual(['open', 'due-today', 'blocked', 'done']);
    expect(work.milestones.map(task => task.id)).toEqual(['goal-open', 'goal-done', 'goal-done-2']);
  });

  it('counts open, blocked board cards, strictly overdue, completed, and milestone progress', () => {
    expect(summarizeProjectWork(getProjectWork(tasks, 'atlas'), '2026-09-26')).toEqual({
      openCount: 4,
      blockedCount: 1,
      overdueCount: 1,
      completedCount: 3,
      milestoneCount: 3,
      activeMilestoneCount: 1,
      completedMilestoneCount: 2,
      milestoneProgress: 67,
    });
  });

  it('reports zero progress when a project has no milestones', () => {
    expect(summarizeProjectWork(getProjectWork([], 'atlas'), '2026-09-26').milestoneProgress).toBe(0);
  });

  it('lists the six most recent task and page updates', () => {
    const recentTasks = Array.from({ length: 5 }, (_, index) => makeTask({ id: `t${index}`, updatedAt: `2026-09-0${index + 1}T00:00:00.000Z` }));
    const page = makeProjectPage({ id: 'page', title: 'Notes', updatedAt: '2026-09-20T00:00:00.000Z' });
    const activity = buildProjectActivity(recentTasks, [page, makeProjectPage({ id: 'old', updatedAt: '2026-08-01T00:00:00.000Z' })]);
    expect(activity).toHaveLength(6);
    expect(activity[0]).toEqual({ id: 'page', label: 'Notes', updatedAt: '2026-09-20T00:00:00.000Z', type: 'page' });
    expect(activity.map(item => item.id)).not.toContain('old');
  });

  it('orders open milestones first, then by target date with undated last', () => {
    const sorted = sortMilestones([
      makeTask({ id: 'done', completed: true, dueDate: '2026-01-01' }),
      makeTask({ id: 'undated' }),
      makeTask({ id: 'late', dueDate: '2026-12-01' }),
      makeTask({ id: 'soon', dueDate: '2026-10-01' }),
    ]);
    expect(sorted.map(task => task.id)).toEqual(['soon', 'late', 'undated', 'done']);
  });
});

describe('board', () => {
  it('places completed cards in Done and unassigned cards in Backlog', () => {
    expect(getBoardColumn(makeTask({ completed: true, workflowState: 'blocked' }))).toBe('done');
    expect(getBoardColumn(makeTask())).toBe('backlog');
    expect(getBoardColumn(makeTask({ workflowState: 'in_progress' }))).toBe('in_progress');
  });

  it('sorts a column by manual order, then due date, then most recent update', () => {
    const columns = groupBoardTasks([
      makeTask({ id: 'unordered-late', dueDate: '2026-10-02' }),
      makeTask({ id: 'unordered-soon', dueDate: '2026-10-01' }),
      makeTask({ id: 'second', boardOrder: 2 }),
      makeTask({ id: 'first', boardOrder: 1 }),
      makeTask({ id: 'done', completed: true }),
    ]);
    expect(columns.backlog.map(task => task.id)).toEqual(['first', 'second', 'unordered-soon', 'unordered-late']);
    expect(columns.done.map(task => task.id)).toEqual(['done']);
    expect(columns.blocked).toEqual([]);
  });

  it('puts the next card after the highest order, ignoring the card being moved', () => {
    const column = [makeTask({ id: 'a', boardOrder: 3 }), makeTask({ id: 'b', boardOrder: 7 })];
    expect(getNextBoardOrder(column)).toBe(8);
    expect(getNextBoardOrder(column, 'b')).toBe(4);
    expect(getNextBoardOrder([])).toBe(1);
  });

  it('moves one column at a time and stops at either end', () => {
    expect(getAdjacentBoardColumn(makeTask(), 1)).toBe('next_up');
    expect(getAdjacentBoardColumn(makeTask(), -1)).toBeNull();
    expect(getAdjacentBoardColumn(makeTask({ workflowState: 'blocked' }), 1)).toBe('done');
    expect(getAdjacentBoardColumn(makeTask({ completed: true }), 1)).toBeNull();
  });

  it('completes a card in Done, keeping an earlier completion time', () => {
    expect(buildBoardMoveUpdate(makeTask(), 'done', { now: NOW, boardOrder: 1 })).toEqual({ completed: true, completedAt: NOW });
    expect(buildBoardMoveUpdate(makeTask({ completedAt: '2026-01-01T00:00:00.000Z' }), 'done', { now: NOW, boardOrder: 1 }))
      .toEqual({ completed: true, completedAt: '2026-01-01T00:00:00.000Z' });
  });

  it('records the blocked reason when entering Blocked and clears it when leaving', () => {
    const task = makeTask();
    expect(needsBlockedReason(task, 'blocked')).toBe(true);
    expect(buildBoardMoveUpdate(task, 'blocked', { now: NOW, boardOrder: 2, blockedReasonAnswer: '  Waiting on parts ' })).toEqual({
      completed: false,
      completedAt: undefined,
      workflowState: 'blocked',
      blockedReason: 'Waiting on parts',
      boardOrder: 2,
    });
    expect(buildBoardMoveUpdate(task, 'blocked', { now: NOW, boardOrder: 2, blockedReasonAnswer: null }).blockedReason).toBeUndefined();

    const blocked = makeTask({ workflowState: 'blocked', blockedReason: 'Parts' });
    expect(needsBlockedReason(blocked, 'blocked')).toBe(false);
    expect(buildBoardMoveUpdate(blocked, 'in_progress', { now: NOW, boardOrder: 1 }).blockedReason).toBeUndefined();
    expect(buildBoardMoveUpdate(makeTask({ blockedReason: 'kept' }), 'next_up', { now: NOW, boardOrder: 1 }).blockedReason).toBe('kept');
  });

  it('builds a backlog card from a titled quick-add draft only', () => {
    expect(buildBoardTask({ title: '  ', dueDate: '', priority: 'medium' }, 'atlas', 1)).toBeNull();
    expect(buildBoardTask({ title: ' Wire lamp ', dueDate: '', priority: 'high' }, 'atlas', 4)).toEqual({
      title: 'Wire lamp',
      description: '',
      completed: false,
      priority: 'high',
      category: 'task',
      dueDate: undefined,
      projectId: 'atlas',
      workflowState: 'backlog',
      boardOrder: 4,
    });
  });
});

describe('milestones', () => {
  it('keeps completion and goal tag when editing', () => {
    const existing = makeTask({ id: 'g', category: 'goal', completed: true, completedAt: NOW, goalTag: 'launch', priority: 'high', dueDate: '2026-10-01' });
    const draft = milestoneDraftFrom(existing);
    expect(draft).toEqual({ title: existing.title, description: existing.description, dueDate: '2026-10-01', priority: 'high' });

    expect(buildMilestone({ ...draft, title: ' Ship ', dueDate: '' }, 'atlas', existing)).toMatchObject({
      title: 'Ship',
      completed: true,
      completedAt: NOW,
      goalTag: 'launch',
      category: 'goal',
      dueDate: undefined,
      projectId: 'atlas',
    });
  });

  it('refuses a milestone without a title', () => {
    expect(buildMilestone(milestoneDraftFrom(null), 'atlas')).toBeNull();
  });
});

describe('wiki pages', () => {
  const overview = makeProjectPage({ id: 'overview', updatedAt: '2026-01-01T00:00:00.000Z' });
  const recent = makeProjectPage({ id: 'recent', isOverview: false, title: 'Wiring', content: 'Use 2.5mm cable', updatedAt: '2026-09-01T00:00:00.000Z' });
  const older = makeProjectPage({ id: 'older', isOverview: false, title: 'Budget', updatedAt: '2026-05-01T00:00:00.000Z' });

  it('lists a project\'s overview first, then most recently updated', () => {
    const pages = getProjectPages([older, makeProjectPage({ id: 'other', projectId: 'forge' }), recent, overview], 'project-atlas');
    expect(pages.map(page => page.id)).toEqual(['overview', 'recent', 'older']);
  });

  it('searches titles and content', () => {
    expect(searchProjectPages([overview, recent, older], 'CABLE')).toEqual([recent]);
    expect(searchProjectPages([overview, recent], '  ')).toEqual([overview, recent]);
  });

  it('falls back to the first page when the picked page is not listed', () => {
    expect(resolvePageId([overview, recent], 'recent')).toBe('recent');
    expect(resolvePageId([overview, recent], 'gone')).toBe('overview');
    expect(resolvePageId([], 'gone')).toBeNull();
  });
});

describe('project editor mapping', () => {
  it('starts an empty draft as an active, unpinned project of kind Other', () => {
    const draft = projectDraftFrom(null);
    expect(draft).toMatchObject({ name: '', kind: 'other', status: 'active', pinned: false });
    expect(canSaveProjectDraft(draft)).toBe(false);
    expect(canSaveProjectDraft({ ...draft, name: '  ' })).toBe(false);
    expect(canSaveProjectDraft({ ...draft, name: 'Atlas' })).toBe(true);
  });

  it('reads repository and live links into the draft', () => {
    const draft = projectDraftFrom(makeProject({
      tags: ['home', 'paper'],
      isPinned: true,
      links: [
        { id: 'r', kind: 'repository', label: 'Repo', url: 'https://github.com/a/b' },
        { id: 'd', kind: 'deployment', label: 'Live', url: 'https://atlas.example' },
      ],
    }));
    expect(draft).toMatchObject({ repositoryUrl: 'https://github.com/a/b', deploymentUrl: 'https://atlas.example', tagsInput: 'home, paper', pinned: true });
  });

  it('unpins a draft that is archived', () => {
    const draft = { ...projectDraftFrom(null), pinned: true };
    expect(withDraftStatus(draft, 'archived')).toMatchObject({ status: 'archived', pinned: false });
    expect(withDraftStatus(draft, 'blocked')).toMatchObject({ status: 'blocked', pinned: true });
  });

  it('parses tags by trimming, dropping blanks, and removing duplicates', () => {
    expect(parseTagsInput(' home, , paper,home ,')).toEqual(['home', 'paper']);
  });

  it('builds a new project with initials, default preview colours, and typed links', () => {
    const project = buildNewProject({
      ...projectDraftFrom(null),
      name: ' sabah one ',
      repositoryUrl: ' https://github.com/x/y ',
      deploymentUrl: '',
      tagsInput: 'web',
      pinned: true,
    });
    expect(project).toMatchObject({
      name: 'sabah one',
      status: 'active',
      isPinned: true,
      tags: ['web'],
      preview: { icon: 'SO', accentColor: '#777dff', backgroundColor: '#171b2e' },
      links: [{ id: 'custom:repository', kind: 'repository', label: 'GitHub repository', url: 'https://github.com/x/y' }],
    });
    expect(buildNewProject({ ...projectDraftFrom(null), name: 'Old', status: 'archived', pinned: true }).isPinned).toBe(false);
  });

  it('keeps other links, setup, recipes, and preview when editing references', () => {
    const existing = makeProject({
      catalogKey: 'catalog:atlas',
      links: [
        { id: 'doc', kind: 'documentation', label: 'Docs', url: 'https://docs.example' },
        { id: 'old-repo', kind: 'repository', label: 'Repo', url: 'https://old.example' },
      ],
      setupSteps: [{ id: 's', title: 'Install', description: 'npm ci' }],
      preview: { icon: 'AT', accentColor: '#000', backgroundColor: '#fff' },
      verifiedAt: NOW,
    });
    const reference = buildProjectReference({ ...projectDraftFrom(existing), repositoryUrl: 'https://new.example' }, existing);
    expect(reference.links).toEqual([
      { id: 'doc', kind: 'documentation', label: 'Docs', url: 'https://docs.example' },
      { id: 'catalog:atlas:repository', kind: 'repository', label: 'GitHub repository', url: 'https://new.example' },
    ]);
    expect(reference).toMatchObject({ setupSteps: existing.setupSteps, preview: existing.preview, verifiedAt: NOW });
  });

  it('plans only the status and pin writes an edit changes', () => {
    const project = makeProject({ status: 'active', isPinned: false });
    expect(planProjectEdit(project, projectDraftFrom(project))).toEqual({ reference: expect.any(Object), status: 'active' });
    expect(planProjectEdit(project, { ...projectDraftFrom(project), status: 'blocked', pinned: true }))
      .toMatchObject({ status: 'blocked', pinned: true });
    expect(planProjectEdit(project, { ...projectDraftFrom(project), status: 'blocked' }).archived).toBeUndefined();
  });

  it('archives without status or pin writes', () => {
    const project = makeProject({ status: 'active', isPinned: true });
    const plan = planProjectEdit(project, withDraftStatus(projectDraftFrom(project), 'archived'));
    expect(plan).toEqual({ reference: expect.any(Object), archived: true });
  });

  it('unarchives to the remembered status without an extra status write', () => {
    const project = makeProject({ status: 'archived', statusBeforeArchive: 'blocked' });
    expect(planProjectEdit(project, { ...projectDraftFrom(project), status: 'blocked' })).toEqual({ reference: expect.any(Object), archived: false });
    expect(planProjectEdit(project, { ...projectDraftFrom(project), status: 'planning' }))
      .toEqual({ reference: expect.any(Object), archived: false, status: 'planning' });
  });
});

describe('workspace tabs', () => {
  it('wraps arrow keys and jumps with Home and End', () => {
    expect(getNextProjectTab('overview', 'ArrowRight')).toBe('board');
    expect(getNextProjectTab('overview', 'ArrowLeft')).toBe('wiki');
    expect(getNextProjectTab('wiki', 'ArrowRight')).toBe('overview');
    expect(getNextProjectTab('board', 'Home')).toBe('overview');
    expect(getNextProjectTab('board', 'End')).toBe('wiki');
    expect(getNextProjectTab('board', 'Enter')).toBeNull();
  });
});
