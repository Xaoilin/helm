import { act, fireEvent, render, screen } from '@testing-library/react';
import { beforeEach, describe, expect, it, vi } from 'vitest';
import { useState } from 'react';

const { loadStoreMock, storeListeners, subscribeStoreKeyMock } = vi.hoisted(() => ({
  loadStoreMock: vi.fn(),
  storeListeners: new Map<string, () => void>(),
  subscribeStoreKeyMock: vi.fn(),
}));

vi.mock('../store/persistence', async importOriginal => {
  const actual = await importOriginal<typeof import('../store/persistence')>();
  return {
    ...actual,
    loadStore: loadStoreMock,
    saveStore: vi.fn(async () => undefined),
    subscribeStoreKey: subscribeStoreKeyMock,
  };
});

import { KnowledgeProvider, useKnowledgeContext } from '../store/contexts/KnowledgeContext';

function KnowledgeProbe() {
  const knowledge = useKnowledgeContext();
  const [draft, setDraft] = useState('open editor');
  if (!knowledge.loaded) return <div>Loading knowledge</div>;
  return (
    <div>
      <div>{knowledge.knowledgeEntries.map(entry => entry.title).join(', ') || 'No entries'}</div>
      <input aria-label="Local component state" value={draft} onChange={event => setDraft(event.target.value)} />
    </div>
  );
}

describe('KnowledgeProvider signed-in database state', () => {
  beforeEach(() => {
    localStorage.clear();
    vi.clearAllMocks();
    storeListeners.clear();
    subscribeStoreKeyMock.mockImplementation((key: string, listener: () => void) => {
      storeListeners.set(key, listener);
      return () => storeListeners.delete(key);
    });
    loadStoreMock.mockImplementation(async (key: string) => (
      key === 'knowledgeEntries'
        ? [{
            id: 'remote',
            topicId: 'topic-1',
            title: 'Database note',
            content: 'Database content',
            sources: [],
            tags: [],
            createdAt: '2026-05-01T10:00:00.000Z',
            updatedAt: '2026-05-01T10:00:00.000Z',
          }]
        : null
    ));
  });

  it('renders database entries without consulting a conflicting browser copy', async () => {
    localStorage.setItem('helm:knowledgeEntries', JSON.stringify([{ id: 'local', title: 'Device note' }]));

    render(
      <KnowledgeProvider>
        <KnowledgeProbe />
      </KnowledgeProvider>,
    );

    expect(await screen.findByText('Database note')).toBeInTheDocument();
    expect(screen.queryByText('Device note')).not.toBeInTheDocument();
    expect(loadStoreMock).toHaveBeenCalledWith('knowledgeEntries');
  });

  it('applies a live domain update without remounting unrelated component state', async () => {
    let title = 'Initial database note';
    loadStoreMock.mockImplementation(async (key: string) => (
      key === 'knowledgeEntries'
        ? [{
            id: 'remote', topicId: 'topic-1', title, content: '', sources: [], tags: [],
            createdAt: '2026-05-01T10:00:00.000Z', updatedAt: '2026-05-01T10:00:00.000Z',
          }]
        : null
    ));
    render(<KnowledgeProvider><KnowledgeProbe /></KnowledgeProvider>);
    const input = await screen.findByLabelText('Local component state');
    fireEvent.change(input, { target: { value: 'unsaved filter text' } });

    title = 'Live database note';
    act(() => storeListeners.get('knowledgeEntries')?.());

    expect(await screen.findByText('Live database note')).toBeInTheDocument();
    expect(screen.getByLabelText('Local component state')).toHaveValue('unsaved filter text');
  });
});
