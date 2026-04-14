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

import { createClient, type Session, type SupabaseClient, type User } from '@supabase/supabase-js';
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
export function onAuthStateChange(callback: (user: User | null) => void): () => void {
  if (!client) return () => {};
  const { data: { subscription } } = client.auth.onAuthStateChange((_event, session) => {
    const user = session?.user || null;
    currentUserId = user?.id || null;
    currentSession = session ?? null;
    authSessionBootstrapped = true;
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
  } catch (e) {
    logError('Supabase', e);
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

// ── Debounced write queue ──

export interface RemoteWriteSettledResult {
  success: boolean;
  updatedAt: string;
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
  if (writeTimer) clearTimeout(writeTimer);
  writeTimer = setTimeout(flushWriteQueue, TIMING.SUPABASE_DEBOUNCE);
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
    updated_at: e.updatedAt,
  }));

  let success = false;
  try {
    const { error } = await client.from('kv_store').upsert(rows, { onConflict: 'user_id,namespace,key' });
    if (error) throw error;
    success = true;
  } catch (err) {
    console.warn('[Supabase] Flush failed, will retry next cycle:', err);
    for (const entry of entries) {
      writeQueue.set(`${entry.namespace}:${entry.key}`, entry);
    }
  } finally {
    for (const entry of entries) {
      entry.onSettled?.({ success, updatedAt: entry.updatedAt });
    }
  }
}
