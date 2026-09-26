import type { CalendarAccount } from '../../types/domain';
import type {
  GoogleCalendarDiagnosticEvent,
  GoogleCalendarDiagnosticOutcome,
  GoogleCalendarDiagnosticPhase,
} from '../googleCalendarDiagnosticEvents';
import type { GoogleCalendarOwnershipResult } from '../googleCalendarAccountState';
import type {
  GoogleSyncAccountDiagnostic,
  GoogleSyncDiagnosticOutcome,
  GoogleSyncTriggerSource,
} from './types';

/** Pure builders for Google sync diagnostics and their timeline events. */

export type GoogleCalendarDiagnosticEventInput = Omit<GoogleCalendarDiagnosticEvent, 'id' | 'timestamp'>;

export function plural(count: number, singular: string, pluralForm = `${singular}s`): string {
  return count === 1 ? singular : pluralForm;
}

export function createBlockedDiagnostic(
  account: CalendarAccount,
  triggerSource: GoogleSyncTriggerSource,
  checkedAt: string,
  message: string,
): GoogleSyncAccountDiagnostic {
  return {
    accountId: account.id,
    email: account.email,
    checkedAt,
    triggerSource,
    outcome: 'blocked',
    message,
  };
}

export function createOwnershipMismatchDiagnostic(
  account: CalendarAccount,
  triggerSource: GoogleSyncTriggerSource,
  checkedAt: string,
  ownership: GoogleCalendarOwnershipResult,
): GoogleSyncAccountDiagnostic {
  return {
    accountId: account.id,
    email: account.email,
    checkedAt,
    triggerSource,
    outcome: 'ownership_mismatch',
    message: ownership.message || 'Google returned a different account.',
    primaryCalendarEmail: ownership.primaryEmail,
    skippedDestructiveRemovals: true,
  };
}

export interface SyncSuccessCounts {
  fetchedEventCount: number;
  upsertedEventCount: number;
  relinkedEventCount: number;
  cachedEventCount: number;
  visibleCachedEventCount: number;
  preservedSourceCount: number;
  preservedEventCount: number;
  removedSourceCount: number;
  removedEventCount: number;
}

export function createSuccessMessage(counts: SyncSuccessCounts): string {
  const {
    fetchedEventCount,
    upsertedEventCount,
    relinkedEventCount,
    cachedEventCount,
    visibleCachedEventCount,
    preservedSourceCount,
    preservedEventCount,
    removedSourceCount,
    removedEventCount,
  } = counts;
  const parts: string[] = [
    `mirrored ${fetchedEventCount} Google ${plural(fetchedEventCount, 'event')} into the local cache`,
  ];

  if (upsertedEventCount > 0) {
    parts.push(`added or updated ${upsertedEventCount} ${plural(upsertedEventCount, 'event')}`);
  }
  if (relinkedEventCount > 0) {
    parts.push(`relinked ${relinkedEventCount} cached ${plural(relinkedEventCount, 'event')} to the current calendar source`);
  }
  parts.push(`cache now has ${cachedEventCount} Google ${plural(cachedEventCount, 'event')}`);
  if (visibleCachedEventCount !== cachedEventCount) {
    parts.push(`${visibleCachedEventCount} visible`);
  }

  if (removedSourceCount > 0) {
    parts.push(`removed ${removedSourceCount} stale ${plural(removedSourceCount, 'calendar')}`);
  }
  if (removedEventCount > 0) {
    parts.push(`removed ${removedEventCount} stale ${plural(removedEventCount, 'event')}`);
  }
  if (preservedSourceCount > 0) {
    parts.push(`kept ${preservedSourceCount} local ${plural(preservedSourceCount, 'calendar')}`);
  }
  if (preservedEventCount > 0) {
    parts.push(`kept ${preservedEventCount} cached ${plural(preservedEventCount, 'event')} outside the fetch window`);
  }

  return `Passive sync ${parts.join(', ')}.`;
}

function getPhaseForSyncOutcome(outcome: GoogleSyncDiagnosticOutcome): GoogleCalendarDiagnosticPhase {
  switch (outcome) {
    case 'success':
      return 'success';
    case 'blocked':
      return 'blocked';
    default:
      return 'failure';
  }
}

function getTimelineOutcomeForSyncOutcome(outcome: GoogleSyncDiagnosticOutcome): GoogleCalendarDiagnosticOutcome {
  switch (outcome) {
    case 'success':
    case 'blocked':
    case 'needs_reconnect':
    case 'revoked':
    case 'ownership_mismatch':
      return outcome;
    case 'error':
    default:
      return 'failure';
  }
}

/** The diagnostic timeline event recorded for one account's sync outcome. */
export function toSyncAccountDiagnosticEvent(entry: GoogleSyncAccountDiagnostic): GoogleCalendarDiagnosticEventInput {
  return {
    operation: 'sync_account',
    phase: getPhaseForSyncOutcome(entry.outcome),
    outcome: getTimelineOutcomeForSyncOutcome(entry.outcome),
    triggerSource: entry.triggerSource,
    accountId: entry.accountId,
    email: entry.email,
    message: entry.message,
    primaryCalendarEmail: entry.primaryCalendarEmail,
    preservedSourceCount: entry.preservedSourceCount,
    preservedEventCount: entry.preservedEventCount,
    removedSourceCount: entry.removedSourceCount,
    removedEventCount: entry.removedEventCount,
    skippedDestructiveRemovals: entry.skippedDestructiveRemovals,
    fetchedEventCount: entry.fetchedEventCount,
    upsertedEventCount: entry.upsertedEventCount,
    relinkedEventCount: entry.relinkedEventCount,
    cachedEventCount: entry.cachedEventCount,
    visibleCachedEventCount: entry.visibleCachedEventCount,
  };
}
