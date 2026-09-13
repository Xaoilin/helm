import { createHash } from 'node:crypto';
import { describe, expect, it } from 'vitest';
import { getQuranMotivationForDate, QURAN_MOTIVATION_CARDS } from '../services/quranMotivation';
import { shiftIsoDate } from '../services/timeZone';

describe('daily Quran reading', () => {
  it('provides 206 distinct source-linked passages with prayer and devotion in the majority', () => {
    const cards = QURAN_MOTIVATION_CARDS;
    expect(cards).toHaveLength(206);
    for (const field of ['id', 'reference', 'translation'] as const) {
      expect(new Set(cards.map(card => card[field])).size).toBe(cards.length);
    }
    expect(cards.filter(card => ['prayer', 'remembrance', 'dua'].includes(card.theme)).length)
      .toBeGreaterThan(cards.length / 2);
    expect(cards.filter(card => card.theme === 'prayer').length).toBeGreaterThanOrEqual(50);
    for (const card of cards) {
      expect(card.translation.trim().length).toBeGreaterThan(0);
      expect(card.sourceUrl).toBe(`https://quran.com/${card.reference.replace(':', '/')}`);
    }
  });

  it('keeps passages within real surah bounds without counting any ayah twice', () => {
    // Ayah counts from the reviewed complete Tanzil/Quran.com corpus.
    const verseCounts = [7, 286, 200, 176, 120, 165, 206, 75, 129, 109, 123, 111, 43, 52, 99, 128, 111, 110, 98, 135, 112, 78, 118, 64, 77, 227, 93, 88, 69, 60, 34, 30, 73, 54, 45, 83, 182, 88, 75, 85, 54, 53, 89, 59, 37, 35, 38, 29, 18, 45, 60, 49, 62, 55, 78, 96, 29, 22, 24, 13, 14, 11, 11, 18, 12, 12, 30, 52, 52, 44, 28, 28, 20, 56, 40, 31, 50, 40, 46, 42, 29, 19, 36, 25, 22, 17, 19, 26, 30, 20, 15, 21, 11, 8, 8, 19, 5, 8, 8, 11, 11, 8, 3, 9, 5, 4, 7, 3, 6, 3, 5, 4, 5, 6];
    const seen = new Set<string>();
    for (const card of QURAN_MOTIVATION_CARDS) {
      const match = /^(\d+):(\d+)(?:-(\d+))?$/u.exec(card.reference);
      expect(match).not.toBeNull();
      const surah = Number(match![1]);
      const start = Number(match![2]);
      const end = Number(match![3] ?? match![2]);
      expect(surah).toBeGreaterThanOrEqual(1);
      expect(surah).toBeLessThanOrEqual(114);
      expect(start).toBeGreaterThanOrEqual(1);
      expect(end).toBeGreaterThanOrEqual(start);
      expect(end).toBeLessThanOrEqual(verseCounts[surah - 1]);
      expect(card.translation.split('\n')).toHaveLength(end - start + 1);
      for (let ayah = start; ayah <= end; ayah++) {
        const key = `${surah}:${ayah}`;
        expect(seen.has(key), `Repeated ayah ${key}`).toBe(false);
        seen.add(key);
      }
    }
    expect(seen.size).toBe(374);
  });

  it('preserves every complete English verse from the Pickthall source receipt', () => {
    // Computed from downloaded source records, not copied from app output.
    // Re-source translation changes; see docs/quran-motivation-review.md.
    const content = QURAN_MOTIVATION_CARDS.map(card => `${card.reference}|${card.translation}`).sort().join('\n');
    expect(createHash('sha256').update(content).digest('hex'))
      .toBe('66dcfbcfdb84cc955acb06d7b8a114fc6ebcd740826f6d181f9ce710cce17400');
  });

  it.each(['2026-01-28', '2026-12-28', '2028-02-27', '2026-03-27', '2026-10-23', '1969-12-29'])(
    'shows every card once before repeating, starting %s',
    start => {
      const count = QURAN_MOTIVATION_CARDS.length;
      const cards = Array.from({ length: count }, (_, day) => (
        getQuranMotivationForDate(shiftIsoDate(start, day)!).id
      ));
      expect(new Set(cards).size).toBe(count);
      expect(new Set(cards)).toEqual(new Set(QURAN_MOTIVATION_CARDS.map(card => card.id)));
      expect(getQuranMotivationForDate(shiftIsoDate(start, count)!).id).toBe(cards[0]);
      expect(cards.at(-1)).not.toBe(cards[0]);
    },
  );

  it('uses a stable shuffled order instead of walking through the catalogue', () => {
    const dates = QURAN_MOTIVATION_CARDS.map((_, day) => shiftIsoDate('1970-01-01', day)!);
    const cycle = dates.map(date => getQuranMotivationForDate(date).id);

    expect(cycle).not.toEqual(QURAN_MOTIVATION_CARDS.map(card => card.id));
    // Visiting other dates cannot consume cards or change a day's selection.
    expect(dates.toReversed().map(date => getQuranMotivationForDate(date).id))
      .toEqual(cycle.toReversed());
  });

  it.each(['', '2026-02-30', '2026-13-01', '2026-9-13', '2026-09-13T12:00:00Z'])(
    'rejects an invalid prayer date: %s',
    date => expect(() => getQuranMotivationForDate(date)).toThrow(RangeError),
  );
});
