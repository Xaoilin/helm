/** Account-isolated record reads: snapshots, changed collections, version probes and pages. */
import type { SupabaseClient } from '@supabase/supabase-js';
import type { HelmAccountState, HelmRecord } from '../databaseTypes';
import { getCurrentUserId, requireClient } from './client';
import { asRecord } from './json';

const CORE_DATABASE_READ_TIMEOUT_MS = 10_000;

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

export function mapRecord(row: HelmRecordRow): HelmRecord {
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
      .range(offset, offset + HELM_RECORD_PAGE_SIZE - 1)
      .abortSignal(AbortSignal.timeout(CORE_DATABASE_READ_TIMEOUT_MS));
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

export async function fetchHelmAccountSnapshot(collections?: string[]): Promise<{
  state: HelmAccountState;
  records: HelmRecord[];
}> {
  const database = requireClient();
  const userId = getCurrentUserId()!;
  const requestedCollections = collections === undefined ? undefined : [...new Set(collections)];
  const query = requestedCollections === undefined
    ? database.rpc('get_helm_account_snapshot')
    : database.rpc('get_helm_account_snapshot_for_collections', { p_collections: requestedCollections });
  const { data, error } = await query
    .abortSignal(AbortSignal.timeout(CORE_DATABASE_READ_TIMEOUT_MS));
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
      || (requestedCollections !== undefined && !requestedCollections.includes(record.collection))
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
    .eq('user_id', getCurrentUserId()!)
    .abortSignal(AbortSignal.timeout(CORE_DATABASE_READ_TIMEOUT_MS))
    .maybeSingle();
  if (error) throw error;
  const row = asRecord(data);
  return typeof row.account_version === 'number' ? row.account_version : 0;
}

/** First-party invalidation metadata, including retained deletion tombstones. */
export async function fetchHelmChangedCollections(sinceVersion: number): Promise<{
  accountVersion: number;
  collections: string[];
  secretsChanged: boolean;
}> {
  const { data, error } = await requireClient().rpc('get_helm_changed_collections', {
    p_since_version: sinceVersion,
  }).abortSignal(AbortSignal.timeout(CORE_DATABASE_READ_TIMEOUT_MS));
  if (error) throw error;
  const result = asRecord(data);
  if (!Number.isSafeInteger(result.accountVersion) || (result.accountVersion as number) < sinceVersion
    || typeof result.secretsChanged !== 'boolean'
    || !Array.isArray(result.collections) || result.collections.some(key => typeof key !== 'string')) {
    throw new Error('The Sabah One changed collections response was invalid.');
  }
  return { accountVersion: result.accountVersion as number, collections: [...new Set(result.collections as string[])], secretsChanged: result.secretsChanged };
}

export async function fetchHelmCollections(collections: string[]): Promise<HelmRecord[]> {
  if (collections.length === 0) return [];
  const database = requireClient();
  const rows = await fetchAllHelmRecordRows(
    database,
    getCurrentUserId()!,
    [...new Set(collections)],
  );
  return rows.map(mapRecord);
}

