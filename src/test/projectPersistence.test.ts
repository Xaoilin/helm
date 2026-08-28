// @vitest-environment node
import { describe, expect, it } from 'vitest';
import type { Project } from '../types/domain';
import {
  normalizeProjectRecord,
  normalizeProjectRecords,
  serializeSharedProjects,
} from '../store/projectPersistence';

const NOW = '2026-07-29T12:00:00.000Z';

describe('project persistence normalization', () => {
  it('normalizes legacy records to stable, safe catalogue defaults', () => {
    const normalized = normalizeProjectRecord({
      id: 'legacy-project',
      name: '  Legacy Project  ',
      localPath: '/device/private-project',
      summary: '  Existing notes  ',
      status: 'unknown',
      tags: [' app ', 'app', '', 42],
      isPinned: 1,
      createdAt: 'not-a-date',
    }, 'Fallback', NOW);

    expect(normalized).toMatchObject({
      id: 'legacy-project',
      catalogKey: 'custom:legacy-project',
      name: 'Legacy Project',
      kind: 'other',
      links: [],
      setupSteps: [],
      runRecipes: [],
      preview: {
        icon: 'folder',
        accentColor: '#7c6cff',
        backgroundColor: '#171827',
      },
      summary: 'Existing notes',
      status: 'active',
      tags: ['app'],
      isPinned: false,
      createdAt: NOW,
      updatedAt: NOW,
    });
    expect(normalized).not.toHaveProperty('localPath');
    expect(normalized).not.toHaveProperty('availability');
  });

  it('keeps project ids and catalogue keys unique during normalization', () => {
    const normalized = normalizeProjectRecords([
      { id: 'first', catalogKey: 'fixture:shared', name: 'First' },
      { id: 'second', catalogKey: 'fixture:shared', name: 'Duplicate key' },
      { id: 'first', catalogKey: 'fixture:other', name: 'Duplicate id' },
    ], NOW);

    expect(normalized.map(project => project.name)).toEqual(['First']);
  });

  it('preserves valid catalogue ordering and reversible archive state', () => {
    const archived = normalizeProjectRecord({
      id: 'archived-project',
      name: 'Archived Project',
      status: 'archived',
      statusBeforeArchive: 'blocked',
      isPinned: true,
      sortOrder: 3,
    }, 'Fallback', NOW);

    expect(archived).toMatchObject({
      status: 'archived',
      statusBeforeArchive: 'blocked',
      isPinned: false,
      sortOrder: 3,
    });
    expect(serializeSharedProjects([archived])[0]).toMatchObject({
      status: 'archived',
      statusBeforeArchive: 'blocked',
      isPinned: false,
      sortOrder: 3,
    });

    const invalid = normalizeProjectRecord({
      id: 'invalid-order',
      name: 'Invalid Order',
      status: 'active',
      statusBeforeArchive: 'completed',
      sortOrder: -1,
    }, 'Fallback', NOW);
    expect(invalid).not.toHaveProperty('statusBeforeArchive');
    expect(invalid).not.toHaveProperty('sortOrder');
  });

  it('serializes shared project data without device paths, approvals, or unsafe recipe paths', () => {
    const project = {
      id: 'project-1',
      catalogKey: 'catalog:project-1',
      name: 'Reference App',
      kind: 'web_app',
      links: [{
        id: 'repo',
        kind: 'repository',
        label: 'Repository',
        url: 'https://example.com/reference-app',
      }],
      setupSteps: [{
        id: 'install',
        title: 'Install dependencies',
        description: 'Use the package manager.',
        displayCode: 'npm install',
      }],
      runRecipes: [{
        id: 'dev',
        label: 'Development',
        displayCommand: 'npm run dev',
        executable: 'npm',
        args: ['run', 'dev'],
        workingDirectory: '/device/private-project',
        environment: {
          NODE_ENV: 'development',
          API_KEY: 'must-not-sync',
        },
        localUrl: 'http://127.0.0.1:4173',
        prerequisites: ['Node.js'],
        mode: 'service',
      }],
      preview: {
        icon: 'app',
        accentColor: '#336699',
        backgroundColor: '#112233',
        coverImageUrl: 'https://example.com/cover.png',
      },
      verifiedAt: NOW,
      localPath: '/device/private-project',
      summary: 'A project.',
      status: 'active',
      tags: ['app'],
      isPinned: true,
      createdAt: NOW,
      updatedAt: NOW,
      projectRoot: '/device/private-project',
      approvedProfiles: [{ fingerprint: 'device-only' }],
      availability: 'available',
    } as Project & Record<string, unknown>;

    const serialized = serializeSharedProjects([project]);
    const json = JSON.stringify(serialized);

    expect(serialized[0]).not.toHaveProperty('localPath');
    expect(serialized[0]).not.toHaveProperty('projectRoot');
    expect(serialized[0]).not.toHaveProperty('approvedProfiles');
    expect(serialized[0]).not.toHaveProperty('availability');
    expect(serialized[0].runRecipes?.[0]).not.toHaveProperty('workingDirectory');
    expect(serialized[0].runRecipes?.[0].environment).toEqual({ NODE_ENV: 'development' });
    expect(serialized[0].preview?.coverImageUrl).toBe('https://example.com/cover.png');
    expect(json).not.toContain('/device/private-project');
    expect(json).not.toContain('must-not-sync');
    expect(json).not.toContain('device-only');
  });

});
