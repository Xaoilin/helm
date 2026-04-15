import { createElement, type ReactNode } from 'react';
import { beforeEach, describe, expect, it, vi } from 'vitest';
import { act, renderHook, waitFor } from '@testing-library/react';
import { AppProvider } from '../store/AppContext';
import { useGoogleSync } from '../hooks/useGoogleSync';
import { GoogleApiError } from '../services/googleCalendarApi';

const {
  passiveTokenMock,
  fetchCalendarListMock,
  fetchEventsMock,
} = vi.hoisted(() => ({
  passiveTokenMock: vi.fn(),
  fetchCalendarListMock: vi.fn(),
  fetchEventsMock: vi.fn(),
}));

vi.mock('../config', async () => {
  const actual = await vi.importActual<typeof import('../config')>('../config');
  return {
    ...actual,
    GOOGLE_OAUTH_CLIENT_ID: 'test-client-id',
  };
});

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

function wrapper({ children }: { children: ReactNode }) {
  return createElement(AppProvider, null, children);
}

function setGoogleAccounts(rawAccounts: unknown) {
  setGoogleCalendarState({ accounts: rawAccounts });
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

describe('useGoogleSync auth behavior', () => {
  beforeEach(() => {
    localStorage.clear();
    passiveTokenMock.mockReset();
    fetchCalendarListMock.mockReset();
    fetchEventsMock.mockReset();
    passiveTokenMock.mockResolvedValue({
      accessToken: 'test-access-token',
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
  });

  it('does not auto-sync accounts already marked as needing reconnect', async () => {
    setGoogleAccounts([{
      id: 'acc-needs-reconnect',
      name: 'Personal',
      email: 'alisa@example.com',
      provider: 'google',
      isPrimary: true,
      connected: true,
      mocked: false,
      authProvider: 'calendar-oauth',
      authStatus: 'needs_reconnect',
      lastAuthError: 'Reconnect required',
      lastAuthCheckAt: new Date().toISOString(),
    }]);

    renderHook(() => useGoogleSync(), { wrapper });

    await waitFor(() => {
      expect(passiveTokenMock).not.toHaveBeenCalled();
    });
  });

  it('auto-syncs stale connected accounts even when the cached calendar token is already expired', async () => {
    const staleIso = new Date(Date.now() - (TIMING.SYNC_THROTTLE + 60000)).toISOString();
    setGoogleAccounts([{
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
    }]);
    localStorage.setItem('helm:google-tokens:acc-connected', JSON.stringify({
      accessToken: 'stored-token',
      expiresAt: Date.now() - 60000,
      scope: 'calendar',
    }));

    renderHook(() => useGoogleSync(), { wrapper });

    await waitFor(() => {
      expect(passiveTokenMock).toHaveBeenCalledTimes(1);
      expect(fetchCalendarListMock).toHaveBeenCalledTimes(1);
    });
  });

  it('lets a manual sync retry stale reconnect-required accounts and clear the status on success', async () => {
    setGoogleAccounts([{
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
    }]);

    const { result } = renderHook(() => useGoogleSync(), { wrapper });

    await waitFor(() => {
      expect(result.current).toBeTruthy();
    });

    await act(async () => {
      await result.current.triggerSync(true);
    });

    await waitFor(() => {
      const [account] = readGoogleAccounts();
      expect(account.authStatus).toBe('connected');
      expect(account.lastAuthError).toBeUndefined();
    });
  });

  it('marks confirmed 401 responses as reconnect-required', async () => {
    setGoogleAccounts([{
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
    }]);
    fetchCalendarListMock.mockRejectedValueOnce(new GoogleApiError(401, 'expired', 'Google API 401: Unauthorized'));

    const { result } = renderHook(() => useGoogleSync(), { wrapper });

    await waitFor(() => {
      expect(result.current).toBeTruthy();
    });

    await act(async () => {
      await result.current.triggerSync(true);
    });

    await waitFor(() => {
      const [account] = readGoogleAccounts();
      expect(account.authStatus).toBe('needs_reconnect');
      expect(account.lastAuthError).toBe('Google access expired. Reconnect this account.');
    });
  });

  it('marks confirmed 403 responses as revoked', async () => {
    setGoogleAccounts([{
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
    }]);
    fetchCalendarListMock.mockRejectedValueOnce(new GoogleApiError(403, 'revoked', 'Google API 403: Forbidden'));

    const { result } = renderHook(() => useGoogleSync(), { wrapper });

    await waitFor(() => {
      expect(result.current).toBeTruthy();
    });

    await act(async () => {
      await result.current.triggerSync(true);
    });

    await waitFor(() => {
      const [account] = readGoogleAccounts();
      expect(account.authStatus).toBe('revoked');
      expect(account.lastAuthError).toBe('Google access was revoked. Reconnect this account.');
    });
  });

  it('maps transient Google failures to a temporary error state', async () => {
    setGoogleAccounts([{
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
    }]);
    fetchCalendarListMock.mockRejectedValueOnce(new GoogleApiError(500, 'down', 'Google API 500: Internal Server Error'));

    const { result } = renderHook(() => useGoogleSync(), { wrapper });

    await waitFor(() => {
      expect(result.current).toBeTruthy();
    });

    await act(async () => {
      await result.current.triggerSync(true);
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

    await waitFor(() => {
      expect(result.current).toBeTruthy();
    });

    await act(async () => {
      await result.current.triggerSync(true);
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

    await waitFor(() => {
      expect(result.current).toBeTruthy();
    });

    await act(async () => {
      await result.current.triggerSync(true);
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

    await waitFor(() => {
      expect(result.current).toBeTruthy();
    });

    await act(async () => {
      await result.current.triggerSync(true);
    });

    await waitFor(() => {
      expect(readCalendarEvents()).toHaveLength(1);
      expect(readCalendarEvents()[0]?.googleEventId).toBe('evt-old');
      expect(result.current.diagnostics.accounts['acc-window']?.preservedEventCount).toBe(1);
    });
  });
});

const TIMING = {
  SYNC_THROTTLE: 15 * 60 * 1000,
};
