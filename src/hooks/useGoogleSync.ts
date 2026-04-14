import {
  createElement,
  createContext,
  useCallback,
  useContext,
  useEffect,
  useMemo,
  useRef,
  useState,
  type ReactNode,
} from 'react';
import type { CalendarAccount, CalendarEvent, CalendarSource } from '../types/domain';
import {
  fetchCalendarList,
  fetchEvents,
  googleEventToLocal,
  GoogleApiError,
} from '../services/googleCalendarApi';
import {
  GOOGLE_ACCESS_EXPIRED_MESSAGE,
  GOOGLE_ACCESS_REVOKED_MESSAGE,
  GOOGLE_TEMPORARY_UNAVAILABLE_MESSAGE,
  type GoogleCalendarOwnershipResult,
  GoogleCalendarReconnectRequiredError,
  getGoogleCalendarOwnershipResult,
  getGoogleCalendarPassiveAccessTokenWithRefresh,
  getGoogleCalendarPassiveSyncEligibility,
  isGoogleCalendarAccount,
} from '../services/googleCalendarAuthManager';
import { LIMITS } from '../config/constants';

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
  preservedSourceCount?: number;
  preservedEventCount?: number;
  skippedDestructiveRemovals?: boolean;
}

export interface GoogleSyncDiagnostics {
  lastTriggerSource?: GoogleSyncTriggerSource;
  lastTriggerAt?: string;
  accounts: Record<string, GoogleSyncAccountDiagnostic>;
}

export interface GoogleSyncResult {
  syncState: SyncState;
  lastSyncTime: string | null;
  syncError: string | null;
  triggerSync: (manual?: boolean) => Promise<void>;
  accountSyncStates: Record<string, { state: SyncState; lastSync: string | null; error: string | null }>;
  diagnostics: GoogleSyncDiagnostics;
}

interface GoogleSyncApp {
  calendarAccounts: CalendarAccount[];
  calendarSources: CalendarSource[];
  calendarEvents: CalendarEvent[];
  updateCalendarAccount: (id: string, updates: Partial<CalendarAccount>) => void;
  bulkUpsertCalendarSources: (sources: Array<
    Partial<CalendarSource> & {
      accountId: string;
      name: string;
      color: string;
      visible: boolean;
    }
  >) => void;
  bulkUpsertCalendarEvents: (events: Array<
    Partial<CalendarEvent> & {
      sourceId: string;
      title: string;
      description: string;
      start: string;
      end: string;
      allDay: boolean;
    }
  >) => void;
  removeCalendarSource: (id: string) => void;
  updateCalendarEvent: (id: string, updates: { sourceId: string }) => void;
  removeCalendarEvent: (id: string) => void;
}

const GoogleSyncContext = createContext<GoogleSyncResult | null>(null);

function createBlockedDiagnostic(
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

function createOwnershipMismatchDiagnostic(
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

function createSuccessMessage(preservedSourceCount: number, preservedEventCount: number): string {
  if (preservedSourceCount === 0 && preservedEventCount === 0) {
    return 'Passive sync updated cached Google data without destructive deletes.';
  }

  const parts: string[] = [];
  if (preservedSourceCount > 0) {
    parts.push(`kept ${preservedSourceCount} cached calendar${preservedSourceCount === 1 ? '' : 's'}`);
  }
  if (preservedEventCount > 0) {
    parts.push(`kept ${preservedEventCount} cached event${preservedEventCount === 1 ? '' : 's'}`);
  }

  return `Passive sync updated cached Google data and ${parts.join(' and ')} missing from this fetch window.`;
}

function useGoogleSyncController(app: GoogleSyncApp): GoogleSyncResult {
  const [syncState, setSyncState] = useState<SyncState>('idle');
  const [syncError, setSyncError] = useState<string | null>(null);
  const [accountSyncStates, setAccountSyncStates] = useState<Record<string, { state: SyncState; lastSync: string | null; error: string | null }>>({});
  const [diagnostics, setDiagnostics] = useState<GoogleSyncDiagnostics>({ accounts: {} });
  const syncingRef = useRef(false);
  const appRef = useRef(app);

  useEffect(() => {
    appRef.current = app;
  }, [app]);

  const googleAccounts = useMemo(
    () => app.calendarAccounts.filter(isGoogleCalendarAccount),
    [app.calendarAccounts],
  );
  const googleAccountsSignature = useMemo(
    () => googleAccounts
      .map(account => [
        account.id,
        account.email,
        account.authProvider ?? '',
        account.authStatus ?? '',
        account.lastSyncTime ?? '',
        account.lastAuthCheckAt ?? '',
      ].join(':'))
      .join('|'),
    [googleAccounts],
  );
  const shouldAutoSync = useMemo(
    () => googleAccounts.some(account => getGoogleCalendarPassiveSyncEligibility(account).eligible),
    [googleAccounts],
  );

  const recordDiagnostic = useCallback((entry: GoogleSyncAccountDiagnostic) => {
    setDiagnostics(prev => ({
      lastTriggerSource: entry.triggerSource,
      lastTriggerAt: entry.checkedAt,
      accounts: {
        ...prev.accounts,
        [entry.accountId]: entry,
      },
    }));
  }, []);

  const syncAccount = useCallback(async (accountId: string, triggerSource: GoogleSyncTriggerSource): Promise<boolean> => {
    const currentApp = appRef.current;
    const account = currentApp.calendarAccounts.find(candidate => candidate.id === accountId);
    if (!account) return false;

    setAccountSyncStates(prev => ({
      ...prev,
      [accountId]: {
        state: 'syncing',
        lastSync: prev[accountId]?.lastSync || account.lastSyncTime || null,
        error: null,
      },
    }));

    try {
      const token = await getGoogleCalendarPassiveAccessTokenWithRefresh(account, '');
      const accessToken = token.accessToken;
      const googleCalendars = await fetchCalendarList(accessToken);
      const ownership = getGoogleCalendarOwnershipResult(account, googleCalendars);
      const checkedAt = new Date().toISOString();

      if (!ownership.matches) {
        const message = ownership.message || GOOGLE_ACCESS_EXPIRED_MESSAGE;
        currentApp.updateCalendarAccount(accountId, {
          authProvider: token.authProvider,
          authStatus: 'needs_reconnect',
          authEmail: account.email,
          lastAuthCheckAt: checkedAt,
          lastAuthError: message,
          syncError: undefined,
        });
        setAccountSyncStates(prev => ({
          ...prev,
          [accountId]: {
            state: 'error',
            lastSync: prev[accountId]?.lastSync || account.lastSyncTime || null,
            error: message,
          },
        }));
        recordDiagnostic(createOwnershipMismatchDiagnostic(account, triggerSource, checkedAt, ownership));
        return false;
      }

      const existingSources = currentApp.calendarSources.filter(source => source.accountId === accountId);
      const existingByGoogleId = new Map(
        existingSources
          .filter(source => source.googleCalendarId)
          .map(source => [source.googleCalendarId!, source]),
      );
      const foreignGoogleCalendarIds = new Set(
        currentApp.calendarSources
          .filter(source => source.googleCalendarId && source.accountId !== accountId)
          .map(source => source.googleCalendarId!),
      );

      const sourcesToUpsert: Array<{
        id?: string;
        accountId: string;
        name: string;
        color: string;
        visible: boolean;
        googleCalendarId: string;
        accessRole: string;
      }> = [];

      for (const googleCalendar of googleCalendars) {
        if (foreignGoogleCalendarIds.has(googleCalendar.id)) continue;

        const existing = existingByGoogleId.get(googleCalendar.id);
        if (existing) {
          if (
            existing.name !== googleCalendar.summary
            || existing.color !== (googleCalendar.backgroundColor || '#4f5bff')
          ) {
            sourcesToUpsert.push({
              id: existing.id,
              accountId,
              name: googleCalendar.summary,
              color: googleCalendar.backgroundColor || '#4f5bff',
              visible: existing.visible,
              googleCalendarId: googleCalendar.id,
              accessRole: googleCalendar.accessRole,
            });
          }
        } else {
          sourcesToUpsert.push({
            accountId,
            name: googleCalendar.summary,
            color: googleCalendar.backgroundColor || '#4f5bff',
            visible: true,
            googleCalendarId: googleCalendar.id,
            accessRole: googleCalendar.accessRole,
          });
        }
      }

      if (sourcesToUpsert.length > 0) {
        currentApp.bulkUpsertCalendarSources(sourcesToUpsert);
      }

      const googleCalendarIds = new Set(googleCalendars.map(calendar => calendar.id));
      const preservedSourceCount = existingSources.filter(source => (
        Boolean(source.googleCalendarId)
        && (!googleCalendarIds.has(source.googleCalendarId!) || foreignGoogleCalendarIds.has(source.googleCalendarId!))
      )).length;

      const timeMin = new Date(Date.now() - LIMITS.CALENDAR_PAST_DAYS * 86400000).toISOString();
      const timeMax = new Date(Date.now() + LIMITS.CALENDAR_FUTURE_DAYS * 86400000).toISOString();
      const syncableSources = existingSources.filter(source => source.googleCalendarId && !foreignGoogleCalendarIds.has(source.googleCalendarId));
      const globalEventIds = new Set(
        currentApp.calendarEvents
          .filter(event => event.googleEventId)
          .map(event => event.googleEventId!),
      );

      let preservedEventCount = 0;

      for (const source of syncableSources) {
        if (!source.googleCalendarId) continue;

        try {
          const googleEvents = await fetchEvents(accessToken, source.googleCalendarId, timeMin, timeMax);
          const mappedEvents = googleEvents.map(event => googleEventToLocal(event, source.id, source.googleCalendarId!));

          const existingEvents = currentApp.calendarEvents.filter(event => event.sourceId === source.id);
          const existingByGoogleEventId = new Map(
            existingEvents
              .filter(event => event.googleEventId)
              .map(event => [event.googleEventId!, event]),
          );

          const eventsToUpsert: Array<typeof mappedEvents[number] & { id?: string }> = [];
          const seenGoogleEventIds = new Set<string>();

          for (const mappedEvent of mappedEvents) {
            seenGoogleEventIds.add(mappedEvent.googleEventId);
            const existing = existingByGoogleEventId.get(mappedEvent.googleEventId);
            if (existing) {
              if (
                existing.title !== mappedEvent.title
                || existing.start !== mappedEvent.start
                || existing.end !== mappedEvent.end
                || existing.description !== mappedEvent.description
                || existing.location !== mappedEvent.location
              ) {
                eventsToUpsert.push({ ...mappedEvent, id: existing.id });
              }
            } else if (!globalEventIds.has(mappedEvent.googleEventId)) {
              eventsToUpsert.push(mappedEvent);
              globalEventIds.add(mappedEvent.googleEventId);
            }
          }

          preservedEventCount += existingEvents.filter(event => (
            Boolean(event.googleEventId) && !seenGoogleEventIds.has(event.googleEventId!)
          )).length;

          if (eventsToUpsert.length > 0) {
            currentApp.bulkUpsertCalendarEvents(eventsToUpsert);
          }
        } catch (error) {
          if (error instanceof GoogleApiError && (error.isAuthError || error.isForbidden)) {
            throw error;
          }
          console.warn(`Failed to sync calendar ${source.name}:`, error);
        }
      }

      const now = new Date().toISOString();
      currentApp.updateCalendarAccount(accountId, {
        authProvider: token.authProvider,
        authStatus: 'connected',
        authEmail: account.email,
        authExpiresAt: token.authExpiresAt,
        lastAuthCheckAt: now,
        lastAuthError: undefined,
        lastSyncTime: now,
        syncError: undefined,
      });
      setAccountSyncStates(prev => ({
        ...prev,
        [accountId]: { state: 'idle', lastSync: now, error: null },
      }));
      recordDiagnostic({
        accountId,
        email: account.email,
        checkedAt: now,
        triggerSource,
        outcome: 'success',
        message: createSuccessMessage(preservedSourceCount, preservedEventCount),
        primaryCalendarEmail: ownership.primaryEmail,
        preservedSourceCount,
        preservedEventCount,
        skippedDestructiveRemovals: preservedSourceCount > 0 || preservedEventCount > 0,
      });
      return true;
    } catch (error) {
      const now = new Date().toISOString();
      let message = GOOGLE_TEMPORARY_UNAVAILABLE_MESSAGE;
      let authStatus = account.authStatus ?? 'error';
      let outcome: GoogleSyncDiagnosticOutcome = 'error';

      if (error instanceof GoogleCalendarReconnectRequiredError) {
        message = error.message;
        authStatus = error.authStatus;
        outcome = 'needs_reconnect';
        currentApp.updateCalendarAccount(accountId, {
          authProvider: error.authProvider,
          authStatus,
          authEmail: account.email,
          lastAuthCheckAt: now,
          lastAuthError: message,
          syncError: undefined,
        });
      } else if (error instanceof GoogleApiError && error.isForbidden) {
        message = GOOGLE_ACCESS_REVOKED_MESSAGE;
        authStatus = 'revoked';
        outcome = 'revoked';
        currentApp.updateCalendarAccount(accountId, {
          authStatus,
          authEmail: account.email,
          lastAuthCheckAt: now,
          lastAuthError: message,
          syncError: undefined,
        });
      } else if (error instanceof GoogleApiError && error.isAuthError) {
        message = GOOGLE_ACCESS_EXPIRED_MESSAGE;
        authStatus = 'needs_reconnect';
        outcome = 'needs_reconnect';
        currentApp.updateCalendarAccount(accountId, {
          authStatus,
          authEmail: account.email,
          lastAuthCheckAt: now,
          lastAuthError: message,
          syncError: undefined,
        });
      } else {
        authStatus = 'error';
        currentApp.updateCalendarAccount(accountId, {
          authStatus,
          authEmail: account.email,
          lastAuthCheckAt: now,
          syncError: message,
        });
      }

      setAccountSyncStates(prev => ({
        ...prev,
        [accountId]: {
          state: 'error',
          lastSync: prev[accountId]?.lastSync || account.lastSyncTime || null,
          error: message,
        },
      }));
      recordDiagnostic({
        accountId,
        email: account.email,
        checkedAt: now,
        triggerSource,
        outcome,
        message,
      });

      return false;
    }
  }, [recordDiagnostic]);

  const triggerSync = useCallback(async (manual = false) => {
    const googleAccounts = appRef.current.calendarAccounts.filter(isGoogleCalendarAccount);
    if (syncingRef.current || googleAccounts.length === 0) return;

    syncingRef.current = true;
    setSyncState('syncing');
    setSyncError(null);

    const triggerSource: GoogleSyncTriggerSource = manual ? 'manual' : 'auto';
    const triggeredAt = new Date().toISOString();

    setDiagnostics(prev => ({
      ...prev,
      lastTriggerSource: triggerSource,
      lastTriggerAt: triggeredAt,
    }));

    const syncableAccounts = googleAccounts.filter(account => {
      const eligibility = getGoogleCalendarPassiveSyncEligibility(account, { manual });
      if (!eligibility.eligible) {
        recordDiagnostic(createBlockedDiagnostic(
          account,
          triggerSource,
          triggeredAt,
          eligibility.blockedReason || 'Passive sync is blocked for this account.',
        ));
      }
      return eligibility.eligible;
    });
    const blockedAccounts = googleAccounts.length - syncableAccounts.length;

    let hasError = blockedAccounts > 0;
    for (const account of syncableAccounts) {
      const synced = await syncAccount(account.id, triggerSource);
      if (!synced) {
        hasError = true;
      }
    }

    syncingRef.current = false;
    setSyncState(hasError ? 'error' : 'idle');
    setSyncError(hasError ? 'Some Google Calendar accounts need attention.' : null);
  }, [recordDiagnostic, syncAccount]);

  useEffect(() => {
    if (shouldAutoSync) {
      const timer = window.setTimeout(() => {
        void triggerSync(false);
      }, 0);
      return () => window.clearTimeout(timer);
    }
  }, [googleAccountsSignature, shouldAutoSync, triggerSync]);

  const lastSyncTime = googleAccounts.reduce<string | null>((latest, account) => {
    if (!account.lastSyncTime) return latest;
    if (!latest) return account.lastSyncTime;
    return account.lastSyncTime > latest ? account.lastSyncTime : latest;
  }, null);

  return {
    syncState,
    lastSyncTime,
    syncError,
    triggerSync,
    accountSyncStates,
    diagnostics,
  };
}

export function GoogleSyncProvider({ app, children }: { app: GoogleSyncApp; children: ReactNode }) {
  const value = useGoogleSyncController(app);
  return createElement(GoogleSyncContext.Provider, { value }, children);
}

/** Hook that exposes the long-lived Google Calendar sync controller. */
export function useGoogleSync(): GoogleSyncResult {
  const context = useContext(GoogleSyncContext);
  if (!context) {
    throw new Error('useGoogleSync must be used within GoogleSyncProvider');
  }
  return context;
}

/**
 * Removes duplicate calendar sources that share the same googleCalendarId across accounts.
 * Keeps the source belonging to the earliest account (by calendarAccounts array order).
 * Re-attributes events from removed sources to the surviving source.
 * Exported for testability.
 */
export function cleanupDuplicateSources(app: {
  calendarAccounts: { id: string }[];
  calendarSources: { id: string; accountId: string; googleCalendarId?: string }[];
  calendarEvents: { id: string; sourceId: string }[];
  removeCalendarSource: (id: string) => void;
  updateCalendarEvent: (id: string, updates: { sourceId: string }) => void;
}) {
  const accountOrder = new Map(app.calendarAccounts.map((account, index) => [account.id, index]));
  const byGoogleCalendarId = new Map<string, typeof app.calendarSources>();

  for (const source of app.calendarSources) {
    if (!source.googleCalendarId) continue;
    const group = byGoogleCalendarId.get(source.googleCalendarId) || [];
    group.push(source);
    byGoogleCalendarId.set(source.googleCalendarId, group);
  }

  for (const [, group] of byGoogleCalendarId) {
    if (group.length <= 1) continue;

    group.sort((left, right) => (accountOrder.get(left.accountId) ?? 999) - (accountOrder.get(right.accountId) ?? 999));
    const keeper = group[0];
    const duplicates = group.slice(1);

    for (const duplicate of duplicates) {
      for (const event of app.calendarEvents) {
        if (event.sourceId === duplicate.id) {
          app.updateCalendarEvent(event.id, { sourceId: keeper.id });
        }
      }
      app.removeCalendarSource(duplicate.id);
    }
  }
}

/**
 * Remove duplicate events that share the same googleEventId.
 * Keeps the first occurrence (by insertion order) and removes the rest.
 */
export function cleanupDuplicateEvents(app: {
  calendarEvents: { id: string; googleEventId?: string }[];
  removeCalendarEvent: (id: string) => void;
}) {
  const seen = new Set<string>();
  for (const event of app.calendarEvents) {
    if (!event.googleEventId) continue;
    if (seen.has(event.googleEventId)) {
      app.removeCalendarEvent(event.id);
    } else {
      seen.add(event.googleEventId);
    }
  }
}
