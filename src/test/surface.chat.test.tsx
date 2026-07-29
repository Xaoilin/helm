import { describe, it, expect, beforeEach, vi } from 'vitest';
import { screen, act, fireEvent } from '@testing-library/react';
import { renderWithProvider } from './surfaceTestHarness';
import ChatSurface from '../surfaces/ChatSurface';

describe('ChatSurface', () => {
  beforeEach(() => {
    localStorage.clear();
    vi.mocked(navigator.clipboard.writeText).mockClear();
  });

  it('should render empty state with welcome message', async () => {
    await act(async () => { renderWithProvider(<ChatSurface />); });
    expect(screen.getByText('Lina Assistant')).toBeInTheDocument();
    expect(screen.getByText('New conversation')).toBeInTheDocument();
  });

  it('should render quick prompts', async () => {
    await act(async () => { renderWithProvider(<ChatSurface />); });
    expect(screen.getByText('What should I focus on today?')).toBeInTheDocument();
    expect(screen.getByText('What meetings do I have coming up?')).toBeInTheDocument();
  });

  it('should show Ollama status indicator', async () => {
    await act(async () => { renderWithProvider(<ChatSurface />); });
    const matches = screen.getAllByText(/Checking assistant|Ollama|Hosted AI|No AI provider/i);
    expect(matches.length).toBeGreaterThan(0);
  });

  it('should show no conversations yet text', async () => {
    await act(async () => { renderWithProvider(<ChatSurface />); });
    expect(screen.getByText('No conversations yet')).toBeInTheDocument();
  });

  it('should copy the active conversation as markdown for Codex', async () => {
    localStorage.setItem('helm:conversations', JSON.stringify([
      {
        id: 'conv-export',
        title: 'Delete my Internet task.',
        createdAt: '2026-04-13T09:00:00.000Z',
        updatedAt: '2026-04-13T09:05:00.000Z',
        messages: [
          {
            id: 'msg-1',
            role: 'user',
            content: 'Delete my Internet task.',
            timestamp: '2026-04-13T09:00:00.000Z',
          },
          {
            id: 'msg-2',
            role: 'assistant',
            content: 'I can delete that. Do you want me to continue?',
            timestamp: '2026-04-13T09:00:05.000Z',
          },
        ],
      },
    ]));

    await act(async () => { renderWithProvider(<ChatSurface />); });

    const conversationRow = await screen.findByText('Delete my Internet task.');

    await act(async () => {
      fireEvent.click(conversationRow.closest('.chat-list-item') as HTMLElement);
    });

    await act(async () => {
      fireEvent.click(await screen.findByRole('button', { name: 'Copy Markdown' }));
    });

    expect(navigator.clipboard.writeText).toHaveBeenCalledTimes(1);
    expect(navigator.clipboard.writeText).toHaveBeenCalledWith(expect.stringContaining('# HELM Chat Export'));
    expect(navigator.clipboard.writeText).toHaveBeenCalledWith(expect.stringContaining('Delete my Internet task.'));
    expect(screen.getByText('Conversation copied as Markdown.')).toBeInTheDocument();
  });

  it('shows an estimated OpenAI conversation total and excludes other providers', async () => {
    localStorage.setItem('helm:conversations', JSON.stringify([
      {
        id: 'conv-billing',
        title: 'Hosted billing conversation',
        createdAt: '2026-04-14T09:00:00.000Z',
        updatedAt: '2026-04-14T09:05:00.000Z',
        messages: [
          {
            id: 'msg-1',
            role: 'user',
            content: 'Show me my tasks.',
            timestamp: '2026-04-14T09:00:00.000Z',
          },
          {
            id: 'msg-2',
            role: 'assistant',
            content: 'Opening your tasks.',
            timestamp: '2026-04-14T09:00:05.000Z',
            assistantBilling: {
              provider: 'openai',
              model: 'gpt-5.4',
              requestCount: 2,
              requests: [
                {
                  kind: 'planner',
                  responseId: 'resp-plan',
                  model: 'gpt-5.4',
                  serviceTier: 'default',
                  inputTokens: 1000,
                  cachedTokens: 100,
                  outputTokens: 200,
                  reasoningTokens: 120,
                  totalTokens: 1200,
                  estimatedUsd: 0.005275,
                },
                {
                  kind: 'narration',
                  responseId: 'resp-narration',
                  model: 'gpt-5.4',
                  serviceTier: 'default',
                  inputTokens: 600,
                  cachedTokens: 50,
                  outputTokens: 120,
                  reasoningTokens: 70,
                  totalTokens: 720,
                  estimatedUsd: 0.003188,
                },
              ],
              totals: {
                inputTokens: 1600,
                cachedTokens: 150,
                outputTokens: 320,
                reasoningTokens: 190,
                totalTokens: 1920,
              },
              estimatedUsd: 0.008463,
              estimateStatus: 'estimated_from_openai_usage',
              estimateLabel: 'Estimated from OpenAI usage',
            },
          },
          {
            id: 'msg-3',
            role: 'assistant',
            content: 'Fallback reply.',
            timestamp: '2026-04-14T09:00:08.000Z',
            assistantBilling: {
              provider: 'local',
              model: 'local-fallback',
              requestCount: 0,
              requests: [],
            },
          },
        ],
      },
    ]));

    await act(async () => { renderWithProvider(<ChatSurface />); });

    const conversationRow = await screen.findByText('Hosted billing conversation');

    await act(async () => {
      fireEvent.click(conversationRow.closest('.chat-list-item') as HTMLElement);
    });

    expect(screen.getByText('Estimated OpenAI conversation total')).toBeInTheDocument();
    expect(screen.getByText('$0.0085')).toBeInTheDocument();
    expect(screen.getByText(/2 hosted OpenAI requests across 1 assistant turn/i)).toBeInTheDocument();
    expect(screen.getByText(/1,600 input/i)).toBeInTheDocument();
    expect(screen.getByText('OpenAI-hosted turns only; other turns excluded.')).toBeInTheDocument();
  });
});
