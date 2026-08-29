import { v4 as uuid } from 'uuid';
import { APP_VERSION } from '../../config/release';
import {
  normalizeProjectRecords,
  serializeSharedProjects,
} from '../projectPersistence';
import {
  fetchHelmAccountSnapshot,
  fetchHelmCollections,
  getCurrentUserId,
  getSupabaseRealtimeSnapshot,
  isAuthenticated,
  isSupabaseReady,
  probeHelmAccountVersion,
} from '../supabase';
import { LEGACY_SHARED_STORE_KEY_SET, SHARED_STORE_KEYS } from '../storeKeys';
import type { HelmMutation, HelmRecord, HelmSecretRealtimeEvent } from '../databaseTypes';
import { HELM_DATABASE_SCHEMA_VERSION } from '../databaseTypes';
import {
  decodeStoreValue,
  encodeStoreValue,
  mergeLegacyStoreValue,
  sanitizeLegacyStoreValue,
  splitSettings,
  type DeviceSettings,
} from '../recordCodec';
import { PersistenceRecordCache, valuesEqual } from './cache';
import {
  DEVICE_SETTINGS_STORE_KEY,
  PersistenceDeviceStore,
  isDeviceStoreKey,
  type DeviceStoreKey,
} from './deviceStore';
import type {
  DatabaseRefreshRequest,
  LocalImportCandidate,
  PersistenceHealthSnapshot,
  RemoteStoreChange,
  SyncSessionReason,
  SyncSessionSnapshot,
} from './types';
import { PersistenceHealthPublisher } from './health';
import {
  PersistenceWriteQueue,
  applyInventoryMutationsWithIdempotentRetry,
  applySharedMutationsWithIdempotentRetry,
} from './writes';
import { PersistenceRealtimeBoundary } from './realtime';
import { PersistenceRuntimeState } from './runtimeState';

const NAMESPACE = 'helm';
export const CALENDAR_SYNC_REQUEST_EVENT = 'helm:calendar-sync-requested';
export { DEVICE_SETTINGS_STORE_KEY };

const runtime = new PersistenceRuntimeState();
const recordCache = new PersistenceRecordCache();
const deviceStore = new PersistenceDeviceStore();
const writeQueue = new PersistenceWriteQueue({
  getSession: () => ({
    epoch: runtime.persistenceEpoch,
    userId: getCurrentUserId(),
    isCurrent: isCurrentPersistenceSession,
  }),
  commit: commitStoreValues,
  isStaleError: error => error instanceof StalePersistenceSessionError,
  onSuccess: (changedCollections, requestedKeys, completedAt) => {
    healthPublisher.recordRemoteWrite(
      changedCollections.at(-1) ?? requestedKeys.at(-1) ?? null,
      completedAt,
    );
  },
  onFailure: async (error, keys, userId) => {
    const message = error instanceof Error ? error.message : String(error);
    healthPublisher.recordRemoteWriteFailure(error);
    publishDegraded(
      userId,
      typeof navigator !== 'undefined' && navigator.onLine === false ? 'offline' : 'database_unavailable',
      `Database write failed: ${message}`,
    );
    publishStoreChanges(keys, 'RECONNECT');
    if (typeof navigator === 'undefined' || navigator.onLine !== false) {
      await refreshDatabasePersistence();
    }
  },
  onSnapshot: () => notifyPersistenceHealthSubscribers(),
});

const healthPublisher = new PersistenceHealthPublisher({
  getSession: () => ({ ...runtime.syncSession }),
  getWriteQueue: () => writeQueue.getSnapshot(),
  getRealtime: getSupabaseRealtimeSnapshot,
  countLegacyCandidates: () => deviceStore.countLegacyCandidates(),
});

const realtimeBoundary = new PersistenceRealtimeBoundary({
  getSession: () => ({
    epoch: runtime.persistenceEpoch,
    userId: getCurrentUserId(),
    authenticated: isAuthenticated(),
    hasUsableSnapshot: runtime.syncSession.hasUsableSnapshot,
    readOnly: runtime.syncSession.readOnly,
    reason: runtime.syncSession.reason,
    isCurrent: isCurrentPersistenceSession,
  }),
  refresh: requestDatabaseRefresh,
  publishDegraded,
  publishSecretChange: event => {
    runtime.secretChangeSubscribers.forEach(listener => listener(event));
  },
  notifyHealth: () => notifyPersistenceHealthSubscribers(),
  staleError: () => new StalePersistenceSessionError(),
});

class StalePersistenceSessionError extends Error {
  constructor() {
    super('The Sabah One account changed while database work was in flight.');
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
  return epoch === runtime.persistenceEpoch
    && getCurrentUserId() === userId
    && runtime.bootstrappedUserId === userId;
}

function assertCurrentPersistenceSession(epoch: number, userId: string): void {
  if (!isCurrentPersistenceSession(epoch, userId)) throw new StalePersistenceSessionError();
}

function assertSharedStoreKeyIsNotDeviceOnly(key: string): void {
  if (isDeviceStoreKey(key)) {
    throw new Error(`${key} is device-only. Use loadDeviceStore/saveDeviceStore.`);
  }
  if (LEGACY_SHARED_STORE_KEY_SET.has(key)) {
    throw new Error(`${key} is retired and has no active storage interface.`);
  }
}

async function prepareSharedStoreValue(key: string, value: unknown): Promise<unknown> {
  if (key !== 'projects') return value;
  return serializeSharedProjects(normalizeProjectRecords(value, new Date().toISOString()));
}

function publishSyncSession(patch: Partial<SyncSessionSnapshot>): void {
  runtime.syncSession = { ...runtime.syncSession, ...patch };
  const snapshot = { ...runtime.syncSession };
  runtime.syncSessionSubscribers.forEach(listener => listener(snapshot));
  notifyPersistenceHealthSubscribers();
}

function hasUsableSnapshotFor(userId: string): boolean {
  return runtime.syncSession.hasUsableSnapshot
    && runtime.syncSession.userId === userId
    && runtime.bootstrappedUserId === userId;
}

function publishReady(userId: string): void {
  realtimeBoundary.markReady();
  publishSyncSession({
    status: 'ready',
    userId,
    accountVersion: runtime.accountVersion,
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
    accountVersion: runtime.accountVersion,
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
    runtime.storeChangeSubscribers.forEach(listener => listener(change));
  }
}

function applyMutationResult(records: HelmRecord[], version: number): void {
  recordCache.applyChanges(records);
  runtime.accountVersion = Math.max(runtime.accountVersion, version);
  publishSyncSession({ accountVersion: runtime.accountVersion });
}

async function commitStoreValues(
  values: Map<string, unknown>,
  epoch = runtime.persistenceEpoch,
  userId = getCurrentUserId(),
): Promise<string[]> {
  if (!userId) throw new StalePersistenceSessionError();
  assertCurrentPersistenceSession(epoch, userId);
  const operations = [...values.entries()].flatMap(([collection, value]) => (
    recordCache.buildMutations(collection, value)
  ));
  if (operations.length === 0) return [];
  const inventoryOperations = operations.filter(operation => (
    operation.collection === 'inventoryItems' || operation.collection === 'inventoryNeeds'
  ));
  const sharedOperations = operations.filter(operation => (
    operation.collection !== 'inventoryItems' && operation.collection !== 'inventoryNeeds'
  ));
  const results = [];
  if (sharedOperations.length > 0) {
    results.push(await applySharedMutationsWithIdempotentRetry(uuid(), sharedOperations));
  }
  if (inventoryOperations.length > 0) {
    results.push(await applyInventoryMutationsWithIdempotentRetry(uuid(), inventoryOperations));
  }
  assertCurrentPersistenceSession(epoch, userId);
  for (const result of results) applyMutationResult(result.changes, result.accountVersion);
  for (const [collection, value] of values) {
    recordCache.markDeliveredValue(collection, value);
  }
  return [...new Set(operations.map(operation => operation.collection))];
}

export async function flushPendingRemoteMutations(): Promise<void> {
  await writeQueue.flush();
}

async function migrateLegacyLocalCopies(epoch: number, userId: string): Promise<string[]> {
  assertCurrentPersistenceSession(epoch, userId);
  const desired = new Map<string, unknown>();
  const keysToClear: string[] = [];
  let deviceSettings = await loadDeviceStore<DeviceSettings>(DEVICE_SETTINGS_STORE_KEY) ?? {};
  let deviceSettingsChanged = false;

  for (const item of SHARED_STORE_KEYS) {
    const legacy = deviceStore.readLegacySharedValue(item.key);
    assertCurrentPersistenceSession(epoch, userId);
    if (!legacy.source) continue;
    if (legacy.parseError) {
      deviceStore.quarantineLegacyValue(item.key, legacy.raw || '');
      keysToClear.push(item.key);
      continue;
    }
    const inspectedLegacy = sanitizeLegacyStoreValue(item.key, legacy.value);
    if (inspectedLegacy.ambiguous && legacy.raw !== null) {
      deviceStore.quarantineLegacyValue(item.key, legacy.raw);
    }
    if (item.key === 'settings') {
      const split = splitSettings(inspectedLegacy.value);
      if (Object.keys(split.device).length > 0) {
        deviceSettings = { ...split.device, ...deviceSettings };
        deviceSettingsChanged = true;
      }
    }
    const databaseValue = recordCache.decoded(item.key);
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
    healthPublisher.recordCalendarCleanup('Legacy shared copies retired after database verification.');
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
      `Sabah One database schema ${snapshot.state.schemaVersion} is not supported by this client.`,
    );
  }
  if (!versionAtLeast(APP_VERSION, snapshot.state.minimumClientVersion)) {
    throw new SyncCompatibilityError(
      'client_update_required',
      `Update Sabah One to ${snapshot.state.minimumClientVersion} or later.`,
    );
  }
  if (snapshot.state.accountVersion < runtime.accountVersion) return [];
  const collectionKeys = new Set([
    ...SHARED_STORE_KEYS.map(item => item.key),
    ...recordCache.collectionKeys(),
    ...snapshot.records.map(record => record.collection),
  ]);
  const previousValues = new Map(
    [...collectionKeys].map(collection => [collection, recordCache.decoded(collection)]),
  );
  recordCache.replaceAll(snapshot.records);
  runtime.accountVersion = snapshot.state.accountVersion;
  healthPublisher.recordRemoteRead('account');
  return [...collectionKeys].filter(collection => (
    !valuesEqual(previousValues.get(collection), recordCache.decoded(collection))
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
  if (nextVersion > runtime.accountVersion + 1 || collections.length === 0) {
    changedCollections = await hydrateDatabaseSnapshot(epoch, userId);
  } else {
    const records = await fetchHelmCollections(collections);
    assertCurrentPersistenceSession(epoch, userId);
    for (const collection of collections) {
      recordCache.replaceCollection(collection, records.filter(record => record.collection === collection));
    }
    runtime.accountVersion = Math.max(runtime.accountVersion, nextVersion);
    healthPublisher.recordRemoteRead(collections.at(-1) ?? 'account');
  }
  return changedCollections;
}

function reasonForDatabaseError(error: unknown): Exclude<SyncSessionReason, 'signed_out' | 'configuration' | 'switching_account' | null> {
  if (error instanceof SyncCompatibilityError) return error.reason;
  if (typeof navigator !== 'undefined' && navigator.onLine === false) return 'offline';
  return 'database_unavailable';
}

function handleDatabaseFailure(error: unknown, userId: string): void {
  if (error instanceof StalePersistenceSessionError) return;
  const message = error instanceof Error ? error.message : String(error);
  healthPublisher.recordRemoteReadFailure(error);
  const reason = reasonForDatabaseError(error);
  publishDegraded(userId, reason, message);
  if (reason !== 'incompatible_schema' && reason !== 'client_update_required') {
    realtimeBoundary.scheduleRecovery({ snapshot: true, realtime: true });
  }
}

export async function bootstrapDatabasePersistence(): Promise<void> {
  const userId = getCurrentUserId();
  if (!isSupabaseReady() || !isAuthenticated() || !userId) {
    resetDatabasePersistence(
      isSupabaseReady() ? 'Sign in to load Sabah One data.' : 'Sabah One database configuration is unavailable.',
      isSupabaseReady() ? 'signed_out' : 'configuration',
    );
    return;
  }
  if (runtime.bootstrapPromise && runtime.bootstrappedUserId === userId) return runtime.bootstrapPromise;

  if (runtime.bootstrappedUserId !== userId || (runtime.syncSession.userId && runtime.syncSession.userId !== userId)) {
    resetDatabasePersistence('Switching Sabah One accounts.', 'switching_account');
  } else if (hasUsableSnapshotFor(userId)) {
    await requestDatabaseRefresh({ realtime: true });
    return;
  }
  runtime.bootstrappedUserId = userId;
  const epoch = ++runtime.persistenceEpoch;
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
    realtimeBoundary.register();
    if (typeof navigator !== 'undefined' && navigator.onLine === false) {
      publishDegraded(userId, 'offline', 'The browser is offline.');
      return;
    }
    const changedCollections = await hydrateDatabaseSnapshot(epoch, userId);
    publishSyncSession({
      status: 'reconnecting',
      userId,
      accountVersion: runtime.accountVersion,
      hasUsableSnapshot: true,
      readOnly: true,
      reason: null,
      error: null,
    });
    publishStoreChanges(await migrateLegacyLocalCopies(epoch, userId));
    await realtimeBoundary.ensureSubscription(epoch, userId);
    const latestVersion = await probeHelmAccountVersion();
    assertCurrentPersistenceSession(epoch, userId);
    publishSyncSession({ lastProbeAt: new Date().toISOString() });
    if (latestVersion > runtime.accountVersion) {
      changedCollections.push(...await hydrateDatabaseSnapshot(epoch, userId));
    }
    assertCurrentPersistenceSession(epoch, userId);
    publishReady(userId);
    publishStoreChanges(changedCollections);
  })().catch(error => {
    handleDatabaseFailure(error, userId);
  }).finally(() => {
    if (runtime.bootstrapPromise === operation) runtime.bootstrapPromise = null;
  });
  runtime.bootstrapPromise = operation;
  return operation;
}

function requestDatabaseRefresh(request: DatabaseRefreshRequest = {}): Promise<void> {
  const userId = getCurrentUserId();
  if (!userId || !isAuthenticated()) {
    resetDatabasePersistence('Sign in to load Sabah One data.', 'signed_out');
    return Promise.resolve();
  }
  if (typeof navigator !== 'undefined' && navigator.onLine === false) {
    publishDegraded(userId, 'offline', 'The browser is offline.');
    return Promise.resolve();
  }
  if (runtime.bootstrappedUserId !== userId) {
    return bootstrapDatabasePersistence();
  }
  if (runtime.refreshPromise) {
    const needsFollowUpSnapshot = request.snapshot === true && !runtime.refreshActiveSnapshot;
    const needsFollowUpRealtime = request.realtime === true && !runtime.refreshActiveRealtime;
    const requestedVersion = request.targetVersion ?? 0;
    const needsFollowUpVersion = requestedVersion > Math.max(
      runtime.accountVersion,
      runtime.refreshActiveTargetVersion,
      runtime.refreshTargetVersion,
    );
    if (needsFollowUpSnapshot || needsFollowUpRealtime || needsFollowUpVersion) {
      runtime.refreshQueued = true;
      runtime.refreshNeedsSnapshot ||= needsFollowUpSnapshot;
      runtime.refreshNeedsRealtime ||= needsFollowUpRealtime;
      if (needsFollowUpVersion) {
        runtime.refreshTargetVersion = requestedVersion;
        request.collections?.forEach(collection => runtime.refreshNeedsCollections.add(collection));
      }
    }
    return runtime.refreshPromise;
  }
  runtime.refreshQueued = true;
  runtime.refreshNeedsSnapshot = request.snapshot === true;
  runtime.refreshNeedsRealtime = request.realtime === true;
  runtime.refreshTargetVersion = request.targetVersion ?? 0;
  runtime.refreshNeedsCollections.clear();
  request.collections?.forEach(collection => runtime.refreshNeedsCollections.add(collection));

  const epoch = runtime.persistenceEpoch;
  const operation = (async () => {
    while (runtime.refreshQueued) {
      runtime.refreshQueued = false;
      const needsSnapshot = runtime.refreshNeedsSnapshot || !hasUsableSnapshotFor(userId);
      const requestedCollections = [...runtime.refreshNeedsCollections];
      const requestedVersion = runtime.refreshTargetVersion;
      runtime.refreshActiveSnapshot = needsSnapshot;
      runtime.refreshActiveRealtime = true;
      runtime.refreshActiveTargetVersion = requestedVersion;
      runtime.refreshNeedsSnapshot = false;
      runtime.refreshNeedsRealtime = false;
      runtime.refreshNeedsCollections.clear();
      runtime.refreshTargetVersion = 0;
      assertCurrentPersistenceSession(epoch, userId);

      const hadUsableSnapshot = hasUsableSnapshotFor(userId);
      const changedCollections: string[] = [];
      if (needsSnapshot) {
        changedCollections.push(...await hydrateDatabaseSnapshot(epoch, userId));
        if (!hadUsableSnapshot) {
          publishSyncSession({
            status: 'reconnecting',
            userId,
            accountVersion: runtime.accountVersion,
            hasUsableSnapshot: true,
            readOnly: true,
            reason: null,
            error: null,
          });
          publishStoreChanges(await migrateLegacyLocalCopies(epoch, userId));
        }
      } else if (requestedVersion > runtime.accountVersion) {
        if (requestedCollections.length > 0) {
          changedCollections.push(...await refreshCollectionsFromBroadcast(
            requestedCollections,
            requestedVersion,
            epoch,
            userId,
          ));
        } else if (requestedVersion > runtime.accountVersion + 1) {
          changedCollections.push(...await hydrateDatabaseSnapshot(epoch, userId));
        } else {
          runtime.accountVersion = requestedVersion;
          publishSyncSession({ accountVersion: runtime.accountVersion });
        }
      }

      await realtimeBoundary.ensureSubscription(epoch, userId);
      const latestVersion = await probeHelmAccountVersion();
      assertCurrentPersistenceSession(epoch, userId);
      publishSyncSession({ lastProbeAt: new Date().toISOString() });
      if (latestVersion > runtime.accountVersion) {
        changedCollections.push(...await hydrateDatabaseSnapshot(epoch, userId));
      }
      assertCurrentPersistenceSession(epoch, userId);
      publishReady(userId);
      publishStoreChanges(changedCollections, needsSnapshot ? 'RECONNECT' : 'REMOTE_REFRESH');
      runtime.refreshActiveSnapshot = false;
      runtime.refreshActiveRealtime = false;
      runtime.refreshActiveTargetVersion = 0;
    }
  })().catch(error => {
    handleDatabaseFailure(error, userId);
  }).finally(() => {
    if (runtime.refreshPromise === operation) {
      runtime.refreshPromise = null;
      runtime.refreshQueued = false;
      runtime.refreshNeedsSnapshot = false;
      runtime.refreshNeedsRealtime = false;
      runtime.refreshNeedsCollections.clear();
      runtime.refreshTargetVersion = 0;
      runtime.refreshActiveSnapshot = false;
      runtime.refreshActiveRealtime = false;
      runtime.refreshActiveTargetVersion = 0;
    }
  });
  runtime.refreshPromise = operation;
  return operation;
}

export async function refreshDatabasePersistence(): Promise<void> {
  await requestDatabaseRefresh({ snapshot: true, realtime: true });
}

export function resetDatabasePersistence(
  error = 'Sabah One account data is unavailable.',
  reason: Extract<SyncSessionReason, 'signed_out' | 'configuration' | 'switching_account'> = 'signed_out',
): void {
  runtime.persistenceEpoch += 1;
  realtimeBoundary.reset();
  recordCache.reset();
  writeQueue.reset();
  runtime.resetCoordination();
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
  healthPublisher.resetAccountDiagnostics();
}

export function getSyncSessionSnapshot(): SyncSessionSnapshot {
  return { ...runtime.syncSession };
}

export function subscribeSyncSession(listener: (snapshot: SyncSessionSnapshot) => void): () => void {
  runtime.syncSessionSubscribers.add(listener);
  listener({ ...runtime.syncSession });
  return () => runtime.syncSessionSubscribers.delete(listener);
}

export function subscribeStoreChanges(listener: (change: RemoteStoreChange) => void): () => void {
  runtime.storeChangeSubscribers.add(listener);
  return () => runtime.storeChangeSubscribers.delete(listener);
}

export function subscribeHelmSecretChanges(
  listener: (event: HelmSecretRealtimeEvent) => void,
): () => void {
  runtime.secretChangeSubscribers.add(listener);
  return () => runtime.secretChangeSubscribers.delete(listener);
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
    recordCache.markDeliveredFromCache(key);
    const value = recordCache.decoded(key) as T | null;
    healthPublisher.recordRemoteRead(key);
    return value;
  } catch (error) {
    const message = error instanceof Error ? error.message : String(error);
    healthPublisher.recordRemoteReadFailure(error);
    publishDegraded(userId, 'database_unavailable', message);
    return null;
  }
}

export async function saveStore<T>(key: string, value: T): Promise<void> {
  assertSharedStoreKeyIsNotDeviceOnly(key);
  if (!isSupabaseReady() || !isAuthenticated() || runtime.syncSession.status !== 'ready' || runtime.syncSession.readOnly) {
    const message = 'Shared Sabah One data can only be changed while the signed-in database session is ready.';
    healthPublisher.recordRemoteWriteFailure(new Error(message));
    return;
  }
  try {
    const sharedValue = await prepareSharedStoreValue(key, value);
    if (valuesEqual(recordCache.decoded(key), sharedValue)) return;
    writeQueue.enqueue(key, sharedValue);
    writeQueue.scheduleFlush();
  } catch (error) {
    const message = error instanceof Error ? error.message : String(error);
    healthPublisher.recordRemoteWriteFailure(error);
    const userId = getCurrentUserId();
    if (userId) publishDegraded(userId, 'database_unavailable', message);
  }
}

/**
 * Persist account data and fail unless the desired value is confirmed in the
 * authoritative database cache. Callers must not publish optimistic shared
 * state before this promise resolves.
 */
export async function saveStoreCommitted<T>(key: string, value: T): Promise<void> {
  assertSharedStoreKeyIsNotDeviceOnly(key);
  if (!isSupabaseReady() || !isAuthenticated() || runtime.syncSession.status !== 'ready' || runtime.syncSession.readOnly) {
    const message = 'Shared Sabah One data can only be changed while the signed-in database session is ready.';
    healthPublisher.recordRemoteWriteFailure(new Error(message));
    throw new Error(message);
  }

  const sharedValue = await prepareSharedStoreValue(key, value);
  const confirmedValue = decodeStoreValue(key, encodeStoreValue(key, sharedValue));
  if (valuesEqual(recordCache.decoded(key), confirmedValue)) return;
  writeQueue.enqueue(key, sharedValue);
  await writeQueue.flush();
  if (!valuesEqual(recordCache.decoded(key), confirmedValue)) {
    throw new Error(healthPublisher.getLastRemoteWriteError() || 'The database did not confirm the requested Sabah One change.');
  }
}

/**
 * Commit reserved top-level fields on one account record without replacing
 * unrelated fields. This is the concurrency-safe path for additive profile
 * domains that older readers already preserve in the profile summary.
 */
export function saveStoreRecordFieldsCommitted<T>(
  key: string,
  recordId: string,
  fields: Record<string, unknown>,
  fallbackStoreValue: T,
): Promise<void> {
  return writeQueue.serializeCommitted(async () => {
    assertSharedStoreKeyIsNotDeviceOnly(key);
    if (Object.keys(fields).length === 0) return;
    if (!isSupabaseReady() || !isAuthenticated() || runtime.syncSession.status !== 'ready' || runtime.syncSession.readOnly) {
      const message = 'Shared Sabah One data can only be changed while the signed-in database session is ready.';
      healthPublisher.recordRemoteWriteFailure(new Error(message));
      throw new Error(message);
    }

    await writeQueue.flush();
    if (runtime.syncSession.status !== 'ready' || runtime.syncSession.readOnly) {
      throw new Error(healthPublisher.getLastRemoteWriteError() || 'The signed-in database session became read-only before the change could commit.');
    }
    const epoch = runtime.persistenceEpoch;
    const userId = getCurrentUserId();
    if (!userId) throw new StalePersistenceSessionError();
    assertCurrentPersistenceSession(epoch, userId);
    const stored = recordCache.getRecord(key, recordId);
    const operations: HelmMutation[] = [];
    if (stored?.deletedAt) {
      operations.push({ op: 'restore', collection: key, recordId });
      operations.push({ op: 'patch', collection: key, recordId, set: fields, unset: [] });
    } else if (stored) {
      const set = Object.fromEntries(
        Object.entries(fields).filter(([field, value]) => !valuesEqual(stored.payload[field], value)),
      );
      if (Object.keys(set).length > 0) {
        operations.push({ op: 'patch', collection: key, recordId, set, unset: [] });
      }
    } else {
      const fallback = encodeStoreValue(key, fallbackStoreValue)
        .find(record => record.recordId === recordId);
      if (!fallback) throw new Error(`${key} record ${recordId} cannot be created from the supplied fallback.`);
      operations.push({
        op: 'create',
        collection: key,
        recordId,
        payload: { ...fallback.payload, ...fields },
        position: fallback.position,
      });
    }
    if (operations.length === 0) return;

    const keys = [key];
    writeQueue.beginDirectCommit(keys);
    try {
      const result = await applySharedMutationsWithIdempotentRetry(uuid(), operations);
      assertCurrentPersistenceSession(epoch, userId);
      applyMutationResult(result.changes, result.accountVersion);
      const confirmed = recordCache.getRecord(key, recordId);
      if (!confirmed || confirmed.deletedAt !== null || Object.entries(fields).some(
        ([field, value]) => !valuesEqual(confirmed.payload[field], value),
      )) {
        throw new Error('The database did not confirm the requested Sabah One record fields.');
      }
      recordCache.markDeliveredFromCache(key);
      const completedAt = new Date().toISOString();
      healthPublisher.recordRemoteWrite(key, completedAt);
      writeQueue.completeDirectCommit(completedAt);
      publishStoreChanges(keys);
    } catch (error) {
      if (error instanceof StalePersistenceSessionError) throw error;
      const message = error instanceof Error ? error.message : String(error);
      healthPublisher.recordRemoteWriteFailure(error);
      writeQueue.failDirectCommit(keys, error);
      publishDegraded(
        userId,
        typeof navigator !== 'undefined' && navigator.onLine === false ? 'offline' : 'database_unavailable',
        `Database write failed: ${message}`,
      );
      publishStoreChanges(keys, 'RECONNECT');
      if (typeof navigator === 'undefined' || navigator.onLine !== false) {
        await refreshDatabasePersistence();
      }
      throw error;
    }
  }, () => new StalePersistenceSessionError());
}

export async function clearLocalStoreCopy(key: string, notify = true): Promise<void> {
  deviceStore.clearLegacySharedValue(key);
  if (notify) notifyPersistenceHealthSubscribers();
}

export async function listLocalImportCandidates(): Promise<LocalImportCandidate[]> {
  return deviceStore.listLegacyCandidates(key => (
    runtime.syncSession.hasUsableSnapshot ? recordCache.encoded(key).length > 0 : null
  ));
}

export async function loadDeviceStore<T>(key: DeviceStoreKey): Promise<T | null> {
  return deviceStore.load<T>(key);
}

export async function saveDeviceStore<T>(key: DeviceStoreKey, value: T): Promise<void> {
  deviceStore.save(key, value);
  healthPublisher.recordLocalWrite(key);
}

function requestCalendarProviderRefresh(reason: string): void {
  healthPublisher.recordCalendarRequest(reason);
  window.dispatchEvent(new CustomEvent(CALENDAR_SYNC_REQUEST_EVENT, { detail: { reason } }));
}

function notifyPersistenceHealthSubscribers(): void {
  healthPublisher.notify();
}

export function getPersistenceHealthSnapshot(): PersistenceHealthSnapshot {
  return healthPublisher.getSnapshot();
}

export function subscribePersistenceHealth(
  listener: (snapshot: PersistenceHealthSnapshot) => void,
): () => void {
  return healthPublisher.subscribe(listener);
}
