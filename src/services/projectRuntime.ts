import { Channel, invoke } from '@tauri-apps/api/core';
import type { ProjectRunRecipe } from '../types/domain';
import { logError } from './logger';

export interface ApprovedProjectProfile {
  id: string;
  projectId: string;
  recipeId: string;
  label: string;
  sourceFingerprint: string;
  projectRoot: string;
  executable: string;
  args: string[];
  environment: Array<{ name: string; value: string }>;
  workingDirectory: string;
  approvedAt: string;
}

export interface ProjectRuntimeLog {
  stream: 'stdout' | 'stderr' | 'system';
  line: string;
  timestamp: string;
}

export type ProjectRuntimeStatus = 'running' | 'stopped' | 'exited' | 'failed';

export interface ProjectSessionSnapshot {
  sessionId: string;
  profileId: string;
  projectId: string;
  recipeId: string;
  status: ProjectRuntimeStatus;
  pid?: number;
  startedAt: string;
  endedAt?: string;
  exitCode?: number;
  logs: ProjectRuntimeLog[];
  revision: number;
}

export type ProjectRuntimeEvent =
  | { event: 'snapshot'; data: { session: ProjectSessionSnapshot } }
  | { event: 'log'; data: { profileId: string; log: ProjectRuntimeLog } };

let desktopRuntimeAvailable: boolean | null = null;

function sortedEnvironment(recipe: ProjectRunRecipe): Array<{ name: string; value: string }> {
  return Object.entries(recipe.environment || {})
    .map(([name, value]) => ({ name, value }))
    .sort((left, right) => left.name.localeCompare(right.name));
}

function projectProfileInput(
  projectId: string,
  projectRoot: string,
  recipe: ProjectRunRecipe,
) {
  return {
    projectId,
    recipeId: recipe.id,
    label: recipe.label,
    projectRoot,
    executable: recipe.executable,
    args: recipe.args,
    environment: sortedEnvironment(recipe),
    workingDirectory: recipe.workingDirectory,
  };
}

export async function createProjectRunFingerprint(
  projectId: string,
  projectRoot: string,
  recipe: ProjectRunRecipe,
): Promise<string> {
  if (!(await canUseProjectRuntime())) {
    throw new Error('Project command fingerprints are only available in the HELM desktop app.');
  }
  return invoke<string>('fingerprint_project_profile', {
    input: projectProfileInput(projectId, projectRoot, recipe),
  });
}

export async function canUseProjectRuntime(): Promise<boolean> {
  if (desktopRuntimeAvailable !== null) return desktopRuntimeAvailable;

  try {
    await invoke('get_app_data_dir');
    desktopRuntimeAvailable = true;
  } catch {
    desktopRuntimeAvailable = false;
  }
  return desktopRuntimeAvailable;
}

export async function listApprovedProjectProfiles(): Promise<ApprovedProjectProfile[]> {
  if (!(await canUseProjectRuntime())) return [];
  try {
    return await invoke<ApprovedProjectProfile[]>('list_project_profiles');
  } catch (error) {
    logError('ProjectRuntime', error);
    throw error instanceof Error ? error : new Error('Unable to read project run approvals.');
  }
}

export async function approveProjectProfile(
  projectId: string,
  projectRoot: string,
  recipe: ProjectRunRecipe,
): Promise<ApprovedProjectProfile> {
  if (!(await canUseProjectRuntime())) {
    throw new Error('Project commands can only run in the HELM desktop app.');
  }

  try {
    return await invoke<ApprovedProjectProfile>('approve_project_profile', {
      input: projectProfileInput(projectId, projectRoot, recipe),
    });
  } catch (error) {
    logError('ProjectRuntime', error);
    throw error instanceof Error ? error : new Error('Unable to approve this project command.');
  }
}

export async function revokeProjectProfile(profileId: string): Promise<void> {
  if (!(await canUseProjectRuntime())) return;
  try {
    await invoke('revoke_project_profile', { profileId });
  } catch (error) {
    logError('ProjectRuntime', error);
    throw error instanceof Error ? error : new Error('Unable to revoke this project command.');
  }
}

export async function listProjectSessions(): Promise<ProjectSessionSnapshot[]> {
  if (!(await canUseProjectRuntime())) return [];
  try {
    return await invoke<ProjectSessionSnapshot[]>('list_project_sessions');
  } catch (error) {
    logError('ProjectRuntime', error);
    throw error instanceof Error ? error : new Error('Unable to read project command status.');
  }
}

export async function startProjectProfile(
  profileId: string,
  expectedFingerprint: string,
  onEvent: (event: ProjectRuntimeEvent) => void,
): Promise<ProjectSessionSnapshot> {
  if (!(await canUseProjectRuntime())) {
    throw new Error('Project commands can only run in the HELM desktop app.');
  }

  const channel = new Channel<ProjectRuntimeEvent>();
  channel.onmessage = onEvent;
  try {
    return await invoke<ProjectSessionSnapshot>('start_project_profile', {
      profileId,
      expectedFingerprint,
      onEvent: channel,
    });
  } catch (error) {
    logError('ProjectRuntime', error);
    throw error instanceof Error ? error : new Error('Unable to start this project command.');
  }
}

export async function stopProjectSession(profileId: string): Promise<ProjectSessionSnapshot> {
  if (!(await canUseProjectRuntime())) {
    throw new Error('Project commands can only run in the HELM desktop app.');
  }
  try {
    return await invoke<ProjectSessionSnapshot>('stop_project_session', { profileId });
  } catch (error) {
    logError('ProjectRuntime', error);
    throw error instanceof Error ? error : new Error('Unable to stop this project command.');
  }
}

export async function subscribeProjectSession(
  profileId: string,
  onEvent: (event: ProjectRuntimeEvent) => void,
): Promise<void> {
  if (!(await canUseProjectRuntime())) return;
  const channel = new Channel<ProjectRuntimeEvent>();
  channel.onmessage = onEvent;
  try {
    await invoke('subscribe_project_session', { profileId, onEvent: channel });
  } catch (error) {
    logError('ProjectRuntime', error);
    throw error instanceof Error ? error : new Error('Unable to follow this project command.');
  }
}
