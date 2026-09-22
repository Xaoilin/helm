import { afterEach, beforeEach, expect, it, vi } from 'vitest';
import type { HelmRecord } from '../store/databaseTypes';

const database = vi.hoisted(() => ({
  isSupabaseReady: vi.fn(() => true), isAuthenticated: vi.fn(() => true),
  getCurrentUserId: vi.fn(() => 'page-user'), fetchHelmAccountSnapshot: vi.fn(),
  fetchHelmChangedCollections: vi.fn(),
  fetchHelmCollections: vi.fn(), fetchHelmCollectionPage: vi.fn(),
  probeHelmAccountVersion: vi.fn(() => Promise.resolve(7)),
  subscribeHelmBroadcast: vi.fn(() => () => undefined),
  subscribeSupabaseRealtimeSnapshot: vi.fn(() => () => undefined),
  getSupabaseRealtimeSnapshot: vi.fn(() => ({ state: 'subscribed' })),
  applyHelmMutations: vi.fn(), applyHelmInventoryMutations: vi.fn(),
}));
vi.mock('../store/supabase', () => database);
import {
  activateStoreCollections, bootstrapDatabasePersistence, getStoreLoadState,
  loadMoreStoreRecords, loadStore, resetDatabasePersistence, saveStore, saveStoreCommitted,
  getSyncSessionSnapshot, releaseStoreCollections, subscribeHelmSecretChanges,
} from '../store/persistence';
import { PersistenceRecordCache } from '../store/persistence/cache';

function record(collection: string, id: string, position = 0): HelmRecord {
  return { userId: 'page-user', collection, recordId: id, payload: { id, title: id }, position,
    revision: 1, accountVersion: 7, createdAt: '2026-09-22T10:00:00Z', updatedAt: '2026-09-22T10:00:00Z', deletedAt: null };
}
const records = [record('projects', 'project-1'), record('trips', 'trip-1')];
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
  await bootstrapDatabasePersistence(['settings']);
  expect(database.fetchHelmAccountSnapshot).toHaveBeenCalledExactlyOnceWith(['settings']);
  let delivered = false;
  const pending = loadStore('projects').then(value => { delivered = true; return value; });
  await Promise.resolve();
  expect(delivered).toBe(false);
  expect(getStoreLoadState('projects').loaded).toBe(false);
  await saveStore('projects', []);
  await expect(saveStoreCommitted('projects', [])).rejects.toThrow('wait for its data');
  expect(database.applyHelmMutations).not.toHaveBeenCalled();
  await Promise.all([activateStoreCollections(['projects']), activateStoreCollections(['projects'])]);
  expect(await pending).toEqual([{ id: 'project-1', title: 'project-1' }]);
  expect(database.fetchHelmAccountSnapshot).toHaveBeenCalledTimes(2);
  await activateStoreCollections(['settings']);
  await activateStoreCollections(['projects']);
  expect(database.fetchHelmAccountSnapshot).toHaveBeenCalledTimes(2);
  expect(getStoreLoadState('settings')).toMatchObject({ loaded: true, complete: true });
  vi.setSystemTime(new Date('2026-09-22T10:11:00Z'));
  await activateStoreCollections(['projects']);
  expect(database.fetchHelmAccountSnapshot).toHaveBeenCalledTimes(3);
  expect(database.fetchHelmAccountSnapshot).toHaveBeenLastCalledWith(['projects']);
});

it('retains confirmed same-account data on a failed page and never reopens recovery on repeated activation', async () => {
  await bootstrapDatabasePersistence(['projects']);
  database.fetchHelmAccountSnapshot.mockRejectedValue(new TypeError('Failed to fetch'));
  await expect(activateStoreCollections(['trips'])).rejects.toThrow('Failed to fetch');
  expect(getSyncSessionSnapshot()).toMatchObject({ readOnly: true, hasUsableSnapshot: true });
  expect(getStoreLoadState('trips').loaded).toBe(false);
  for (let index = 0; index < 20; index += 1) await expect(activateStoreCollections(['trips'])).rejects.toThrow();
  expect(database.fetchHelmAccountSnapshot).toHaveBeenCalledTimes(2);
  expect(await loadStore('projects')).toEqual([{ id: 'project-1', title: 'project-1' }]);
  await expect(saveStoreCommitted('trips', [])).rejects.toThrow('session is ready');
  expect(database.applyHelmMutations).not.toHaveBeenCalled();
});

it('discards a page read completing after account reset and releases unloaded readers', async () => {
  await bootstrapDatabasePersistence(['settings']);
  const waiting = loadStore('trips');
  let finish!: (value: unknown) => void;
  database.fetchHelmAccountSnapshot.mockImplementationOnce(() => new Promise(resolve => { finish = resolve; }));
  const pending = activateStoreCollections(['trips']);
  resetDatabasePersistence();
  database.getCurrentUserId.mockReturnValue('second-user');
  finish({ state: { schemaVersion: 1, accountVersion: 7, minimumClientVersion: '0.2.0' }, records });
  await expect(pending).rejects.toThrow('account changed');
  expect(await waiting).toBeNull();
  expect(getStoreLoadState('trips').loaded).toBe(false);
});

it('loads subsequent activity pages only on demand and preserves unseen records during edits', async () => {
  const all = Array.from({ length: 110 }, (_, i) => record('assistantActivityLog', `activity-${i}`, i));
  database.fetchHelmCollectionPage.mockImplementation(async (_key: string, offset: number, limit: number) => ({
    records: all.slice(offset, offset + limit), hasMore: offset + limit < all.length,
  }));
  await bootstrapDatabasePersistence(['settings']);
  expect(database.fetchHelmCollectionPage).not.toHaveBeenCalled();
  await activateStoreCollections(['assistantActivityLog']);
  expect(database.fetchHelmAccountSnapshot).toHaveBeenLastCalledWith([]);
  expect((await loadStore<unknown[]>('assistantActivityLog'))?.length).toBe(50);
  expect(getStoreLoadState('assistantActivityLog').complete).toBe(false);
  await Promise.all([loadMoreStoreRecords('assistantActivityLog'), loadMoreStoreRecords('assistantActivityLog')]);
  expect((await loadStore<unknown[]>('assistantActivityLog'))?.length).toBe(100);
  expect(database.fetchHelmCollectionPage).toHaveBeenCalledTimes(2);
  expect(database.fetchHelmCollectionPage).toHaveBeenLastCalledWith('assistantActivityLog', 50, 50);
  await loadMoreStoreRecords('assistantActivityLog');
  expect((await loadStore<unknown[]>('assistantActivityLog'))?.length).toBe(110);
  expect(getStoreLoadState('assistantActivityLog').complete).toBe(true);
  await loadMoreStoreRecords('assistantActivityLog');
  expect(database.fetchHelmCollectionPage).toHaveBeenCalledTimes(3);

  const cache = new PersistenceRecordCache();
  cache.replaceCollection('assistantActivityLog', all.slice(0, 50));
  cache.confirm('assistantActivityLog', false, 50);
  cache.markDeliveredFromCache('assistantActivityLog');
  cache.applyChanges(all.slice(50));
  const desired = all.slice(0, 50).map(row => row.payload);
  desired[0] = { ...desired[0], title: 'Changed' };
  const mutations = cache.buildMutations('assistantActivityLog', desired);
  expect(mutations).toEqual([{ op: 'patch', collection: 'assistantActivityLog', recordId: 'activity-0', set: { title: 'Changed' }, unset: [] }]);
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
      { ...record('settings', 'singleton'), payload: { theme: version === 7 ? 'dark' : 'light' }, accountVersion: version },
      ...records,
    ].filter(item => keys.includes(item.collection)),
  }));
  await bootstrapDatabasePersistence(['settings']);
  expect(await loadStore('settings')).toEqual({ theme: 'dark' });
  version = 8;
  database.probeHelmAccountVersion.mockResolvedValue(8);
  database.fetchHelmChangedCollections.mockResolvedValue({ accountVersion: 8, collections: ['settings'], secretsChanged: false });
  await activateStoreCollections(['settings', 'trips']);
  expect(database.fetchHelmAccountSnapshot).toHaveBeenLastCalledWith(['settings']);
  expect(await loadStore('settings')).toEqual({ theme: 'light' });
  expect(getSyncSessionSnapshot().accountVersion).toBe(8);
  broadcast({ accountVersion: 8, changes: [{ collection: 'settings' }] });
  await vi.advanceTimersByTimeAsync(600_000);
  expect(await loadStore('settings')).toEqual({ theme: 'light' });
  expect(database.fetchHelmAccountSnapshot).toHaveBeenCalledTimes(3);
});

it('rejects an older staged paged response after a newer confirmed write', async () => {
  const old = record('assistantActivityLog', 'action-1');
  database.fetchHelmCollectionPage.mockResolvedValue({ records: [old], hasMore: false });
  await bootstrapDatabasePersistence(['settings', 'assistantActivityLog']);
  await loadStore('assistantActivityLog');
  let finishPage!: (value: unknown) => void;
  database.fetchHelmCollectionPage.mockImplementationOnce(() => new Promise(resolve => { finishPage = resolve; }));
  vi.setSystemTime(new Date('2026-09-22T10:11:00Z'));
  const pending = activateStoreCollections(['assistantActivityLog']);
  await vi.waitFor(() => expect(database.fetchHelmCollectionPage).toHaveBeenCalledTimes(2));
  const updated = { ...old, payload: { ...old.payload, title: 'Confirmed newer' }, accountVersion: 8, revision: 2 };
  database.applyHelmMutations.mockResolvedValue({ requestId: 'write', changes: [updated], accountVersion: 8 });
  await saveStoreCommitted('assistantActivityLog', [updated.payload]);
  database.probeHelmAccountVersion.mockResolvedValue(8);
  finishPage({ records: [old], hasMore: false });
  await expect(pending).rejects.toThrow('changed while loading');
  expect(await loadStore('assistantActivityLog')).toEqual([updated.payload]);
  expect(getSyncSessionSnapshot().accountVersion).toBe(8);
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
  await bootstrapDatabasePersistence(['settings', 'projects']);
  await activateStoreCollections(['settings', 'trips']);
  database.fetchHelmAccountSnapshot.mockClear();
  server.change('projects', 'Changed while inactive');
  server.emit('projects');
  await vi.waitFor(() => expect(getSyncSessionSnapshot().accountVersion).toBe(8));
  expect(database.fetchHelmAccountSnapshot).not.toHaveBeenCalled();
  expect(await loadStore('projects')).toEqual([{ id: 'project-1', title: 'project-1' }]);
  await activateStoreCollections(['settings', 'projects']);
  expect(database.fetchHelmAccountSnapshot).toHaveBeenCalledExactlyOnceWith(['projects']);
  expect(await loadStore('projects')).toEqual([{ id: 'project-1', title: 'Changed while inactive' }]);
  database.fetchHelmAccountSnapshot.mockClear();
  server.change('projects', 'Prompt update');
  server.emit('projects');
  await vi.waitFor(() => expect(getSyncSessionSnapshot().accountVersion).toBe(9));
  expect(database.fetchHelmAccountSnapshot).toHaveBeenCalledExactlyOnceWith(['projects']);
  server.emit('projects', 8);
  server.emit('projects', 9);
  await vi.advanceTimersByTimeAsync(1);
  expect(database.fetchHelmAccountSnapshot).toHaveBeenCalledTimes(1);
});

it('a newer local confirmation cannot hide a missed write in another active scope', async () => {
  const server = eventServer();
  await bootstrapDatabasePersistence(['settings', 'projects', 'trips']);
  await loadStore('trips');
  server.change('projects', 'Missed remote change');
  const local = server.change('trips', 'Confirmed here');
  database.applyHelmMutations.mockResolvedValue({ requestId: 'local', accountVersion: 9, changes: [local] });
  await saveStoreCommitted('trips', [local.payload]);
  expect(getSyncSessionSnapshot().accountVersion).toBe(9);
  expect(await loadStore('trips')).toEqual([local.payload]);
  database.fetchHelmAccountSnapshot.mockClear();
  server.emit('trips');
  await vi.waitFor(() => expect(database.fetchHelmChangedCollections).toHaveBeenCalledWith(7));
  await vi.waitFor(async () => expect(await loadStore('projects')).toEqual([{ id: 'project-1', title: 'Missed remote change' }]));
  expect(database.fetchHelmAccountSnapshot).toHaveBeenCalledExactlyOnceWith(['projects', 'trips']);
  server.emit('projects', 8);
  await vi.advanceTimersByTimeAsync(1);
  expect(database.fetchHelmAccountSnapshot).toHaveBeenCalledTimes(1);
});

it('retains both scopes when a newer event arrives during metadata reconciliation', async () => {
  const server = eventServer();
  await bootstrapDatabasePersistence(['settings', 'projects', 'trips']);
  let finish!: (value: unknown) => void;
  database.fetchHelmChangedCollections.mockImplementationOnce(() => new Promise(resolve => { finish = resolve; }));
  server.change('trips', 'First');
  server.emit('trips');
  await vi.waitFor(() => expect(finish).toBeTypeOf('function'));
  server.change('projects', 'Second');
  server.emit('projects');
  server.emit('trips', 8);
  finish({ accountVersion: 8, collections: ['trips'], secretsChanged: false });
  await vi.waitFor(async () => expect(await loadStore('projects')).toEqual([{ id: 'project-1', title: 'Second' }]));
  expect(await loadStore('trips')).toEqual([{ id: 'trip-1', title: 'First' }]);
  expect(database.fetchHelmChangedCollections).toHaveBeenCalledWith(8);
  expect(getSyncSessionSnapshot()).toMatchObject({ accountVersion: 9, readOnly: false });
});

it('keeps assistant demand active across navigation and refreshes stale data when reopened', async () => {
  const server = eventServer();
  await bootstrapDatabasePersistence(['settings']);
  await activateStoreCollections(['settings', 'projects'], 'assistant');
  await activateStoreCollections(['settings', 'trips']);
  database.fetchHelmAccountSnapshot.mockClear();
  server.change('projects', 'Assistant still needs this');
  server.emit('projects');
  await vi.waitFor(() => expect(getSyncSessionSnapshot().accountVersion).toBe(8));
  expect(database.fetchHelmAccountSnapshot).toHaveBeenCalledExactlyOnceWith(['projects']);
  releaseStoreCollections('assistant');
  database.fetchHelmAccountSnapshot.mockClear();
  server.change('projects', 'Changed after close');
  server.emit('projects');
  await vi.waitFor(() => expect(getSyncSessionSnapshot().accountVersion).toBe(9));
  expect(database.fetchHelmAccountSnapshot).not.toHaveBeenCalled();
  await activateStoreCollections(['settings', 'projects'], 'assistant');
  expect(database.fetchHelmAccountSnapshot).toHaveBeenCalledExactlyOnceWith(['projects']);
  expect(await loadStore('projects')).toEqual([{ id: 'project-1', title: 'Changed after close' }]);
});

it('invalidates secret summaries after a missed secret event without reading unrelated collections', async () => {
  await bootstrapDatabasePersistence(['settings']);
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
  const newer = { ...record('projects', 'project-1'), revision: 3, accountVersion: 10, payload: { title: 'Newer' } };
  cache.applyChanges([newer]);
  cache.applyChanges([{ ...newer, revision: 2, accountVersion: 9, payload: { title: 'Older receipt' } }]);
  expect(cache.decoded('projects')).toEqual([{ id: 'project-1', title: 'Newer' }]);
});

it('publishes a confirmed page after navigation away and a subsequent metadata failure', async () => {
  const server = eventServer();
  await bootstrapDatabasePersistence(['settings']);
  const waiting = loadStore('trips');
  server.change('trips', 'Confirmed page');
  let fail!: (error: Error) => void;
  database.fetchHelmChangedCollections.mockImplementationOnce(() => new Promise((_resolve, reject) => { fail = reject; }));
  const activation = activateStoreCollections(['settings', 'trips']);
  await vi.waitFor(() => expect(fail).toBeTypeOf('function'));
  const navigation = activateStoreCollections(['settings']).catch(error => error);
  fail(new Error('Metadata unavailable'));
  await expect(activation).rejects.toThrow('Metadata unavailable');
  expect(await navigation).toBeInstanceOf(Error);
  expect(await waiting).toEqual([{ id: 'trip-1', title: 'Confirmed page' }]);
  expect(getSyncSessionSnapshot()).toMatchObject({ readOnly: true, hasUsableSnapshot: true });
});
