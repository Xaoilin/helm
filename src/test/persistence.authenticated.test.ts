import { beforeEach, describe, expect, it, vi } from 'vitest';

const {
  flushWriteQueueMock,
  isAuthenticatedMock,
  isSupabaseReadyMock,
  loadRemoteMock,
  queueRemoteWriteMock,
} = vi.hoisted(() => ({
  flushWriteQueueMock: vi.fn(),
  isAuthenticatedMock: vi.fn(),
  isSupabaseReadyMock: vi.fn(),
  loadRemoteMock: vi.fn(),
  queueRemoteWriteMock: vi.fn(),
}));

vi.mock('../store/supabase', () => ({
  flushWriteQueue: flushWriteQueueMock,
  isAuthenticated: isAuthenticatedMock,
  isSupabaseReady: isSupabaseReadyMock,
  loadRemote: loadRemoteMock,
  queueRemoteWrite: queueRemoteWriteMock,
}));

import { loadStore, saveStore } from '../store/persistence';

describe('Persistence layer in authenticated mode', () => {
  beforeEach(() => {
    localStorage.clear();
    vi.clearAllMocks();
    isSupabaseReadyMock.mockReturnValue(true);
    isAuthenticatedMock.mockReturnValue(true);
    loadRemoteMock.mockResolvedValue(null);
    queueRemoteWriteMock.mockImplementation(() => {});
    flushWriteQueueMock.mockResolvedValue(undefined);
  });

  it('keeps a dirty local cache when the remote copy is stale', async () => {
    await saveStore('tasks', [{ id: 'task-1', title: 'Put up mirror' }]);
    const localMeta = JSON.parse(localStorage.getItem('helm:meta:tasks') || '{}');

    loadRemoteMock.mockResolvedValueOnce({
      value: [{ id: 'task-1', title: 'Old remote task' }],
      updatedAt: '2026-04-09T09:00:00.000Z',
    });

    const loaded = await loadStore<Array<{ id: string; title: string }>>('tasks');

    expect(loaded).toEqual([{ id: 'task-1', title: 'Put up mirror' }]);
    expect(localMeta.dirty).toBe(true);
  });

  it('accepts fresher remote data and clears the dirty bit', async () => {
    await saveStore('tasks', [{ id: 'task-1', title: 'Put up mirror' }]);
    const remoteUpdatedAt = new Date(Date.now() + 60_000).toISOString();

    loadRemoteMock.mockResolvedValueOnce({
      value: [{ id: 'task-1', title: 'Remote canonical copy' }],
      updatedAt: remoteUpdatedAt,
    });

    const loaded = await loadStore<Array<{ id: string; title: string }>>('tasks');
    const meta = JSON.parse(localStorage.getItem('helm:meta:tasks') || '{}');

    expect(loaded).toEqual([{ id: 'task-1', title: 'Remote canonical copy' }]);
    expect(meta).toMatchObject({
      updatedAt: remoteUpdatedAt,
      dirty: false,
    });
  });

  it('marks authenticated writes dirty and clears them after a successful remote flush callback', async () => {
    await saveStore('tasks', [{ id: 'task-1', title: 'Put up mirror' }]);

    expect(queueRemoteWriteMock).toHaveBeenCalledWith(
      'helm',
      'tasks',
      [{ id: 'task-1', title: 'Put up mirror' }],
      expect.objectContaining({
        updatedAt: expect.any(String),
        onSettled: expect.any(Function),
      }),
    );

    const [, , , options] = queueRemoteWriteMock.mock.calls[0];
    const dirtyMeta = JSON.parse(localStorage.getItem('helm:meta:tasks') || '{}');
    expect(dirtyMeta.dirty).toBe(true);

    options.onSettled({
      success: true,
      updatedAt: options.updatedAt,
    });

    const cleanMeta = JSON.parse(localStorage.getItem('helm:meta:tasks') || '{}');
    expect(cleanMeta).toMatchObject({
      updatedAt: options.updatedAt,
      dirty: false,
    });
  });

  it('flushes queued remote writes on beforeunload after an authenticated save', async () => {
    await saveStore('tasks', [{ id: 'task-1', title: 'Put up mirror' }]);

    window.dispatchEvent(new Event('beforeunload'));

    expect(flushWriteQueueMock).toHaveBeenCalled();
  });
});
