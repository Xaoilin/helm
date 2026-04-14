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
  localStorage.setItem('helm:calendarAccounts', JSON.stringify(rawAccounts));
  localStorage.setItem('helm:calendarSources', JSON.stringify([]));
  localStorage.setItem('helm:calendarEvents', JSON.stringify([]));
}

function readGoogleAccounts() {
  return JSON.parse(localStorage.getItem('helm:calendarAccounts') || '[]') as Array<{
    id: string;
    authStatus?: string;
    lastAuthError?: string;
    syncError?: string;
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
    fetchCalendarListMock.mockResolvedValue([]);
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
});

const TIMING = {
  SYNC_THROTTLE: 15 * 60 * 1000,
};
