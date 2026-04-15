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
  appendGoogleCalendarDiagnosticEvent,
  type GoogleCalendarBackendReadiness,
} from '../services/googleCalendarDiagnosticEvents';
import {
  GOOGLE_ACCESS_EXPIRED_MESSAGE,
  GOOGLE_ACCESS_REVOKED_MESSAGE,
  GOOGLE_SIGN_IN_REQUIRED_MESSAGE,
  GOOGLE_TEMPORARY_UNAVAILABLE_MESSAGE,
  type GoogleCalendarOwnershipResult,
  type GoogleCalendarRuntimeCredentialState,
  GoogleCalendarReconnectRequiredError,
  getGoogleCalendarAccountPatchForCredentialState,
  getGoogleCalendarOwnershipResult,
  getGoogleCalendarPassiveAccessTokenWithRefresh,
  getGoogleCalendarPassiveSyncEligibility,
  getGoogleCalendarRuntimeCredentialState,
  isGoogleCalendarAccount,
} from '../services/googleCalendarAuthManager';
import {
  bootstrapGoogleCalendarProfileCredential,
  getGoogleCalendarCredentialStatusSnapshot,
  type GoogleCalendarCredentialStatusSnapshot,
  GoogleCalendarOAuthFunctionError,
} from '../services/googleCalendarServerAuth';
import { LIMITS } from '../config/constants';
import {
  getAuthSessionSnapshot,
  isAuthSessionBootstrapped,
} from '../store/supabase';
import { logWarn } from '../services/logger';

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

export interface GoogleCalendarServerRuntimeStatus {
  checkedAt: string;
  requestId?: string;
  readiness: GoogleCalendarBackendReadiness;
  statusCount: number;
  lastError?: string;
  lastErrorCode?: string;
}

export interface GoogleSyncResult {
  syncState: SyncState;
  lastSyncTime: string | null;
  syncError: string | null;
  triggerSync: (manual?: boolean) => Promise<void>;
  accountSyncStates: Record<string, { state: SyncState; lastSync: string | null; error: string | null }>;
  diagnostics: GoogleSyncDiagnostics;
  credentialStatuses: Record<string, GoogleCalendarRuntimeCredentialState>;
  refreshCredentialStatuses: () => Promise<void>;
  serverRuntimeStatus: GoogleCalendarServerRuntimeStatus | null;
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

function defaultServerReadiness(): GoogleCalendarBackendReadiness {
  return {
    functionReachable: true,
    oauthConfigured: true,
    originAllowed: true,
    signedIn: true,
  };
}

function getPhaseForSyncOutcome(outcome: GoogleSyncDiagnosticOutcome): 'success' | 'failure' | 'blocked' {
  switch (outcome) {
    case 'success':
      return 'success';
    case 'blocked':
      return 'blocked';
    case 'error':
      return 'failure';
    default:
      return 'failure';
  }
}

function getTimelineOutcomeForSyncOutcome(outcome: GoogleSyncDiagnosticOutcome) {
  switch (outcome) {
    case 'success':
      return 'success' as const;
    case 'blocked':
      return 'blocked' as const;
    case 'needs_reconnect':
      return 'needs_reconnect' as const;
    case 'revoked':
      return 'revoked' as const;
    case 'ownership_mismatch':
      return 'ownership_mismatch' as const;
    case 'error':
    default:
      return 'failure' as const;
  }
}

function shouldPreserveExplicitFailureState(account: CalendarAccount): boolean {
  if (account.authStatus === 'revoked' || account.authStatus === 'error') {
    return true;
  }

  if (account.lastAuthError === GOOGLE_ACCESS_EXPIRED_MESSAGE || account.lastAuthError === GOOGLE_ACCESS_REVOKED_MESSAGE) {
    return true;
  }

  if (account.lastAuthError?.includes('Reconnect this account explicitly.')) {
    return true;
  }

  return account.syncError === GOOGLE_TEMPORARY_UNAVAILABLE_MESSAGE;
}

function useGoogleSyncController(app: GoogleSyncApp): GoogleSyncResult {
  const [syncState, setSyncState] = useState<SyncState>('idle');
  const [syncError, setSyncError] = useState<string | null>(null);
  const [accountSyncStates, setAccountSyncStates] = useState<Record<string, { state: SyncState; lastSync: string | null; error: string | null }>>({});
  const [diagnostics, setDiagnostics] = useState<GoogleSyncDiagnostics>({ accounts: {} });
  const [credentialStatuses, setCredentialStatuses] = useState<Record<string, GoogleCalendarRuntimeCredentialState>>({});
  const [serverRuntimeStatus, setServerRuntimeStatus] = useState<GoogleCalendarServerRuntimeStatus | null>(null);
  const syncingRef = useRef(false);
  const appRef = useRef(app);

  useEffect(() => {
    appRef.current = app;
  }, [app]);

  const googleAccounts = useMemo(
    () => app.calendarAccounts.filter(isGoogleCalendarAccount),
    [app.calendarAccounts],
  );
  const authSnapshot = getAuthSessionSnapshot();
  const authSessionSignature = [
    authSnapshot?.userId ?? '',
    authSnapshot?.email ?? '',
    authSnapshot?.provider ?? '',
    authSnapshot?.providerRefreshToken ? 'refresh' : 'no-refresh',
    isAuthSessionBootstrapped() ? 'bootstrapped' : 'pending',
  ].join(':');
  // Only include account identity and transport shape here. Status refresh mutates
  // timestamps and error fields, so including them would cause diagnostics loops.
  const googleAccountsSignature = useMemo(
    () => googleAccounts
      .map(account => [
        account.id,
        account.email,
        account.authProvider ?? '',
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
    appendGoogleCalendarDiagnosticEvent({
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
      skippedDestructiveRemovals: entry.skippedDestructiveRemovals,
    });
  }, []);

  const updateAccountIfChanged = useCallback((account: CalendarAccount, updates: Partial<CalendarAccount>) => {
    const hasChange = Object.entries(updates).some(([key, value]) => {
      const typedKey = key as keyof CalendarAccount;
      return account[typedKey] !== value;
    });

    if (hasChange) {
      appRef.current.updateCalendarAccount(account.id, updates);
    }
  }, []);

  const refreshCredentialStatuses = useCallback(async () => {
    const currentApp = appRef.current;
    const accounts = currentApp.calendarAccounts.filter(isGoogleCalendarAccount);
    if (accounts.length === 0) {
      setCredentialStatuses({});
      setServerRuntimeStatus(null);
      return;
    }

    const snapshot = getAuthSessionSnapshot();
    let statusFetchError: string | null = null;
    let statusFetchErrorCode: string | undefined;
    let statusFetchReadiness = snapshot?.userId
      ? defaultServerReadiness()
      : {
          ...defaultServerReadiness(),
          signedIn: false,
        };
    let statusRequestId: string | undefined;
    let statusCheckedAt = new Date().toISOString();
    const statusByEmail = new Map<string, GoogleCalendarCredentialStatusSnapshot['statuses'][number]>();

    appendGoogleCalendarDiagnosticEvent({
      operation: 'server_status_refresh',
      phase: 'start',
      outcome: 'info',
      triggerSource: 'system',
      message: `Refreshing hosted Google Calendar credential status for ${accounts.length} account${accounts.length === 1 ? '' : 's'}.`,
    });

    if (snapshot?.userId) {
      try {
        const statusSnapshot = await getGoogleCalendarCredentialStatusSnapshot(accounts.map(account => account.email));
        statusRequestId = statusSnapshot.requestId;
        statusCheckedAt = statusSnapshot.checkedAt;
        statusFetchReadiness = statusSnapshot.readiness;
        setServerRuntimeStatus({
          checkedAt: statusSnapshot.checkedAt,
          requestId: statusSnapshot.requestId,
          readiness: statusSnapshot.readiness,
          statusCount: statusSnapshot.statuses.length,
        });
        for (const status of statusSnapshot.statuses) {
          statusByEmail.set(status.accountEmail.trim().toLowerCase(), status);
        }
        appendGoogleCalendarDiagnosticEvent({
          operation: 'server_status_refresh',
          phase: 'success',
          outcome: 'success',
          triggerSource: 'system',
          message: `Hosted Google Calendar credential status refresh succeeded for ${statusSnapshot.statuses.length} account${statusSnapshot.statuses.length === 1 ? '' : 's'}.`,
          requestId: statusSnapshot.requestId,
          readiness: statusSnapshot.readiness,
        });
      } catch (error) {
        statusFetchError = error instanceof Error ? error.message : String(error);
        statusFetchErrorCode = error instanceof GoogleCalendarOAuthFunctionError ? error.code : undefined;
        statusFetchReadiness = error instanceof GoogleCalendarOAuthFunctionError
          ? (error.readiness || defaultServerReadiness())
          : {
              ...defaultServerReadiness(),
              functionReachable: false,
            };
        statusRequestId = error instanceof GoogleCalendarOAuthFunctionError ? error.requestId : undefined;
        setServerRuntimeStatus({
          checkedAt: statusCheckedAt,
          requestId: statusRequestId,
          readiness: statusFetchReadiness,
          statusCount: 0,
          lastError: statusFetchError,
          lastErrorCode: statusFetchErrorCode,
        });
        appendGoogleCalendarDiagnosticEvent({
          operation: 'server_status_refresh',
          phase: 'failure',
          outcome: error instanceof GoogleCalendarOAuthFunctionError && error.code === 'sign_in_required'
            ? 'blocked'
            : error instanceof GoogleCalendarOAuthFunctionError && error.code === 'temporary_unavailable'
              ? 'temporary_unavailable'
              : 'failure',
          triggerSource: 'system',
          message: statusFetchError,
          code: statusFetchErrorCode,
          requestId: statusRequestId,
          readiness: statusFetchReadiness,
          httpStatus: error instanceof GoogleCalendarOAuthFunctionError ? error.httpStatus : undefined,
        });
      }
    } else {
      setServerRuntimeStatus({
        checkedAt: statusCheckedAt,
        readiness: statusFetchReadiness,
        statusCount: 0,
        lastError: GOOGLE_SIGN_IN_REQUIRED_MESSAGE,
        lastErrorCode: 'sign_in_required',
      });
      appendGoogleCalendarDiagnosticEvent({
        operation: 'server_status_refresh',
        phase: 'blocked',
        outcome: 'blocked',
        triggerSource: 'system',
        message: GOOGLE_SIGN_IN_REQUIRED_MESSAGE,
        code: 'sign_in_required',
        readiness: statusFetchReadiness,
      });
    }

    const nextStatuses: Record<string, GoogleCalendarRuntimeCredentialState> = {};

    for (const account of accounts) {
      let serverCredential = statusByEmail.get(account.email.trim().toLowerCase());

      if (
        !statusFetchError
        && !serverCredential
        && snapshot?.providerRefreshToken
        && account.email.trim().toLowerCase() === (snapshot.email || '').trim().toLowerCase()
      ) {
        try {
          const bootstrap = await bootstrapGoogleCalendarProfileCredential({
            email: account.email,
            providerRefreshToken: snapshot.providerRefreshToken,
          });
          serverCredential = bootstrap.credential;
          statusByEmail.set(account.email.trim().toLowerCase(), bootstrap.credential);
        } catch (error) {
          if (!(error instanceof GoogleCalendarOAuthFunctionError) || error.code !== 'missing_refresh_token') {
            statusFetchError = error instanceof Error ? error.message : String(error);
            statusFetchErrorCode = error instanceof GoogleCalendarOAuthFunctionError ? error.code : statusFetchErrorCode;
            statusFetchReadiness = error instanceof GoogleCalendarOAuthFunctionError
              ? (error.readiness || statusFetchReadiness)
              : statusFetchReadiness;
          }
        }
      }

      const runtimeState = statusFetchError
        ? {
            ...getGoogleCalendarRuntimeCredentialState(account, { snapshot }),
            credentialHealth: 'temporary_unavailable' as const,
            message: statusFetchError,
          }
          : getGoogleCalendarRuntimeCredentialState(account, {
            serverCredential,
            snapshot,
          });

      nextStatuses[account.id] = runtimeState;

      const credentialPatch = getGoogleCalendarAccountPatchForCredentialState(account, runtimeState, statusCheckedAt);
      const accountPatch = (
        runtimeState.credentialHealth === 'refreshable'
        && shouldPreserveExplicitFailureState(account)
      )
        ? {
            ...credentialPatch,
            authStatus: account.authStatus,
            lastAuthError: account.lastAuthError,
            syncError: account.syncError,
          }
        : credentialPatch;

      updateAccountIfChanged(account, accountPatch);
    }

    setCredentialStatuses(nextStatuses);
  }, [updateAccountIfChanged]);

  useEffect(() => {
    void refreshCredentialStatuses();
  }, [authSessionSignature, googleAccountsSignature, refreshCredentialStatuses]);

  const syncAccount = useCallback(async (accountId: string, triggerSource: GoogleSyncTriggerSource): Promise<boolean> => {
    const currentApp = appRef.current;
    const account = currentApp.calendarAccounts.find(candidate => candidate.id === accountId);
    if (!account) return false;

    appendGoogleCalendarDiagnosticEvent({
      operation: 'sync_account',
      phase: 'start',
      outcome: 'info',
      triggerSource,
      accountId,
      email: account.email,
      resolvedAuthProvider: account.authProvider,
      message: `Starting passive Google Calendar sync for ${account.email}.`,
    });

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
      appendGoogleCalendarDiagnosticEvent({
        operation: 'calendar_list_fetch',
        phase: 'start',
        outcome: 'info',
        triggerSource,
        accountId,
        email: account.email,
        resolvedAuthProvider: token.authProvider,
        message: `Fetching Google calendar list for ${account.email}.`,
      });
      const googleCalendars = await fetchCalendarList(accessToken);
      appendGoogleCalendarDiagnosticEvent({
        operation: 'calendar_list_fetch',
        phase: 'success',
        outcome: 'success',
        triggerSource,
        accountId,
        email: account.email,
        resolvedAuthProvider: token.authProvider,
        message: `Fetched ${googleCalendars.length} Google calendar${googleCalendars.length === 1 ? '' : 's'} for ${account.email}.`,
        calendarCount: googleCalendars.length,
      });
      const ownership = getGoogleCalendarOwnershipResult(account, googleCalendars);
      const checkedAt = new Date().toISOString();

      if (!ownership.matches) {
        const message = ownership.message || GOOGLE_ACCESS_EXPIRED_MESSAGE;
        appendGoogleCalendarDiagnosticEvent({
          operation: 'ownership_check',
          phase: 'failure',
          outcome: 'ownership_mismatch',
          triggerSource,
          accountId,
          email: account.email,
          resolvedAuthProvider: token.authProvider,
          message,
          primaryCalendarEmail: ownership.primaryEmail,
        });
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
        setCredentialStatuses(prev => ({
          ...prev,
          [accountId]: {
            ...(prev[accountId] || getGoogleCalendarRuntimeCredentialState(account, { snapshot: getAuthSessionSnapshot() })),
            credentialHealth: 'needs_reconnect',
            message,
          },
        }));
        recordDiagnostic(createOwnershipMismatchDiagnostic(account, triggerSource, checkedAt, ownership));
        return false;
      }

      appendGoogleCalendarDiagnosticEvent({
        operation: 'ownership_check',
        phase: 'success',
        outcome: 'success',
        triggerSource,
        accountId,
        email: account.email,
        resolvedAuthProvider: token.authProvider,
        message: `Verified Google account ownership for ${account.email}.`,
        primaryCalendarEmail: ownership.primaryEmail,
      });

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
          appendGoogleCalendarDiagnosticEvent({
            operation: 'calendar_event_fetch',
            phase: 'start',
            outcome: 'info',
            triggerSource,
            accountId,
            email: account.email,
            resolvedAuthProvider: token.authProvider,
            calendarId: source.googleCalendarId,
            message: `Fetching Google events for calendar ${source.googleCalendarId}.`,
          });
          const googleEvents = await fetchEvents(accessToken, source.googleCalendarId, timeMin, timeMax);
          appendGoogleCalendarDiagnosticEvent({
            operation: 'calendar_event_fetch',
            phase: 'success',
            outcome: 'success',
            triggerSource,
            accountId,
            email: account.email,
            resolvedAuthProvider: token.authProvider,
            calendarId: source.googleCalendarId,
            message: `Fetched ${googleEvents.length} Google event${googleEvents.length === 1 ? '' : 's'} for calendar ${source.googleCalendarId}.`,
            eventCount: googleEvents.length,
          });
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
          logWarn('GoogleSync', `Failed to sync calendar ${source.name}: ${error instanceof Error ? error.message : String(error)}`);
          appendGoogleCalendarDiagnosticEvent({
            operation: 'calendar_event_fetch',
            phase: 'failure',
            outcome: 'temporary_unavailable',
            triggerSource,
            accountId,
            email: account.email,
            resolvedAuthProvider: token.authProvider,
            calendarId: source.googleCalendarId,
            message: error instanceof Error ? error.message : GOOGLE_TEMPORARY_UNAVAILABLE_MESSAGE,
          });
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
      setCredentialStatuses(prev => ({
        ...prev,
        [accountId]: {
          ...(prev[accountId] || getGoogleCalendarRuntimeCredentialState(account, { snapshot: getAuthSessionSnapshot() })),
          credentialSource: 'server',
          serverCredentialPresent: true,
          credentialHealth: 'refreshable',
          message: undefined,
          currentAccessTokenExpiresAt: token.authExpiresAt,
        },
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

      if (error instanceof GoogleApiError) {
        appendGoogleCalendarDiagnosticEvent({
          operation: 'calendar_list_fetch',
          phase: 'failure',
          outcome: error.isForbidden ? 'revoked' : error.isAuthError ? 'needs_reconnect' : 'temporary_unavailable',
          triggerSource,
          accountId,
          email: account.email,
          resolvedAuthProvider: account.authProvider,
          message: error.message,
          httpStatus: error.status,
        });
      }

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
      setCredentialStatuses(prev => ({
        ...prev,
        [accountId]: {
          ...(prev[accountId] || getGoogleCalendarRuntimeCredentialState(account, { snapshot: getAuthSessionSnapshot() })),
          credentialHealth: outcome === 'revoked' ? 'revoked' : outcome === 'error' ? 'temporary_unavailable' : 'needs_reconnect',
          message,
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

    appendGoogleCalendarDiagnosticEvent({
      operation: 'sync_trigger',
      phase: 'start',
      outcome: 'info',
      triggerSource,
      message: `Starting ${triggerSource} Google Calendar sync for ${googleAccounts.length} account${googleAccounts.length === 1 ? '' : 's'}.`,
    });

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
    appendGoogleCalendarDiagnosticEvent({
      operation: 'sync_trigger',
      phase: hasError ? 'failure' : 'success',
      outcome: hasError ? 'failure' : 'success',
      triggerSource,
      message: hasError
        ? 'Google Calendar sync finished with one or more accounts needing attention.'
        : 'Google Calendar sync finished successfully.',
    });
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
    credentialStatuses,
    refreshCredentialStatuses,
    serverRuntimeStatus,
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
