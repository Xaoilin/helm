import { createElement, type ReactNode } from 'react';
import { act, renderHook, waitFor } from '@testing-library/react';
import { beforeEach, describe, expect, it, vi } from 'vitest';
import { AppProvider } from '../store/AppContext';
import { useGoogleSync } from '../hooks/useGoogleSync';
import { GoogleApiError } from '../services/googleCalendarApi';
import {
  GOOGLE_UPGRADE_REQUIRED_MESSAGE,
} from '../services/googleCalendarAuthManager';

const {
  bootstrapProfileCredentialMock,
  fetchCalendarListMock,
  fetchEventsMock,
  getAuthSessionSnapshotMock,
  getCredentialStatusesMock,
  isAuthSessionBootstrappedMock,
  isSupabaseReadyMock,
  passiveTokenMock,
} = vi.hoisted(() => ({
  bootstrapProfileCredentialMock: vi.fn(),
  fetchCalendarListMock: vi.fn(),
  fetchEventsMock: vi.fn(),
  getAuthSessionSnapshotMock: vi.fn(),
  getCredentialStatusesMock: vi.fn(),
  isAuthSessionBootstrappedMock: vi.fn(),
  isSupabaseReadyMock: vi.fn(),
  passiveTokenMock: vi.fn(),
}));

vi.mock('../services/googleCalendarApi', async () => {
  const actual = await vi.importActual<typeof import('../services/googleCalendarApi')>('../services/googleCalendarApi');
  return {
    ...actual,
    fetchCalendarList: fetchCalendarListMock,
    fetchEvents: fetchEventsMock,
  };
});

vi.mock('../services/googleCalendarAuthManager', async () => {
  const actual = await vi.importActual<typeof import('../services/googleCalendarAuthManager')>('../services/googleCalendarAuthManager');
  return {
    ...actual,
    getGoogleCalendarPassiveAccessTokenWithRefresh: passiveTokenMock,
  };
});

vi.mock('../services/googleCalendarServerAuth', async () => {
  const actual = await vi.importActual<typeof import('../services/googleCalendarServerAuth')>('../services/googleCalendarServerAuth');
  return {
    ...actual,
    bootstrapGoogleCalendarProfileCredential: bootstrapProfileCredentialMock,
    getGoogleCalendarCredentialStatusSnapshot: getCredentialStatusesMock,
  };
});

vi.mock('../store/supabase', async () => {
  const actual = await vi.importActual<typeof import('../store/supabase')>('../store/supabase');
  return {
    ...actual,
    getAuthSessionSnapshot: getAuthSessionSnapshotMock,
    isAuthSessionBootstrapped: isAuthSessionBootstrappedMock,
    isSupabaseReady: isSupabaseReadyMock,
  };
});

function wrapper({ children }: { children: ReactNode }) {
  return createElement(AppProvider, null, children);
}

function setGoogleCalendarState({
  accounts,
  sources = [],
  events = [],
}: {
  accounts: unknown;
  sources?: unknown;
  events?: unknown;
}) {
  localStorage.setItem('helm:calendarAccounts', JSON.stringify(accounts));
  localStorage.setItem('helm:calendarSources', JSON.stringify(sources));
  localStorage.setItem('helm:calendarEvents', JSON.stringify(events));
}

function readGoogleAccounts() {
  return JSON.parse(localStorage.getItem('helm:calendarAccounts') || '[]') as Array<{
    id: string;
    authStatus?: string;
    lastAuthError?: string;
    syncError?: string;
    authProvider?: string;
  }>;
}

function readCalendarSources() {
  return JSON.parse(localStorage.getItem('helm:calendarSources') || '[]') as Array<{
    id: string;
    googleCalendarId?: string;
  }>;
}

function readCalendarEvents() {
  return JSON.parse(localStorage.getItem('helm:calendarEvents') || '[]') as Array<{
    id: string;
    googleEventId?: string;
    sourceId: string;
  }>;
}

async function waitForHookReady(result: { current: ReturnType<typeof useGoogleSync> | null }) {
  await waitFor(() => {
    expect(result.current).toBeTruthy();
  });
}

describe('useGoogleSync durable auth behavior', () => {
  beforeEach(() => {
    localStorage.clear();
    vi.clearAllMocks();

    getAuthSessionSnapshotMock.mockReturnValue({
      userId: 'user-1',
      email: 'alisa@example.com',
      accessTokenPresent: true,
      providerToken: 'provider-token',
      providerRefreshToken: 'provider-refresh-token',
      provider: 'google',
      expiresAt: Math.floor(Date.now() / 1000) + 3600,
    });
    isAuthSessionBootstrappedMock.mockReturnValue(true);
    isSupabaseReadyMock.mockReturnValue(true);

    passiveTokenMock.mockResolvedValue({
      accessToken: 'server-minted-access-token',
      authProvider: 'calendar-oauth',
      authExpiresAt: new Date(Date.now() + 3600000).toISOString(),
    });
    fetchCalendarListMock.mockResolvedValue([
      {
        id: 'alisa@example.com',
        summary: 'Primary',
        accessRole: 'owner',
        primary: true,
      },
    ]);
    fetchEventsMock.mockResolvedValue([]);
    getCredentialStatusesMock.mockResolvedValue({
      statuses: [
        {
          accountEmail: 'alisa@example.com',
          serverCredentialPresent: true,
          credentialHealth: 'refreshable',
          currentAccessTokenExpiresAt: new Date(Date.now() + 3600000).toISOString(),
          lastRefreshAt: new Date().toISOString(),
          credentialOrigin: 'oauth_code',
        },
      ],
      requestId: 'req-status-1',
      checkedAt: new Date().toISOString(),
      readiness: {
        functionReachable: true,
        oauthConfigured: true,
        originAllowed: true,
        signedIn: true,
      },
    });
    bootstrapProfileCredentialMock.mockResolvedValue({
      credential: {
        accountEmail: 'alisa@example.com',
        serverCredentialPresent: true,
        credentialHealth: 'refreshable',
        currentAccessTokenExpiresAt: new Date(Date.now() + 3600000).toISOString(),
        lastRefreshAt: new Date().toISOString(),
        credentialOrigin: 'profile_session',
      },
      accountName: 'Alisa London',
      calendars: [
        {
          id: 'alisa@example.com',
          summary: 'Primary',
          accessRole: 'owner',
          primary: true,
        },
      ],
    });
  });

  it('does not auto-sync accounts already marked as needing reconnect', async () => {
    setGoogleCalendarState({
      accounts: [{
        id: 'acc-needs-reconnect',
        name: 'Personal',
        email: 'work@example.com',
        provider: 'google',
        isPrimary: true,
        connected: true,
        mocked: false,
        authProvider: 'calendar-oauth',
        authStatus: 'needs_reconnect',
        lastAuthError: 'Reconnect required',
        lastAuthCheckAt: new Date().toISOString(),
      }],
    });

    const { result } = renderHook(() => useGoogleSync(), { wrapper });
    await waitForHookReady(result);

    await waitFor(() => {
      expect(passiveTokenMock).not.toHaveBeenCalled();
    });
  });

  it('auto-syncs stale connected accounts when the hosted credential is refreshable, even if a legacy browser token is expired', async () => {
    const staleIso = new Date(Date.now() - ((15 * 60 * 1000) + 60_000)).toISOString();
    setGoogleCalendarState({
      accounts: [{
        id: 'acc-connected',
        name: 'Personal',
        email: 'alisa@example.com',
        provider: 'google',
        isPrimary: true,
        connected: true,
        mocked: false,
        authProvider: 'calendar-oauth',
        authStatus: 'connected',
        lastAuthCheckAt: staleIso,
        lastSyncTime: staleIso,
      }],
    });
    localStorage.setItem('helm:google-tokens:acc-connected', JSON.stringify({
      accessToken: 'expired-legacy-token',
      expiresAt: Date.now() - 60_000,
      scope: 'calendar',
    }));

    const { result } = renderHook(() => useGoogleSync(), { wrapper });
    await waitForHookReady(result);

    await waitFor(() => {
      expect(getCredentialStatusesMock).toHaveBeenCalled();
      expect(passiveTokenMock).toHaveBeenCalled();
      expect(fetchCalendarListMock).toHaveBeenCalled();
    });
  });

  it('does not loop hosted credential status refreshes when the refresh updates account timestamps', async () => {
    setGoogleCalendarState({
      accounts: [{
        id: 'acc-status-refresh',
        name: 'Personal',
        email: 'alisa@example.com',
        provider: 'google',
        isPrimary: true,
        connected: true,
        mocked: false,
        authProvider: 'calendar-oauth',
        authStatus: 'connected',
        lastAuthCheckAt: '2026-04-15T07:00:00.000Z',
        lastSyncTime: '2026-04-15T07:00:00.000Z',
      }],
    });

    const { result } = renderHook(() => useGoogleSync(), { wrapper });
    await waitForHookReady(result);

    await waitFor(() => {
      expect(getCredentialStatusesMock).toHaveBeenCalledTimes(1);
    });

    await act(async () => {
      await new Promise(resolve => setTimeout(resolve, 50));
    });

    expect(getCredentialStatusesMock).toHaveBeenCalledTimes(1);
  });

  it('marks legacy browser-token accounts as upgrade-required reconnects when no hosted credential exists yet', async () => {
    const freshIso = new Date().toISOString();
    getCredentialStatusesMock.mockResolvedValue({
      statuses: [],
      requestId: 'req-status-2',
      checkedAt: new Date().toISOString(),
      readiness: {
        functionReachable: true,
        oauthConfigured: true,
        originAllowed: true,
        signedIn: true,
      },
    });
    setGoogleCalendarState({
      accounts: [{
        id: 'acc-upgrade',
        name: 'Work',
        email: 'work@example.com',
        provider: 'google',
        isPrimary: true,
        connected: true,
        mocked: false,
        authProvider: 'calendar-oauth',
        authStatus: 'connected',
        lastAuthCheckAt: freshIso,
        lastSyncTime: freshIso,
      }],
    });
    localStorage.setItem('helm:google-tokens:acc-upgrade', JSON.stringify({
      accessToken: 'legacy-token',
      expiresAt: Date.now() - 60_000,
      scope: 'calendar',
    }));

    const { result } = renderHook(() => useGoogleSync(), { wrapper });
    await waitForHookReady(result);

    await waitFor(() => {
      const [account] = readGoogleAccounts();
      expect(account.authStatus).toBe('needs_reconnect');
      expect(account.lastAuthError).toBe(GOOGLE_UPGRADE_REQUIRED_MESSAGE);
      expect(passiveTokenMock).not.toHaveBeenCalled();
    });
  });

  it('bootstraps the linked profile account into a hosted credential when a Supabase refresh token is available', async () => {
    getCredentialStatusesMock.mockResolvedValue({
      statuses: [],
      requestId: 'req-status-3',
      checkedAt: new Date().toISOString(),
      readiness: {
        functionReachable: true,
        oauthConfigured: true,
        originAllowed: true,
        signedIn: true,
      },
    });
    setGoogleCalendarState({
      accounts: [{
        id: 'acc-profile',
        name: 'Personal',
        email: 'alisa@example.com',
        provider: 'google',
        isPrimary: true,
        connected: true,
        mocked: false,
        authProvider: 'profile-google',
        authStatus: 'connected',
        lastAuthCheckAt: new Date().toISOString(),
      }],
    });

    const { result } = renderHook(() => useGoogleSync(), { wrapper });
    await waitForHookReady(result);

    await waitFor(() => {
      expect(bootstrapProfileCredentialMock).toHaveBeenCalled();
      const [account] = readGoogleAccounts();
      expect(account.authStatus).toBe('connected');
      expect(account.lastAuthError).toBeUndefined();
    });
  });

  it('clears stale revoked state when a linked profile account has a refreshable hosted credential', async () => {
    getCredentialStatusesMock.mockResolvedValue({
      statuses: [{
        accountEmail: 'alisa@example.com',
        serverCredentialPresent: true,
        credentialHealth: 'refreshable',
        currentAccessTokenExpiresAt: new Date(Date.now() + 3600000).toISOString(),
        lastRefreshAt: new Date().toISOString(),
        credentialOrigin: 'profile_session',
      }],
      requestId: 'req-status-profile-revoked',
      checkedAt: new Date().toISOString(),
      readiness: {
        functionReachable: true,
        oauthConfigured: true,
        originAllowed: true,
        signedIn: true,
      },
    });
    setGoogleCalendarState({
      accounts: [{
        id: 'acc-profile-revoked',
        name: 'Alisa London',
        email: 'alisa@example.com',
        provider: 'google',
        isPrimary: true,
        connected: true,
        mocked: false,
        authProvider: 'profile-google',
        authStatus: 'revoked',
        lastAuthError: 'Google access was revoked. Reconnect this account.',
        lastAuthCheckAt: new Date().toISOString(),
      }],
    });

    const { result } = renderHook(() => useGoogleSync(), { wrapper });
    await waitForHookReady(result);

    await waitFor(() => {
      const [account] = readGoogleAccounts();
      expect(account.authStatus).toBe('connected');
      expect(account.lastAuthError).toBeUndefined();
      expect(account.syncError).toBeUndefined();
    });
  });

  it('preserves wrong-account reconnect state even if the hosted credential can refresh', async () => {
    setGoogleCalendarState({
      accounts: [{
        id: 'acc-profile-mismatch',
        name: 'Alisa London',
        email: 'alisa@example.com',
        provider: 'google',
        isPrimary: true,
        connected: true,
        mocked: false,
        authProvider: 'profile-google',
        authStatus: 'needs_reconnect',
        lastAuthError: 'Google returned other@example.com while syncing alisa@example.com. Reconnect this account explicitly.',
        lastAuthCheckAt: new Date().toISOString(),
      }],
    });

    const { result } = renderHook(() => useGoogleSync(), { wrapper });
    await waitForHookReady(result);

    await waitFor(() => {
      const [account] = readGoogleAccounts();
      expect(account.authStatus).toBe('needs_reconnect');
      expect(account.lastAuthError).toContain('Reconnect this account explicitly.');
      expect(passiveTokenMock).not.toHaveBeenCalled();
    });
  });

  it('lets a manual sync retry stale reconnect-required accounts and clear the status on success', async () => {
    setGoogleCalendarState({
      accounts: [{
        id: 'acc-retry',
        name: 'Personal',
        email: 'alisa@example.com',
        provider: 'google',
        isPrimary: true,
        connected: true,
        mocked: false,
        authProvider: 'calendar-oauth',
        authStatus: 'needs_reconnect',
        lastAuthError: 'Google access expired. Reconnect this account.',
        lastAuthCheckAt: new Date().toISOString(),
      }],
    });

    const { result } = renderHook(() => useGoogleSync(), { wrapper });
    await waitForHookReady(result);

    await act(async () => {
      await result.current!.triggerSync(true);
    });

    await waitFor(() => {
      const [account] = readGoogleAccounts();
      expect(account.authStatus).toBe('connected');
      expect(account.lastAuthError).toBeUndefined();
    });
  });

  it('marks confirmed 401 responses as reconnect-required', async () => {
    setGoogleCalendarState({
      accounts: [{
        id: 'acc-401',
        name: 'Personal',
        email: 'alisa@example.com',
        provider: 'google',
        isPrimary: true,
        connected: true,
        mocked: false,
        authProvider: 'calendar-oauth',
        authStatus: 'connected',
        lastAuthCheckAt: new Date().toISOString(),
        lastSyncTime: new Date().toISOString(),
      }],
    });
    fetchCalendarListMock.mockRejectedValueOnce(new GoogleApiError(401, 'expired', 'Google API 401: Unauthorized'));

    const { result } = renderHook(() => useGoogleSync(), { wrapper });
    await waitForHookReady(result);

    await act(async () => {
      await result.current!.triggerSync(true);
    });

    await waitFor(() => {
      const [account] = readGoogleAccounts();
      expect(account.authStatus).toBe('needs_reconnect');
      expect(account.lastAuthError).toBe('Google access expired. Reconnect this account.');
    });
  });

  it('marks confirmed 403 responses as revoked', async () => {
    setGoogleCalendarState({
      accounts: [{
        id: 'acc-403',
        name: 'Personal',
        email: 'alisa@example.com',
        provider: 'google',
        isPrimary: true,
        connected: true,
        mocked: false,
        authProvider: 'calendar-oauth',
        authStatus: 'connected',
        lastAuthCheckAt: new Date().toISOString(),
        lastSyncTime: new Date().toISOString(),
      }],
    });
    fetchCalendarListMock.mockRejectedValueOnce(new GoogleApiError(403, 'revoked', 'Google API 403: Forbidden'));

    const { result } = renderHook(() => useGoogleSync(), { wrapper });
    await waitForHookReady(result);

    await act(async () => {
      await result.current!.triggerSync(true);
    });

    await waitFor(() => {
      const [account] = readGoogleAccounts();
      expect(account.authStatus).toBe('revoked');
      expect(account.lastAuthError).toBe('Google access was revoked. Reconnect this account.');
    });
  });

  it('maps transient Google failures to a temporary error state', async () => {
    setGoogleCalendarState({
      accounts: [{
        id: 'acc-500',
        name: 'Personal',
        email: 'alisa@example.com',
        provider: 'google',
        isPrimary: true,
        connected: true,
        mocked: false,
        authProvider: 'calendar-oauth',
        authStatus: 'connected',
        lastAuthCheckAt: new Date().toISOString(),
        lastSyncTime: new Date().toISOString(),
      }],
    });
    fetchCalendarListMock.mockRejectedValueOnce(new GoogleApiError(500, 'down', 'Google API 500: Internal Server Error'));

    const { result } = renderHook(() => useGoogleSync(), { wrapper });
    await waitForHookReady(result);

    await act(async () => {
      await result.current!.triggerSync(true);
    });

    await waitFor(() => {
      const [account] = readGoogleAccounts();
      expect(account.authStatus).toBe('error');
      expect(account.syncError).toBe('Google Calendar temporarily unavailable.');
    });
  });

  it('aborts safely when Google returns the wrong account identity', async () => {
    setGoogleCalendarState({
      accounts: [{
        id: 'acc-mismatch',
        name: 'Personal',
        email: 'alisa@example.com',
        provider: 'google',
        isPrimary: true,
        connected: true,
        mocked: false,
        authProvider: 'calendar-oauth',
        authStatus: 'connected',
        lastAuthCheckAt: new Date().toISOString(),
        lastSyncTime: new Date().toISOString(),
      }],
      sources: [{
        id: 'src-primary',
        accountId: 'acc-mismatch',
        name: 'Primary',
        color: '#4f5bff',
        visible: true,
        googleCalendarId: 'alisa@example.com',
      }],
      events: [{
        id: 'evt-primary',
        sourceId: 'src-primary',
        title: 'Keep me',
        description: '',
        start: '2026-04-14T09:00:00.000Z',
        end: '2026-04-14T10:00:00.000Z',
        allDay: false,
        googleEventId: 'evt-keep',
        googleCalendarId: 'alisa@example.com',
      }],
    });
    fetchCalendarListMock.mockResolvedValueOnce([
      {
        id: 'different@example.com',
        summary: 'Different',
        accessRole: 'owner',
        primary: true,
      },
    ]);

    const { result } = renderHook(() => useGoogleSync(), { wrapper });
    await waitForHookReady(result);

    await act(async () => {
      await result.current!.triggerSync(true);
    });

    await waitFor(() => {
      const [account] = readGoogleAccounts();
      expect(account.authStatus).toBe('needs_reconnect');
      expect(account.lastAuthError).toContain('different@example.com');
      expect(readCalendarSources()).toHaveLength(1);
      expect(readCalendarEvents()).toHaveLength(1);
      expect(result.current.diagnostics.accounts['acc-mismatch']?.outcome).toBe('ownership_mismatch');
    });
  });

  it('keeps cached calendars and events when Google omits a previously synced calendar', async () => {
    setGoogleCalendarState({
      accounts: [{
        id: 'acc-cache',
        name: 'Personal',
        email: 'alisa@example.com',
        provider: 'google',
        isPrimary: true,
        connected: true,
        mocked: false,
        authProvider: 'calendar-oauth',
        authStatus: 'connected',
        lastAuthCheckAt: new Date().toISOString(),
        lastSyncTime: new Date().toISOString(),
      }],
      sources: [
        {
          id: 'src-primary',
          accountId: 'acc-cache',
          name: 'Primary',
          color: '#4f5bff',
          visible: true,
          googleCalendarId: 'alisa@example.com',
        },
        {
          id: 'src-shared',
          accountId: 'acc-cache',
          name: 'Shared',
          color: '#22c55e',
          visible: true,
          googleCalendarId: 'shared-cal',
        },
      ],
      events: [{
        id: 'evt-shared',
        sourceId: 'src-shared',
        title: 'Cached shared event',
        description: '',
        start: '2026-04-14T09:00:00.000Z',
        end: '2026-04-14T10:00:00.000Z',
        allDay: false,
        googleEventId: 'evt-shared',
        googleCalendarId: 'shared-cal',
      }],
    });
    fetchCalendarListMock.mockResolvedValueOnce([
      {
        id: 'alisa@example.com',
        summary: 'Primary',
        accessRole: 'owner',
        primary: true,
      },
    ]);

    const { result } = renderHook(() => useGoogleSync(), { wrapper });
    await waitForHookReady(result);

    await act(async () => {
      await result.current!.triggerSync(true);
    });

    await waitFor(() => {
      expect(readCalendarSources()).toHaveLength(2);
      expect(readCalendarEvents()).toHaveLength(1);
      expect(result.current.diagnostics.accounts['acc-cache']?.preservedSourceCount).toBe(1);
      expect(result.current.diagnostics.accounts['acc-cache']?.preservedEventCount).toBe(1);
    });
  });

  it('keeps cached events that fall outside the current Google fetch window', async () => {
    setGoogleCalendarState({
      accounts: [{
        id: 'acc-window',
        name: 'Personal',
        email: 'alisa@example.com',
        provider: 'google',
        isPrimary: true,
        connected: true,
        mocked: false,
        authProvider: 'calendar-oauth',
        authStatus: 'connected',
        lastAuthCheckAt: new Date().toISOString(),
        lastSyncTime: new Date().toISOString(),
      }],
      sources: [{
        id: 'src-window',
        accountId: 'acc-window',
        name: 'Primary',
        color: '#4f5bff',
        visible: true,
        googleCalendarId: 'alisa@example.com',
      }],
      events: [{
        id: 'evt-outside-window',
        sourceId: 'src-window',
        title: 'Old cached event',
        description: '',
        start: '2025-01-10T09:00:00.000Z',
        end: '2025-01-10T10:00:00.000Z',
        allDay: false,
        googleEventId: 'evt-old',
        googleCalendarId: 'alisa@example.com',
      }],
    });

    const { result } = renderHook(() => useGoogleSync(), { wrapper });
    await waitForHookReady(result);

    await act(async () => {
      await result.current!.triggerSync(true);
    });

    await waitFor(() => {
      expect(readCalendarEvents()).toHaveLength(1);
      expect(readCalendarEvents()[0]?.googleEventId).toBe('evt-old');
      expect(result.current.diagnostics.accounts['acc-window']?.preservedEventCount).toBe(1);
    });
  });
});
