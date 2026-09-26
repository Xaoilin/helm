import {
  getZonedDate,
  getZonedDateTimeParts,
  shiftIsoDate,
  validateIanaTimeZone,
  zonedDateTimeToInstant,
  type ZonedDateTimeParts,
} from './timeZone';
import { toLocalDateStr } from './localDate';

export type PrayerZonedDateTimeParts = ZonedDateTimeParts;

export function validatePrayerTimeZone(timeZone: string): string {
  return validateIanaTimeZone(timeZone);
}

export function getPrayerZonedDateTimeParts(
  instant: Date,
  timeZone: string,
): PrayerZonedDateTimeParts | null {
  return getZonedDateTimeParts(instant, timeZone);
}

export function getPrayerZonedDate(instant: Date, timeZone: string): string | null {
  return getZonedDate(instant, timeZone);
}

/**
 * The prayer date at `now`: the schedule zone's date when that zone is valid,
 * otherwise the host's local date (before a timetable has loaded).
 */
export function getPrayerDateAt(now: Date, scheduleTimeZone: string): string {
  if (!scheduleTimeZone) return toLocalDateStr(now);
  return getPrayerZonedDate(now, scheduleTimeZone) ?? toLocalDateStr(now);
}

export function getPrayerZonedClockSeconds(instant: Date, timeZone: string): number | null {
  const parts = getPrayerZonedDateTimeParts(instant, timeZone);
  if (!parts) return null;
  return parts.hour * 3600 + parts.minute * 60 + parts.second + instant.getMilliseconds() / 1000;
}

export function shiftPrayerDate(date: string, days: number): string | null {
  return shiftIsoDate(date, days);
}

/**
 * Convert a validated schedule wall-clock value into its real instant.
 * Ambiguous fall-back clock values resolve to the first occurrence; nonexistent
 * spring-forward values fail closed.
 */
export function prayerZonedDateTimeToInstant(
  date: string,
  clock: string,
  timeZone: string,
): Date | null {
  return zonedDateTimeToInstant(date, clock, timeZone);
}

export function formatPrayerInstantTime(instant: Date, timeZone: string): string {
  if (!Number.isFinite(instant.getTime()) || !validatePrayerTimeZone(timeZone)) return '—';
  try {
    return instant.toLocaleTimeString([], {
      timeZone,
      hour: '2-digit',
      minute: '2-digit',
    });
  } catch {
    return '—';
  }
}
