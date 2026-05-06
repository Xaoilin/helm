import type { CalendarAccount, CalendarEvent, CalendarSource } from '../types/domain';
import { isGoogleCalendarAccount } from './googleCalendarAuthManager';

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
  const start = new Date(event.start).getTime();
  const end = new Date(event.end).getTime();
  const min = new Date(timeMin).getTime();
  const max = new Date(timeMax).getTime();
  if (![start, end, min, max].every(Number.isFinite)) return false;

  return end >= min && start <= max;
}
