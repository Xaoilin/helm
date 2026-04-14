import type {
  CalendarAccount,
  CalendarAuthProvider,
  CalendarAuthStatus,
} from '../types/domain';
import {
  GOOGLE_ACCESS_EXPIRED_MESSAGE,
  GOOGLE_ACCESS_REVOKED_MESSAGE,
  GOOGLE_TEMPORARY_UNAVAILABLE_MESSAGE,
  GoogleCalendarReconnectRequiredError,
  getGoogleCalendarPassiveAccessTokenWithRefresh,
  getGoogleCalendarPassiveSyncEligibility,
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
export type GoogleCalendarPassiveProbeStatus = 'success' | 'blocked' | 'needs_reconnect' | 'revoked' | 'error';

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
  authExpiresAt?: string;
  lastAuthError?: string;
  syncError?: string;
  passiveSyncEligible: boolean;
  passiveSyncBlockedReason?: string;
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
  authExpiresAt?: string;
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

export function getGoogleCalendarDebugSnapshot(accounts: CalendarAccount[]): GoogleCalendarDebugSnapshot {
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
        return {
          accountId: account.id,
          email: account.email,
          resolvedAuthProvider: getResolvedGoogleAuthProvider(account, snapshot),
          storedAuthStatus: account.authStatus,
          lastSyncTime: account.lastSyncTime,
          lastAuthCheckAt: account.lastAuthCheckAt,
          authExpiresAt: account.authExpiresAt,
          lastAuthError: account.lastAuthError,
          syncError: account.syncError,
          passiveSyncEligible: passiveSync.eligible,
          passiveSyncBlockedReason: passiveSync.blockedReason,
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

  if (!eligibility.eligible) {
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

    return {
      accountId: account.id,
      email: account.email,
      checkedAt,
      resolvedAuthProvider: token.authProvider,
      status: 'success',
      message: `Passive access confirmed. ${calendars.length} calendar${calendars.length === 1 ? '' : 's'} visible.`,
      authExpiresAt: token.authExpiresAt,
      calendarCount: calendars.length,
    };
  } catch (error) {
    if (error instanceof GoogleCalendarReconnectRequiredError) {
      return {
        accountId: account.id,
        email: account.email,
        checkedAt,
        resolvedAuthProvider: error.authProvider,
        status: 'needs_reconnect',
        message: error.message,
      };
    }

    if (error instanceof GoogleApiError && error.isForbidden) {
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
      return {
        accountId: account.id,
        email: account.email,
        checkedAt,
        resolvedAuthProvider,
        status: 'needs_reconnect',
        message: GOOGLE_ACCESS_EXPIRED_MESSAGE,
      };
    }

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
