import type { QuranMotivationCard } from '../types/domain';
import { shiftIsoDate } from './timeZone';

import { QURAN_MOTIVATION_CARDS } from '../data/quranMotivationCards';

export { QURAN_MOTIVATION_CARDS };

export function getQuranMotivationForDate(localDate: string): QuranMotivationCard {
  if (!shiftIsoDate(localDate, 0)) {
    throw new RangeError(`Invalid Quran motivation date: ${localDate}`);
  }
  // The caller supplies the prayer schedule's calendar date. UTC is only a
  // day counter here, so month/year boundaries and DST cannot skip cards.
  const day = Date.parse(`${localDate}T00:00:00Z`) / 86_400_000;
  const count = QURAN_MOTIVATION_CARDS.length;
  const index = ((day % count) + count) % count;
  return QURAN_MOTIVATION_CARDS[index]!;
}
