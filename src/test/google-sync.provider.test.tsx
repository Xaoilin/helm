import { act, renderHook, waitFor } from '@testing-library/react';
import type { ReactNode } from 'react';
import { beforeEach, describe, expect, it, vi } from 'vitest';
import { GoogleSyncProvider, useGoogleSync, type GoogleSyncApp } from '../hooks/useGoogleSync';
import type { CalendarAccount } from '../types/domain';
import { makeCalendarAccount } from './fixtures';

const infra = vi.hoisted(() => ({
  snapshot: {
    userId: 'user-1',
    email: 'owner@example.test',
    accessTokenPresent: true,
    providerToken: null,
    providerRefreshToken: null,
    provider: 'google',
    expiresAt: null,
  } as null | Record<string, unknown>,
  fetchCalendarList: vi.fn(),
  fetchEvents: vi.fn(),
  mintGoogleCalendarAccessToken: vi.fn(),
  getGoogleCalendarCredentialStatusSnapshot: vi.fn(),
}));

vi.mock('../store/supabase', async importOriginal => ({
  ...(await importOriginal<typeof import('../store/supabase')>()),
  getAuthSessionSnapshot: () => infra.snapshot,
  isAuthSessionBootstrapped: () => true,
  isSupabaseReady: () => true,
  signInWithGoogle: vi.fn(),
}));
vi.mock('../store/persistence', () => ({ CALENDAR_SYNC_REQUEST_EVENT: 'helm:calendar-sync-requested' }));
vi.mock('../services/googleCalendarServerAuth', async importOriginal => ({
  ...(await importOriginal<typeof import('../services/googleCalendarServerAuth')>()),
  mintGoogleCalendarAccessToken: infra.mintGoogleCalendarAccessToken,
  getGoogleCalendarCredentialStatusSnapshot: infra.getGoogleCalendarCredentialStatusSnapshot,
  bootstrapGoogleCalendarProfileCredential: vi.fn(),
}));
vi.mock('../services/googleCalendarApi', async importOriginal => ({
  ...(await importOriginal<typeof import('../services/googleCalendarApi')>()),
  fetchCalendarList: infra.fetchCalendarList,
  fetchEvents: infra.fetchEvents,
}));

const { GoogleApiError } = await import('../services/googleCalendarApi');

const recentlySynced = new Date(Date.now() - 60_000).toISOString();
const workAccount = makeCalendarAccount({
  id: 'account-work',
  email: 'work@example.test',
  provider: 'google',
  connected: true,
  mocked: false,
  authProvider: 'calendar-oauth',
  authStatus: 'connected',
  // Recent enough that auto sync stays throttled, so only the manual trigger runs.
  lastSyncTime: recentlySynced,
});

function fakeApp(accounts: CalendarAccount[]): GoogleSyncApp {
  return {
    calendarAccounts: accounts,
    calendarSources: [],
    calendarEvents: [],
    updateCalendarAccount: vi.fn(),
    bulkUpsertCalendarSources: vi.fn(),
    bulkUpsertCalendarEvents: vi.fn(),
    removeCalendarSource: vi.fn(),
    updateCalendarEvent: vi.fn(),
    removeCalendarEvent: vi.fn(),
    bulkRemoveCalendarEvents: vi.fn(),
  };
}

function renderSync(app: GoogleSyncApp) {
  return renderHook(() => useGoogleSync(), {
    wrapper: ({ children }: { children: ReactNode }) => <GoogleSyncProvider app={app}>{children}</GoogleSyncProvider>,
  });
}

beforeEach(() => {
  localStorage.clear();
  infra.fetchCalendarList.mockReset().mockResolvedValue([
    { id: 'work@example.test', summary: 'Work', accessRole: 'owner', primary: true },
  ]);
  infra.fetchEvents.mockReset().mockResolvedValue([]);
  infra.mintGoogleCalendarAccessToken.mockReset().mockResolvedValue({
    accessToken: 'access-token',
    credential: { accountEmail: 'work@example.test', serverCredentialPresent: true, credentialHealth: 'refreshable' },
  });
  infra.getGoogleCalendarCredentialStatusSnapshot.mockReset().mockResolvedValue({
    statuses: [{ accountEmail: 'work@example.test', serverCredentialPresent: true, credentialHealth: 'refreshable' }],
    requestId: 'request-1',
    checkedAt: '2026-09-26T12:00:00.000Z',
    readiness: { functionReachable: true, oauthConfigured: true, originAllowed: true, signedIn: true },
  });
});

describe('GoogleSyncProvider', () => {
  it('exposes the same sync API to consumers', async () => {
    const { result } = renderSync(fakeApp([]));

    expect(Object.keys(result.current).sort()).toEqual([
      'accountSyncStates',
      'credentialStatuses',
      'diagnostics',
      'lastSyncTime',
      'refreshCredentialStatuses',
      'serverRuntimeStatus',
      'syncError',
      'syncState',
      'triggerSync',
    ]);
    expect(result.current).toMatchObject({
      syncState: 'idle',
      syncError: null,
      lastSyncTime: null,
      accountSyncStates: {},
      diagnostics: { accounts: {} },
      credentialStatuses: {},
      serverRuntimeStatus: null,
    });
    await act(() => result.current.triggerSync(true));
    expect(infra.fetchCalendarList).not.toHaveBeenCalled();
  });

  it('refuses to be used outside the provider', () => {
    vi.spyOn(console, 'error').mockImplementation(() => undefined);
    expect(() => renderHook(() => useGoogleSync())).toThrow('useGoogleSync must be used within GoogleSyncProvider');
  });

  it('publishes hosted credential status for connected Google accounts', async () => {
    const { result } = renderSync(fakeApp([workAccount]));

    await waitFor(() => expect(result.current.serverRuntimeStatus).toMatchObject({ requestId: 'request-1', statusCount: 1 }));
    expect(result.current.credentialStatuses['account-work']).toMatchObject({ credentialHealth: 'refreshable' });
    expect(result.current.lastSyncTime).toBe(recentlySynced);
  });

  it('runs a manual sync through the service and publishes the account result', async () => {
    const app = fakeApp([workAccount]);
    const { result } = renderSync(app);

    await act(() => result.current.triggerSync(true));

    expect(result.current.syncState).toBe('idle');
    expect(result.current.syncError).toBeNull();
    expect(result.current.accountSyncStates['account-work']).toMatchObject({ state: 'idle', error: null });
    expect(result.current.diagnostics).toMatchObject({
      lastTriggerSource: 'manual',
      accounts: { 'account-work': { outcome: 'success' } },
    });
    expect(result.current.credentialStatuses['account-work']).toMatchObject({ credentialHealth: 'refreshable' });
    expect(app.bulkUpsertCalendarSources).toHaveBeenCalledTimes(1);
  });

  it('publishes a provider 401 as an account error that needs attention', async () => {
    infra.fetchCalendarList.mockRejectedValue(new GoogleApiError(401, '{}', 'Unauthorized'));
    const { result } = renderSync(fakeApp([workAccount]));

    await act(() => result.current.triggerSync(true));

    expect(result.current.syncState).toBe('error');
    expect(result.current.syncError).toBe('Some Google Calendar accounts need attention.');
    expect(result.current.accountSyncStates['account-work']).toMatchObject({
      state: 'error',
      lastSync: recentlySynced,
      error: 'Google access expired. Reconnect this account.',
    });
    expect(result.current.credentialStatuses['account-work']).toMatchObject({ credentialHealth: 'needs_reconnect' });
  });
});
