/**
 * Device-local calendar date keys (`YYYY-MM-DD`).
 *
 * Use these for values a person picks in a date input and for day arithmetic
 * on such keys. For "what day is it now" in generic app features, use
 * `getAppDate(instant, appTimeZone)` from `appTimeZone.ts`; prayer dates follow
 * the prayer timetable's time zone instead (see docs/app-time-zone.md).
 */

export function toLocalDateStr(date: Date): string {
  return `${date.getFullYear()}-${String(date.getMonth() + 1).padStart(2, '0')}-${String(date.getDate()).padStart(2, '0')}`;
}

/** Parse a `YYYY-MM-DD` key as local midnight. Returns null for anything else. */
export function fromLocalDateStr(value: string): Date | null {
  const match = /^(\d{4})-(\d{2})-(\d{2})$/.exec(value);
  if (!match) return null;
  const [year, month, day] = [Number(match[1]), Number(match[2]), Number(match[3])];
  const date = new Date(year, month - 1, day);
  const roundTrips = date.getFullYear() === year && date.getMonth() === month - 1 && date.getDate() === day;
  return roundTrips ? date : null;
}

/** Move a `YYYY-MM-DD` key by whole calendar days. Returns null for an invalid key. */
export function addLocalDays(value: string, days: number): string | null {
  const date = fromLocalDateStr(value);
  if (!date) return null;
  date.setDate(date.getDate() + days);
  return toLocalDateStr(date);
}
