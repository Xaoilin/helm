import type { CalendarEvent, CalendarSource } from '../../types/domain';
import type { GoogleCalendarListEntry } from '../googleCalendarApi';
import { LIMITS } from '../../config/constants';
import {
  buildGoogleEventCacheId,
  buildGoogleSourceCacheId,
  isEventInsideCalendarFetchWindow,
} from '../calendarProviderSync';
import type { GoogleCalendarSourceOwnership } from './ownership';
import type { CalendarEventUpsert } from './types';

/**
 * Pure Google Calendar cache reconciliation.
 *
 * Given the cached accounts, sources and events and what Google returned,
 * these functions compute which sources and events to add, update, relink or
 * remove. They perform no I/O; the sync service applies the result through
 * the Calendar writer.
 */

export const DEFAULT_GOOGLE_CALENDAR_COLOR = '#4f5bff';
const DAY_MS = 86_400_000;

export type SyncableCalendarSource = CalendarSource & { googleCalendarId: string };

/** A Google event already mapped to the local event shape for one source. */
export interface MappedGoogleEvent {
  title: string;
  description: string;
  start: string;
  end: string;
  allDay: boolean;
  location?: string;
  sourceId: string;
  googleEventId: string;
  googleCalendarId: string;
}

export type GoogleEventUpsert = MappedGoogleEvent & { id: string; pendingSync: undefined };

export interface CalendarFetchWindow {
  timeMin: string;
  timeMax: string;
}

/** The provider fetch window around `now`, from the configured past and future day limits. */
export function getGoogleCalendarFetchWindow(now: Date): CalendarFetchWindow {
  const nowMs = now.getTime();
  return {
    timeMin: new Date(nowMs - LIMITS.CALENDAR_PAST_DAYS * DAY_MS).toISOString(),
    timeMax: new Date(nowMs + LIMITS.CALENDAR_FUTURE_DAYS * DAY_MS).toISOString(),
  };
}

export interface SourceReconciliation {
  /** New, adopted or changed sources to write. */
  sourcesToUpsert: SyncableCalendarSource[];
  /** Every local source whose events should be fetched this run. */
  syncableSources: SyncableCalendarSource[];
  /** Provider-backed sources this account owns that Google no longer lists for it. */
  staleSources: CalendarSource[];
  /** Local (non-Google) sources on this account; never removed by sync. */
  preservedSources: CalendarSource[];
  adoptedSourceCount: number;
  skippedActiveForeignSourceCount: number;
}

export function reconcileGoogleCalendarSources(input: {
  accountId: string;
  ownership: GoogleCalendarSourceOwnership;
  googleCalendars: readonly GoogleCalendarListEntry[];
}): SourceReconciliation {
  const { accountId, ownership, googleCalendars } = input;
  const sourcesToUpsert: SyncableCalendarSource[] = [];
  const syncableSources: SyncableCalendarSource[] = [];
  let adoptedSourceCount = 0;
  let skippedActiveForeignSourceCount = 0;

  for (const googleCalendar of googleCalendars) {
    if (ownership.activeForeignGoogleCalendarIds.has(googleCalendar.id)) {
      skippedActiveForeignSourceCount += 1;
      continue;
    }

    const existing = ownership.ownByGoogleCalendarId.get(googleCalendar.id);
    const orphaned = ownership.orphanedByGoogleCalendarId.get(googleCalendar.id);
    const color = googleCalendar.backgroundColor || DEFAULT_GOOGLE_CALENDAR_COLOR;
    if (existing) {
      const nextSource = {
        ...existing,
        id: existing.id,
        accountId,
        name: googleCalendar.summary,
        color,
        visible: existing.visible,
        googleCalendarId: googleCalendar.id,
        accessRole: googleCalendar.accessRole,
      };
      if (
        existing.name !== googleCalendar.summary
        || existing.color !== color
        || existing.accessRole !== googleCalendar.accessRole
      ) {
        sourcesToUpsert.push(nextSource);
      }
      syncableSources.push(nextSource);
    } else if (orphaned) {
      const adopted = {
        ...orphaned,
        accountId,
        name: googleCalendar.summary,
        color,
        visible: orphaned.visible,
        googleCalendarId: googleCalendar.id,
        accessRole: googleCalendar.accessRole,
      };
      sourcesToUpsert.push(adopted);
      syncableSources.push(adopted);
      adoptedSourceCount += 1;
    } else {
      const created = {
        id: buildGoogleSourceCacheId(accountId, googleCalendar.id),
        accountId,
        name: googleCalendar.summary,
        color,
        visible: true,
        googleCalendarId: googleCalendar.id,
        accessRole: googleCalendar.accessRole,
      };
      sourcesToUpsert.push(created);
      syncableSources.push(created);
    }
  }

  const googleCalendarIds = new Set(googleCalendars.map(calendar => calendar.id));
  const syncableGoogleCalendarIds = new Set(syncableSources.map(source => source.googleCalendarId));
  const staleSources = ownership.ownSources.filter(source => (
    Boolean(source.googleCalendarId)
    && (!googleCalendarIds.has(source.googleCalendarId!) || !syncableGoogleCalendarIds.has(source.googleCalendarId!))
  ));
  const preservedSources = ownership.ownSources.filter(source => !source.googleCalendarId);

  return {
    sourcesToUpsert,
    syncableSources,
    staleSources,
    preservedSources,
    adoptedSourceCount,
    skippedActiveForeignSourceCount,
  };
}

export function providerEventKey(googleCalendarId: string, googleEventId: string): string {
  return `${googleCalendarId}:${googleEventId}`;
}

/** Index every cached provider event by Google calendar and event id, across all accounts. */
export function indexEventsByProviderKey(events: readonly CalendarEvent[]): Map<string, CalendarEvent> {
  return new Map(
    events
      .filter(event => event.googleEventId && event.googleCalendarId)
      .map(event => [providerEventKey(event.googleCalendarId!, event.googleEventId!), event] as const),
  );
}

export interface EventReconciliation {
  eventsToUpsert: GoogleEventUpsert[];
  /** Cached events Google no longer returns inside the fetch window. */
  eventIdsToRemove: string[];
  /** Cached events Google did not return because they sit outside the fetch window. */
  preservedEventCount: number;
  /** New events that reuse a cached id from a different source. */
  relinkedEventCount: number;
  /** The provider index including this source's new events. */
  providerIndex: Map<string, CalendarEvent>;
}

/**
 * Reconcile one source's cached events with the events Google returned for it.
 *
 * Only events already on `source` are updated or removed, so one account's
 * sync cannot rewrite or delete another source's events. Cancelled events are
 * filtered out by the provider fetch, so they are absent here and removed like
 * deleted ones. Events outside the fetch window are kept.
 */
export function reconcileGoogleCalendarEvents(input: {
  source: SyncableCalendarSource;
  fetchedEvents: readonly MappedGoogleEvent[];
  cachedEvents: readonly CalendarEvent[];
  providerIndex: ReadonlyMap<string, CalendarEvent>;
  window: CalendarFetchWindow;
}): EventReconciliation {
  const { source, fetchedEvents, window } = input;
  const providerIndex = new Map(input.providerIndex);
  const sourceEvents = input.cachedEvents.filter(event => event.sourceId === source.id);
  const sourceEventsByGoogleId = new Map(
    sourceEvents
      .filter(event => event.googleEventId)
      .map(event => [event.googleEventId!, event]),
  );

  const eventsToUpsert: GoogleEventUpsert[] = [];
  const eventIdsToRemove: string[] = [];
  const seenGoogleEventIds = new Set<string>();
  let preservedEventCount = 0;
  let relinkedEventCount = 0;

  for (const fetched of fetchedEvents) {
    seenGoogleEventIds.add(fetched.googleEventId);
    const existing = sourceEventsByGoogleId.get(fetched.googleEventId);
    if (existing) {
      if (hasProviderEventChanged(existing, fetched)) {
        eventsToUpsert.push({ ...fetched, id: existing.id, pendingSync: undefined });
      }
      continue;
    }

    const key = providerEventKey(source.googleCalendarId, fetched.googleEventId);
    const globallyCached = providerIndex.get(key);
    const id = globallyCached?.id ?? buildGoogleEventCacheId(source.id, fetched.googleEventId);
    const upsert: GoogleEventUpsert = { ...fetched, id, pendingSync: undefined };
    eventsToUpsert.push(upsert);
    if (globallyCached && globallyCached.sourceId !== source.id) {
      relinkedEventCount += 1;
    }
    providerIndex.set(key, upsert);
  }

  for (const event of sourceEvents) {
    if (!event.googleEventId || seenGoogleEventIds.has(event.googleEventId)) continue;
    if (isEventInsideCalendarFetchWindow(event, window.timeMin, window.timeMax)) {
      eventIdsToRemove.push(event.id);
    } else {
      preservedEventCount += 1;
    }
  }

  return { eventsToUpsert, eventIdsToRemove, preservedEventCount, relinkedEventCount, providerIndex };
}

function hasProviderEventChanged(existing: CalendarEvent, fetched: MappedGoogleEvent): boolean {
  return existing.title !== fetched.title
    || existing.start !== fetched.start
    || existing.end !== fetched.end
    || existing.description !== fetched.description
    || existing.location !== fetched.location
    || Boolean(existing.pendingSync);
}

/** Project upserts onto a cached event list the way the Calendar writer applies them. */
export function applyCalendarEventUpserts(
  existingEvents: CalendarEvent[],
  events: ReadonlyArray<CalendarEventUpsert & { id?: string }>,
): CalendarEvent[] {
  if (events.length === 0) return existingEvents;

  const nextEvents = [...existingEvents];
  for (const event of events) {
    if (!event.id) continue;
    const index = nextEvents.findIndex(candidate => candidate.id === event.id);
    if (index >= 0) {
      nextEvents[index] = { ...nextEvents[index], ...event } as CalendarEvent;
    } else {
      nextEvents.push(event as CalendarEvent);
    }
  }
  return nextEvents;
}

export function removeCalendarEventsById(existingEvents: CalendarEvent[], ids: readonly string[]): CalendarEvent[] {
  if (ids.length === 0) return existingEvents;
  const idSet = new Set(ids);
  return existingEvents.filter(event => !idSet.has(event.id));
}

export function countEventsInSources(events: readonly CalendarEvent[], sourceIds: ReadonlySet<string>): number {
  return events.filter(event => sourceIds.has(event.sourceId)).length;
}
