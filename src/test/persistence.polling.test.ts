import { afterEach, expect, it, vi } from 'vitest';

const database = vi.hoisted(() => ({
  isSupabaseReady: vi.fn(() => true),
  isAuthenticated: vi.fn(() => true),
  getCurrentUserId: vi.fn((): string | null => 'polling-account'),
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
  bootstrapDatabasePersistence,
  getSyncSessionSnapshot,
  loadStore,
  resetDatabasePersistence,
} from '../store/persistence';

afterEach(() => {
  resetDatabasePersistence();
  vi.restoreAllMocks();
});

it('checks idle visible accounts every ten minutes while preserving prompt coalesced reconciliation', async () => {
  vi.useFakeTimers();
  const visible = vi.spyOn(document, 'visibilityState', 'get').mockReturnValue('visible');
  const online = vi.spyOn(navigator, 'onLine', 'get').mockReturnValue(true);
  const record = {
    userId: 'polling-account', collection: 'settings', recordId: 'singleton',
    payload: { theme: 'dark' }, position: null, revision: 1, accountVersion: 7,
    createdAt: '2026-09-22T12:00:00.000Z', updatedAt: '2026-09-22T12:00:00.000Z', deletedAt: null,
  };
  database.fetchHelmAccountSnapshot.mockResolvedValue({
    state: {
      userId: record.userId, schemaVersion: 1, accountVersion: 7,
      minimumClientVersion: '0.2.0', migratedAt: record.createdAt, updatedAt: record.updatedAt,
    },
    records: [record],
  });
  database.probeHelmAccountVersion.mockResolvedValue(7);
  // Capture the real boundary's callback without substituting its refresh scheduler.
  let broadcast!: (event: { accountVersion: number; changes: Array<{ collection: string }> }) => void;
  database.subscribeHelmBroadcast.mockImplementation((...args: unknown[]) => {
    broadcast = args[0] as typeof broadcast;
    return vi.fn();
  });

  await bootstrapDatabasePersistence();
  expect(getSyncSessionSnapshot()).toMatchObject({ status: 'ready', accountVersion: 7 });
  expect(database.fetchHelmAccountSnapshot).toHaveBeenCalledTimes(1);
  expect(database.probeHelmAccountVersion).toHaveBeenCalledTimes(1);
  database.probeHelmAccountVersion.mockClear();
  database.fetchHelmAccountSnapshot.mockClear();

  await vi.advanceTimersByTimeAsync(599_999);
  expect(database.probeHelmAccountVersion).not.toHaveBeenCalled();
  await vi.advanceTimersByTimeAsync(1);
  expect(database.probeHelmAccountVersion).toHaveBeenCalledTimes(1);
  await vi.advanceTimersByTimeAsync(600_000);
  expect(database.probeHelmAccountVersion).toHaveBeenCalledTimes(2);
  expect(database.fetchHelmAccountSnapshot).not.toHaveBeenCalled();
  expect(await loadStore('settings')).toEqual({ theme: 'dark' });

  database.probeHelmAccountVersion.mockClear();
  visible.mockReturnValue('hidden');
  await vi.advanceTimersByTimeAsync(600_000);
  visible.mockReturnValue('visible');
  online.mockReturnValue(false);
  await vi.advanceTimersByTimeAsync(600_000);
  expect(database.probeHelmAccountVersion).not.toHaveBeenCalled();

  online.mockReturnValue(true);
  window.dispatchEvent(new Event('online'));
  document.dispatchEvent(new Event('visibilitychange'));
  document.dispatchEvent(new Event('visibilitychange'));
  await vi.advanceTimersByTimeAsync(0);
  expect(database.probeHelmAccountVersion).toHaveBeenCalledTimes(1);
  expect(database.fetchHelmAccountSnapshot).not.toHaveBeenCalled();

  database.probeHelmAccountVersion.mockClear();
  database.probeHelmAccountVersion.mockResolvedValue(8);
  database.fetchHelmCollections.mockResolvedValue([{ ...record, payload: { theme: 'light' }, accountVersion: 8 }]);
  broadcast({ accountVersion: 8, changes: [{ collection: 'settings' }] });
  broadcast({ accountVersion: 8, changes: [{ collection: 'settings' }] });
  document.dispatchEvent(new Event('visibilitychange'));
  window.dispatchEvent(new Event('online'));
  await vi.advanceTimersByTimeAsync(0);
  expect(database.fetchHelmCollections).toHaveBeenCalledExactlyOnceWith(['settings']);
  expect(database.probeHelmAccountVersion).toHaveBeenCalledTimes(1);
  expect(database.fetchHelmAccountSnapshot).not.toHaveBeenCalled();
  expect(await loadStore('settings')).toEqual({ theme: 'light' });
  expect(getSyncSessionSnapshot()).toMatchObject({ status: 'ready', accountVersion: 8 });

  database.probeHelmAccountVersion.mockClear();
  database.isAuthenticated.mockReturnValue(false);
  database.getCurrentUserId.mockReturnValue(null);
  resetDatabasePersistence();
  await vi.advanceTimersByTimeAsync(600_000);
  expect(database.probeHelmAccountVersion).not.toHaveBeenCalled();
  expect(await loadStore('settings')).toBeNull();
});
