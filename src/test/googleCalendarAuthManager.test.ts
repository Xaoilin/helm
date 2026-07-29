// @vitest-environment node
import { beforeEach, describe, expect, it } from 'vitest';
import type { CalendarAccount } from '../types/domain';
import {
  GOOGLE_PROFILE_UPGRADE_REQUIRED_MESSAGE,
  GOOGLE_RECONNECT_REQUIRED_MESSAGE,
  GOOGLE_SIGN_IN_REQUIRED_MESSAGE,
  GOOGLE_HOSTED_SCHEMA_MISSING_MESSAGE,
  GOOGLE_UPGRADE_REQUIRED_MESSAGE,
  getGoogleCalendarAccountPatchForCredentialState,
  getGoogleCalendarAuthPatch,
  getGoogleCalendarCredentialStatusLabel,
  getGoogleCalendarOwnershipResult,
  getGoogleCalendarRuntimeCredentialState,
  getGoogleCalendarStatusLabel,
  getResolvedGoogleAuthProvider,
} from '../services/googleCalendarAuthManager';
import { saveGoogleTokens } from '../services/googleAuth';
import { initSupabase, type AuthSessionSnapshot } from '../store/supabase';

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
    initSupabase('https://example.supabase.co', 'anon-key');
  });

  it('auto-links the matching signed-in Google profile account', () => {
    const snapshot: AuthSessionSnapshot = {
      userId: 'user-1',
      email: 'alisa@example.com',
      accessTokenPresent: true,
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

  it('marks legacy calendar-oauth accounts as one-time upgrade reconnects when no server credential exists', () => {
    const snapshot: AuthSessionSnapshot = {
      userId: 'user-1',
      email: 'someone-else@example.com',
      accessTokenPresent: true,
      providerToken: 'provider-token',
      providerRefreshToken: 'provider-refresh-token',
      provider: 'google',
      expiresAt: Math.floor(Date.now() / 1000) + 3600,
    };

    const account = makeGoogleAccount({ email: 'work@example.com' });
    saveGoogleTokens(account.id, {
      accessToken: 'expired-legacy-token',
      expiresAt: Date.now() - 60_000,
      scope: 'calendar',
    });

    const state = getGoogleCalendarRuntimeCredentialState(account, { snapshot });
    expect(state.credentialSource).toBe('legacy_browser_token');
    expect(state.credentialHealth).toBe('upgrade_required');
    expect(state.message).toBe(GOOGLE_UPGRADE_REQUIRED_MESSAGE);

    const patch = getGoogleCalendarAccountPatchForCredentialState(account, state, '2026-04-15T08:00:00.000Z');
    expect(patch.authStatus).toBe('needs_reconnect');
    expect(patch.lastAuthError).toBe(GOOGLE_UPGRADE_REQUIRED_MESSAGE);
    expect(getGoogleCalendarCredentialStatusLabel({ ...account, ...patch })).toBe('Needs reconnect');
  });

  it('marks linked profile-google accounts as needing a one-time upgrade when no server credential exists yet', () => {
    const snapshot: AuthSessionSnapshot = {
      userId: 'user-1',
      email: 'alisa@example.com',
      accessTokenPresent: true,
      providerToken: 'provider-token',
      providerRefreshToken: 'provider-refresh-token',
      provider: 'google',
      expiresAt: Math.floor(Date.now() / 1000) + 3600,
    };

    const account = makeGoogleAccount();
    const state = getGoogleCalendarRuntimeCredentialState(account, { snapshot });

    expect(state.resolvedAuthProvider).toBe('profile-google');
    expect(state.credentialHealth).toBe('needs_reconnect');
    expect(state.message).toBe(GOOGLE_PROFILE_UPGRADE_REQUIRED_MESSAGE);
  });

  it('treats signed-out browser mode as sign-in required instead of connected', () => {
    const account = makeGoogleAccount({ email: 'work@example.com' });
    const state = getGoogleCalendarRuntimeCredentialState(account, { snapshot: null });

    expect(state.credentialHealth).toBe('sign_in_required');
    expect(state.message).toBe(GOOGLE_SIGN_IN_REQUIRED_MESSAGE);

    const patch = getGoogleCalendarAccountPatchForCredentialState(account, state, '2026-04-15T08:10:00.000Z');
    expect(patch.authStatus).toBe('needs_reconnect');
    expect(patch.lastAuthError).toBe(GOOGLE_SIGN_IN_REQUIRED_MESSAGE);
  });

  it('treats server-backed refreshable credentials as connected even when legacy tokens are expired', () => {
    const account = makeGoogleAccount({ email: 'work@example.com' });
    saveGoogleTokens(account.id, {
      accessToken: 'expired-legacy-token',
      expiresAt: Date.now() - 60_000,
      scope: 'calendar',
    });

    const state = getGoogleCalendarRuntimeCredentialState(account, {
      snapshot: {
        userId: 'user-1',
        email: 'someone-else@example.com',
        accessTokenPresent: true,
        providerToken: 'provider-token',
        providerRefreshToken: 'provider-refresh-token',
        provider: 'google',
        expiresAt: Math.floor(Date.now() / 1000) + 3600,
      },
      serverCredential: {
        accountEmail: 'work@example.com',
        serverCredentialPresent: true,
        credentialHealth: 'refreshable',
        currentAccessTokenExpiresAt: '2026-04-15T09:00:00.000Z',
        scope: 'https://www.googleapis.com/auth/calendar',
        lastRefreshAt: '2026-04-15T08:00:00.000Z',
        credentialOrigin: 'oauth_code',
      },
    });

    expect(state.credentialSource).toBe('server');
    expect(state.credentialHealth).toBe('refreshable');
    expect(state.currentAccessTokenExpiresAt).toBe('2026-04-15T09:00:00.000Z');

    const patch = getGoogleCalendarAccountPatchForCredentialState(account, state, '2026-04-15T08:05:00.000Z');
    expect(patch.authStatus).toBe('connected');
    expect(getGoogleCalendarStatusLabel({ ...account, ...patch })).toBe('Connected');
    expect(getGoogleCalendarCredentialStatusLabel({ ...account, ...patch })).toBe('Refreshable');
  });

  it('clears stale auth errors when the hosted Google backend is temporarily unavailable', () => {
    const account = makeGoogleAccount({
      authStatus: 'needs_reconnect',
      lastAuthError: GOOGLE_SIGN_IN_REQUIRED_MESSAGE,
    });

    const patch = getGoogleCalendarAccountPatchForCredentialState(account, {
      accountId: account.id,
      email: account.email,
      resolvedAuthProvider: 'calendar-oauth',
      credentialSource: 'legacy_browser_token',
      serverCredentialPresent: false,
      credentialHealth: 'temporary_unavailable',
      message: GOOGLE_HOSTED_SCHEMA_MISSING_MESSAGE,
    }, '2026-04-16T11:29:02.912Z');

    expect(patch.authStatus).toBe('error');
    expect(patch.lastAuthError).toBeUndefined();
    expect(patch.syncError).toBe(GOOGLE_HOSTED_SCHEMA_MISSING_MESSAGE);
  });

  it('preserves a confirmed reconnect-required state when auth status already says reconnect', () => {
    const account = makeGoogleAccount({
      email: 'work@example.com',
      authProvider: 'calendar-oauth',
      authStatus: 'needs_reconnect',
      lastAuthError: GOOGLE_RECONNECT_REQUIRED_MESSAGE,
    });

    const patch = getGoogleCalendarAuthPatch(account, null);
    expect(patch.authStatus).toBe('needs_reconnect');
    expect(patch.lastAuthError).toBe(GOOGLE_RECONNECT_REQUIRED_MESSAGE);
  });

  it('reports a wrong-account ownership mismatch before sync mutates cached data', () => {
    const account = makeGoogleAccount({ authProvider: 'calendar-oauth' });

    const ownership = getGoogleCalendarOwnershipResult(account, [
      {
        id: 'someone-else@example.com',
        summary: 'Someone Else',
        accessRole: 'owner',
        primary: true,
      },
    ]);

    expect(ownership.matches).toBe(false);
    expect(ownership.primaryEmail).toBe('someone-else@example.com');
    expect(ownership.message).toContain('someone-else@example.com');
  });
});
