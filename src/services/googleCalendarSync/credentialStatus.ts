import type { CalendarAccount } from '../../types/domain';
import type {
  GoogleCalendarBackendReadiness,
  GoogleCalendarDiagnosticOutcome,
} from '../googleCalendarDiagnosticEvents';
import {
  getGoogleCalendarAccountPatchForCredentialState,
  type GoogleCalendarRuntimeCredentialState,
} from '../googleCalendarAccountState';
import { GoogleCalendarOAuthFunctionError } from '../googleCalendarServerAuth';

/** Pure rules for turning hosted credential status into account state. */

export function defaultServerReadiness(): GoogleCalendarBackendReadiness {
  return {
    functionReachable: true,
    oauthConfigured: true,
    originAllowed: true,
    signedIn: true,
  };
}

/**
 * An explicit ownership mismatch asks the user to reconnect on purpose. A
 * refreshable hosted credential alone must not silently clear that request.
 */
export function shouldPreserveExplicitFailureState(account: CalendarAccount): boolean {
  return Boolean(account.lastAuthError?.includes('Reconnect this account explicitly.'));
}

export function planCredentialAccountPatch(
  account: CalendarAccount,
  runtimeState: GoogleCalendarRuntimeCredentialState,
  checkedAt: string,
): Partial<CalendarAccount> {
  const credentialPatch = getGoogleCalendarAccountPatchForCredentialState(account, runtimeState, checkedAt);
  if (runtimeState.credentialHealth === 'refreshable' && shouldPreserveExplicitFailureState(account)) {
    return {
      ...credentialPatch,
      authStatus: account.authStatus,
      lastAuthError: account.lastAuthError,
      syncError: account.syncError,
    };
  }
  return credentialPatch;
}

/** True when a refreshable credential is about to clear a stale failure status. */
export function isClearingStaleFailure(
  account: CalendarAccount,
  runtimeState: GoogleCalendarRuntimeCredentialState,
  accountPatch: Partial<CalendarAccount>,
): boolean {
  return runtimeState.credentialHealth === 'refreshable'
    && accountPatch.authStatus === 'connected'
    && (account.authStatus === 'revoked' || account.authStatus === 'needs_reconnect' || account.authStatus === 'error');
}

export function hasAccountChanges(account: CalendarAccount, updates: Partial<CalendarAccount>): boolean {
  return Object.entries(updates).some(([key, value]) => account[key as keyof CalendarAccount] !== value);
}

export function getStatusRefreshFailureOutcome(error: unknown): GoogleCalendarDiagnosticOutcome {
  if (error instanceof GoogleCalendarOAuthFunctionError && error.code === 'sign_in_required') return 'blocked';
  if (error instanceof GoogleCalendarOAuthFunctionError && error.code === 'temporary_unavailable') return 'temporary_unavailable';
  return 'failure';
}
