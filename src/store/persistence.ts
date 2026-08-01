import { invoke } from '@tauri-apps/api/core';
import { v4 as uuid } from 'uuid';
import { APP_VERSION } from '../config/release';
import { logWarn } from '../services/logger';
import {
  PROJECT_DEVICE_BINDINGS_STORE_KEY,
  PROJECT_PENDING_LEGACY_PATHS_STORE_KEY,
  migrateLegacyProjectDeviceBindings,
  normalizePendingLegacyProjectPaths,
  normalizeProjectDeviceBindings,
  normalizeProjectRecords,
  serializeSharedProjects,
} from './projectPersistence';
import {
  applyHelmMutations,
  fetchHelmAccountSnapshot,
  fetchHelmCollections,
  getCurrentUserId,
  getSupabaseRealtimeSnapshot,
  isAuthenticated,
  isSupabaseReady,
  probeHelmAccountVersion,
  subscribeHelmBroadcast,
  subscribeSupabaseRealtimeSnapshot,
  type SupabaseRealtimeSnapshot,
} from './supabase';
import { SHARED_STORE_KEYS } from './storeKeys';
import type { HelmMutation, HelmRecord, HelmSecretRealtimeEvent, SyncSessionStatus } from './databaseTypes';
import { HELM_DATABASE_SCHEMA_VERSION } from './databaseTypes';
import {
  decodeStoreValue,
  encodeStoreValue,
  mergeLegacyStoreValue,
  sanitizeLegacyStoreValue,
  splitSettings,
  type DeviceSettings,
  type EncodedStoreRecord,
} from './recordCodec';

const NAMESPACE = 'helm';
const META_PREFIX = `${NAMESPACE}:meta:`;
export const DEVICE_SETTINGS_STORE_KEY = 'deviceSettings';
export const CALENDAR_SYNC_REQUEST_EVENT = 'helm:calendar-sync-requested';

const DEVICE_STORE_KEYS = new Set<string>([
  PROJECT_DEVICE_BINDINGS_STORE_KEY,
  PROJECT_PENDING_LEGACY_PATHS_STORE_KEY,
  DEVICE_SETTINGS_STORE_KEY,
]);

type DeviceStoreKey =
  | typeof PROJECT_DEVICE_BINDINGS_STORE_KEY
  | typeof PROJECT_PENDING_LEGACY_PATHS_STORE_KEY
  | typeof DEVICE_SETTINGS_STORE_KEY;

export interface RemoteStoreChange {
  event: 'REMOTE_REFRESH' | 'RECONNECT';
  namespace: string;
  key: string;
  updatedAt: string | null;
  value: unknown;
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

export interface SyncSessionSnapshot {
  status: SyncSessionStatus;
  userId: string | null;
  accountVersion: number;
  hasUsableSnapshot: boolean;
  readOnly: boolean;
  reason: SyncSessionReason;
  lastReadyAt: string | null;
  lastProbeAt: string | null;
  error: string | null;
}

export type SyncSessionReason =
  | 'signed_out'
  | 'configuration'
  | 'switching_account'
  | 'offline'
  | 'database_unavailable'
  | 'realtime_unavailable'
  | 'incompatible_schema'
  | 'client_update_required'
  | null;

export interface PersistenceHealthSnapshot {
  mode: 'database' | 'read-only' | 'blocked';
  syncSession: SyncSessionSnapshot;
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
  lastCalendarCacheCleanupAt: string | null;
  lastCalendarCacheCleanupReason: string | null;
  lastCalendarSyncRequestAt: string | null;
  lastCalendarSyncRequestReason: string | null;
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

let tauriAvailable: boolean | null = null;
let accountVersion = 0;
let bootstrappedUserId: string | null = null;
let bootstrapPromise: Promise<void> | null = null;
let broadcastUnsubscribe: (() => void) | null = null;
let broadcastSubscriptionEpoch: number | null = null;
let broadcastSubscriptionUserId: string | null = null;
let broadcastStartPromise: Promise<void> | null = null;
let lifecycleRegistered = false;
let realtimeHealthRegistered = false;
let flushPromise: Promise<void> | null = null;
let flushPromiseEpoch: number | null = null;
let flushScheduled = false;
let persistenceEpoch = 0;
let refreshPromise: Promise<void> | null = null;
let refreshQueued = false;
let refreshNeedsSnapshot = false;
let refreshNeedsRealtime = false;
const refreshNeedsCollections = new Set<string>();
let refreshTargetVersion = 0;
let refreshActiveSnapshot = false;
let refreshActiveRealtime = false;
let refreshActiveTargetVersion = 0;
let recoveryTimer: ReturnType<typeof globalThis.setTimeout> | null = null;
let recoveryAttempt = 0;

const recordsByCollection = new Map<string, Map<string, HelmRecord>>();
// Snapshot last delivered to mounted providers. Diffs are calculated against
// this view, not a newer Broadcast-refreshed cache, so an unrelated concurrent
// addition or field patch can never be mistaken for a local deletion/revert.
const deliveredRecordsByCollection = new Map<string, Map<string, EncodedStoreRecord>>();
const pendingStoreValues = new Map<string, unknown>();
const persistenceHealthSubscribers = new Set<(snapshot: PersistenceHealthSnapshot) => void>();
const syncSessionSubscribers = new Set<(snapshot: SyncSessionSnapshot) => void>();
const storeChangeSubscribers = new Set<(change: RemoteStoreChange) => void>();
const secretChangeSubscribers = new Set<(event: HelmSecretRealtimeEvent) => void>();

let syncSession: SyncSessionSnapshot = {
  status: 'blocked',
  userId: null,
  accountVersion: 0,
  hasUsableSnapshot: false,
  readOnly: true,
  reason: 'signed_out',
  lastReadyAt: null,
  lastProbeAt: null,
  error: 'Sign in to load HELM data.',
};
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
let lastLocalWriteAt: string | null = null;
let lastLocalWriteKey: string | null = null;
let lastLocalWriteError: string | null = null;
let lastRemoteReadAt: string | null = null;
let lastRemoteReadKey: string | null = null;
let lastRemoteReadError: string | null = null;
let lastRemoteWriteAt: string | null = null;
let lastRemoteWriteKey: string | null = null;
let lastRemoteWriteError: string | null = null;
let lastCalendarCacheCleanupAt: string | null = null;
let lastCalendarCacheCleanupReason: string | null = null;
let lastCalendarSyncRequestAt: string | null = null;
let lastCalendarSyncRequestReason: string | null = null;

class StalePersistenceSessionError extends Error {
  constructor() {
    super('The HELM account changed while database work was in flight.');
    this.name = 'StalePersistenceSessionError';
  }
}

class SyncCompatibilityError extends Error {
  readonly reason: Extract<SyncSessionReason, 'incompatible_schema' | 'client_update_required'>;

  constructor(
    reason: Extract<SyncSessionReason, 'incompatible_schema' | 'client_update_required'>,
    message: string,
  ) {
    super(message);
    this.name = 'SyncCompatibilityError';
    this.reason = reason;
  }
}

function isCurrentPersistenceSession(epoch: number, userId: string): boolean {
  return epoch === persistenceEpoch
    && getCurrentUserId() === userId
    && bootstrappedUserId === userId;
}

function assertCurrentPersistenceSession(epoch: number, userId: string): void {
  if (!isCurrentPersistenceSession(epoch, userId)) throw new StalePersistenceSessionError();
}

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

function getDataKey(key: string): string {
  return `${NAMESPACE}:${key}`;
}

function getMetaKey(key: string): string {
  return `${META_PREFIX}${key}`;
}

function getDeviceDataKey(key: string): string {
  return `${NAMESPACE}:device:${key}`;
}

function getDeviceTauriKey(key: string): string {
  return `device-${key}`;
}

function assertSharedStoreKeyIsNotDeviceOnly(key: string): void {
  if (DEVICE_STORE_KEYS.has(key)) {
    throw new Error(`${key} is device-only. Use loadDeviceStore/saveDeviceStore.`);
  }
}

async function prepareSharedStoreValue(key: string, value: unknown): Promise<unknown> {
  if (key !== 'projects') return value;
  const now = new Date().toISOString();
  const projects = normalizeProjectRecords(value, now);
  const [storedBindings, storedPendingPaths] = await Promise.all([
    loadDeviceStore<unknown>(PROJECT_DEVICE_BINDINGS_STORE_KEY),
    loadDeviceStore<unknown>(PROJECT_PENDING_LEGACY_PATHS_STORE_KEY),
  ]);
  const existingBindings = normalizeProjectDeviceBindings(storedBindings, now);
  const existingPendingPaths = normalizePendingLegacyProjectPaths(storedPendingPaths, now);
  const migration = await migrateLegacyProjectDeviceBindings(
    value,
    projects,
    existingBindings,
    existingPendingPaths,
    async projectRoot => {
      if (!(await isTauri())) return null;
      try {
        const canonicalRoot = await invoke<string>('canonicalize_project_path', { path: projectRoot });
        return typeof canonicalRoot === 'string' && canonicalRoot.trim() ? canonicalRoot.trim() : null;
      } catch {
        return null;
      }
    },
    now,
  );
  if (JSON.stringify(existingBindings) !== JSON.stringify(migration.bindings)) {
    await saveDeviceStore(PROJECT_DEVICE_BINDINGS_STORE_KEY, migration.bindings);
  }
  if (JSON.stringify(existingPendingPaths) !== JSON.stringify(migration.pendingPaths)) {
    await saveDeviceStore(PROJECT_PENDING_LEGACY_PATHS_STORE_KEY, migration.pendingPaths);
  }
  return serializeSharedProjects(projects);
}

function publishSyncSession(patch: Partial<SyncSessionSnapshot>): void {
  syncSession = { ...syncSession, ...patch };
  const snapshot = { ...syncSession };
  syncSessionSubscribers.forEach(listener => listener(snapshot));
  notifyPersistenceHealthSubscribers();
}

function hasUsableSnapshotFor(userId: string): boolean {
  return syncSession.hasUsableSnapshot
    && syncSession.userId === userId
    && bootstrappedUserId === userId;
}

function clearRecoveryTimer(): void {
  if (recoveryTimer !== null) globalThis.clearTimeout(recoveryTimer);
  recoveryTimer = null;
}

function publishReady(userId: string): void {
  clearRecoveryTimer();
  recoveryAttempt = 0;
  publishSyncSession({
    status: 'ready',
    userId,
    accountVersion,
    hasUsableSnapshot: true,
    readOnly: false,
    reason: null,
    lastReadyAt: new Date().toISOString(),
    error: null,
  });
}

function publishDegraded(
  userId: string,
  reason: Exclude<SyncSessionReason, 'signed_out' | 'configuration' | 'switching_account' | null>,
  error: string,
): void {
  const usable = hasUsableSnapshotFor(userId);
  const fatal = reason === 'incompatible_schema' || reason === 'client_update_required';
  publishSyncSession({
    status: usable && !fatal ? 'reconnecting' : 'blocked',
    userId,
    accountVersion,
    hasUsableSnapshot: usable,
    readOnly: true,
    reason,
    error,
  });
}

function publishStoreChanges(
  keys: Iterable<string>,
  event: RemoteStoreChange['event'] = 'REMOTE_REFRESH',
): void {
  const updatedAt = new Date().toISOString();
  for (const key of new Set(keys)) {
    const change: RemoteStoreChange = {
      event,
      namespace: NAMESPACE,
      key,
      updatedAt,
      value: null,
    };
    storeChangeSubscribers.forEach(listener => listener(change));
  }
}

function publishWriteQueue(patch: Partial<SupabaseWriteQueueSnapshot> = {}): void {
  writeQueueSnapshot = {
    ...writeQueueSnapshot,
    ...patch,
    queuedCount: pendingStoreValues.size + (flushPromise ? 1 : 0),
    queuedKeys: [...pendingStoreValues.keys()].sort(),
  };
  notifyPersistenceHealthSubscribers();
}

function stableValue(value: unknown): unknown {
  if (Array.isArray(value)) return value.map(stableValue);
  if (value && typeof value === 'object') {
    return Object.fromEntries(Object.entries(value as Record<string, unknown>)
      .sort(([a], [b]) => a.localeCompare(b))
      .map(([key, entry]) => [key, stableValue(entry)]));
  }
  return value;
}

function valuesEqual(a: unknown, b: unknown): boolean {
  return JSON.stringify(stableValue(a)) === JSON.stringify(stableValue(b));
}

function replaceAllRecordCache(records: HelmRecord[]): void {
  recordsByCollection.clear();
  for (const record of records) putRecordCache(record);
}

function putRecordCache(record: HelmRecord): void {
  let collection = recordsByCollection.get(record.collection);
  if (!collection) {
    collection = new Map();
    recordsByCollection.set(record.collection, collection);
  }
  collection.set(record.recordId, record);
}

function replaceCollectionCache(collection: string, records: HelmRecord[]): void {
  recordsByCollection.delete(collection);
  for (const record of records) putRecordCache(record);
}

function encodedCache(collection: string): EncodedStoreRecord[] {
  return [...(recordsByCollection.get(collection)?.values() || [])]
    .filter(record => record.deletedAt === null)
    .map(record => ({
      recordId: record.recordId,
      payload: record.payload,
      position: record.position,
    }));
}

function copyEncodedRecords(records: EncodedStoreRecord[]): Map<string, EncodedStoreRecord> {
  return new Map(records.map(record => [record.recordId, {
    recordId: record.recordId,
    payload: structuredClone(record.payload),
    position: record.position,
  }]));
}

function decodedCache(collection: string): unknown {
  return decodeStoreValue(collection, encodedCache(collection));
}

function patchForPayload(
  collection: string,
  recordId: string,
  before: Record<string, unknown>,
  after: Record<string, unknown>,
): HelmMutation[] {
  const set: Record<string, unknown> = {};
  const unset: string[] = [];
  const mutations: HelmMutation[] = [];
  for (const [key, value] of Object.entries(after)) {
    if (valuesEqual(before[key], value)) continue;
    if (
      isAtomicCounter(collection, recordId, key)
      && typeof before[key] === 'number'
      && typeof value === 'number'
      && value !== before[key]
    ) {
      mutations.push({
        op: 'increment',
        collection,
        recordId,
        field: key,
        amount: value - before[key],
      });
    } else {
      set[key] = value;
    }
  }
  for (const key of Object.keys(before)) {
    if (!(key in after)) unset.push(key);
  }
  if (Object.keys(set).length > 0 || unset.length > 0) {
    mutations.unshift({ op: 'patch', collection, recordId, set, unset });
  }
  return mutations;
}

function isAtomicCounter(collection: string, recordId: string, field: string): boolean {
  return (
    collection === 'gamification'
    && (
      (recordId === 'profile' && (field === 'totalXp' || field === 'totalTasksCompleted'))
      || (recordId.startsWith('habit:') && field === 'count')
    )
  ) || (collection === 'assistantCorrections' && field === 'appliedCount');
}

function buildStoreMutations(collection: string, desiredValue: unknown): HelmMutation[] {
  const currentRecords = encodedCache(collection);
  const delivered = deliveredRecordsByCollection.get(collection) ?? copyEncodedRecords(currentRecords);
  const desiredRecords = encodeStoreValue(collection, desiredValue);
  const desired = new Map(desiredRecords.map(record => [record.recordId, record]));
  const operations: HelmMutation[] = [];

  for (const record of desiredRecords) {
    const existing = delivered.get(record.recordId);
    if (!existing) {
      const tombstone = recordsByCollection.get(collection)?.get(record.recordId);
      if (tombstone?.deletedAt) {
        operations.push({ op: 'restore', collection, recordId: record.recordId });
        operations.push(...patchForPayload(
          collection,
          record.recordId,
          tombstone.payload,
          record.payload,
        ));
      } else {
        operations.push({
          op: 'create',
          collection,
          recordId: record.recordId,
          payload: record.payload,
          position: record.position,
        });
      }
      continue;
    }
    operations.push(...patchForPayload(collection, record.recordId, existing.payload, record.payload));
  }

  for (const record of delivered.values()) {
    if (!desired.has(record.recordId)) {
      operations.push({ op: 'delete', collection, recordId: record.recordId });
    }
  }

  const currentOrder = [...delivered.values()]
    .filter(record => record.position !== null)
    .sort((a, b) => (a.position ?? 0) - (b.position ?? 0))
    .map(record => record.recordId);
  const desiredOrder = desiredRecords
    .filter(record => record.position !== null)
    .sort((a, b) => (a.position ?? 0) - (b.position ?? 0))
    .map(record => record.recordId);
  if (!valuesEqual(currentOrder, desiredOrder) && desiredOrder.length > 0) {
    operations.push({ op: 'reorder', collection, orderedRecordIds: desiredOrder });
  }
  return operations;
}

function applyMutationResult(records: HelmRecord[], version: number): void {
  for (const record of records) putRecordCache(record);
  accountVersion = Math.max(accountVersion, version);
  publishSyncSession({ accountVersion });
}

async function applyWithIdempotentRetry(requestId: string, operations: HelmMutation[]) {
  try {
    return await applyHelmMutations(requestId, operations);
  } catch (firstError) {
    if (!shouldRetryMutation(firstError)) throw firstError;
    return applyHelmMutations(requestId, operations);
  }
}

function shouldRetryMutation(error: unknown): boolean {
  if (typeof navigator !== 'undefined' && navigator.onLine === false) return false;
  const candidate = error as { status?: unknown; code?: unknown; message?: unknown };
  const status = typeof candidate?.status === 'number' ? candidate.status : null;
  if (status === 408 || status === 429 || (status !== null && status >= 500)) return true;
  const message = String(candidate?.message || error || '').toLowerCase();
  return /fetch|network|socket|timeout|timed out|connection|econnreset/.test(message);
}

async function commitStoreValues(
  values: Map<string, unknown>,
  epoch = persistenceEpoch,
  userId = getCurrentUserId(),
): Promise<string[]> {
  if (!userId) throw new StalePersistenceSessionError();
  assertCurrentPersistenceSession(epoch, userId);
  const operations = [...values.entries()].flatMap(([collection, value]) => buildStoreMutations(collection, value));
  if (operations.length === 0) return [];
  const requestId = uuid();
  const result = await applyWithIdempotentRetry(requestId, operations);
  assertCurrentPersistenceSession(epoch, userId);
  applyMutationResult(result.changes, result.accountVersion);
  for (const [collection, value] of values) {
    deliveredRecordsByCollection.set(collection, copyEncodedRecords(encodeStoreValue(collection, value)));
  }
  return [...new Set(operations.map(operation => operation.collection))];
}

async function flushPendingStores(): Promise<void> {
  const epoch = persistenceEpoch;
  const userId = getCurrentUserId();
  if (!userId) return;
  if (flushPromise && flushPromiseEpoch === epoch) return flushPromise;
  const operation = (async () => {
    while (pendingStoreValues.size > 0 && isCurrentPersistenceSession(epoch, userId)) {
      const batch = new Map(pendingStoreValues);
      pendingStoreValues.clear();
      const keys = [...batch.keys()].sort();
      publishWriteQueue({
        lastFlushStartedAt: new Date().toISOString(),
        lastFlushKeys: keys,
        lastFlushError: null,
      });
      try {
        const changedCollections = await commitStoreValues(batch, epoch, userId);
        const completedAt = new Date().toISOString();
        lastRemoteWriteAt = completedAt;
        lastRemoteWriteKey = changedCollections.at(-1) ?? keys.at(-1) ?? null;
        lastRemoteWriteError = null;
        publishWriteQueue({
          lastFlushSuccessAt: completedAt,
          lastFlushError: null,
          lastFailureKeys: [],
        });
      } catch (error) {
        if (error instanceof StalePersistenceSessionError) break;
        const message = error instanceof Error ? error.message : String(error);
        lastRemoteWriteError = message;
        publishWriteQueue({
          lastFlushFailureAt: new Date().toISOString(),
          lastFlushError: message,
          lastFailureKeys: keys,
        });
        publishDegraded(
          userId,
          typeof navigator !== 'undefined' && navigator.onLine === false ? 'offline' : 'database_unavailable',
          `Database write failed: ${message}`,
        );
        publishStoreChanges(keys, 'RECONNECT');
        if (typeof navigator === 'undefined' || navigator.onLine !== false) {
          await refreshDatabasePersistence();
        }
        break;
      }
    }
  })().finally(() => {
    if (flushPromise === operation) {
      flushPromise = null;
      flushPromiseEpoch = null;
      publishWriteQueue();
    }
  });
  flushPromise = operation;
  flushPromiseEpoch = epoch;
  return operation;
}

function scheduleFlush(): void {
  if (flushScheduled) return;
  flushScheduled = true;
  const epoch = persistenceEpoch;
  queueMicrotask(() => {
    flushScheduled = false;
    if (epoch === persistenceEpoch) void flushPendingStores();
  });
}

export async function flushPendingRemoteMutations(): Promise<void> {
  await flushPendingStores();
}

async function readTauriRaw(key: string): Promise<string | null> {
  try {
    if (!(await isTauri())) return null;
    return await invoke<string>('read_store', { key });
  } catch {
    return null;
  }
}

function localRawSnapshot(raw: string | null): { hasValue: boolean; value: unknown; parseError: boolean; sizeBytes: number } {
  if (raw === null) return { hasValue: false, value: null, parseError: false, sizeBytes: 0 };
  try {
    return { hasValue: true, value: JSON.parse(raw), parseError: false, sizeBytes: new Blob([raw]).size };
  } catch {
    return { hasValue: false, value: raw, parseError: true, sizeBytes: new Blob([raw]).size };
  }
}

async function readLegacyLocalValue(key: string): Promise<{
  raw: string | null;
  value: unknown;
  hasValue: boolean;
  parseError: boolean;
  source: 'localStorage' | 'tauri' | null;
}> {
  const browserRaw = localStorage.getItem(getDataKey(key));
  const browser = localRawSnapshot(browserRaw);
  if (browser.hasValue || browser.parseError) return { ...browser, raw: browserRaw, source: 'localStorage' };
  const tauriRaw = await readTauriRaw(key);
  const tauri = localRawSnapshot(tauriRaw);
  return { ...tauri, raw: tauriRaw, source: tauri.hasValue || tauri.parseError ? 'tauri' : null };
}

function quarantineLegacyValue(key: string, raw: string): void {
  const quarantineKey = `${NAMESPACE}:device:legacy-quarantine:${key}:${Date.now()}`;
  localStorage.setItem(quarantineKey, raw);
}

async function migrateLegacyLocalCopies(epoch: number, userId: string): Promise<string[]> {
  assertCurrentPersistenceSession(epoch, userId);
  const desired = new Map<string, unknown>();
  const keysToClear: string[] = [];
  let deviceSettings = await loadDeviceStore<DeviceSettings>(DEVICE_SETTINGS_STORE_KEY) ?? {};
  let deviceSettingsChanged = false;

  for (const item of SHARED_STORE_KEYS) {
    const legacy = await readLegacyLocalValue(item.key);
    assertCurrentPersistenceSession(epoch, userId);
    if (!legacy.source) continue;
    if (legacy.parseError) {
      quarantineLegacyValue(item.key, legacy.raw || '');
      keysToClear.push(item.key);
      continue;
    }
    const inspectedLegacy = sanitizeLegacyStoreValue(item.key, legacy.value);
    if (inspectedLegacy.ambiguous && legacy.raw !== null) {
      quarantineLegacyValue(item.key, legacy.raw);
    }
    if (item.key === 'settings') {
      const split = splitSettings(inspectedLegacy.value);
      if (Object.keys(split.device).length > 0) {
        deviceSettings = { ...split.device, ...deviceSettings };
        deviceSettingsChanged = true;
      }
    }
    const databaseValue = decodedCache(item.key);
    const merged = await prepareSharedStoreValue(
      item.key,
      mergeLegacyStoreValue(item.key, databaseValue, inspectedLegacy.value),
    );
    assertCurrentPersistenceSession(epoch, userId);
    if (!valuesEqual(databaseValue, merged)) desired.set(item.key, merged);
    keysToClear.push(item.key);
  }

  if (deviceSettingsChanged) {
    assertCurrentPersistenceSession(epoch, userId);
    await saveDeviceStore(DEVICE_SETTINGS_STORE_KEY, deviceSettings);
    assertCurrentPersistenceSession(epoch, userId);
  }
  const changedCollections = desired.size > 0
    ? await commitStoreValues(desired, epoch, userId)
    : [];
  for (const key of keysToClear) {
    assertCurrentPersistenceSession(epoch, userId);
    await clearLocalStoreCopy(key, false);
  }
  if (keysToClear.some(key => key.startsWith('calendar'))) {
    requestCalendarProviderRefresh('legacy_database_cutover');
  }
  if (keysToClear.length > 0) {
    lastCalendarCacheCleanupAt = new Date().toISOString();
    lastCalendarCacheCleanupReason = 'Legacy shared copies retired after database verification.';
  }
  return changedCollections;
}

function versionParts(value: string): number[] {
  return value.replace(/^v/, '').split('.').map(part => Number.parseInt(part, 10) || 0);
}

function versionAtLeast(actual: string, minimum: string): boolean {
  const left = versionParts(actual);
  const right = versionParts(minimum);
  for (let index = 0; index < Math.max(left.length, right.length); index += 1) {
    if ((left[index] || 0) > (right[index] || 0)) return true;
    if ((left[index] || 0) < (right[index] || 0)) return false;
  }
  return true;
}

async function hydrateDatabaseSnapshot(epoch: number, userId: string): Promise<string[]> {
  const snapshot = await fetchHelmAccountSnapshot();
  assertCurrentPersistenceSession(epoch, userId);
  if (snapshot.state.schemaVersion !== HELM_DATABASE_SCHEMA_VERSION) {
    throw new SyncCompatibilityError(
      'incompatible_schema',
      `HELM database schema ${snapshot.state.schemaVersion} is not supported by this client.`,
    );
  }
  if (!versionAtLeast(APP_VERSION, snapshot.state.minimumClientVersion)) {
    throw new SyncCompatibilityError(
      'client_update_required',
      `Update HELM to ${snapshot.state.minimumClientVersion} or later.`,
    );
  }
  if (snapshot.state.accountVersion < accountVersion) return [];
  const collectionKeys = new Set([
    ...SHARED_STORE_KEYS.map(item => item.key),
    ...recordsByCollection.keys(),
    ...snapshot.records.map(record => record.collection),
  ]);
  const previousValues = new Map(
    [...collectionKeys].map(collection => [collection, decodedCache(collection)]),
  );
  replaceAllRecordCache(snapshot.records);
  accountVersion = snapshot.state.accountVersion;
  lastRemoteReadAt = new Date().toISOString();
  lastRemoteReadKey = 'account';
  lastRemoteReadError = null;
  return [...collectionKeys].filter(collection => (
    !valuesEqual(previousValues.get(collection), decodedCache(collection))
  ));
}

async function refreshCollectionsFromBroadcast(
  collections: string[],
  nextVersion: number,
  epoch: number,
  userId: string,
): Promise<string[]> {
  assertCurrentPersistenceSession(epoch, userId);
  let changedCollections = collections;
  if (nextVersion > accountVersion + 1 || collections.length === 0) {
    changedCollections = await hydrateDatabaseSnapshot(epoch, userId);
  } else {
    const records = await fetchHelmCollections(collections);
    assertCurrentPersistenceSession(epoch, userId);
    for (const collection of collections) {
      replaceCollectionCache(collection, records.filter(record => record.collection === collection));
    }
    accountVersion = Math.max(accountVersion, nextVersion);
    lastRemoteReadAt = new Date().toISOString();
    lastRemoteReadKey = collections.at(-1) ?? 'account';
    lastRemoteReadError = null;
  }
  return changedCollections;
}

function waitForBroadcastReady(epoch: number, userId: string): Promise<void> {
  const current = getSupabaseRealtimeSnapshot();
  if (current.state === 'subscribed') return Promise.resolve();
  return new Promise((resolve, reject) => {
    let settled = false;
    let unsubscribe = () => {};
    const finish = (error?: Error) => {
      if (settled) return;
      settled = true;
      globalThis.clearTimeout(timeout);
      unsubscribe();
      if (error) reject(error);
      else resolve();
    };
    const timeout = globalThis.setTimeout(() => {
      finish(new Error('The private HELM database update channel did not become ready.'));
    }, 10_000);
    const removeSubscription = subscribeSupabaseRealtimeSnapshot(snapshot => {
      if (!isCurrentPersistenceSession(epoch, userId)) {
        finish(new StalePersistenceSessionError());
      } else if (snapshot.state === 'subscribed') {
        finish();
      } else if (snapshot.state === 'error' || snapshot.state === 'timed_out' || snapshot.state === 'closed') {
        finish(new Error(snapshot.lastError || `The private HELM update channel is ${snapshot.state}.`));
      }
    });
    unsubscribe = removeSubscription;
    if (settled) unsubscribe();
  });
}

interface DatabaseRefreshRequest {
  collections?: string[];
  snapshot?: boolean;
  realtime?: boolean;
  targetVersion?: number;
}

function reasonForDatabaseError(error: unknown): Exclude<SyncSessionReason, 'signed_out' | 'configuration' | 'switching_account' | null> {
  if (error instanceof SyncCompatibilityError) return error.reason;
  if (typeof navigator !== 'undefined' && navigator.onLine === false) return 'offline';
  return 'database_unavailable';
}

function scheduleRecovery(request: DatabaseRefreshRequest = { snapshot: true, realtime: true }): void {
  if (
    recoveryTimer !== null
    || !isAuthenticated()
    || !getCurrentUserId()
    || syncSession.reason === 'incompatible_schema'
    || syncSession.reason === 'client_update_required'
    || (typeof navigator !== 'undefined' && navigator.onLine === false)
  ) return;
  const delay = Math.min(1_000 * (2 ** recoveryAttempt), 30_000);
  recoveryAttempt += 1;
  recoveryTimer = globalThis.setTimeout(() => {
    recoveryTimer = null;
    void requestDatabaseRefresh(request);
  }, delay);
}

function handleDatabaseFailure(error: unknown, userId: string): void {
  if (error instanceof StalePersistenceSessionError) return;
  const message = error instanceof Error ? error.message : String(error);
  lastRemoteReadError = message;
  const reason = reasonForDatabaseError(error);
  publishDegraded(userId, reason, message);
  if (reason !== 'incompatible_schema' && reason !== 'client_update_required') {
    scheduleRecovery({ snapshot: true, realtime: true });
  }
}

async function ensureBroadcastSubscription(epoch: number, userId: string): Promise<void> {
  assertCurrentPersistenceSession(epoch, userId);
  const current = getSupabaseRealtimeSnapshot();
  if (
    broadcastUnsubscribe
    && broadcastSubscriptionEpoch === epoch
    && broadcastSubscriptionUserId === userId
    && current.state === 'subscribed'
  ) return;
  if (
    broadcastStartPromise
    && broadcastSubscriptionEpoch === epoch
    && broadcastSubscriptionUserId === userId
  ) return broadcastStartPromise;

  broadcastUnsubscribe?.();
  broadcastSubscriptionEpoch = epoch;
  broadcastSubscriptionUserId = userId;
  broadcastUnsubscribe = subscribeHelmBroadcast(event => {
    if (!isCurrentPersistenceSession(epoch, userId)) return;
    const collections = [...new Set(event.changes.map(change => change.collection))];
    void requestDatabaseRefresh({
      collections,
      snapshot: collections.length === 0,
      targetVersion: event.accountVersion,
    });
  }, event => {
    if (!isCurrentPersistenceSession(epoch, userId)) return;
    void requestDatabaseRefresh({ targetVersion: event.accountVersion }).then(() => {
      secretChangeSubscribers.forEach(listener => listener(event));
    });
  });
  const operation = waitForBroadcastReady(epoch, userId).finally(() => {
    if (broadcastStartPromise === operation) broadcastStartPromise = null;
  });
  broadcastStartPromise = operation;
  return operation;
}

function registerLifecycleHandlers(): void {
  if (lifecycleRegistered || typeof window === 'undefined') return;
  lifecycleRegistered = true;
  window.addEventListener('offline', () => {
    const userId = getCurrentUserId();
    if (userId) publishDegraded(userId, 'offline', 'The browser is offline.');
  });
  window.addEventListener('online', () => {
    if (!isAuthenticated()) return;
    clearRecoveryTimer();
    void requestDatabaseRefresh({ realtime: true });
  });
  document.addEventListener('visibilitychange', () => {
    if (document.visibilityState === 'visible' && isAuthenticated()) {
      void requestDatabaseRefresh();
    }
  });
  window.setInterval(() => {
    const userId = getCurrentUserId();
    if (!userId || !hasUsableSnapshotFor(userId) || syncSession.readOnly) return;
    void requestDatabaseRefresh();
  }, 15_000);
}

function registerRealtimeHealth(): void {
  if (realtimeHealthRegistered) return;
  realtimeHealthRegistered = true;
  subscribeSupabaseRealtimeSnapshot(snapshot => {
    notifyPersistenceHealthSubscribers();
    if (
      syncSession.hasUsableSnapshot
      && (snapshot.state === 'closed' || snapshot.state === 'error' || snapshot.state === 'timed_out')
    ) {
      const userId = getCurrentUserId();
      if (!userId) return;
      publishDegraded(
        userId,
        'realtime_unavailable',
        snapshot.lastError || `The private database update channel is ${snapshot.state}.`,
      );
      scheduleRecovery({ realtime: true });
    }
  });
}

export async function bootstrapDatabasePersistence(): Promise<void> {
  const userId = getCurrentUserId();
  if (!isSupabaseReady() || !isAuthenticated() || !userId) {
    resetDatabasePersistence(
      isSupabaseReady() ? 'Sign in to load HELM data.' : 'HELM database configuration is unavailable.',
      isSupabaseReady() ? 'signed_out' : 'configuration',
    );
    return;
  }
  if (bootstrapPromise && bootstrappedUserId === userId) return bootstrapPromise;

  if (bootstrappedUserId !== userId || (syncSession.userId && syncSession.userId !== userId)) {
    resetDatabasePersistence('Switching HELM accounts.', 'switching_account');
  } else if (hasUsableSnapshotFor(userId)) {
    await requestDatabaseRefresh({ realtime: true });
    return;
  }
  bootstrappedUserId = userId;
  const epoch = ++persistenceEpoch;
  publishSyncSession({
    status: 'bootstrapping',
    userId,
    accountVersion: 0,
    hasUsableSnapshot: false,
    readOnly: true,
    reason: null,
    error: null,
    lastProbeAt: new Date().toISOString(),
  });
  const operation: Promise<void> = (async () => {
    registerLifecycleHandlers();
    registerRealtimeHealth();
    if (typeof navigator !== 'undefined' && navigator.onLine === false) {
      publishDegraded(userId, 'offline', 'The browser is offline.');
      return;
    }
    const changedCollections = await hydrateDatabaseSnapshot(epoch, userId);
    publishSyncSession({
      status: 'reconnecting',
      userId,
      accountVersion,
      hasUsableSnapshot: true,
      readOnly: true,
      reason: null,
      error: null,
    });
    publishStoreChanges(await migrateLegacyLocalCopies(epoch, userId));
    await ensureBroadcastSubscription(epoch, userId);
    const latestVersion = await probeHelmAccountVersion();
    assertCurrentPersistenceSession(epoch, userId);
    publishSyncSession({ lastProbeAt: new Date().toISOString() });
    if (latestVersion > accountVersion) {
      changedCollections.push(...await hydrateDatabaseSnapshot(epoch, userId));
    }
    assertCurrentPersistenceSession(epoch, userId);
    publishReady(userId);
    publishStoreChanges(changedCollections);
  })().catch(error => {
    handleDatabaseFailure(error, userId);
  }).finally(() => {
    if (bootstrapPromise === operation) bootstrapPromise = null;
  });
  bootstrapPromise = operation;
  return operation;
}

function requestDatabaseRefresh(request: DatabaseRefreshRequest = {}): Promise<void> {
  const userId = getCurrentUserId();
  if (!userId || !isAuthenticated()) {
    resetDatabasePersistence('Sign in to load HELM data.', 'signed_out');
    return Promise.resolve();
  }
  if (typeof navigator !== 'undefined' && navigator.onLine === false) {
    publishDegraded(userId, 'offline', 'The browser is offline.');
    return Promise.resolve();
  }
  if (bootstrappedUserId !== userId) {
    return bootstrapDatabasePersistence();
  }
  if (refreshPromise) {
    const needsFollowUpSnapshot = request.snapshot === true && !refreshActiveSnapshot;
    const needsFollowUpRealtime = request.realtime === true && !refreshActiveRealtime;
    const requestedVersion = request.targetVersion ?? 0;
    const needsFollowUpVersion = requestedVersion > Math.max(
      accountVersion,
      refreshActiveTargetVersion,
      refreshTargetVersion,
    );
    if (needsFollowUpSnapshot || needsFollowUpRealtime || needsFollowUpVersion) {
      refreshQueued = true;
      refreshNeedsSnapshot ||= needsFollowUpSnapshot;
      refreshNeedsRealtime ||= needsFollowUpRealtime;
      if (needsFollowUpVersion) {
        refreshTargetVersion = requestedVersion;
        request.collections?.forEach(collection => refreshNeedsCollections.add(collection));
      }
    }
    return refreshPromise;
  }
  refreshQueued = true;
  refreshNeedsSnapshot = request.snapshot === true;
  refreshNeedsRealtime = request.realtime === true;
  refreshTargetVersion = request.targetVersion ?? 0;
  refreshNeedsCollections.clear();
  request.collections?.forEach(collection => refreshNeedsCollections.add(collection));

  const epoch = persistenceEpoch;
  const operation = (async () => {
    while (refreshQueued) {
      refreshQueued = false;
      const needsSnapshot = refreshNeedsSnapshot || !hasUsableSnapshotFor(userId);
      const requestedCollections = [...refreshNeedsCollections];
      const requestedVersion = refreshTargetVersion;
      refreshActiveSnapshot = needsSnapshot;
      refreshActiveRealtime = true;
      refreshActiveTargetVersion = requestedVersion;
      refreshNeedsSnapshot = false;
      refreshNeedsRealtime = false;
      refreshNeedsCollections.clear();
      refreshTargetVersion = 0;
      assertCurrentPersistenceSession(epoch, userId);

      const hadUsableSnapshot = hasUsableSnapshotFor(userId);
      const changedCollections: string[] = [];
      if (needsSnapshot) {
        changedCollections.push(...await hydrateDatabaseSnapshot(epoch, userId));
        if (!hadUsableSnapshot) {
          publishSyncSession({
            status: 'reconnecting',
            userId,
            accountVersion,
            hasUsableSnapshot: true,
            readOnly: true,
            reason: null,
            error: null,
          });
          publishStoreChanges(await migrateLegacyLocalCopies(epoch, userId));
        }
      } else if (requestedVersion > accountVersion) {
        if (requestedCollections.length > 0) {
          changedCollections.push(...await refreshCollectionsFromBroadcast(
            requestedCollections,
            requestedVersion,
            epoch,
            userId,
          ));
        } else if (requestedVersion > accountVersion + 1) {
          changedCollections.push(...await hydrateDatabaseSnapshot(epoch, userId));
        } else {
          accountVersion = requestedVersion;
          publishSyncSession({ accountVersion });
        }
      }

      await ensureBroadcastSubscription(epoch, userId);
      const latestVersion = await probeHelmAccountVersion();
      assertCurrentPersistenceSession(epoch, userId);
      publishSyncSession({ lastProbeAt: new Date().toISOString() });
      if (latestVersion > accountVersion) {
        changedCollections.push(...await hydrateDatabaseSnapshot(epoch, userId));
      }
      assertCurrentPersistenceSession(epoch, userId);
      publishReady(userId);
      publishStoreChanges(changedCollections, needsSnapshot ? 'RECONNECT' : 'REMOTE_REFRESH');
      refreshActiveSnapshot = false;
      refreshActiveRealtime = false;
      refreshActiveTargetVersion = 0;
    }
  })().catch(error => {
    handleDatabaseFailure(error, userId);
  }).finally(() => {
    if (refreshPromise === operation) {
      refreshPromise = null;
      refreshQueued = false;
      refreshNeedsSnapshot = false;
      refreshNeedsRealtime = false;
      refreshNeedsCollections.clear();
      refreshTargetVersion = 0;
      refreshActiveSnapshot = false;
      refreshActiveRealtime = false;
      refreshActiveTargetVersion = 0;
    }
  });
  refreshPromise = operation;
  return operation;
}

export async function refreshDatabasePersistence(): Promise<void> {
  await requestDatabaseRefresh({ snapshot: true, realtime: true });
}

export function resetDatabasePersistence(
  error = 'HELM account data is unavailable.',
  reason: Extract<SyncSessionReason, 'signed_out' | 'configuration' | 'switching_account'> = 'signed_out',
): void {
  persistenceEpoch += 1;
  clearRecoveryTimer();
  broadcastUnsubscribe?.();
  broadcastUnsubscribe = null;
  broadcastSubscriptionEpoch = null;
  broadcastSubscriptionUserId = null;
  broadcastStartPromise = null;
  recordsByCollection.clear();
  deliveredRecordsByCollection.clear();
  pendingStoreValues.clear();
  flushPromise = null;
  flushPromiseEpoch = null;
  flushScheduled = false;
  bootstrapPromise = null;
  refreshPromise = null;
  refreshQueued = false;
  refreshNeedsSnapshot = false;
  refreshNeedsRealtime = false;
  refreshNeedsCollections.clear();
  refreshTargetVersion = 0;
  refreshActiveSnapshot = false;
  refreshActiveRealtime = false;
  refreshActiveTargetVersion = 0;
  recoveryAttempt = 0;
  accountVersion = 0;
  bootstrappedUserId = null;
  publishWriteQueue();
  publishSyncSession({
    status: 'blocked',
    userId: null,
    accountVersion: 0,
    hasUsableSnapshot: false,
    readOnly: true,
    reason,
    lastReadyAt: null,
    lastProbeAt: null,
    error,
  });
}

export function getSyncSessionSnapshot(): SyncSessionSnapshot {
  return { ...syncSession };
}

export function subscribeSyncSession(listener: (snapshot: SyncSessionSnapshot) => void): () => void {
  syncSessionSubscribers.add(listener);
  listener({ ...syncSession });
  return () => syncSessionSubscribers.delete(listener);
}

export function subscribeStoreChanges(listener: (change: RemoteStoreChange) => void): () => void {
  storeChangeSubscribers.add(listener);
  return () => storeChangeSubscribers.delete(listener);
}

export function subscribeHelmSecretChanges(
  listener: (event: HelmSecretRealtimeEvent) => void,
): () => void {
  secretChangeSubscribers.add(listener);
  return () => secretChangeSubscribers.delete(listener);
}

export function subscribeStoreKey(key: string, listener: (change: RemoteStoreChange) => void): () => void {
  return subscribeStoreChanges(change => {
    if (change.key === key || change.key === '*') listener(change);
  });
}

export async function loadStore<T>(key: string): Promise<T | null> {
  assertSharedStoreKeyIsNotDeviceOnly(key);
  const userId = getCurrentUserId();
  if (!isSupabaseReady() || !isAuthenticated() || !userId || !hasUsableSnapshotFor(userId)) return null;
  try {
    const encoded = encodedCache(key);
    deliveredRecordsByCollection.set(key, copyEncodedRecords(encoded));
    const value = decodeStoreValue(key, encoded) as T | null;
    lastRemoteReadAt = new Date().toISOString();
    lastRemoteReadKey = key;
    lastRemoteReadError = null;
    notifyPersistenceHealthSubscribers();
    return value;
  } catch (error) {
    const message = error instanceof Error ? error.message : String(error);
    lastRemoteReadError = message;
    publishDegraded(userId, 'database_unavailable', message);
    return null;
  }
}

export async function saveStore<T>(key: string, value: T): Promise<void> {
  assertSharedStoreKeyIsNotDeviceOnly(key);
  if (!isSupabaseReady() || !isAuthenticated() || syncSession.status !== 'ready' || syncSession.readOnly) {
    const message = 'Shared HELM data can only be changed while the signed-in database session is ready.';
    lastRemoteWriteError = message;
    notifyPersistenceHealthSubscribers();
    return;
  }
  try {
    const sharedValue = await prepareSharedStoreValue(key, value);
    if (valuesEqual(decodedCache(key), sharedValue)) return;
    pendingStoreValues.set(key, sharedValue);
    publishWriteQueue({ lastQueuedAt: new Date().toISOString() });
    scheduleFlush();
  } catch (error) {
    const message = error instanceof Error ? error.message : String(error);
    lastRemoteWriteError = message;
    const userId = getCurrentUserId();
    if (userId) publishDegraded(userId, 'database_unavailable', message);
  }
}

export async function clearLocalStoreCopy(key: string, notify = true): Promise<void> {
  localStorage.removeItem(getDataKey(key));
  localStorage.removeItem(getMetaKey(key));
  try {
    if (await isTauri()) await invoke('delete_store', { key });
  } catch {
    logWarn('Persistence', `Tauri legacy delete failed for ${key}`);
  }
  if (notify) notifyPersistenceHealthSubscribers();
}

export async function listLocalImportCandidates(): Promise<LocalImportCandidate[]> {
  const candidates: LocalImportCandidate[] = [];
  for (const item of SHARED_STORE_KEYS) {
    const browser = localRawSnapshot(localStorage.getItem(getDataKey(item.key)));
    const tauri = localRawSnapshot(await readTauriRaw(item.key));
    if (!browser.hasValue && !browser.parseError && !tauri.hasValue && !tauri.parseError) continue;
    candidates.push({
      key: item.key,
      label: item.label,
      description: item.description,
      localStorage: browser.hasValue || browser.parseError,
      tauri: tauri.hasValue || tauri.parseError,
      remoteExists: syncSession.hasUsableSnapshot ? encodedCache(item.key).length > 0 : null,
      sizeBytes: Math.max(browser.sizeBytes, tauri.sizeBytes),
    });
  }
  return candidates;
}

export async function loadDeviceStore<T>(key: DeviceStoreKey): Promise<T | null> {
  try {
    if (await isTauri()) {
      const raw = await invoke<string>('read_store', { key: getDeviceTauriKey(key) });
      const parsed = JSON.parse(raw) as T | null;
      if (parsed !== null) return parsed;
    }
  } catch {
    logWarn('Persistence', `Tauri device-only read failed for ${key}`);
  }
  const raw = localStorage.getItem(getDeviceDataKey(key));
  if (raw === null) return null;
  try {
    return JSON.parse(raw) as T;
  } catch {
    logWarn('Persistence', `Device-only cache JSON parse failed for ${key}`);
    return null;
  }
}

export async function saveDeviceStore<T>(key: DeviceStoreKey, value: T): Promise<void> {
  const json = JSON.stringify(value);
  try {
    if (await isTauri()) await invoke('write_store', { key: getDeviceTauriKey(key), value: json });
  } catch {
    logWarn('Persistence', `Tauri device-only write failed for ${key}`);
  }
  localStorage.setItem(getDeviceDataKey(key), json);
  lastLocalWriteAt = new Date().toISOString();
  lastLocalWriteKey = key;
  lastLocalWriteError = null;
  notifyPersistenceHealthSubscribers();
}

function requestCalendarProviderRefresh(reason: string): void {
  lastCalendarSyncRequestAt = new Date().toISOString();
  lastCalendarSyncRequestReason = reason;
  window.dispatchEvent(new CustomEvent(CALENDAR_SYNC_REQUEST_EVENT, { detail: { reason } }));
}

function countLegacyCandidates(): number {
  return SHARED_STORE_KEYS.reduce((count, item) => (
    localStorage.getItem(getDataKey(item.key)) !== null ? count + 1 : count
  ), 0);
}

function copyWriteQueueSnapshot(): SupabaseWriteQueueSnapshot {
  return {
    ...writeQueueSnapshot,
    queuedKeys: [...writeQueueSnapshot.queuedKeys],
    lastFlushKeys: [...writeQueueSnapshot.lastFlushKeys],
    lastFailureKeys: [...writeQueueSnapshot.lastFailureKeys],
  };
}

function buildPersistenceHealthSnapshot(): PersistenceHealthSnapshot {
  return {
    mode: syncSession.status === 'ready'
      ? 'database'
      : syncSession.hasUsableSnapshot ? 'read-only' : 'blocked',
    syncSession: { ...syncSession },
    lastLocalWriteAt,
    lastLocalWriteKey,
    lastLocalWriteError,
    lastRemoteReadAt,
    lastRemoteReadKey,
    lastRemoteReadError,
    lastRemoteWriteAt,
    lastRemoteWriteKey,
    lastRemoteWriteError,
    remoteReadFailedKeys: lastRemoteReadError ? [lastRemoteReadKey || 'account'] : [],
    lastSuppressedInitialWriteKey: null,
    lastSuppressedInitialWriteAt: null,
    dirtyKeys: [],
    supabaseQueue: copyWriteQueueSnapshot(),
    supabaseRealtime: getSupabaseRealtimeSnapshot(),
    localImportCandidateCount: countLegacyCandidates(),
    lastCalendarCacheCleanupAt,
    lastCalendarCacheCleanupReason,
    lastCalendarSyncRequestAt,
    lastCalendarSyncRequestReason,
  };
}

function notifyPersistenceHealthSubscribers(): void {
  const snapshot = buildPersistenceHealthSnapshot();
  persistenceHealthSubscribers.forEach(listener => listener(snapshot));
}

export function getPersistenceHealthSnapshot(): PersistenceHealthSnapshot {
  return buildPersistenceHealthSnapshot();
}

export function subscribePersistenceHealth(
  listener: (snapshot: PersistenceHealthSnapshot) => void,
): () => void {
  persistenceHealthSubscribers.add(listener);
  listener(buildPersistenceHealthSnapshot());
  return () => persistenceHealthSubscribers.delete(listener);
}
