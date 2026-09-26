import type {
  CalendarAccount,
  CalendarAuthProvider,
} from '../types/domain';
import {
  clearGoogleTokens,
  loadGisScript,
  loadGoogleTokens,
  requestGoogleAuthorizationCode,
} from './googleAuth';
import { appendGoogleCalendarDiagnosticEvent } from './googleCalendarDiagnosticEvents';
import type { GoogleCalendarListEntry } from './googleCalendarApi';
import {
  bootstrapGoogleCalendarProfileCredential,
  exchangeGoogleCalendarAuthorizationCode,
  GoogleCalendarOAuthFunctionError,
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
import {
  GOOGLE_ACCESS_REVOKED_MESSAGE,
  GOOGLE_ACCOUNT_MISMATCH_MESSAGE,
  GOOGLE_PROFILE_RECONNECT_MESSAGE,
  GOOGLE_PROFILE_UPGRADE_REQUIRED_MESSAGE,
  GOOGLE_RECONNECT_REQUIRED_MESSAGE,
  GOOGLE_SIGN_IN_REQUIRED_MESSAGE,
  GOOGLE_TEMPORARY_UNAVAILABLE_MESSAGE,
  GOOGLE_UPGRADE_REQUIRED_MESSAGE,
  GoogleCalendarReconnectRequiredError,
  type GoogleCalendarPassiveSyncEligibility,
  type GoogleCalendarRuntimeCredentialState,
  buildGoogleCalendarAuthPatch,
  deriveGoogleCalendarRuntimeCredentialState,
  evaluateGoogleCalendarPassiveSyncEligibility,
  getReconnectMessageForProvider,
  hasStoredGoogleTokens,
  normalizeGoogleAccountEmail as normalizeEmail,
  resolveGoogleAuthProvider,
} from './googleCalendarAccountState';

/**
 * Google Calendar credential I/O: hosted token minting, OAuth connect and
 * reconnect, and profile bootstrap. The pure account-state rules live in
 * `googleCalendarAccountState.ts`; this module supplies the live session,
 * Supabase readiness, stored tokens and clock to them and re-exports them so
 * existing imports keep working.
 */
export {
  GOOGLE_ACCESS_EXPIRED_MESSAGE,
  GOOGLE_ACCESS_REVOKED_MESSAGE,
  GOOGLE_ACCOUNT_MISMATCH_MESSAGE,
  GOOGLE_HOSTED_SCHEMA_MISSING_MESSAGE,
  GOOGLE_PROFILE_RECONNECT_MESSAGE,
  GOOGLE_PROFILE_UPGRADE_REQUIRED_MESSAGE,
  GOOGLE_RECONNECT_REQUIRED_MESSAGE,
  GOOGLE_SIGN_IN_REQUIRED_MESSAGE,
  GOOGLE_TEMPORARY_UNAVAILABLE_MESSAGE,
  GOOGLE_UPGRADE_REQUIRED_MESSAGE,
  GoogleCalendarReconnectRequiredError,
  formatGoogleCalendarOwnershipMismatchMessage,
  getGoogleCalendarAccountActivityTime,
  getGoogleCalendarAccountPatchForCredentialState,
  getGoogleCalendarCredentialStatusLabel,
  getGoogleCalendarOwnershipResult,
  getGoogleCalendarStatusLabel,
  isGoogleCalendarAccount,
} from './googleCalendarAccountState';
export type {
  GoogleCalendarCredentialSource,
  GoogleCalendarOwnershipResult,
  GoogleCalendarPassiveSyncEligibility,
  GoogleCalendarRuntimeCredentialHealth,
  GoogleCalendarRuntimeCredentialState,
} from './googleCalendarAccountState';

export interface GoogleCalendarConnectionResult {
  email: string;
  accountName: string;
  calendars: GoogleCalendarListEntry[];
  authProvider: CalendarAuthProvider;
  authExpiresAt?: string;
}

export interface GoogleCalendarPassiveAccessToken {
  accessToken: string;
  authProvider: CalendarAuthProvider;
  authExpiresAt?: string;
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

export function getResolvedGoogleAuthProvider(
  account: CalendarAccount,
  snapshot: AuthSessionSnapshot | null = getAuthSessionSnapshot(),
): CalendarAuthProvider {
  return resolveGoogleAuthProvider(account, snapshot);
}

export function getGoogleCalendarPassiveSyncEligibility(
  account: CalendarAccount,
  options: { manual?: boolean } = {},
): GoogleCalendarPassiveSyncEligibility {
  return evaluateGoogleCalendarPassiveSyncEligibility(account, {
    manual: options.manual,
    supabaseReady: isSupabaseReady(),
    snapshot: getAuthSessionSnapshot(),
    sessionBootstrapped: isAuthSessionBootstrapped(),
    now: Date.now(),
  });
}

export function getGoogleCalendarAuthPatch(
  account: CalendarAccount,
  snapshot: AuthSessionSnapshot | null = getAuthSessionSnapshot(),
): Partial<CalendarAccount> {
  return buildGoogleCalendarAuthPatch(account, snapshot);
}

export function getGoogleCalendarRuntimeCredentialState(
  account: CalendarAccount,
  options: {
    serverCredential?: GoogleCalendarServerCredentialStatus;
    snapshot?: AuthSessionSnapshot | null;
  } = {},
): GoogleCalendarRuntimeCredentialState {
  return deriveGoogleCalendarRuntimeCredentialState(account, {
    serverCredential: options.serverCredential,
    snapshot: options.snapshot ?? getAuthSessionSnapshot(),
    supabaseReady: isSupabaseReady(),
    legacyTokens: loadGoogleTokens(account.id),
  });
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
    message: 'Attempting to bootstrap a hosted Google Calendar credential from the signed-in Sabah One session.',
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
    message: 'Bootstrapped a hosted Google Calendar credential from the signed-in Sabah One session.',
  });
}

export async function getGoogleCalendarPassiveAccessTokenWithRefresh(
  account: CalendarAccount,
  clientId: string,
): Promise<GoogleCalendarPassiveAccessToken> {
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

/**
 * `redirectUri` must match an authorised origin of the Google OAuth client.
 * It defaults to the page origin, read when the function is called.
 */
export async function connectGoogleCalendarOAuthAccount(
  clientId: string,
  redirectUri: string = window.location.origin,
): Promise<GoogleCalendarConnectionResult> {
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
      redirectUri,
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
  redirectUri: string = window.location.origin,
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
      redirectUri,
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
      message: `Linked the signed-in Sabah One Google account ${snapshot.email} to Google Calendar.`,
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
    message: 'Starting a Sabah One Google sign-in reconnect for the linked profile account.',
  });
  await signInWithGoogle();
}

export function clearGoogleCalendarAuth(accountId: string): void {
  clearGoogleTokens(accountId);
}
