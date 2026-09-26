import { describe, expect, it, vi } from 'vitest';
import type { CalendarAccount, CalendarEvent, CalendarSource } from '../types/domain';
import type { AuthSessionSnapshot } from '../store/supabase';
import {
  GoogleApiError,
  type GoogleCalendarEvent,
  type GoogleCalendarListEntry,
} from '../services/googleCalendarApi';
import {
  GOOGLE_ACCESS_EXPIRED_MESSAGE,
  GOOGLE_ACCESS_REVOKED_MESSAGE,
  GOOGLE_SIGN_IN_REQUIRED_MESSAGE,
  GoogleCalendarReconnectRequiredError,
  deriveGoogleCalendarRuntimeCredentialState,
} from '../services/googleCalendarAccountState';
import {
  GoogleCalendarOAuthFunctionError,
  type GoogleCalendarCredentialStatusSnapshot,
} from '../services/googleCalendarServerAuth';
import type { GoogleCalendarDiagnosticEventInput } from '../services/googleCalendarSync/diagnostics';
import {
  GOOGLE_SYNC_ATTENTION_MESSAGE,
  createGoogleCalendarSyncService,
  type GoogleCalendarSyncDeps,
} from '../services/googleCalendarSync/service';
import type { GoogleSyncApp } from '../services/googleCalendarSync/types';
import { buildGoogleEventCacheId, buildGoogleSourceCacheId } from '../services/calendarProviderSync';
import { makeCalendarAccount, makeCalendarEvent, makeCalendarSource } from './fixtures';

const NOW = new Date('2026-09-26T12:00:00.000Z');
const TOKEN = { accessToken: 'access-token', authProvider: 'calendar-oauth' as const, authExpiresAt: '2026-09-26T13:00:00.000Z' };

const workAccount = makeCalendarAccount({
  id: 'account-work',
  name: 'Work',
  email: 'work@example.test',
  provider: 'google',
  connected: true,
  mocked: false,
  authProvider: 'calendar-oauth',
  authStatus: 'connected',
  lastSyncTime: '2026-09-25T08:00:00.000Z',
});

const homeAccount = makeCalendarAccount({
  id: 'account-home',
  name: 'Home',
  email: 'home@example.test',
  provider: 'google',
  connected: true,
  mocked: false,
  authProvider: 'calendar-oauth',
  authStatus: 'connected',
});

const signedIn: AuthSessionSnapshot = {
  userId: 'user-1',
  email: 'owner@example.test',
  accessTokenPresent: true,
  providerToken: null,
  providerRefreshToken: null,
  provider: 'google',
  expiresAt: null,
};

function primaryCalendar(email: string): GoogleCalendarListEntry {
  return { id: email, summary: email, accessRole: 'owner', primary: true, backgroundColor: '#123456' };
}

function googleEvent(id: string, overrides: Partial<GoogleCalendarEvent> = {}): GoogleCalendarEvent {
  return {
    id,
    summary: `Event ${id}`,
    start: { dateTime: '2026-09-27T09:00:00.000Z' },
    end: { dateTime: '2026-09-27T10:00:00.000Z' },
    ...overrides,
  };
}

/** An in-memory Calendar owner that applies writes the way the real context does. */
function createFakeCalendar(initial: {
  accounts: CalendarAccount[];
  sources?: CalendarSource[];
  events?: CalendarEvent[];
}) {
  let accounts = [...initial.accounts];
  let sources = [...(initial.sources ?? [])];
  let events = [...(initial.events ?? [])];

  const app: GoogleSyncApp = {
    get calendarAccounts() { return accounts; },
    get calendarSources() { return sources; },
    get calendarEvents() { return events; },
    updateCalendarAccount: vi.fn((id, updates) => {
      accounts = accounts.map(account => (account.id === id ? { ...account, ...updates } : account));
    }),
    bulkUpsertCalendarSources: vi.fn(upserts => {
      for (const upsert of upserts) {
        const index = sources.findIndex(source => source.id === upsert.id);
        if (index >= 0) sources[index] = { ...sources[index], ...upsert } as CalendarSource;
        else sources = [...sources, upsert as CalendarSource];
      }
    }),
    bulkUpsertCalendarEvents: vi.fn(upserts => {
      for (const upsert of upserts) {
        const index = events.findIndex(event => event.id === upsert.id);
        if (index >= 0) events[index] = { ...events[index], ...upsert } as CalendarEvent;
        else events = [...events, upsert as CalendarEvent];
      }
    }),
    removeCalendarSource: vi.fn(id => {
      sources = sources.filter(source => source.id !== id);
      events = events.filter(event => event.sourceId !== id);
    }),
    updateCalendarEvent: vi.fn(),
    removeCalendarEvent: vi.fn(),
    bulkRemoveCalendarEvents: vi.fn(ids => {
      events = events.filter(event => !ids.includes(event.id));
    }),
  };

  return { app, account: (id: string) => accounts.find(account => account.id === id)! };
}

function createHarness(options: {
  app: GoogleSyncApp;
  calendars?: GoogleCalendarListEntry[];
  eventsByCalendar?: Record<string, GoogleCalendarEvent[]>;
  snapshot?: AuthSessionSnapshot | null;
  overrides?: Partial<GoogleCalendarSyncDeps>;
}) {
  const events: GoogleCalendarDiagnosticEventInput[] = [];
  const deps: GoogleCalendarSyncDeps = {
    readApp: () => options.app,
    now: () => NOW,
    getAuthSessionSnapshot: () => (options.snapshot === undefined ? signedIn : options.snapshot),
    getPassiveSyncEligibility: () => ({ eligible: true }),
    getRuntimeCredentialState: (account, { serverCredential, snapshot }) => deriveGoogleCalendarRuntimeCredentialState(account, {
      serverCredential,
      snapshot: snapshot ?? null,
      supabaseReady: true,
      legacyTokens: null,
    }),
    getCredentialStatusSnapshot: vi.fn(async (): Promise<GoogleCalendarCredentialStatusSnapshot> => ({
      statuses: [],
      requestId: 'request-1',
      checkedAt: NOW.toISOString(),
      readiness: { functionReachable: true, oauthConfigured: true, originAllowed: true, signedIn: true },
    })),
    bootstrapProfileCredential: vi.fn(),
    getPassiveAccessToken: vi.fn(async () => TOKEN),
    fetchCalendarList: vi.fn(async () => options.calendars ?? [primaryCalendar('work@example.test')]),
    fetchEvents: vi.fn(async (_token: string, calendarId: string) => options.eventsByCalendar?.[calendarId] ?? []),
    recordDiagnosticEvent: event => { events.push(event); },
    logWarn: vi.fn(),
    ...options.overrides,
  };
  return { service: createGoogleCalendarSyncService(deps), deps, events };
}

const workSourceId = buildGoogleSourceCacheId('account-work', 'work@example.test');

describe('Google Calendar sync service: syncAccount', () => {
  it('mirrors new, changed and deleted provider events and records a success diagnostic', async () => {
    const source = makeCalendarSource({
      id: workSourceId, accountId: 'account-work', name: 'work@example.test', color: '#123456',
      googleCalendarId: 'work@example.test', accessRole: 'owner',
    });
    const changed = makeCalendarEvent({
      id: 'cached-changed', sourceId: workSourceId, googleEventId: 'changed', googleCalendarId: 'work@example.test',
      title: 'Old title', start: '2026-09-27T09:00:00.000Z', end: '2026-09-27T10:00:00.000Z',
    });
    const deleted = makeCalendarEvent({
      id: 'cached-deleted', sourceId: workSourceId, googleEventId: 'deleted', googleCalendarId: 'work@example.test',
      start: '2026-09-20T09:00:00.000Z', end: '2026-09-20T10:00:00.000Z',
    });
    const archived = makeCalendarEvent({
      id: 'cached-archived', sourceId: workSourceId, googleEventId: 'archived', googleCalendarId: 'work@example.test',
      start: '2026-01-01T09:00:00.000Z', end: '2026-01-01T10:00:00.000Z',
    });
    const calendar = createFakeCalendar({ accounts: [workAccount], sources: [source], events: [changed, deleted, archived] });
    const { service, deps, events } = createHarness({
      app: calendar.app,
      eventsByCalendar: {
        'work@example.test': [googleEvent('changed', { summary: 'New title' }), googleEvent('new')],
      },
    });

    const result = await service.syncAccount('account-work', 'manual');

    expect(result).toMatchObject({ synced: true, error: null, syncedAt: NOW.toISOString() });
    expect(deps.fetchEvents).toHaveBeenCalledWith('access-token', 'work@example.test', '2026-08-27T12:00:00.000Z', '2026-11-25T12:00:00.000Z');
    expect(calendar.app.calendarEvents.map(event => [event.id, event.title])).toEqual([
      ['cached-changed', 'New title'],
      ['cached-archived', 'Stand-up'],
      [buildGoogleEventCacheId(workSourceId, 'new'), 'Event new'],
    ]);
    expect(calendar.account('account-work')).toMatchObject({ authStatus: 'connected', lastSyncTime: NOW.toISOString(), syncError: undefined });
    expect(result?.credentialPatch).toMatchObject({ credentialHealth: 'refreshable', credentialSource: 'server' });
    expect(result?.diagnostic).toMatchObject({
      outcome: 'success',
      fetchedEventCount: 2,
      upsertedEventCount: 2,
      removedEventCount: 1,
      preservedEventCount: 1,
      cachedEventCount: 3,
    });
    expect(events.at(-1)).toMatchObject({ operation: 'sync_account', phase: 'success', outcome: 'success', upsertedEventCount: 2 });
  });

  it('removes a calendar the provider no longer lists, with its events', async () => {
    const gone = makeCalendarSource({ id: 'gone', accountId: 'account-work', googleCalendarId: 'gone@group' });
    const goneEvent = makeCalendarEvent({ id: 'gone-event', sourceId: 'gone', googleEventId: 'g1', googleCalendarId: 'gone@group' });
    const calendar = createFakeCalendar({ accounts: [workAccount], sources: [gone], events: [goneEvent] });
    const { service } = createHarness({ app: calendar.app });

    const result = await service.syncAccount('account-work', 'auto');

    expect(calendar.app.removeCalendarSource).toHaveBeenCalledWith('gone');
    expect(calendar.app.calendarEvents).toEqual([]);
    expect(result?.diagnostic).toMatchObject({ removedSourceCount: 1, removedEventCount: 1 });
  });

  it('keeps each account\'s events on its own sources when two accounts share a calendar', async () => {
    const homeShared = makeCalendarSource({ id: 'home-shared', accountId: 'account-home', googleCalendarId: 'shared@group' });
    const homeEvent = makeCalendarEvent({ id: 'home-event', sourceId: 'home-shared', googleEventId: 's1', googleCalendarId: 'shared@group' });
    const calendar = createFakeCalendar({ accounts: [workAccount, homeAccount], sources: [homeShared], events: [homeEvent] });
    const { service, deps } = createHarness({
      app: calendar.app,
      calendars: [primaryCalendar('work@example.test'), { id: 'shared@group', summary: 'Shared', accessRole: 'reader' }],
      eventsByCalendar: { 'shared@group': [googleEvent('s1', { summary: 'Changed by work sync' })] },
    });

    await service.syncAccount('account-work', 'manual');

    expect(deps.fetchEvents).not.toHaveBeenCalledWith(expect.anything(), 'shared@group', expect.anything(), expect.anything());
    expect(calendar.app.calendarSources.find(source => source.id === 'home-shared')?.accountId).toBe('account-home');
    expect(calendar.app.calendarEvents.find(event => event.id === 'home-event')).toEqual(homeEvent);
    expect(calendar.app.calendarSources.filter(source => source.accountId === 'account-work').map(source => source.googleCalendarId))
      .toEqual(['work@example.test']);
  });

  it('rejects calendars from a different Google identity without touching sources or events', async () => {
    const calendar = createFakeCalendar({ accounts: [workAccount] });
    const { service, events } = createHarness({ app: calendar.app, calendars: [primaryCalendar('intruder@example.test')] });

    const result = await service.syncAccount('account-work', 'auto');

    expect(result).toMatchObject({ synced: false, credentialPatch: { credentialHealth: 'needs_reconnect' } });
    expect(result?.error).toContain('Google returned intruder@example.test');
    expect(result?.diagnostic).toMatchObject({ outcome: 'ownership_mismatch', skippedDestructiveRemovals: true });
    expect(calendar.app.bulkUpsertCalendarSources).not.toHaveBeenCalled();
    expect(calendar.app.bulkUpsertCalendarEvents).not.toHaveBeenCalled();
    expect(calendar.account('account-work')).toMatchObject({ authStatus: 'needs_reconnect', lastAuthError: result?.error });
    expect(events).toContainEqual(expect.objectContaining({ operation: 'ownership_check', outcome: 'ownership_mismatch' }));
  });

  it('marks the account for reconnect when Google answers 401', async () => {
    const calendar = createFakeCalendar({ accounts: [workAccount] });
    const { service, events } = createHarness({
      app: calendar.app,
      overrides: { fetchCalendarList: vi.fn(async () => { throw new GoogleApiError(401, '{}', 'Unauthorized'); }) },
    });

    const result = await service.syncAccount('account-work', 'manual');

    expect(result).toMatchObject({
      synced: false,
      error: GOOGLE_ACCESS_EXPIRED_MESSAGE,
      persistedLastSync: '2026-09-25T08:00:00.000Z',
      credentialPatch: { credentialHealth: 'needs_reconnect', message: GOOGLE_ACCESS_EXPIRED_MESSAGE },
      diagnostic: { outcome: 'needs_reconnect', message: GOOGLE_ACCESS_EXPIRED_MESSAGE },
    });
    expect(calendar.account('account-work')).toMatchObject({ authStatus: 'needs_reconnect', lastAuthError: GOOGLE_ACCESS_EXPIRED_MESSAGE });
    expect(events).toContainEqual(expect.objectContaining({ operation: 'calendar_list_fetch', phase: 'failure', httpStatus: 401 }));
  });

  it('marks the account revoked when Google answers 403 for an event fetch, and removes nothing', async () => {
    const stale = makeCalendarEvent({
      id: 'stale', sourceId: workSourceId, googleEventId: 'stale', googleCalendarId: 'work@example.test',
      start: '2026-09-20T09:00:00.000Z', end: '2026-09-20T10:00:00.000Z',
    });
    const calendar = createFakeCalendar({ accounts: [workAccount], events: [stale] });
    const { service } = createHarness({
      app: calendar.app,
      overrides: { fetchEvents: vi.fn(async () => { throw new GoogleApiError(403, '{}', 'Forbidden'); }) },
    });

    const result = await service.syncAccount('account-work', 'manual');

    expect(result).toMatchObject({ synced: false, error: GOOGLE_ACCESS_REVOKED_MESSAGE, credentialPatch: { credentialHealth: 'revoked' } });
    expect(calendar.app.bulkRemoveCalendarEvents).not.toHaveBeenCalled();
    expect(calendar.app.calendarEvents).toContainEqual(stale);
  });

  it('surfaces a network failure on one calendar and skips all destructive cleanup', async () => {
    const source = makeCalendarSource({
      id: workSourceId, accountId: 'account-work', name: 'work@example.test', color: '#123456',
      googleCalendarId: 'work@example.test', accessRole: 'owner',
    });
    const stale = makeCalendarEvent({
      id: 'stale', sourceId: workSourceId, googleEventId: 'stale', googleCalendarId: 'work@example.test',
      start: '2026-09-20T09:00:00.000Z', end: '2026-09-20T10:00:00.000Z',
    });
    const calendar = createFakeCalendar({ accounts: [workAccount], sources: [source], events: [stale] });
    const { service, deps, events } = createHarness({
      app: calendar.app,
      calendars: [primaryCalendar('work@example.test'), { id: 'team@group', summary: 'Team', accessRole: 'reader' }],
      overrides: {
        fetchEvents: vi.fn(async (_token: string, calendarId: string) => {
          if (calendarId === 'team@group') throw new TypeError('Failed to fetch');
          return [];
        }),
      },
    });

    const result = await service.syncAccount('account-work', 'auto');

    expect(result?.synced).toBe(false);
    expect(result?.error).toContain('Stale cache cleanup was skipped');
    expect(result?.error).toContain('Failed to fetch');
    expect(result?.credentialPatch).toMatchObject({ credentialHealth: 'temporary_unavailable' });
    expect(calendar.app.bulkRemoveCalendarEvents).not.toHaveBeenCalled();
    expect(calendar.app.removeCalendarSource).not.toHaveBeenCalled();
    expect(calendar.app.calendarEvents).toContainEqual(stale);
    expect(calendar.account('account-work')).toMatchObject({ authStatus: 'error', syncError: result?.error });
    expect(deps.logWarn).toHaveBeenCalledWith('GoogleSync', 'Failed to sync calendar Team: Failed to fetch');
    expect(events).toContainEqual(expect.objectContaining({ operation: 'calendar_event_fetch', outcome: 'temporary_unavailable', calendarId: 'team@group' }));
    expect(events.at(-1)).toMatchObject({ operation: 'sync_account', phase: 'failure', outcome: 'failure' });
  });

  it('surfaces a reconnect-required credential with its own status', async () => {
    const calendar = createFakeCalendar({ accounts: [workAccount] });
    const { service } = createHarness({
      app: calendar.app,
      overrides: {
        getPassiveAccessToken: vi.fn(async () => {
          throw new GoogleCalendarReconnectRequiredError('Access revoked upstream.', 'calendar-oauth', 'revoked');
        }),
      },
    });

    const result = await service.syncAccount('account-work', 'manual');

    expect(result).toMatchObject({ synced: false, error: 'Access revoked upstream.', diagnostic: { outcome: 'needs_reconnect' } });
    expect(calendar.account('account-work')).toMatchObject({ authStatus: 'revoked', lastAuthError: 'Access revoked upstream.' });
  });

  it('returns null for an account that no longer exists', async () => {
    const { service, events } = createHarness({ app: createFakeCalendar({ accounts: [] }).app });

    await expect(service.syncAccount('missing', 'auto')).resolves.toBeNull();
    expect(events).toEqual([]);
  });
});

describe('Google Calendar sync service: sync runs', () => {
  it('returns no run when there are no connected Google accounts', () => {
    const { service, events } = createHarness({ app: createFakeCalendar({ accounts: [makeCalendarAccount()] }).app });

    expect(service.beginSyncRun(false)).toBeNull();
    expect(events).toEqual([]);
  });

  it('records a blocked diagnostic for each ineligible account', () => {
    const calendar = createFakeCalendar({ accounts: [workAccount, homeAccount] });
    const { service, events } = createHarness({
      app: calendar.app,
      overrides: {
        getPassiveSyncEligibility: account => (account.id === 'account-home'
          ? { eligible: false, blockedReason: 'Waiting.' }
          : { eligible: true }),
      },
    });

    const run = service.beginSyncRun(true);

    expect(run).toMatchObject({ triggerSource: 'manual', triggeredAt: NOW.toISOString() });
    expect(run?.syncableAccounts.map(account => account.id)).toEqual(['account-work']);
    expect(run?.blockedDiagnostics).toEqual([expect.objectContaining({ accountId: 'account-home', outcome: 'blocked', message: 'Waiting.' })]);
    expect(events.map(event => [event.operation, event.phase])).toEqual([['sync_trigger', 'start'], ['sync_account', 'blocked']]);
  });

  it('reports attention needed when a run finishes with errors', () => {
    const { service, events } = createHarness({ app: createFakeCalendar({ accounts: [] }).app });

    expect(service.finishSyncRun('auto', true)).toEqual({ hasError: true, syncError: GOOGLE_SYNC_ATTENTION_MESSAGE });
    expect(service.finishSyncRun('auto', false)).toEqual({ hasError: false, syncError: null });
    expect(events.map(event => event.outcome)).toEqual(['failure', 'success']);
  });
});

describe('Google Calendar sync service: refreshCredentialStatuses', () => {
  it('clears statuses when there are no Google accounts', async () => {
    const { service, deps } = createHarness({ app: createFakeCalendar({ accounts: [] }).app });

    await expect(service.refreshCredentialStatuses()).resolves.toEqual({ statuses: {}, serverRuntimeStatus: null });
    expect(deps.getCredentialStatusSnapshot).not.toHaveBeenCalled();
  });

  it('reports sign-in required without calling the hosted service when signed out', async () => {
    const calendar = createFakeCalendar({ accounts: [workAccount] });
    const { service, deps } = createHarness({ app: calendar.app, snapshot: null });

    const result = await service.refreshCredentialStatuses();

    expect(deps.getCredentialStatusSnapshot).not.toHaveBeenCalled();
    expect(result.serverRuntimeStatus).toMatchObject({
      lastErrorCode: 'sign_in_required',
      lastError: GOOGLE_SIGN_IN_REQUIRED_MESSAGE,
      readiness: { signedIn: false },
    });
    expect(result.statuses['account-work']).toMatchObject({ credentialHealth: 'sign_in_required' });
    expect(calendar.account('account-work')).toMatchObject({ authStatus: 'needs_reconnect' });
  });

  it('applies hosted credential health and clears a stale failure', async () => {
    const failing = { ...workAccount, authStatus: 'error' as const, syncError: 'Old outage.' };
    const calendar = createFakeCalendar({ accounts: [failing] });
    const { service, events } = createHarness({
      app: calendar.app,
      overrides: {
        getCredentialStatusSnapshot: vi.fn(async () => ({
          statuses: [{ accountEmail: 'WORK@example.test', serverCredentialPresent: true, credentialHealth: 'refreshable' as const }],
          requestId: 'request-9',
          checkedAt: '2026-09-26T11:59:00.000Z',
          readiness: { functionReachable: true, oauthConfigured: true, originAllowed: true, signedIn: true },
        })),
      },
    });

    const result = await service.refreshCredentialStatuses();

    expect(result.serverRuntimeStatus).toEqual({
      checkedAt: '2026-09-26T11:59:00.000Z',
      requestId: 'request-9',
      readiness: { functionReachable: true, oauthConfigured: true, originAllowed: true, signedIn: true },
      statusCount: 1,
    });
    expect(result.statuses['account-work']).toMatchObject({ credentialHealth: 'refreshable', credentialSource: 'server' });
    expect(calendar.account('account-work')).toMatchObject({
      authStatus: 'connected', syncError: undefined, lastAuthCheckAt: '2026-09-26T11:59:00.000Z',
    });
    expect(events).toContainEqual(expect.objectContaining({ operation: 'credential_status', accountId: 'account-work' }));
  });

  it('keeps an explicit reconnect request even when the hosted credential is refreshable', async () => {
    const mismatched = {
      ...workAccount,
      authStatus: 'needs_reconnect' as const,
      lastAuthError: 'Google returned x@example.test while syncing work@example.test. Reconnect this account explicitly.',
    };
    const calendar = createFakeCalendar({ accounts: [mismatched] });
    const { service } = createHarness({
      app: calendar.app,
      overrides: {
        getCredentialStatusSnapshot: vi.fn(async () => ({
          statuses: [{ accountEmail: 'work@example.test', serverCredentialPresent: true, credentialHealth: 'refreshable' as const }],
          requestId: 'request-9',
          checkedAt: NOW.toISOString(),
          readiness: { functionReachable: true, oauthConfigured: true, originAllowed: true, signedIn: true },
        })),
      },
    });

    await service.refreshCredentialStatuses();

    expect(calendar.account('account-work')).toMatchObject({ authStatus: 'needs_reconnect', lastAuthError: mismatched.lastAuthError });
  });

  it('surfaces a hosted status failure on every account instead of hiding it', async () => {
    const calendar = createFakeCalendar({ accounts: [workAccount, homeAccount] });
    const readiness = { functionReachable: true, oauthConfigured: true, originAllowed: false, signedIn: true };
    const { service, events } = createHarness({
      app: calendar.app,
      overrides: {
        getCredentialStatusSnapshot: vi.fn(async () => {
          throw new GoogleCalendarOAuthFunctionError('temporary_unavailable', 'Hosted status timed out.', { requestId: 'request-5', readiness, httpStatus: 503 });
        }),
      },
    });

    const result = await service.refreshCredentialStatuses();

    expect(result.serverRuntimeStatus).toMatchObject({
      lastError: 'Hosted status timed out.', lastErrorCode: 'temporary_unavailable', requestId: 'request-5', readiness, statusCount: 0,
    });
    expect(Object.values(result.statuses).map(status => [status.credentialHealth, status.message])).toEqual([
      ['temporary_unavailable', 'Hosted status timed out.'],
      ['temporary_unavailable', 'Hosted status timed out.'],
    ]);
    expect(calendar.account('account-home')).toMatchObject({ authStatus: 'error', syncError: 'Hosted status timed out.' });
    expect(events).toContainEqual(expect.objectContaining({
      operation: 'server_status_refresh', phase: 'failure', outcome: 'temporary_unavailable', httpStatus: 503,
    }));
  });

  it('bootstraps the signed-in profile account from its session refresh token', async () => {
    const profile = { ...workAccount, authProvider: 'profile-google' as const };
    const calendar = createFakeCalendar({ accounts: [profile] });
    const bootstrapProfileCredential = vi.fn(async () => ({
      credential: { accountEmail: 'work@example.test', serverCredentialPresent: true, credentialHealth: 'refreshable' as const },
    }));
    const { service } = createHarness({
      app: calendar.app,
      snapshot: { ...signedIn, email: 'work@example.test', providerRefreshToken: 'refresh-token' },
      overrides: { bootstrapProfileCredential },
    });

    const result = await service.refreshCredentialStatuses();

    expect(bootstrapProfileCredential).toHaveBeenCalledWith({ email: 'work@example.test', providerRefreshToken: 'refresh-token' });
    expect(result.statuses['account-work']).toMatchObject({ credentialHealth: 'refreshable', resolvedAuthProvider: 'profile-google' });
  });

  it('does not rewrite an account whose credential state is unchanged', async () => {
    const calendar = createFakeCalendar({ accounts: [workAccount] });
    const { service } = createHarness({ app: calendar.app, snapshot: null });

    await service.refreshCredentialStatuses();
    vi.mocked(calendar.app.updateCalendarAccount).mockClear();
    await service.refreshCredentialStatuses();

    expect(calendar.app.updateCalendarAccount).not.toHaveBeenCalled();
  });
});
