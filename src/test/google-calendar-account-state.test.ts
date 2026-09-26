import { describe, expect, it } from 'vitest';
import type { AuthSessionSnapshot } from '../store/supabase';
import {
  GOOGLE_ACCESS_REVOKED_MESSAGE,
  GOOGLE_PROFILE_UPGRADE_REQUIRED_MESSAGE,
  GOOGLE_RECONNECT_REQUIRED_MESSAGE,
  GOOGLE_SIGN_IN_REQUIRED_MESSAGE,
  GOOGLE_UPGRADE_REQUIRED_MESSAGE,
  deriveGoogleCalendarRuntimeCredentialState,
  evaluateGoogleCalendarPassiveSyncEligibility,
  getGoogleCalendarAccountPatchForCredentialState,
  getGoogleCalendarOwnershipResult,
  resolveGoogleAuthProvider,
} from '../services/googleCalendarAccountState';
import { TIMING } from '../config/constants';
import { makeCalendarAccount } from './fixtures';

const NOW = Date.parse('2026-09-26T12:00:00.000Z');

const googleAccount = makeCalendarAccount({
  id: 'account-work',
  email: 'work@example.test',
  provider: 'google',
  connected: true,
  mocked: false,
  authProvider: 'calendar-oauth',
});

function session(overrides: Partial<AuthSessionSnapshot> = {}): AuthSessionSnapshot {
  return {
    userId: 'user-1',
    email: 'me@example.test',
    accessTokenPresent: true,
    providerToken: null,
    providerRefreshToken: null,
    provider: 'google',
    expiresAt: null,
    ...overrides,
  };
}

describe('Google account ownership', () => {
  it('accepts calendars whose primary calendar is the account email, ignoring case', () => {
    const result = getGoogleCalendarOwnershipResult(googleAccount, [
      { id: 'Work@Example.test', summary: 'Work', accessRole: 'owner', primary: true },
    ]);

    expect(result).toEqual({ matches: true, primaryEmail: 'work@example.test' });
  });

  it('rejects calendars that belong to a different Google identity', () => {
    const result = getGoogleCalendarOwnershipResult(googleAccount, [
      { id: 'someone-else@example.test', summary: 'Other', accessRole: 'owner', primary: true },
    ]);

    expect(result.matches).toBe(false);
    expect(result.primaryEmail).toBe('someone-else@example.test');
    expect(result.message).toContain('Google returned someone-else@example.test while syncing work@example.test');
  });

  it('rejects a calendar list with no verifiable primary calendar', () => {
    const result = getGoogleCalendarOwnershipResult(googleAccount, [
      { id: 'team@group.calendar.google.com', summary: 'Team', accessRole: 'reader' },
    ]);

    expect(result.matches).toBe(false);
    expect(result.message).toContain('could not verify work@example.test');
  });
});

describe('Google auth provider resolution', () => {
  it('treats the signed-in profile email as the profile Google credential', () => {
    expect(resolveGoogleAuthProvider(googleAccount, session({ email: 'WORK@example.test' }))).toBe('profile-google');
  });

  it('keeps the calendar OAuth provider for other accounts', () => {
    expect(resolveGoogleAuthProvider(googleAccount, session())).toBe('calendar-oauth');
    expect(resolveGoogleAuthProvider({ ...googleAccount, authProvider: undefined }, null)).toBe('calendar-oauth');
  });
});

describe('Passive sync eligibility', () => {
  const ready = { supabaseReady: true, snapshot: session(), sessionBootstrapped: true, now: NOW };

  it('allows an idle connected account', () => {
    expect(evaluateGoogleCalendarPassiveSyncEligibility(googleAccount, ready).eligible).toBe(true);
  });

  it('blocks when signed out or Supabase is unavailable', () => {
    expect(evaluateGoogleCalendarPassiveSyncEligibility(googleAccount, { ...ready, snapshot: null })).toEqual({
      eligible: false,
      blockedReason: GOOGLE_SIGN_IN_REQUIRED_MESSAGE,
    });
    expect(evaluateGoogleCalendarPassiveSyncEligibility(googleAccount, { ...ready, supabaseReady: false }).eligible).toBe(false);
  });

  it('waits for the profile session to finish loading', () => {
    const result = evaluateGoogleCalendarPassiveSyncEligibility(
      googleAccount,
      { ...ready, snapshot: session({ email: 'work@example.test' }), sessionBootstrapped: false },
    );

    expect(result.eligible).toBe(false);
  });

  it('pauses auto sync after a reconnect request but allows a manual check', () => {
    const account = { ...googleAccount, authStatus: 'needs_reconnect' as const };

    expect(evaluateGoogleCalendarPassiveSyncEligibility(account, ready).eligible).toBe(false);
    expect(evaluateGoogleCalendarPassiveSyncEligibility(account, { ...ready, manual: true }).eligible).toBe(true);
  });

  it('never syncs a revoked account, even manually', () => {
    const account = { ...googleAccount, authStatus: 'revoked' as const };

    expect(evaluateGoogleCalendarPassiveSyncEligibility(account, { ...ready, manual: true }).eligible).toBe(false);
  });

  it('throttles auto sync inside the passive window and releases it at the boundary', () => {
    const justSynced = { ...googleAccount, lastSyncTime: new Date(NOW - TIMING.SYNC_THROTTLE + 1).toISOString() };
    const due = { ...googleAccount, lastSyncTime: new Date(NOW - TIMING.SYNC_THROTTLE - 1).toISOString() };

    expect(evaluateGoogleCalendarPassiveSyncEligibility(justSynced, ready).eligible).toBe(false);
    expect(evaluateGoogleCalendarPassiveSyncEligibility(justSynced, { ...ready, manual: true }).eligible).toBe(true);
    expect(evaluateGoogleCalendarPassiveSyncEligibility(due, ready).eligible).toBe(true);
  });
});

describe('Runtime credential state', () => {
  const inputs = { snapshot: session(), supabaseReady: true, legacyTokens: null };

  it('uses the hosted credential health when the server has one', () => {
    const state = deriveGoogleCalendarRuntimeCredentialState(googleAccount, {
      ...inputs,
      serverCredential: {
        accountEmail: 'work@example.test',
        serverCredentialPresent: true,
        credentialHealth: 'revoked',
      },
    });

    expect(state).toMatchObject({ credentialSource: 'server', credentialHealth: 'revoked', message: GOOGLE_ACCESS_REVOKED_MESSAGE });
  });

  it('asks a signed-out browser to sign in', () => {
    const state = deriveGoogleCalendarRuntimeCredentialState(googleAccount, { ...inputs, snapshot: null });

    expect(state).toMatchObject({ credentialHealth: 'sign_in_required', message: GOOGLE_SIGN_IN_REQUIRED_MESSAGE });
  });

  it('asks legacy browser-token accounts to upgrade once', () => {
    const state = deriveGoogleCalendarRuntimeCredentialState(googleAccount, {
      ...inputs,
      legacyTokens: { accessToken: 'legacy', expiresAt: NOW, scope: 'calendar' },
    });

    expect(state).toMatchObject({
      credentialSource: 'legacy_browser_token',
      credentialHealth: 'upgrade_required',
      message: GOOGLE_UPGRADE_REQUIRED_MESSAGE,
      currentAccessTokenExpiresAt: new Date(NOW).toISOString(),
    });
  });

  it('asks the profile account to upgrade and other accounts to reconnect when no credential exists', () => {
    const profile = deriveGoogleCalendarRuntimeCredentialState(googleAccount, {
      ...inputs,
      snapshot: session({ email: 'work@example.test' }),
    });
    const other = deriveGoogleCalendarRuntimeCredentialState(googleAccount, inputs);

    expect(profile).toMatchObject({ credentialHealth: 'needs_reconnect', message: GOOGLE_PROFILE_UPGRADE_REQUIRED_MESSAGE });
    expect(other).toMatchObject({ credentialHealth: 'needs_reconnect', message: GOOGLE_RECONNECT_REQUIRED_MESSAGE });
  });

  it('maps a temporary outage to an account error without a reconnect prompt', () => {
    const state = deriveGoogleCalendarRuntimeCredentialState(googleAccount, inputs);
    const patch = getGoogleCalendarAccountPatchForCredentialState(
      googleAccount,
      { ...state, credentialHealth: 'temporary_unavailable', message: 'Hosted status timed out.' },
      '2026-09-26T12:00:00.000Z',
    );

    expect(patch).toMatchObject({ authStatus: 'error', lastAuthError: undefined, syncError: 'Hosted status timed out.' });
  });
});
