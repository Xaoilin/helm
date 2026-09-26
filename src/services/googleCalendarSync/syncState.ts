import type { CalendarAccount } from '../../types/domain';
import type { GoogleCalendarRuntimeCredentialState } from '../googleCalendarAccountState';
import type { GoogleAccountSyncResult } from './service';
import type {
  AccountSyncState,
  GoogleSyncAccountDiagnostic,
  GoogleSyncDiagnostics,
  GoogleSyncTriggerSource,
} from './types';

/** Pure transitions for the Google sync state the hook publishes. */

export type AccountSyncStates = Record<string, AccountSyncState>;
export type CredentialStatuses = Record<string, GoogleCalendarRuntimeCredentialState>;

export function markAccountSyncing(
  previous: AccountSyncStates,
  account: Pick<CalendarAccount, 'id' | 'lastSyncTime'>,
): AccountSyncStates {
  return {
    ...previous,
    [account.id]: {
      state: 'syncing',
      lastSync: previous[account.id]?.lastSync || account.lastSyncTime || null,
      error: null,
    },
  };
}

export function settleAccountSyncState(previous: AccountSyncStates, result: GoogleAccountSyncResult): AccountSyncStates {
  const next: AccountSyncState = result.synced
    ? { state: 'idle', lastSync: result.syncedAt, error: null }
    : {
        state: 'error',
        lastSync: previous[result.accountId]?.lastSync || result.persistedLastSync || null,
        error: result.error,
      };
  return { ...previous, [result.accountId]: next };
}

export function mergeAccountCredentialStatus(
  previous: CredentialStatuses,
  result: GoogleAccountSyncResult,
): CredentialStatuses {
  return {
    ...previous,
    [result.accountId]: {
      ...(previous[result.accountId] || result.baselineCredentialState),
      ...result.credentialPatch,
    },
  };
}

export function rememberAccountDiagnostic(
  previous: GoogleSyncDiagnostics,
  entry: GoogleSyncAccountDiagnostic,
): GoogleSyncDiagnostics {
  return {
    lastTriggerSource: entry.triggerSource,
    lastTriggerAt: entry.checkedAt,
    accounts: {
      ...previous.accounts,
      [entry.accountId]: entry,
    },
  };
}

export function rememberSyncTrigger(
  previous: GoogleSyncDiagnostics,
  triggerSource: GoogleSyncTriggerSource,
  triggeredAt: string,
): GoogleSyncDiagnostics {
  return {
    ...previous,
    lastTriggerSource: triggerSource,
    lastTriggerAt: triggeredAt,
  };
}

/** The most recent persisted sync time across accounts, or null when none has synced. */
export function getLatestAccountSyncTime(accounts: readonly Pick<CalendarAccount, 'lastSyncTime'>[]): string | null {
  return accounts.reduce<string | null>((latest, account) => {
    if (!account.lastSyncTime) return latest;
    if (!latest) return account.lastSyncTime;
    return account.lastSyncTime > latest ? account.lastSyncTime : latest;
  }, null);
}
