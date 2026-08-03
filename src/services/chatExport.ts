import { APP_RELEASE_VERSION } from '../config/release';
import type { ChatConversation, ChatMessage } from '../types/domain';

const EXPORT_FILENAME_PREFIX = 'sabah-one-chat';
const FALLBACK_FILENAME_STEM = 'conversation';
const MAX_FILENAME_TITLE_LENGTH = 48;

function coerceDate(value: Date | string): Date | null {
  const date = value instanceof Date ? value : new Date(value);
  return Number.isNaN(date.getTime()) ? null : date;
}

function formatExportTimestamp(value: Date | string): string {
  const date = coerceDate(value);
  if (!date) return String(value);

  return date.toLocaleString([], {
    year: 'numeric',
    month: 'short',
    day: '2-digit',
    hour: '2-digit',
    minute: '2-digit',
  });
}

function sanitizeFilenameStem(title: string): string {
  const sanitized = title
    .toLowerCase()
    .replace(/[^a-z0-9]+/g, '-')
    .replace(/^-+|-+$/g, '')
    .slice(0, MAX_FILENAME_TITLE_LENGTH)
    .replace(/-+$/g, '');

  return sanitized || FALLBACK_FILENAME_STEM;
}

function padNumber(value: number): string {
  return String(value).padStart(2, '0');
}

function formatFilenameTimestamp(value: Date | string): string {
  const date = coerceDate(value) || new Date();
  return [
    date.getFullYear(),
    padNumber(date.getMonth() + 1),
    padNumber(date.getDate()),
  ].join('-') + `-${padNumber(date.getHours())}${padNumber(date.getMinutes())}`;
}

function formatMessageSpeaker(message: ChatMessage): string {
  return message.role === 'assistant' ? 'Lina' : 'User';
}

function formatMessageBlock(message: ChatMessage): string {
  return [
    `### ${formatMessageSpeaker(message)} (${formatExportTimestamp(message.timestamp)})`,
    '',
    message.content.trim() || '_Empty message_',
    '',
  ].join('\n');
}

export function buildConversationExportFilename(
  conversation: ChatConversation,
  exportedAt: Date | string = new Date(),
): string {
  const titleStem = sanitizeFilenameStem(conversation.title);
  return `${EXPORT_FILENAME_PREFIX}-${titleStem}-${formatFilenameTimestamp(exportedAt)}.md`;
}

export function formatConversationAsMarkdown(
  conversation: ChatConversation,
  exportedAt: Date | string = new Date(),
): string {
  const messageCount = `${conversation.messages.length} message${conversation.messages.length === 1 ? '' : 's'}`;
  const transcript = conversation.messages.length > 0
    ? conversation.messages.map(formatMessageBlock).join('\n')
    : '_No messages yet._';

  return [
    '# Sabah One Chat Export',
    '',
    `- Release: ${APP_RELEASE_VERSION}`,
    `- Conversation: ${conversation.title}`,
    `- Conversation ID: ${conversation.id}`,
    `- Messages: ${messageCount}`,
    `- Created: ${formatExportTimestamp(conversation.createdAt)}`,
    `- Updated: ${formatExportTimestamp(conversation.updatedAt)}`,
    `- Exported: ${formatExportTimestamp(exportedAt)}`,
    '',
    '## Transcript',
    '',
    transcript,
    '',
  ].join('\n');
}

export function downloadConversationAsMarkdown(
  conversation: ChatConversation,
  exportedAt: Date | string = new Date(),
): { fileName: string; markdown: string } {
  const markdown = formatConversationAsMarkdown(conversation, exportedAt);
  const fileName = buildConversationExportFilename(conversation, exportedAt);
  const blob = new Blob([markdown], { type: 'text/markdown;charset=utf-8' });
  const blobUrl = URL.createObjectURL(blob);
  const downloadLink = document.createElement('a');

  downloadLink.href = blobUrl;
  downloadLink.download = fileName;
  downloadLink.rel = 'noopener';
  downloadLink.style.display = 'none';

  document.body.appendChild(downloadLink);
  downloadLink.click();
  downloadLink.remove();

  window.setTimeout(() => URL.revokeObjectURL(blobUrl), 0);

  return { fileName, markdown };
}
