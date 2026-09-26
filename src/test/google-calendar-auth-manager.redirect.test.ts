import { beforeEach, describe, expect, it, vi } from 'vitest';
import { makeCalendarAccount } from './fixtures';

const infra = vi.hoisted(() => ({
  exchangeGoogleCalendarAuthorizationCode: vi.fn(),
}));

vi.mock('../store/supabase', async importOriginal => ({
  ...(await importOriginal<typeof import('../store/supabase')>()),
  getAuthSessionSnapshot: () => ({ userId: 'user-1', email: 'owner@example.test', provider: 'google' }),
  isSupabaseReady: () => true,
}));
vi.mock('../services/googleAuth', async importOriginal => ({
  ...(await importOriginal<typeof import('../services/googleAuth')>()),
  loadGisScript: vi.fn(async () => undefined),
  requestGoogleAuthorizationCode: vi.fn(async () => ({ code: 'auth-code', scope: 'calendar' })),
  clearGoogleTokens: vi.fn(),
}));
vi.mock('../services/googleCalendarServerAuth', async importOriginal => ({
  ...(await importOriginal<typeof import('../services/googleCalendarServerAuth')>()),
  exchangeGoogleCalendarAuthorizationCode: infra.exchangeGoogleCalendarAuthorizationCode,
}));

const {
  connectGoogleCalendarOAuthAccount,
  reconnectGoogleCalendarOAuthAccount,
} = await import('../services/googleCalendarAuthManager');

beforeEach(() => {
  infra.exchangeGoogleCalendarAuthorizationCode.mockReset().mockResolvedValue({
    credential: { accountEmail: 'work@example.test', serverCredentialPresent: true, credentialHealth: 'refreshable' },
    accountName: 'Work',
    calendars: [],
  });
});

describe('Google Calendar OAuth redirect URI', () => {
  it('uses the page origin when no redirect URI is given', async () => {
    await connectGoogleCalendarOAuthAccount('client-id');

    expect(infra.exchangeGoogleCalendarAuthorizationCode).toHaveBeenCalledWith({
      code: 'auth-code',
      redirectUri: window.location.origin,
    });
  });

  it('uses the redirect URI the caller passes for connect and reconnect', async () => {
    const account = makeCalendarAccount({ id: 'account-work', email: 'work@example.test', provider: 'google' });

    await connectGoogleCalendarOAuthAccount('client-id', 'https://app.example.test');
    await reconnectGoogleCalendarOAuthAccount(account, 'client-id', 'https://app.example.test');

    expect(infra.exchangeGoogleCalendarAuthorizationCode).toHaveBeenNthCalledWith(1, {
      code: 'auth-code',
      redirectUri: 'https://app.example.test',
    });
    expect(infra.exchangeGoogleCalendarAuthorizationCode).toHaveBeenNthCalledWith(2, {
      code: 'auth-code',
      redirectUri: 'https://app.example.test',
      expectedEmail: 'work@example.test',
    });
  });
});
