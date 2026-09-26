import type { ContextType } from 'react';
import { vi } from 'vitest';
import type { ProjectContextValue } from '../store/contexts/ProjectContext';
import type { ShellContext } from '../store/ShellContext';
import type { TaskContextValue } from '../store/contexts/TaskContext';
import type { Project, ProjectPage } from '../types/domain';

type ShellContextValue = NonNullable<ContextType<typeof ShellContext>>;

export function makeProject(overrides: Partial<Project> = {}): Project {
  return {
    id: 'project-atlas',
    name: 'Atlas',
    summary: 'Maps the household paperwork.',
    kind: 'web_app',
    status: 'active',
    tags: ['home'],
    isPinned: false,
    links: [],
    createdAt: '2026-08-01T10:00:00.000Z',
    updatedAt: '2026-08-01T10:00:00.000Z',
    ...overrides,
  };
}

export function makeProjectPage(overrides: Partial<ProjectPage> = {}): ProjectPage {
  return {
    id: 'page-overview',
    projectId: 'project-atlas',
    title: 'Overview',
    content: '# Atlas',
    isOverview: true,
    createdAt: '2026-08-01T10:00:00.000Z',
    updatedAt: '2026-08-01T10:00:00.000Z',
    ...overrides,
  };
}

/** A typed ProjectCtx fake whose mutators are spies; reads come from `overrides`. */
export function fakeProjectContext(overrides: Partial<ProjectContextValue> = {}): ProjectContextValue {
  return {
    projects: [],
    projectPages: [],
    loaded: true,
    addProject: vi.fn(() => 'project-new'),
    updateProject: vi.fn(),
    removeProject: vi.fn(),
    setProjectPinned: vi.fn(),
    setProjectArchived: vi.fn(),
    reorderProjectSection: vi.fn(),
    addProjectPage: vi.fn(() => 'page-new'),
    updateProjectPage: vi.fn(),
    removeProjectPage: vi.fn(),
    ...overrides,
  };
}

export function fakeTaskContext(overrides: Partial<TaskContextValue> = {}): TaskContextValue {
  return {
    tasks: [],
    loaded: true,
    addTask: vi.fn(() => 'task-new'),
    updateTask: vi.fn(),
    removeTask: vi.fn(),
    setTasks: vi.fn(),
    ...overrides,
  };
}

export function fakeShellContext(overrides: Partial<ShellContextValue> = {}): ShellContextValue {
  return {
    surface: 'projects',
    pageLoadError: null,
    retryPageLoad: vi.fn(),
    navigationRequest: null,
    navigate: vi.fn(),
    requestNavigation: vi.fn(),
    dismissNavigationRequest: vi.fn(),
    ...overrides,
  };
}
