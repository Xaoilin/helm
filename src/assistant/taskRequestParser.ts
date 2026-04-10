import type { Task } from '../types/domain';
import type { AssistantCommandContext } from './shared';
import { extractTemporalReference } from './temporalResolver';

export interface ParsedTaskCreationRequest {
  title?: string;
  category?: Task['category'];
  priority?: Task['priority'];
  dueDate?: string;
  duePhrase?: string;
  clarify?: string;
}

const ENGLISH_TASK_SIGNAL = /\b(task|todo|habit|daily|goal)\b/i;
const ENGLISH_POLITE_PREFIX = /^(?:lina[\s,:-]+)?(?:can|could|would|will)\s+you\s+(?:please\s+)?/i;
const ENGLISH_CREATE_VERB = /^(?:please\s+)?(?:add|create|make)\s+/i;
const ENGLISH_TASK_PROMPT = /^(?:show|open|find|locate|pull up)\b/i;
const ENGLISH_TASK_SCAFFOLD_PREFIXES = [
  /^(?:me\s+)?(?:a|an)\s+/i,
  /^(?:new)\s+/i,
  /^(?:the\s+)?(?:(?:daily\s+)?habit|daily|task|todo|goal)\s+/i,
  /^(?:called|named)\s+/i,
  /^(?:for\s+me\s+to|to)\s+/i,
] as const;
const VAGUE_TASK_TITLES = new Set([
  'task',
  'todo',
  'habit',
  'goal',
  'it',
  'that',
  'this',
  'one',
  'now',
  'later',
  'today',
  'tomorrow',
]);

function normaliseText(value: string): string {
  return value
    .toLowerCase()
    .replace(/[^\p{L}\p{N}\s:]/gu, ' ')
    .replace(/\s+/g, ' ')
    .trim();
}

function sanitizeTitle(value: string): string {
  return value
    .trim()
    .replace(/^["'`]+|["'`]+$/g, '')
    .replace(/[.?!،]+$/g, '')
    .replace(/\s+/g, ' ')
    .trim();
}

function detectTaskCategory(transcript: string): Task['category'] {
  const normalized = normaliseText(transcript);
  if (
    normalized.includes('daily')
    || normalized.includes('habit')
    || normalized.includes('عادة')
    || normalized.includes('يومي')
  ) {
    return 'daily';
  }
  if (normalized.includes('goal') || normalized.includes('هدف')) {
    return 'goal';
  }
  return 'task';
}

function stripPriorityHints(text: string): { title: string; priority: Task['priority'] } {
  let title = text;
  let priority: Task['priority'] = 'medium';

  if (/\b(high priority|urgent)\b/i.test(title) || /(?:أولوية عالية|عاجل)/.test(title)) {
    priority = 'high';
    title = title.replace(/\b(high priority|urgent)\b/ig, '').replace(/(?:أولوية عالية|عاجل)/g, '');
  } else if (/\b(low priority)\b/i.test(title) || /(?:أولوية منخفضة)/.test(title)) {
    priority = 'low';
    title = title.replace(/\b(low priority)\b/ig, '').replace(/(?:أولوية منخفضة)/g, '');
  }

  return { title: sanitizeTitle(title), priority };
}

function stripLeadingTaskScaffolding(value: string): string {
  let result = sanitizeTitle(value);

  while (result) {
    let updated = result;
    for (const pattern of ENGLISH_TASK_SCAFFOLD_PREFIXES) {
      updated = updated.replace(pattern, '');
    }
    updated = sanitizeTitle(updated);
    if (updated === result) break;
    result = updated;
  }

  return result;
}

function isVagueTaskTitle(value: string): boolean {
  const normalized = normaliseText(value);
  if (!normalized) return true;
  if (normalized.length < 2) return true;
  if (VAGUE_TASK_TITLES.has(normalized)) return true;
  if (/^(?:the\s+)?(?:task|todo|habit|goal)(?:\s+\w+)?$/i.test(normalized)) return true;
  return false;
}

function extractEnglishTaskRemainder(transcript: string): string | null {
  const polite = transcript.replace(ENGLISH_POLITE_PREFIX, '');
  if (ENGLISH_TASK_PROMPT.test(normaliseText(transcript))) {
    return null;
  }

  if (polite !== transcript) {
    const remainder = polite.replace(ENGLISH_CREATE_VERB, '');
    return remainder !== polite ? remainder : null;
  }

  if (!ENGLISH_CREATE_VERB.test(transcript)) return null;
  return transcript.replace(ENGLISH_CREATE_VERB, '');
}

export function parseTaskCreationRequest(
  transcript: string,
  context: AssistantCommandContext,
): ParsedTaskCreationRequest | null {
  const trimmed = transcript.trim();
  if (!trimmed) return null;

  if (/^(?:remind me to)\s+/i.test(trimmed)) {
    const extracted = extractTemporalReference(trimmed.replace(/^(?:remind me to)\s+/i, ''), context);
    const { title, priority } = stripPriorityHints(stripLeadingTaskScaffolding(extracted.cleanedText || ''));
    if (isVagueTaskTitle(title)) {
      return { clarify: 'What should I call the task?' };
    }
    return {
      title,
      priority,
      category: 'task',
      dueDate: extracted.resolution?.date,
      duePhrase: extracted.resolution?.phrase,
    };
  }

  if (/(?:أضف|أنشئ|اعمل)(?:\s+(?:مهمة|عادة|هدف))?\s+(.+)/i.test(trimmed)) {
    const match = trimmed.match(/(?:أضف|أنشئ|اعمل)(?:\s+(?:مهمة|عادة|هدف))?\s+(.+)/i);
    const rawTitle = match?.[1] || '';
    const extracted = extractTemporalReference(rawTitle, context);
    const { title, priority } = stripPriorityHints(extracted.cleanedText || rawTitle);
    if (isVagueTaskTitle(title)) {
      return { clarify: 'What should I call the task?' };
    }
    return {
      title,
      priority,
      category: detectTaskCategory(trimmed),
      dueDate: extracted.resolution?.date,
      duePhrase: extracted.resolution?.phrase,
    };
  }

  const englishRemainder = extractEnglishTaskRemainder(trimmed);
  if (!englishRemainder) return null;
  if (!ENGLISH_TASK_SIGNAL.test(trimmed)) return null;

  const extracted = extractTemporalReference(stripLeadingTaskScaffolding(englishRemainder), context);
  const { title, priority } = stripPriorityHints(stripLeadingTaskScaffolding(extracted.cleanedText || englishRemainder));

  if (isVagueTaskTitle(title)) {
    return { clarify: 'What should I call the task?' };
  }

  return {
    title,
    priority,
    category: detectTaskCategory(trimmed),
    dueDate: extracted.resolution?.date,
    duePhrase: extracted.resolution?.phrase,
  };
}
