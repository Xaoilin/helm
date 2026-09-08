import { act, fireEvent, render, screen, waitFor } from '@testing-library/react';
import { beforeEach, expect, it, vi } from 'vitest';
import ChatSurface from '../surfaces/ChatSurface';

const mocks = vi.hoisted(() => ({
  send: vi.fn(), create: vi.fn(() => 'new-conversation'),
  active: true, paused: false,
}));
vi.mock('../store/contexts/ChatContext', () => ({ useChatContext: () => ({
  conversations: mocks.active ? [{ id: 'existing', title: 'Test', messages: [], updatedAt: '2026-09-08T10:00:00Z' }] : [],
  activeConversationId: mocks.active ? 'existing' : null,
  createConversation: mocks.create, sendMessage: mocks.send,
}) }));
vi.mock('../store/contexts/SettingsContext', () => ({ useSettingsContext: () => ({ settings: { assistantProvider: 'hosted' } }) }));
vi.mock('../store/supabase', () => ({ getCurrentUserId: () => 'test', isAuthenticated: () => true, isSupabaseReady: () => true }));
vi.mock('../services/assistantAvailability', () => ({
  getAssistantProviderSetting: () => 'hosted',
  getAssistantRuntimeStatus: async () => ({ state: mocks.paused ? 'paused' : 'ready', activeProvider: 'hosted', headline: mocks.paused ? 'Hosted AI paused' : 'Ready', detail: 'Synthetic runtime.' }),
}));

beforeEach(() => {
  vi.clearAllMocks();
  mocks.active = true;
  mocks.paused = false;
  Element.prototype.scrollIntoView = vi.fn();
});

it.each(['typed', 'active quick', 'empty quick'])('%s rejection keeps a usable retry and permits only one in-flight send', async mode => {
  mocks.active = mode !== 'empty quick';
  let reject!: (error: Error) => void;
  mocks.send.mockImplementationOnce(() => new Promise<void>((_resolve, fail) => { reject = fail; }));
  await act(async () => { render(<ChatSurface />); });
  const text = mode === 'typed' ? 'Keep this draft' : 'Help me plan my week';
  if (mode === 'typed') fireEvent.change(screen.getByPlaceholderText('Type a message...'), { target: { value: text } });
  const send = screen.getByRole('button', { name: mode === 'typed' ? 'Send' : text, exact: true });
  act(() => { fireEvent.click(send); fireEvent.click(send); });
  expect(mocks.send).toHaveBeenCalledTimes(1);
  await act(async () => reject(new Error('Synthetic failure')));
  expect(await screen.findByRole('alert')).toHaveTextContent('Try again');
  if (mode === 'typed') expect(screen.getByPlaceholderText('Type a message...')).toHaveValue(text);
  if (mode === 'typed') fireEvent.change(screen.getByPlaceholderText('Type a message...'), { target: { value: 'A later draft' } });
  let resolve!: () => void;
  mocks.send.mockImplementationOnce(() => new Promise<void>(done => { resolve = done; }));
  const retry = screen.getByRole('button', { name: 'Try again', exact: true });
  act(() => { fireEvent.click(retry); fireEvent.click(retry); });
  expect(mocks.send).toHaveBeenCalledTimes(2);
  expect(mocks.send).toHaveBeenLastCalledWith(mode === 'empty quick' ? 'new-conversation' : 'existing', text);
  await act(async () => resolve());
  await waitFor(() => expect(screen.queryByRole('alert')).toBeNull());
  if (mode === 'typed') {
    expect(screen.getByPlaceholderText('Type a message...')).toHaveValue('A later draft');
    mocks.send.mockResolvedValueOnce(undefined);
    await act(async () => { fireEvent.click(screen.getByRole('button', { name: 'Send', exact: true })); });
    expect(screen.getByPlaceholderText('Type a message...')).toHaveValue('');
  }
  expect(mocks.create).toHaveBeenCalledTimes(mode === 'empty quick' ? 1 : 0);
});

it('keeps quick sends disabled while the hosted runtime is paused', async () => {
  mocks.paused = true;
  mocks.active = false;
  await act(async () => { render(<ChatSurface />); });
  await waitFor(() => expect(screen.getByRole('button', { name: 'Help me plan my week' })).toBeDisabled());
  expect(mocks.send).not.toHaveBeenCalled();
});
