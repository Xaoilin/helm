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
  listSyncDriftCandidates,
  loadStore,
  resolveSyncDriftCandidate,
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

  it('clears identical local sync drift without prompting', async () => {
    localStorage.setItem('helm:settings', JSON.stringify({ theme: 'dark', telemetry: false }));
    loadRemoteMock.mockImplementation(async (_namespace: string, key: string) => (
      key === 'settings'
        ? { value: { telemetry: false, theme: 'dark' }, updatedAt: '2026-05-01T10:00:00.000Z' }
        : null
    ));

    const candidates = await listSyncDriftCandidates();

    expect(candidates).toEqual([]);
    expect(localStorage.getItem('helm:settings')).toBeNull();
    expect(saveRemoteMock).not.toHaveBeenCalled();
  });

  it('auto-imports local-only sync drift when the database group is empty', async () => {
    localStorage.setItem('helm:knowledgeEntries', JSON.stringify([{ id: 'local', title: 'Local note' }]));
    loadRemoteMock.mockResolvedValue(null);

    const candidates = await listSyncDriftCandidates();

    expect(candidates).toEqual([]);
    expect(saveRemoteMock).toHaveBeenCalledWith('helm', 'knowledgeEntries', [{ id: 'local', title: 'Local note' }]);
    expect(localStorage.getItem('helm:knowledgeEntries')).toBeNull();
  });

  it('returns a grouped conflict when database and device values differ', async () => {
    localStorage.setItem('helm:knowledgeEntries', JSON.stringify([{ id: 'note-1', title: 'Local note' }]));
    loadRemoteMock.mockImplementation(async (_namespace: string, key: string) => (
      key === 'knowledgeEntries'
        ? { value: [{ id: 'note-1', title: 'Remote note' }], updatedAt: '2026-05-01T10:00:00.000Z' }
        : null
    ));

    const candidates = await listSyncDriftCandidates();

    expect(candidates).toHaveLength(1);
    expect(candidates[0]).toMatchObject({
      groupId: 'knowledge',
      kind: 'conflict',
      recommendedChoice: 'keep_database',
      requiresUserChoice: true,
    });
    expect(candidates[0].diff.changed[0]).toMatchObject({
      key: 'knowledgeEntries',
      label: 'Local note',
    });
  });

  it('surfaces unreadable local JSON without allowing device overwrite', async () => {
    localStorage.setItem('helm:settings', '{not json');
    loadRemoteMock.mockResolvedValue(null);

    const candidates = await listSyncDriftCandidates();

    expect(candidates).toHaveLength(1);
    expect(candidates[0]).toMatchObject({
      groupId: 'settings',
      kind: 'unreadable',
      canUseDevice: false,
    });
  });

  it('redacts token-like and credential fields in drift JSON previews', async () => {
    localStorage.setItem('helm:settings', JSON.stringify({
      theme: 'dark',
      deepgramApiKey: 'sk-proj_abcdefghijklmnopqrstuvwxyz123456',
    }));
    loadRemoteMock.mockImplementation(async (_namespace: string, key: string) => (
      key === 'settings'
        ? {
          value: {
            theme: 'light',
            deepgramApiKey: 'sk-proj_remoteabcdefghijklmnopqrstuvwxyz',
          },
          updatedAt: '2026-05-01T10:00:00.000Z',
        }
        : null
    ));

    const candidates = await listSyncDriftCandidates();

    expect(candidates[0].local.redactedJson).toContain('[redacted]');
    expect(candidates[0].local.redactedJson).not.toContain('abcdefghijklmnopqrstuvwxyz123456');
    expect(candidates[0].remote.redactedJson).not.toContain('remoteabcdefghijklmnopqrstuvwxyz');
  });

  it('resolves grouped calendar drift by clearing all local calendar copies when keeping database', async () => {
    localStorage.setItem('helm:calendarAccounts', JSON.stringify([{ id: 'account-local', name: 'Local' }]));
    localStorage.setItem('helm:calendarSources', JSON.stringify([{ id: 'source-local', accountId: 'account-local', name: 'Local source' }]));
    localStorage.setItem('helm:calendarEvents', JSON.stringify([{ id: 'event-local', sourceId: 'source-local', title: 'Local event' }]));
    loadRemoteMock.mockImplementation(async (_namespace: string, key: string) => {
      if (key === 'calendarAccounts') return { value: [{ id: 'account-remote', name: 'Remote' }], updatedAt: '2026-05-01T10:00:00.000Z' };
      if (key === 'calendarSources') return { value: [{ id: 'source-remote', accountId: 'account-remote', name: 'Remote source' }], updatedAt: '2026-05-01T10:00:00.000Z' };
      if (key === 'calendarEvents') return { value: [{ id: 'event-remote', sourceId: 'source-remote', title: 'Remote event' }], updatedAt: '2026-05-01T10:00:00.000Z' };
      return null;
    });

    const result = await resolveSyncDriftCandidate('calendar', 'keep_database');

    expect(result).toMatchObject({
      resolved: true,
      clearedKeys: ['calendarAccounts', 'calendarSources', 'calendarEvents'],
      savedKeys: [],
    });
    expect(localStorage.getItem('helm:calendarAccounts')).toBeNull();
    expect(localStorage.getItem('helm:calendarSources')).toBeNull();
    expect(localStorage.getItem('helm:calendarEvents')).toBeNull();
  });
});
