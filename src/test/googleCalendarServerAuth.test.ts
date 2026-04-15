import { beforeEach, describe, expect, it, vi } from 'vitest';
import {
  getGoogleCalendarCredentialStatusSnapshot,
  GoogleCalendarOAuthFunctionError,
  exchangeGoogleCalendarAuthorizationCode,
  mintGoogleCalendarAccessToken,
} from '../services/googleCalendarServerAuth';

const {
  functionsInvokeMock,
  getClientMock,
  getCurrentAccessTokenMock,
  isSupabaseReadyMock,
} = vi.hoisted(() => ({
  functionsInvokeMock: vi.fn(),
  getClientMock: vi.fn(),
  getCurrentAccessTokenMock: vi.fn(),
  isSupabaseReadyMock: vi.fn(),
}));

vi.mock('../store/supabase', () => ({
  getClient: getClientMock,
  getCurrentAccessToken: getCurrentAccessTokenMock,
  isSupabaseReady: isSupabaseReadyMock,
}));

describe('googleCalendarServerAuth', () => {
  beforeEach(() => {
    vi.clearAllMocks();
    isSupabaseReadyMock.mockReturnValue(true);
    getCurrentAccessTokenMock.mockReturnValue('supabase-access-token');
    getClientMock.mockReturnValue({
      functions: {
        invoke: functionsInvokeMock,
      },
    });
  });

  it('calls the hosted function with the current Supabase access token', async () => {
    functionsInvokeMock.mockResolvedValue({
      data: {
        ok: true,
        result: {
          accessToken: 'google-access-token',
          credential: {
            accountEmail: 'alisa@example.com',
            serverCredentialPresent: true,
            credentialHealth: 'refreshable',
            currentAccessTokenExpiresAt: '2026-04-15T10:00:00.000Z',
          },
        },
        meta: {
          requestId: 'req-mint-1',
          checkedAt: '2026-04-15T09:00:00.000Z',
          readiness: {
            functionReachable: true,
            oauthConfigured: true,
            originAllowed: true,
            signedIn: true,
          },
        },
      },
      error: null,
    });

    await expect(mintGoogleCalendarAccessToken('alisa@example.com')).resolves.toEqual({
      accessToken: 'google-access-token',
      credential: expect.objectContaining({
        accountEmail: 'alisa@example.com',
        credentialHealth: 'refreshable',
      }),
    });

    expect(functionsInvokeMock).toHaveBeenCalledWith('google-calendar-oauth', expect.objectContaining({
      body: {
        action: 'mint_access_token',
        accountEmail: 'alisa@example.com',
      },
      headers: {
        Authorization: 'Bearer supabase-access-token',
      },
    }));
  });

  it('throws a typed function error for domain failures from the hosted function', async () => {
    functionsInvokeMock.mockResolvedValue({
      data: {
        ok: false,
        error: 'needs_reconnect',
        message: 'Reconnect this account.',
        accountEmail: 'alisa@example.com',
        meta: {
          requestId: 'req-error-1',
          checkedAt: '2026-04-15T09:10:00.000Z',
          readiness: {
            functionReachable: true,
            oauthConfigured: true,
            originAllowed: true,
            signedIn: true,
          },
        },
      },
      error: null,
    });

    await expect(exchangeGoogleCalendarAuthorizationCode({
      code: 'google-code',
      redirectUri: 'http://localhost:5174',
      expectedEmail: 'alisa@example.com',
    })).rejects.toMatchObject({
      name: 'GoogleCalendarOAuthFunctionError',
      code: 'needs_reconnect',
      accountEmail: 'alisa@example.com',
      requestId: 'req-error-1',
    } satisfies Partial<GoogleCalendarOAuthFunctionError>);
  });

  it('returns hosted status snapshot metadata for debug readiness checks', async () => {
    functionsInvokeMock.mockResolvedValue({
      data: {
        ok: true,
        result: [],
        meta: {
          requestId: 'req-status-1',
          checkedAt: '2026-04-15T10:10:00.000Z',
          readiness: {
            functionReachable: true,
            oauthConfigured: false,
            originAllowed: true,
            signedIn: true,
          },
        },
      },
      error: null,
    });

    await expect(getGoogleCalendarCredentialStatusSnapshot(['alisa@example.com'])).resolves.toEqual({
      statuses: [],
      requestId: 'req-status-1',
      checkedAt: '2026-04-15T10:10:00.000Z',
      readiness: {
        functionReachable: true,
        oauthConfigured: false,
        originAllowed: true,
        signedIn: true,
      },
    });
  });

  it('fails truthfully when there is no signed-in Supabase session', async () => {
    getCurrentAccessTokenMock.mockReturnValue(null);

    await expect(mintGoogleCalendarAccessToken('alisa@example.com')).rejects.toMatchObject({
      name: 'GoogleCalendarOAuthFunctionError',
      code: 'sign_in_required',
    } satisfies Partial<GoogleCalendarOAuthFunctionError>);
    expect(functionsInvokeMock).not.toHaveBeenCalled();
  });
});
