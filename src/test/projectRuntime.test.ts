import { invoke } from '@tauri-apps/api/core';
import { beforeEach, describe, expect, it, vi } from 'vitest';
import {
  createProjectRunFingerprint,
  revokeProjectProfilesForProject,
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

  it('stops running sessions and revokes every native profile when a project is removed', async () => {
    vi.mocked(invoke).mockImplementation(async command => {
      if (command === 'get_app_data_dir') return '/tmp/helm';
      if (command === 'list_project_profiles') {
        return [
          {
            id: 'profile-running',
            projectId: 'project',
            recipeId: 'dev',
          },
          {
            id: 'profile-idle',
            projectId: 'project',
            recipeId: 'build',
          },
          {
            id: 'other-profile',
            projectId: 'other-project',
            recipeId: 'dev',
          },
        ];
      }
      if (command === 'list_project_sessions') {
        return [
          {
            ...snapshot,
            profileId: 'profile-running',
            status: 'running',
          },
          {
            ...snapshot,
            profileId: 'profile-idle',
            status: 'exited',
          },
        ];
      }
      if (command === 'stop_project_session' || command === 'revoke_project_profile') {
        return undefined;
      }
      throw new Error(`Unexpected command: ${command}`);
    });

    await revokeProjectProfilesForProject('project');

    expect(invoke).toHaveBeenCalledWith('stop_project_session', { profileId: 'profile-running' });
    expect(invoke).not.toHaveBeenCalledWith('stop_project_session', { profileId: 'profile-idle' });
    expect(invoke).toHaveBeenCalledWith('revoke_project_profile', { profileId: 'profile-running' });
    expect(invoke).toHaveBeenCalledWith('revoke_project_profile', { profileId: 'profile-idle' });
    expect(invoke).not.toHaveBeenCalledWith('revoke_project_profile', { profileId: 'other-profile' });
  });
});
