/**
 * When a prayer may be recorded as prayed. Mirrors the prayer service, which rejects the same
 * cases with `prayer_not_started`, so the app never shows an outcome the service refuses.
 */
import type { PrayerName, PrayerScheduleEntry } from '../types/domain';
import { getPrayerDeadlineBounds } from './prayerTracking';

export interface PrayerCompletionCheck {
  prayerName: PrayerName;
  /** Local prayer date (YYYY-MM-DD) the outcome is for. */
  prayerDate: string;
  /** Today's local prayer date in the timetable's zone. */
  today: string;
  /** Today's timetable, or null when it is not available. */
  timetable: { prayers: readonly PrayerScheduleEntry[]; timezone: string } | null;
  now: Date;
}

/** Thrown when a completion breaks a prayer-time rule; `message` is shown to the user as is. */
export class PrayerCompletionRejectedError extends Error {
  readonly code = 'prayer_not_started';

  constructor(message: string) {
    super(message);
    this.name = 'PrayerCompletionRejectedError';
  }
}

/**
 * A prayer can be recorded once its time has started: never for a future date, and on the
 * current date not before its timetable start. Without a timetable only the date is checked.
 *
 * @returns why the completion is not allowed, or null when it is
 */
export function prayerCompletionRejection(check: PrayerCompletionCheck): string | null {
  const notStarted = `${check.prayerName} has not started yet.`;
  if (check.prayerDate > check.today) return notStarted;
  if (!check.timetable) return null;

  const bounds = getPrayerDeadlineBounds(
    check.timetable.prayers, check.prayerDate, check.prayerName, check.timetable.timezone);
  if (bounds && check.now < bounds.startsAt) return notStarted;
  return null;
}

export function assertPrayerCompletable(check: PrayerCompletionCheck): void {
  const rejection = prayerCompletionRejection(check);
  if (rejection) throw new PrayerCompletionRejectedError(rejection);
}
