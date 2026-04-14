import { act, fireEvent, render, screen, waitFor } from '@testing-library/react';
import { beforeEach, describe, expect, it, vi } from 'vitest';
import DebugSurface from '../surfaces/DebugSurface';

const {
  appState,
  fetchCalendarListMock,
  getAuthSessionSnapshotMock,
  isAuthSessionBootstrappedMock,
  isSupabaseReadyMock,
  passiveTokenMock,
} = vi.hoisted(() => ({
  appState: {
    calendarAccounts: [] as Array<Record<string, unknown>>,
  },
  fetchCalendarListMock: vi.fn(),
  getAuthSessionSnapshotMock: vi.fn(),
  isAuthSessionBootstrappedMock: vi.fn(),
  isSupabaseReadyMock: vi.fn(),
  passiveTokenMock: vi.fn(),
}));

vi.mock('../components/debug/AiDebug', () => ({
  default: () => <div>AI debug stub</div>,
}));

vi.mock('../components/debug/WakeWordDebug', () => ({
  default: () => <div>Wake word debug stub</div>,
}));

vi.mock('../config', async () => {
  const actual = await vi.importActual<typeof import('../config')>('../config');
  return {
    ...actual,
    GOOGLE_OAUTH_CLIENT_ID: 'test-client-id',
  };
});

vi.mock('../store/AppContext', () => ({
  useApp: () => appState,
}));

vi.mock('../services/googleCalendarApi', async () => {
  const actual = await vi.importActual<typeof import('../services/googleCalendarApi')>('../services/googleCalendarApi');
  return {
    ...actual,
    fetchCalendarList: fetchCalendarListMock,
  };
});

vi.mock('../services/googleCalendarAuthManager', async () => {
  const actual = await vi.importActual<typeof import('../services/googleCalendarAuthManager')>('../services/googleCalendarAuthManager');
  return {
    ...actual,
    getGoogleCalendarPassiveAccessTokenWithRefresh: passiveTokenMock,
  };
});

vi.mock('../store/supabase', () => ({
  getAuthSessionSnapshot: getAuthSessionSnapshotMock,
  isAuthSessionBootstrapped: isAuthSessionBootstrappedMock,
  isSupabaseReady: isSupabaseReadyMock,
}));

describe('DebugSurface Google Calendar diagnostics', () => {
  beforeEach(() => {
    localStorage.clear();
    vi.clearAllMocks();
    appState.calendarAccounts = [{
      id: 'acc-google',
      name: 'Google',
      email: 'alisa@example.com',
      provider: 'google',
      isPrimary: true,
      connected: true,
      mocked: false,
      authProvider: 'calendar-oauth',
      authStatus: 'needs_reconnect',
      lastSyncTime: '2026-04-14T08:00:00.000Z',
      lastAuthCheckAt: '2026-04-14T08:10:00.000Z',
      authExpiresAt: '2026-04-14T08:05:00.000Z',
      lastAuthError: 'Google access expired. Reconnect this account.',
    }];
    localStorage.setItem('helm:google-tokens:acc-google', JSON.stringify({
      accessToken: 'stored-secret-token',
      expiresAt: Date.now() - 60000,
      scope: 'https://www.googleapis.com/auth/calendar',
    }));

    getAuthSessionSnapshotMock.mockReturnValue({
      userId: 'user-1',
      email: 'alisa@example.com',
      accessTokenPresent: true,
      providerToken: 'provider-token-present',
      providerRefreshToken: 'refresh-token-present',
      provider: 'google',
      expiresAt: 1_900_000_000,
    });
    isSupabaseReadyMock.mockReturnValue(true);
    isAuthSessionBootstrappedMock.mockReturnValue(true);
    passiveTokenMock.mockResolvedValue({
      accessToken: 'refreshed-token',
      authProvider: 'profile-google',
      authExpiresAt: '2026-04-14T12:00:00.000Z',
    });
    fetchCalendarListMock.mockResolvedValue([
      { id: 'primary', summary: 'Primary', accessRole: 'owner' },
    ]);
  });

  it('shows redacted Google auth diagnostics in the network tab', async () => {
    await act(async () => {
      render(<DebugSurface />);
    });

    fireEvent.click(screen.getByRole('button', { name: /Network \/ APIs/i }));

    expect(await screen.findByText('Google Calendar Diagnostics')).toBeInTheDocument();
    expect(screen.getByText('HELM Auth Context')).toBeInTheDocument();
    expect(screen.getAllByText('alisa@example.com').length).toBeGreaterThan(0);
    expect(screen.getByText('Stored token expired')).toBeInTheDocument();
    expect(screen.getByText('Passive sync blocked')).toBeInTheDocument();
    expect(screen.getByText('Auto sync is paused until this account is rechecked or reconnected.')).toBeInTheDocument();
    expect(screen.queryByText('stored-secret-token')).not.toBeInTheDocument();
  });

  it('runs a manual passive auth probe without exposing raw tokens', async () => {
    await act(async () => {
      render(<DebugSurface />);
    });

    fireEvent.click(screen.getByRole('button', { name: /Network \/ APIs/i }));
    fireEvent.click(await screen.findByRole('button', { name: 'Run Google Calendar auth check' }));

    await waitFor(() => {
      expect(passiveTokenMock).toHaveBeenCalledTimes(1);
      expect(fetchCalendarListMock).toHaveBeenCalledTimes(1);
    });

    expect(await screen.findByText('Passive access confirmed. 1 calendar visible.')).toBeInTheDocument();
    expect(screen.getByText('Probe: success')).toBeInTheDocument();
    expect(screen.queryByText('refreshed-token')).not.toBeInTheDocument();
  });
});
