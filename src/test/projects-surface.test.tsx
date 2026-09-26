import { fireEvent, screen, within } from '@testing-library/react';
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';

// dnd-kit observes element sizes at import time; jsdom has no ResizeObserver.
vi.hoisted(() => {
  globalThis.ResizeObserver ??= class {
    observe() {}
    unobserve() {}
    disconnect() {}
  };
});

import ProjectsSurface from '../surfaces/ProjectsSurface';
import { ShellContext } from '../store/ShellContext';
import { ProjectCtx, type ProjectContextValue } from '../store/contexts/ProjectContext';
import { TaskCtx, type TaskContextValue } from '../store/contexts/TaskContext';
import { provide, renderWithContexts } from './renderWithContexts';
import { makeTask } from './fixtures';
import {
  fakeProjectContext,
  fakeShellContext,
  fakeTaskContext,
  makeProject,
  makeProjectPage,
} from './projectFixtures';

const ATLAS = makeProject({ id: 'atlas', name: 'Atlas', tags: ['home'] });
const FORGE = makeProject({ id: 'forge', name: 'Forge', kind: 'hardware', tags: ['workshop'], isPinned: true });

function renderSurface({
  project = {},
  task = {},
  shell = {},
}: {
  project?: Partial<ProjectContextValue>;
  task?: Partial<TaskContextValue>;
  shell?: Parameters<typeof fakeShellContext>[0];
} = {}) {
  const projects = fakeProjectContext({ projects: [ATLAS, FORGE], ...project });
  const tasks = fakeTaskContext(task);
  const shellValue = fakeShellContext(shell);
  renderWithContexts(<ProjectsSurface />, [
    provide(ShellContext, shellValue),
    provide(ProjectCtx, projects),
    provide(TaskCtx, tasks),
  ]);
  return { projects, tasks, shell: shellValue };
}

function openDetails(projectId: string) {
  const button = document.querySelector<HTMLButtonElement>(`[data-project-open-id="${projectId}"]`);
  if (!button) throw new Error(`No card for ${projectId}`);
  fireEvent.click(button);
  return screen.getByRole('dialog');
}

function openWorkspace(projectId: string) {
  fireEvent.click(within(openDetails(projectId)).getByRole('button', { name: 'Manage project' }));
}

describe('Projects surface', () => {
  beforeEach(() => {
    vi.spyOn(HTMLElement.prototype, 'getClientRects').mockReturnValue([{ width: 10, height: 10 }] as unknown as DOMRectList);
  });

  afterEach(() => {
    vi.restoreAllMocks();
  });

  describe('catalogue', () => {
    it('invites the first project when there are none', () => {
      renderSurface({ project: { projects: [] } });
      expect(screen.getByRole('heading', { name: 'Build your project reference catalogue' })).toBeInTheDocument();
      expect(screen.getByText('No projects yet')).toBeInTheDocument();
    });

    it('lists projects by section with a result count', () => {
      renderSurface();
      expect(screen.getByText('2 projects in your reference catalogue')).toBeInTheDocument();
      expect(screen.getByRole('heading', { name: 'Pinned' })).toBeInTheDocument();
      expect(screen.getByRole('heading', { name: 'Atlas' })).toBeInTheDocument();
      expect(screen.getByRole('heading', { name: 'Forge' })).toBeInTheDocument();
      expect(screen.getByText('2 results')).toBeInTheDocument();
    });

    it('narrows the list with search and clears the filters again', () => {
      renderSurface();
      fireEvent.change(screen.getByPlaceholderText('Projects, links, tags, or summaries'), { target: { value: 'workshop' } });
      expect(screen.getByText('1 result')).toBeInTheDocument();
      expect(screen.queryByRole('heading', { name: 'Atlas' })).not.toBeInTheDocument();

      fireEvent.click(screen.getByRole('button', { name: 'Clear filters to reorder' }));
      expect(screen.getByText('2 results')).toBeInTheDocument();
    });

    it('pins a project through the store and announces it', () => {
      const { projects } = renderSurface();
      fireEvent.click(screen.getByRole('button', { name: 'Pin Atlas' }));
      expect(projects.setProjectPinned).toHaveBeenCalledWith('atlas', true);
      expect(screen.getByText('Atlas pinned.')).toBeInTheDocument();
    });
  });

  describe('project editor', () => {
    it('keeps Create disabled until the project has a name', () => {
      renderSurface();
      fireEvent.click(screen.getByRole('button', { name: '+ Add Project' }));
      const dialog = screen.getByRole('dialog', { name: 'Add Project' });
      const create = within(dialog).getByRole('button', { name: 'Create Project' });
      expect(create).toBeDisabled();

      fireEvent.change(within(dialog).getByLabelText('Name'), { target: { value: '   ' } });
      expect(create).toBeDisabled();

      fireEvent.change(within(dialog).getByLabelText('Name'), { target: { value: 'Lamp' } });
      expect(create).toBeEnabled();
    });

    it('creates a project through addProject and closes', () => {
      const { projects } = renderSurface();
      fireEvent.click(screen.getByRole('button', { name: '+ Add Project' }));
      const dialog = screen.getByRole('dialog', { name: 'Add Project' });
      fireEvent.change(within(dialog).getByLabelText('Name'), { target: { value: ' Desk lamp ' } });
      fireEvent.change(within(dialog).getByLabelText('Tags'), { target: { value: 'hardware, home' } });
      fireEvent.change(within(dialog).getByLabelText('Live URL'), { target: { value: 'https://lamp.example' } });
      fireEvent.click(within(dialog).getByRole('checkbox'));
      fireEvent.click(within(dialog).getByRole('button', { name: 'Create Project' }));

      expect(projects.addProject).toHaveBeenCalledWith(expect.objectContaining({
        name: 'Desk lamp',
        status: 'active',
        isPinned: true,
        tags: ['hardware', 'home'],
        links: [expect.objectContaining({ kind: 'deployment', url: 'https://lamp.example' })],
      }));
      expect(projects.updateProject).not.toHaveBeenCalled();
      expect(screen.queryByRole('dialog', { name: 'Add Project' })).not.toBeInTheDocument();
    });

    it('keeps focus inside the editor, closes on Escape, and returns focus', () => {
      renderSurface();
      const opener = screen.getByRole('button', { name: '+ Add Project' });
      opener.focus();
      fireEvent.click(opener);
      const dialog = screen.getByRole('dialog', { name: 'Add Project' });
      // jsdom's selector engine does not return the dialog's controls in document
      // order, so this checks containment; use-dialog.test.tsx covers wrap order.
      expect(dialog).toContainElement(document.activeElement as HTMLElement);

      fireEvent.keyDown(document, { key: 'Tab', shiftKey: true });
      expect(dialog).toContainElement(document.activeElement as HTMLElement);
      fireEvent.keyDown(document, { key: 'Tab' });
      expect(dialog).toContainElement(document.activeElement as HTMLElement);
      opener.focus();
      expect(dialog).toContainElement(document.activeElement as HTMLElement);

      fireEvent.keyDown(document, { key: 'Escape' });
      expect(screen.queryByRole('dialog', { name: 'Add Project' })).not.toBeInTheDocument();
      expect(opener).toHaveFocus();
    });

    it('edits an existing project from its details through updateProject', () => {
      const { projects } = renderSurface();
      fireEvent.click(within(openDetails('atlas')).getByRole('button', { name: 'Edit project' }));
      const dialog = screen.getByRole('dialog', { name: 'Edit Project' });
      expect(within(dialog).getByLabelText('Name')).toHaveValue('Atlas');

      fireEvent.change(within(dialog).getByLabelText('Name'), { target: { value: 'Atlas 2' } });
      fireEvent.click(within(dialog).getByRole('button', { name: 'Save Project' }));

      expect(projects.updateProject).toHaveBeenCalledWith('atlas', expect.objectContaining({ name: 'Atlas 2' }));
      expect(projects.updateProject).toHaveBeenCalledWith('atlas', { status: 'active' });
      expect(projects.addProject).not.toHaveBeenCalled();
      expect(projects.setProjectArchived).not.toHaveBeenCalled();
      expect(projects.setProjectPinned).not.toHaveBeenCalled();
    });

    it('archives through setProjectArchived when the status becomes Archived', () => {
      const { projects } = renderSurface();
      fireEvent.click(within(openDetails('forge')).getByRole('button', { name: 'Edit project' }));
      const dialog = screen.getByRole('dialog', { name: 'Edit Project' });
      fireEvent.change(within(dialog).getByLabelText('Status'), { target: { value: 'archived' } });
      expect(within(dialog).getByRole('checkbox')).not.toBeChecked();
      fireEvent.click(within(dialog).getByRole('button', { name: 'Save Project' }));

      expect(projects.setProjectArchived).toHaveBeenCalledWith('forge', true);
      expect(projects.setProjectPinned).not.toHaveBeenCalled();
      expect(projects.updateProject).toHaveBeenCalledTimes(1);
    });
  });

  describe('management workspace', () => {
    it('opens the workspace with metrics for the project\'s linked work', () => {
      renderSurface({
        task: {
          tasks: [
            makeTask({ id: 'open', projectId: 'atlas', dueDate: '2000-01-01' }),
            makeTask({ id: 'done', projectId: 'atlas', completed: true }),
          ],
        },
      });
      openWorkspace('atlas');

      expect(screen.getByRole('button', { name: '← Back to all projects' })).toHaveFocus();
      expect(screen.getByRole('tab', { name: 'Overview' })).toHaveAttribute('aria-selected', 'true');
      const overview = screen.getByRole('tabpanel');
      expect(within(overview).getByText('Open Work').nextElementSibling).toHaveTextContent('1');
      expect(within(overview).getByText('Overdue').nextElementSibling).toHaveTextContent('1');
      expect(within(overview).getByText('Completed').nextElementSibling).toHaveTextContent('1');
    });

    it('adds a board card to the backlog through addTask', () => {
      const { tasks } = renderSurface({ task: { tasks: [makeTask({ id: 'first', projectId: 'atlas', boardOrder: 3 })] } });
      openWorkspace('atlas');
      fireEvent.click(screen.getByRole('tab', { name: 'Board' }));
      fireEvent.change(screen.getByPlaceholderText('Quick add task'), { target: { value: 'Wire the lamp' } });
      fireEvent.click(screen.getByRole('button', { name: 'Add' }));

      expect(tasks.addTask).toHaveBeenCalledWith(expect.objectContaining({
        title: 'Wire the lamp',
        projectId: 'atlas',
        workflowState: 'backlog',
        boardOrder: 4,
      }));
      expect(screen.getByPlaceholderText('Quick add task')).toHaveValue('');
    });

    it('moves a card to Done through updateTask', () => {
      const { tasks } = renderSurface({ task: { tasks: [makeTask({ id: 'first', title: 'Solder', projectId: 'atlas' })] } });
      openWorkspace('atlas');
      fireEvent.click(screen.getByRole('tab', { name: 'Board' }));
      fireEvent.click(screen.getByRole('button', { name: 'Done' }));

      expect(tasks.updateTask).toHaveBeenCalledWith('first', expect.objectContaining({ completed: true }));
    });

    it('saves a new milestone through addTask', () => {
      const { tasks } = renderSurface();
      openWorkspace('atlas');
      fireEvent.click(screen.getByRole('tab', { name: 'Milestones' }));
      fireEvent.click(screen.getAllByRole('button', { name: '+ Add Milestone' })[0]);
      const dialog = screen.getByRole('dialog', { name: 'Add Milestone' });
      fireEvent.change(within(dialog).getByLabelText('Title'), { target: { value: 'First light' } });
      fireEvent.click(within(dialog).getByRole('button', { name: 'Create Milestone' }));

      expect(tasks.addTask).toHaveBeenCalledWith(expect.objectContaining({ title: 'First light', category: 'goal', projectId: 'atlas' }));
      expect(screen.queryByRole('dialog', { name: 'Add Milestone' })).not.toBeInTheDocument();
    });

    it('saves a wiki page through updateProjectPage', () => {
      const { projects } = renderSurface({ project: { projectPages: [makeProjectPage({ id: 'overview', projectId: 'atlas', title: 'Overview' })] } });
      openWorkspace('atlas');
      fireEvent.click(screen.getByRole('tab', { name: 'Wiki' }));
      fireEvent.change(screen.getByPlaceholderText('Page title'), { target: { value: '  ' } });
      fireEvent.click(screen.getByRole('button', { name: 'Save Page' }));

      expect(projects.updateProjectPage).toHaveBeenCalledWith('overview', { title: 'Untitled Page', content: '# Atlas' });
    });

    it('returns to the catalogue from the workspace', () => {
      renderSurface();
      openWorkspace('atlas');
      fireEvent.click(screen.getByRole('button', { name: '← Back to all projects' }));
      expect(screen.getByRole('heading', { name: 'Your work, easy to find again.' })).toBeInTheDocument();
    });
  });
});
