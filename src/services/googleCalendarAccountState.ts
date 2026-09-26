import type {
  CalendarAccount,
  CalendarAuthProvider,
  CalendarAuthStatus,
} from '../types/domain';
import type { GoogleTokens } from './googleAuth';
import type { GoogleCalendarListEntry } from './googleCalendarApi';
import type {
  GoogleCalendarCredentialHealth,
  GoogleCalendarServerCredentialStatus,
} from './googleCalendarServerAuth';
import type { AuthSessionSnapshot } from '../store/supabase';
import { TIMING } from '../config/constants';

/**
 * Pure Google Calendar account state rules.
 *
 * Everything here takes the auth session, Supabase readiness, stored browser
 * tokens and the current time as arguments, so it can be tested without a
 * browser, a Supabase client or a network. `googleCalendarAuthManager.ts`
 * supplies those inputs and re-exports this module for existing callers.
 */

export const GOOGLE_RECONNECT_REQUIRED_MESSAGE = 'Reconnect required.';
export const GOOGLE_ACCESS_EXPIRED_MESSAGE = 'Google access expired. Reconnect this account.';
export const GOOGLE_PROFILE_RECONNECT_MESSAGE = 'Reconnect your Sabah One Google sign-in to restore Calendar access.';
export const GOOGLE_PROFILE_UPGRADE_REQUIRED_MESSAGE = 'Reconnect your Sabah One Google sign-in once to upgrade Calendar access in the browser.';
export const GOOGLE_UPGRADE_REQUIRED_MESSAGE = 'Reconnect this Google account once to upgrade it to durable browser Calendar access.';
export const GOOGLE_SIGN_IN_REQUIRED_MESSAGE = 'Sign in to Sabah One to use durable Google Calendar sync in the browser.';
export const GOOGLE_ACCESS_REVOKED_MESSAGE = 'Google access was revoked. Reconnect this account.';
export const GOOGLE_ACCOUNT_MISMATCH_MESSAGE = 'Google returned a different account. Reconnect this account explicitly.';
export const GOOGLE_TEMPORARY_UNAVAILABLE_MESSAGE = 'Google Calendar temporarily unavailable.';
export const GOOGLE_HOSTED_SCHEMA_MISSING_MESSAGE = 'Hosted Google Calendar credentials are not ready yet. Apply the Supabase migration for google_calendar_credentials, then retry reconnecting or syncing.';

export interface GoogleCalendarPassiveSyncEligibility {
  eligible: boolean;
  blockedReason?: string;
}

export interface GoogleCalendarOwnershipResult {
  matches: boolean;
  primaryEmail?: string;
  message?: string;
}

export type GoogleCalendarCredentialSource = 'server' | 'legacy_browser_token' | 'missing';
export type GoogleCalendarRuntimeCredentialHealth =
  | GoogleCalendarCredentialHealth
  | 'sign_in_required'
  | 'temporary_unavailable'
  | 'upgrade_required';

export interface GoogleCalendarRuntimeCredentialState {
  accountId: string;
  email: string;
  resolvedAuthProvider: CalendarAuthProvider;
  credentialSource: GoogleCalendarCredentialSource;
  serverCredentialPresent: boolean;
  credentialHealth: GoogleCalendarRuntimeCredentialHealth;
  message?: string;
  currentAccessTokenExpiresAt?: string;
  scope?: string;
  lastRefreshAt?: string;
  lastRefreshFailureReason?: string;
  lastRefreshFailureAt?: string;
}

export class GoogleCalendarReconnectRequiredError extends Error {
  readonly authProvider: CalendarAuthProvider;
  readonly authStatus: CalendarAuthStatus;

  constructor(message: string, authProvider: CalendarAuthProvider, authStatus: CalendarAuthStatus = 'needs_reconnect') {
    super(message);
    this.name = 'GoogleCalendarReconnectRequiredError';
    this.authProvider = authProvider;
    this.authStatus = authStatus;
  }
}

export function normalizeGoogleAccountEmail(email: string | null | undefined): string {
  return (email || '').trim().toLowerCase();
}

export function hasStoredGoogleTokens(tokens: GoogleTokens | null): boolean {
  return Boolean(tokens?.accessToken);
}

function toAuthExpiry(tokens: GoogleTokens | null): string | undefined {
  return tokens ? new Date(tokens.expiresAt).toISOString() : undefined;
}

export function getReconnectMessageForProvider(authProvider: CalendarAuthProvider): string {
  return authProvider === 'profile-google'
    ? GOOGLE_PROFILE_RECONNECT_MESSAGE
    : GOOGLE_ACCESS_EXPIRED_MESSAGE;
}

export function formatGoogleCalendarOwnershipMismatchMessage(
  expectedEmail: string,
  actualEmail?: string,
): string {
  if (actualEmail) {
    return `Google returned ${actualEmail} while syncing ${expectedEmail}. Reconnect this account explicitly.`;
  }

  return `Google could not verify ${expectedEmail} from the current Google session. Reconnect this account explicitly.`;
}

export function isGoogleCalendarAccount(account: CalendarAccount): boolean {
  return account.provider === 'google' && account.connected && !account.mocked;
}

/** Which Google credential path an account uses, given the signed-in Sabah One session. */
export function resolveGoogleAuthProvider(
  account: CalendarAccount,
  snapshot: AuthSessionSnapshot | null,
): CalendarAuthProvider {
  const profileEmail = normalizeGoogleAccountEmail(snapshot?.email);
  const accountEmail = normalizeGoogleAccountEmail(account.email);
  if (profileEmail && profileEmail === accountEmail) {
    return 'profile-google';
  }
  if (account.authProvider === 'profile-google') {
    return 'profile-google';
  }
  return account.authProvider ?? 'calendar-oauth';
}

export function getGoogleCalendarAccountActivityTime(
  account: Pick<CalendarAccount, 'lastSyncTime'>,
): number {
  return account.lastSyncTime ? new Date(account.lastSyncTime).getTime() : 0;
}

export interface PassiveSyncEligibilityInputs {
  manual?: boolean;
  supabaseReady: boolean;
  snapshot: AuthSessionSnapshot | null;
  sessionBootstrapped: boolean;
  /** Current time in epoch milliseconds. */
  now: number;
}

export function evaluateGoogleCalendarPassiveSyncEligibility(
  account: CalendarAccount,
  inputs: PassiveSyncEligibilityInputs,
): GoogleCalendarPassiveSyncEligibility {
  const manual = inputs.manual ?? false;

  if (!isGoogleCalendarAccount(account)) {
    return {
      eligible: false,
      blockedReason: 'This account is not an active Google Calendar connection.',
    };
  }

  if (!inputs.supabaseReady) {
    return {
      eligible: false,
      blockedReason: 'Supabase sign-in is required for durable Google Calendar sync in the browser.',
    };
  }

  const snapshot = inputs.snapshot;
  if (!snapshot?.userId) {
    return {
      eligible: false,
      blockedReason: GOOGLE_SIGN_IN_REQUIRED_MESSAGE,
    };
  }

  const resolvedProvider = resolveGoogleAuthProvider(account, snapshot);
  if (resolvedProvider === 'profile-google' && !inputs.sessionBootstrapped) {
    return {
      eligible: false,
      blockedReason: 'Waiting for Sabah One Google sign-in status to finish loading.',
    };
  }

  if (account.authStatus === 'revoked') {
    return {
      eligible: false,
      blockedReason: 'Google revoked access for this account. Reconnect it before syncing again.',
    };
  }

  if (!manual && account.authStatus === 'needs_reconnect') {
    return {
      eligible: false,
      blockedReason: 'Auto sync is paused until this account is rechecked or reconnected.',
    };
  }

  const activityTime = getGoogleCalendarAccountActivityTime(account);
  if (!manual && activityTime >= inputs.now - TIMING.SYNC_THROTTLE) {
    return {
      eligible: false,
      blockedReason: 'Auto sync is waiting for the next passive check window.',
    };
  }

  return {
    eligible: true,
    blockedReason: manual
      ? 'Ready for a manual passive auth check.'
      : 'Ready for passive background sync.',
  };
}

/**
 * Proves the calendars Google returned belong to the account being synced.
 * A mismatch means the token is for a different Google identity, so none of
 * its data may be written into this account.
 */
export function getGoogleCalendarOwnershipResult(
  account: CalendarAccount,
  calendars: readonly GoogleCalendarListEntry[],
): GoogleCalendarOwnershipResult {
  const expectedEmail = normalizeGoogleAccountEmail(account.email);
  const primaryCalendar = calendars.find(calendar => calendar.primary)
    ?? calendars.find(calendar => normalizeGoogleAccountEmail(calendar.id) === expectedEmail);
  const primaryEmail = normalizeGoogleAccountEmail(primaryCalendar?.id);

  if (primaryEmail && primaryEmail === expectedEmail) {
    return {
      matches: true,
      primaryEmail,
    };
  }

  return {
    matches: false,
    primaryEmail: primaryEmail || undefined,
    message: formatGoogleCalendarOwnershipMismatchMessage(account.email, primaryEmail || undefined),
  };
}

export function buildGoogleCalendarAuthPatch(
  account: CalendarAccount,
  snapshot: AuthSessionSnapshot | null,
): Partial<CalendarAccount> {
  if (!isGoogleCalendarAccount(account)) {
    return {};
  }

  const authProvider = resolveGoogleAuthProvider(account, snapshot);
  const authStatus = account.authStatus ?? 'connected';
  let lastAuthError = account.lastAuthError;
  let syncError = account.syncError;

  if (authStatus === 'connected') {
    lastAuthError = undefined;
    syncError = undefined;
  } else if (authStatus === 'needs_reconnect' && !lastAuthError) {
    lastAuthError = authProvider === 'profile-google'
      ? GOOGLE_PROFILE_RECONNECT_MESSAGE
      : GOOGLE_RECONNECT_REQUIRED_MESSAGE;
    syncError = undefined;
  } else if (authStatus === 'revoked' && !lastAuthError) {
    lastAuthError = GOOGLE_ACCESS_REVOKED_MESSAGE;
    syncError = undefined;
  }

  return {
    authProvider,
    authStatus,
    authEmail: account.email,
    authExpiresAt: account.authExpiresAt,
    lastAuthError,
    lastAuthCheckAt: account.lastAuthCheckAt,
    syncError,
  };
}

export interface RuntimeCredentialInputs {
  serverCredential?: GoogleCalendarServerCredentialStatus;
  snapshot: AuthSessionSnapshot | null;
  supabaseReady: boolean;
  /** Legacy per-account browser tokens, if any are still stored on this device. */
  legacyTokens: GoogleTokens | null;
}

export function deriveGoogleCalendarRuntimeCredentialState(
  account: CalendarAccount,
  inputs: RuntimeCredentialInputs,
): GoogleCalendarRuntimeCredentialState {
  const { snapshot, legacyTokens, serverCredential } = inputs;
  const resolvedAuthProvider = resolveGoogleAuthProvider(account, snapshot);
  const legacyTokenPresent = hasStoredGoogleTokens(legacyTokens);

  if (serverCredential?.serverCredentialPresent) {
    const message = (() => {
      switch (serverCredential.credentialHealth) {
        case 'needs_reconnect':
          return resolvedAuthProvider === 'profile-google'
            ? GOOGLE_PROFILE_RECONNECT_MESSAGE
            : GOOGLE_ACCESS_EXPIRED_MESSAGE;
        case 'revoked':
          return GOOGLE_ACCESS_REVOKED_MESSAGE;
        default:
          return undefined;
      }
    })();

    return {
      accountId: account.id,
      email: account.email,
      resolvedAuthProvider,
      credentialSource: 'server',
      serverCredentialPresent: true,
      credentialHealth: serverCredential.credentialHealth,
      message,
      currentAccessTokenExpiresAt: serverCredential.currentAccessTokenExpiresAt,
      scope: serverCredential.scope,
      lastRefreshAt: serverCredential.lastRefreshAt,
      lastRefreshFailureReason: serverCredential.lastRefreshFailureReason,
      lastRefreshFailureAt: serverCredential.lastRefreshFailureAt,
    };
  }

  if (!inputs.supabaseReady || !snapshot?.userId) {
    return {
      accountId: account.id,
      email: account.email,
      resolvedAuthProvider,
      credentialSource: legacyTokenPresent ? 'legacy_browser_token' : 'missing',
      serverCredentialPresent: false,
      credentialHealth: 'sign_in_required',
      message: GOOGLE_SIGN_IN_REQUIRED_MESSAGE,
      currentAccessTokenExpiresAt: toAuthExpiry(legacyTokens) ?? account.authExpiresAt,
      scope: legacyTokens?.scope,
    };
  }

  if (resolvedAuthProvider === 'profile-google') {
    return {
      accountId: account.id,
      email: account.email,
      resolvedAuthProvider,
      credentialSource: legacyTokenPresent ? 'legacy_browser_token' : 'missing',
      serverCredentialPresent: false,
      credentialHealth: 'needs_reconnect',
      message: GOOGLE_PROFILE_UPGRADE_REQUIRED_MESSAGE,
      currentAccessTokenExpiresAt: toAuthExpiry(legacyTokens) ?? account.authExpiresAt,
      scope: legacyTokens?.scope,
    };
  }

  if (legacyTokenPresent) {
    return {
      accountId: account.id,
      email: account.email,
      resolvedAuthProvider,
      credentialSource: 'legacy_browser_token',
      serverCredentialPresent: false,
      credentialHealth: 'upgrade_required',
      message: GOOGLE_UPGRADE_REQUIRED_MESSAGE,
      currentAccessTokenExpiresAt: toAuthExpiry(legacyTokens) ?? account.authExpiresAt,
      scope: legacyTokens?.scope,
    };
  }

  return {
    accountId: account.id,
    email: account.email,
    resolvedAuthProvider,
    credentialSource: 'missing',
    serverCredentialPresent: false,
    credentialHealth: 'needs_reconnect',
    message: GOOGLE_RECONNECT_REQUIRED_MESSAGE,
    currentAccessTokenExpiresAt: account.authExpiresAt,
  };
}

export function getGoogleCalendarAccountPatchForCredentialState(
  account: CalendarAccount,
  credentialState: GoogleCalendarRuntimeCredentialState,
  checkedAt: string,
): Partial<CalendarAccount> {
  const base = {
    authProvider: credentialState.resolvedAuthProvider,
    authEmail: account.email,
    authExpiresAt: credentialState.currentAccessTokenExpiresAt,
    lastAuthCheckAt: checkedAt,
  } satisfies Partial<CalendarAccount>;

  switch (credentialState.credentialHealth) {
    case 'refreshable':
      return {
        ...base,
        authStatus: 'connected',
        lastAuthError: undefined,
        syncError: undefined,
      };
    case 'revoked':
      return {
        ...base,
        authStatus: 'revoked',
        lastAuthError: credentialState.message || GOOGLE_ACCESS_REVOKED_MESSAGE,
        syncError: undefined,
      };
    case 'temporary_unavailable':
      return {
        ...base,
        authStatus: 'error',
        lastAuthError: undefined,
        syncError: credentialState.message || GOOGLE_TEMPORARY_UNAVAILABLE_MESSAGE,
      };
    case 'needs_reconnect':
    case 'sign_in_required':
    case 'upgrade_required':
    default:
      return {
        ...base,
        authStatus: 'needs_reconnect',
        lastAuthError: credentialState.message || getReconnectMessageForProvider(credentialState.resolvedAuthProvider),
        syncError: undefined,
      };
  }
}

export function getGoogleCalendarCredentialStatusLabel(account: CalendarAccount): string {
  switch (account.authStatus) {
    case 'connected':
      return 'Refreshable';
    case 'needs_reconnect':
      return 'Needs reconnect';
    case 'revoked':
      return 'Revoked';
    case 'error':
      return 'Unavailable';
    default:
      return account.connected ? 'Refreshable' : 'Disconnected';
  }
}

export function getGoogleCalendarStatusLabel(account: CalendarAccount): string {
  if (!isGoogleCalendarAccount(account)) {
    return account.connected ? 'Connected' : 'Local';
  }

  switch (account.authStatus) {
    case 'connected':
      return 'Connected';
    case 'needs_reconnect':
      return 'Needs reconnect';
    case 'revoked':
      return 'Revoked';
    case 'error':
      return 'Temporarily unavailable';
    default:
      return account.connected ? 'Connected' : 'Disconnected';
  }
}
