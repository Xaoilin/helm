import { PRAYER_COMPETITION_RECORD } from '../config/prayerCompetition';
import type { PrayerCompetition } from '../types/domain';
import { competitionLeader, competitionRange, getPrayerCompetition, type CompetitionPeriod } from './prayerCompetition';
import { shiftPrayerDate } from './prayerTimeZone';

export interface CompetitionRecord {
  self: number;
  partner: number;
  ties: number;
  unscored: number;
}

export function competitionRecordWindow(today: string, period: CompetitionPeriod, selectedDate: string) {
  const start = PRAYER_COMPETITION_RECORD.startsOn;
  const month = competitionRange(selectedDate, 'month', 0);
  let cursor = period === 'day' && month.from > start ? month.from : start;
  const periods: ReturnType<typeof competitionRange>[] = [];
  while (cursor < today) {
    const range = competitionRange(cursor, period, 0);
    // Only complete calendar periods after the agreed start are eligible.
    if (range.to >= today || (period === 'day' && range.from > month.to)) break;
    if (range.from >= start && (period !== 'day' || range.from >= month.from)) periods.push(range);
    cursor = shiftPrayerDate(range.to, 1)!;
  }
  const startLabel = new Intl.DateTimeFormat('en-GB', { month: 'short', year: 'numeric', timeZone: 'UTC' })
    .format(new Date(`${start}T12:00:00Z`));
  return { periods, label: period === 'day' ? month.label : `Since ${startLabel}` };
}

/** Uses the existing totals-only contract; never loads individual prayer records. */
export async function loadCompetitionRecord(
  periods: ReturnType<typeof competitionRange>[],
  isCurrent: () => boolean,
  read: (from: string, to: string) => Promise<PrayerCompetition> = getPrayerCompetition,
): Promise<CompetitionRecord | null> {
  const record: CompetitionRecord = { self: 0, partner: 0, ties: 0, unscored: 0 };
  let next = 0;
  let unavailable = false;
  async function worker() {
    while (isCurrent() && !unavailable && next < periods.length) {
      const range = periods[next++];
      let data: PrayerCompetition;
      try {
        data = await read(range.from, range.to);
      } catch (error) {
        unavailable = true;
        throw error;
      }
      if (!isCurrent()) return;
      if (!data.partner || data.status !== 'ready') {
        unavailable = true;
        return;
      }
      const winner = competitionLeader(data.self, data.partner);
      if (winner === 'self') record.self++;
      else if (winner === 'partner') record.partner++;
      else if (winner === 'tie') record.ties++;
      else record.unscored++;
    }
  }
  await Promise.all(Array.from({ length: Math.min(periods.length, PRAYER_COMPETITION_RECORD.concurrentReads) }, worker));
  return unavailable || !isCurrent() ? null : record;
}
