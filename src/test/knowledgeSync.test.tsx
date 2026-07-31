import { render, screen } from '@testing-library/react';
import { beforeEach, describe, expect, it, vi } from 'vitest';

const { loadStoreMock } = vi.hoisted(() => ({ loadStoreMock: vi.fn() }));

vi.mock('../store/persistence', async importOriginal => {
  const actual = await importOriginal<typeof import('../store/persistence')>();
  return {
    ...actual,
    loadStore: loadStoreMock,
    saveStore: vi.fn(async () => undefined),
    subscribeStoreKey: vi.fn(() => () => {}),
  };
});

import { KnowledgeProvider, useKnowledgeContext } from '../store/contexts/KnowledgeContext';

function KnowledgeProbe() {
  const knowledge = useKnowledgeContext();
  if (!knowledge.loaded) return <div>Loading knowledge</div>;
  return <div>{knowledge.knowledgeEntries.map(entry => entry.title).join(', ') || 'No entries'}</div>;
}

describe('KnowledgeProvider signed-in database state', () => {
  beforeEach(() => {
    localStorage.clear();
    vi.clearAllMocks();
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
});
