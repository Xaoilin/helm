import { invoke } from '@tauri-apps/api/core';
import {
  flushWriteQueue,
  getSupabaseRealtimeSnapshot,
  getSupabaseWriteQueueSnapshot,
  isAuthenticated,
  isSupabaseReady,
  loadRemote,
  saveRemote,
  queueRemoteWrite,
  subscribeRemoteStore,
  subscribeSupabaseRealtimeSnapshot,
  subscribeSupabaseWriteQueueSnapshot,
  type RemoteStoreChange,
  type SupabaseRealtimeSnapshot,
  type SupabaseWriteQueueSnapshot,
} from './supabase';
import { logWarn } from '../services/logger';
import { getSharedStoreKey, SHARED_STORE_KEYS } from './storeKeys';

const NAMESPACE = 'helm';
const META_PREFIX = `${NAMESPACE}:meta:`;

let tauriAvailable: boolean | null = null;
let remoteFlushHandlersRegistered = false;
let remoteStoreUnsubscribe: (() => void) | null = null;
let lastLocalWriteAt: string | null = null;
let lastLocalWriteKey: string | null = null;
let lastLocalWriteError: string | null = null;
let lastRemoteReadAt: string | null = null;
let lastRemoteReadKey: string | null = null;
let lastRemoteReadError: string | null = null;
let lastRemoteWriteAt: string | null = null;
let lastRemoteWriteKey: string | null = null;
let lastRemoteWriteError: string | null = null;
let lastSuppressedInitialWriteKey: string | null = null;
let lastSuppressedInitialWriteAt: string | null = null;
const persistenceHealthSubscribers = new Set<(snapshot: PersistenceHealthSnapshot) => void>();
const storeChangeSubscribers = new Set<(change: RemoteStoreChange) => void>();
const lastKnownRemoteJson = new Map<string, string>();
const suppressNextAuthenticatedSave = new Set<string>();
const remoteReadFailedKeys = new Map<string, string>();

interface LocalCacheMeta {
  updatedAt: string | null;
  dirty: boolean;
}

interface LocalCacheSnapshot<T> {
  value: T | null;
  hasValue: boolean;
}

export interface PersistenceHealthSnapshot {
  mode: 'database' | 'local';
  lastLocalWriteAt: string | null;
  lastLocalWriteKey: string | null;
  lastLocalWriteError: string | null;
  lastRemoteReadAt: string | null;
  lastRemoteReadKey: string | null;
  lastRemoteReadError: string | null;
  lastRemoteWriteAt: string | null;
  lastRemoteWriteKey: string | null;
  lastRemoteWriteError: string | null;
  remoteReadFailedKeys: string[];
  lastSuppressedInitialWriteKey: string | null;
  lastSuppressedInitialWriteAt: string | null;
  dirtyKeys: string[];
  supabaseQueue: SupabaseWriteQueueSnapshot;
  supabaseRealtime: SupabaseRealtimeSnapshot;
  localImportCandidateCount: number;
}

export interface LocalImportCandidate {
  key: string;
  label: string;
  description: string;
  localStorage: boolean;
  tauri: boolean;
  remoteExists: boolean | null;
  sizeBytes: number;
}

export interface LocalImportResult {
  key: string;
  imported: boolean;
  cleared: boolean;
  reason: 'imported' | 'remote_exists' | 'no_local_data' | 'not_authenticated' | 'remote_write_failed';
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

function removeLocalCacheValue(key: string): void {
  localStorage.removeItem(getDataKey(key));
  localStorage.removeItem(getMetaKey(key));
}

async function readTauriRaw(key: string): Promise<string | null> {
  try {
    if (!(await isTauri())) return null;
    return await invoke<string>('read_store', { key });
  } catch {
    return null;
  }
}

function parseImportRaw(raw: string | null): { value: unknown; hasValue: boolean; sizeBytes: number } {
  if (raw === null) {
    return { value: null, hasValue: false, sizeBytes: 0 };
  }

  try {
    const value = JSON.parse(raw);
    return {
      value,
      hasValue: value !== null,
      sizeBytes: new Blob([raw]).size,
    };
  } catch {
    logWarn('Persistence', 'Local import JSON parse failed');
    return { value: null, hasValue: false, sizeBytes: raw.length };
  }
}

async function readLocalImportValue(key: string): Promise<{ value: unknown; hasValue: boolean; source: 'tauri' | 'localStorage' | null; sizeBytes: number }> {
  const tauri = parseImportRaw(await readTauriRaw(key));
  if (tauri.hasValue) {
    return { ...tauri, source: 'tauri' };
  }

  const rawLocal = localStorage.getItem(getDataKey(key));
  const local = parseImportRaw(rawLocal);
  if (local.hasValue) {
    return { ...local, source: 'localStorage' };
  }

  return { value: null, hasValue: false, source: null, sizeBytes: 0 };
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

function countLocalImportCandidates(): number {
  try {
    return SHARED_STORE_KEYS.filter(item => localStorage.getItem(getDataKey(item.key)) !== null).length;
  } catch {
    return 0;
  }
}

function buildPersistenceHealthSnapshot(): PersistenceHealthSnapshot {
  return {
    mode: isSupabaseReady() && isAuthenticated() ? 'database' : 'local',
    lastLocalWriteAt,
    lastLocalWriteKey,
    lastLocalWriteError,
    lastRemoteReadAt,
    lastRemoteReadKey,
    lastRemoteReadError,
    lastRemoteWriteAt,
    lastRemoteWriteKey,
    lastRemoteWriteError,
    remoteReadFailedKeys: Array.from(remoteReadFailedKeys.keys()).sort(),
    lastSuppressedInitialWriteKey,
    lastSuppressedInitialWriteAt,
    dirtyKeys: readDirtyKeys(),
    supabaseQueue: getSupabaseWriteQueueSnapshot(),
    supabaseRealtime: getSupabaseRealtimeSnapshot(),
    localImportCandidateCount: countLocalImportCandidates(),
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

function rememberRemoteRead(key: string, error: string | null): void {
  lastRemoteReadKey = key;
  lastRemoteReadAt = new Date().toISOString();
  lastRemoteReadError = error;
  if (error) {
    remoteReadFailedKeys.set(key, error);
  } else {
    remoteReadFailedKeys.delete(key);
  }
  notifyPersistenceHealthSubscribers();
}

function rememberRemoteWrite(key: string, error: string | null): void {
  lastRemoteWriteKey = key;
  lastRemoteWriteAt = new Date().toISOString();
  lastRemoteWriteError = error;
  notifyPersistenceHealthSubscribers();
}

function rememberSuppressedInitialWrite(key: string): void {
  lastSuppressedInitialWriteKey = key;
  lastSuppressedInitialWriteAt = new Date().toISOString();
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
  const unsubscribeRealtime = subscribeSupabaseRealtimeSnapshot(() => {
    notifyPersistenceHealthSubscribers();
  });

  return () => {
    persistenceHealthSubscribers.delete(listener);
    unsubscribeQueue();
    unsubscribeRealtime();
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

function ensureRemoteStoreSubscription(): void {
  if (remoteStoreUnsubscribe || !isSupabaseReady() || !isAuthenticated()) return;

  remoteStoreUnsubscribe = subscribeRemoteStore(NAMESPACE, change => {
    storeChangeSubscribers.forEach(listener => listener(change));
    notifyPersistenceHealthSubscribers();
  });
}

export function subscribeStoreChanges(listener: (change: RemoteStoreChange) => void): () => void {
  storeChangeSubscribers.add(listener);
  ensureRemoteStoreSubscription();

  return () => {
    storeChangeSubscribers.delete(listener);
    if (storeChangeSubscribers.size === 0 && remoteStoreUnsubscribe) {
      remoteStoreUnsubscribe();
      remoteStoreUnsubscribe = null;
    }
  };
}

export function subscribeStoreKey(key: string, listener: (change: RemoteStoreChange) => void): () => void {
  return subscribeStoreChanges(change => {
    if (change.key === key) {
      listener(change);
    }
  });
}

export async function clearLocalStoreCopy(key: string): Promise<void> {
  removeLocalCacheValue(key);
  try {
    if (await isTauri()) {
      await invoke('delete_store', { key });
    }
  } catch {
    logWarn('Persistence', `Tauri delete failed for ${key}`);
  }
  notifyPersistenceHealthSubscribers();
}

export async function listLocalImportCandidates(): Promise<LocalImportCandidate[]> {
  const candidates: LocalImportCandidate[] = [];
  const authenticated = isSupabaseReady() && isAuthenticated();

  for (const item of SHARED_STORE_KEYS) {
    const rawLocal = localStorage.getItem(getDataKey(item.key));
    const local = parseImportRaw(rawLocal);
    const tauri = parseImportRaw(await readTauriRaw(item.key));
    if (!local.hasValue && !tauri.hasValue) continue;

    let remoteExists: boolean | null = null;
    if (authenticated) {
      try {
        remoteExists = Boolean(await loadRemote(NAMESPACE, item.key));
      } catch (error) {
        remoteExists = null;
        logWarn('Persistence', `Could not check remote import state for ${item.key}: ${error instanceof Error ? error.message : String(error)}`);
      }
    }

    candidates.push({
      key: item.key,
      label: item.label,
      description: item.description,
      localStorage: local.hasValue,
      tauri: tauri.hasValue,
      remoteExists,
      sizeBytes: Math.max(local.sizeBytes, tauri.sizeBytes),
    });
  }

  return candidates;
}

export async function importLocalStoreCandidate(
  key: string,
  options: { replace?: boolean } = {},
): Promise<LocalImportResult> {
  if (!isSupabaseReady() || !isAuthenticated()) {
    return { key, imported: false, cleared: false, reason: 'not_authenticated' };
  }

  const storeKey = getSharedStoreKey(key);
  if (!storeKey) {
    return { key, imported: false, cleared: false, reason: 'no_local_data' };
  }

  const local = await readLocalImportValue(key);
  if (!local.hasValue) {
    return { key, imported: false, cleared: false, reason: 'no_local_data' };
  }

  try {
    const remote = await loadRemote(NAMESPACE, key);
    if (remote && !options.replace) {
      return { key, imported: false, cleared: false, reason: 'remote_exists' };
    }
  } catch (error) {
    const message = error instanceof Error ? error.message : String(error);
    rememberRemoteRead(key, message);
    return { key, imported: false, cleared: false, reason: 'remote_write_failed' };
  }

  const success = await saveRemote(NAMESPACE, key, local.value);
  if (!success) {
    rememberRemoteWrite(key, 'Supabase import write failed.');
    return { key, imported: false, cleared: false, reason: 'remote_write_failed' };
  }

  lastKnownRemoteJson.set(key, JSON.stringify(local.value));
  rememberRemoteWrite(key, null);
  await clearLocalStoreCopy(key);
  return { key, imported: true, cleared: true, reason: 'imported' };
}

/**
 * Load data. When authenticated with Supabase, the database is the
 * source of truth and local persistent storage is ignored.
 *
 * Priority:
 *   Authenticated: Supabase only
 *   Not authenticated: Tauri → localStorage
 */
export async function loadStore<T>(key: string): Promise<T | null> {
  if (isSupabaseReady() && isAuthenticated()) {
    try {
      const remote = await loadRemote<T>(NAMESPACE, key);
      suppressNextAuthenticatedSave.add(key);
      rememberRemoteRead(key, null);
      if (remote) {
        lastKnownRemoteJson.set(key, JSON.stringify(remote.value));
        return remote.value;
      }
      lastKnownRemoteJson.delete(key);
      return null;
    } catch (error) {
      const message = error instanceof Error ? error.message : String(error);
      suppressNextAuthenticatedSave.add(key);
      rememberRemoteRead(key, message);
      logWarn('Persistence', `Supabase load failed for ${key}: ${message}`);
      return null;
    }
  }

  // Not authenticated - local-first mode

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
 * Save data. Signed-in users write to Supabase only. Signed-out users
 * write to the local-first Tauri/localStorage store.
 */
export async function saveStore<T>(key: string, value: T): Promise<void> {
  const json = JSON.stringify(value);
  const updatedAt = new Date().toISOString();
  const authenticated = isSupabaseReady() && isAuthenticated();

  if (authenticated) {
    if (lastKnownRemoteJson.get(key) === json) {
      suppressNextAuthenticatedSave.delete(key);
      return;
    }

    if (suppressNextAuthenticatedSave.has(key)) {
      suppressNextAuthenticatedSave.delete(key);
      rememberSuppressedInitialWrite(key);
      return;
    }

    const readFailure = remoteReadFailedKeys.get(key);
    if (readFailure) {
      const message = `Skipped Supabase write for ${key} because the last database read failed: ${readFailure}`;
      rememberRemoteWrite(key, message);
      logWarn('Persistence', message);
      return;
    }

    ensureRemoteFlushHandlers();
    ensureRemoteStoreSubscription();
    queueRemoteWrite(NAMESPACE, key, value, {
      updatedAt,
      onSettled: ({ success }) => {
        if (!success) {
          rememberRemoteWrite(key, getSupabaseWriteQueueSnapshot().lastFlushError || 'Supabase write failed.');
          return;
        }
        lastKnownRemoteJson.set(key, json);
        rememberRemoteWrite(key, null);
      },
    });
    notifyPersistenceHealthSubscribers();
    return;
  }

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
}
