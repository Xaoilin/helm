import type { CalendarAccount, CalendarEvent, CalendarSource } from '../../types/domain';
import type { GoogleCalendarBackendReadiness } from '../googleCalendarDiagnosticEvents';

export type SyncState = 'idle' | 'syncing' | 'error';
export type GoogleSyncTriggerSource = 'auto' | 'manual';
export type GoogleSyncDiagnosticOutcome =
  | 'success'
  | 'blocked'
  | 'needs_reconnect'
  | 'revoked'
  | 'error'
  | 'ownership_mismatch';

export interface GoogleSyncAccountDiagnostic {
  accountId: string;
  email: string;
  checkedAt: string;
  triggerSource: GoogleSyncTriggerSource;
  outcome: GoogleSyncDiagnosticOutcome;
  message: string;
  primaryCalendarEmail?: string;
  fetchedEventCount?: number;
  upsertedEventCount?: number;
  relinkedEventCount?: number;
  cachedEventCount?: number;
  visibleCachedEventCount?: number;
  preservedSourceCount?: number;
  preservedEventCount?: number;
  removedSourceCount?: number;
  removedEventCount?: number;
  skippedDestructiveRemovals?: boolean;
}

export interface GoogleSyncDiagnostics {
  lastTriggerSource?: GoogleSyncTriggerSource;
  lastTriggerAt?: string;
  accounts: Record<string, GoogleSyncAccountDiagnostic>;
}

export interface GoogleCalendarServerRuntimeStatus {
  checkedAt: string;
  requestId?: string;
  readiness: GoogleCalendarBackendReadiness;
  statusCount: number;
  lastError?: string;
  lastErrorCode?: string;
}

export interface AccountSyncState {
  state: SyncState;
  lastSync: string | null;
  error: string | null;
}

export type CalendarSourceUpsert = Partial<CalendarSource> & {
  accountId: string;
  name: string;
  color: string;
  visible: boolean;
};

export type CalendarEventUpsert = Partial<CalendarEvent> & {
  sourceId: string;
  title: string;
  description: string;
  start: string;
  end: string;
  allDay: boolean;
};

/**
 * The Calendar capabilities Google sync reads and writes. `GoogleSyncBridge`
 * supplies it from the Calendar domain, keeping account -> source -> event
 * identity with the Calendar owner.
 */
export interface GoogleSyncApp {
  calendarAccounts: CalendarAccount[];
  calendarSources: CalendarSource[];
  calendarEvents: CalendarEvent[];
  updateCalendarAccount: (id: string, updates: Partial<CalendarAccount>) => void;
  bulkUpsertCalendarSources: (sources: CalendarSourceUpsert[]) => void;
  bulkUpsertCalendarEvents: (events: CalendarEventUpsert[]) => void;
  removeCalendarSource: (id: string) => void;
  updateCalendarEvent: (id: string, updates: { sourceId: string }) => void;
  removeCalendarEvent: (id: string) => void;
  bulkRemoveCalendarEvents: (ids: string[]) => void;
}
