import { v4 as uuid } from 'uuid';
import { APP_VERSION } from '../../config/release';
import {
  classifyOperationalFailure,
  observeOperationalOperation,
  recordOperationalEvent,
} from '../../services/operationalTelemetry';
import type { OperationalReason } from '../../types/domain';
import {
  normalizeProjectRecords,
  serializeSharedProjects,
} from '../projectPersistence';
import {
  fetchHelmAccountSnapshot,
  fetchHelmCollections,
  fetchHelmChangedCollections,
  fetchHelmCollectionPage,
  getCurrentUserId,
  getSupabaseRealtimeSnapshot,
  isAuthenticated,
  isSupabaseReady,
  probeHelmAccountVersion,
} from '../supabase';
import { LEGACY_SHARED_STORE_KEY_SET, SHARED_STORE_KEYS } from '../storeKeys';
import type { HelmMutation, HelmRecord, HelmSecretChangeEvent } from '../databaseTypes';
import { HELM_DATABASE_SCHEMA_VERSION } from '../databaseTypes';
import {
  decodeStoreValue,
  encodeStoreValue,
  mergeLegacyStoreValue,
  hasLegacyProviderSettings,
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
export const STORE_FRESHNESS_MS = 10 * 60_000;
export const STORE_PAGE_SIZE = 50;
const PAGED_COLLECTIONS = new Set(['assistantActivityLog']);
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
  onFailure: async (error, keys) => {
    healthPublisher.recordRemoteWriteFailure(error);
    if (isAuthorizationFailure(error)) {
      resetDatabasePersistence('Your account authorization is no longer valid. Sign in again.', 'signed_out');
      return;
    }
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
  publishSecretChange,
  notifyHealth: () => notifyPersistenceHealthSubscribers(),
  staleError: () => new StalePersistenceSessionError(),
});

class StalePersistenceSessionError extends Error {
  constructor() {
    super('The Sabah One account changed while database work was in flight.');
    this.name = 'StalePersistenceSessionError';
  }
}

function publishSecretChange(event: HelmSecretChangeEvent): void {
  if (event.accountVersion <= runtime.secretNotificationVersion) return;
  runtime.secretNotificationVersion = event.accountVersion;
  runtime.secretChangeSubscribers.forEach(listener => listener(event));
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
  recordOperationalEvent({
    domain: 'database',
    operation: 'recovery',
    outcome: 'ok',
    reason: 'ok',
    freshness: 'fresh',
  });
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
  operationalReason?: OperationalReason,
): void {
  const usable = hasUsableSnapshotFor(userId);
  const fatal = reason === 'incompatible_schema' || reason === 'client_update_required';
  recordOperationalEvent({
    domain: 'database',
    operation: 'recovery',
    outcome: 'failed',
    reason: operationalReason ?? (reason === 'offline'
      ? 'offline'
      : reason === 'client_update_required'
        ? 'client_update_required'
        : reason === 'incompatible_schema' ? 'invalid_response' : 'unknown'),
    freshness: usable && !fatal ? 'stale' : 'unknown',
  });
  if (fatal) recordCache.reset();
  publishSyncSession({
    status: usable && !fatal ? 'reconnecting' : 'blocked',
    userId,
    accountVersion: runtime.accountVersion,
    hasUsableSnapshot: usable && !fatal,
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
  // Only a contiguous confirmed receipt can acknowledge every intervening write.
  if (runtime.scoped && version === runtime.reconciledVersion + 1) {
    runtime.reconciledVersion = version;
    for (const collection of new Set(records.map(record => record.collection))) {
      const status = recordCache.status(collection);
      if (status && !status.stale) recordCache.confirm(collection, status.complete, status.limit, version);
    }
  }
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
  let retainedSettings: { raw: string; marker: string } | null = null;
  let deviceSettings = await loadDeviceStore<DeviceSettings>(DEVICE_SETTINGS_STORE_KEY) ?? {};
  let deviceSettingsChanged = false;

  for (const item of SHARED_STORE_KEYS) {
    const legacy = deviceStore.readLegacySharedValue(item.key);
    assertCurrentPersistenceSession(epoch, userId);
    if (!legacy.source || (runtime.scoped && !recordCache.status(item.key)?.complete)) continue;
    if (legacy.parseError) {
      deviceStore.quarantineLegacyValue(item.key, legacy.raw || '');
      keysToClear.push(item.key);
      continue;
    }
    const inspectedLegacy = sanitizeLegacyStoreValue(item.key, legacy.value);
    if (item.key === 'settings' && legacy.raw !== null && hasLegacyProviderSettings(inspectedLegacy.value)) {
      const migration = await deviceStore.legacySettingsMigration(legacy.raw);
      assertCurrentPersistenceSession(epoch, userId);
      if (migration.consumed) continue;
      retainedSettings = { raw: legacy.raw, marker: migration.marker };
    }
    if (inspectedLegacy.ambiguous && legacy.raw !== null
      && !(item.key === 'settings' && hasLegacyProviderSettings(inspectedLegacy.value))) {
      deviceStore.quarantineLegacyValue(item.key, legacy.raw);
    }
    if (item.key === 'settings') {
      const split = splitSettings(inspectedLegacy.value);
      if (Object.keys(split.device).length > 0 && !deviceStore.hasCurrentDeviceSettings()) {
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
    // Keep the original browser source readable by the existing Secrets
    // migration until the user explicitly removes it. Never copy raw keys to
    // the new device-settings store.
    if (item.key !== 'settings' || !hasLegacyProviderSettings(inspectedLegacy.value)) keysToClear.push(item.key);
  }

  if (deviceSettingsChanged) {
    assertCurrentPersistenceSession(epoch, userId);
    await saveDeviceStore(DEVICE_SETTINGS_STORE_KEY, deviceSettings);
    assertCurrentPersistenceSession(epoch, userId);
  }
  const changedCollections = desired.size > 0
    ? await commitStoreValues(desired, epoch, userId)
    : [];
  if (retainedSettings) {
    assertCurrentPersistenceSession(epoch, userId);
    deviceStore.completeLegacySettingsMigration(retainedSettings.raw, retainedSettings.marker);
  }
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

async function hydrateDatabaseSnapshot(
  epoch: number,
  userId: string,
  requested = runtime.scoped ? [...runtime.requestedCollections] : undefined,
): Promise<string[]> {
  const paged = requested?.filter(key => PAGED_COLLECTIONS.has(key)) ?? [];
  const full = requested?.filter(key => !PAGED_COLLECTIONS.has(key));
  const snapshot = await observeOperationalOperation(
    'database',
    'read',
    () => fetchHelmAccountSnapshot(full),
    { freshness: 'fresh' },
  );
  assertCurrentPersistenceSession(epoch, userId);
  if (snapshot.state.schemaVersion !== HELM_DATABASE_SCHEMA_VERSION) {
    throw new SyncCompatibilityError(
      'incompatible_schema',
      `Sabah One database schema ${snapshot.state.schemaVersion} is not supported by this client.`,
    );
  }
  if (!versionAtLeast(APP_VERSION, snapshot.state.minimumClientVersion)) {
    recordOperationalEvent({
      domain: 'release',
      operation: 'version',
      outcome: 'failed',
      reason: 'client_update_required',
      freshness: 'fresh',
    });
    throw new SyncCompatibilityError(
      'client_update_required',
      `Update Sabah One to ${snapshot.state.minimumClientVersion} or later.`,
    );
  }
  // A concurrent confirmed write must not be replaced by an older read.
  if (snapshot.state.accountVersion < runtime.accountVersion) {
    if (runtime.scoped) throw new Error('Account data changed while loading this page.');
    return [];
  }
  const collectionKeys = new Set(requested ?? [
    ...SHARED_STORE_KEYS.map(item => item.key),
    ...recordCache.collectionKeys(),
    ...snapshot.records.map(record => record.collection),
  ]);
  const staged = new Map<string, { records: HelmRecord[]; complete: boolean; limit: number }>();
  for (const collection of full ?? collectionKeys) {
    staged.set(collection, {
      records: snapshot.records.filter(record => record.collection === collection), complete: true, limit: 0,
    });
  }
  for (const collection of paged) {
    // Reconcile only the window the user has requested, never the unseen tail.
    const limit = recordCache.status(collection)?.limit || STORE_PAGE_SIZE;
    const records: HelmRecord[] = [];
    let hasMore = true;
    while (hasMore && records.length < limit) {
      const page = await fetchHelmCollectionPage(collection, records.length, Math.min(STORE_PAGE_SIZE, limit - records.length));
      assertCurrentPersistenceSession(epoch, userId);
      records.push(...page.records);
      hasMore = page.hasMore;
    }
    staged.set(collection, { records, complete: !hasMore, limit });
  }
  // The paged reads span statements. Reject the entire staged result if any
  // account write occurred, including a local confirmed write while awaiting.
  if (paged.length > 0) {
    const versionAfterPages = await probeHelmAccountVersion();
    assertCurrentPersistenceSession(epoch, userId);
    if (versionAfterPages !== snapshot.state.accountVersion
      || runtime.accountVersion > snapshot.state.accountVersion) {
      throw new Error('Account data changed while loading this page.');
    }
  }
  const previousValues = new Map(
    [...collectionKeys].map(collection => [collection, recordCache.decoded(collection)]),
  );
  const wasLoaded = new Set([...collectionKeys].filter(key => recordCache.status(key)));
  for (const [collection, value] of staged) {
    recordCache.replaceCollection(collection, value.records);
    recordCache.confirm(collection, value.complete, value.limit, snapshot.state.accountVersion);
  }
  runtime.accountVersion = Math.max(runtime.accountVersion, snapshot.state.accountVersion);
  healthPublisher.recordRemoteRead(requested ? 'page' : 'account');
  return [...collectionKeys].filter(collection => (
    !wasLoaded.has(collection) || !valuesEqual(previousValues.get(collection), recordCache.decoded(collection))
  ));
}

/** Reconcile a global checkpoint only after every changed scope is read or invalidated. */
async function reconcileScopedCollections(epoch: number, userId: string): Promise<string[]> {
  const changed: string[] = [];
  try {
    for (let attempt = 0; attempt < 3; attempt += 1) {
      const delta = await fetchHelmChangedCollections(runtime.reconciledVersion);
      assertCurrentPersistenceSession(epoch, userId);
      const needed = delta.collections.filter(key => {
        const status = recordCache.status(key);
        return runtime.requestedCollections.has(key)
          && (!status || status.stale || status.version < delta.accountVersion);
      });
      // Invalidation survives a failed read, so a revisit cannot reuse stale data.
      for (const key of delta.collections) {
        const status = recordCache.status(key);
        if (status && status.version < delta.accountVersion) recordCache.invalidate(key);
      }
      if (needed.length > 0) changed.push(...await hydrateDatabaseSnapshot(epoch, userId, needed));
      assertCurrentPersistenceSession(epoch, userId);
      if (delta.secretsChanged) publishSecretChange({ accountVersion: delta.accountVersion, reconciliation: true });
      runtime.reconciledVersion = Math.max(runtime.reconciledVersion, delta.accountVersion);
      runtime.accountVersion = Math.max(runtime.accountVersion, delta.accountVersion);
      if (runtime.reconciledVersion >= runtime.accountVersion) return changed;
      // A snapshot or local confirmation raced the metadata read. Catch up from
      // the last fully invalidated checkpoint, never from the newer local write.
    }
    throw new Error('Account data kept changing while refreshing. Retry connection.');
  } catch (error) {
    // A later catch-up read can fail after an earlier scope was confirmed.
    // Publish that confirmed cache so recovery cannot strand its providers.
    if (isCurrentPersistenceSession(epoch, userId)) publishStoreChanges(recordCache.confirmedCollectionKeys());
    throw error;
  }
}

async function refreshCollectionsFromBroadcast(
  collections: string[],
  nextVersion: number,
  epoch: number,
  userId: string,
): Promise<string[]> {
  assertCurrentPersistenceSession(epoch, userId);
  if (runtime.scoped) return reconcileScopedCollections(epoch, userId);
  let changedCollections = collections;
  if (nextVersion > runtime.accountVersion + 1 || collections.length === 0) {
    changedCollections = await hydrateDatabaseSnapshot(epoch, userId);
  } else {
    const records = await observeOperationalOperation(
      'database',
      'read',
      () => fetchHelmCollections(collections),
      { freshness: 'fresh' },
    );
    assertCurrentPersistenceSession(epoch, userId);
    for (const collection of collections) {
      recordCache.replaceCollection(collection, records.filter(record => record.collection === collection));
      recordCache.confirm(collection);
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

function isAuthorizationFailure(error: unknown): boolean {
  const failure = error as { status?: number; code?: string } | null;
  return failure?.status === 401
    || ['PGRST301', 'PGRST302', 'PGRST303'].includes(failure?.code ?? '');
}

function handleDatabaseFailure(error: unknown, userId: string): void {
  if (error instanceof StalePersistenceSessionError) return;
  const failure = error as { status?: number; code?: string } | null;
  // This boundary is an account-wide read. A denied domain write is handled separately.
  if (isAuthorizationFailure(error) || failure?.status === 403 || failure?.code === '42501') {
    resetDatabasePersistence('Your account authorization is no longer valid. Sign in again.', 'signed_out');
    return;
  }
  const message = error instanceof Error ? error.message
    : error && typeof error === 'object' && 'message' in error ? String(error.message) : String(error);
  healthPublisher.recordRemoteReadFailure(error);
  const reason = reasonForDatabaseError(error);
  publishDegraded(userId, reason, message, classifyOperationalFailure(error));
  if (reason !== 'incompatible_schema' && reason !== 'client_update_required') {
    realtimeBoundary.scheduleRecovery();
  }
}

export async function bootstrapDatabasePersistence(collections?: readonly string[]): Promise<void> {
  const userId = getCurrentUserId();
  if (!isSupabaseReady() || !isAuthenticated() || !userId) {
    resetDatabasePersistence(
      isSupabaseReady() ? 'Sign in to load Sabah One data.' : 'Sabah One database configuration is unavailable.',
      isSupabaseReady() ? 'signed_out' : 'configuration',
    );
    return;
  }
  if (runtime.bootstrapPromise && runtime.bootstrappedUserId === userId) return runtime.bootstrapPromise;
  if (runtime.bootstrappedUserId === userId && realtimeBoundary.isRecovering()) return;

  if (runtime.bootstrappedUserId !== userId || (runtime.syncSession.userId && runtime.syncSession.userId !== userId)) {
    resetDatabasePersistence('Switching Sabah One accounts.', 'switching_account');
  } else if (hasUsableSnapshotFor(userId)) {
    await requestDatabaseRefresh({ realtime: true });
    return;
  }
  if (collections) {
    runtime.scoped = true;
    setCollectionDemand(collections, 'page');
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
    runtime.reconciledVersion = runtime.accountVersion;
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
    realtimeBoundary.connect(epoch, userId);
    const latestVersion = await observeOperationalOperation(
      'database',
      'version',
      probeHelmAccountVersion,
      { freshness: 'fresh' },
    );
    assertCurrentPersistenceSession(epoch, userId);
    publishSyncSession({ lastProbeAt: new Date().toISOString() });
    if (latestVersion > (runtime.scoped ? runtime.reconciledVersion : runtime.accountVersion)) {
      changedCollections.push(...await (runtime.scoped
        ? reconcileScopedCollections(epoch, userId) : hydrateDatabaseSnapshot(epoch, userId)));
    }
    assertCurrentPersistenceSession(epoch, userId);
    publishReady(userId);
    publishStoreChanges(changedCollections);
  })().catch(error => {
    if (isCurrentPersistenceSession(epoch, userId)) handleDatabaseFailure(error, userId);
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
  if (runtime.bootstrapPromise) {
    const epoch = runtime.persistenceEpoch;
    return runtime.bootstrapPromise.then(() => {
      if (isCurrentPersistenceSession(epoch, userId) && (request.targetVersion ?? 0) > (runtime.scoped ? runtime.reconciledVersion : runtime.accountVersion)) {
        return requestDatabaseRefresh(request);
      }
    });
  }
  if (runtime.collectionLoadPromise) {
    return runtime.collectionLoadPromise.then(() => requestDatabaseRefresh(request), () => undefined);
  }
  if (runtime.refreshPromise) {
    const needsFollowUpSnapshot = request.snapshot === true && !runtime.refreshActiveSnapshot;
    const needsFollowUpRealtime = request.realtime === true && !runtime.refreshActiveRealtime;
    const requestedVersion = request.targetVersion ?? 0;
    const needsFollowUpVersion = requestedVersion > Math.max(
      runtime.scoped ? runtime.reconciledVersion : runtime.accountVersion,
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
  if (realtimeBoundary.isRecovering() && !request.recovery) return Promise.resolve();
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
      let needsSnapshot = runtime.refreshNeedsSnapshot || !hasUsableSnapshotFor(userId)
        || (runtime.scoped && [...runtime.requestedCollections].some(key => !recordCache.status(key)));
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

      // A failed lightweight probe must never escalate into a full account
      // download. Probe first, including while recovering an initial load.
      realtimeBoundary.connect(epoch, userId);
      const latestVersion = await observeOperationalOperation(
        'database',
        'version',
        probeHelmAccountVersion,
        { freshness: 'fresh' },
      );
      assertCurrentPersistenceSession(epoch, userId);
      publishSyncSession({ lastProbeAt: new Date().toISOString() });

      // Fold an explicit retry arriving during the probe into this pass.
      if (runtime.refreshNeedsSnapshot) {
        needsSnapshot = true;
        runtime.refreshNeedsSnapshot = false;
        runtime.refreshActiveSnapshot = true;
        if (!runtime.refreshNeedsRealtime && runtime.refreshTargetVersion <= requestedVersion) {
          runtime.refreshQueued = false;
        }
      }

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
      } else if (!runtime.scoped && requestedVersion > runtime.accountVersion) {
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

      if (runtime.scoped) {
        if (Math.max(latestVersion, runtime.accountVersion, requestedVersion) > runtime.reconciledVersion) {
          changedCollections.push(...await reconcileScopedCollections(epoch, userId));
        }
      } else if (latestVersion > runtime.accountVersion) {
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
    if (isCurrentPersistenceSession(epoch, userId)) handleDatabaseFailure(error, userId);
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
  realtimeBoundary.resumeRecovery();
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
  publishStoreChanges(['*']);
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
  listener: (event: HelmSecretChangeEvent) => void,
): () => void {
  runtime.secretChangeSubscribers.add(listener);
  return () => runtime.secretChangeSubscribers.delete(listener);
}

export function subscribeStoreKey(key: string, listener: (change: RemoteStoreChange) => void): () => void {
  return subscribeStoreChanges(change => {
    if (change.key === key || change.key === '*') listener(change);
  });
}

export function getStoreLoadState(key: string): { loaded: boolean; complete: boolean; confirmedAt: number | null } {
  const status = recordCache.status(key);
  return { loaded: Boolean(status), complete: status?.complete ?? false, confirmedAt: status?.confirmedAt ?? null };
}

function setCollectionDemand(keys: readonly string[], owner: string): void {
  runtime.collectionOwners.set(owner, keys);
  runtime.requestedCollections.clear();
  for (const collections of runtime.collectionOwners.values()) {
    collections.forEach(key => runtime.requestedCollections.add(key));
  }
}

export function releaseStoreCollections(owner: string): void {
  setCollectionDemand([], owner);
}

/** Each route/overlay owns current demand; cached inactive collections stay in memory. */
export async function activateStoreCollections(keys: readonly string[], owner = 'page'): Promise<void> {
  setCollectionDemand(keys, owner);
  return ensureStoreCollections(keys);
}

/** Route demand is coalesced and never resets a failed session's recovery budget. */
async function ensureStoreCollections(keys: readonly string[]): Promise<void> {
  const userId = getCurrentUserId();
  if (!userId || !isAuthenticated() || !runtime.scoped) return;
  if (runtime.bootstrapPromise) return runtime.bootstrapPromise.then(() => ensureStoreCollections(keys));
  if (runtime.collectionLoadPromise) return runtime.collectionLoadPromise.then(() => ensureStoreCollections(keys));
  if (runtime.refreshPromise) return runtime.refreshPromise.then(() => ensureStoreCollections(keys));
  if (realtimeBoundary.isRecovering() || runtime.syncSession.readOnly) {
    throw new Error(runtime.syncSession.error || 'Reconnect to load this page.');
  }
  const needed = keys.filter(key => {
    const status = recordCache.status(key);
    return !status || status.stale || Date.now() - status.confirmedAt >= STORE_FRESHNESS_MS;
  });
  if (needed.length === 0) return;
  const epoch = runtime.persistenceEpoch;
  const operation = (async () => {
    const changes = await hydrateDatabaseSnapshot(epoch, userId, needed);
    if (runtime.accountVersion > runtime.reconciledVersion) {
      changes.push(...await reconcileScopedCollections(epoch, userId));
    }
    assertCurrentPersistenceSession(epoch, userId);
    publishSyncSession({ accountVersion: runtime.accountVersion });
    publishStoreChanges([...changes, ...await migrateLegacyLocalCopies(epoch, userId)]);
  })().catch(error => {
    if (isCurrentPersistenceSession(epoch, userId)) handleDatabaseFailure(error, userId);
    if (error instanceof Error) throw error;
    throw new Error(runtime.syncSession.error || 'This page could not be loaded.');
  }).finally(() => {
    if (runtime.collectionLoadPromise === operation) runtime.collectionLoadPromise = null;
  });
  runtime.collectionLoadPromise = operation;
  await operation;
}

export async function loadMoreStoreRecords(key: string): Promise<void> {
  if (runtime.collectionLoadPromise) return runtime.collectionLoadPromise;
  const userId = getCurrentUserId();
  const status = recordCache.status(key);
  if (!PAGED_COLLECTIONS.has(key) || !userId || !status || status.complete) return;
  if (runtime.syncSession.readOnly || realtimeBoundary.isRecovering()) {
    throw new Error('Reconnect before loading more activity.');
  }
  const epoch = runtime.persistenceEpoch;
  const operation = (async () => {
    await flushPendingRemoteMutations();
    assertCurrentPersistenceSession(epoch, userId);
    const version = await probeHelmAccountVersion();
    if (version !== runtime.accountVersion) {
      throw new Error('Activity changed. Refresh before loading more.');
    }
    const page = await fetchHelmCollectionPage(key, recordCache.encoded(key).length, STORE_PAGE_SIZE);
    const afterVersion = await probeHelmAccountVersion();
    assertCurrentPersistenceSession(epoch, userId);
    if (afterVersion !== version || runtime.accountVersion > version) throw new Error('Activity changed while loading. Refresh before loading more.');
    recordCache.applyChanges(page.records);
    recordCache.confirm(key, !page.hasMore, status.limit + STORE_PAGE_SIZE, version);
    publishStoreChanges([key]);
  })().catch(error => {
    if (isCurrentPersistenceSession(epoch, userId)) handleDatabaseFailure(error, userId);
    throw error;
  }).finally(() => {
    if (runtime.collectionLoadPromise === operation) runtime.collectionLoadPromise = null;
  });
  runtime.collectionLoadPromise = operation;
  return operation;
}

export async function loadStore<T>(key: string): Promise<T | null> {
  assertSharedStoreKeyIsNotDeviceOnly(key);
  const userId = getCurrentUserId();
  if (!isSupabaseReady() || !isAuthenticated() || !userId || !hasUsableSnapshotFor(userId)) return null;
  if (runtime.scoped && !recordCache.status(key)) {
    const epoch = runtime.persistenceEpoch;
    // Mounted inactive providers wait. Unloaded is never delivered as empty.
    await new Promise<void>(resolve => {
      const remove = subscribeStoreChanges(change => {
        if ((change.key === key || change.key === '*')
          && (recordCache.status(key) || !isCurrentPersistenceSession(epoch, userId))) {
          remove();
          resolve();
        }
      });
    });
    if (!isCurrentPersistenceSession(epoch, userId) || !recordCache.status(key)) return null;
  }
  try {
    recordCache.markDeliveredFromCache(key);
    const value = recordCache.decoded(key) as T | null;
    healthPublisher.recordRemoteRead(key);
    return value;
  } catch (error) {
    healthPublisher.recordRemoteReadFailure(error);
    // A collection decoding failure is local to that consumer, not a lost session.
    throw error;
  }
}

export async function saveStore<T>(key: string, value: T): Promise<void> {
  assertSharedStoreKeyIsNotDeviceOnly(key);
  if (!isSupabaseReady() || !isAuthenticated() || runtime.syncSession.status !== 'ready' || runtime.syncSession.readOnly) {
    const message = 'Shared Sabah One data can only be changed while the signed-in database session is ready.';
    healthPublisher.recordRemoteWriteFailure(new Error(message));
    return;
  }
  if (runtime.scoped && !recordCache.status(key)) return;
  try {
    const sharedValue = await prepareSharedStoreValue(key, value);
    if (valuesEqual(recordCache.decoded(key), sharedValue)) return;
    writeQueue.enqueue(key, sharedValue);
    writeQueue.scheduleFlush();
  } catch (error) {
    const message = error instanceof Error ? error.message : String(error);
    healthPublisher.recordRemoteWriteFailure(error);
    const userId = getCurrentUserId();
    if (userId) publishDegraded(userId, 'database_unavailable', message, classifyOperationalFailure(error));
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

  if (runtime.scoped && !recordCache.status(key)) throw new Error('Open this page and wait for its data before saving.');
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
    if (runtime.scoped && !recordCache.status(key)) throw new Error('Open this page and wait for its data before saving.');
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
      if (!isCurrentPersistenceSession(epoch, userId)) throw new StalePersistenceSessionError();
      if (isAuthorizationFailure(error)) {
        resetDatabasePersistence('Your account authorization is no longer valid. Sign in again.', 'signed_out');
        throw error;
      }
      healthPublisher.recordRemoteWriteFailure(error);
      writeQueue.failDirectCommit(keys, error);
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
    runtime.syncSession.hasUsableSnapshot && (!runtime.scoped || recordCache.status(key))
      ? recordCache.encoded(key).length > 0 : null
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
