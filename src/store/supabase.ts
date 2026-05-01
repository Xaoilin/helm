/**
 * Reusable Supabase key-value persistence layer with Google Auth.
 *
 * Schema required (v2 — with user scoping):
 *   CREATE TABLE kv_store (
 *     user_id UUID NOT NULL REFERENCES auth.users(id) ON DELETE CASCADE,
 *     namespace TEXT NOT NULL,
 *     key TEXT NOT NULL,
 *     value JSONB NOT NULL,
 *     updated_at TIMESTAMPTZ NOT NULL DEFAULT now(),
 *     PRIMARY KEY (user_id, namespace, key)
 *   );
 *   ALTER TABLE kv_store ENABLE ROW LEVEL SECURITY;
 *   CREATE POLICY "User isolation" ON kv_store
 *     FOR ALL USING (auth.uid()::text = user_id::text);
 */

import { createClient, type AuthChangeEvent, type Session, type SupabaseClient, type User } from '@supabase/supabase-js';
import { logError, logWarn } from '../services/logger';
import { TIMING } from '../config/constants';

let client: SupabaseClient | null = null;
let currentUserId: string | null = null;
let currentSession: Session | null = null;
let authSessionBootstrapped = false;

const GOOGLE_SIGN_IN_SCOPES = [
  'openid',
  'email',
  'profile',
  'https://www.googleapis.com/auth/calendar',
].join(' ');

export interface AuthSessionSnapshot {
  userId: string;
  email: string | null;
  accessTokenPresent: boolean;
  providerToken: string | null;
  providerRefreshToken: string | null;
  provider: string | null;
  expiresAt: number | null;
}

export interface AuthStateChange {
  event: AuthChangeEvent;
  user: User | null;
}

/** Initialize or re-initialize the Supabase client. */
export function initSupabase(url: string, anonKey: string): void {
  if (!url || !anonKey) {
    client = null;
    currentUserId = null;
    currentSession = null;
    authSessionBootstrapped = false;
    return;
  }
  client = createClient(url, anonKey);
  authSessionBootstrapped = false;
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

export function getAuthSessionSnapshot(): AuthSessionSnapshot | null {
  if (!currentSession?.user) return null;
  return {
    userId: currentSession.user.id,
    email: currentSession.user.email ?? null,
    accessTokenPresent: Boolean(currentSession.access_token),
    providerToken: currentSession.provider_token ?? null,
    providerRefreshToken: currentSession.provider_refresh_token ?? null,
    provider: currentSession.user.app_metadata?.provider ?? null,
    expiresAt: currentSession.expires_at ?? null,
  };
}

export function getCurrentAccessToken(): string | null {
  return currentSession?.access_token ?? null;
}

export function isAuthSessionBootstrapped(): boolean {
  return authSessionBootstrapped;
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
  } catch { logWarn('Supabase', 'Init from settings failed'); }
}

// ── Auth ──

/** Sign in with Google via Supabase Auth. */
export async function signInWithGoogle(): Promise<void> {
  if (!client) throw new Error('Supabase not configured');
  const { error } = await client.auth.signInWithOAuth({
    provider: 'google',
    options: {
      scopes: GOOGLE_SIGN_IN_SCOPES,
      redirectTo: window.location.origin + (window.location.pathname.includes('/helm') ? '/helm/' : '/'),
      queryParams: {
        access_type: 'offline',
        include_granted_scopes: 'true',
        prompt: 'consent select_account',
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
  currentSession = null;
  authSessionBootstrapped = true;
}

/** Get current session user. */
export async function getSessionUser(): Promise<User | null> {
  if (!client) return null;
  try {
    const { data: { session } } = await client.auth.getSession();
    if (session?.user) {
      currentUserId = session.user.id;
      currentSession = session;
      authSessionBootstrapped = true;
      return session.user;
    }
  } catch { logWarn('Supabase', 'Get session user failed'); }
  currentUserId = null;
  currentSession = null;
  authSessionBootstrapped = true;
  return null;
}

/** Subscribe to auth state changes. Returns unsubscribe function. */
export function onAuthStateChange(callback: (change: AuthStateChange) => void): () => void {
  if (!client) return () => {};
  const { data: { subscription } } = client.auth.onAuthStateChange((event, session) => {
    const user = session?.user || null;
    currentUserId = user?.id || null;
    currentSession = session ?? null;
    authSessionBootstrapped = true;
    callback({ event, user });
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

function isNoRowsError(error: { code?: string; message?: string } | null | undefined): boolean {
  if (!error) return false;
  return error.code === 'PGRST116' || /0 rows|no rows|not found/i.test(error.message || '');
}

function toError(error: unknown, fallback: string): Error {
  if (error instanceof Error) return error;
  if (typeof error === 'object' && error && 'message' in error) {
    return new Error(String((error as { message?: unknown }).message));
  }
  return new Error(error ? String(error) : fallback);
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
    if (error) {
      if (isNoRowsError(error)) return null;
      throw toError(error, `Failed to load ${namespace}:${key}`);
    }
    if (!data) return null;
    return { value: data.value as T, updatedAt: data.updated_at };
  } catch (e) {
    logError('Supabase', e);
    throw e;
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
  } catch (e) {
    logError('Supabase', e);
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
  } catch (e) {
    logError('Supabase', e);
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
  } catch (e) {
    logError('Supabase', e);
    return false;
  }
}

// ── Realtime key-value invalidation ──

export type SupabaseRealtimeState =
  | 'unavailable'
  | 'subscribing'
  | 'subscribed'
  | 'closed'
  | 'error'
  | 'timed_out';

export interface SupabaseRealtimeSnapshot {
  state: SupabaseRealtimeState;
  lastEventAt: string | null;
  lastStatusAt: string | null;
  lastError: string | null;
}

export interface RemoteStoreChange {
  event: 'INSERT' | 'UPDATE' | 'DELETE' | string;
  namespace: string;
  key: string;
  updatedAt: string | null;
  value: unknown;
}

let realtimeSnapshot: SupabaseRealtimeSnapshot = {
  state: 'unavailable',
  lastEventAt: null,
  lastStatusAt: null,
  lastError: null,
};

const realtimeSubscribers = new Set<(snapshot: SupabaseRealtimeSnapshot) => void>();

function copyRealtimeSnapshot(): SupabaseRealtimeSnapshot {
  return { ...realtimeSnapshot };
}

function publishRealtimeSnapshot(patch: Partial<SupabaseRealtimeSnapshot>): void {
  realtimeSnapshot = {
    ...realtimeSnapshot,
    ...patch,
    lastStatusAt: patch.state ? new Date().toISOString() : realtimeSnapshot.lastStatusAt,
  };
  const snapshot = copyRealtimeSnapshot();
  realtimeSubscribers.forEach(listener => listener(snapshot));
}

function normalizeRealtimeStatus(status: string): SupabaseRealtimeState {
  switch (status) {
    case 'SUBSCRIBED':
      return 'subscribed';
    case 'CHANNEL_ERROR':
      return 'error';
    case 'TIMED_OUT':
      return 'timed_out';
    case 'CLOSED':
      return 'closed';
    default:
      return 'subscribing';
  }
}

function rowFromRealtimePayload(payload: unknown): Partial<KvRow> | null {
  if (!payload || typeof payload !== 'object') return null;
  const record = payload as {
    eventType?: string;
    new?: Partial<KvRow>;
    old?: Partial<KvRow>;
  };
  return record.new?.key ? record.new : record.old?.key ? record.old : null;
}

export function getSupabaseRealtimeSnapshot(): SupabaseRealtimeSnapshot {
  return copyRealtimeSnapshot();
}

export function subscribeSupabaseRealtimeSnapshot(
  listener: (snapshot: SupabaseRealtimeSnapshot) => void,
): () => void {
  realtimeSubscribers.add(listener);
  listener(copyRealtimeSnapshot());
  return () => {
    realtimeSubscribers.delete(listener);
  };
}

export function subscribeRemoteStore(
  namespace: string,
  listener: (change: RemoteStoreChange) => void,
): () => void {
  if (!client || !currentUserId) {
    publishRealtimeSnapshot({
      state: 'unavailable',
      lastError: !client ? 'Supabase is not configured.' : 'No authenticated Supabase user.',
    });
    return () => {};
  }

  publishRealtimeSnapshot({ state: 'subscribing', lastError: null });

  const channel = client
    .channel(`kv-store-${namespace}-${currentUserId}`)
    .on(
      'postgres_changes',
      {
        event: '*',
        schema: 'public',
        table: 'kv_store',
        filter: `user_id=eq.${currentUserId}`,
      },
      payload => {
        const row = rowFromRealtimePayload(payload);
        if (!row?.namespace || !row.key || row.namespace !== namespace) return;
        publishRealtimeSnapshot({
          state: 'subscribed',
          lastEventAt: new Date().toISOString(),
          lastError: null,
        });
        listener({
          event: String(payload.eventType || 'change'),
          namespace: row.namespace,
          key: row.key,
          updatedAt: typeof row.updated_at === 'string' ? row.updated_at : null,
          value: row.value,
        });
      },
    )
    .subscribe(status => {
      const state = normalizeRealtimeStatus(status);
      publishRealtimeSnapshot({
        state,
        lastError: state === 'error' || state === 'timed_out' ? `Realtime channel ${status}.` : null,
      });
    });

  return () => {
    void client?.removeChannel(channel);
  };
}

// ── Debounced write queue ──

export interface RemoteWriteSettledResult {
  success: boolean;
  updatedAt: string;
}

export interface SupabaseWriteQueueSnapshot {
  queuedCount: number;
  queuedKeys: string[];
  lastQueuedAt: string | null;
  lastFlushStartedAt: string | null;
  lastFlushSuccessAt: string | null;
  lastFlushFailureAt: string | null;
  lastFlushError: string | null;
  lastFlushKeys: string[];
  lastFailureKeys: string[];
}

interface QueuedWrite {
  namespace: string;
  key: string;
  value: unknown;
  updatedAt: string;
  onSettled?: (result: RemoteWriteSettledResult) => void;
}

const writeQueue = new Map<string, QueuedWrite>();
let writeTimer: ReturnType<typeof setTimeout> | null = null;
let writeQueueSnapshot: SupabaseWriteQueueSnapshot = {
  queuedCount: 0,
  queuedKeys: [],
  lastQueuedAt: null,
  lastFlushStartedAt: null,
  lastFlushSuccessAt: null,
  lastFlushFailureAt: null,
  lastFlushError: null,
  lastFlushKeys: [],
  lastFailureKeys: [],
};
const writeQueueSubscribers = new Set<(snapshot: SupabaseWriteQueueSnapshot) => void>();

function getQueuedWriteKeys(): string[] {
  return Array.from(writeQueue.keys()).sort();
}

function copyWriteQueueSnapshot(): SupabaseWriteQueueSnapshot {
  return {
    ...writeQueueSnapshot,
    queuedKeys: [...writeQueueSnapshot.queuedKeys],
    lastFlushKeys: [...writeQueueSnapshot.lastFlushKeys],
    lastFailureKeys: [...writeQueueSnapshot.lastFailureKeys],
  };
}

function publishWriteQueueSnapshot(patch: Partial<SupabaseWriteQueueSnapshot> = {}): void {
  writeQueueSnapshot = {
    ...writeQueueSnapshot,
    ...patch,
    queuedCount: writeQueue.size,
    queuedKeys: getQueuedWriteKeys(),
  };

  const snapshot = copyWriteQueueSnapshot();
  writeQueueSubscribers.forEach(listener => listener(snapshot));
}

export function getSupabaseWriteQueueSnapshot(): SupabaseWriteQueueSnapshot {
  return copyWriteQueueSnapshot();
}

export function subscribeSupabaseWriteQueueSnapshot(
  listener: (snapshot: SupabaseWriteQueueSnapshot) => void,
): () => void {
  writeQueueSubscribers.add(listener);
  listener(copyWriteQueueSnapshot());
  return () => {
    writeQueueSubscribers.delete(listener);
  };
}

export function queueRemoteWrite<T>(
  namespace: string,
  key: string,
  value: T,
  options: {
    updatedAt?: string;
    onSettled?: (result: RemoteWriteSettledResult) => void;
  } = {},
): void {
  writeQueue.set(`${namespace}:${key}`, {
    namespace,
    key,
    value,
    updatedAt: options.updatedAt || new Date().toISOString(),
    onSettled: options.onSettled,
  });
  publishWriteQueueSnapshot({ lastQueuedAt: new Date().toISOString() });
  if (writeTimer) clearTimeout(writeTimer);
  writeTimer = setTimeout(flushWriteQueue, TIMING.SUPABASE_DEBOUNCE);
}

export async function flushWriteQueue(): Promise<void> {
  if (!client || writeQueue.size === 0) return;
  const entries = Array.from(writeQueue.values());
  const flushKeys = entries.map(entry => `${entry.namespace}:${entry.key}`).sort();
  writeQueue.clear();
  if (writeTimer) { clearTimeout(writeTimer); writeTimer = null; }
  publishWriteQueueSnapshot({
    lastFlushStartedAt: new Date().toISOString(),
    lastFlushKeys: flushKeys,
    lastFlushError: null,
  });

  const rows = entries.map(e => ({
    user_id: getUserId(),
    namespace: e.namespace,
    key: e.key,
    value: e.value,
    updated_at: e.updatedAt,
  }));

  let success = false;
  try {
    const { error } = await client.from('kv_store').upsert(rows, { onConflict: 'user_id,namespace,key' });
    if (error) throw error;
    success = true;
    publishWriteQueueSnapshot({
      lastFlushSuccessAt: new Date().toISOString(),
      lastFlushError: null,
      lastFailureKeys: [],
    });
  } catch (err) {
    const message = err instanceof Error ? err.message : String(err);
    logWarn('Supabase', `Flush failed, will retry next cycle: ${message}`);
    for (const entry of entries) {
      writeQueue.set(`${entry.namespace}:${entry.key}`, entry);
    }
    publishWriteQueueSnapshot({
      lastFlushFailureAt: new Date().toISOString(),
      lastFlushError: message,
      lastFailureKeys: flushKeys,
    });
  } finally {
    for (const entry of entries) {
      entry.onSettled?.({ success, updatedAt: entry.updatedAt });
    }
    publishWriteQueueSnapshot();
  }
}
