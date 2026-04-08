import { createElement, type ReactNode } from 'react';
import { beforeEach, describe, expect, it, vi } from 'vitest';
import { renderHook, waitFor } from '@testing-library/react';
import { AppProvider } from '../store/AppContext';
import { useGoogleSync } from '../hooks/useGoogleSync';

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

  it('does not passive-sync accounts already marked as needing reconnect', async () => {
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

  it('auto-syncs stale connected accounts without interactive auth helpers', async () => {
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
      expiresAt: Date.now() + 3600000,
      scope: 'calendar',
    }));

    renderHook(() => useGoogleSync(), { wrapper });

    await waitFor(() => {
      expect(passiveTokenMock).toHaveBeenCalledTimes(1);
      expect(fetchCalendarListMock).toHaveBeenCalledTimes(1);
    });
  });
});

const TIMING = {
  SYNC_THROTTLE: 15 * 60 * 1000,
};
