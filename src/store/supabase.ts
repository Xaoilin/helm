/**
 * Supabase authentication plus Sabah One's account-owned record API.
 * Shared application data never falls back to an anonymous or local store.
 */
import { createClient, type AuthChangeEvent, type Session, type SupabaseClient, type User } from '@supabase/supabase-js';
import { logError, logWarn } from '../services/logger';
import {
  isLifeHeroEvidenceKind,
  LIFE_HERO_RULESET_VERSION,
  LIFE_HERO_STATS,
  validateLifeHeroEvidenceInput,
} from '../services/lifeHeroProgression';
import type {
  HelmAccountState,
  HelmMutation,
  HelmMutationResult,
  HelmRealtimeEvent,
  HelmRecord,
  HelmSecretRealtimeEvent,
} from './databaseTypes';
import type {
  HelmSecretDetail,
  HelmSecretSummary,
  LifeHeroActivityEntry,
  LifeHeroAward,
  LifeHeroConditionState,
  LifeHeroEvidence,
  LifeHeroEvidenceInput,
  LifeHeroEvidenceReceipt,
  LifeHeroEvidenceSourceTier,
  LifeHeroSnapshot,
  LifeHeroStat,
  LifeHeroStatProgress,
  ProductUsageEvent,
  ProductUsageIngestReceipt,
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

export async function signInWithGoogle(redirectTo?: string): Promise<void> {
  if (!client) throw new Error('Supabase is not configured.');
  const { error } = await client.auth.signInWithOAuth({
    provider: 'google',
    options: {
      scopes: GOOGLE_SIGN_IN_SCOPES,
      redirectTo: redirectTo || window.location.origin + (window.location.pathname.includes('/helm') ? '/helm/' : '/'),
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
  if (!currentUserId) throw new Error('A signed-in Sabah One account is required.');
  return client;
}

function asRecord(value: unknown): Record<string, unknown> {
  return value && typeof value === 'object' && !Array.isArray(value)
    ? value as Record<string, unknown>
    : {};
}

const LIFE_HERO_SOURCE_TIERS = new Set<LifeHeroEvidenceSourceTier>([
  'verified',
  'trusted_integration',
  'self_reported',
]);
const LIFE_HERO_CONDITIONS = new Set<LifeHeroConditionState>([
  'awaiting_first_step',
  'steady',
  'renewal_due',
]);

function lifeHeroStat(value: unknown): LifeHeroStat {
  if (typeof value !== 'string' || !LIFE_HERO_STATS.includes(value as LifeHeroStat)) {
    throw new Error('The Sabah One Life Hero response contained an invalid stat.');
  }
  return value as LifeHeroStat;
}

function mapLifeHeroEvidence(value: unknown): LifeHeroEvidence {
  const row = asRecord(value);
  if (
    typeof row.id !== 'string'
    || typeof row.rulesetVersion !== 'string'
    || !isLifeHeroEvidenceKind(row.evidenceType)
    || typeof row.sourceTier !== 'string'
    || !LIFE_HERO_SOURCE_TIERS.has(row.sourceTier as LifeHeroEvidenceSourceTier)
    || typeof row.sourceReference !== 'string'
    || typeof row.idempotencyKey !== 'string'
    || typeof row.occurredAt !== 'string'
    || typeof row.localDate !== 'string'
    || typeof row.createdAt !== 'string'
  ) {
    throw new Error('The Sabah One Life Hero response contained invalid evidence.');
  }
  return {
    id: row.id,
    rulesetVersion: row.rulesetVersion,
    stat: lifeHeroStat(row.stat),
    evidenceType: row.evidenceType,
    sourceTier: row.sourceTier as LifeHeroEvidenceSourceTier,
    sourceReference: row.sourceReference,
    idempotencyKey: row.idempotencyKey,
    occurredAt: row.occurredAt,
    localDate: row.localDate,
    metadata: asRecord(row.metadata) as LifeHeroEvidence['metadata'],
    createdAt: row.createdAt,
  };
}

function mapLifeHeroAward(value: unknown): LifeHeroAward {
  const row = asRecord(value);
  if (
    typeof row.id !== 'string'
    || typeof row.evidenceId !== 'string'
    || typeof row.rulesetVersion !== 'string'
    || typeof row.awardedAt !== 'string'
  ) {
    throw new Error('The Sabah One Life Hero response contained an invalid award.');
  }
  const award = {
    id: row.id,
    evidenceId: row.evidenceId,
    rulesetVersion: row.rulesetVersion,
    stat: lifeHeroStat(row.stat),
    baseXp: Number(row.baseXp),
    sourceMultiplier: Number(row.sourceMultiplier),
    momentumDays: Number(row.momentumDays),
    momentumMultiplier: Number(row.momentumMultiplier),
    awardedXp: Number(row.awardedXp),
    awardedAt: row.awardedAt,
  } satisfies LifeHeroAward;
  if (
    !Number.isInteger(award.baseXp)
    || award.baseXp < 0
    || !Number.isFinite(award.sourceMultiplier)
    || award.sourceMultiplier <= 0
    || !Number.isInteger(award.momentumDays)
    || award.momentumDays < 1
    || !Number.isFinite(award.momentumMultiplier)
    || award.momentumMultiplier < 1
    || !Number.isInteger(award.awardedXp)
    || award.awardedXp < 0
  ) {
    throw new Error('The Sabah One Life Hero response contained invalid award values.');
  }
  return award;
}

function mapLifeHeroStatProgress(value: unknown): LifeHeroStatProgress {
  const row = asRecord(value);
  if (typeof row.condition !== 'string' || !LIFE_HERO_CONDITIONS.has(row.condition as LifeHeroConditionState)) {
    throw new Error('The Sabah One Life Hero response contained an invalid condition.');
  }
  const progress = {
    stat: lifeHeroStat(row.stat),
    totalXp: Number(row.totalXp),
    level: Number(row.level),
    lastEvidenceLocalDate: typeof row.lastEvidenceLocalDate === 'string' ? row.lastEvidenceLocalDate : null,
    condition: row.condition as LifeHeroConditionState,
    attentionAfterDays: Number(row.attentionAfterDays),
  } satisfies LifeHeroStatProgress;
  if (
    !Number.isInteger(progress.totalXp)
    || progress.totalXp < 0
    || !Number.isInteger(progress.level)
    || progress.level < 1
    || !Number.isInteger(progress.attentionAfterDays)
    || progress.attentionAfterDays < 1
  ) {
    throw new Error('The Sabah One Life Hero snapshot contained invalid stat progress.');
  }
  return progress;
}

function mapLifeHeroActivity(value: unknown): LifeHeroActivityEntry {
  const row = asRecord(value);
  return {
    evidence: mapLifeHeroEvidence(row.evidence),
    award: mapLifeHeroAward(row.award),
  };
}

function mapLifeHeroSnapshot(value: unknown): LifeHeroSnapshot {
  const row = asRecord(value);
  if (
    typeof row.rulesetVersion !== 'string'
    || row.rulesetVersion !== LIFE_HERO_RULESET_VERSION
    || typeof row.updatedAt !== 'string'
    || typeof row.recomputedAt !== 'string'
    || !Array.isArray(row.stats)
    || !Array.isArray(row.recentActivity)
  ) {
    throw new Error('The Sabah One Life Hero snapshot response was invalid.');
  }
  const snapshot = {
    rulesetVersion: row.rulesetVersion,
    totalXp: Number(row.totalXp),
    overallLevel: Number(row.overallLevel),
    updatedAt: row.updatedAt,
    recomputedAt: row.recomputedAt,
    stats: row.stats.map(mapLifeHeroStatProgress),
    recentActivity: row.recentActivity.map(mapLifeHeroActivity),
  } satisfies LifeHeroSnapshot;
  if (
    !Number.isInteger(snapshot.totalXp)
    || snapshot.totalXp < 0
    || !Number.isInteger(snapshot.overallLevel)
    || snapshot.overallLevel < 1
    || snapshot.stats.length !== LIFE_HERO_STATS.length
    || snapshot.stats.some((stat, index) => stat.stat !== LIFE_HERO_STATS[index])
    || new Set(snapshot.stats.map(stat => stat.stat)).size !== LIFE_HERO_STATS.length
  ) {
    throw new Error('The Sabah One Life Hero snapshot response was incomplete.');
  }
  return snapshot;
}

export async function fetchLifeHeroSnapshot(asOfLocalDate: string): Promise<LifeHeroSnapshot> {
  const database = requireClient();
  const { data, error } = await database.rpc('get_life_hero_snapshot', {
    p_as_of_local_date: asOfLocalDate,
  });
  if (error) throw error;
  return mapLifeHeroSnapshot(data);
}

export async function acceptLifeHeroEvidence(
  input: LifeHeroEvidenceInput,
): Promise<LifeHeroEvidenceReceipt> {
  const normalized = validateLifeHeroEvidenceInput(input);
  const database = requireClient();
  const { data, error } = await database.rpc('accept_life_hero_evidence', {
    p_idempotency_key: normalized.idempotencyKey,
    p_evidence_type: normalized.evidenceType,
    p_source_tier: normalized.sourceTier,
    p_source_reference: normalized.sourceReference,
    p_occurred_at: normalized.occurredAt,
    p_local_date: normalized.localDate,
    p_metadata: normalized.metadata ?? {},
  });
  if (error) {
    logError('Supabase', error);
    throw error;
  }
  const result = asRecord(data);
  return {
    duplicate: result.duplicate === true,
    evidence: mapLifeHeroEvidence(result.evidence),
    award: mapLifeHeroAward(result.award),
    snapshot: mapLifeHeroSnapshot(result.snapshot),
  };
}

export async function recomputeLifeHeroProfile(asOfLocalDate: string): Promise<LifeHeroSnapshot> {
  const database = requireClient();
  const { data, error } = await database.rpc('recompute_life_hero_profile', {
    p_as_of_local_date: asOfLocalDate,
  });
  if (error) throw error;
  return mapLifeHeroSnapshot(data);
}

export async function ingestProductUsageEvents(
  events: ProductUsageEvent[],
): Promise<ProductUsageIngestReceipt> {
  if (events.length < 1 || events.length > 25) {
    throw new Error('Product usage batches must contain between 1 and 25 events.');
  }
  const database = requireClient();
  const { data, error } = await database.rpc('ingest_product_usage_events', {
    p_events: events,
  });
  if (error) throw error;
  const receipt = asRecord(data);
  const accepted = Number(receipt.accepted);
  const duplicates = Number(receipt.duplicates);
  if (
    !Number.isInteger(accepted)
    || !Number.isInteger(duplicates)
    || accepted < 0
    || duplicates < 0
    || accepted + duplicates !== events.length
  ) {
    throw new Error('The Sabah One product analytics receipt was invalid.');
  }
  return { accepted, duplicates };
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

const HELM_RECORD_PAGE_SIZE = 1_000;

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

async function fetchAllHelmRecordRows(
  database: SupabaseClient,
  userId: string,
  collections?: string[],
): Promise<HelmRecordRow[]> {
  const rows: HelmRecordRow[] = [];
  let offset = 0;
  let expectedCount: number | null = null;

  while (true) {
    let query = database
      .from('helm_records')
      .select(HELM_RECORD_COLUMNS, { count: 'exact' })
      .eq('user_id', userId);
    if (collections) query = query.in('collection', collections);

    const { data, error, count } = await query
      .order('collection', { ascending: true })
      .order('record_id', { ascending: true })
      .range(offset, offset + HELM_RECORD_PAGE_SIZE - 1);
    if (error) throw error;

    const page = (data || []) as unknown as HelmRecordRow[];
    if (typeof count === 'number') expectedCount = count;
    rows.push(...page);

    if (expectedCount !== null && rows.length >= expectedCount) return rows;
    if (page.length === 0) {
      if (expectedCount !== null && rows.length < expectedCount) {
        throw new Error('Sabah One could not read the complete database record set.');
      }
      return rows;
    }
    if (expectedCount === null && page.length < HELM_RECORD_PAGE_SIZE) return rows;
    offset += page.length;
  }
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
    throw new Error('The Sabah One secret response was invalid.');
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
  if (!result.secretId || !result.label) throw new Error('The Sabah One secret response was invalid.');
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
  if (!result.secretId || !result.label) throw new Error('The Sabah One secret response was invalid.');
  return result;
}

export async function fetchHelmAccountSnapshot(): Promise<{
  state: HelmAccountState;
  records: HelmRecord[];
}> {
  const database = requireClient();
  const userId = currentUserId!;
  const { data, error } = await database.rpc('get_helm_account_snapshot');
  if (error) throw error;

  const snapshot = asRecord(data);
  const state = asRecord(snapshot.state);
  if (
    state.userId !== userId
    || typeof state.schemaVersion !== 'number'
    || typeof state.accountVersion !== 'number'
    || typeof state.minimumClientVersion !== 'string'
    || typeof state.updatedAt !== 'string'
    || !Array.isArray(snapshot.records)
  ) {
    throw new Error('The Sabah One account snapshot response was invalid.');
  }

  const records = snapshot.records.map(value => {
    const record = asRecord(value);
    if (
      record.userId !== userId
      || typeof record.collection !== 'string'
      || typeof record.recordId !== 'string'
      || typeof record.revision !== 'number'
      || typeof record.accountVersion !== 'number'
      || typeof record.createdAt !== 'string'
      || typeof record.updatedAt !== 'string'
    ) {
      throw new Error('The Sabah One account snapshot contained an invalid record.');
    }
    return {
      userId,
      collection: record.collection,
      recordId: record.recordId,
      payload: asRecord(record.payload),
      position: typeof record.position === 'number' ? record.position : null,
      revision: record.revision,
      accountVersion: record.accountVersion,
      createdAt: record.createdAt,
      updatedAt: record.updatedAt,
      deletedAt: typeof record.deletedAt === 'string' ? record.deletedAt : null,
    } satisfies HelmRecord;
  });

  return {
    state: {
      userId,
      schemaVersion: state.schemaVersion,
      accountVersion: state.accountVersion,
      minimumClientVersion: state.minimumClientVersion,
      migratedAt: typeof state.migratedAt === 'string' ? state.migratedAt : null,
      updatedAt: state.updatedAt,
    },
    records,
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
  const rows = await fetchAllHelmRecordRows(
    database,
    currentUserId!,
    [...new Set(collections)],
  );
  return rows.map(mapRecord);
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
    throw new Error('At least one Sabah One mutation is required.');
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

export async function applyHelmInventoryMutations(
  requestId: string,
  operations: HelmMutation[],
): Promise<HelmMutationResult> {
  if (operations.length === 0) {
    throw new Error('At least one Sabah One Inventory mutation is required.');
  }
  const database = requireClient();
  const { data, error } = await database.rpc('apply_helm_inventory_mutations', {
    p_request_id: requestId,
    p_operations: operations,
  });
  if (error) {
    logError('Supabase', error);
    throw error;
  }
  return mapMutationResult(data, requestId);
}

export interface InventoryOAuthClientApproval {
  clientId: string;
  clientName: string;
  approvedAt: string;
  revokedAt: string | null;
}

function mapInventoryOAuthClient(value: unknown): InventoryOAuthClientApproval {
  const row = asRecord(value);
  return {
    clientId: String(row.clientId || ''),
    clientName: String(row.clientName || ''),
    approvedAt: String(row.approvedAt || ''),
    revokedAt: typeof row.revokedAt === 'string' ? row.revokedAt : null,
  };
}

export async function listInventoryOAuthClients(): Promise<InventoryOAuthClientApproval[]> {
  const database = requireClient();
  const { data, error } = await database.rpc('list_inventory_oauth_clients');
  if (error) throw error;
  return Array.isArray(data) ? data.map(mapInventoryOAuthClient) : [];
}

export async function approveInventoryOAuthClient(
  clientId: string,
  clientName: string,
): Promise<InventoryOAuthClientApproval> {
  const database = requireClient();
  const { data, error } = await database.rpc('approve_inventory_oauth_client', {
    p_client_id: clientId,
    p_client_name: clientName,
  });
  if (error) throw error;
  return mapInventoryOAuthClient(data);
}

export async function revokeInventoryOAuthClientAllowlist(
  clientId: string,
): Promise<InventoryOAuthClientApproval> {
  const database = requireClient();
  const { data, error } = await database.rpc('revoke_inventory_oauth_client', {
    p_client_id: clientId,
  });
  if (error) throw error;
  return mapInventoryOAuthClient(data);
}

export async function revokeInventoryOAuthClient(clientId: string): Promise<void> {
  const database = requireClient();
  await revokeInventoryOAuthClientAllowlist(clientId);
  const { error } = await database.auth.oauth.revokeGrant({ clientId });
  if (error) {
    throw new Error(
      `Inventory access is blocked, but Supabase could not confirm OAuth grant revocation: ${error.message}`,
    );
  }
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
      lastError: !client ? 'Supabase is not configured.' : 'No authenticated Sabah One account.',
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
