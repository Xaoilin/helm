import { act, render, screen } from '@testing-library/react';
import { useEffect } from 'react';
import { beforeEach, describe, expect, it, vi } from 'vitest';
import { KnowledgeProvider, useKnowledgeContext, type KnowledgeContextValue } from '../store/contexts/KnowledgeContext';
import { ProjectProvider, useProjectContext, type ProjectContextValue } from '../store/contexts/ProjectContext';
import type { LifestyleItem, Project, ProjectPage } from '../types/domain';

const api = vi.hoisted(() => ({
  getKnowledge: vi.fn(),
  getLifestyleItems: vi.fn(),
  saveKnowledgeTopic: vi.fn(),
  deleteKnowledgeTopic: vi.fn(),
  saveKnowledgeEntry: vi.fn(),
  deleteKnowledgeEntry: vi.fn(),
  saveLifestyleItem: vi.fn(),
  moveLifestyleItem: vi.fn(),
  reorderLifestyleColumn: vi.fn(),
  deleteLifestyleItem: vi.fn(),
  getProjectCatalogue: vi.fn(),
  createProject: vi.fn(),
  updateProjectReference: vi.fn(),
  setProjectStatus: vi.fn(),
  setProjectPinned: vi.fn(),
  setProjectArchived: vi.fn(),
  reorderProjects: vi.fn(),
  deleteProject: vi.fn(),
  saveProjectPage: vi.fn(),
  deleteProjectPage: vi.fn(),
}));

vi.mock('../services/backend/knowledgeServiceApi', () => ({ ...api, isKnowledgeServiceEnabled: () => true }));

const at = '2026-09-27T10:00:00.000Z';
const item = (id: string, type: LifestyleItem['type'], sortOrder: number): LifestyleItem => ({
  id, type, title: id, notes: '', status: 'avoiding', sources: [], sortOrder, createdAt: at, updatedAt: at,
});
const project = (id: string, sortOrder: number, isPinned = false): Project => ({
  id, catalogKey: `custom:${id}`, name: id, kind: 'other', links: [], setupSteps: [], runRecipes: [],
  preview: { icon: 'folder', accentColor: '#7c6cff', backgroundColor: '#171827' }, summary: '', status: 'active',
  tags: [], isPinned, sortOrder, createdAt: at, updatedAt: at,
});
const overview = (projectId: string): ProjectPage => ({
  id: `${projectId}-overview`, projectId, title: 'Overview', content: '', isOverview: true, createdAt: at, updatedAt: at,
});

let knowledge: KnowledgeContextValue;
let projects: ProjectContextValue;

function Probe() {
  const knowledgeValue = useKnowledgeContext();
  const projectValue = useProjectContext();
  useEffect(() => { knowledge = knowledgeValue; projects = projectValue; }, [knowledgeValue, projectValue]);
  return <output>{`${knowledgeValue.loaded && projectValue.loaded ? 'loaded' : 'loading'}|${projectValue.error ?? ''}`}</output>;
}

async function renderLoaded(items: LifestyleItem[], catalogue: { projects: Project[]; pages: ProjectPage[] }) {
  api.getKnowledge.mockResolvedValue({ topics: [], entries: [] });
  api.getLifestyleItems.mockResolvedValue(items);
  api.getProjectCatalogue.mockResolvedValue(catalogue);
  render(<ProjectProvider><KnowledgeProvider><Probe /></KnowledgeProvider></ProjectProvider>);
  await screen.findByText('loaded|');
}

describe('knowledge service contexts', () => {
  beforeEach(() => Object.values(api).forEach(mock => mock.mockReset()));

  it('moves a lifestyle item through the service and shows the columns it answers with', async () => {
    await renderLoaded([item('a', 'haram', 0), item('b', 'halal', 0)], { projects: [], pages: [] });
    const answered = [{ ...item('a', 'halal', 0), status: 'want-to-start' as const }, item('b', 'halal', 1)];
    api.moveLifestyleItem.mockResolvedValue(answered);

    await act(async () => { knowledge.moveLifestyleItem('a', 'halal', 0); });

    expect(api.moveLifestyleItem).toHaveBeenCalledExactlyOnceWith('a', 'halal', 0);
    expect(knowledge.lifestyleItems).toEqual(answered);
  });

  it('pins a project with one write and shows the catalogue the service stored', async () => {
    await renderLoaded([], { projects: [project('a', 0), project('b', 1)], pages: [overview('a'), overview('b')] });
    const stored = { projects: [project('b', 0, true), project('a', 0)], pages: [overview('a'), overview('b')] };
    api.setProjectPinned.mockResolvedValue(stored);

    await act(async () => { projects.setProjectPinned('b', true); });

    expect(api.setProjectPinned).toHaveBeenCalledExactlyOnceWith('b', true);
    expect(projects.projects).toEqual(stored.projects);
  });

  it('shows a refused reorder and reloads what the service holds', async () => {
    const catalogue = { projects: [project('a', 0), project('b', 1)], pages: [] };
    await renderLoaded([], catalogue);
    api.reorderProjects.mockRejectedValue(new Error('The catalogue changed since it was shown; reload and try again.'));

    await act(async () => { projects.reorderProjectSection('projects', ['b', 'a']); });

    expect(await screen.findByText(/Your last change was not saved: The catalogue changed/u)).toBeInTheDocument();
    expect(api.getProjectCatalogue).toHaveBeenCalledTimes(2);
    expect(projects.projects).toEqual(catalogue.projects);
  });
});
