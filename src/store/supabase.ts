/**
 * Reusable Supabase key-value persistence layer with Google Auth.
 *
 * Schema required (v2 — with user scoping):
 *   CREATE TABLE kv_store (
 *     user_id TEXT NOT NULL,
 *     namespace TEXT NOT NULL,
 *     key TEXT NOT NULL,
 *     value JSONB NOT NULL,
 *     updated_at TIMESTAMPTZ NOT NULL DEFAULT now(),
 *     PRIMARY KEY (user_id, namespace, key)
 *   );
 *   ALTER TABLE kv_store ENABLE ROW LEVEL SECURITY;
 *   CREATE POLICY "User isolation" ON kv_store
 *     FOR ALL USING (auth.uid()::text = user_id);
 */

import { createClient, type SupabaseClient, type User } from '@supabase/supabase-js';

let client: SupabaseClient | null = null;
let currentUserId: string | null = null;

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

/** Get the raw Supabase client (for auth operations). */
export function getClient(): SupabaseClient | null {
  return client;
}

/** Get the current authenticated user ID. */
export function getCurrentUserId(): string | null {
  return currentUserId;
}

/** Set the current user ID (called after auth state changes). */
export function setCurrentUserId(userId: string | null): void {
  currentUserId = userId;
}

/** Check if user is authenticated. */
export function isAuthenticated(): boolean {
  return currentUserId !== null;
}

/** Try to initialize from env vars. */
export function initFromEnv(): void {
  const url = (typeof import.meta !== 'undefined' && import.meta.env?.VITE_SUPABASE_URL) || '';
  const key = (typeof import.meta !== 'undefined' && import.meta.env?.VITE_SUPABASE_ANON_KEY) || '';
  if (url && key) initSupabase(url, key);
}

/** Try to initialize from localStorage. */
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

// ── Auth ──

/** Sign in with Google via Supabase Auth. */
export async function signInWithGoogle(): Promise<void> {
  if (!client) throw new Error('Supabase not configured');
  const { error } = await client.auth.signInWithOAuth({
    provider: 'google',
    options: {
      redirectTo: window.location.origin + (window.location.pathname.includes('/helm') ? '/helm/' : '/'),
      queryParams: {
        prompt: 'select_account',
      },
    },
  });
  if (error) throw error;
}

/** Sign out. */
export async function signOut(): Promise<void> {
  if (!client) return;
  await client.auth.signOut();
  currentUserId = null;
}

/** Get current session user. */
export async function getSessionUser(): Promise<User | null> {
  if (!client) return null;
  try {
    const { data: { session } } = await client.auth.getSession();
    if (session?.user) {
      currentUserId = session.user.id;
      return session.user;
    }
  } catch { /* ignore */ }
  currentUserId = null;
  return null;
}

/** Subscribe to auth state changes. Returns unsubscribe function. */
export function onAuthStateChange(callback: (user: User | null) => void): () => void {
  if (!client) return () => {};
  const { data: { subscription } } = client.auth.onAuthStateChange((_event, session) => {
    const user = session?.user || null;
    currentUserId = user?.id || null;
    callback(user);
  });
  return () => subscription.unsubscribe();
}

// ── User-scoped CRUD Operations ──

// Helper: get the effective user_id for queries
function getUserId(): string {
  return currentUserId || 'anonymous';
}

interface KvRow {
  user_id: string;
  namespace: string;
  key: string;
  value: unknown;
  updated_at: string;
}

/** Load a single value. */
export async function loadRemote<T>(namespace: string, key: string): Promise<{ value: T; updatedAt: string } | null> {
  if (!client) return null;
  try {
    const { data, error } = await client
      .from('kv_store')
      .select('value, updated_at')
      .eq('user_id', getUserId())
      .eq('namespace', namespace)
      .eq('key', key)
      .single();
    if (error || !data) return null;
    return { value: data.value as T, updatedAt: data.updated_at };
  } catch {
    return null;
  }
}

/** Save a value (upsert). */
export async function saveRemote<T>(namespace: string, key: string, value: T): Promise<boolean> {
  if (!client) return false;
  try {
    const { error } = await client
      .from('kv_store')
      .upsert({
        user_id: getUserId(),
        namespace,
        key,
        value: value as unknown,
        updated_at: new Date().toISOString(),
      }, { onConflict: 'user_id,namespace,key' });
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
      .eq('user_id', getUserId())
      .eq('namespace', namespace);
    if (error || !data) return [];
    return data as KvRow[];
  } catch {
    return [];
  }
}

/** Delete a key. */
export async function deleteRemote(namespace: string, key: string): Promise<boolean> {
  if (!client) return false;
  try {
    const { error } = await client
      .from('kv_store')
      .delete()
      .eq('user_id', getUserId())
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

export function queueRemoteWrite<T>(namespace: string, key: string, value: T): void {
  writeQueue.set(`${namespace}:${key}`, { namespace, key, value });
  if (writeTimer) clearTimeout(writeTimer);
  writeTimer = setTimeout(flushWriteQueue, DEBOUNCE_MS);
}

export async function flushWriteQueue(): Promise<void> {
  if (!client || writeQueue.size === 0) return;
  const entries = Array.from(writeQueue.values());
  writeQueue.clear();
  if (writeTimer) { clearTimeout(writeTimer); writeTimer = null; }

  const rows = entries.map(e => ({
    user_id: getUserId(),
    namespace: e.namespace,
    key: e.key,
    value: e.value,
    updated_at: new Date().toISOString(),
  }));

  try {
    await client.from('kv_store').upsert(rows, { onConflict: 'user_id,namespace,key' });
  } catch (err) {
    console.warn('[Supabase] Flush failed, will retry next cycle:', err);
    for (const entry of entries) {
      writeQueue.set(`${entry.namespace}:${entry.key}`, entry);
    }
  }
}
