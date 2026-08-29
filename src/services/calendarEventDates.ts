import type { CalendarEvent } from '../types/domain';
import {
  getZonedDate,
  shiftIsoDate,
  validateIanaTimeZone,
} from './timeZone';

export interface AllDayCalendarDateRange {
  startDate: string;
  endDate: string;
}

export function normalizeCalendarDate(value: string): string | null {
  return shiftIsoDate(value.trim(), 0);
}

function readAllDayCalendarDate(value: string, timeZone: string): string | null {
  const date = normalizeCalendarDate(value);
  if (date) return date;

  const zone = validateIanaTimeZone(timeZone);
  const legacyInstant = new Date(value);
  return zone && Number.isFinite(legacyInstant.getTime())
    ? getZonedDate(legacyInstant, zone)
    : null;
}

/**
 * All-day CalendarEvent values are inclusive zone-neutral YYYY-MM-DD dates.
 * The instant fallback keeps older persisted events readable without changing
 * the date-only contract for new writes.
 */
export function getAllDayCalendarDateRange(
  event: Pick<CalendarEvent, 'start' | 'end' | 'allDay'>,
  timeZone: string,
): AllDayCalendarDateRange | null {
  if (!event.allDay) return null;
  const startDate = readAllDayCalendarDate(event.start, timeZone);
  const endDate = readAllDayCalendarDate(event.end, timeZone);
  if (!startDate || !endDate || endDate < startDate) return null;
  return { startDate, endDate };
}

export function isAllDayCalendarEventOnDate(
  event: Pick<CalendarEvent, 'start' | 'end' | 'allDay'>,
  date: string,
  timeZone: string,
): boolean {
  const candidate = normalizeCalendarDate(date);
  const range = getAllDayCalendarDateRange(event, timeZone);
  return Boolean(candidate && range && candidate >= range.startDate && candidate <= range.endDate);
}
