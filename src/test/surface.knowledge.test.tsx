import { describe, it, expect, beforeEach } from 'vitest';
import { screen, act, fireEvent, waitFor } from '@testing-library/react';
import { renderWithProvider } from './surfaceTestHarness';
import KnowledgeSurface from '../surfaces/KnowledgeSurface';

describe('KnowledgeSurface', () => {
  beforeEach(() => { localStorage.clear(); });

  it('should render empty state with tabs', async () => {
    await act(async () => { renderWithProvider(<KnowledgeSurface />); });
    expect(screen.getByText('Start Your Knowledge Base')).toBeInTheDocument();
    expect(screen.getByText('Browse')).toBeInTheDocument();
    expect(screen.getByText('Add Entry')).toBeInTheDocument();
    expect(screen.getByText('Search')).toBeInTheDocument();
  });

  it('should have create topic button', async () => {
    await act(async () => { renderWithProvider(<KnowledgeSurface />); });
    expect(screen.getByText('+ Create First Topic')).toBeInTheDocument();
  });

  it('moves entries between topics from the entry card', async () => {
    localStorage.setItem('helm:knowledgeTopics', JSON.stringify([
      {
        id: 'topic-aqidah',
        name: 'Aqidah',
        description: '',
        icon: 'A',
        color: '#3b82f6',
        sortOrder: 0,
        createdAt: '2026-04-20T09:00:00.000Z',
        updatedAt: '2026-04-20T09:00:00.000Z',
      },
      {
        id: 'topic-fiqh',
        name: 'Fiqh',
        description: '',
        icon: 'F',
        color: '#22c55e',
        sortOrder: 1,
        createdAt: '2026-04-20T09:00:00.000Z',
        updatedAt: '2026-04-20T09:00:00.000Z',
      },
    ]));
    localStorage.setItem('helm:knowledgeEntries', JSON.stringify([
      {
        id: 'entry-tawhid',
        topicId: 'topic-aqidah',
        title: 'Tawhid note',
        content: 'A reusable note while the topic taxonomy is still changing.',
        sources: [{ type: 'quran', surah: 1, ayahStart: 1 }],
        tags: ['taxonomy'],
        createdAt: '2026-04-20T10:00:00.000Z',
        updatedAt: '2026-04-20T10:00:00.000Z',
      },
    ]));

    await act(async () => { renderWithProvider(<KnowledgeSurface />); });

    await act(async () => {
      fireEvent.click(await screen.findByText('Aqidah'));
    });
    await act(async () => {
      fireEvent.click(screen.getByText('Tawhid note'));
    });

    await act(async () => {
      fireEvent.change(screen.getByLabelText('Move Tawhid note to topic'), {
        target: { value: 'topic-fiqh' },
      });
    });

    await waitFor(() => {
      const entries = JSON.parse(localStorage.getItem('helm:knowledgeEntries') || '[]');
      expect(entries[0]).toMatchObject({
        id: 'entry-tawhid',
        topicId: 'topic-fiqh',
      });
    });

    expect(screen.getByRole('heading', { name: 'Fiqh' })).toBeInTheDocument();
    expect(screen.getByLabelText('Move Tawhid note to topic')).toHaveValue('topic-fiqh');
  });
});
