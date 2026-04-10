import type { AssistantCorrection } from '../types/domain';
import type { AssistantConversationMessage, AssistantLang } from './shared';

export interface LearnedCorrectionDraft {
  sourceText: string;
  targetText: string;
  lang: AssistantLang;
  scope: AssistantCorrection['scope'];
}

export interface ParsedCorrectionIntent {
  correctedTranscript: string;
  learnedCorrections: LearnedCorrectionDraft[];
}

const ENGLISH_PATTERNS = [
  /^(?:no[, ]+)?i said\s+(.+)$/i,
  /^(?:no[, ]+)?i meant\s+(.+)$/i,
  /^what i said was\s+(.+)$/i,
];

const ARABIC_PATTERNS = [
  /^(?:لا[, ]+)?قلت\s+(.+)$/i,
  /^(?:لا[, ]+)?قصدي\s+(.+)$/i,
  /^(?:اللي قلت(?:ه|ها)? هو|ما قلته هو)\s+(.+)$/i,
];

function collapseWhitespace(value: string): string {
  return value.trim().replace(/\s+/g, ' ');
}

function normaliseForMatch(value: string): string {
  return collapseWhitespace(value)
    .toLowerCase()
    .replace(/[^\p{L}\p{N}\s]/gu, '');
}

function tokenise(value: string): Array<{ raw: string; normalized: string }> {
  return collapseWhitespace(value)
    .split(/\s+/)
    .map(token => {
      const raw = token.replace(/^[^\p{L}\p{N}]+|[^\p{L}\p{N}]+$/gu, '');
      return {
        raw,
        normalized: normaliseForMatch(raw),
      };
    })
    .filter(token => token.raw && token.normalized);
}

function escapeRegExp(value: string): string {
  return value.replace(/[.*+?^${}()|[\]\\]/g, '\\$&');
}

function extractCorrectedTranscript(transcript: string, lang: AssistantLang): string | null {
  const patterns = lang === 'ar' ? ARABIC_PATTERNS : ENGLISH_PATTERNS;
  for (const pattern of patterns) {
    const match = transcript.match(pattern);
    const corrected = collapseWhitespace(match?.[1] || '');
    if (corrected) return corrected;
  }
  return null;
}

function derivePhraseCorrection(
  sourceTranscript: string,
  targetTranscript: string,
  lang: AssistantLang,
): LearnedCorrectionDraft | null {
  const sourceTokens = tokenise(sourceTranscript);
  const targetTokens = tokenise(targetTranscript);
  if (sourceTokens.length === 0 || targetTokens.length === 0) return null;

  let prefix = 0;
  while (
    prefix < sourceTokens.length
    && prefix < targetTokens.length
    && sourceTokens[prefix].normalized === targetTokens[prefix].normalized
  ) {
    prefix += 1;
  }

  let suffix = 0;
  while (
    suffix < sourceTokens.length - prefix
    && suffix < targetTokens.length - prefix
    && sourceTokens[sourceTokens.length - 1 - suffix].normalized === targetTokens[targetTokens.length - 1 - suffix].normalized
  ) {
    suffix += 1;
  }

  const sourceSlice = sourceTokens.slice(prefix, sourceTokens.length - suffix);
  const targetSlice = targetTokens.slice(prefix, targetTokens.length - suffix);
  if (sourceSlice.length === 0 || targetSlice.length === 0) return null;

  const sourceText = collapseWhitespace(sourceSlice.map(token => token.raw).join(' '));
  const targetText = collapseWhitespace(targetSlice.map(token => token.raw).join(' '));
  if (!sourceText || !targetText) return null;
  if (normaliseForMatch(sourceText) === normaliseForMatch(targetText)) return null;
  if (normaliseForMatch(sourceText) === normaliseForMatch(sourceTranscript)) return null;

  return {
    sourceText,
    targetText,
    lang,
    scope: 'phrase',
  };
}

export function parseCorrectionIntent(
  transcript: string,
  lang: AssistantLang,
  conversationHistory?: AssistantConversationMessage[],
): ParsedCorrectionIntent | null {
  const correctedTranscript = extractCorrectedTranscript(transcript, lang);
  if (!correctedTranscript) return null;

  const lastUserTranscript = [...(conversationHistory || [])]
    .reverse()
    .find(message => message.role === 'user')
    ?.content;

  const learnedCorrections: LearnedCorrectionDraft[] = [];
  if (lastUserTranscript && normaliseForMatch(lastUserTranscript) !== normaliseForMatch(correctedTranscript)) {
    learnedCorrections.push({
      sourceText: collapseWhitespace(lastUserTranscript),
      targetText: correctedTranscript,
      lang,
      scope: 'utterance',
    });

    const phraseCorrection = derivePhraseCorrection(lastUserTranscript, correctedTranscript, lang);
    if (phraseCorrection) {
      learnedCorrections.push(phraseCorrection);
    }
  }

  return {
    correctedTranscript,
    learnedCorrections,
  };
}

function replaceWholeTranscript(
  transcript: string,
  sourceText: string,
  targetText: string,
): string {
  return normaliseForMatch(transcript) === normaliseForMatch(sourceText)
    ? targetText
    : transcript;
}

function replacePhraseTranscript(
  transcript: string,
  sourceText: string,
  targetText: string,
): string {
  const source = collapseWhitespace(sourceText);
  if (!source) return transcript;

  const pattern = new RegExp(`(?<!\\p{L})${escapeRegExp(source)}(?!\\p{L})`, 'iu');
  return pattern.test(transcript)
    ? transcript.replace(pattern, targetText)
    : transcript;
}

export function applyStoredCorrections(
  transcript: string,
  corrections: AssistantCorrection[] | undefined,
  lang: AssistantLang,
): { transcript: string; appliedCorrectionIds: string[] } {
  if (!corrections || corrections.length === 0) {
    return { transcript, appliedCorrectionIds: [] };
  }

  const orderedCorrections = corrections
    .filter(correction => correction.lang === lang)
    .sort((a, b) => b.sourceText.length - a.sourceText.length);

  let nextTranscript = transcript;
  const appliedCorrectionIds: string[] = [];

  for (const correction of orderedCorrections) {
    const updatedTranscript = correction.scope === 'utterance'
      ? replaceWholeTranscript(nextTranscript, correction.sourceText, correction.targetText)
      : replacePhraseTranscript(nextTranscript, correction.sourceText, correction.targetText);

    if (updatedTranscript !== nextTranscript) {
      nextTranscript = updatedTranscript;
      appliedCorrectionIds.push(correction.id);
    }
  }

  return {
    transcript: nextTranscript,
    appliedCorrectionIds,
  };
}
