import { fireEvent, render, screen, waitFor } from '@testing-library/react';
import { beforeEach, describe, expect, it, vi } from 'vitest';
import IntegrationsSurface from '../surfaces/IntegrationsSurface';
import { GoogleCalendarOAuthFunctionError } from '../services/googleCalendarServerAuth';

const {
  appState,
  authSnapshotMock,
  connectProfileGoogleCalendarMock,
  googleSyncState,
  revokeGoogleCalendarCredentialMock,
  triggerProfileGoogleReconnectMock,
} = vi.hoisted(() => ({
  appState: {
    integrations: [{
      id: 'int-google',
      name: 'Google Calendar',
      provider: 'google',
      status: 'connected',
      description: 'Sync Google Calendar events',
    }],
    calendarAccounts: [{
      id: 'acc-google',
      name: 'Google',
      email: 'alisa@example.com',
      provider: 'google',
      isPrimary: true,
      connected: true,
      mocked: false,
      authProvider: 'calendar-oauth',
      authStatus: 'error',
      lastSyncTime: '2026-04-15T08:00:00.000Z',
      lastAuthCheckAt: '2026-04-15T08:10:00.000Z',
      syncError: 'This browser origin is not allowed to use the hosted Google Calendar OAuth function.',
    }],
    calendarSources: [],
    updateCalendarAccount: vi.fn(),
    addCalendarAccount: vi.fn(),
    addCalendarSource: vi.fn(),
    updateIntegration: vi.fn(),
    removeCalendarAccount: vi.fn(),
    navigate: vi.fn(),
  },
  authSnapshotMock: vi.fn(),
  connectProfileGoogleCalendarMock: vi.fn(),
  googleSyncState: {
    refreshCredentialStatuses: vi.fn(),
    serverRuntimeStatus: {
      checkedAt: '2026-04-15T08:11:00.000Z',
      requestId: 'req-origin',
      readiness: {
        functionReachable: true,
        oauthConfigured: true,
        originAllowed: false,
        signedIn: true,
      },
      statusCount: 0,
      lastError: 'This browser origin is not allowed to use the hosted Google Calendar OAuth function.',
      lastErrorCode: 'unauthorized_origin',
    },
  },
  revokeGoogleCalendarCredentialMock: vi.fn(),
  triggerProfileGoogleReconnectMock: vi.fn(),
}));

vi.mock('../store/AppContext', () => ({
  useApp: () => appState,
}));

vi.mock('../hooks/useGoogleSync', () => ({
  useGoogleSync: () => googleSyncState,
}));

vi.mock('../config', async () => {
  const actual = await vi.importActual<typeof import('../config')>('../config');
  return {
    ...actual,
    GOOGLE_OAUTH_CLIENT_ID: 'test-client-id',
  };
});

vi.mock('../store/supabase', () => ({
  getAuthSessionSnapshot: authSnapshotMock,
}));

vi.mock('../services/googleCalendarAuthManager', async () => {
  const actual = await vi.importActual<typeof import('../services/googleCalendarAuthManager')>('../services/googleCalendarAuthManager');
  return {
    ...actual,
    connectProfileGoogleCalendar: connectProfileGoogleCalendarMock,
    triggerProfileGoogleReconnect: triggerProfileGoogleReconnectMock,
  };
});

vi.mock('../services/googleCalendarServerAuth', async () => {
  const actual = await vi.importActual<typeof import('../services/googleCalendarServerAuth')>('../services/googleCalendarServerAuth');
  return {
    ...actual,
    revokeGoogleCalendarCredential: revokeGoogleCalendarCredentialMock,
  };
});

describe('IntegrationsSurface degraded Google state', () => {
  beforeEach(() => {
    vi.clearAllMocks();
    appState.integrations = [{
      id: 'int-google',
      name: 'Google Calendar',
      provider: 'google',
      status: 'connected',
      description: 'Sync Google Calendar events',
    }];
    appState.calendarAccounts = [{
      id: 'acc-google',
      name: 'Google',
      email: 'alisa@example.com',
      provider: 'google',
      isPrimary: true,
      connected: true,
      mocked: false,
      authProvider: 'calendar-oauth',
      authStatus: 'error',
      lastSyncTime: '2026-04-15T08:00:00.000Z',
      lastAuthCheckAt: '2026-04-15T08:10:00.000Z',
      syncError: 'This browser origin is not allowed to use the hosted Google Calendar OAuth function.',
    }];
    appState.calendarSources = [];
    revokeGoogleCalendarCredentialMock.mockResolvedValue(undefined);
    triggerProfileGoogleReconnectMock.mockResolvedValue(undefined);
    connectProfileGoogleCalendarMock.mockResolvedValue({
      email: 'alisa@example.com',
      accountName: 'Alisa London',
      calendars: [
        {
          id: 'alisa@example.com',
          summary: 'Primary',
          accessRole: 'owner',
          primary: true,
        },
      ],
      authProvider: 'profile-google',
      authExpiresAt: '2026-05-06T12:00:00.000Z',
    });
    authSnapshotMock.mockReturnValue({
      userId: 'user-1',
      email: 'alisa@example.com',
      provider: 'google',
      providerRefreshToken: 'refresh-token',
    });
  });

  it('shows the hosted backend issue truthfully when Google Calendar is degraded', () => {
    render(<IntegrationsSurface />);

    expect(screen.getByText(/Hosted Google Calendar status is degraded right now/i)).toBeInTheDocument();
    expect(screen.getAllByText(/This browser origin is not allowed to use the hosted Google Calendar OAuth function\./i).length).toBeGreaterThan(0);
    expect(screen.getByText((content) => content.includes('Credential status Unavailable'))).toBeInTheDocument();
    expect(screen.getByRole('button', { name: 'Reconnect' })).toBeInTheDocument();
  });

  it('still removes the local Google account when hosted revoke fails', async () => {
    revokeGoogleCalendarCredentialMock.mockRejectedValue(new GoogleCalendarOAuthFunctionError(
      'temporary_unavailable',
      'Hosted Google Calendar database schema is missing the google_calendar_credentials table. Apply the Supabase migration for durable Google Calendar credentials, then retry reconnecting or syncing.',
      {
        requestId: 'req-disconnect-1',
        readiness: {
          functionReachable: true,
          oauthConfigured: true,
          originAllowed: true,
          signedIn: true,
        },
      },
    ));

    render(<IntegrationsSurface />);

    fireEvent.click(screen.getByRole('button', { name: 'Disconnect' }));
    fireEvent.click(screen.getByRole('button', { name: 'Yes' }));

    await waitFor(() => {
      expect(appState.removeCalendarAccount).toHaveBeenCalledWith('acc-google');
      expect(appState.updateIntegration).toHaveBeenCalledWith('int-google', {
        status: 'disconnected',
        configuredAt: undefined,
        lastError: undefined,
      });
      expect(googleSyncState.refreshCredentialStatuses).toHaveBeenCalled();
    });
  });

  it('repairs a revoked HELM sign-in Google Calendar account without looping through sign-in again', async () => {
    appState.integrations = [{
      id: 'int-google',
      name: 'Google Calendar',
      provider: 'google',
      status: 'error',
      description: 'Sync Google Calendar events',
      lastError: 'Google access was revoked. Reconnect this account.',
    }];
    appState.calendarAccounts = [{
      id: 'acc-profile',
      name: 'Alisa London',
      email: 'alisa@example.com',
      provider: 'google',
      isPrimary: true,
      connected: true,
      mocked: false,
      authProvider: 'profile-google',
      authStatus: 'revoked',
      lastSyncTime: '2026-05-02T18:14:10.000Z',
      lastAuthCheckAt: '2026-05-06T10:53:14.000Z',
      lastAuthError: 'Google access was revoked. Reconnect this account.',
    }];

    render(<IntegrationsSurface />);
    fireEvent.click(screen.getByRole('button', { name: 'Reconnect' }));

    await waitFor(() => {
      expect(connectProfileGoogleCalendarMock).toHaveBeenCalledTimes(1);
      expect(triggerProfileGoogleReconnectMock).not.toHaveBeenCalled();
      expect(appState.updateCalendarAccount).toHaveBeenCalledWith('acc-profile', expect.objectContaining({
        authProvider: 'profile-google',
        authStatus: 'connected',
        lastAuthError: undefined,
        syncError: undefined,
      }));
      expect(appState.updateIntegration).toHaveBeenCalledWith('int-google', expect.objectContaining({
        status: 'connected',
        lastError: undefined,
      }));
      expect(googleSyncState.refreshCredentialStatuses).toHaveBeenCalled();
    });
  });
});
