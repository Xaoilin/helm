import { act, renderHook } from '@testing-library/react';
import { afterEach, describe, expect, it, vi } from 'vitest';
import { useProjectCatalogue } from '../components/projects/useProjectCatalogue';
import { useProjectSelection } from '../components/projects/useProjectSelection';
import { ProjectCtx } from '../store/contexts/ProjectContext';
import { provide, renderHookWithContexts } from './renderWithContexts';
import { fakeProjectContext, makeProject } from './projectFixtures';

const ATLAS = makeProject({ id: 'atlas', name: 'Atlas' });
const VAULT = makeProject({ id: 'vault', name: 'Vault', status: 'archived' });

function renderCatalogue() {
  const store = fakeProjectContext({ projects: [ATLAS, VAULT] });
  const hook = renderHookWithContexts(() => useProjectCatalogue(), [provide(ProjectCtx, store)]);
  return { store, ...hook };
}

describe('useProjectCatalogue', () => {
  afterEach(() => {
    vi.restoreAllMocks();
    vi.unstubAllGlobals();
  });

  it('filters and groups the store\'s projects', () => {
    const { result } = renderCatalogue();
    expect(result.current.filteredProjects).toHaveLength(2);
    expect(result.current.archivedExpanded).toBe(false);

    act(() => result.current.updateFilters({ kind: 'cli' }));
    expect(result.current.isFiltered).toBe(true);
    expect(result.current.filteredProjects).toEqual([]);
  });

  it('opens Archived when a search could match archived projects', () => {
    const { result } = renderCatalogue();
    act(() => result.current.updateFilters({ query: 'vault' }));
    expect(result.current.archivedExpanded).toBe(true);
  });

  it('archiving shows the whole catalogue with Archived open and announces it', () => {
    const { result, store } = renderCatalogue();
    act(() => result.current.updateFilters({ kind: 'cli', tag: 'home' }));

    act(() => result.current.changeArchived(ATLAS, true, false));

    expect(store.setProjectArchived).toHaveBeenCalledWith('atlas', true);
    expect(result.current.isFiltered).toBe(false);
    expect(result.current.archivedExpanded).toBe(true);
    expect(result.current.announcement).toBe('Atlas archived.');
  });

  it('restoring leaves other filters but drops an Archived status filter', () => {
    const { result } = renderCatalogue();
    act(() => result.current.updateFilters({ status: 'archived', tag: 'home' }));

    act(() => result.current.changeArchived(VAULT, false, false));

    expect(result.current.filters).toMatchObject({ status: 'all', tag: 'home' });
    expect(result.current.announcement).toBe('Vault restored to Projects.');
  });

  it('announces pin changes', () => {
    const { result, store } = renderCatalogue();
    act(() => result.current.changePinned(ATLAS, true, false));
    expect(store.setProjectPinned).toHaveBeenCalledWith('atlas', true);
    expect(result.current.announcement).toBe('Atlas pinned.');
  });

  it('announces when copying to the clipboard fails', async () => {
    vi.stubGlobal('navigator', { clipboard: { writeText: vi.fn().mockRejectedValue(new Error('denied')) } });
    const { result } = renderCatalogue();

    await act(() => result.current.copyReference('npm ci', 'Install command'));

    expect(result.current.announcement).toBe('Unable to copy Install command.');
  });
});

describe('useProjectSelection', () => {
  const projects = [ATLAS, VAULT];

  it('prefers the managed project, then the drawer\'s, then the last one picked', () => {
    const { result } = renderHook(() => useProjectSelection(projects));
    act(() => result.current.pickProject('vault'));
    expect(result.current.selectedProjectId).toBe('vault');

    act(() => result.current.openDetails('atlas'));
    expect(result.current.selectedProjectId).toBe('atlas');
    expect(result.current.detailProject?.id).toBe('atlas');

    act(() => result.current.manage('atlas'));
    expect(result.current.detailProject).toBeNull();
    expect(result.current.managedProjectId).toBe('atlas');
    act(() => result.current.pickProject('vault'));
    expect(result.current.selectedProjectId).toBe('atlas');
  });

  it('resolves a removed project to nothing selected', () => {
    const { result, rerender } = renderHook(({ list }) => useProjectSelection(list), { initialProps: { list: projects } });
    act(() => result.current.pickProject('vault'));
    rerender({ list: [ATLAS] });
    expect(result.current.selectedProject).toBeNull();
  });

  it('returns to the overview tab when leaving the workspace or revealing a project', () => {
    const { result } = renderHook(() => useProjectSelection(projects));
    act(() => result.current.manage('atlas'));
    act(() => result.current.setActiveTab('wiki'));
    act(() => result.current.leaveManagement());
    expect(result.current).toMatchObject({ managedProjectId: null, selectedProjectId: null, activeTab: 'overview' });

    act(() => result.current.manage('atlas'));
    act(() => result.current.setActiveTab('board'));
    act(() => result.current.reveal('vault'));
    expect(result.current).toMatchObject({ managedProjectId: null, activeTab: 'overview' });
    expect(result.current.detailProject?.id).toBe('vault');
  });
});
