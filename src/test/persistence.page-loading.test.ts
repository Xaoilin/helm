import { afterEach, beforeEach, expect, it, vi } from 'vitest';
import type { HelmRecord } from '../store/databaseTypes';

const database = vi.hoisted(() => ({
  isSupabaseReady: vi.fn(() => true), isAuthenticated: vi.fn(() => true),
  getCurrentUserId: vi.fn(() => 'page-user'), fetchHelmAccountSnapshot: vi.fn(),
  fetchHelmChangedCollections: vi.fn(),
  fetchHelmCollections: vi.fn(),
  probeHelmAccountVersion: vi.fn(() => Promise.resolve(7)),
  subscribeHelmBroadcast: vi.fn(() => () => undefined),
  subscribeSupabaseRealtimeSnapshot: vi.fn(() => () => undefined),
  getSupabaseRealtimeSnapshot: vi.fn(() => ({ state: 'subscribed' })),
  applyHelmMutations: vi.fn(),
}));
vi.mock('../store/supabase', () => database);
import {
  activateStoreCollections, bootstrapDatabasePersistence, getStoreLoadState,
  loadStore, resetDatabasePersistence, saveStore, saveStoreCommitted,
  getSyncSessionSnapshot, releaseStoreCollections, subscribeHelmSecretChanges,
} from '../store/persistence';
import { PersistenceRecordCache } from '../store/persistence/cache';

function record(collection: string, id: string, position = 0): HelmRecord {
  return { userId: 'page-user', collection, recordId: id, payload: { id, title: id }, position,
    revision: 1, accountVersion: 7, createdAt: '2026-09-22T10:00:00Z', updatedAt: '2026-09-22T10:00:00Z', deletedAt: null };
}
// Calendar events and accounts stand in for page-scoped account collections; calendar sources for any
// other collection a page opens.
const records = [record('calendarEvents', 'project-1'), record('calendarAccounts', 'account-1')];
beforeEach(() => {
  vi.useFakeTimers();
  vi.setSystemTime(new Date('2026-09-22T10:00:00Z'));
  vi.clearAllMocks();
  database.getCurrentUserId.mockReturnValue('page-user');
  database.probeHelmAccountVersion.mockResolvedValue(7);
  database.fetchHelmChangedCollections.mockResolvedValue({ accountVersion: 7, collections: [], secretsChanged: false });
  database.fetchHelmAccountSnapshot.mockImplementation(async (keys: string[]) => ({
    state: { userId: 'page-user', schemaVersion: 1, accountVersion: 7, minimumClientVersion: '0.2.0' },
    records: records.filter(item => keys.includes(item.collection)),
  }));
  resetDatabasePersistence();
});
afterEach(() => { resetDatabasePersistence(); vi.useRealTimers(); });

it('loads only requested collections, coalesces page demand, and reuses fresh revisits', async () => {
  await bootstrapDatabasePersistence(['calendarSources']);
  expect(database.fetchHelmAccountSnapshot).toHaveBeenCalledExactlyOnceWith(['calendarSources']);
  let delivered = false;
  const pending = loadStore('calendarEvents').then(value => { delivered = true; return value; });
  await Promise.resolve();
  expect(delivered).toBe(false);
  expect(getStoreLoadState('calendarEvents').loaded).toBe(false);
  await saveStore('calendarEvents', []);
  await expect(saveStoreCommitted('calendarEvents', [])).rejects.toThrow('wait for its data');
  expect(database.applyHelmMutations).not.toHaveBeenCalled();
  await Promise.all([activateStoreCollections(['calendarEvents']), activateStoreCollections(['calendarEvents'])]);
  expect(await pending).toEqual([{ id: 'project-1', title: 'project-1' }]);
  expect(database.fetchHelmAccountSnapshot).toHaveBeenCalledTimes(2);
  await activateStoreCollections(['calendarSources']);
  await activateStoreCollections(['calendarEvents']);
  expect(database.fetchHelmAccountSnapshot).toHaveBeenCalledTimes(2);
  expect(getStoreLoadState('calendarSources')).toMatchObject({ loaded: true, complete: true });
  vi.setSystemTime(new Date('2026-09-22T10:11:00Z'));
  await activateStoreCollections(['calendarEvents']);
  expect(database.fetchHelmAccountSnapshot).toHaveBeenCalledTimes(3);
  expect(database.fetchHelmAccountSnapshot).toHaveBeenLastCalledWith(['calendarEvents']);
});

it('retains confirmed same-account data on a failed page and never reopens recovery on repeated activation', async () => {
  await bootstrapDatabasePersistence(['calendarEvents']);
  database.fetchHelmAccountSnapshot.mockRejectedValue(new TypeError('Failed to fetch'));
  await expect(activateStoreCollections(['calendarAccounts'])).rejects.toThrow('Failed to fetch');
  expect(getSyncSessionSnapshot()).toMatchObject({ readOnly: true, hasUsableSnapshot: true });
  expect(getStoreLoadState('calendarAccounts').loaded).toBe(false);
  for (let index = 0; index < 20; index += 1) await expect(activateStoreCollections(['calendarAccounts'])).rejects.toThrow();
  expect(database.fetchHelmAccountSnapshot).toHaveBeenCalledTimes(2);
  expect(await loadStore('calendarEvents')).toEqual([{ id: 'project-1', title: 'project-1' }]);
  await expect(saveStoreCommitted('calendarAccounts', [])).rejects.toThrow('session is ready');
  expect(database.applyHelmMutations).not.toHaveBeenCalled();
});

it('discards a page read completing after account reset and releases unloaded readers', async () => {
  await bootstrapDatabasePersistence(['calendarSources']);
  const waiting = loadStore('calendarAccounts');
  let finish!: (value: unknown) => void;
  database.fetchHelmAccountSnapshot.mockImplementationOnce(() => new Promise(resolve => { finish = resolve; }));
  const pending = activateStoreCollections(['calendarAccounts']);
  resetDatabasePersistence();
  database.getCurrentUserId.mockReturnValue('second-user');
  finish({ state: { schemaVersion: 1, accountVersion: 7, minimumClientVersion: '0.2.0' }, records });
  await expect(pending).rejects.toThrow('account changed');
  expect(await waiting).toBeNull();
  expect(getStoreLoadState('calendarAccounts').loaded).toBe(false);
});

it('reconciles a missed change in loaded data before a new page advances the global checkpoint', async () => {
  let version = 7;
  let broadcast!: (event: { accountVersion: number; changes: Array<{ collection: string }> }) => void;
  database.subscribeHelmBroadcast.mockImplementation((...args: unknown[]) => {
    broadcast = args[0] as typeof broadcast;
    return () => undefined;
  });
  database.fetchHelmAccountSnapshot.mockImplementation(async (keys: string[]) => ({
    state: { userId: 'page-user', schemaVersion: 1, accountVersion: version, minimumClientVersion: '0.2.0' },
    records: [
      { ...record('calendarSources', 'goal-1'), payload: { id: 'goal-1', stage: version === 7 ? 'searching' : 'interviewing' }, accountVersion: version },
      ...records,
    ].filter(item => keys.includes(item.collection)),
  }));
  await bootstrapDatabasePersistence(['calendarSources']);
  expect(await loadStore('calendarSources')).toEqual([{ id: 'goal-1', stage: 'searching' }]);
  version = 8;
  database.probeHelmAccountVersion.mockResolvedValue(8);
  database.fetchHelmChangedCollections.mockResolvedValue({ accountVersion: 8, collections: ['calendarSources'], secretsChanged: false });
  await activateStoreCollections(['calendarSources', 'calendarAccounts']);
  expect(database.fetchHelmAccountSnapshot).toHaveBeenLastCalledWith(['calendarSources']);
  expect(await loadStore('calendarSources')).toEqual([{ id: 'goal-1', stage: 'interviewing' }]);
  expect(getSyncSessionSnapshot().accountVersion).toBe(8);
  broadcast({ accountVersion: 8, changes: [{ collection: 'calendarSources' }] });
  await vi.advanceTimersByTimeAsync(600_000);
  expect(await loadStore('calendarSources')).toEqual([{ id: 'goal-1', stage: 'interviewing' }]);
  expect(database.fetchHelmAccountSnapshot).toHaveBeenCalledTimes(3);
});

function eventServer() {
  let version = 7;
  const rows = new Map(records.map(row => [row.collection, row]));
  let broadcast!: (event: { accountVersion: number; changes: Array<{ collection: string }> }) => void;
  database.subscribeHelmBroadcast.mockImplementation((...args: unknown[]) => {
    broadcast = args[0] as typeof broadcast;
    return () => undefined;
  });
  database.probeHelmAccountVersion.mockImplementation(async () => version);
  database.fetchHelmChangedCollections.mockImplementation(async (since: number) => ({
    accountVersion: version, secretsChanged: false,
    collections: [...rows.values()].filter(row => row.accountVersion > since).map(row => row.collection),
  }));
  database.fetchHelmAccountSnapshot.mockImplementation(async (keys: string[]) => ({
    state: { userId: 'page-user', schemaVersion: 1, accountVersion: version, minimumClientVersion: '0.2.0' },
    records: [...rows.values()].filter(row => keys.includes(row.collection)),
  }));
  return {
    change(collection: string, title: string) {
      version += 1;
      const previous = rows.get(collection) ?? record(collection, `${collection}-1`);
      const next = { ...previous, payload: { ...previous.payload, title }, accountVersion: version, revision: previous.revision + 1 };
      rows.set(collection, next);
      return next;
    },
    emit(collection: string, atVersion = version) {
      broadcast({ accountVersion: atVersion, changes: [{ collection }] });
    },
  };
}

it('refreshes only affected active collections and invalidates inactive cached data until a revisit', async () => {
  const server = eventServer();
  await bootstrapDatabasePersistence(['calendarSources', 'calendarEvents']);
  await activateStoreCollections(['calendarSources', 'calendarAccounts']);
  database.fetchHelmAccountSnapshot.mockClear();
  server.change('calendarEvents', 'Changed while inactive');
  server.emit('calendarEvents');
  await vi.waitFor(() => expect(getSyncSessionSnapshot().accountVersion).toBe(8));
  expect(database.fetchHelmAccountSnapshot).not.toHaveBeenCalled();
  expect(await loadStore('calendarEvents')).toEqual([{ id: 'project-1', title: 'project-1' }]);
  await activateStoreCollections(['calendarSources', 'calendarEvents']);
  expect(database.fetchHelmAccountSnapshot).toHaveBeenCalledExactlyOnceWith(['calendarEvents']);
  expect(await loadStore('calendarEvents')).toEqual([{ id: 'project-1', title: 'Changed while inactive' }]);
  database.fetchHelmAccountSnapshot.mockClear();
  server.change('calendarEvents', 'Prompt update');
  server.emit('calendarEvents');
  await vi.waitFor(() => expect(getSyncSessionSnapshot().accountVersion).toBe(9));
  expect(database.fetchHelmAccountSnapshot).toHaveBeenCalledExactlyOnceWith(['calendarEvents']);
  server.emit('calendarEvents', 8);
  server.emit('calendarEvents', 9);
  await vi.advanceTimersByTimeAsync(1);
  expect(database.fetchHelmAccountSnapshot).toHaveBeenCalledTimes(1);
});

it('a newer local confirmation cannot hide a missed write in another active scope', async () => {
  const server = eventServer();
  await bootstrapDatabasePersistence(['calendarSources', 'calendarEvents', 'calendarAccounts']);
  await loadStore('calendarAccounts');
  server.change('calendarEvents', 'Missed remote change');
  const local = server.change('calendarAccounts', 'Confirmed here');
  database.applyHelmMutations.mockResolvedValue({ requestId: 'local', accountVersion: 9, changes: [local] });
  await saveStoreCommitted('calendarAccounts', [local.payload]);
  expect(getSyncSessionSnapshot().accountVersion).toBe(9);
  expect(await loadStore('calendarAccounts')).toEqual([local.payload]);
  database.fetchHelmAccountSnapshot.mockClear();
  server.emit('calendarAccounts');
  await vi.waitFor(() => expect(database.fetchHelmChangedCollections).toHaveBeenCalledWith(7));
  await vi.waitFor(async () => expect(await loadStore('calendarEvents')).toEqual([{ id: 'project-1', title: 'Missed remote change' }]));
  expect(database.fetchHelmAccountSnapshot).toHaveBeenCalledExactlyOnceWith(['calendarEvents', 'calendarAccounts']);
  server.emit('calendarEvents', 8);
  await vi.advanceTimersByTimeAsync(1);
  expect(database.fetchHelmAccountSnapshot).toHaveBeenCalledTimes(1);
});

it('retains both scopes when a newer event arrives during metadata reconciliation', async () => {
  const server = eventServer();
  await bootstrapDatabasePersistence(['calendarSources', 'calendarEvents', 'calendarAccounts']);
  let finish!: (value: unknown) => void;
  database.fetchHelmChangedCollections.mockImplementationOnce(() => new Promise(resolve => { finish = resolve; }));
  server.change('calendarAccounts', 'First');
  server.emit('calendarAccounts');
  await vi.waitFor(() => expect(finish).toBeTypeOf('function'));
  server.change('calendarEvents', 'Second');
  server.emit('calendarEvents');
  server.emit('calendarAccounts', 8);
  finish({ accountVersion: 8, collections: ['calendarAccounts'], secretsChanged: false });
  await vi.waitFor(async () => expect(await loadStore('calendarEvents')).toEqual([{ id: 'project-1', title: 'Second' }]));
  expect(await loadStore('calendarAccounts')).toEqual([{ id: 'account-1', title: 'First' }]);
  expect(database.fetchHelmChangedCollections).toHaveBeenCalledWith(8);
  expect(getSyncSessionSnapshot()).toMatchObject({ accountVersion: 9, readOnly: false });
});

it('keeps assistant demand active across navigation and refreshes stale data when reopened', async () => {
  const server = eventServer();
  await bootstrapDatabasePersistence(['calendarSources']);
  await activateStoreCollections(['calendarSources', 'calendarEvents'], 'assistant');
  await activateStoreCollections(['calendarSources', 'calendarAccounts']);
  database.fetchHelmAccountSnapshot.mockClear();
  server.change('calendarEvents', 'Assistant still needs this');
  server.emit('calendarEvents');
  await vi.waitFor(() => expect(getSyncSessionSnapshot().accountVersion).toBe(8));
  expect(database.fetchHelmAccountSnapshot).toHaveBeenCalledExactlyOnceWith(['calendarEvents']);
  releaseStoreCollections('assistant');
  database.fetchHelmAccountSnapshot.mockClear();
  server.change('calendarEvents', 'Changed after close');
  server.emit('calendarEvents');
  await vi.waitFor(() => expect(getSyncSessionSnapshot().accountVersion).toBe(9));
  expect(database.fetchHelmAccountSnapshot).not.toHaveBeenCalled();
  await activateStoreCollections(['calendarSources', 'calendarEvents'], 'assistant');
  expect(database.fetchHelmAccountSnapshot).toHaveBeenCalledExactlyOnceWith(['calendarEvents']);
  expect(await loadStore('calendarEvents')).toEqual([{ id: 'project-1', title: 'Changed after close' }]);
});

it('invalidates secret summaries after a missed secret event without reading unrelated collections', async () => {
  await bootstrapDatabasePersistence(['calendarSources']);
  const listener = vi.fn();
  const remove = subscribeHelmSecretChanges(listener);
  database.probeHelmAccountVersion.mockResolvedValue(8);
  database.fetchHelmChangedCollections.mockResolvedValue({ accountVersion: 8, collections: [], secretsChanged: true });
  database.fetchHelmAccountSnapshot.mockImplementation(async () => ({
    state: { userId: 'page-user', schemaVersion: 1, accountVersion: 8, minimumClientVersion: '0.2.0' }, records: [],
  }));
  // Foreground reconnect uses the same lightweight version/delta reconciliation.
  window.dispatchEvent(new Event('online'));
  await vi.waitFor(() => expect(listener).toHaveBeenCalledExactlyOnceWith({ accountVersion: 8, reconciliation: true }));
  expect(database.fetchHelmAccountSnapshot).toHaveBeenCalledTimes(1);
  expect(getSyncSessionSnapshot().accountVersion).toBe(8);
  remove();
});

it('does not let an older mutation receipt replace a newer record revision', () => {
  const cache = new PersistenceRecordCache();
  const newer = { ...record('calendarEvents', 'project-1'), revision: 3, accountVersion: 10, payload: { title: 'Newer' } };
  cache.applyChanges([newer]);
  cache.applyChanges([{ ...newer, revision: 2, accountVersion: 9, payload: { title: 'Older receipt' } }]);
  expect(cache.decoded('calendarEvents')).toEqual([{ id: 'project-1', title: 'Newer' }]);
});

it('publishes a confirmed page after navigation away and a subsequent metadata failure', async () => {
  const server = eventServer();
  await bootstrapDatabasePersistence(['calendarSources']);
  const waiting = loadStore('calendarAccounts');
  server.change('calendarAccounts', 'Confirmed page');
  let fail!: (error: Error) => void;
  database.fetchHelmChangedCollections.mockImplementationOnce(() => new Promise((_resolve, reject) => { fail = reject; }));
  const activation = activateStoreCollections(['calendarSources', 'calendarAccounts']);
  await vi.waitFor(() => expect(fail).toBeTypeOf('function'));
  const navigation = activateStoreCollections(['calendarSources']).catch(error => error);
  fail(new Error('Metadata unavailable'));
  await expect(activation).rejects.toThrow('Metadata unavailable');
  expect(await navigation).toBeInstanceOf(Error);
  expect(await waiting).toEqual([{ id: 'account-1', title: 'Confirmed page' }]);
  expect(getSyncSessionSnapshot()).toMatchObject({ readOnly: true, hasUsableSnapshot: true });
});
