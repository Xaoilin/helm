import { PRAYER_BACKEND_URL } from '../config';
import type { PrayerCompetition, PrayerCompetitionSummary } from '../types/domain';
import { callService } from './backend/serviceClient';
import { competitionSchema } from './backend/competitionContracts';
import { shiftPrayerDate } from './prayerTimeZone';

export type CompetitionPeriod = 'day' | 'week' | 'month';

export function getPrayerCompetition(from: string, to: string): Promise<PrayerCompetition> {
  return callService(PRAYER_BACKEND_URL, 'GET', `/api/prayer/v1/competition?${new URLSearchParams({ from, to })}`,
    competitionSchema).then(result => {
    if ([result.self, result.partner].some(summary => summary && (summary.from !== from || summary.to !== to))) {
      throw new Error('Prayer comparison dates did not match. Please refresh.');
    }
    return result;
  });
}

function dateString(date: Date): string {
  return `${date.getUTCFullYear()}-${String(date.getUTCMonth() + 1).padStart(2, '0')}-${String(date.getUTCDate()).padStart(2, '0')}`;
}

/** Date-only calendar arithmetic: the prayer provider supplies today in the schedule's time zone. */
export function competitionRange(today: string, period: CompetitionPeriod, offset: number) {
  const date = new Date(`${today}T12:00:00Z`);
  let from: string;
  let to: string;
  if (period === 'month') {
    const month = date.getUTCMonth() + offset;
    from = dateString(new Date(Date.UTC(date.getUTCFullYear(), month, 1)));
    to = dateString(new Date(Date.UTC(date.getUTCFullYear(), month + 1, 0)));
  } else {
    const mondayOffset = period === 'week' ? (date.getUTCDay() + 6) % 7 : 0;
    from = shiftPrayerDate(today, offset * (period === 'week' ? 7 : 1) - mondayOffset)!;
    to = shiftPrayerDate(from, period === 'week' ? 6 : 0)!;
  }
  const format = (day: string, options: Intl.DateTimeFormatOptions) =>
    new Intl.DateTimeFormat('en-GB', { ...options, timeZone: 'UTC' }).format(new Date(`${day}T12:00:00Z`));
  const label = period === 'month' ? format(from, { month: 'long', year: 'numeric' })
    : period === 'day' ? format(from, { day: 'numeric', month: 'short', year: 'numeric' })
      : `${format(from, { day: 'numeric', month: 'short' })} – ${format(to, { day: 'numeric', month: 'short', year: 'numeric' })}`;
  return { from, to, label };
}

export function competitionScore(summary: PrayerCompetitionSummary) {
  const completed = summary.onTime + summary.late;
  const total = completed + summary.missed;
  return { completed, total, percentage: total ? Math.round(completed / total * 100) : null };
}

export function competitionLeader(self: PrayerCompetitionSummary, partner: PrayerCompetitionSummary): 'self' | 'partner' | 'tie' | null {
  const a = competitionScore(self);
  const b = competitionScore(partner);
  if (!a.total || !b.total) return null;
  // Compare exact fractions; display rounding must never decide the winner.
  const difference = a.completed * b.total - b.completed * a.total;
  return difference === 0 ? 'tie' : difference > 0 ? 'self' : 'partner';
}
