import { describe, expect, it } from 'vitest';
import type { GoogleCalendarListEntry } from '../services/googleCalendarApi';
import { buildGoogleEventCacheId, buildGoogleSourceCacheId } from '../services/calendarProviderSync';
import { classifyGoogleCalendarSourceOwnership } from '../services/googleCalendarSync/ownership';
import {
  DEFAULT_GOOGLE_CALENDAR_COLOR,
  applyCalendarEventUpserts,
  getGoogleCalendarFetchWindow,
  indexEventsByProviderKey,
  reconcileGoogleCalendarEvents,
  reconcileGoogleCalendarSources,
  removeCalendarEventsById,
  type MappedGoogleEvent,
  type SyncableCalendarSource,
} from '../services/googleCalendarSync/reconcile';
import { makeCalendarEvent, makeCalendarSource } from './fixtures';

const window = {
  timeMin: '2026-09-01T00:00:00.000Z',
  timeMax: '2026-10-31T00:00:00.000Z',
};

function calendar(overrides: Partial<GoogleCalendarListEntry> & { id: string }): GoogleCalendarListEntry {
  return { summary: overrides.id, accessRole: 'owner', backgroundColor: '#112233', ...overrides };
}

function syncableSource(overrides: Partial<SyncableCalendarSource> = {}): SyncableCalendarSource {
  return {
    ...makeCalendarSource({ id: 'source-work', accountId: 'account-a', name: 'Work' }),
    googleCalendarId: 'work@group',
    ...overrides,
  };
}

function fetched(overrides: Partial<MappedGoogleEvent> & { googleEventId: string }): MappedGoogleEvent {
  return {
    title: 'Planning',
    description: '',
    start: '2026-09-20T09:00:00.000Z',
    end: '2026-09-20T10:00:00.000Z',
    allDay: false,
    sourceId: 'source-work',
    googleCalendarId: 'work@group',
    ...overrides,
  };
}

describe('Google calendar source ownership', () => {
  it('separates own, orphaned and active foreign provider sources', () => {
    const ownership = classifyGoogleCalendarSourceOwnership({
      accountId: 'account-a',
      accounts: [{ id: 'account-a' }, { id: 'account-b' }],
      sources: [
        makeCalendarSource({ id: 'own-google', accountId: 'account-a', googleCalendarId: 'a@group' }),
        makeCalendarSource({ id: 'own-local', accountId: 'account-a' }),
        makeCalendarSource({ id: 'foreign', accountId: 'account-b', googleCalendarId: 'shared@group' }),
        makeCalendarSource({ id: 'orphan', accountId: 'account-deleted', googleCalendarId: 'old@group' }),
      ],
    });

    expect(ownership.ownSources.map(source => source.id)).toEqual(['own-google', 'own-local']);
    expect([...ownership.ownByGoogleCalendarId.keys()]).toEqual(['a@group']);
    expect([...ownership.orphanedByGoogleCalendarId.keys()]).toEqual(['old@group']);
    expect([...ownership.activeForeignGoogleCalendarIds]).toEqual(['shared@group']);
  });
});

describe('Google calendar source reconciliation', () => {
  function reconcile(sources: ReturnType<typeof makeCalendarSource>[], googleCalendars: GoogleCalendarListEntry[]) {
    return reconcileGoogleCalendarSources({
      accountId: 'account-a',
      googleCalendars,
      ownership: classifyGoogleCalendarSourceOwnership({
        accountId: 'account-a',
        accounts: [{ id: 'account-a' }, { id: 'account-b' }],
        sources,
      }),
    });
  }

  it('creates a visible source for a calendar the account has not seen', () => {
    const result = reconcile([], [calendar({ id: 'new@group', summary: 'New', backgroundColor: undefined })]);

    expect(result.sourcesToUpsert).toEqual([{
      id: buildGoogleSourceCacheId('account-a', 'new@group'),
      accountId: 'account-a',
      name: 'New',
      color: DEFAULT_GOOGLE_CALENDAR_COLOR,
      visible: true,
      googleCalendarId: 'new@group',
      accessRole: 'owner',
    }]);
    expect(result.syncableSources).toHaveLength(1);
  });

  it('updates a renamed source but keeps its id and the user visibility choice', () => {
    const existing = makeCalendarSource({
      id: 'source-work', accountId: 'account-a', name: 'Old name', color: '#112233', visible: false,
      googleCalendarId: 'work@group', accessRole: 'owner',
    });

    const result = reconcile([existing], [calendar({ id: 'work@group', summary: 'Work' })]);

    expect(result.sourcesToUpsert).toEqual([expect.objectContaining({ id: 'source-work', name: 'Work', visible: false })]);
  });

  it('does not rewrite an unchanged source but still syncs its events', () => {
    const existing = makeCalendarSource({
      id: 'source-work', accountId: 'account-a', name: 'Work', color: '#112233',
      googleCalendarId: 'work@group', accessRole: 'owner',
    });

    const result = reconcile([existing], [calendar({ id: 'work@group', summary: 'Work' })]);

    expect(result.sourcesToUpsert).toEqual([]);
    expect(result.syncableSources.map(source => source.id)).toEqual(['source-work']);
  });

  it('never takes a calendar already owned by another active account', () => {
    const foreign = makeCalendarSource({ id: 'b-shared', accountId: 'account-b', googleCalendarId: 'shared@group' });

    const result = reconcile([foreign], [calendar({ id: 'shared@group' })]);

    expect(result.sourcesToUpsert).toEqual([]);
    expect(result.syncableSources).toEqual([]);
    expect(result.skippedActiveForeignSourceCount).toBe(1);
  });

  it('adopts a source left behind by a removed account, keeping its id', () => {
    const orphan = makeCalendarSource({ id: 'orphan', accountId: 'account-deleted', googleCalendarId: 'old@group' });

    const result = reconcile([orphan], [calendar({ id: 'old@group', summary: 'Old' })]);

    expect(result.adoptedSourceCount).toBe(1);
    expect(result.sourcesToUpsert).toEqual([expect.objectContaining({ id: 'orphan', accountId: 'account-a' })]);
  });

  it('marks a source removed at the provider as stale and keeps local sources', () => {
    const gone = makeCalendarSource({ id: 'gone', accountId: 'account-a', googleCalendarId: 'gone@group' });
    const local = makeCalendarSource({ id: 'local', accountId: 'account-a' });

    const result = reconcile([gone, local], [calendar({ id: 'work@group' })]);

    expect(result.staleSources.map(source => source.id)).toEqual(['gone']);
    expect(result.preservedSources.map(source => source.id)).toEqual(['local']);
  });
});

describe('Google calendar event reconciliation', () => {
  const source = syncableSource();

  function reconcile(cachedEvents: ReturnType<typeof makeCalendarEvent>[], fetchedEvents: MappedGoogleEvent[]) {
    return reconcileGoogleCalendarEvents({
      source,
      fetchedEvents,
      cachedEvents,
      providerIndex: indexEventsByProviderKey(cachedEvents),
      window,
    });
  }

  it('adds a new provider event with a stable cache id', () => {
    const result = reconcile([], [fetched({ googleEventId: 'e1' })]);

    expect(result.eventsToUpsert).toEqual([expect.objectContaining({
      id: buildGoogleEventCacheId('source-work', 'e1'),
      googleEventId: 'e1',
      sourceId: 'source-work',
    })]);
    expect(result.eventIdsToRemove).toEqual([]);
  });

  it('updates a changed event in place and skips an unchanged one', () => {
    const changed = makeCalendarEvent({
      id: 'cached-1', sourceId: 'source-work', googleEventId: 'e1', googleCalendarId: 'work@group', title: 'Old title',
      start: '2026-09-20T09:00:00.000Z', end: '2026-09-20T10:00:00.000Z',
    });
    const unchanged = makeCalendarEvent({
      id: 'cached-2', sourceId: 'source-work', googleEventId: 'e2', googleCalendarId: 'work@group', title: 'Planning',
      start: '2026-09-20T09:00:00.000Z', end: '2026-09-20T10:00:00.000Z',
    });

    const result = reconcile([changed, unchanged], [
      fetched({ googleEventId: 'e1', title: 'New title' }),
      fetched({ googleEventId: 'e2' }),
    ]);

    expect(result.eventsToUpsert).toEqual([expect.objectContaining({ id: 'cached-1', title: 'New title' })]);
  });

  it('clears a pending local sync flag even when the provider content is the same', () => {
    const pending = makeCalendarEvent({
      id: 'cached-1', sourceId: 'source-work', googleEventId: 'e1', googleCalendarId: 'work@group', title: 'Planning',
      start: '2026-09-20T09:00:00.000Z', end: '2026-09-20T10:00:00.000Z', pendingSync: true,
    });

    const result = reconcile([pending], [fetched({ googleEventId: 'e1' })]);

    expect(result.eventsToUpsert).toEqual([expect.objectContaining({ id: 'cached-1', pendingSync: undefined })]);
  });

  it('removes deleted or cancelled events inside the fetch window and keeps older ones', () => {
    const deleted = makeCalendarEvent({
      id: 'deleted', sourceId: 'source-work', googleEventId: 'gone', start: '2026-09-10T09:00:00.000Z', end: '2026-09-10T10:00:00.000Z',
    });
    const outsideWindow = makeCalendarEvent({
      id: 'archived', sourceId: 'source-work', googleEventId: 'old', start: '2026-01-10T09:00:00.000Z', end: '2026-01-10T10:00:00.000Z',
    });
    const localOnly = makeCalendarEvent({ id: 'local', sourceId: 'source-work' });

    const result = reconcile([deleted, outsideWindow, localOnly], []);

    expect(result.eventIdsToRemove).toEqual(['deleted']);
    expect(result.preservedEventCount).toBe(1);
  });

  it('never updates or removes events that belong to another source', () => {
    const otherAccountEvent = makeCalendarEvent({
      id: 'b-event', sourceId: 'source-b', googleEventId: 'e1', googleCalendarId: 'other@group',
      start: '2026-09-10T09:00:00.000Z', end: '2026-09-10T10:00:00.000Z',
    });

    const result = reconcile([otherAccountEvent], [fetched({ googleEventId: 'e1', title: 'Changed' })]);

    expect(result.eventIdsToRemove).toEqual([]);
    expect(result.eventsToUpsert).toEqual([expect.objectContaining({
      id: buildGoogleEventCacheId('source-work', 'e1'),
      sourceId: 'source-work',
    })]);
    expect(result.relinkedEventCount).toBe(0);
  });

  it('relinks a cached copy of the same provider event instead of duplicating it', () => {
    const cachedElsewhere = makeCalendarEvent({
      id: 'cached-elsewhere', sourceId: 'source-old', googleEventId: 'e1', googleCalendarId: 'work@group',
    });

    const first = reconcile([cachedElsewhere], [fetched({ googleEventId: 'e1' })]);

    expect(first.eventsToUpsert).toEqual([expect.objectContaining({ id: 'cached-elsewhere', sourceId: 'source-work' })]);
    expect(first.relinkedEventCount).toBe(1);
    expect(first.providerIndex.get('work@group:e1')?.sourceId).toBe('source-work');
  });

  it('counts a repeated provider event only once as relinked', () => {
    const cachedElsewhere = makeCalendarEvent({
      id: 'cached-elsewhere', sourceId: 'source-old', googleEventId: 'e1', googleCalendarId: 'work@group',
    });

    const result = reconcile([cachedElsewhere], [fetched({ googleEventId: 'e1' }), fetched({ googleEventId: 'e1' })]);

    expect(result.relinkedEventCount).toBe(1);
    expect(result.eventsToUpsert.map(event => event.id)).toEqual(['cached-elsewhere', 'cached-elsewhere']);
  });

  it('does not mutate the provider index it was given', () => {
    const index = indexEventsByProviderKey([]);

    reconcileGoogleCalendarEvents({ source, fetchedEvents: [fetched({ googleEventId: 'e1' })], cachedEvents: [], providerIndex: index, window });

    expect(index.size).toBe(0);
  });
});

describe('Google calendar projection helpers', () => {
  it('projects upserts and removals onto the cached events', () => {
    const cached = [makeCalendarEvent({ id: 'a', title: 'A' }), makeCalendarEvent({ id: 'b', title: 'B' })];

    const upserted = applyCalendarEventUpserts(cached, [
      { id: 'a', sourceId: 'source-local', title: 'A2', description: '', start: 's', end: 'e', allDay: false },
      { id: 'c', sourceId: 'source-local', title: 'C', description: '', start: 's', end: 'e', allDay: false },
    ]);

    expect(upserted.map(event => [event.id, event.title])).toEqual([['a', 'A2'], ['b', 'B'], ['c', 'C']]);
    expect(removeCalendarEventsById(upserted, ['b']).map(event => event.id)).toEqual(['a', 'c']);
  });

  it('builds the fetch window from the configured past and future days', () => {
    const result = getGoogleCalendarFetchWindow(new Date('2026-09-26T12:00:00.000Z'));

    expect(result).toEqual({
      timeMin: '2026-08-27T12:00:00.000Z',
      timeMax: '2026-11-25T12:00:00.000Z',
    });
  });
});
