import { act, renderHook, waitFor } from '@testing-library/react';
import { expect, it, vi } from 'vitest';
import { ChatProvider, useChatContext, type ChatCrossDomainData } from '../store/contexts/ChatContext';
import { defaultSettings } from '../store/contexts/SettingsContext';
import { makeAssistantContext } from './fixtures';

const runtime = vi.hoisted(() => ({ runAssistantTurn: vi.fn() }));
vi.mock('../assistant/runtime', () => runtime);
vi.mock('../store/persistence', () => ({ loadStore: async () => [], saveStore: vi.fn(async () => undefined) }));
vi.mock('../store/contexts/useRemoteStoreRefresh', () => ({ useRemoteStoreRefresh: vi.fn() }));

it('removes only a rejected optimistic message so an explicit retry records one completed turn', async () => {
  const crossDomain: ChatCrossDomainData = {
    ...makeAssistantContext(), settings: defaultSettings, appTimeZone: 'UTC', assistantCorrections: [],
    recordAssistantActivity: vi.fn(() => 'activity'), addTask: vi.fn(() => 'task'), updateTask: vi.fn(), removeTask: vi.fn(),
    upsertAssistantCorrection: vi.fn(() => null), noteAssistantCorrectionApplied: vi.fn(),
    addCalendarEvent: vi.fn(() => 'event'), updateCalendarEvent: vi.fn(), addTransaction: vi.fn(() => 'transaction'),
    addKnowledgeEntry: vi.fn(() => 'entry'), addInventoryItem: vi.fn(() => 'item'), adjustInventoryQuantity: vi.fn(),
    addInventoryNeed: vi.fn(() => 'need'), completeInventoryNeed: vi.fn(), updateGamification: vi.fn(),
  };
  const { result } = renderHook(() => useChatContext(), {
    wrapper: ({ children }) => <ChatProvider crossDomain={crossDomain}>{children}</ChatProvider>,
  });
  await waitFor(() => expect(result.current.loaded).toBe(true));
  let id = '';
  act(() => { id = result.current.createConversation({ initialMessages: [{ role: 'assistant', content: 'Earlier response' }] }); });
  runtime.runAssistantTurn.mockRejectedValueOnce(new Error('Synthetic interruption'));
  await act(async () => {
    await expect(result.current.sendMessage(id, 'Keep one copy')).rejects.toThrow('Synthetic interruption');
  });
  expect(result.current.conversations[0].messages.map(message => message.content)).toEqual(['Earlier response']);
  runtime.runAssistantTurn.mockResolvedValueOnce({ source: 'degraded', assistantMessage: 'Synthetic answer', dialogState: {} });
  await act(async () => { await result.current.sendMessage(id, 'Keep one copy'); });
  expect(runtime.runAssistantTurn).toHaveBeenCalledTimes(2);
  expect(result.current.conversations[0].messages.map(message => message.content)).toEqual(['Earlier response', 'Keep one copy', 'Synthetic answer']);
});
