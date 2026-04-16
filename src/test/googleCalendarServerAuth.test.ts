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

  it('turns ES256 gateway JWT verification failures into an actionable hosted-auth error', async () => {
    functionsInvokeMock.mockResolvedValue({
      data: null,
      error: {
        message: 'Edge Function returned a non-2xx status code',
        context: {
          status: 401,
          statusText: 'Unauthorized',
          headers: new Headers({
            'content-type': 'text/plain',
          }),
          json: async () => {
            throw new Error('not json');
          },
          text: async () => 'Unsupported JWT algorithm ES256',
        },
      },
    });

    let thrown: unknown;
    try {
      await mintGoogleCalendarAccessToken('alisa@example.com');
    } catch (error) {
      thrown = error;
    }

    expect(thrown).toMatchObject({
      name: 'GoogleCalendarOAuthFunctionError',
      code: 'temporary_unavailable',
      httpStatus: 401,
      readiness: {
        functionReachable: true,
        oauthConfigured: true,
        originAllowed: true,
        signedIn: true,
      },
    } satisfies Partial<GoogleCalendarOAuthFunctionError>);
    expect(thrown).toBeInstanceOf(Error);
    expect((thrown as Error).message).toContain('--no-verify-jwt');
  });

  it('turns missing google_calendar_credentials schema errors into an actionable hosted-auth error', async () => {
    functionsInvokeMock.mockResolvedValue({
      data: {
        ok: false,
        error: 'temporary_unavailable',
        message: "Could not find the table 'public.google_calendar_credentials' in the schema cache",
        meta: {
          requestId: 'req-schema-1',
          checkedAt: '2026-04-16T11:29:02.912Z',
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

    const promise = mintGoogleCalendarAccessToken('alisa@example.com');

    await expect(promise).rejects.toMatchObject({
      name: 'GoogleCalendarOAuthFunctionError',
      code: 'temporary_unavailable',
      requestId: 'req-schema-1',
      readiness: {
        functionReachable: true,
        oauthConfigured: true,
        originAllowed: true,
        signedIn: true,
      },
    } satisfies Partial<GoogleCalendarOAuthFunctionError>);
    await expect(promise).rejects.toThrow(/google_calendar_credentials/i);
  });
});
