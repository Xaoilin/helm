import { beforeEach, describe, expect, it, vi } from 'vitest';
import { invoke } from '@tauri-apps/api/core';

const {
  flushWriteQueueMock,
  getSupabaseRealtimeSnapshotMock,
  getSupabaseWriteQueueSnapshotMock,
  isAuthenticatedMock,
  isSupabaseReadyMock,
  loadRemoteMock,
  queueRemoteWriteMock,
  saveRemoteMock,
  subscribeRemoteStoreMock,
  subscribeSupabaseRealtimeSnapshotMock,
  subscribeSupabaseWriteQueueSnapshotMock,
} = vi.hoisted(() => ({
  flushWriteQueueMock: vi.fn(),
  getSupabaseRealtimeSnapshotMock: vi.fn(),
  getSupabaseWriteQueueSnapshotMock: vi.fn(),
  isAuthenticatedMock: vi.fn(),
  isSupabaseReadyMock: vi.fn(),
  loadRemoteMock: vi.fn(),
  queueRemoteWriteMock: vi.fn(),
  saveRemoteMock: vi.fn(),
  subscribeRemoteStoreMock: vi.fn(),
  subscribeSupabaseRealtimeSnapshotMock: vi.fn(),
  subscribeSupabaseWriteQueueSnapshotMock: vi.fn(),
}));

vi.mock('../store/supabase', () => ({
  flushWriteQueue: flushWriteQueueMock,
  getSupabaseRealtimeSnapshot: getSupabaseRealtimeSnapshotMock,
  getSupabaseWriteQueueSnapshot: getSupabaseWriteQueueSnapshotMock,
  isAuthenticated: isAuthenticatedMock,
  isSupabaseReady: isSupabaseReadyMock,
  loadRemote: loadRemoteMock,
  queueRemoteWrite: queueRemoteWriteMock,
  saveRemote: saveRemoteMock,
  subscribeRemoteStore: subscribeRemoteStoreMock,
  subscribeSupabaseRealtimeSnapshot: subscribeSupabaseRealtimeSnapshotMock,
  subscribeSupabaseWriteQueueSnapshot: subscribeSupabaseWriteQueueSnapshotMock,
}));

import {
  importLocalStoreCandidate,
  listLocalImportCandidates,
  loadStore,
  saveStore,
} from '../store/persistence';

describe('Persistence layer in authenticated mode', () => {
  beforeEach(() => {
    localStorage.clear();
    vi.clearAllMocks();
    isSupabaseReadyMock.mockReturnValue(true);
    isAuthenticatedMock.mockReturnValue(true);
    loadRemoteMock.mockResolvedValue(null);
    saveRemoteMock.mockResolvedValue(true);
    queueRemoteWriteMock.mockImplementation(() => {});
    subscribeRemoteStoreMock.mockReturnValue(() => {});
    flushWriteQueueMock.mockResolvedValue(undefined);
    getSupabaseRealtimeSnapshotMock.mockReturnValue({
      state: 'unavailable',
      lastEventAt: null,
      lastStatusAt: null,
      lastError: null,
    });
    getSupabaseWriteQueueSnapshotMock.mockReturnValue({
      queuedCount: 0,
      queuedKeys: [],
      lastQueuedAt: null,
      lastFlushStartedAt: null,
      lastFlushSuccessAt: null,
      lastFlushFailureAt: null,
      lastFlushError: null,
      lastFlushKeys: [],
      lastFailureKeys: [],
    });
    subscribeSupabaseWriteQueueSnapshotMock.mockImplementation(() => () => {});
    subscribeSupabaseRealtimeSnapshotMock.mockImplementation(() => () => {});
  });

  it('loads remote data even when localStorage has conflicting data', async () => {
    localStorage.setItem('helm:knowledgeEntries', JSON.stringify([{ id: 'local', title: 'Local note' }]));
    loadRemoteMock.mockResolvedValueOnce({
      value: [{ id: 'remote', title: 'Remote canonical note' }],
      updatedAt: '2026-05-01T10:00:00.000Z',
    });

    const loaded = await loadStore<Array<{ id: string; title: string }>>('knowledgeEntries');

    expect(loaded).toEqual([{ id: 'remote', title: 'Remote canonical note' }]);
    expect(loadRemoteMock).toHaveBeenCalledWith('helm', 'knowledgeEntries');
  });

  it('does not fall back to local data when the remote key is missing', async () => {
    localStorage.setItem('helm:knowledgeEntries', JSON.stringify([{ id: 'local', title: 'Local note' }]));
    loadRemoteMock.mockResolvedValueOnce(null);

    const loaded = await loadStore<Array<{ id: string; title: string }>>('knowledgeEntries');

    expect(loaded).toBeNull();
  });

  it('queues authenticated writes without writing localStorage or Tauri storage', async () => {
    await saveStore('tasks', [{ id: 'task-1', title: 'Database task' }]);

    expect(queueRemoteWriteMock).toHaveBeenCalledWith(
      'helm',
      'tasks',
      [{ id: 'task-1', title: 'Database task' }],
      expect.objectContaining({
        updatedAt: expect.any(String),
        onSettled: expect.any(Function),
      }),
    );
    expect(localStorage.setItem).not.toHaveBeenCalled();
    expect(invoke).not.toHaveBeenCalledWith('write_store', expect.anything());
  });

  it('suppresses the provider initial save after a remote miss instead of creating a default row', async () => {
    loadRemoteMock.mockResolvedValueOnce(null);

    await loadStore('knowledgeEntries');
    await saveStore('knowledgeEntries', []);

    expect(queueRemoteWriteMock).not.toHaveBeenCalled();
  });

  it('flushes queued remote writes on beforeunload after an authenticated save', async () => {
    await saveStore('financeAccounts', [{ id: 'account-1', name: 'Database account' }]);

    window.dispatchEvent(new Event('beforeunload'));

    expect(flushWriteQueueMock).toHaveBeenCalled();
  });

  it('lists local import candidates without importing them automatically', async () => {
    localStorage.setItem('helm:knowledgeEntries', JSON.stringify([{ id: 'local', title: 'Local note' }]));
    loadRemoteMock.mockResolvedValue(null);

    const candidates = await listLocalImportCandidates();

    expect(candidates).toEqual(expect.arrayContaining([
      expect.objectContaining({
        key: 'knowledgeEntries',
        remoteExists: false,
      }),
    ]));
    expect(saveRemoteMock).not.toHaveBeenCalled();
  });

  it('imports a selected local candidate only when the database key is empty', async () => {
    localStorage.setItem('helm:knowledgeEntries', JSON.stringify([{ id: 'local', title: 'Local note' }]));
    loadRemoteMock.mockResolvedValueOnce(null);

    const result = await importLocalStoreCandidate('knowledgeEntries');

    expect(result).toMatchObject({ imported: true, cleared: true, reason: 'imported' });
    expect(saveRemoteMock).toHaveBeenCalledWith('helm', 'knowledgeEntries', [{ id: 'local', title: 'Local note' }]);
    expect(localStorage.getItem('helm:knowledgeEntries')).toBeNull();
  });

  it('requires replace=true before overwriting an existing database key during import', async () => {
    localStorage.setItem('helm:knowledgeEntries', JSON.stringify([{ id: 'local', title: 'Local note' }]));
    loadRemoteMock.mockResolvedValueOnce({
      value: [{ id: 'remote', title: 'Remote note' }],
      updatedAt: '2026-05-01T10:00:00.000Z',
    });

    const result = await importLocalStoreCandidate('knowledgeEntries');

    expect(result).toMatchObject({ imported: false, reason: 'remote_exists' });
    expect(saveRemoteMock).not.toHaveBeenCalled();
  });
});
