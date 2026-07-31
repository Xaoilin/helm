/**
 * Supabase authentication plus HELM's account-owned record API.
 * Shared application data never falls back to an anonymous or local store.
 */
import { createClient, type AuthChangeEvent, type Session, type SupabaseClient, type User } from '@supabase/supabase-js';
import { logError, logWarn } from '../services/logger';
import type {
  HelmAccountState,
  HelmMutation,
  HelmMutationResult,
  HelmRealtimeEvent,
  HelmRecord,
  HelmSecretRealtimeEvent,
} from './databaseTypes';
import { HELM_DATABASE_SCHEMA_VERSION } from './databaseTypes';
import type {
  HelmSecretDetail,
  HelmSecretSummary,
  SaveHelmSecretInput,
  SecretKind,
} from '../types/domain';

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

export function initSupabase(url: string, publishableKey: string): void {
  if (!url || !publishableKey) {
    client = null;
    currentUserId = null;
    currentSession = null;
    authSessionBootstrapped = false;
    return;
  }
  client = createClient(url, publishableKey);
  authSessionBootstrapped = false;
}

export function isSupabaseReady(): boolean {
  return client !== null;
}

export function getClient(): SupabaseClient | null {
  return client;
}

export function getCurrentUserId(): string | null {
  return currentUserId;
}

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

export function isAuthenticated(): boolean {
  return currentUserId !== null;
}

export function initFromEnv(): void {
  const url = (typeof import.meta !== 'undefined' && import.meta.env?.VITE_SUPABASE_URL) || '';
  const key = (typeof import.meta !== 'undefined' && import.meta.env?.VITE_SUPABASE_ANON_KEY) || '';
  if (url && key) initSupabase(url, key);
}

export async function signInWithGoogle(): Promise<void> {
  if (!client) throw new Error('Supabase is not configured.');
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

export async function signOut(): Promise<void> {
  if (!client) return;
  const { error } = await client.auth.signOut();
  if (error) throw error;
  currentUserId = null;
  currentSession = null;
  authSessionBootstrapped = true;
}

export async function getSessionUser(): Promise<User | null> {
  if (!client) return null;
  try {
    const { data: { session }, error } = await client.auth.getSession();
    if (error) throw error;
    if (session?.user) {
      currentUserId = session.user.id;
      currentSession = session;
      authSessionBootstrapped = true;
      return session.user;
    }
  } catch (error) {
    logWarn('Supabase', `Session bootstrap failed: ${error instanceof Error ? error.message : String(error)}`);
  }
  currentUserId = null;
  currentSession = null;
  authSessionBootstrapped = true;
  return null;
}

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

function requireClient(): SupabaseClient {
  if (!client) throw new Error('Supabase is not configured.');
  if (!currentUserId) throw new Error('A signed-in HELM account is required.');
  return client;
}

function asRecord(value: unknown): Record<string, unknown> {
  return value && typeof value === 'object' && !Array.isArray(value)
    ? value as Record<string, unknown>
    : {};
}

interface HelmRecordRow {
  user_id: string;
  collection: string;
  record_id: string;
  payload: unknown;
  position: number | null;
  revision: number;
  account_version: number;
  created_at: string;
  updated_at: string;
  deleted_at: string | null;
}

interface HelmAccountStateRow {
  user_id: string;
  schema_version: number;
  account_version: number;
  minimum_client_version: string;
  migrated_at: string | null;
  updated_at: string;
}

const HELM_RECORD_COLUMNS = [
  'user_id',
  'collection',
  'record_id',
  'payload',
  'position',
  'revision',
  'account_version',
  'created_at',
  'updated_at',
  'deleted_at',
].join(',');

function mapRecord(row: HelmRecordRow): HelmRecord {
  return {
    userId: row.user_id,
    collection: row.collection,
    recordId: row.record_id,
    payload: asRecord(row.payload),
    position: row.position,
    revision: row.revision,
    accountVersion: row.account_version,
    createdAt: row.created_at,
    updatedAt: row.updated_at,
    deletedAt: row.deleted_at,
  };
}

function mapAccountState(row: HelmAccountStateRow): HelmAccountState {
  return {
    userId: row.user_id,
    schemaVersion: row.schema_version,
    accountVersion: row.account_version,
    minimumClientVersion: row.minimum_client_version,
    migratedAt: row.migrated_at,
    updatedAt: row.updated_at,
  };
}

const SECRET_KINDS = new Set<SecretKind>([
  'password',
  'api_key',
  'access_token',
  'database',
  'private_key',
  'webhook',
  'other',
]);

function mapSecretSummary(value: unknown): HelmSecretSummary {
  const row = asRecord(value);
  const kind = String(row.kind || 'other');
  return {
    secretId: String(row.secretId || ''),
    label: String(row.label || ''),
    kind: SECRET_KINDS.has(kind as SecretKind) ? kind as SecretKind : 'other',
    environment: typeof row.environment === 'string' ? row.environment : null,
    projectCatalogKeys: Array.isArray(row.projectCatalogKeys)
      ? row.projectCatalogKeys.filter((entry): entry is string => typeof entry === 'string')
      : [],
    sourceRef: typeof row.sourceRef === 'string' ? row.sourceRef : null,
    revision: Number(row.revision || 0),
    accountVersion: Number(row.accountVersion || 0),
    createdAt: String(row.createdAt || ''),
    updatedAt: String(row.updatedAt || ''),
    archivedAt: typeof row.archivedAt === 'string' ? row.archivedAt : null,
  };
}

export async function listHelmSecrets(): Promise<{
  accountVersion: number;
  secrets: HelmSecretSummary[];
}> {
  const database = requireClient();
  const { data, error } = await database.rpc('list_helm_secrets');
  if (error) throw error;
  const result = asRecord(data);
  return {
    accountVersion: Number(result.accountVersion || 0),
    secrets: Array.isArray(result.secrets)
      ? result.secrets.map(mapSecretSummary).filter(secret => secret.secretId && secret.label)
      : [],
  };
}

export async function revealHelmSecret(secretId: string): Promise<HelmSecretDetail> {
  const database = requireClient();
  const { data, error } = await database.rpc('reveal_helm_secret', {
    p_secret_id: secretId,
  });
  if (error) throw error;
  const result = asRecord(data);
  if (typeof result.secretId !== 'string' || typeof result.value !== 'string') {
    throw new Error('The HELM secret response was invalid.');
  }
  return {
    secretId: result.secretId,
    value: result.value,
    username: typeof result.username === 'string' ? result.username : null,
    url: typeof result.url === 'string' ? result.url : null,
    notes: typeof result.notes === 'string' ? result.notes : null,
  };
}

export async function saveHelmSecret(
  requestId: string,
  input: SaveHelmSecretInput,
): Promise<HelmSecretSummary> {
  const database = requireClient();
  const { data, error } = await database.rpc('save_helm_secret', {
    p_request_id: requestId,
    p_secret_id: input.secretId ?? null,
    p_label: input.label,
    p_kind: input.kind,
    p_environment: input.environment || null,
    p_project_catalog_keys: [...new Set(input.projectCatalogKeys)],
    p_value: input.value || null,
    p_username: input.username || null,
    p_url: input.url || null,
    p_notes: input.notes || null,
    p_source_ref: input.sourceRef || null,
  });
  if (error) throw error;
  const result = mapSecretSummary(data);
  if (!result.secretId || !result.label) throw new Error('The HELM secret response was invalid.');
  return result;
}

export async function setHelmSecretArchived(
  requestId: string,
  secretId: string,
  archived: boolean,
): Promise<HelmSecretSummary> {
  const database = requireClient();
  const { data, error } = await database.rpc('set_helm_secret_archived', {
    p_request_id: requestId,
    p_secret_id: secretId,
    p_archived: archived,
  });
  if (error) throw error;
  const result = mapSecretSummary(data);
  if (!result.secretId || !result.label) throw new Error('The HELM secret response was invalid.');
  return result;
}

export async function fetchHelmAccountSnapshot(): Promise<{
  state: HelmAccountState;
  records: HelmRecord[];
}> {
  const database = requireClient();
  const userId = currentUserId!;
  const [recordResponse, stateResponse] = await Promise.all([
    database
      .from('helm_records')
      .select(HELM_RECORD_COLUMNS)
      .eq('user_id', userId),
    database
      .from('helm_account_state')
      .select('user_id,schema_version,account_version,minimum_client_version,migrated_at,updated_at')
      .eq('user_id', userId)
      .maybeSingle(),
  ]);
  if (recordResponse.error) throw recordResponse.error;
  if (stateResponse.error) throw stateResponse.error;
  if (!stateResponse.data && (recordResponse.data || []).length > 0) {
    throw new Error('HELM account state is missing for existing database records.');
  }
  const state = stateResponse.data
    ? mapAccountState(stateResponse.data as HelmAccountStateRow)
    : {
        userId,
        schemaVersion: HELM_DATABASE_SCHEMA_VERSION,
        accountVersion: 0,
        minimumClientVersion: '0.2.82',
        migratedAt: null,
        updatedAt: new Date(0).toISOString(),
      };
  return {
    state,
    records: ((recordResponse.data || []) as unknown as HelmRecordRow[]).map(mapRecord),
  };
}

export async function probeHelmAccountVersion(): Promise<number> {
  const database = requireClient();
  const { data, error } = await database
    .from('helm_account_state')
    .select('account_version')
    .eq('user_id', currentUserId!)
    .maybeSingle();
  if (error) throw error;
  const row = asRecord(data);
  return typeof row.account_version === 'number' ? row.account_version : 0;
}

export async function fetchHelmCollections(collections: string[]): Promise<HelmRecord[]> {
  if (collections.length === 0) return [];
  const database = requireClient();
  const { data, error } = await database
    .from('helm_records')
    .select(HELM_RECORD_COLUMNS)
    .eq('user_id', currentUserId!)
    .in('collection', [...new Set(collections)]);
  if (error) throw error;
  return ((data || []) as unknown as HelmRecordRow[]).map(mapRecord);
}

function mapMutationResult(value: unknown, requestId: string): HelmMutationResult {
  const record = asRecord(value);
  const changes = Array.isArray(record.changes)
    ? record.changes.map(change => {
        const row = asRecord(change);
        return mapRecord({
          user_id: String(row.userId || ''),
          collection: String(row.collection || ''),
          record_id: String(row.recordId || ''),
          payload: row.payload,
          position: typeof row.position === 'number' ? row.position : null,
          revision: Number(row.revision || 0),
          account_version: Number(row.accountVersion || 0),
          created_at: String(row.createdAt || ''),
          updated_at: String(row.updatedAt || ''),
          deleted_at: typeof row.deletedAt === 'string' ? row.deletedAt : null,
        });
      })
    : [];
  return {
    requestId: typeof record.requestId === 'string' ? record.requestId : requestId,
    accountVersion: Number(record.accountVersion || 0),
    changes,
  };
}

export async function applyHelmMutations(
  requestId: string,
  operations: HelmMutation[],
): Promise<HelmMutationResult> {
  if (operations.length === 0) {
    throw new Error('At least one HELM mutation is required.');
  }
  const database = requireClient();
  const { data, error } = await database.rpc('apply_helm_mutations', {
    p_request_id: requestId,
    p_operations: operations,
  });
  if (error) {
    logError('Supabase', error);
    throw error;
  }
  return mapMutationResult(data, requestId);
}

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

let realtimeSnapshot: SupabaseRealtimeSnapshot = {
  state: 'unavailable',
  lastEventAt: null,
  lastStatusAt: null,
  lastError: null,
};
const realtimeSubscribers = new Set<(snapshot: SupabaseRealtimeSnapshot) => void>();

function publishRealtimeSnapshot(patch: Partial<SupabaseRealtimeSnapshot>): void {
  realtimeSnapshot = {
    ...realtimeSnapshot,
    ...patch,
    lastStatusAt: patch.state ? new Date().toISOString() : realtimeSnapshot.lastStatusAt,
  };
  const snapshot = { ...realtimeSnapshot };
  realtimeSubscribers.forEach(listener => listener(snapshot));
}

function normalizeRealtimeStatus(status: string): SupabaseRealtimeState {
  switch (status) {
    case 'SUBSCRIBED': return 'subscribed';
    case 'CHANNEL_ERROR': return 'error';
    case 'TIMED_OUT': return 'timed_out';
    case 'CLOSED': return 'closed';
    default: return 'subscribing';
  }
}

function parseRealtimeEvent(value: unknown): HelmRealtimeEvent | null {
  const envelope = asRecord(value);
  const payload = asRecord(envelope.payload);
  if (typeof payload.requestId !== 'string' || typeof payload.accountVersion !== 'number') return null;
  const changes = Array.isArray(payload.changes)
    ? payload.changes.map(change => {
        const row = asRecord(change);
        return {
          collection: String(row.collection || ''),
          recordId: String(row.recordId || ''),
          revision: Number(row.revision || 0),
          deletedAt: typeof row.deletedAt === 'string' ? row.deletedAt : null,
        };
      }).filter(change => change.collection && change.recordId)
    : [];
  return {
    requestId: payload.requestId,
    accountVersion: payload.accountVersion,
    changes,
  };
}

function parseSecretRealtimeEvent(value: unknown): HelmSecretRealtimeEvent | null {
  const envelope = asRecord(value);
  const payload = asRecord(envelope.payload);
  if (
    typeof payload.requestId !== 'string'
    || typeof payload.accountVersion !== 'number'
    || typeof payload.secretId !== 'string'
    || typeof payload.revision !== 'number'
  ) return null;
  return {
    requestId: payload.requestId,
    accountVersion: payload.accountVersion,
    secretId: payload.secretId,
    revision: payload.revision,
    archivedAt: typeof payload.archivedAt === 'string' ? payload.archivedAt : null,
  };
}

export function getSupabaseRealtimeSnapshot(): SupabaseRealtimeSnapshot {
  return { ...realtimeSnapshot };
}

export function subscribeSupabaseRealtimeSnapshot(
  listener: (snapshot: SupabaseRealtimeSnapshot) => void,
): () => void {
  realtimeSubscribers.add(listener);
  listener({ ...realtimeSnapshot });
  return () => realtimeSubscribers.delete(listener);
}

export function subscribeHelmBroadcast(
  listener: (event: HelmRealtimeEvent) => void,
  secretListener?: (event: HelmSecretRealtimeEvent) => void,
): () => void {
  if (!client || !currentUserId) {
    publishRealtimeSnapshot({
      state: 'unavailable',
      lastError: !client ? 'Supabase is not configured.' : 'No authenticated HELM account.',
    });
    return () => {};
  }

  const activeClient = client;
  const topic = `helm:account:${currentUserId}`;
  let cancelled = false;
  let channel: ReturnType<SupabaseClient['channel']> | null = null;
  publishRealtimeSnapshot({ state: 'subscribing', lastError: null });

  void activeClient.realtime.setAuth().then(() => {
    if (cancelled) return;
    channel = activeClient
      .channel(topic, { config: { private: true } })
      .on('broadcast', { event: 'helm_records_changed' }, payload => {
        const event = parseRealtimeEvent(payload);
        if (!event) return;
        publishRealtimeSnapshot({
          state: 'subscribed',
          lastEventAt: new Date().toISOString(),
          lastError: null,
        });
        listener(event);
      })
      .on('broadcast', { event: 'helm_secrets_changed' }, payload => {
        const event = parseSecretRealtimeEvent(payload);
        if (!event) return;
        publishRealtimeSnapshot({
          state: 'subscribed',
          lastEventAt: new Date().toISOString(),
          lastError: null,
        });
        secretListener?.(event);
      })
      .subscribe((status, error) => {
        if (cancelled) return;
        const state = normalizeRealtimeStatus(status);
        publishRealtimeSnapshot({
          state,
          lastError: error?.message || (state === 'error' || state === 'timed_out' ? `Realtime channel ${status}.` : null),
        });
      });
  }).catch(error => {
    if (cancelled) return;
    publishRealtimeSnapshot({
      state: 'error',
      lastError: error instanceof Error ? error.message : String(error),
    });
  });

  return () => {
    cancelled = true;
    if (channel) void activeClient.removeChannel(channel);
  };
}
