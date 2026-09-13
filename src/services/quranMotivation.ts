import type { QuranMotivationCard } from '../types/domain';
import { shiftIsoDate } from './timeZone';

import { QURAN_MOTIVATION_CARDS } from '../data/quranMotivationCards';

export { QURAN_MOTIVATION_CARDS };

// Shuffle once with a fixed seed so every device shares the same daily card.
// Reusing this order guarantees 206 distinct days from ANY starting date;
// reshuffling at calendar-cycle boundaries could repeat a recently shown card.
const shuffledCards = [...QURAN_MOTIVATION_CARDS];
let shuffleSeed = 0x514f5241;
for (let index = shuffledCards.length - 1; index > 0; index--) {
  // xorshift32 supplies a reproducible random value for Fisher-Yates.
  shuffleSeed ^= shuffleSeed << 13;
  shuffleSeed ^= shuffleSeed >>> 17;
  shuffleSeed ^= shuffleSeed << 5;
  const swapIndex = Math.floor(((shuffleSeed >>> 0) / 0x1_0000_0000) * (index + 1));
  [shuffledCards[index], shuffledCards[swapIndex]] = [shuffledCards[swapIndex]!, shuffledCards[index]!];
}

export function getQuranMotivationForDate(localDate: string): QuranMotivationCard {
  if (!shiftIsoDate(localDate, 0)) {
    throw new RangeError(`Invalid Quran motivation date: ${localDate}`);
  }
  // The caller supplies the prayer schedule's calendar date. UTC is only a
  // day counter here, so month/year boundaries and DST cannot skip cards.
  const day = Date.parse(`${localDate}T00:00:00Z`) / 86_400_000;
  const count = shuffledCards.length;
  const index = ((day % count) + count) % count;
  return shuffledCards[index]!;
}
