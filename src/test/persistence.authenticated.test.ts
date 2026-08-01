import { beforeEach, describe, expect, it, vi } from 'vitest';
import type { HelmRealtimeEvent, HelmRecord } from '../store/databaseTypes';

const mocks = vi.hoisted(() => ({
  apply: vi.fn(),
  fetchCollections: vi.fn(),
  fetchSnapshot: vi.fn(),
  probeVersion: vi.fn(),
  subscribeBroadcast: vi.fn(),
  realtimeListener: null as ((event: HelmRealtimeEvent) => void) | null,
  currentUserId: '11111111-1111-4111-8111-111111111111',
}));

vi.mock('../store/supabase', () => ({
  applyHelmMutations: mocks.apply,
  fetchHelmAccountSnapshot: mocks.fetchSnapshot,
  fetchHelmCollections: mocks.fetchCollections,
  getCurrentUserId: vi.fn(() => mocks.currentUserId),
  getSupabaseRealtimeSnapshot: vi.fn(() => ({
    state: 'subscribed',
    lastEventAt: null,
    lastStatusAt: '2026-07-31T12:00:00.000Z',
    lastError: null,
  })),
  isAuthenticated: vi.fn(() => true),
  isSupabaseReady: vi.fn(() => true),
  probeHelmAccountVersion: mocks.probeVersion,
  subscribeHelmBroadcast: mocks.subscribeBroadcast,
  subscribeSupabaseRealtimeSnapshot: vi.fn(() => () => {}),
}));

import {
  bootstrapDatabasePersistence,
  flushPendingRemoteMutations,
  getPersistenceHealthSnapshot,
  getSyncSessionSnapshot,
  loadStore,
  refreshDatabasePersistence,
  resetDatabasePersistence,
  saveStore,
} from '../store/persistence';

const USER_ID = '11111111-1111-4111-8111-111111111111';
const SECOND_USER_ID = '22222222-2222-4222-8222-222222222222';

function row(
  collection: string,
  recordId: string,
  payload: Record<string, unknown>,
  options: Partial<HelmRecord> = {},
): HelmRecord {
  return {
    userId: options.userId ?? USER_ID,
    collection,
    recordId,
    payload,
    position: options.position ?? null,
    revision: options.revision ?? 1,
    accountVersion: options.accountVersion ?? 1,
    createdAt: options.createdAt ?? '2026-07-31T12:00:00.000Z',
    updatedAt: options.updatedAt ?? '2026-07-31T12:00:00.000Z',
    deletedAt: options.deletedAt ?? null,
  };
}

function snapshot(records: HelmRecord[] = [], accountVersion = 1, userId = USER_ID) {
  return {
    state: {
      userId,
      schemaVersion: 1,
      accountVersion,
      minimumClientVersion: '0.2.82',
      migratedAt: '2026-07-31T12:00:00.000Z',
      updatedAt: '2026-07-31T12:00:00.000Z',
    },
    records,
  };
}

describe('authenticated database persistence', () => {
  beforeEach(() => {
    localStorage.clear();
    vi.clearAllMocks();
    mocks.realtimeListener = null;
    mocks.currentUserId = USER_ID;
    Object.defineProperty(navigator, 'onLine', { value: true, configurable: true });
    mocks.fetchSnapshot.mockResolvedValue(snapshot());
    mocks.fetchCollections.mockResolvedValue([]);
    mocks.probeVersion.mockResolvedValue(1);
    mocks.subscribeBroadcast.mockImplementation((listener: (event: HelmRealtimeEvent) => void) => {
      mocks.realtimeListener = listener;
      return () => { mocks.realtimeListener = null; };
    });
    mocks.apply.mockImplementation(async (requestId: string) => ({
      requestId,
      accountVersion: 2,
      changes: [],
    }));
    resetDatabasePersistence();
  });

  it('bootstraps exclusively from the signed-in database', async () => {
    localStorage.setItem('helm:tasks', JSON.stringify([{ id: 'legacy-task', title: 'Legacy' }]));
    mocks.fetchSnapshot.mockResolvedValue(snapshot([
      row('tasks', 'database-task', { id: 'database-task', title: 'Database' }, { position: 0 }),
    ]));

    await bootstrapDatabasePersistence();
    const tasks = await loadStore<Array<{ id: string; title: string }>>('tasks');

    expect(tasks?.map(task => task.id)).toContain('database-task');
    expect(localStorage.getItem('helm:tasks')).toBeNull();
    expect(getSyncSessionSnapshot().status).toBe('ready');
  });

  it('does not delete or revert concurrent database changes absent from the delivered screen', async () => {
    const original = row('tasks', 'task-1', {
      id: 'task-1',
      title: 'Original title',
      completed: false,
    }, { position: 0 });
    mocks.fetchSnapshot.mockResolvedValue(snapshot([original]));
    await bootstrapDatabasePersistence();
    await loadStore('tasks');

    mocks.fetchCollections.mockResolvedValue([
      row('tasks', 'task-1', {
        id: 'task-1',
        title: 'Concurrent title',
        completed: false,
      }, { position: 0, revision: 2, accountVersion: 2 }),
      row('tasks', 'task-2', {
        id: 'task-2',
        title: 'Concurrent addition',
        completed: false,
      }, { position: 1, accountVersion: 2 }),
    ]);
    mocks.realtimeListener?.({
      requestId: '22222222-2222-4222-8222-222222222222',
      accountVersion: 2,
      changes: [
        { collection: 'tasks', recordId: 'task-1', revision: 2, deletedAt: null },
        { collection: 'tasks', recordId: 'task-2', revision: 1, deletedAt: null },
      ],
    });
    await vi.waitFor(() => expect(mocks.fetchCollections).toHaveBeenCalled());

    await saveStore('tasks', [{
      id: 'task-1',
      title: 'Original title',
      completed: true,
    }]);
    await flushPendingRemoteMutations();

    const operations = mocks.apply.mock.calls.at(-1)?.[1];
    expect(operations).toEqual([{ op: 'patch', collection: 'tasks', recordId: 'task-1', set: { completed: true }, unset: [] }]);
    expect(JSON.stringify(operations)).not.toContain('task-2');
    expect(JSON.stringify(operations)).not.toContain('Concurrent title');
  });

  it('retries an unknown-outcome network failure once with the same request id', async () => {
    mocks.fetchSnapshot.mockResolvedValue(snapshot([
      row('tasks', 'task-1', { id: 'task-1', title: 'Original' }, { position: 0 }),
    ]));
    mocks.apply
      .mockRejectedValueOnce(new Error('network request failed'))
      .mockImplementationOnce(async (requestId: string) => ({ requestId, accountVersion: 2, changes: [] }));
    await bootstrapDatabasePersistence();
    await loadStore('tasks');

    await saveStore('tasks', [{ id: 'task-1', title: 'Updated' }]);
    await flushPendingRemoteMutations();

    expect(mocks.apply).toHaveBeenCalledTimes(2);
    expect(mocks.apply.mock.calls[0][0]).toBe(mocks.apply.mock.calls[1][0]);
    expect(mocks.apply.mock.calls[0][0]).toMatch(/^[0-9a-f-]{36}$/);
  });

  it('rolls back a failed optimistic write by refetching database truth', async () => {
    mocks.fetchSnapshot.mockResolvedValue(snapshot([
      row('tasks', 'task-1', { id: 'task-1', title: 'Database truth' }, { position: 0 }),
    ]));
    mocks.apply.mockRejectedValueOnce(Object.assign(new Error('mutation rejected'), { status: 400 }));
    await bootstrapDatabasePersistence();
    await loadStore('tasks');

    await saveStore('tasks', [{ id: 'task-1', title: 'Optimistic title' }]);
    await flushPendingRemoteMutations();

    expect(mocks.fetchSnapshot).toHaveBeenCalledTimes(2);
    expect(getSyncSessionSnapshot().status).toBe('ready');
    await expect(loadStore('tasks')).resolves.toEqual([
      { id: 'task-1', title: 'Database truth' },
    ]);
    expect(getPersistenceHealthSnapshot().supabaseQueue.queuedCount).toBe(0);
  });

  it('keeps the last confirmed snapshot visible read-only when the browser goes offline', async () => {
    mocks.fetchSnapshot.mockResolvedValue(snapshot([
      row('tasks', 'task-1', { id: 'task-1', title: 'Still visible' }, { position: 0 }),
    ]));
    await bootstrapDatabasePersistence();
    window.dispatchEvent(new Event('offline'));

    await expect(loadStore('tasks')).resolves.toEqual([{ id: 'task-1', title: 'Still visible' }]);
    await saveStore('tasks', [{ id: 'task-1' }]);
    await flushPendingRemoteMutations();

    expect(getSyncSessionSnapshot()).toMatchObject({
      status: 'reconnecting',
      hasUsableSnapshot: true,
      readOnly: true,
      reason: 'offline',
    });
    expect(mocks.apply).not.toHaveBeenCalled();
  });

  it('coalesces overlapping full refreshes without restarting a healthy realtime channel', async () => {
    await bootstrapDatabasePersistence();
    const initialSubscriptionCount = mocks.subscribeBroadcast.mock.calls.length;
    let resolveSnapshot!: (value: ReturnType<typeof snapshot>) => void;
    mocks.fetchSnapshot.mockClear();
    mocks.fetchSnapshot.mockImplementationOnce(() => new Promise(resolve => {
      resolveSnapshot = resolve;
    }));

    const refreshes = [
      refreshDatabasePersistence(),
      refreshDatabasePersistence(),
      refreshDatabasePersistence(),
    ];
    expect(mocks.fetchSnapshot).toHaveBeenCalledTimes(1);
    resolveSnapshot(snapshot([], 1));
    await Promise.all(refreshes);

    expect(mocks.fetchSnapshot).toHaveBeenCalledTimes(1);
    expect(mocks.subscribeBroadcast).toHaveBeenCalledTimes(initialSubscriptionCount);
    expect(getSyncSessionSnapshot()).toMatchObject({ status: 'ready', readOnly: false });
  });

  it('coalesces a realtime event into an active refresh instead of overlapping reads', async () => {
    await bootstrapDatabasePersistence();
    const readOrder: string[] = [];
    let resolveSnapshot!: (value: ReturnType<typeof snapshot>) => void;
    mocks.fetchSnapshot.mockImplementationOnce(() => new Promise(resolve => {
      readOrder.push('snapshot-start');
      resolveSnapshot = value => {
        readOrder.push('snapshot-finish');
        resolve(value);
      };
    }));
    mocks.fetchCollections.mockImplementationOnce(async () => {
      readOrder.push('collections');
      return [row('tasks', 'remote-task', { id: 'remote-task', title: 'Remote' }, {
        position: 0,
        accountVersion: 2,
      })];
    });

    const refresh = refreshDatabasePersistence();
    mocks.realtimeListener?.({
      requestId: '33333333-3333-4333-8333-333333333333',
      accountVersion: 2,
      changes: [{ collection: 'tasks', recordId: 'remote-task', revision: 1, deletedAt: null }],
    });
    expect(readOrder).toEqual(['snapshot-start']);

    resolveSnapshot(snapshot([], 1));
    await refresh;

    expect(readOrder).toEqual(['snapshot-start', 'snapshot-finish', 'collections']);
    expect(getSyncSessionSnapshot()).toMatchObject({ accountVersion: 2, status: 'ready' });
  });

  it('recovers a degraded snapshot automatically with bounded backoff', async () => {
    vi.useFakeTimers();
    try {
      await bootstrapDatabasePersistence();
      mocks.fetchSnapshot
        .mockRejectedValueOnce(new Error('network unavailable'))
        .mockResolvedValueOnce(snapshot([
          row('tasks', 'task-recovered', { id: 'task-recovered', title: 'Recovered' }, { position: 0, accountVersion: 2 }),
        ], 2));
      mocks.probeVersion.mockResolvedValue(2);

      await refreshDatabasePersistence();
      expect(getSyncSessionSnapshot()).toMatchObject({ readOnly: true, reason: 'database_unavailable' });

      await vi.advanceTimersByTimeAsync(1_000);
      await vi.waitFor(() => expect(getSyncSessionSnapshot().status).toBe('ready'));
      await expect(loadStore('tasks')).resolves.toEqual([{ id: 'task-recovered', title: 'Recovered' }]);
    } finally {
      vi.useRealTimers();
    }
  });

  it('destroys the previous account cache before an account switch can render', async () => {
    mocks.fetchSnapshot.mockResolvedValue(snapshot([
      row('tasks', 'account-a-task', { id: 'account-a-task', title: 'Account A' }, { position: 0 }),
    ]));
    await bootstrapDatabasePersistence();
    await expect(loadStore('tasks')).resolves.toEqual([
      { id: 'account-a-task', title: 'Account A' },
    ]);

    mocks.currentUserId = SECOND_USER_ID;
    mocks.fetchSnapshot.mockResolvedValue(snapshot([
      row('tasks', 'account-b-task', { id: 'account-b-task', title: 'Account B' }, {
        position: 0,
        userId: SECOND_USER_ID,
      }),
    ], 1, SECOND_USER_ID));
    const switching = bootstrapDatabasePersistence();

    await expect(loadStore('tasks')).resolves.toBeNull();
    await switching;
    await expect(loadStore('tasks')).resolves.toEqual([
      { id: 'account-b-task', title: 'Account B' },
    ]);
  });

  it('restores a tombstone explicitly instead of trying to recreate it', async () => {
    mocks.fetchSnapshot.mockResolvedValue(snapshot([
      row('tasks', 'task-restored', { id: 'task-restored', title: 'Before delete' }, {
        position: 0,
        deletedAt: '2026-07-31T12:10:00.000Z',
      }),
    ]));
    await bootstrapDatabasePersistence();
    await loadStore('tasks');

    await saveStore('tasks', [{ id: 'task-restored', title: 'Restored safely' }]);
    await flushPendingRemoteMutations();

    const operations = mocks.apply.mock.calls.at(-1)?.[1] as Array<{ op: string }>;
    expect(operations.map(operation => operation.op)).toEqual(['restore', 'patch', 'reorder']);
    expect(operations.some(operation => operation.op === 'create')).toBe(false);
  });

  it('closes the snapshot-to-Broadcast race with an authoritative version probe', async () => {
    mocks.fetchSnapshot
      .mockResolvedValueOnce(snapshot([
        row('tasks', 'task-1', { id: 'task-1', title: 'Initial snapshot' }, { position: 0 }),
      ], 1))
      .mockResolvedValueOnce(snapshot([
        row('tasks', 'task-1', { id: 'task-1', title: 'Missed committed update' }, {
          position: 0,
          revision: 2,
          accountVersion: 2,
        }),
      ], 2));
    mocks.probeVersion.mockResolvedValue(2);

    await bootstrapDatabasePersistence();

    expect(mocks.fetchSnapshot).toHaveBeenCalledTimes(2);
    expect(getSyncSessionSnapshot().accountVersion).toBe(2);
    await expect(loadStore('tasks')).resolves.toEqual([
      { id: 'task-1', title: 'Missed committed update' },
    ]);
  });
});
