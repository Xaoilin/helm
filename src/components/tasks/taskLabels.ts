import { fromLocalDateStr } from '../../services/localDate';
import type { PrayerOutcomeStatus } from '../../types/domain';

/** "Mon, Sep 8" for a `YYYY-MM-DD` key; the key itself when it is not a valid date. */
export function formatShortDate(date: string): string {
  const parsed = fromLocalDateStr(date);
  if (!parsed) return date;
  return parsed.toLocaleDateString(undefined, { weekday: 'short', month: 'short', day: 'numeric' });
}

/** Short badge text used on Today rows. */
export function compactPrayerOutcomeLabel(status: PrayerOutcomeStatus): string {
  if (status === 'on_time') return 'On time';
  if (status === 'unclassified') return 'Legacy';
  return status;
}

/** Longer text used on All Tasks cards. */
export function prayerOutcomeLabel(status: PrayerOutcomeStatus): string {
  if (status === 'on_time') return 'on time';
  if (status === 'unclassified') return 'legacy, unclassified';
  return status;
}
