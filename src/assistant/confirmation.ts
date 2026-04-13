import type { AssistantLang } from './shared';

export type AssistantConfirmationIntent = 'confirm' | 'deny' | 'unknown';

function normalizeDecisionText(value: string): string {
  return value
    .toLowerCase()
    .replace(/[.,!?;:()[\]{}"'`~\-_/\\؟،]+/g, ' ')
    .replace(/\s+/g, ' ')
    .trim();
}

function hasNegativeQualifier(value: string): boolean {
  return /\b(?:no|not|nope|don(?:'?t| t)|do not|never mind|instead|wait|wrong|cancel)\b/.test(value);
}

function isEnglishAffirmative(value: string): boolean {
  if (!value) return false;

  const exactMatches = new Set([
    'yes',
    'yes please',
    'yep',
    'yeah',
    'please do',
    'do it',
    'go ahead',
    'ok',
    'okay',
    'sure',
    'thats the one',
    "that's the one",
    'that is the one',
    'delete it',
    'do that',
    'go for it',
  ]);

  if (exactMatches.has(value)) return true;
  if (hasNegativeQualifier(value)) return false;

  if (/^(?:yes|yeah|yep|ok|okay|sure)\b/.test(value)) return true;
  if (/\b(?:that(?: is|'?s)? the one|delete it|do that|go for it|that one)\b/.test(value)) return true;

  return false;
}

function isEnglishNegative(value: string): boolean {
  if (!value) return false;

  const exactMatches = new Set([
    'no',
    'nope',
    'no thanks',
    'no thank you',
    'cancel',
    'cancel that',
    'stop',
    'stop that',
    'never mind',
    'not that one',
    'no not that one',
    'don t do that',
    'dont do that',
    "don't do that",
    'do not do that',
    'wrong one',
  ]);

  if (exactMatches.has(value)) return true;
  if (/^(?:cancel|stop)\b/.test(value)) return true;
  if (/\b(?:not that one|wrong one|don(?:'?t| t) do that|do not do that|cancel that)\b/.test(value)) return true;

  return false;
}

function isArabicAffirmative(value: string): boolean {
  if (!value) return false;
  if (/\b(?:نعم|أكيد|تمام|ماشي|إي|ايوه|أيوه|هذي|هذا هو|هي هذه)\b/.test(value)) {
    return !/\b(?:لا|مو|ليس|الغ)\b/.test(value);
  }
  return false;
}

function isArabicNegative(value: string): boolean {
  if (!value) return false;
  return /\b(?:لا|مو|ليس|إلغاء|الغ|وقف|خلاص|مو هذا)\b/.test(value);
}

export function classifyConfirmationReply(
  transcript: string,
  lang: AssistantLang = 'en',
): AssistantConfirmationIntent {
  const normalized = normalizeDecisionText(transcript);
  if (!normalized) return 'unknown';

  if (lang === 'ar') {
    if (isArabicNegative(normalized)) return 'deny';
    if (isArabicAffirmative(normalized)) return 'confirm';
    return 'unknown';
  }

  if (isEnglishNegative(normalized)) return 'deny';
  if (isEnglishAffirmative(normalized)) return 'confirm';
  return 'unknown';
}
