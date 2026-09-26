import type { CalendarAccount, CalendarSource } from '../../types/domain';

/**
 * Who owns each Google calendar id, seen from the account being synced.
 *
 * Calendar data is account -> source -> event, and one Google calendar can be
 * shared with several connected accounts. A calendar already owned by another
 * *active* account must never be moved into this one. A source left behind by
 * an account that no longer exists may be adopted, so its events keep their
 * identity instead of being duplicated.
 */
export interface GoogleCalendarSourceOwnership {
  /** Sources this account already owns, provider-backed or local. */
  ownSources: CalendarSource[];
  ownByGoogleCalendarId: Map<string, CalendarSource>;
  orphanedByGoogleCalendarId: Map<string, CalendarSource>;
  activeForeignGoogleCalendarIds: Set<string>;
}

export function classifyGoogleCalendarSourceOwnership(input: {
  accountId: string;
  accounts: readonly Pick<CalendarAccount, 'id'>[];
  sources: readonly CalendarSource[];
}): GoogleCalendarSourceOwnership {
  const { accountId } = input;
  const activeAccountIds = new Set(input.accounts.map(account => account.id));
  const ownSources = input.sources.filter(source => source.accountId === accountId);
  const providerSources = input.sources.filter(
    (source): source is CalendarSource & { googleCalendarId: string } => Boolean(source.googleCalendarId),
  );
  const foreignSources = providerSources.filter(source => source.accountId !== accountId);

  return {
    ownSources,
    ownByGoogleCalendarId: new Map(
      providerSources
        .filter(source => source.accountId === accountId)
        .map(source => [source.googleCalendarId, source]),
    ),
    orphanedByGoogleCalendarId: new Map(
      foreignSources
        .filter(source => !activeAccountIds.has(source.accountId))
        .map(source => [source.googleCalendarId, source]),
    ),
    activeForeignGoogleCalendarIds: new Set(
      foreignSources
        .filter(source => activeAccountIds.has(source.accountId))
        .map(source => source.googleCalendarId),
    ),
  };
}
