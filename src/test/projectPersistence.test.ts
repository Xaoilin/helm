import { describe, expect, it } from 'vitest';
import type { Project } from '../types/domain';
import {
  migrateLegacyProjectDeviceBindings,
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

  it('migrates a legacy localPath only after successful canonicalization', async () => {
    const legacyRecords = [{
      id: 'legacy-project',
      name: 'Legacy Project',
      localPath: '/device/legacy-project',
      summary: '',
      status: 'active',
      tags: [],
      isPinned: false,
      createdAt: NOW,
      updatedAt: NOW,
    }];
    const projects = normalizeProjectRecords(legacyRecords, NOW);

    const migration = await migrateLegacyProjectDeviceBindings(
      legacyRecords,
      projects,
      [],
      [],
      async () => '/canonical/legacy-project',
      NOW,
    );

    expect(migration.bindings).toEqual([{
      catalogKey: 'custom:legacy-project',
      projectRoot: '/canonical/legacy-project',
      source: 'legacy',
      adoptedAt: NOW,
      updatedAt: NOW,
      runProfiles: [],
    }]);
    expect(migration.pendingPaths).toEqual([]);
    expect(projects[0]).not.toHaveProperty('localPath');
    expect(JSON.stringify(serializeSharedProjects(projects))).not.toContain('/device/legacy-project');
  });

  it('does not adopt a legacy localPath when canonicalization fails', async () => {
    const legacyRecords = [{
      id: 'legacy-project',
      name: 'Legacy Project',
      localPath: '/device/missing-project',
      updatedAt: NOW,
    }];
    const projects = normalizeProjectRecords(legacyRecords, NOW);

    const migration = await migrateLegacyProjectDeviceBindings(
      legacyRecords,
      projects,
      [],
      [],
      async () => null,
      NOW,
    );

    expect(migration.bindings).toEqual([]);
    expect(migration.pendingPaths).toEqual([{
      catalogKey: 'custom:legacy-project',
      projectRoot: '/device/missing-project',
      capturedAt: NOW,
    }]);
  });

  it('promotes a pending legacy path after it becomes available', async () => {
    const projects = normalizeProjectRecords([{
      id: 'legacy-project',
      catalogKey: 'custom:legacy-project',
      name: 'Legacy Project',
    }], NOW);

    const migration = await migrateLegacyProjectDeviceBindings(
      projects,
      projects,
      [],
      [{
        catalogKey: 'custom:legacy-project',
        projectRoot: '/device/remounted-project',
        capturedAt: NOW,
      }],
      async () => '/canonical/remounted-project',
      NOW,
    );

    expect(migration.bindings[0]).toMatchObject({
      catalogKey: 'custom:legacy-project',
      projectRoot: '/canonical/remounted-project',
      source: 'legacy',
    });
    expect(migration.pendingPaths).toEqual([]);
  });
});
