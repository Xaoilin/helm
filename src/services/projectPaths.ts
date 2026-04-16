import { invoke } from '@tauri-apps/api/core';
import { logError } from './logger';

let desktopPathSupport: boolean | null = null;

async function isDesktopPathSupportAvailable(): Promise<boolean> {
  if (desktopPathSupport !== null) return desktopPathSupport;

  try {
    await invoke('get_app_data_dir');
    desktopPathSupport = true;
  } catch {
    desktopPathSupport = false;
  }

  return desktopPathSupport;
}

export async function canUseDesktopProjectPaths(): Promise<boolean> {
  return isDesktopPathSupportAvailable();
}

export async function pickProjectDirectory(): Promise<string | null> {
  if (!(await isDesktopPathSupportAvailable())) {
    return null;
  }

  try {
    const picked = await invoke<string | null>('pick_directory');
    return typeof picked === 'string' && picked.trim() ? picked.trim() : null;
  } catch (error) {
    logError('ProjectPaths', error);
    throw error instanceof Error ? error : new Error('Unable to open the folder picker.');
  }
}

export async function openProjectPath(path: string): Promise<void> {
  if (!(await isDesktopPathSupportAvailable())) {
    throw new Error('Opening local project paths is only available in the desktop app.');
  }

  try {
    await invoke('open_path', { path });
  } catch (error) {
    logError('ProjectPaths', error);
    throw error instanceof Error ? error : new Error(`Unable to open "${path}".`);
  }
}
