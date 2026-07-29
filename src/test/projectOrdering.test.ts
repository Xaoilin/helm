import { describe, expect, it } from 'vitest';
import type { Project } from '../types/domain';
import {
  appendProjectToCollection,
  getOrderedProjectsInSection,
  reorderProjectsInSection,
  setProjectArchivedInCollection,
  setProjectPinnedInCollection,
} from '../store/projectOrdering';

const NOW = '2026-07-29T12:00:00.000Z';
const LATER = '2026-07-29T13:00:00.000Z';

function project(
  id: string,
  name: string,
  overrides: Partial<Project> = {},
): Project {
  return {
    id,
    catalogKey: `fixture:${id}`,
    name,
    summary: '',
    status: 'active',
    tags: [],
    isPinned: false,
    createdAt: NOW,
    updatedAt: NOW,
    ...overrides,
  };
}

function sectionIds(projects: Project[], section: 'pinned' | 'projects' | 'archived'): string[] {
  return getOrderedProjectsInSection(projects, section).map(item => item.id);
}

describe('project catalogue ordering mutations', () => {
  it('appends newly created records after existing section order', () => {
    const projects = [
      project('zulu', 'Zulu'),
      project('alpha', 'Alpha'),
    ];

    const result = appendProjectToCollection(projects, project('new', 'A New Project'), LATER);
    expect(sectionIds(result, 'projects')).toEqual(['alpha', 'zulu', 'new']);
    expect(result.find(item => item.id === 'new')?.sortOrder).toBe(2);
  });

  it('uses deterministic name order until a section receives manual ordering', () => {
    const projects = [
      project('zulu', 'Zulu'),
      project('alpha', 'Alpha'),
    ];

    expect(sectionIds(projects, 'projects')).toEqual(['alpha', 'zulu']);

    const result = reorderProjectsInSection(projects, 'projects', ['zulu', 'alpha'], LATER);
    expect(result).toMatchObject({ valid: true, changed: true });
    expect(sectionIds(result.projects, 'projects')).toEqual(['zulu', 'alpha']);
    expect(result.projects.find(item => item.id === 'zulu')?.sortOrder).toBe(0);
    expect(result.projects.find(item => item.id === 'alpha')?.sortOrder).toBe(1);
  });

  it('appends pin and unpin transitions to their destination sections', () => {
    const projects = [
      project('pinned', 'Pinned', { isPinned: true, sortOrder: 0 }),
      project('first', 'First', { sortOrder: 0 }),
      project('second', 'Second', { sortOrder: 1 }),
    ];

    const pinned = setProjectPinnedInCollection(projects, 'first', true, LATER);
    expect(pinned).toMatchObject({ valid: true, changed: true });
    expect(sectionIds(pinned.projects, 'pinned')).toEqual(['pinned', 'first']);
    expect(sectionIds(pinned.projects, 'projects')).toEqual(['second']);

    const unpinned = setProjectPinnedInCollection(pinned.projects, 'pinned', false, LATER);
    expect(sectionIds(unpinned.projects, 'pinned')).toEqual(['first']);
    expect(sectionIds(unpinned.projects, 'projects')).toEqual(['second', 'pinned']);
  });

  it('archives reversibly, clears pinning, and preserves project reference data', () => {
    const projects = [
      project('reference', 'Reference', {
        status: 'blocked',
        isPinned: true,
        sortOrder: 0,
        links: [{
          id: 'docs',
          kind: 'documentation',
          label: 'Documentation',
          url: 'https://example.com/docs',
        }],
        runRecipes: [{
          id: 'dev',
          label: 'Development',
          displayCommand: 'npm run dev',
          executable: 'npm',
          args: ['run', 'dev'],
        }],
      }),
      project('old', 'Old', { status: 'archived', sortOrder: 0 }),
    ];

    const archived = setProjectArchivedInCollection(projects, 'reference', true, LATER);
    expect(archived.projects.find(item => item.id === 'reference')).toMatchObject({
      status: 'archived',
      statusBeforeArchive: 'blocked',
      isPinned: false,
      sortOrder: 1,
      links: projects[0].links,
      runRecipes: projects[0].runRecipes,
    });
    expect(sectionIds(archived.projects, 'archived')).toEqual(['old', 'reference']);

    const restored = setProjectArchivedInCollection(archived.projects, 'reference', false, LATER);
    const restoredProject = restored.projects.find(item => item.id === 'reference');
    expect(restoredProject).toMatchObject({
      status: 'blocked',
      isPinned: false,
      sortOrder: 0,
      links: projects[0].links,
      runRecipes: projects[0].runRecipes,
    });
    expect(restoredProject).not.toHaveProperty('statusBeforeArchive');
    expect(sectionIds(restored.projects, 'projects')).toEqual(['reference']);
  });

  it('defaults legacy archived records to active when unarchived', () => {
    const projects = [project('legacy', 'Legacy', { status: 'archived' })];

    const result = setProjectArchivedInCollection(projects, 'legacy', false, LATER);
    expect(result.projects[0]).toMatchObject({
      status: 'active',
      isPinned: false,
      sortOrder: 0,
    });
  });

  it('rejects duplicate, missing, stale, and cross-section reorder ids', () => {
    const projects = [
      project('one', 'One', { sortOrder: 0 }),
      project('two', 'Two', { sortOrder: 1 }),
      project('pinned', 'Pinned', { isPinned: true, sortOrder: 0 }),
    ];
    const attempts = [
      ['one', 'one'],
      ['one'],
      ['one', 'stale'],
      ['one', 'pinned'],
    ];

    for (const orderedIds of attempts) {
      const result = reorderProjectsInSection(projects, 'projects', orderedIds, LATER);
      expect(result).toEqual({ projects, valid: false, changed: false });
    }
  });

  it('rejects pinning an archived project', () => {
    const projects = [project('archived', 'Archived', { status: 'archived' })];

    expect(setProjectPinnedInCollection(projects, 'archived', true, LATER))
      .toEqual({ projects, valid: false, changed: false });
  });
});
