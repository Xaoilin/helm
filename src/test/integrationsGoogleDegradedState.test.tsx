import { render, screen } from '@testing-library/react';
import { beforeEach, describe, expect, it, vi } from 'vitest';
import IntegrationsSurface from '../surfaces/IntegrationsSurface';

const {
  appState,
  authSnapshotMock,
  googleSyncState,
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
  },
  authSnapshotMock: vi.fn(),
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

describe('IntegrationsSurface degraded Google state', () => {
  beforeEach(() => {
    vi.clearAllMocks();
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
  });
});
