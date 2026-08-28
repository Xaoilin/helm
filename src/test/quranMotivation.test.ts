import { describe, expect, it } from 'vitest';
import { QURAN_MOTIVATION_CARDS, getQuranMotivationForDate } from '../services/quranMotivation';

describe('source-reviewed Quran motivation', () => {
  it('ships exactly the approved references with Arabic, paraphrase labels and source links', () => {
    expect(QURAN_MOTIVATION_CARDS.map(card => card.reference)).toEqual([
      '20:14', '2:45', '29:69', '53:39', '13:28', '94:5-6',
    ]);
    for (const card of QURAN_MOTIVATION_CARDS) {
      expect(card.arabic).toMatch(/[\u0600-\u06ff]/u);
      expect(card.meaningSummary.length).toBeGreaterThan(20);
      expect(card.sourceUrl).toBe(`https://quran.com/${card.reference.replace(':', '/')}`);
      expect(JSON.stringify(card).toLowerCase()).not.toContain('hadith');
    }
  });

  it('selects a deterministic daily card without runtime generation', () => {
    expect(getQuranMotivationForDate('2026-08-28')).toBe(getQuranMotivationForDate('2026-08-28'));
  });
});
