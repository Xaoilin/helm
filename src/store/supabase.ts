/**
 * Reusable Supabase key-value persistence layer.
 *
 * Any project can use this by passing its own namespace:
 *   - HELM uses namespace 'helm'
 *   - Another project uses namespace 'my-other-app'
 *
 * Schema required in Supabase:
 *   CREATE TABLE kv_store (
 *     namespace TEXT NOT NULL,
 *     key TEXT NOT NULL,
 *     value JSONB NOT NULL,
 *     updated_at TIMESTAMPTZ NOT NULL DEFAULT now(),
 *     PRIMARY KEY (namespace, key)
 *   );
 *   ALTER TABLE kv_store ENABLE ROW LEVEL SECURITY;
 *   CREATE POLICY "Allow all for anon" ON kv_store FOR ALL USING (true);
 */

import { createClient, type SupabaseClient } from '@supabase/supabase-js';

let client: SupabaseClient | null = null;

/** Initialize or re-initialize the Supabase client. */
export function initSupabase(url: string, anonKey: string): void {
  if (!url || !anonKey) {
    client = null;
    return;
  }
  client = createClient(url, anonKey);
}

/** Check if Supabase is configured and ready. */
export function isSupabaseReady(): boolean {
  return client !== null;
}

/** Try to initialize from env vars (Vite injects VITE_ prefixed vars). */
export function initFromEnv(): void {
  const url = (typeof import.meta !== 'undefined' && import.meta.env?.VITE_SUPABASE_URL) || '';
  const key = (typeof import.meta !== 'undefined' && import.meta.env?.VITE_SUPABASE_ANON_KEY) || '';
  if (url && key) initSupabase(url, key);
}

/** Try to initialize from localStorage (user-configured in Settings). */
export function initFromSettings(): void {
  try {
    const raw = localStorage.getItem('helm:settings');
    if (!raw) return;
    const settings = JSON.parse(raw);
    if (settings?.supabaseUrl && settings?.supabaseAnonKey) {
      initSupabase(settings.supabaseUrl, settings.supabaseAnonKey);
    }
  } catch { /* ignore */ }
}

// ── CRUD Operations ──

interface KvRow {
  namespace: string;
  key: string;
  value: unknown;
  updated_at: string;
}

/** Load a single value from Supabase. Returns null if not found or not connected. */
export async function loadRemote<T>(namespace: string, key: string): Promise<{ value: T; updatedAt: string } | null> {
  if (!client) return null;
  try {
    const { data, error } = await client
      .from('kv_store')
      .select('value, updated_at')
      .eq('namespace', namespace)
      .eq('key', key)
      .single();
    if (error || !data) return null;
    return { value: data.value as T, updatedAt: data.updated_at };
  } catch {
    return null;
  }
}

/** Save a value to Supabase (upsert). Returns true on success. */
export async function saveRemote<T>(namespace: string, key: string, value: T): Promise<boolean> {
  if (!client) return false;
  try {
    const { error } = await client
      .from('kv_store')
      .upsert({
        namespace,
        key,
        value: value as unknown,
        updated_at: new Date().toISOString(),
      }, { onConflict: 'namespace,key' });
    return !error;
  } catch {
    return false;
  }
}

/** Load all keys for a namespace. */
export async function loadAllRemote(namespace: string): Promise<KvRow[]> {
  if (!client) return [];
  try {
    const { data, error } = await client
      .from('kv_store')
      .select('*')
      .eq('namespace', namespace);
    if (error || !data) return [];
    return data as KvRow[];
  } catch {
    return [];
  }
}

/** Delete a key from Supabase. */
export async function deleteRemote(namespace: string, key: string): Promise<boolean> {
  if (!client) return false;
  try {
    const { error } = await client
      .from('kv_store')
      .delete()
      .eq('namespace', namespace)
      .eq('key', key);
    return !error;
  } catch {
    return false;
  }
}

// ── Debounced write queue ──

const writeQueue = new Map<string, { namespace: string; key: string; value: unknown }>();
let writeTimer: ReturnType<typeof setTimeout> | null = null;
const DEBOUNCE_MS = 1000;

/** Queue a write to Supabase (debounced). Writes batch after 1s of inactivity. */
export function queueRemoteWrite<T>(namespace: string, key: string, value: T): void {
  writeQueue.set(`${namespace}:${key}`, { namespace, key, value });
  if (writeTimer) clearTimeout(writeTimer);
  writeTimer = setTimeout(flushWriteQueue, DEBOUNCE_MS);
}

/** Flush all queued writes to Supabase. */
export async function flushWriteQueue(): Promise<void> {
  if (!client || writeQueue.size === 0) return;
  const entries = Array.from(writeQueue.values());
  writeQueue.clear();
  if (writeTimer) { clearTimeout(writeTimer); writeTimer = null; }

  // Batch upsert
  const rows = entries.map(e => ({
    namespace: e.namespace,
    key: e.key,
    value: e.value,
    updated_at: new Date().toISOString(),
  }));

  try {
    await client.from('kv_store').upsert(rows, { onConflict: 'namespace,key' });
  } catch (err) {
    console.warn('[Supabase] Flush failed, will retry next cycle:', err);
    // Re-queue failed writes
    for (const entry of entries) {
      writeQueue.set(`${entry.namespace}:${entry.key}`, entry);
    }
  }
}

// ── Sync (pull remote, merge with local) ──

export interface SyncResult {
  pulled: number;
  pushed: number;
  errors: string[];
}

/**
 * Full sync: pull all remote data for a namespace, merge with local by timestamp.
 * Returns stats about what changed.
 */
export async function syncNamespace(
  namespace: string,
  localData: Map<string, { value: unknown; updatedAt: string }>,
  onRemoteNewer: (key: string, value: unknown) => void,
): Promise<SyncResult> {
  const result: SyncResult = { pulled: 0, pushed: 0, errors: [] };
  if (!client) return result;

  try {
    const remoteRows = await loadAllRemote(namespace);

    // Pull: remote rows that are newer than local
    for (const row of remoteRows) {
      const local = localData.get(row.key);
      if (!local || new Date(row.updated_at) > new Date(local.updatedAt)) {
        onRemoteNewer(row.key, row.value);
        result.pulled++;
      }
    }

    // Push: local keys that don't exist remotely or are newer
    for (const [key, local] of localData) {
      const remote = remoteRows.find(r => r.key === key);
      if (!remote || new Date(local.updatedAt) > new Date(remote.updated_at)) {
        const ok = await saveRemote(namespace, key, local.value);
        if (ok) result.pushed++;
        else result.errors.push(`Failed to push ${key}`);
      }
    }
  } catch (err) {
    result.errors.push(err instanceof Error ? err.message : 'Sync failed');
  }

  return result;
}
