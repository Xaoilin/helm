import type { CalendarAccount, CalendarEvent, CalendarSource } from '../types/domain';
import { normalizeCalendarDate } from './calendarEventDates';
import { isGoogleCalendarAccount } from './googleCalendarAuthManager';
import { shiftIsoDate } from './timeZone';

function providerCacheId(prefix: string, ...parts: string[]): string {
  return [prefix, ...parts.map(part => encodeURIComponent(part))].join(':');
}

export function buildGoogleSourceCacheId(accountId: string, googleCalendarId: string): string {
  return providerCacheId('google-source', accountId, googleCalendarId);
}

export function buildGoogleEventCacheId(sourceId: string, googleEventId: string): string {
  return providerCacheId('google-event', sourceId, googleEventId);
}

export function isProviderBackedCalendarSource(
  source: CalendarSource | null | undefined,
  accounts: CalendarAccount[],
): boolean {
  if (!source) return false;
  if (source.googleCalendarId) return true;
  const account = accounts.find(candidate => candidate.id === source.accountId);
  return Boolean(account && isGoogleCalendarAccount(account));
}

export function canApplyLocalCalendarMutation(
  source: CalendarSource | null | undefined,
  accounts: CalendarAccount[],
): boolean {
  return !isProviderBackedCalendarSource(source, accounts);
}

export function isEventInsideCalendarFetchWindow(event: CalendarEvent, timeMin: string, timeMax: string): boolean {
  const min = new Date(timeMin).getTime();
  const max = new Date(timeMax).getTime();
  if (![min, max].every(Number.isFinite) || min > max) return false;

  if (!event.allDay) {
    const start = new Date(event.start).getTime();
    const end = new Date(event.end).getTime();
    if (![start, end].every(Number.isFinite) || start > end) return false;
    return end >= min && start <= max;
  }

  const startDate = normalizeCalendarDate(event.start);
  const endDate = normalizeCalendarDate(event.end);
  if (!startDate || !endDate || startDate > endDate) return false;

  // All-day dates have no timezone, while provider fetch bounds are instants.
  // Without the source timezone, either boundary can fall on the previous,
  // same, or next UTC date. Preserve that ambiguity band and only clean up an
  // event when it overlaps a date unambiguously inside the fetched window.
  const minDate = new Date(min).toISOString().slice(0, 10);
  const maxDate = new Date(max).toISOString().slice(0, 10);
  const interiorStart = shiftIsoDate(minDate, 2);
  const interiorEnd = shiftIsoDate(maxDate, -2);
  if (!interiorStart || !interiorEnd || interiorStart > interiorEnd) return false;

  return endDate >= interiorStart && startDate <= interiorEnd;
}
