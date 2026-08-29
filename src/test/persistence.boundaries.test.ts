import { beforeEach, describe, expect, it, vi } from 'vitest';
import type { HelmRecord, HelmSecretRealtimeEvent } from '../store/databaseTypes';
import { PersistenceRecordCache } from '../store/persistence/cache';
import {
  DEVICE_SETTINGS_STORE_KEY,
  PersistenceDeviceStore,
  isDeviceStoreKey,
} from '../store/persistence/deviceStore';
import { PersistenceHealthPublisher } from '../store/persistence/health';
import { PersistenceRealtimeBoundary } from '../store/persistence/realtime';
import { PersistenceRuntimeState } from '../store/persistence/runtimeState';
import type {
  SupabaseWriteQueueSnapshot,
  SyncSessionSnapshot,
} from '../store/persistence/types';
import { PersistenceWriteQueue } from '../store/persistence/writes';

const realtimeMocks = vi.hoisted(() => ({
  dataListener: null as null | ((event: {
    accountVersion: number;
    changes: Array<{ collection: string }>;
  }) => void),
  secretListener: null as null | ((event: HelmSecretRealtimeEvent) => void),
  healthListener: null as null | ((snapshot: {
    state: 'subscribed' | 'error' | 'timed_out' | 'closed';
    lastError: string | null;
  }) => void),
  getSnapshot: vi.fn(),
  subscribeBroadcast: vi.fn(),
  subscribeHealth: vi.fn(),
}));

vi.mock('../store/supabase', () => ({
  getSupabaseRealtimeSnapshot: realtimeMocks.getSnapshot,
  subscribeHelmBroadcast: realtimeMocks.subscribeBroadcast,
  subscribeSupabaseRealtimeSnapshot: realtimeMocks.subscribeHealth,
}));

const NOW = '2026-08-29T12:00:00.000Z';

function record(
  collection: string,
  recordId: string,
  payload: Record<string, unknown>,
  position: number | null,
): HelmRecord {
  return {
    userId: 'user-kan-253',
    collection,
    recordId,
    payload,
    position,
    revision: 1,
    accountVersion: 7,
    createdAt: NOW,
    updatedAt: NOW,
    deletedAt: null,
  };
}

function queueSnapshot(): SupabaseWriteQueueSnapshot {
  return {
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
}

function readySession(): SyncSessionSnapshot {
  return {
    status: 'ready',
    userId: 'user-kan-253',
    accountVersion: 7,
    hasUsableSnapshot: true,
    readOnly: false,
    reason: null,
    lastReadyAt: NOW,
    lastProbeAt: NOW,
    error: null,
  };
}

describe('persistence cache boundary', () => {
  it('diffs against the delivered view so a concurrent remote addition is not deleted', () => {
    const cache = new PersistenceRecordCache();
    cache.replaceAll([record('tasks', 'task-a', { id: 'task-a', title: 'A' }, 0)]);
    cache.markDeliveredFromCache('tasks');
    cache.applyChanges([record('tasks', 'task-b', { id: 'task-b', title: 'B' }, 1)]);

    const operations = cache.buildMutations('tasks', [{ id: 'task-a', title: 'A edited' }]);

    expect(operations).toContainEqual({
      op: 'patch',
      collection: 'tasks',
      recordId: 'task-a',
      set: { title: 'A edited' },
      unset: [],
    });
    expect(operations).not.toContainEqual({
      op: 'delete',
      collection: 'tasks',
      recordId: 'task-b',
    });
    expect(cache.decoded('tasks')).toEqual([
      { id: 'task-a', title: 'A' },
      { id: 'task-b', title: 'B' },
    ]);
  });

  it('resets both authoritative and delivered cache state', () => {
    const cache = new PersistenceRecordCache();
    cache.replaceAll([record('settings', 'singleton', { theme: 'dark' }, null)]);
    cache.markDeliveredFromCache('settings');

    cache.reset();

    expect(cache.decoded('settings')).toBeNull();
    expect(cache.buildMutations('settings', { theme: 'light' })).toEqual([{
      op: 'create',
      collection: 'settings',
      recordId: 'singleton',
      payload: { theme: 'light' },
      position: null,
    }]);
  });
});

describe('persistence write boundary', () => {
  it('coalesces queued values and publishes a completed queue snapshot', async () => {
    const commit = vi.fn().mockResolvedValue(['settings']);
    const snapshots: SupabaseWriteQueueSnapshot[] = [];
    const queue = new PersistenceWriteQueue({
      getSession: () => ({
        epoch: 3,
        userId: 'user-kan-253',
        isCurrent: (epoch, userId) => epoch === 3 && userId === 'user-kan-253',
      }),
      commit,
      isStaleError: () => false,
      onSuccess: vi.fn(),
      onFailure: vi.fn().mockResolvedValue(undefined),
      onSnapshot: snapshot => snapshots.push(snapshot),
    });
    queue.enqueue('settings', { theme: 'dark' });
    queue.enqueue('settings', { theme: 'light' });

    await queue.flush();

    expect(commit).toHaveBeenCalledTimes(1);
    expect(commit.mock.calls[0][0].get('settings')).toEqual({ theme: 'light' });
    expect(snapshots.at(-1)).toMatchObject({ queuedCount: 0, lastFlushError: null });
  });

  it('invalidates serialized committed work when the account runtime resets', async () => {
    const queue = new PersistenceWriteQueue({
      getSession: () => ({ epoch: 1, userId: 'user-a', isCurrent: () => true }),
      commit: vi.fn().mockResolvedValue([]),
      isStaleError: () => false,
      onSuccess: vi.fn(),
      onFailure: vi.fn().mockResolvedValue(undefined),
      onSnapshot: vi.fn(),
    });
    const operation = queue.serializeCommitted(
      async () => 'unexpected',
      () => new Error('stale account epoch'),
    );

    queue.reset();

    await expect(operation).rejects.toThrow('stale account epoch');
  });
});

describe('device and runtime ownership boundaries', () => {
  beforeEach(() => localStorage.clear());

  it('keeps device settings under the device-only key and shared legacy data separate', () => {
    const store = new PersistenceDeviceStore();
    store.save(DEVICE_SETTINGS_STORE_KEY, { microphoneDeviceId: 'mic-1' });
    localStorage.setItem('helm:settings', JSON.stringify({ theme: 'dark' }));

    expect(isDeviceStoreKey('deviceSettings')).toBe(true);
    expect(store.load(DEVICE_SETTINGS_STORE_KEY)).toEqual({ microphoneDeviceId: 'mic-1' });
    expect(localStorage.getItem('helm:device:deviceSettings')).toContain('mic-1');
    expect(store.readLegacySharedValue('settings').value).toEqual({ theme: 'dark' });
    expect(store.listLegacyCandidates(() => false)).toEqual([
      expect.objectContaining({ key: 'settings', localStorage: true, remoteExists: false }),
    ]);
  });

  it('resets session coordination without discarding the epoch or subscribers', () => {
    const runtime = new PersistenceRuntimeState();
    runtime.persistenceEpoch = 9;
    runtime.accountVersion = 7;
    runtime.bootstrappedUserId = 'user-a';
    runtime.refreshQueued = true;
    runtime.refreshNeedsCollections.add('tasks');
    runtime.syncSessionSubscribers.add(vi.fn());

    runtime.resetCoordination();

    expect(runtime.persistenceEpoch).toBe(9);
    expect(runtime.accountVersion).toBe(0);
    expect(runtime.bootstrappedUserId).toBeNull();
    expect(runtime.refreshQueued).toBe(false);
    expect(runtime.refreshNeedsCollections.size).toBe(0);
    expect(runtime.syncSessionSubscribers.size).toBe(1);
  });
});

describe('persistence health and realtime boundaries', () => {
  beforeEach(() => {
    vi.useFakeTimers();
    vi.setSystemTime(new Date(NOW));
    realtimeMocks.getSnapshot.mockReset().mockReturnValue({
      state: 'subscribed',
      lastEventAt: null,
      lastStatusAt: NOW,
      lastError: null,
    });
    realtimeMocks.subscribeBroadcast.mockReset().mockImplementation((dataListener, secretListener) => {
      realtimeMocks.dataListener = dataListener;
      realtimeMocks.secretListener = secretListener;
      return vi.fn();
    });
    realtimeMocks.subscribeHealth.mockReset().mockImplementation(listener => {
      realtimeMocks.healthListener = listener;
      return vi.fn();
    });
  });

  it('keeps local diagnostics while clearing account-scoped health on reset', () => {
    const health = new PersistenceHealthPublisher({
      getSession: readySession,
      getWriteQueue: queueSnapshot,
      getRealtime: realtimeMocks.getSnapshot,
      countLegacyCandidates: () => 0,
    });
    health.recordLocalWrite('deviceSettings');
    health.recordRemoteRead('settings');
    health.recordRemoteWriteFailure(new Error('write failed'));
    health.recordCalendarCleanup('old account cleanup');

    health.resetAccountDiagnostics();

    expect(health.getSnapshot()).toMatchObject({
      mode: 'database',
      lastLocalWriteKey: 'deviceSettings',
      lastRemoteReadKey: null,
      lastRemoteWriteError: null,
      lastCalendarCacheCleanupReason: null,
      localImportCandidateCount: 0,
    });
  });

  it('uses Broadcast only as invalidation and schedules bounded realtime recovery', async () => {
    const refresh = vi.fn().mockResolvedValue(undefined);
    const publishDegraded = vi.fn();
    const publishSecretChange = vi.fn();
    let currentUserId = 'user-kan-253';
    const boundary = new PersistenceRealtimeBoundary({
      getSession: () => ({
        epoch: 4,
        userId: currentUserId,
        authenticated: true,
        hasUsableSnapshot: true,
        readOnly: false,
        reason: null,
        isCurrent: (epoch, userId) => epoch === 4 && userId === currentUserId,
      }),
      refresh,
      publishDegraded,
      publishSecretChange,
      notifyHealth: vi.fn(),
      staleError: () => new Error('stale account epoch'),
    });
    boundary.register();
    await boundary.ensureSubscription(4, currentUserId);

    realtimeMocks.dataListener?.({ accountVersion: 8, changes: [{ collection: 'tasks' }] });
    realtimeMocks.secretListener?.({
      requestId: 'secret-change',
      accountVersion: 9,
      secretId: 'secret-1',
      revision: 2,
      archivedAt: null,
    });
    await vi.waitFor(() => expect(publishSecretChange).toHaveBeenCalledTimes(1));
    expect(refresh).toHaveBeenCalledWith({
      collections: ['tasks'],
      snapshot: false,
      targetVersion: 8,
    });
    expect(refresh).toHaveBeenCalledWith({ targetVersion: 9 });

    realtimeMocks.healthListener?.({ state: 'error', lastError: 'channel unavailable' });
    expect(publishDegraded).toHaveBeenCalledWith(
      currentUserId,
      'realtime_unavailable',
      'channel unavailable',
    );
    refresh.mockClear();
    await vi.advanceTimersByTimeAsync(999);
    expect(refresh).not.toHaveBeenCalled();
    await vi.advanceTimersByTimeAsync(1);
    expect(refresh).toHaveBeenCalledWith({ realtime: true });

    currentUserId = 'user-b';
    refresh.mockClear();
    realtimeMocks.dataListener?.({ accountVersion: 10, changes: [{ collection: 'settings' }] });
    expect(refresh).not.toHaveBeenCalled();

    currentUserId = 'user-kan-253';
    realtimeMocks.getSnapshot.mockReturnValue({
      state: 'closed',
      lastEventAt: null,
      lastStatusAt: NOW,
      lastError: null,
    });
    const pendingReady = boundary.ensureSubscription(4, currentUserId);
    const staleRejection = expect(pendingReady).rejects.toThrow('stale account epoch');
    boundary.reset();
    await staleRejection;
  });
});
