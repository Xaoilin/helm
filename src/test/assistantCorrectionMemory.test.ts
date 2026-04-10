import { describe, expect, it } from 'vitest';
import { applyStoredCorrections, parseCorrectionIntent } from '../assistant/correctionMemory';
import type { AssistantCorrection } from '../types/domain';

describe('assistant correction memory', () => {
  it('learns both utterance and phrase corrections from "no, I said" phrasing', () => {
    const parsed = parseCorrectionIntent(
      'No, I said delete all of the tasks related to mirrors',
      'en',
      [
        { role: 'user', content: 'delete all of the tasks related to minors' },
        { role: 'assistant', content: `I couldn't find any tasks matching "minors".` },
      ],
    );

    expect(parsed?.correctedTranscript).toBe('delete all of the tasks related to mirrors');
    expect(parsed?.learnedCorrections).toEqual(expect.arrayContaining([
      expect.objectContaining({
        sourceText: 'delete all of the tasks related to minors',
        targetText: 'delete all of the tasks related to mirrors',
        scope: 'utterance',
      }),
      expect.objectContaining({
        sourceText: 'minors',
        targetText: 'mirrors',
        scope: 'phrase',
      }),
    ]));
  });

  it('applies stored phrase corrections before the assistant plans the command', () => {
    const corrections: AssistantCorrection[] = [{
      id: 'corr-1',
      sourceText: 'minors',
      targetText: 'mirrors',
      lang: 'en',
      scope: 'phrase',
      appliedCount: 0,
      createdAt: '2026-04-10T09:00:00.000Z',
      updatedAt: '2026-04-10T09:00:00.000Z',
    }];

    const applied = applyStoredCorrections('delete all of the tasks related to minors', corrections, 'en');

    expect(applied.transcript).toBe('delete all of the tasks related to mirrors');
    expect(applied.appliedCorrectionIds).toEqual(['corr-1']);
  });
});
