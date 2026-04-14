import { beforeEach, describe, expect, it } from 'vitest';
import type { CalendarAccount } from '../types/domain';
import {
  getGoogleCalendarAuthPatch,
  getGoogleCalendarStatusLabel,
  getResolvedGoogleAuthProvider,
} from '../services/googleCalendarAuthManager';
import { saveGoogleTokens } from '../services/googleAuth';
import type { AuthSessionSnapshot } from '../store/supabase';

function makeGoogleAccount(overrides: Partial<CalendarAccount> = {}): CalendarAccount {
  return {
    id: 'acc-google',
    name: 'Personal',
    email: 'alisa@example.com',
    provider: 'google',
    isPrimary: true,
    connected: true,
    mocked: false,
    ...overrides,
  };
}

describe('googleCalendarAuthManager', () => {
  beforeEach(() => {
    localStorage.clear();
  });

  it('auto-links the matching signed-in Google profile account', () => {
    const snapshot: AuthSessionSnapshot = {
      userId: 'user-1',
      email: 'alisa@example.com',
      providerToken: 'provider-token',
      providerRefreshToken: 'provider-refresh-token',
      provider: 'google',
      expiresAt: Math.floor(Date.now() / 1000) + 3600,
    };

    const account = makeGoogleAccount();
    expect(getResolvedGoogleAuthProvider(account, snapshot)).toBe('profile-google');

    const patch = getGoogleCalendarAuthPatch(account, snapshot);
    expect(patch.authProvider).toBe('profile-google');
    expect(patch.authStatus).toBe('connected');
    expect(patch.lastAuthError).toBeUndefined();
  });

  it('keeps non-matching accounts on calendar-oauth and leaves expired cached tokens passively re-checkable', () => {
    const snapshot: AuthSessionSnapshot = {
      userId: 'user-1',
      email: 'someone-else@example.com',
      providerToken: 'provider-token',
      providerRefreshToken: null,
      provider: 'google',
      expiresAt: Math.floor(Date.now() / 1000) + 3600,
    };

    const account = makeGoogleAccount({ email: 'work@example.com' });
    saveGoogleTokens(account.id, {
      accessToken: 'expired-token',
      expiresAt: Date.now() - 60000,
      scope: 'calendar',
    });

    const patch = getGoogleCalendarAuthPatch(account, snapshot);
    expect(patch.authProvider).toBe('calendar-oauth');
    expect(patch.authStatus).toBe('connected');
    expect(patch.lastAuthError).toBeUndefined();
    expect(getGoogleCalendarStatusLabel({ ...account, ...patch })).toBe('Connected');
  });

  it('treats valid stored tokens as a connected calendar-oauth account', () => {
    const account = makeGoogleAccount({ email: 'work@example.com' });
    saveGoogleTokens(account.id, {
      accessToken: 'valid-token',
      expiresAt: Date.now() + 3600000,
      scope: 'calendar',
    });

    const patch = getGoogleCalendarAuthPatch(account, null);
    expect(patch.authProvider).toBe('calendar-oauth');
    expect(patch.authStatus).toBe('connected');
    expect(patch.lastAuthError).toBeUndefined();
  });

  it('preserves linked profile-google accounts while auth bootstrap is still pending', () => {
    const account = makeGoogleAccount({ authProvider: 'profile-google' });
    expect(getResolvedGoogleAuthProvider(account, null)).toBe('profile-google');
  });

  it('clears legacy reconnect state when a calendar-oauth account still has cached transport credentials', () => {
    const account = makeGoogleAccount({
      email: 'work@example.com',
      authProvider: 'calendar-oauth',
      authStatus: 'needs_reconnect',
      lastAuthError: 'Google access expired. Reconnect this account.',
    });

    saveGoogleTokens(account.id, {
      accessToken: 'expired-token',
      expiresAt: Date.now() - 60000,
      scope: 'calendar',
    });

    const patch = getGoogleCalendarAuthPatch(account, null);
    expect(patch.authStatus).toBe('connected');
    expect(patch.lastAuthError).toBeUndefined();
  });
});
