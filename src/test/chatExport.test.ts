import { describe, expect, it, vi, beforeEach, afterEach } from 'vitest';
import { buildConversationExportFilename, downloadConversationAsMarkdown, formatConversationAsMarkdown } from '../services/chatExport';
import type { ChatConversation } from '../types/domain';

const conversation: ChatConversation = {
  id: 'conv-1',
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
};

describe('chat export helpers', () => {
  beforeEach(() => {
    vi.restoreAllMocks();
  });

  afterEach(() => {
    vi.useRealTimers();
    vi.restoreAllMocks();
  });

  it('formats a conversation as markdown with metadata and transcript roles', () => {
    const markdown = formatConversationAsMarkdown(conversation, new Date(2026, 3, 13, 9, 6, 0));

    expect(markdown).toContain('# Sabah One Chat Export');
    expect(markdown).toContain('- Conversation: Delete my Internet task.');
    expect(markdown).toContain('- Conversation ID: conv-1');
    expect(markdown).toContain('- Messages: 2 messages');
    expect(markdown).toContain('## Transcript');
    expect(markdown).toContain('### User (');
    expect(markdown).toContain('Delete my Internet task.');
    expect(markdown).toContain('### Lina (');
    expect(markdown).toContain('I can delete that. Do you want me to continue?');
  });

  it('builds a Codex-friendly markdown filename from the conversation title', () => {
    const fileName = buildConversationExportFilename(conversation, new Date(2026, 3, 13, 9, 6, 0));

    expect(fileName).toBe('sabah-one-chat-delete-my-internet-task-2026-04-13-0906.md');
  });

  it('downloads the exported markdown as a .md file', () => {
    vi.useFakeTimers();
    const createObjectUrl = vi.spyOn(URL, 'createObjectURL').mockReturnValue('blob:conversation-export');
    const revokeObjectUrl = vi.spyOn(URL, 'revokeObjectURL').mockImplementation(() => {});
    const click = vi.spyOn(HTMLAnchorElement.prototype, 'click').mockImplementation(() => {});
    const appendChild = vi.spyOn(document.body, 'appendChild');

    const artifact = downloadConversationAsMarkdown(conversation, new Date(2026, 3, 13, 9, 6, 0));

    expect(artifact.fileName).toBe('sabah-one-chat-delete-my-internet-task-2026-04-13-0906.md');
    expect(artifact.markdown).toContain('## Transcript');
    expect(createObjectUrl).toHaveBeenCalledTimes(1);
    expect(appendChild).toHaveBeenCalledTimes(1);
    expect(click).toHaveBeenCalledTimes(1);

    vi.runAllTimers();
    expect(revokeObjectUrl).toHaveBeenCalledWith('blob:conversation-export');
    vi.useRealTimers();
  });
});
