import type { CalendarAccount, CalendarSource } from '../types/domain';

/** Whether a calendar mirrors Google, through its Google calendar ID or its Google account. */
export function isProviderBackedCalendarSource(
  source: CalendarSource | null | undefined,
  accounts: CalendarAccount[],
): boolean {
  if (!source) return false;
  if (source.googleCalendarId) return true;
  const account = accounts.find(candidate => candidate.id === source.accountId);
  return account?.provider === 'google';
}

export function canApplyLocalCalendarMutation(
  source: CalendarSource | null | undefined,
  accounts: CalendarAccount[],
): boolean {
  return !isProviderBackedCalendarSource(source, accounts);
}
