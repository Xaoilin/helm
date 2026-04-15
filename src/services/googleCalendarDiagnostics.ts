import type { CalendarAccount, CalendarAuthProvider, CalendarAuthStatus } from '../types/domain';
import { appendGoogleCalendarDiagnosticEvent } from './googleCalendarDiagnosticEvents';
import {
  GOOGLE_ACCESS_EXPIRED_MESSAGE,
  GOOGLE_ACCESS_REVOKED_MESSAGE,
  GOOGLE_TEMPORARY_UNAVAILABLE_MESSAGE,
  type GoogleCalendarCredentialSource,
  type GoogleCalendarRuntimeCredentialHealth,
  type GoogleCalendarRuntimeCredentialState,
  GoogleCalendarReconnectRequiredError,
  getGoogleCalendarOwnershipResult,
  getGoogleCalendarPassiveAccessTokenWithRefresh,
  getGoogleCalendarPassiveSyncEligibility,
  getGoogleCalendarRuntimeCredentialState,
  getResolvedGoogleAuthProvider,
  isGoogleCalendarAccount,
} from './googleCalendarAuthManager';
import {
  fetchCalendarList,
  GoogleApiError,
} from './googleCalendarApi';
import {
  isTokenValid,
  loadGoogleTokens,
} from './googleAuth';
import {
  getAuthSessionSnapshot,
  isAuthSessionBootstrapped,
  isSupabaseReady,
} from '../store/supabase';

export type GoogleCalendarStoredTokenState = 'missing' | 'valid' | 'expired';
export type GoogleCalendarPassiveProbeStatus =
  | 'success'
  | 'blocked'
  | 'needs_reconnect'
  | 'revoked'
  | 'error'
  | 'ownership_mismatch';

export interface GoogleCalendarTokenDebugSnapshot {
  present: boolean;
  state: GoogleCalendarStoredTokenState;
  expiresAt?: string;
  scope?: string;
}

export interface GoogleCalendarAccountDebugSnapshot {
  accountId: string;
  email: string;
  resolvedAuthProvider: CalendarAuthProvider;
  storedAuthStatus?: CalendarAuthStatus;
  lastSyncTime?: string;
  lastAuthCheckAt?: string;
  lastAuthError?: string;
  syncError?: string;
  passiveSyncEligible: boolean;
  passiveSyncBlockedReason?: string;
  credentialSource: GoogleCalendarCredentialSource;
  serverCredentialPresent: boolean;
  credentialHealth: GoogleCalendarRuntimeCredentialHealth;
  currentAccessTokenExpiresAt?: string;
  lastRefreshAt?: string;
  lastRefreshFailureReason?: string;
  lastRefreshFailureAt?: string;
  upgradeRequired: boolean;
  storedToken: GoogleCalendarTokenDebugSnapshot;
}

export interface GoogleCalendarDebugSnapshot {
  supabaseReady: boolean;
  authSessionBootstrapped: boolean;
  session: {
    email?: string;
    provider?: string;
    accessTokenPresent: boolean;
    providerTokenPresent: boolean;
    providerRefreshTokenPresent: boolean;
    expiresAt?: string;
  };
  accounts: GoogleCalendarAccountDebugSnapshot[];
}

export interface GoogleCalendarPassiveProbeResult {
  accountId: string;
  email: string;
  checkedAt: string;
  resolvedAuthProvider: CalendarAuthProvider;
  status: GoogleCalendarPassiveProbeStatus;
  message: string;
  currentAccessTokenExpiresAt?: string;
  calendarCount?: number;
}

function toIsoExpiry(expiresAt: number | null | undefined): string | undefined {
  return typeof expiresAt === 'number' ? new Date(expiresAt).toISOString() : undefined;
}

export function getGoogleCalendarStoredTokenDebugSnapshot(accountId: string): GoogleCalendarTokenDebugSnapshot {
  const tokens = loadGoogleTokens(accountId);

  if (!tokens?.accessToken) {
    return {
      present: false,
      state: 'missing',
    };
  }

  return {
    present: true,
    state: isTokenValid(tokens) ? 'valid' : 'expired',
    expiresAt: toIsoExpiry(tokens.expiresAt),
    scope: tokens.scope,
  };
}

export function getGoogleCalendarDebugSnapshot(
  accounts: CalendarAccount[],
  credentialStates: Record<string, GoogleCalendarRuntimeCredentialState> = {},
): GoogleCalendarDebugSnapshot {
  const snapshot = getAuthSessionSnapshot();

  return {
    supabaseReady: isSupabaseReady(),
    authSessionBootstrapped: isAuthSessionBootstrapped(),
    session: {
      email: snapshot?.email ?? undefined,
      provider: snapshot?.provider ?? undefined,
      accessTokenPresent: Boolean(snapshot?.accessTokenPresent),
      providerTokenPresent: Boolean(snapshot?.providerToken),
      providerRefreshTokenPresent: Boolean(snapshot?.providerRefreshToken),
      expiresAt: snapshot?.expiresAt ? new Date(snapshot.expiresAt * 1000).toISOString() : undefined,
    },
    accounts: accounts
      .filter(isGoogleCalendarAccount)
      .map(account => {
        const passiveSync = getGoogleCalendarPassiveSyncEligibility(account);
        const runtimeState = credentialStates[account.id]
          ?? getGoogleCalendarRuntimeCredentialState(account, { snapshot });

        return {
          accountId: account.id,
          email: account.email,
          resolvedAuthProvider: getResolvedGoogleAuthProvider(account, snapshot),
          storedAuthStatus: account.authStatus,
          lastSyncTime: account.lastSyncTime,
          lastAuthCheckAt: account.lastAuthCheckAt,
          lastAuthError: account.lastAuthError,
          syncError: account.syncError,
          passiveSyncEligible: passiveSync.eligible,
          passiveSyncBlockedReason: passiveSync.blockedReason,
          credentialSource: runtimeState.credentialSource,
          serverCredentialPresent: runtimeState.serverCredentialPresent,
          credentialHealth: runtimeState.credentialHealth,
          currentAccessTokenExpiresAt: runtimeState.currentAccessTokenExpiresAt ?? account.authExpiresAt,
          lastRefreshAt: runtimeState.lastRefreshAt,
          lastRefreshFailureReason: runtimeState.lastRefreshFailureReason,
          lastRefreshFailureAt: runtimeState.lastRefreshFailureAt,
          upgradeRequired: runtimeState.credentialHealth === 'upgrade_required',
          storedToken: getGoogleCalendarStoredTokenDebugSnapshot(account.id),
        };
      }),
  };
}

export async function runGoogleCalendarPassiveProbe(
  account: CalendarAccount,
  clientId: string,
): Promise<GoogleCalendarPassiveProbeResult> {
  const checkedAt = new Date().toISOString();
  const resolvedAuthProvider = getResolvedGoogleAuthProvider(account);
  const eligibility = getGoogleCalendarPassiveSyncEligibility(account, { manual: true });

  appendGoogleCalendarDiagnosticEvent({
    operation: 'manual_probe',
    phase: 'start',
    outcome: 'info',
    triggerSource: 'debug',
    accountId: account.id,
    email: account.email,
    resolvedAuthProvider,
    message: `Running a manual Google Calendar passive probe for ${account.email}.`,
  });

  if (!eligibility.eligible) {
    appendGoogleCalendarDiagnosticEvent({
      operation: 'manual_probe',
      phase: 'blocked',
      outcome: 'blocked',
      triggerSource: 'debug',
      accountId: account.id,
      email: account.email,
      resolvedAuthProvider,
      message: eligibility.blockedReason || 'Passive auth check is blocked.',
    });
    return {
      accountId: account.id,
      email: account.email,
      checkedAt,
      resolvedAuthProvider,
      status: 'blocked',
      message: eligibility.blockedReason || 'Passive auth check is blocked.',
    };
  }

  try {
    const token = await getGoogleCalendarPassiveAccessTokenWithRefresh(account, clientId);
    const calendars = await fetchCalendarList(token.accessToken);
    const ownership = getGoogleCalendarOwnershipResult(account, calendars);

    if (!ownership.matches) {
      appendGoogleCalendarDiagnosticEvent({
        operation: 'manual_probe',
        phase: 'failure',
        outcome: 'ownership_mismatch',
        triggerSource: 'debug',
        accountId: account.id,
        email: account.email,
        resolvedAuthProvider: token.authProvider,
        message: ownership.message || 'Google returned a different account.',
        primaryCalendarEmail: ownership.primaryEmail,
        calendarCount: calendars.length,
      });
      return {
        accountId: account.id,
        email: account.email,
        checkedAt,
        resolvedAuthProvider: token.authProvider,
        status: 'ownership_mismatch',
        message: ownership.message || 'Google returned a different account.',
        calendarCount: calendars.length,
      };
    }

    appendGoogleCalendarDiagnosticEvent({
      operation: 'manual_probe',
      phase: 'success',
      outcome: 'success',
      triggerSource: 'debug',
      accountId: account.id,
      email: account.email,
      resolvedAuthProvider: token.authProvider,
      message: `Passive access confirmed. ${calendars.length} calendar${calendars.length === 1 ? '' : 's'} visible.`,
      calendarCount: calendars.length,
    });
    return {
      accountId: account.id,
      email: account.email,
      checkedAt,
      resolvedAuthProvider: token.authProvider,
      status: 'success',
      message: `Passive access confirmed. ${calendars.length} calendar${calendars.length === 1 ? '' : 's'} visible.`,
      currentAccessTokenExpiresAt: token.authExpiresAt,
      calendarCount: calendars.length,
    };
  } catch (error) {
    if (error instanceof GoogleCalendarReconnectRequiredError) {
      appendGoogleCalendarDiagnosticEvent({
        operation: 'manual_probe',
        phase: 'failure',
        outcome: error.authStatus === 'revoked' ? 'revoked' : 'needs_reconnect',
        triggerSource: 'debug',
        accountId: account.id,
        email: account.email,
        resolvedAuthProvider: error.authProvider,
        message: error.message,
      });
      return {
        accountId: account.id,
        email: account.email,
        checkedAt,
        resolvedAuthProvider: error.authProvider,
        status: error.authStatus === 'revoked' ? 'revoked' : 'needs_reconnect',
        message: error.message,
      };
    }

    if (error instanceof GoogleApiError && error.isForbidden) {
      appendGoogleCalendarDiagnosticEvent({
        operation: 'manual_probe',
        phase: 'failure',
        outcome: 'revoked',
        triggerSource: 'debug',
        accountId: account.id,
        email: account.email,
        resolvedAuthProvider,
        message: GOOGLE_ACCESS_REVOKED_MESSAGE,
        httpStatus: error.status,
      });
      return {
        accountId: account.id,
        email: account.email,
        checkedAt,
        resolvedAuthProvider,
        status: 'revoked',
        message: GOOGLE_ACCESS_REVOKED_MESSAGE,
      };
    }

    if (error instanceof GoogleApiError && error.isAuthError) {
      appendGoogleCalendarDiagnosticEvent({
        operation: 'manual_probe',
        phase: 'failure',
        outcome: 'needs_reconnect',
        triggerSource: 'debug',
        accountId: account.id,
        email: account.email,
        resolvedAuthProvider,
        message: GOOGLE_ACCESS_EXPIRED_MESSAGE,
        httpStatus: error.status,
      });
      return {
        accountId: account.id,
        email: account.email,
        checkedAt,
        resolvedAuthProvider,
        status: 'needs_reconnect',
        message: GOOGLE_ACCESS_EXPIRED_MESSAGE,
      };
    }

    appendGoogleCalendarDiagnosticEvent({
      operation: 'manual_probe',
      phase: 'failure',
      outcome: 'failure',
      triggerSource: 'debug',
      accountId: account.id,
      email: account.email,
      resolvedAuthProvider,
      message: error instanceof Error ? error.message : GOOGLE_TEMPORARY_UNAVAILABLE_MESSAGE,
    });
    return {
      accountId: account.id,
      email: account.email,
      checkedAt,
      resolvedAuthProvider,
      status: 'error',
      message: error instanceof Error ? error.message : GOOGLE_TEMPORARY_UNAVAILABLE_MESSAGE,
    };
  }
}
