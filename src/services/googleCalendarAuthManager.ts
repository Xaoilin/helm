import type {
  CalendarAccount,
  CalendarAuthProvider,
  CalendarAuthStatus,
} from '../types/domain';
import {
  clearGoogleTokens,
  loadGisScript,
  loadGoogleTokens,
  requestGoogleAuthorizationCode,
  type GoogleTokens,
} from './googleAuth';
import { appendGoogleCalendarDiagnosticEvent } from './googleCalendarDiagnosticEvents';
import type { GoogleCalendarListEntry } from './googleCalendarApi';
import {
  bootstrapGoogleCalendarProfileCredential,
  exchangeGoogleCalendarAuthorizationCode,
  GoogleCalendarOAuthFunctionError,
  type GoogleCalendarCredentialHealth,
  type GoogleCalendarServerConnectedAccount,
  type GoogleCalendarServerCredentialStatus,
  mintGoogleCalendarAccessToken,
} from './googleCalendarServerAuth';
import {
  getAuthSessionSnapshot,
  isAuthSessionBootstrapped,
  isSupabaseReady,
  signInWithGoogle,
  type AuthSessionSnapshot,
} from '../store/supabase';
import { TIMING } from '../config/constants';

export const GOOGLE_RECONNECT_REQUIRED_MESSAGE = 'Reconnect required.';
export const GOOGLE_ACCESS_EXPIRED_MESSAGE = 'Google access expired. Reconnect this account.';
export const GOOGLE_PROFILE_RECONNECT_MESSAGE = 'Reconnect your HELM Google sign-in to restore Calendar access.';
export const GOOGLE_PROFILE_UPGRADE_REQUIRED_MESSAGE = 'Reconnect your HELM Google sign-in once to upgrade Calendar access in the browser.';
export const GOOGLE_UPGRADE_REQUIRED_MESSAGE = 'Reconnect this Google account once to upgrade it to durable browser Calendar access.';
export const GOOGLE_SIGN_IN_REQUIRED_MESSAGE = 'Sign in to HELM to use durable Google Calendar sync in the browser.';
export const GOOGLE_ACCESS_REVOKED_MESSAGE = 'Google access was revoked. Reconnect this account.';
export const GOOGLE_ACCOUNT_MISMATCH_MESSAGE = 'Google returned a different account. Reconnect this account explicitly.';
export const GOOGLE_TEMPORARY_UNAVAILABLE_MESSAGE = 'Google Calendar temporarily unavailable.';
export const GOOGLE_HOSTED_SCHEMA_MISSING_MESSAGE = 'Hosted Google Calendar credentials are not ready yet. Apply the Supabase migration for google_calendar_credentials, then retry reconnecting or syncing.';

export interface GoogleCalendarConnectionResult {
  email: string;
  accountName: string;
  calendars: GoogleCalendarListEntry[];
  authProvider: CalendarAuthProvider;
  authExpiresAt?: string;
}

interface PassiveTokenResult {
  accessToken: string;
  authProvider: CalendarAuthProvider;
  authExpiresAt?: string;
}

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

function normalizeEmail(email: string | null | undefined): string {
  return (email || '').trim().toLowerCase();
}

function toAuthExpiry(tokens: GoogleTokens | null): string | undefined {
  return tokens ? new Date(tokens.expiresAt).toISOString() : undefined;
}

function hasStoredGoogleTokens(tokens: GoogleTokens | null): boolean {
  return Boolean(tokens?.accessToken);
}

function createConnectionResult(
  result: GoogleCalendarServerConnectedAccount,
  authProvider: CalendarAuthProvider,
): GoogleCalendarConnectionResult {
  return {
    email: result.credential.accountEmail,
    accountName: result.accountName,
    calendars: result.calendars,
    authProvider,
    authExpiresAt: result.credential.currentAccessTokenExpiresAt,
  };
}

function getReconnectMessageForProvider(authProvider: CalendarAuthProvider): string {
  return authProvider === 'profile-google'
    ? GOOGLE_PROFILE_RECONNECT_MESSAGE
    : GOOGLE_ACCESS_EXPIRED_MESSAGE;
}

function mapGoogleCalendarOAuthError(
  account: CalendarAccount,
  authProvider: CalendarAuthProvider,
  error: GoogleCalendarOAuthFunctionError,
): GoogleCalendarReconnectRequiredError | Error {
  switch (error.code) {
    case 'revoked':
      return new GoogleCalendarReconnectRequiredError(
        GOOGLE_ACCESS_REVOKED_MESSAGE,
        authProvider,
        'revoked',
      );
    case 'missing_credential':
      return new GoogleCalendarReconnectRequiredError(
        authProvider === 'profile-google'
          ? GOOGLE_PROFILE_UPGRADE_REQUIRED_MESSAGE
          : hasStoredGoogleTokens(loadGoogleTokens(account.id))
            ? GOOGLE_UPGRADE_REQUIRED_MESSAGE
            : GOOGLE_RECONNECT_REQUIRED_MESSAGE,
        authProvider,
      );
    case 'missing_refresh_token':
      return new GoogleCalendarReconnectRequiredError(
        authProvider === 'profile-google'
          ? GOOGLE_PROFILE_UPGRADE_REQUIRED_MESSAGE
          : GOOGLE_UPGRADE_REQUIRED_MESSAGE,
        authProvider,
      );
    case 'needs_reconnect':
      return new GoogleCalendarReconnectRequiredError(
        getReconnectMessageForProvider(authProvider),
        authProvider,
      );
    case 'sign_in_required':
      return new GoogleCalendarReconnectRequiredError(
        authProvider === 'profile-google'
          ? GOOGLE_PROFILE_RECONNECT_MESSAGE
          : GOOGLE_SIGN_IN_REQUIRED_MESSAGE,
        authProvider,
      );
    case 'account_mismatch':
      return new GoogleCalendarReconnectRequiredError(
        error.message || GOOGLE_ACCOUNT_MISMATCH_MESSAGE,
        authProvider,
      );
    case 'oauth_not_configured':
      return new Error(error.message);
    default:
      return new Error(error.message || GOOGLE_TEMPORARY_UNAVAILABLE_MESSAGE);
  }
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

export function getResolvedGoogleAuthProvider(
  account: CalendarAccount,
  snapshot: AuthSessionSnapshot | null = getAuthSessionSnapshot(),
): CalendarAuthProvider {
  const profileEmail = normalizeEmail(snapshot?.email);
  const accountEmail = normalizeEmail(account.email);
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

export function getGoogleCalendarPassiveSyncEligibility(
  account: CalendarAccount,
  options: { manual?: boolean } = {},
): GoogleCalendarPassiveSyncEligibility {
  const manual = options.manual ?? false;

  if (!isGoogleCalendarAccount(account)) {
    return {
      eligible: false,
      blockedReason: 'This account is not an active Google Calendar connection.',
    };
  }

  if (!isSupabaseReady()) {
    return {
      eligible: false,
      blockedReason: 'Supabase sign-in is required for durable Google Calendar sync in the browser.',
    };
  }

  const snapshot = getAuthSessionSnapshot();
  if (!snapshot?.userId) {
    return {
      eligible: false,
      blockedReason: GOOGLE_SIGN_IN_REQUIRED_MESSAGE,
    };
  }

  const resolvedProvider = getResolvedGoogleAuthProvider(account, snapshot);
  if (resolvedProvider === 'profile-google' && !isAuthSessionBootstrapped()) {
    return {
      eligible: false,
      blockedReason: 'Waiting for HELM Google sign-in status to finish loading.',
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
  if (!manual && activityTime >= Date.now() - TIMING.SYNC_THROTTLE) {
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

export function getGoogleCalendarOwnershipResult(
  account: CalendarAccount,
  calendars: readonly GoogleCalendarListEntry[],
): GoogleCalendarOwnershipResult {
  const expectedEmail = normalizeEmail(account.email);
  const primaryCalendar = calendars.find(calendar => calendar.primary)
    ?? calendars.find(calendar => normalizeEmail(calendar.id) === expectedEmail);
  const primaryEmail = normalizeEmail(primaryCalendar?.id);

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

export function getGoogleCalendarAuthPatch(
  account: CalendarAccount,
  snapshot: AuthSessionSnapshot | null = getAuthSessionSnapshot(),
): Partial<CalendarAccount> {
  if (!isGoogleCalendarAccount(account)) {
    return {};
  }

  const authProvider = getResolvedGoogleAuthProvider(account, snapshot);
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

export function getGoogleCalendarRuntimeCredentialState(
  account: CalendarAccount,
  options: {
    serverCredential?: GoogleCalendarServerCredentialStatus;
    snapshot?: AuthSessionSnapshot | null;
  } = {},
): GoogleCalendarRuntimeCredentialState {
  const snapshot = options.snapshot ?? getAuthSessionSnapshot();
  const resolvedAuthProvider = getResolvedGoogleAuthProvider(account, snapshot);
  const legacyTokens = loadGoogleTokens(account.id);
  const legacyTokenPresent = hasStoredGoogleTokens(legacyTokens);
  const serverCredential = options.serverCredential;

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

  if (!isSupabaseReady() || !snapshot?.userId) {
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

async function tryBootstrapProfileGoogleCredential(
  account: CalendarAccount,
  snapshot: AuthSessionSnapshot | null = getAuthSessionSnapshot(),
): Promise<void> {
  if (!snapshot?.email || normalizeEmail(snapshot.email) !== normalizeEmail(account.email)) {
    throw new GoogleCalendarReconnectRequiredError(
      GOOGLE_PROFILE_RECONNECT_MESSAGE,
      'profile-google',
    );
  }

  if (snapshot.provider !== 'google') {
    throw new GoogleCalendarReconnectRequiredError(
      GOOGLE_PROFILE_RECONNECT_MESSAGE,
      'profile-google',
    );
  }

  appendGoogleCalendarDiagnosticEvent({
    operation: 'profile_bootstrap',
    phase: 'start',
    outcome: 'info',
    triggerSource: 'system',
    accountId: account.id,
    email: account.email,
    resolvedAuthProvider: 'profile-google',
    message: 'Attempting to bootstrap a hosted Google Calendar credential from the signed-in HELM session.',
  });
  await bootstrapGoogleCalendarProfileCredential({
    email: snapshot.email,
    providerRefreshToken: snapshot.providerRefreshToken,
  });
  appendGoogleCalendarDiagnosticEvent({
    operation: 'profile_bootstrap',
    phase: 'success',
    outcome: 'success',
    triggerSource: 'system',
    accountId: account.id,
    email: account.email,
    resolvedAuthProvider: 'profile-google',
    message: 'Bootstrapped a hosted Google Calendar credential from the signed-in HELM session.',
  });
}

export async function getGoogleCalendarPassiveAccessTokenWithRefresh(
  account: CalendarAccount,
  clientId: string,
): Promise<PassiveTokenResult> {
  void clientId;
  const snapshot = getAuthSessionSnapshot();
  const authProvider = getResolvedGoogleAuthProvider(account, snapshot);

  try {
    const minted = await mintGoogleCalendarAccessToken(account.email);
    appendGoogleCalendarDiagnosticEvent({
      operation: 'access_token_mint',
      phase: 'success',
      outcome: 'success',
      triggerSource: 'system',
      accountId: account.id,
      email: account.email,
      resolvedAuthProvider: authProvider,
      credentialSource: 'server',
      message: 'Minted a hosted Google Calendar access token for passive sync.',
    });
    return {
      accessToken: minted.accessToken,
      authProvider,
      authExpiresAt: minted.credential.currentAccessTokenExpiresAt,
    };
  } catch (error) {
    if (
      error instanceof GoogleCalendarOAuthFunctionError
      && error.code === 'missing_credential'
      && authProvider === 'profile-google'
    ) {
      try {
        await tryBootstrapProfileGoogleCredential(account, snapshot);
        const minted = await mintGoogleCalendarAccessToken(account.email);
        appendGoogleCalendarDiagnosticEvent({
          operation: 'access_token_mint',
          phase: 'success',
          outcome: 'success',
          triggerSource: 'system',
          accountId: account.id,
          email: account.email,
          resolvedAuthProvider: authProvider,
          credentialSource: 'server',
          message: 'Minted a hosted Google Calendar access token after bootstrapping the profile credential.',
        });
        return {
          accessToken: minted.accessToken,
          authProvider,
          authExpiresAt: minted.credential.currentAccessTokenExpiresAt,
        };
      } catch (bootstrapError) {
        appendGoogleCalendarDiagnosticEvent({
          operation: 'profile_bootstrap',
          phase: 'failure',
          outcome: bootstrapError instanceof GoogleCalendarOAuthFunctionError && bootstrapError.code === 'needs_reconnect'
            ? 'needs_reconnect'
            : 'failure',
          triggerSource: 'system',
          accountId: account.id,
          email: account.email,
          resolvedAuthProvider: authProvider,
          message: bootstrapError instanceof Error ? bootstrapError.message : GOOGLE_TEMPORARY_UNAVAILABLE_MESSAGE,
          code: bootstrapError instanceof GoogleCalendarOAuthFunctionError ? bootstrapError.code : undefined,
          requestId: bootstrapError instanceof GoogleCalendarOAuthFunctionError ? bootstrapError.requestId : undefined,
          readiness: bootstrapError instanceof GoogleCalendarOAuthFunctionError ? bootstrapError.readiness : undefined,
          httpStatus: bootstrapError instanceof GoogleCalendarOAuthFunctionError ? bootstrapError.httpStatus : undefined,
        });
        if (bootstrapError instanceof GoogleCalendarOAuthFunctionError) {
          throw mapGoogleCalendarOAuthError(account, authProvider, bootstrapError);
        }
        throw bootstrapError;
      }
    }

    if (error instanceof GoogleCalendarOAuthFunctionError) {
      appendGoogleCalendarDiagnosticEvent({
        operation: 'access_token_mint',
        phase: 'failure',
        outcome: error.code === 'revoked'
          ? 'revoked'
          : error.code === 'needs_reconnect' || error.code === 'missing_credential' || error.code === 'missing_refresh_token'
            ? 'needs_reconnect'
            : error.code === 'temporary_unavailable'
              ? 'temporary_unavailable'
              : 'failure',
        triggerSource: 'system',
        accountId: account.id,
        email: account.email,
        resolvedAuthProvider: authProvider,
        message: error.message,
        code: error.code,
        requestId: error.requestId,
        readiness: error.readiness,
        httpStatus: error.httpStatus,
      });
      throw mapGoogleCalendarOAuthError(account, authProvider, error);
    }

    appendGoogleCalendarDiagnosticEvent({
      operation: 'access_token_mint',
      phase: 'failure',
      outcome: 'temporary_unavailable',
      triggerSource: 'system',
      accountId: account.id,
      email: account.email,
      resolvedAuthProvider: authProvider,
      message: error instanceof Error ? error.message : GOOGLE_TEMPORARY_UNAVAILABLE_MESSAGE,
    });
    throw error;
  }
}

export async function connectGoogleCalendarOAuthAccount(clientId: string): Promise<GoogleCalendarConnectionResult> {
  if (!isSupabaseReady() || !getAuthSessionSnapshot()?.userId) {
    throw new Error(GOOGLE_SIGN_IN_REQUIRED_MESSAGE);
  }

  appendGoogleCalendarDiagnosticEvent({
    operation: 'connect',
    phase: 'start',
    outcome: 'info',
    triggerSource: 'user_action',
    message: 'Starting a new Google Calendar account connection.',
  });

  try {
    await loadGisScript();
    const result = await requestGoogleAuthorizationCode(clientId.trim(), {
      selectAccount: true,
    });
    const connected = await exchangeGoogleCalendarAuthorizationCode({
      code: result.code,
      redirectUri: window.location.origin,
    });

    appendGoogleCalendarDiagnosticEvent({
      operation: 'connect',
      phase: 'success',
      outcome: 'success',
      triggerSource: 'user_action',
      email: connected.credential.accountEmail,
      resolvedAuthProvider: 'calendar-oauth',
      message: `Connected Google Calendar account ${connected.credential.accountEmail}.`,
    });

    return createConnectionResult(connected, 'calendar-oauth');
  } catch (error) {
    appendGoogleCalendarDiagnosticEvent({
      operation: 'connect',
      phase: 'failure',
      outcome: error instanceof GoogleCalendarOAuthFunctionError && error.code === 'needs_reconnect'
        ? 'needs_reconnect'
        : 'failure',
      triggerSource: 'user_action',
      message: error instanceof Error ? error.message : GOOGLE_TEMPORARY_UNAVAILABLE_MESSAGE,
      code: error instanceof GoogleCalendarOAuthFunctionError ? error.code : undefined,
      requestId: error instanceof GoogleCalendarOAuthFunctionError ? error.requestId : undefined,
      readiness: error instanceof GoogleCalendarOAuthFunctionError ? error.readiness : undefined,
      httpStatus: error instanceof GoogleCalendarOAuthFunctionError ? error.httpStatus : undefined,
    });
    throw error;
  }
}

export async function reconnectGoogleCalendarOAuthAccount(
  account: CalendarAccount,
  clientId: string,
): Promise<GoogleCalendarConnectionResult> {
  if (!isSupabaseReady() || !getAuthSessionSnapshot()?.userId) {
    throw new Error(GOOGLE_SIGN_IN_REQUIRED_MESSAGE);
  }

  appendGoogleCalendarDiagnosticEvent({
    operation: 'reconnect',
    phase: 'start',
    outcome: 'info',
    triggerSource: 'user_action',
    accountId: account.id,
    email: account.email,
    resolvedAuthProvider: 'calendar-oauth',
    message: `Starting an explicit Google Calendar reconnect for ${account.email}.`,
  });

  try {
    await loadGisScript();
    const result = await requestGoogleAuthorizationCode(clientId.trim(), {
      loginHint: account.email,
      selectAccount: true,
    });
    const connected = await exchangeGoogleCalendarAuthorizationCode({
      code: result.code,
      redirectUri: window.location.origin,
      expectedEmail: account.email,
    });

    clearGoogleTokens(account.id);
    appendGoogleCalendarDiagnosticEvent({
      operation: 'reconnect',
      phase: 'success',
      outcome: 'success',
      triggerSource: 'user_action',
      accountId: account.id,
      email: account.email,
      resolvedAuthProvider: 'calendar-oauth',
      message: `Reconnected Google Calendar account ${account.email}.`,
    });
    return createConnectionResult(connected, 'calendar-oauth');
  } catch (error) {
    appendGoogleCalendarDiagnosticEvent({
      operation: 'reconnect',
      phase: 'failure',
      outcome: error instanceof GoogleCalendarOAuthFunctionError && error.code === 'needs_reconnect'
        ? 'needs_reconnect'
        : 'failure',
      triggerSource: 'user_action',
      accountId: account.id,
      email: account.email,
      resolvedAuthProvider: 'calendar-oauth',
      message: error instanceof Error ? error.message : GOOGLE_TEMPORARY_UNAVAILABLE_MESSAGE,
      code: error instanceof GoogleCalendarOAuthFunctionError ? error.code : undefined,
      requestId: error instanceof GoogleCalendarOAuthFunctionError ? error.requestId : undefined,
      readiness: error instanceof GoogleCalendarOAuthFunctionError ? error.readiness : undefined,
      httpStatus: error instanceof GoogleCalendarOAuthFunctionError ? error.httpStatus : undefined,
    });
    throw error;
  }
}

export async function connectProfileGoogleCalendar(): Promise<GoogleCalendarConnectionResult> {
  const snapshot = getAuthSessionSnapshot();
  if (!snapshot?.email || snapshot.provider !== 'google') {
    throw new GoogleCalendarReconnectRequiredError(GOOGLE_PROFILE_RECONNECT_MESSAGE, 'profile-google');
  }

  try {
    const connected = await bootstrapGoogleCalendarProfileCredential({
      email: snapshot.email,
      providerRefreshToken: snapshot.providerRefreshToken,
    });
    appendGoogleCalendarDiagnosticEvent({
      operation: 'connect',
      phase: 'success',
      outcome: 'success',
      triggerSource: 'user_action',
      email: snapshot.email,
      resolvedAuthProvider: 'profile-google',
      message: `Linked the signed-in HELM Google account ${snapshot.email} to Google Calendar.`,
    });
    return createConnectionResult(connected, 'profile-google');
  } catch (error) {
    appendGoogleCalendarDiagnosticEvent({
      operation: 'connect',
      phase: 'failure',
      outcome: error instanceof GoogleCalendarOAuthFunctionError && error.code === 'needs_reconnect'
        ? 'needs_reconnect'
        : 'failure',
      triggerSource: 'user_action',
      email: snapshot.email,
      resolvedAuthProvider: 'profile-google',
      message: error instanceof Error ? error.message : GOOGLE_TEMPORARY_UNAVAILABLE_MESSAGE,
      code: error instanceof GoogleCalendarOAuthFunctionError ? error.code : undefined,
      requestId: error instanceof GoogleCalendarOAuthFunctionError ? error.requestId : undefined,
      readiness: error instanceof GoogleCalendarOAuthFunctionError ? error.readiness : undefined,
      httpStatus: error instanceof GoogleCalendarOAuthFunctionError ? error.httpStatus : undefined,
    });
    if (error instanceof GoogleCalendarOAuthFunctionError) {
      throw mapGoogleCalendarOAuthError({
        id: 'profile-google',
        name: 'Google Calendar',
        email: snapshot.email,
        provider: 'google',
        isPrimary: false,
        connected: true,
        mocked: false,
        authProvider: 'profile-google',
      }, 'profile-google', error);
    }
    throw error;
  }
}

export async function triggerProfileGoogleReconnect(): Promise<void> {
  appendGoogleCalendarDiagnosticEvent({
    operation: 'reconnect',
    phase: 'start',
    outcome: 'info',
    triggerSource: 'user_action',
    resolvedAuthProvider: 'profile-google',
    message: 'Starting a HELM Google sign-in reconnect for the linked profile account.',
  });
  await signInWithGoogle();
}

export function clearGoogleCalendarAuth(accountId: string): void {
  clearGoogleTokens(accountId);
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
