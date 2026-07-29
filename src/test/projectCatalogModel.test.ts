import { describe, expect, it } from 'vitest';
import { getProjectAvailability } from '../components/projects/projectCatalogModel';
import type { Project } from '../types/domain';

const baseProject: Project = {
  id: 'project',
  catalogKey: 'catalog:project',
  name: 'Project',
  summary: '',
  status: 'active',
  tags: [],
  isPinned: false,
  createdAt: '2026-07-29T00:00:00.000Z',
  updatedAt: '2026-07-29T00:00:00.000Z',
};

describe('project catalogue availability', () => {
  it('keeps a portable run recipe visible as local-only before this device is linked', () => {
    expect(getProjectAvailability({
      ...baseProject,
      runRecipes: [{
        id: 'dev',
        label: 'Development server',
        displayCommand: 'npm run dev',
        executable: 'npm',
        args: ['run', 'dev'],
      }],
    })).toEqual({ key: 'local', label: 'Local only' });
  });

  it('labels a deployed project with a local recipe as live and local', () => {
    expect(getProjectAvailability({
      ...baseProject,
      links: [{
        id: 'live',
        kind: 'deployment',
        label: 'Live site',
        url: 'https://example.com/',
      }],
      runRecipes: [{
        id: 'dev',
        label: 'Development server',
        displayCommand: 'npm run dev',
        executable: 'npm',
        args: ['run', 'dev'],
      }],
    })).toEqual({ key: 'hybrid', label: 'Live + local' });
  });

  it('keeps documentation and hardware records reference-only', () => {
    expect(getProjectAvailability({
      ...baseProject,
      kind: 'hardware',
      links: [{
        id: 'docs',
        kind: 'documentation',
        label: 'Build notes',
        url: 'https://example.com/docs',
      }],
    })).toEqual({ key: 'reference', label: 'Reference' });
  });
});
