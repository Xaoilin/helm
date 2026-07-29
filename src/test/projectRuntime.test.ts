import { invoke } from '@tauri-apps/api/core';
import { beforeEach, describe, expect, it, vi } from 'vitest';
import {
  createProjectRunFingerprint,
  startProjectProfile,
  subscribeProjectSession,
  type ProjectRuntimeEvent,
  type ProjectSessionSnapshot,
} from '../services/projectRuntime';
import type { ProjectRunRecipe } from '../types/domain';

const recipe: ProjectRunRecipe = {
  id: 'dev',
  label: 'Development server',
  displayCommand: 'DASHBOARD_MODE=1 npm run dev',
  executable: 'npm',
  args: ['run', 'dev'],
  environment: { DASHBOARD_MODE: '1' },
  workingDirectory: 'web',
  mode: 'service',
};

const snapshot: ProjectSessionSnapshot = {
  sessionId: 'session',
  profileId: 'profile',
  projectId: 'project',
  recipeId: 'dev',
  status: 'running',
  pid: 123,
  startedAt: '2026-07-29T12:00:00.000Z',
  logs: [],
  revision: 1,
};

describe('project runtime bridge', () => {
  beforeEach(() => {
    vi.mocked(invoke).mockReset();
    vi.mocked(invoke).mockImplementation(async command => {
      if (command === 'get_app_data_dir') return '/tmp/helm';
      throw new Error(`Unexpected command: ${command}`);
    });
  });

  it('asks Rust to fingerprint the normalized structured profile', async () => {
    vi.mocked(invoke).mockImplementation(async (command, args) => {
      if (command === 'get_app_data_dir') return '/tmp/helm';
      if (command === 'fingerprint_project_profile') {
        expect(args).toEqual({
          input: {
            projectId: 'project',
            recipeId: 'dev',
            label: 'Development server',
            projectRoot: '/projects/example',
            executable: 'npm',
            args: ['run', 'dev'],
            environment: [{ name: 'DASHBOARD_MODE', value: '1' }],
            workingDirectory: 'web',
          },
        });
        return 'a'.repeat(64);
      }
      throw new Error(`Unexpected command: ${command}`);
    });

    await expect(createProjectRunFingerprint('project', '/projects/example', recipe))
      .resolves.toBe('a'.repeat(64));
  });

  it('streams events through the start channel', async () => {
    const event: ProjectRuntimeEvent = { event: 'snapshot', data: { session: snapshot } };
    const onEvent = vi.fn();
    vi.mocked(invoke).mockImplementation(async (command, args) => {
      if (command === 'get_app_data_dir') return '/tmp/helm';
      if (command === 'start_project_profile') {
        const channel = (args as { onEvent: { onmessage?: (value: ProjectRuntimeEvent) => void } }).onEvent;
        channel.onmessage?.(event);
        return snapshot;
      }
      throw new Error(`Unexpected command: ${command}`);
    });

    await expect(startProjectProfile('profile', 'a'.repeat(64), onEvent)).resolves.toEqual(snapshot);
    expect(onEvent).toHaveBeenCalledWith(event);
  });

  it('reattaches a fresh channel to a running session after remount', async () => {
    const event: ProjectRuntimeEvent = { event: 'snapshot', data: { session: snapshot } };
    const onEvent = vi.fn();
    vi.mocked(invoke).mockImplementation(async (command, args) => {
      if (command === 'get_app_data_dir') return '/tmp/helm';
      if (command === 'subscribe_project_session') {
        expect(args).toMatchObject({ profileId: 'profile' });
        const channel = (args as { onEvent: { onmessage?: (value: ProjectRuntimeEvent) => void } }).onEvent;
        channel.onmessage?.(event);
        return undefined;
      }
      throw new Error(`Unexpected command: ${command}`);
    });

    await subscribeProjectSession('profile', onEvent);
    expect(onEvent).toHaveBeenCalledWith(event);
  });
});
