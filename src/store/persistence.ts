import { invoke } from '@tauri-apps/api/core';
import {
  flushWriteQueue,
  getSupabaseWriteQueueSnapshot,
  isAuthenticated,
  isSupabaseReady,
  loadRemote,
  queueRemoteWrite,
  subscribeSupabaseWriteQueueSnapshot,
  type SupabaseWriteQueueSnapshot,
} from './supabase';
import { logWarn } from '../services/logger';

const NAMESPACE = 'helm';
const META_PREFIX = `${NAMESPACE}:meta:`;

let tauriAvailable: boolean | null = null;
let remoteFlushHandlersRegistered = false;
let lastLocalWriteAt: string | null = null;
let lastLocalWriteKey: string | null = null;
let lastLocalWriteError: string | null = null;
const persistenceHealthSubscribers = new Set<(snapshot: PersistenceHealthSnapshot) => void>();

interface LocalCacheMeta {
  updatedAt: string | null;
  dirty: boolean;
}

interface LocalCacheSnapshot<T> {
  value: T | null;
  hasValue: boolean;
}

export interface PersistenceHealthSnapshot {
  lastLocalWriteAt: string | null;
  lastLocalWriteKey: string | null;
  lastLocalWriteError: string | null;
  dirtyKeys: string[];
  supabaseQueue: SupabaseWriteQueueSnapshot;
}

async function isTauri(): Promise<boolean> {
  if (tauriAvailable !== null) return tauriAvailable;
  try {
    await invoke('get_app_data_dir');
    tauriAvailable = true;
  } catch {
    logWarn('Persistence', 'Tauri detection failed');
    tauriAvailable = false;
  }
  return tauriAvailable;
}

function getDataKey(key: string): string {
  return `${NAMESPACE}:${key}`;
}

function getMetaKey(key: string): string {
  return `${META_PREFIX}${key}`;
}

function readLocalCache<T>(key: string): LocalCacheSnapshot<T> {
  const raw = localStorage.getItem(getDataKey(key));
  if (raw === null) {
    return { value: null, hasValue: false };
  }

  try {
    return {
      value: JSON.parse(raw) as T,
      hasValue: true,
    };
  } catch {
    logWarn('Persistence', 'Local cache JSON parse failed');
    return {
      value: null,
      hasValue: false,
    };
  }
}

function readLocalCacheMeta(key: string): LocalCacheMeta {
  const raw = localStorage.getItem(getMetaKey(key));
  if (!raw) {
    return {
      updatedAt: null,
      dirty: false,
    };
  }

  try {
    const parsed = JSON.parse(raw) as Partial<LocalCacheMeta>;
    return {
      updatedAt: typeof parsed.updatedAt === 'string' ? parsed.updatedAt : null,
      dirty: parsed.dirty === true,
    };
  } catch {
    logWarn('Persistence', 'Local cache metadata parse failed');
    return {
      updatedAt: null,
      dirty: false,
    };
  }
}

function writeLocalCacheMeta(key: string, meta: LocalCacheMeta): void {
  localStorage.setItem(getMetaKey(key), JSON.stringify(meta));
}

function writeLocalCacheValue<T>(key: string, value: T): void {
  localStorage.setItem(getDataKey(key), JSON.stringify(value));
}

function readDirtyKeys(): string[] {
  const dirtyKeys: string[] = [];

  try {
    for (let index = 0; index < localStorage.length; index += 1) {
      const storageKey = localStorage.key(index);
      if (!storageKey?.startsWith(META_PREFIX)) continue;
      const key = storageKey.slice(META_PREFIX.length);
      if (readLocalCacheMeta(key).dirty) {
        dirtyKeys.push(key);
      }
    }
  } catch {
    logWarn('Persistence', 'Local cache metadata scan failed');
  }

  return dirtyKeys.sort();
}

function buildPersistenceHealthSnapshot(): PersistenceHealthSnapshot {
  return {
    lastLocalWriteAt,
    lastLocalWriteKey,
    lastLocalWriteError,
    dirtyKeys: readDirtyKeys(),
    supabaseQueue: getSupabaseWriteQueueSnapshot(),
  };
}

function notifyPersistenceHealthSubscribers(): void {
  const snapshot = buildPersistenceHealthSnapshot();
  persistenceHealthSubscribers.forEach(listener => listener(snapshot));
}

function rememberLocalWrite(key: string, error: string | null): void {
  lastLocalWriteKey = key;
  lastLocalWriteAt = error ? lastLocalWriteAt : new Date().toISOString();
  lastLocalWriteError = error;
  notifyPersistenceHealthSubscribers();
}

export function getPersistenceHealthSnapshot(): PersistenceHealthSnapshot {
  return buildPersistenceHealthSnapshot();
}

export function subscribePersistenceHealth(
  listener: (snapshot: PersistenceHealthSnapshot) => void,
): () => void {
  persistenceHealthSubscribers.add(listener);
  listener(buildPersistenceHealthSnapshot());

  const unsubscribeQueue = subscribeSupabaseWriteQueueSnapshot(() => {
    notifyPersistenceHealthSubscribers();
  });

  return () => {
    persistenceHealthSubscribers.delete(listener);
    unsubscribeQueue();
  };
}

function ensureRemoteFlushHandlers(): void {
  if (remoteFlushHandlersRegistered || typeof window === 'undefined') return;

  const flushQueuedWrites = () => {
    void flushWriteQueue();
  };

  window.addEventListener('beforeunload', flushQueuedWrites);
  window.addEventListener('pagehide', flushQueuedWrites);

  if (typeof document !== 'undefined') {
    document.addEventListener('visibilitychange', () => {
      if (document.visibilityState === 'hidden') {
        void flushWriteQueue();
      }
    });
  }

  remoteFlushHandlersRegistered = true;
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
    const localCache = readLocalCache<T>(key);
    const localMeta = readLocalCacheMeta(key);

    try {
      const remote = await loadRemote<T>(NAMESPACE, key);
      if (remote) {
        const localIsNewer = localMeta.dirty
          && localMeta.updatedAt
          && new Date(localMeta.updatedAt).getTime() > new Date(remote.updatedAt).getTime()
          && localCache.hasValue;

        if (localIsNewer) {
          return localCache.value;
        }

        writeLocalCacheValue(key, remote.value);
        writeLocalCacheMeta(key, {
          updatedAt: remote.updatedAt,
          dirty: false,
        });
        notifyPersistenceHealthSubscribers();
        return remote.value;
      }
    } catch { logWarn('Persistence', 'Supabase load failed, using local cache'); }

    if (localCache.hasValue) {
      return localCache.value;
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
  } catch { logWarn('Persistence', 'Tauri read failed'); }

  // 2. Try localStorage
  const localCache = readLocalCache<T>(key);
  if (localCache.hasValue) {
    return localCache.value;
  }

  return null;
}

/**
 * Save data. Always writes to localStorage (fast cache).
 * When authenticated, also queues a write to Supabase (debounced).
 */
export async function saveStore<T>(key: string, value: T): Promise<void> {
  const json = JSON.stringify(value);
  const updatedAt = new Date().toISOString();
  const authenticated = isSupabaseReady() && isAuthenticated();

  // 1. Try Tauri
  try {
    if (await isTauri()) {
      await invoke('write_store', { key, value: json });
    }
  } catch { logWarn('Persistence', 'Tauri write failed'); }

  // 2. Always write to localStorage (fast cache)
  try {
    localStorage.setItem(getDataKey(key), json);
    writeLocalCacheMeta(key, {
      updatedAt,
      dirty: authenticated,
    });
    rememberLocalWrite(key, null);
  } catch (error) {
    const message = error instanceof Error ? error.message : String(error);
    rememberLocalWrite(key, message);
    logWarn('Persistence', `Local cache write failed: ${message}`);
    throw error;
  }

  // 3. Write to Supabase (debounced, background)
  if (authenticated) {
    ensureRemoteFlushHandlers();
    queueRemoteWrite(NAMESPACE, key, value, {
      updatedAt,
      onSettled: ({ success, updatedAt: settledAt }) => {
        if (!success) {
          notifyPersistenceHealthSubscribers();
          return;
        }
        const meta = readLocalCacheMeta(key);
        if (meta.updatedAt === settledAt) {
          writeLocalCacheMeta(key, {
            updatedAt: settledAt,
            dirty: false,
          });
        }
        notifyPersistenceHealthSubscribers();
      },
    });
  }
}
