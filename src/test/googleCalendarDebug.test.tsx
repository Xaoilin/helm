import { act, fireEvent, render, screen, waitFor } from '@testing-library/react';
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';
import { APP_RELEASE_VERSION } from '../config/release';
import DebugSurface from '../surfaces/DebugSurface';
import {
  appendGoogleCalendarDiagnosticEvent,
  clearGoogleCalendarDiagnosticEvents,
} from '../services/googleCalendarDiagnosticEvents';

const RELEASE_SEMVER = APP_RELEASE_VERSION.replace(/^v/, '');

const {
  appState,
  fetchCalendarListMock,
  getAuthSessionSnapshotMock,
  googleSyncState,
  isAuthSessionBootstrappedMock,
  isSupabaseReadyMock,
  passiveTokenMock,
} = vi.hoisted(() => ({
  appState: {
    calendarAccounts: [] as Array<Record<string, unknown>>,
  },
  fetchCalendarListMock: vi.fn(),
  getAuthSessionSnapshotMock: vi.fn(),
  googleSyncState: {
    syncState: 'idle',
    lastSyncTime: null,
    syncError: null,
    triggerSync: vi.fn(),
    accountSyncStates: {},
    diagnostics: {
      lastTriggerSource: 'manual',
      lastTriggerAt: '2026-04-14T08:30:00.000Z',
      accounts: {
        'acc-google': {
          accountId: 'acc-google',
          email: 'alisa@example.com',
          checkedAt: '2026-04-14T08:30:00.000Z',
          triggerSource: 'manual',
          outcome: 'blocked',
          message: 'Auto sync is paused until this account is rechecked or reconnected.',
          skippedDestructiveRemovals: false,
        },
      },
    },
    credentialStatuses: {
      'acc-google': {
        accountId: 'acc-google',
        email: 'alisa@example.com',
        resolvedAuthProvider: 'calendar-oauth',
        credentialSource: 'legacy_browser_token',
        serverCredentialPresent: false,
        credentialHealth: 'upgrade_required',
        message: 'Reconnect this Google account once to upgrade it to durable browser Calendar access.',
        currentAccessTokenExpiresAt: '2026-04-14T12:00:00.000Z',
      },
    },
    refreshCredentialStatuses: vi.fn(),
    serverRuntimeStatus: {
      checkedAt: '2026-04-14T08:31:00.000Z',
      requestId: 'req-status-1',
      readiness: {
        functionReachable: true,
        oauthConfigured: false,
        originAllowed: true,
        signedIn: true,
      },
      statusCount: 0,
      lastError: 'Google Calendar OAuth is not configured on the hosted function.',
      lastErrorCode: 'oauth_not_configured',
    },
  },
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

vi.mock('../hooks/useGoogleSync', () => ({
  useGoogleSync: () => googleSyncState,
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
    clearGoogleCalendarDiagnosticEvents();
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
      lastAuthError: 'Reconnect this Google account once to upgrade it to durable browser Calendar access.',
    }];
    localStorage.setItem('helm:google-tokens:acc-google', JSON.stringify({
      accessToken: 'stored-secret-token',
      expiresAt: Date.now() - 60000,
      scope: 'https://www.googleapis.com/auth/calendar',
    }));

    appendGoogleCalendarDiagnosticEvent({
      operation: 'server_status_refresh',
      phase: 'failure',
      outcome: 'failure',
      message: 'Google Calendar OAuth is not configured on the hosted function.',
      code: 'oauth_not_configured',
      requestId: 'req-status-1',
      readiness: {
        functionReachable: true,
        oauthConfigured: false,
        originAllowed: true,
        signedIn: true,
      },
    });

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
      { id: 'alisa@example.com', summary: 'Primary', accessRole: 'owner', primary: true },
    ]);
  });

  afterEach(() => {
    vi.useRealTimers();
    vi.restoreAllMocks();
  });

  it('shows hosted auth readiness plus the persisted runtime timeline', async () => {
    await act(async () => {
      render(<DebugSurface />);
    });

    fireEvent.click(screen.getByRole('button', { name: /Network \/ APIs/i }));

    expect(await screen.findByText('Google Calendar Diagnostics')).toBeInTheDocument();
    expect(screen.getByText('Latest Runtime Summary')).toBeInTheDocument();
    expect(screen.getByText('Hosted Backend Status')).toBeInTheDocument();
    expect(screen.getByText('Recent Runtime Timeline')).toBeInTheDocument();
    expect(screen.getAllByText('Google Calendar OAuth is not configured on the hosted function.').length).toBeGreaterThan(0);
    expect(screen.getAllByText('oauth_not_configured').length).toBeGreaterThan(0);
    expect(screen.getByText('Function reachable')).toBeInTheDocument();
    expect(screen.getByText('OAuth configured')).toBeInTheDocument();
    expect(screen.getByText('No server credential')).toBeInTheDocument();
    expect(screen.queryByText('stored-secret-token')).not.toBeInTheDocument();
  });

  it('can copy and clear redacted diagnostics from the debug page', async () => {
    await act(async () => {
      render(<DebugSurface />);
    });

    fireEvent.click(screen.getByRole('button', { name: /Network \/ APIs/i }));
    fireEvent.click(await screen.findByRole('button', { name: 'Copy diagnostics' }));

    await waitFor(() => {
      expect(navigator.clipboard.writeText).toHaveBeenCalledTimes(1);
    });

    const copied = vi.mocked(navigator.clipboard.writeText).mock.calls.at(-1)?.[0] || '';
    expect(copied).toContain('oauth_not_configured');
    expect(copied).toContain('serverRuntimeStatus');
    expect(copied).not.toContain('stored-secret-token');
    expect(await screen.findByText(/Copied diagnostics with 1 stored event/i)).toBeInTheDocument();

    fireEvent.click(screen.getByRole('button', { name: 'Clear diagnostics' }));

    expect(await screen.findByText('No Google Calendar diagnostics have been recorded yet on this device.')).toBeInTheDocument();
  });

  it('exports the current diagnostics page as a JSON file', async () => {
    vi.useFakeTimers();
    vi.setSystemTime(new Date('2026-04-14T09:06:00.000Z'));
    const createObjectUrl = vi.spyOn(URL, 'createObjectURL').mockReturnValue('blob:google-calendar-diagnostics');
    const revokeObjectUrl = vi.spyOn(URL, 'revokeObjectURL').mockImplementation(() => {});
    const click = vi.spyOn(HTMLAnchorElement.prototype, 'click').mockImplementation(() => {});
    const appendChild = vi.spyOn(document.body, 'appendChild');

    await act(async () => {
      render(<DebugSurface />);
    });

    fireEvent.click(screen.getByRole('button', { name: /Network \/ APIs/i }));
    await act(async () => {
      fireEvent.click(screen.getByRole('button', { name: 'Export diagnostics (.json)' }));
      await Promise.resolve();
    });

    expect(createObjectUrl).toHaveBeenCalledTimes(1);
    expect(appendChild).toHaveBeenCalled();
    expect(click).toHaveBeenCalledTimes(1);
    expect(screen.getByText(new RegExp(`Started download for helm-google-calendar-diagnostics-${RELEASE_SEMVER}-2026-04-14-090600\\.json\\.`, 'i'))).toBeInTheDocument();

    vi.runAllTimers();
    expect(revokeObjectUrl).toHaveBeenCalledWith('blob:google-calendar-diagnostics');
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

    expect((await screen.findAllByText('Passive access confirmed. 1 calendar visible.')).length).toBeGreaterThan(0);
    expect(await screen.findByText(/Probe:\s*success/i)).toBeInTheDocument();
    expect(screen.queryByText('refreshed-token')).not.toBeInTheDocument();
  });
});
