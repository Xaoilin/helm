import { invoke } from '@tauri-apps/api/core';
import { isSupabaseReady, isAuthenticated, queueRemoteWrite, loadRemote } from './supabase';
import { logWarn } from '../services/logger';

const NAMESPACE = 'helm';

let tauriAvailable: boolean | null = null;

async function isTauri(): Promise<boolean> {
  if (tauriAvailable !== null) return tauriAvailable;
  try {
    await invoke('get_app_data_dir');
    tauriAvailable = true;
  } catch (e) {
    logWarn('Persistence', 'Tauri detection failed');
    tauriAvailable = false;
  }
  return tauriAvailable;
}

/**
 * Load data. When authenticated with Supabase, the database is the
 * source of truth. localStorage is just a fast cache.
 *
 * Priority:
 *   Authenticated: Supabase (primary) → localStorage (cache fallback)
 *   Not authenticated: Tauri → localStorage
 */
export async function loadStore<T>(key: string): Promise<T | null> {
  // When signed in, Supabase is the source of truth
  if (isSupabaseReady() && isAuthenticated()) {
    try {
      const remote = await loadRemote<T>(NAMESPACE, key);
      if (remote) {
        // Cache in localStorage for speed on next load
        localStorage.setItem(`helm:${key}`, JSON.stringify(remote.value));
        return remote.value;
      }
    } catch (e) { logWarn('Persistence', 'Supabase load failed, using local cache'); }

    // If Supabase fetch failed, use localStorage as fallback cache
    const raw = localStorage.getItem(`helm:${key}`);
    if (raw) {
      try { return JSON.parse(raw) as T; } catch (e) { logWarn('Persistence', 'Local cache JSON parse failed'); }
    }
    return null;
  }

  // Not authenticated — local-first mode

  // 1. Try Tauri file store
  try {
    if (await isTauri()) {
      const raw = await invoke<string>('read_store', { key });
      const parsed = JSON.parse(raw);
      return parsed as T;
    }
  } catch (e) { logWarn('Persistence', 'Tauri read failed'); }

  // 2. Try localStorage
  const raw = localStorage.getItem(`helm:${key}`);
  if (raw) {
    try { return JSON.parse(raw) as T; } catch (e) { logWarn('Persistence', 'localStorage JSON parse failed'); }
  }

  return null;
}

/**
 * Save data. Always writes to localStorage (fast cache).
 * When authenticated, also queues a write to Supabase (debounced).
 */
export async function saveStore<T>(key: string, value: T): Promise<void> {
  const json = JSON.stringify(value);

  // 1. Try Tauri
  try {
    if (await isTauri()) {
      await invoke('write_store', { key, value: json });
    }
  } catch (e) { logWarn('Persistence', 'Tauri write failed'); }

  // 2. Always write to localStorage (fast cache)
  localStorage.setItem(`helm:${key}`, json);

  // 3. Write to Supabase (debounced, background)
  if (isSupabaseReady() && isAuthenticated()) {
    queueRemoteWrite(NAMESPACE, key, value);
  }
}
