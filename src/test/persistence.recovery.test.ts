import { afterEach, expect, it, vi } from 'vitest';

const database = vi.hoisted(() => ({
  isSupabaseReady: vi.fn(() => true),
  isAuthenticated: vi.fn(() => true),
  getCurrentUserId: vi.fn((): string | null => 'recovery-account'),
  // The auth server has ended the session: renewal finds none.
  getFreshAccessToken: vi.fn(async (): Promise<string | null> => null),
  fetchHelmAccountSnapshot: vi.fn(),
  fetchHelmCollections: vi.fn(),
  probeHelmAccountVersion: vi.fn(),
  subscribeHelmBroadcast: vi.fn(() => vi.fn()),
  subscribeSupabaseRealtimeSnapshot: vi.fn(() => vi.fn()),
  getSupabaseRealtimeSnapshot: vi.fn(() => ({ state: 'subscribed', lastError: null })),
  applyHelmMutations: vi.fn(),
  applyHelmInventoryMutations: vi.fn(),
}));
vi.mock('../store/supabase', () => database);

import {
  bootstrapDatabasePersistence, getSyncSessionSnapshot, loadStore,
  refreshDatabasePersistence, resetDatabasePersistence,
} from '../store/persistence';

const record = {
  userId: 'recovery-account', collection: 'employment', recordId: 'singleton',
  payload: { stage: 'searching' }, position: null, revision: 1, accountVersion: 7,
  createdAt: '2026-09-22T12:00:00.000Z', updatedAt: '2026-09-22T12:00:00.000Z', deletedAt: null,
};
const snapshot = {
  state: {
    userId: record.userId, schemaVersion: 1, accountVersion: 7,
    minimumClientVersion: '0.2.0', migratedAt: record.createdAt, updatedAt: record.updatedAt,
  },
  records: [record],
};

afterEach(() => {
  resetDatabasePersistence();
  vi.restoreAllMocks();
});

it('bounds a prolonged outage, suppresses hidden and duplicate work, and resumes safe reconciliation', async () => {
  vi.useFakeTimers();
  vi.spyOn(Math, 'random').mockReturnValue(0);
  const visible = vi.spyOn(document, 'visibilityState', 'get').mockReturnValue('visible');
  const online = vi.spyOn(navigator, 'onLine', 'get').mockReturnValue(true);
  database.fetchHelmAccountSnapshot.mockResolvedValue(snapshot);
  database.probeHelmAccountVersion.mockResolvedValue(7);
  let broadcast!: (event: { accountVersion: number; changes: Array<{ collection: string }> }) => void;
  database.subscribeHelmBroadcast.mockImplementation((...args: unknown[]) => {
    broadcast = args[0] as typeof broadcast;
    return vi.fn();
  });
  await bootstrapDatabasePersistence();
  database.fetchHelmAccountSnapshot.mockClear();
  database.probeHelmAccountVersion.mockClear();
  database.probeHelmAccountVersion.mockRejectedValue(new Error('database timeout'));

  // The first safety probe fails. Retries must stay lightweight and finite.
  await vi.advanceTimersByTimeAsync(600_000);
  await vi.advanceTimersByTimeAsync(120_000);
  expect(database.probeHelmAccountVersion).toHaveBeenCalledTimes(6);
  expect(database.fetchHelmAccountSnapshot).not.toHaveBeenCalled();
  expect(getSyncSessionSnapshot()).toMatchObject({ readOnly: true, hasUsableSnapshot: true });
  expect(await loadStore('employment')).toEqual({ stage: 'searching' });
  broadcast({ accountVersion: 8, changes: [{ collection: 'employment' }] });
  await bootstrapDatabasePersistence(); // Repeated same-account auth notification.
  await vi.advanceTimersByTimeAsync(60 * 60_000);
  expect(database.probeHelmAccountVersion).toHaveBeenCalledTimes(6);
  expect(database.fetchHelmCollections).not.toHaveBeenCalled();

  // Foreground resumes one cycle, then hiding cancels queued retries.
  document.dispatchEvent(new Event('visibilitychange'));
  await vi.advanceTimersByTimeAsync(0);
  expect(database.probeHelmAccountVersion).toHaveBeenCalledTimes(7);
  visible.mockReturnValue('hidden');
  document.dispatchEvent(new Event('visibilitychange'));
  await vi.advanceTimersByTimeAsync(120_000);
  expect(database.probeHelmAccountVersion).toHaveBeenCalledTimes(7);
  online.mockReturnValue(false);
  window.dispatchEvent(new Event('offline'));
  visible.mockReturnValue('visible');
  document.dispatchEvent(new Event('visibilitychange'));
  await vi.advanceTimersByTimeAsync(120_000);
  expect(database.probeHelmAccountVersion).toHaveBeenCalledTimes(7);

  // Connectivity, foreground, and explicit retry coalesce behind the same probe.
  let resolveProbe!: (version: number) => void;
  database.probeHelmAccountVersion.mockImplementationOnce(() => new Promise<number>(resolve => { resolveProbe = resolve; }));
  online.mockReturnValue(true);
  window.dispatchEvent(new Event('online'));
  document.dispatchEvent(new Event('visibilitychange'));
  const explicit = refreshDatabasePersistence();
  await vi.advanceTimersByTimeAsync(60_000);
  expect(database.probeHelmAccountVersion).toHaveBeenCalledTimes(8);
  expect(database.fetchHelmAccountSnapshot).not.toHaveBeenCalled();
  database.probeHelmAccountVersion.mockResolvedValue(8);
  database.fetchHelmAccountSnapshot.mockResolvedValue({
    state: { ...snapshot.state, accountVersion: 8 },
    records: [{ ...record, accountVersion: 8, payload: { stage: 'interviewing' } }],
  });
  resolveProbe(8);
  await explicit;
  expect(database.fetchHelmAccountSnapshot).toHaveBeenCalledTimes(1);
  expect(await loadStore('employment')).toEqual({ stage: 'interviewing' });
  expect(getSyncSessionSnapshot()).toMatchObject({ status: 'ready', readOnly: false, accountVersion: 8 });

  database.probeHelmAccountVersion.mockRejectedValue({ status: 401, message: 'invalid authorization' });
  await refreshDatabasePersistence();
  await vi.waitFor(async () => expect(await loadStore('employment')).toBeNull());
  expect(getSyncSessionSnapshot()).toMatchObject({ status: 'blocked', hasUsableSnapshot: false });
  const callsAtInvalidation = database.probeHelmAccountVersion.mock.calls.length;
  await vi.advanceTimersByTimeAsync(120_000);
  expect(database.probeHelmAccountVersion).toHaveBeenCalledTimes(callsAtInvalidation);
});

it('coalesces lifecycle recovery with initial hydration and retries a failed boot through a probe', async () => {
  vi.useFakeTimers();
  vi.spyOn(Math, 'random').mockReturnValue(0);
  vi.spyOn(document, 'visibilityState', 'get').mockReturnValue('visible');
  database.fetchHelmAccountSnapshot.mockReset();
  database.probeHelmAccountVersion.mockReset();
  database.probeHelmAccountVersion.mockRejectedValue(new Error('database timeout'));
  let rejectSnapshot!: (error: Error) => void;
  database.fetchHelmAccountSnapshot.mockImplementationOnce(() => new Promise((_, reject) => { rejectSnapshot = reject; }));
  const boot = bootstrapDatabasePersistence();
  window.dispatchEvent(new Event('online'));
  document.dispatchEvent(new Event('visibilitychange'));
  const retryDuringBoot = refreshDatabasePersistence();
  expect(database.fetchHelmAccountSnapshot).toHaveBeenCalledTimes(1);
  expect(database.probeHelmAccountVersion).not.toHaveBeenCalled();
  rejectSnapshot(new Error('snapshot timeout'));
  await Promise.all([boot, retryDuringBoot]);
  await bootstrapDatabasePersistence();
  await vi.advanceTimersByTimeAsync(120_000);
  expect(database.fetchHelmAccountSnapshot).toHaveBeenCalledTimes(1);
  expect(database.probeHelmAccountVersion).toHaveBeenCalledTimes(5);
  expect(getSyncSessionSnapshot()).toMatchObject({ status: 'blocked', hasUsableSnapshot: false });
  database.probeHelmAccountVersion.mockResolvedValue(7);
  database.fetchHelmAccountSnapshot.mockResolvedValue(snapshot);
  await refreshDatabasePersistence();
  expect(database.fetchHelmAccountSnapshot).toHaveBeenCalledTimes(2);
  expect(getSyncSessionSnapshot()).toMatchObject({ status: 'ready', hasUsableSnapshot: true });
});

it('preserves a newer Broadcast invalidation received during an active recovery probe', async () => {
  vi.useFakeTimers();
  vi.spyOn(Math, 'random').mockReturnValue(0);
  database.fetchHelmAccountSnapshot.mockReset().mockResolvedValue(snapshot);
  database.probeHelmAccountVersion.mockReset().mockResolvedValue(7);
  let broadcast!: (event: { accountVersion: number; changes: Array<{ collection: string }> }) => void;
  database.subscribeHelmBroadcast.mockImplementation((...args: unknown[]) => {
    broadcast = args[0] as typeof broadcast;
    return vi.fn();
  });
  await bootstrapDatabasePersistence();
  database.probeHelmAccountVersion.mockRejectedValueOnce(new Error('database timeout'));
  await refreshDatabasePersistence();
  let resolveProbe!: (version: number) => void;
  database.probeHelmAccountVersion.mockImplementationOnce(() => new Promise<number>(resolve => { resolveProbe = resolve; }));
  await vi.advanceTimersByTimeAsync(1_000);
  database.probeHelmAccountVersion.mockResolvedValue(8);
  database.fetchHelmCollections.mockResolvedValue([{ ...record, accountVersion: 8, payload: { stage: 'interviewing' } }]);
  broadcast({ accountVersion: 8, changes: [{ collection: 'employment' }] });
  resolveProbe(7); // This response was sampled before the Broadcast arrived.
  await vi.advanceTimersByTimeAsync(0);
  expect(await loadStore('employment')).toEqual({ stage: 'interviewing' });
  expect(getSyncSessionSnapshot()).toMatchObject({ status: 'ready', accountVersion: 8 });
  expect(database.fetchHelmAccountSnapshot).toHaveBeenCalledTimes(1);
});
