import { invoke } from '@tauri-apps/api/core';
import { isSupabaseReady, isAuthenticated, queueRemoteWrite, loadRemote } from './supabase';

const NAMESPACE = 'helm';

let tauriAvailable: boolean | null = null;

async function isTauri(): Promise<boolean> {
  if (tauriAvailable !== null) return tauriAvailable;
  try {
    await invoke('get_app_data_dir');
    tauriAvailable = true;
  } catch {
    tauriAvailable = false;
  }
  return tauriAvailable;
}

// Track local write timestamps (kept for sync preview backward compat)
const localTimestamps = new Map<string, string>();

export function getLocalTimestamp(key: string): string {
  return localTimestamps.get(key) || new Date(0).toISOString();
}

export function getAllLocalTimestamps(): Map<string, { value: unknown; updatedAt: string }> {
  const result = new Map<string, { value: unknown; updatedAt: string }>();
  for (const [key, updatedAt] of localTimestamps) {
    const raw = localStorage.getItem(`helm:${key}`);
    if (raw) {
      try {
        result.set(key, { value: JSON.parse(raw), updatedAt });
      } catch { /* skip invalid */ }
    }
  }
  return result;
}

/**
 * Load data. When authenticated with Supabase, the database is the
 * source of truth. localStorage is just a fast cache.
 *
 * Priority:
 *   Authenticated: Supabase (primary) → localStorage (cache fallback)
 *   Not authenticated: Tauri → localStorage → Supabase (if empty)
 */
export async function loadStore<T>(key: string): Promise<T | null> {
  // When signed in, Supabase is the source of truth
  if (isSupabaseReady() && isAuthenticated()) {
    try {
      const remote = await loadRemote<T>(NAMESPACE, key);
      if (remote) {
        // Cache in localStorage for speed on next load
        localStorage.setItem(`helm:${key}`, JSON.stringify(remote.value));
        localTimestamps.set(key, remote.updatedAt);
        return remote.value;
      }
    } catch { /* fall through to local cache */ }

    // If Supabase fetch failed, use localStorage as fallback cache
    const raw = localStorage.getItem(`helm:${key}`);
    if (raw) {
      try { return JSON.parse(raw) as T; } catch { /* fall through */ }
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
  } catch { /* fall through */ }

  // 2. Try localStorage
  const raw = localStorage.getItem(`helm:${key}`);
  if (raw) {
    try { return JSON.parse(raw) as T; } catch { /* fall through */ }
  }

  return null;
}

/**
 * Save data. Always writes to localStorage (fast cache).
 * When authenticated, also writes to Supabase (source of truth).
 */
export async function saveStore<T>(key: string, value: T): Promise<void> {
  const json = JSON.stringify(value);
  const now = new Date().toISOString();
  localTimestamps.set(key, now);

  // 1. Try Tauri
  try {
    if (await isTauri()) {
      await invoke('write_store', { key, value: json });
    }
  } catch { /* fall through */ }

  // 2. Always write to localStorage (fast cache)
  localStorage.setItem(`helm:${key}`, json);

  // 3. Write to Supabase (debounced, background) — this is the real save
  if (isSupabaseReady() && isAuthenticated()) {
    queueRemoteWrite(NAMESPACE, key, value);
  }
}
