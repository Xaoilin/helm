import { render, screen } from '@testing-library/react';
import { beforeEach, describe, expect, it, vi } from 'vitest';

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

import { KnowledgeProvider, useKnowledgeContext } from '../store/contexts/KnowledgeContext';

function KnowledgeProbe() {
  const knowledge = useKnowledgeContext();
  if (!knowledge.loaded) return <div>Loading knowledge</div>;
  return <div>{knowledge.knowledgeEntries.map(entry => entry.title).join(', ') || 'No entries'}</div>;
}

describe('KnowledgeProvider signed-in sync', () => {
  beforeEach(() => {
    localStorage.clear();
    vi.clearAllMocks();
    isSupabaseReadyMock.mockReturnValue(true);
    isAuthenticatedMock.mockReturnValue(true);
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

  it('renders Supabase knowledge entries instead of conflicting local entries', async () => {
    localStorage.setItem('helm:knowledgeEntries', JSON.stringify([{ id: 'local', title: 'Local note' }]));
    loadRemoteMock.mockImplementation(async (_namespace: string, key: string) => {
      if (key === 'knowledgeEntries') {
        return {
          value: [{
            id: 'remote',
            topicId: 'topic-1',
            title: 'Remote note',
            content: 'Remote content',
            sources: [],
            tags: [],
            createdAt: '2026-05-01T10:00:00.000Z',
            updatedAt: '2026-05-01T10:00:00.000Z',
          }],
          updatedAt: '2026-05-01T10:00:00.000Z',
        };
      }
      return null;
    });

    render(
      <KnowledgeProvider>
        <KnowledgeProbe />
      </KnowledgeProvider>,
    );

    expect(await screen.findByText('Remote note')).toBeInTheDocument();
    expect(screen.queryByText('Local note')).not.toBeInTheDocument();
  });
});
