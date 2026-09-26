import type { CalendarAccount, CalendarAuthStatus } from '../../types/domain';
import type { AuthSessionSnapshot } from '../../store/supabase';
import {
  GoogleApiError,
  googleEventToLocal,
  type GoogleCalendarEvent,
  type GoogleCalendarListEntry,
} from '../googleCalendarApi';
import {
  GOOGLE_ACCESS_EXPIRED_MESSAGE,
  GOOGLE_ACCESS_REVOKED_MESSAGE,
  GOOGLE_SIGN_IN_REQUIRED_MESSAGE,
  GOOGLE_TEMPORARY_UNAVAILABLE_MESSAGE,
  GoogleCalendarReconnectRequiredError,
  getGoogleCalendarOwnershipResult,
  isGoogleCalendarAccount,
  type GoogleCalendarPassiveSyncEligibility,
  type GoogleCalendarRuntimeCredentialState,
} from '../googleCalendarAccountState';
import type { GoogleCalendarPassiveAccessToken } from '../googleCalendarAuthManager';
import {
  GoogleCalendarOAuthFunctionError,
  type GoogleCalendarCredentialStatusSnapshot,
  type GoogleCalendarServerCredentialStatus,
} from '../googleCalendarServerAuth';
import type { GoogleCalendarBackendReadiness } from '../googleCalendarDiagnosticEvents';
import {
  defaultServerReadiness,
  getStatusRefreshFailureOutcome,
  hasAccountChanges,
  isClearingStaleFailure,
  planCredentialAccountPatch,
} from './credentialStatus';
import {
  createBlockedDiagnostic,
  createOwnershipMismatchDiagnostic,
  createSuccessMessage,
  plural,
  toSyncAccountDiagnosticEvent,
  type GoogleCalendarDiagnosticEventInput,
} from './diagnostics';
import { classifyGoogleCalendarSourceOwnership } from './ownership';
import {
  applyCalendarEventUpserts,
  countEventsInSources,
  getGoogleCalendarFetchWindow,
  indexEventsByProviderKey,
  reconcileGoogleCalendarEvents,
  reconcileGoogleCalendarSources,
  removeCalendarEventsById,
} from './reconcile';
import type {
  GoogleCalendarServerRuntimeStatus,
  GoogleSyncAccountDiagnostic,
  GoogleSyncApp,
  GoogleSyncDiagnosticOutcome,
  GoogleSyncTriggerSource,
} from './types';

/**
 * The I/O Google Calendar sync needs, passed in so the workflow can run with
 * fakes in tests. `useGoogleSync` supplies the real implementations.
 */
export interface GoogleCalendarSyncDeps {
  /** The current Calendar data and writer; read at the start of each operation. */
  readApp: () => GoogleSyncApp;
  now: () => Date;
  getAuthSessionSnapshot: () => AuthSessionSnapshot | null;
  getPassiveSyncEligibility: (
    account: CalendarAccount,
    options: { manual?: boolean },
  ) => GoogleCalendarPassiveSyncEligibility;
  getRuntimeCredentialState: (
    account: CalendarAccount,
    options: { serverCredential?: GoogleCalendarServerCredentialStatus; snapshot?: AuthSessionSnapshot | null },
  ) => GoogleCalendarRuntimeCredentialState;
  getCredentialStatusSnapshot: (accountEmails: string[]) => Promise<GoogleCalendarCredentialStatusSnapshot>;
  bootstrapProfileCredential: (options: {
    email: string;
    providerRefreshToken: string | null;
  }) => Promise<{ credential: GoogleCalendarServerCredentialStatus }>;
  getPassiveAccessToken: (account: CalendarAccount) => Promise<GoogleCalendarPassiveAccessToken>;
  fetchCalendarList: (accessToken: string) => Promise<GoogleCalendarListEntry[]>;
  fetchEvents: (
    accessToken: string,
    calendarId: string,
    timeMin: string,
    timeMax: string,
  ) => Promise<GoogleCalendarEvent[]>;
  recordDiagnosticEvent: (event: GoogleCalendarDiagnosticEventInput) => void;
  logWarn: (source: string, message: string) => void;
}

export interface GoogleAccountSyncResult {
  accountId: string;
  synced: boolean;
  /** When the sync succeeded, the time to publish as the account's last sync. */
  syncedAt: string | null;
  /** The user-facing reason the sync failed; never swallowed. */
  error: string | null;
  /** The account's persisted last sync, used when this session has none yet. */
  persistedLastSync: string | null;
  /** Credential state to extend when this session has none for the account yet. */
  baselineCredentialState: GoogleCalendarRuntimeCredentialState;
  credentialPatch: Partial<GoogleCalendarRuntimeCredentialState>;
  diagnostic: GoogleSyncAccountDiagnostic;
}

export interface GoogleSyncRunPlan {
  triggerSource: GoogleSyncTriggerSource;
  triggeredAt: string;
  syncableAccounts: CalendarAccount[];
  blockedDiagnostics: GoogleSyncAccountDiagnostic[];
}

export interface GoogleSyncRunSummary {
  hasError: boolean;
  syncError: string | null;
}

export interface CredentialStatusRefreshResult {
  statuses: Record<string, GoogleCalendarRuntimeCredentialState>;
  serverRuntimeStatus: GoogleCalendarServerRuntimeStatus | null;
}

export interface GoogleCalendarSyncService {
  /** Starts a sync run across Google accounts, or returns null when there are none. */
  beginSyncRun: (manual: boolean) => GoogleSyncRunPlan | null;
  /** Syncs one account; returns null when the account no longer exists. */
  syncAccount: (accountId: string, triggerSource: GoogleSyncTriggerSource) => Promise<GoogleAccountSyncResult | null>;
  finishSyncRun: (triggerSource: GoogleSyncTriggerSource, hasError: boolean) => GoogleSyncRunSummary;
  refreshCredentialStatuses: () => Promise<CredentialStatusRefreshResult>;
}

export const GOOGLE_SYNC_ATTENTION_MESSAGE = 'Some Google Calendar accounts need attention.';

function errorMessage(error: unknown): string {
  return error instanceof Error ? error.message : String(error);
}

export function createGoogleCalendarSyncService(deps: GoogleCalendarSyncDeps): GoogleCalendarSyncService {
  const isoNow = () => deps.now().toISOString();

  function recordAccountDiagnostic(entry: GoogleSyncAccountDiagnostic): GoogleSyncAccountDiagnostic {
    deps.recordDiagnosticEvent(toSyncAccountDiagnosticEvent(entry));
    return entry;
  }

  function baselineCredentialState(account: CalendarAccount): GoogleCalendarRuntimeCredentialState {
    return deps.getRuntimeCredentialState(account, { snapshot: deps.getAuthSessionSnapshot() });
  }

  function beginSyncRun(manual: boolean): GoogleSyncRunPlan | null {
    const googleAccounts = deps.readApp().calendarAccounts.filter(isGoogleCalendarAccount);
    if (googleAccounts.length === 0) return null;

    const triggerSource: GoogleSyncTriggerSource = manual ? 'manual' : 'auto';
    const triggeredAt = isoNow();
    deps.recordDiagnosticEvent({
      operation: 'sync_trigger',
      phase: 'start',
      outcome: 'info',
      triggerSource,
      message: `Starting ${triggerSource} Google Calendar sync for ${googleAccounts.length} ${plural(googleAccounts.length, 'account')}.`,
    });

    const syncableAccounts: CalendarAccount[] = [];
    const blockedDiagnostics: GoogleSyncAccountDiagnostic[] = [];
    for (const account of googleAccounts) {
      const eligibility = deps.getPassiveSyncEligibility(account, { manual });
      if (eligibility.eligible) {
        syncableAccounts.push(account);
      } else {
        blockedDiagnostics.push(recordAccountDiagnostic(createBlockedDiagnostic(
          account,
          triggerSource,
          triggeredAt,
          eligibility.blockedReason || 'Passive sync is blocked for this account.',
        )));
      }
    }

    return { triggerSource, triggeredAt, syncableAccounts, blockedDiagnostics };
  }

  function finishSyncRun(triggerSource: GoogleSyncTriggerSource, hasError: boolean): GoogleSyncRunSummary {
    deps.recordDiagnosticEvent({
      operation: 'sync_trigger',
      phase: hasError ? 'failure' : 'success',
      outcome: hasError ? 'failure' : 'success',
      triggerSource,
      message: hasError
        ? 'Google Calendar sync finished with one or more accounts needing attention.'
        : 'Google Calendar sync finished successfully.',
    });
    return { hasError, syncError: hasError ? GOOGLE_SYNC_ATTENTION_MESSAGE : null };
  }

  async function syncAccount(
    accountId: string,
    triggerSource: GoogleSyncTriggerSource,
  ): Promise<GoogleAccountSyncResult | null> {
    const app = deps.readApp();
    const account = app.calendarAccounts.find(candidate => candidate.id === accountId);
    if (!account) return null;

    const persistedLastSync = account.lastSyncTime || null;
    deps.recordDiagnosticEvent({
      operation: 'sync_account',
      phase: 'start',
      outcome: 'info',
      triggerSource,
      accountId,
      email: account.email,
      resolvedAuthProvider: account.authProvider,
      message: `Starting passive Google Calendar sync for ${account.email}.`,
    });

    try {
      return await mirrorAccount(app, account, triggerSource, persistedLastSync);
    } catch (error) {
      return settleFailedSync(app, account, triggerSource, persistedLastSync, error);
    }
  }

  async function mirrorAccount(
    app: GoogleSyncApp,
    account: CalendarAccount,
    triggerSource: GoogleSyncTriggerSource,
    persistedLastSync: string | null,
  ): Promise<GoogleAccountSyncResult> {
    const accountId = account.id;
    const token = await deps.getPassiveAccessToken(account);
    const accessToken = token.accessToken;
    const accountEvent = {
      triggerSource,
      accountId,
      email: account.email,
      resolvedAuthProvider: token.authProvider,
    } as const;

    deps.recordDiagnosticEvent({
      ...accountEvent,
      operation: 'calendar_list_fetch',
      phase: 'start',
      outcome: 'info',
      message: `Fetching Google calendar list for ${account.email}.`,
    });
    const googleCalendars = await deps.fetchCalendarList(accessToken);
    deps.recordDiagnosticEvent({
      ...accountEvent,
      operation: 'calendar_list_fetch',
      phase: 'success',
      outcome: 'success',
      message: `Fetched ${googleCalendars.length} Google ${plural(googleCalendars.length, 'calendar')} for ${account.email}.`,
      calendarCount: googleCalendars.length,
    });

    const ownership = getGoogleCalendarOwnershipResult(account, googleCalendars);
    const checkedAt = isoNow();

    if (!ownership.matches) {
      const message = ownership.message || GOOGLE_ACCESS_EXPIRED_MESSAGE;
      deps.recordDiagnosticEvent({
        ...accountEvent,
        operation: 'ownership_check',
        phase: 'failure',
        outcome: 'ownership_mismatch',
        message,
        primaryCalendarEmail: ownership.primaryEmail,
      });
      app.updateCalendarAccount(accountId, {
        authProvider: token.authProvider,
        authStatus: 'needs_reconnect',
        authEmail: account.email,
        lastAuthCheckAt: checkedAt,
        lastAuthError: message,
        syncError: undefined,
      });
      return {
        accountId,
        synced: false,
        syncedAt: null,
        error: message,
        persistedLastSync,
        baselineCredentialState: baselineCredentialState(account),
        credentialPatch: { credentialHealth: 'needs_reconnect', message },
        diagnostic: recordAccountDiagnostic(createOwnershipMismatchDiagnostic(account, triggerSource, checkedAt, ownership)),
      };
    }

    deps.recordDiagnosticEvent({
      ...accountEvent,
      operation: 'ownership_check',
      phase: 'success',
      outcome: 'success',
      message: `Verified Google account ownership for ${account.email}.`,
      primaryCalendarEmail: ownership.primaryEmail,
    });

    const sourceOwnership = classifyGoogleCalendarSourceOwnership({
      accountId,
      accounts: app.calendarAccounts,
      sources: app.calendarSources,
    });
    const sources = reconcileGoogleCalendarSources({ accountId, ownership: sourceOwnership, googleCalendars });
    const { syncableSources, staleSources } = sources;

    if (sources.sourcesToUpsert.length > 0) {
      app.bulkUpsertCalendarSources(sources.sourcesToUpsert);
      const adopted = sources.adoptedSourceCount;
      deps.recordDiagnosticEvent({
        ...accountEvent,
        operation: 'calendar_list_fetch',
        phase: 'info',
        outcome: 'info',
        message: `Prepared ${syncableSources.length} local Google calendar ${plural(syncableSources.length, 'source')} for event sync${adopted > 0 ? ` and adopted ${adopted} ${plural(adopted, 'source')} from inactive account rows` : ''}.`,
        calendarCount: syncableSources.length,
      });
    }

    const preservedSourceCount = sources.preservedSources.length;
    const preservedSourceIds = new Set(sources.preservedSources.map(source => source.id));
    const staleSourceIds = new Set(staleSources.map(source => source.id));
    const window = getGoogleCalendarFetchWindow(deps.now());

    let providerIndex = indexEventsByProviderKey(app.calendarEvents);
    let projectedEvents = [...app.calendarEvents];
    let fetchedEventCount = 0;
    let upsertedEventCount = 0;
    let relinkedEventCount = 0;
    let preservedEventCount = countEventsInSources(projectedEvents, preservedSourceIds);
    const staleSourceEventCount = countEventsInSources(projectedEvents, staleSourceIds);
    const eventIdsToRemoveAfterSuccessfulFetch: string[] = [];
    let skippedDestructiveCleanupReason: string | null = null;

    if (googleCalendars.length > 0 && syncableSources.length === 0) {
      const skipped = sources.skippedActiveForeignSourceCount;
      deps.recordDiagnosticEvent({
        ...accountEvent,
        operation: 'calendar_event_fetch',
        phase: 'blocked',
        outcome: 'blocked',
        message: `No local Google calendar sources were available for event fetch after source reconciliation; ${skipped} ${plural(skipped, 'calendar was', 'calendars were')} already owned by another active account.`,
        calendarCount: googleCalendars.length,
      });
    }

    for (const source of syncableSources) {
      try {
        deps.recordDiagnosticEvent({
          ...accountEvent,
          operation: 'calendar_event_fetch',
          phase: 'start',
          outcome: 'info',
          calendarId: source.googleCalendarId,
          message: `Fetching Google events for calendar ${source.googleCalendarId}.`,
        });
        const googleEvents = await deps.fetchEvents(accessToken, source.googleCalendarId, window.timeMin, window.timeMax);
        deps.recordDiagnosticEvent({
          ...accountEvent,
          operation: 'calendar_event_fetch',
          phase: 'success',
          outcome: 'success',
          calendarId: source.googleCalendarId,
          message: `Fetched ${googleEvents.length} Google ${plural(googleEvents.length, 'event')} for calendar ${source.googleCalendarId}.`,
          eventCount: googleEvents.length,
        });
        fetchedEventCount += googleEvents.length;

        const events = reconcileGoogleCalendarEvents({
          source,
          fetchedEvents: googleEvents.map(event => googleEventToLocal(event, source.id, source.googleCalendarId)),
          cachedEvents: projectedEvents,
          providerIndex,
          window,
        });
        providerIndex = events.providerIndex;
        preservedEventCount += events.preservedEventCount;
        relinkedEventCount += events.relinkedEventCount;

        if (events.eventsToUpsert.length > 0) {
          app.bulkUpsertCalendarEvents(events.eventsToUpsert);
          projectedEvents = applyCalendarEventUpserts(projectedEvents, events.eventsToUpsert);
          upsertedEventCount += events.eventsToUpsert.length;
        }
        eventIdsToRemoveAfterSuccessfulFetch.push(...events.eventIdsToRemove);
      } catch (error) {
        if (error instanceof GoogleApiError && (error.isAuthError || error.isForbidden)) {
          throw error;
        }
        const message = errorMessage(error);
        skippedDestructiveCleanupReason = `Could not refresh every Google calendar. Stale cache cleanup was skipped so existing calendar data stays intact. ${message}`;
        deps.logWarn('GoogleSync', `Failed to sync calendar ${source.name}: ${message}`);
        deps.recordDiagnosticEvent({
          ...accountEvent,
          operation: 'calendar_event_fetch',
          phase: 'failure',
          outcome: 'temporary_unavailable',
          calendarId: source.googleCalendarId,
          message: message || GOOGLE_TEMPORARY_UNAVAILABLE_MESSAGE,
        });
      }
    }

    // A partial fetch must not delete anything: stale data is safer than lost data.
    if (skippedDestructiveCleanupReason) {
      throw new Error(skippedDestructiveCleanupReason);
    }

    for (const source of staleSources) {
      app.removeCalendarSource(source.id);
    }
    const removedSourceCount = staleSources.length;
    let removedEventCount = staleSourceEventCount;
    if (staleSourceIds.size > 0) {
      projectedEvents = projectedEvents.filter(event => !staleSourceIds.has(event.sourceId));
    }
    if (eventIdsToRemoveAfterSuccessfulFetch.length > 0) {
      app.bulkRemoveCalendarEvents(eventIdsToRemoveAfterSuccessfulFetch);
      projectedEvents = removeCalendarEventsById(projectedEvents, eventIdsToRemoveAfterSuccessfulFetch);
      removedEventCount += eventIdsToRemoveAfterSuccessfulFetch.length;
    }

    const syncableSourceIds = new Set(syncableSources.map(source => source.id));
    const visibleSyncableSourceIds = new Set(syncableSources.filter(source => source.visible).map(source => source.id));
    const counts = {
      fetchedEventCount,
      upsertedEventCount,
      relinkedEventCount,
      cachedEventCount: countEventsInSources(projectedEvents, syncableSourceIds),
      visibleCachedEventCount: countEventsInSources(projectedEvents, visibleSyncableSourceIds),
      preservedSourceCount,
      preservedEventCount,
      removedSourceCount,
      removedEventCount,
    };

    const syncedAt = isoNow();
    app.updateCalendarAccount(accountId, {
      authProvider: token.authProvider,
      authStatus: 'connected',
      authEmail: account.email,
      authExpiresAt: token.authExpiresAt,
      lastAuthCheckAt: syncedAt,
      lastAuthError: undefined,
      lastSyncTime: syncedAt,
      syncError: undefined,
    });

    return {
      accountId,
      synced: true,
      syncedAt,
      error: null,
      persistedLastSync,
      baselineCredentialState: baselineCredentialState(account),
      credentialPatch: {
        credentialSource: 'server',
        serverCredentialPresent: true,
        credentialHealth: 'refreshable',
        message: undefined,
        currentAccessTokenExpiresAt: token.authExpiresAt,
      },
      diagnostic: recordAccountDiagnostic({
        accountId,
        email: account.email,
        checkedAt: syncedAt,
        triggerSource,
        outcome: 'success',
        message: createSuccessMessage(counts),
        primaryCalendarEmail: ownership.primaryEmail,
        ...counts,
        skippedDestructiveRemovals: preservedSourceCount > 0 || preservedEventCount > 0,
      }),
    };
  }

  function settleFailedSync(
    app: GoogleSyncApp,
    account: CalendarAccount,
    triggerSource: GoogleSyncTriggerSource,
    persistedLastSync: string | null,
    error: unknown,
  ): GoogleAccountSyncResult {
    const accountId = account.id;
    const checkedAt = isoNow();
    let message = GOOGLE_TEMPORARY_UNAVAILABLE_MESSAGE;
    let authStatus: CalendarAuthStatus = account.authStatus ?? 'error';
    let outcome: GoogleSyncDiagnosticOutcome = 'error';

    if (error instanceof GoogleApiError) {
      deps.recordDiagnosticEvent({
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
      app.updateCalendarAccount(accountId, {
        authProvider: error.authProvider,
        authStatus,
        authEmail: account.email,
        lastAuthCheckAt: checkedAt,
        lastAuthError: message,
        syncError: undefined,
      });
    } else if (error instanceof GoogleApiError && error.isForbidden) {
      message = GOOGLE_ACCESS_REVOKED_MESSAGE;
      authStatus = 'revoked';
      outcome = 'revoked';
      app.updateCalendarAccount(accountId, {
        authStatus,
        authEmail: account.email,
        lastAuthCheckAt: checkedAt,
        lastAuthError: message,
        syncError: undefined,
      });
    } else if (error instanceof GoogleApiError && error.isAuthError) {
      message = GOOGLE_ACCESS_EXPIRED_MESSAGE;
      authStatus = 'needs_reconnect';
      outcome = 'needs_reconnect';
      app.updateCalendarAccount(accountId, {
        authStatus,
        authEmail: account.email,
        lastAuthCheckAt: checkedAt,
        lastAuthError: message,
        syncError: undefined,
      });
    } else {
      if (error instanceof Error && !(error instanceof GoogleApiError)) {
        message = error.message;
      }
      authStatus = 'error';
      app.updateCalendarAccount(accountId, {
        authStatus,
        authEmail: account.email,
        lastAuthCheckAt: checkedAt,
        syncError: message,
      });
    }

    return {
      accountId,
      synced: false,
      syncedAt: null,
      error: message,
      persistedLastSync,
      baselineCredentialState: baselineCredentialState(account),
      credentialPatch: {
        credentialHealth: outcome === 'revoked' ? 'revoked' : outcome === 'error' ? 'temporary_unavailable' : 'needs_reconnect',
        message,
      },
      diagnostic: recordAccountDiagnostic({
        accountId,
        email: account.email,
        checkedAt,
        triggerSource,
        outcome,
        message,
      }),
    };
  }

  async function refreshCredentialStatuses(): Promise<CredentialStatusRefreshResult> {
    const accounts = deps.readApp().calendarAccounts.filter(isGoogleCalendarAccount);
    if (accounts.length === 0) {
      return { statuses: {}, serverRuntimeStatus: null };
    }

    const snapshot = deps.getAuthSessionSnapshot();
    let statusFetchError: string | null = null;
    let statusFetchErrorCode: string | undefined;
    let statusFetchReadiness: GoogleCalendarBackendReadiness = snapshot?.userId
      ? defaultServerReadiness()
      : { ...defaultServerReadiness(), signedIn: false };
    let statusCheckedAt = isoNow();
    let serverRuntimeStatus: GoogleCalendarServerRuntimeStatus;
    const statusByEmail = new Map<string, GoogleCalendarServerCredentialStatus>();
    const emailKey = (email: string) => email.trim().toLowerCase();

    deps.recordDiagnosticEvent({
      operation: 'server_status_refresh',
      phase: 'start',
      outcome: 'info',
      triggerSource: 'system',
      message: `Refreshing hosted Google Calendar credential status for ${accounts.length} ${plural(accounts.length, 'account')}.`,
    });

    if (snapshot?.userId) {
      try {
        const statusSnapshot = await deps.getCredentialStatusSnapshot(accounts.map(account => account.email));
        statusCheckedAt = statusSnapshot.checkedAt;
        statusFetchReadiness = statusSnapshot.readiness;
        serverRuntimeStatus = {
          checkedAt: statusSnapshot.checkedAt,
          requestId: statusSnapshot.requestId,
          readiness: statusSnapshot.readiness,
          statusCount: statusSnapshot.statuses.length,
        };
        for (const status of statusSnapshot.statuses) {
          statusByEmail.set(emailKey(status.accountEmail), status);
        }
        deps.recordDiagnosticEvent({
          operation: 'server_status_refresh',
          phase: 'success',
          outcome: 'success',
          triggerSource: 'system',
          message: `Hosted Google Calendar credential status refresh succeeded for ${statusSnapshot.statuses.length} ${plural(statusSnapshot.statuses.length, 'account')}.`,
          requestId: statusSnapshot.requestId,
          readiness: statusSnapshot.readiness,
        });
      } catch (error) {
        const functionError = error instanceof GoogleCalendarOAuthFunctionError ? error : null;
        statusFetchError = errorMessage(error);
        statusFetchErrorCode = functionError?.code;
        statusFetchReadiness = functionError
          ? (functionError.readiness || defaultServerReadiness())
          : { ...defaultServerReadiness(), functionReachable: false };
        serverRuntimeStatus = {
          checkedAt: statusCheckedAt,
          requestId: functionError?.requestId,
          readiness: statusFetchReadiness,
          statusCount: 0,
          lastError: statusFetchError,
          lastErrorCode: statusFetchErrorCode,
        };
        deps.recordDiagnosticEvent({
          operation: 'server_status_refresh',
          phase: 'failure',
          outcome: getStatusRefreshFailureOutcome(error),
          triggerSource: 'system',
          message: statusFetchError,
          code: statusFetchErrorCode,
          requestId: functionError?.requestId,
          readiness: statusFetchReadiness,
          httpStatus: functionError?.httpStatus,
        });
      }
    } else {
      serverRuntimeStatus = {
        checkedAt: statusCheckedAt,
        readiness: statusFetchReadiness,
        statusCount: 0,
        lastError: GOOGLE_SIGN_IN_REQUIRED_MESSAGE,
        lastErrorCode: 'sign_in_required',
      };
      deps.recordDiagnosticEvent({
        operation: 'server_status_refresh',
        phase: 'blocked',
        outcome: 'blocked',
        triggerSource: 'system',
        message: GOOGLE_SIGN_IN_REQUIRED_MESSAGE,
        code: 'sign_in_required',
        readiness: statusFetchReadiness,
      });
    }

    const statuses: Record<string, GoogleCalendarRuntimeCredentialState> = {};

    for (const account of accounts) {
      let serverCredential = statusByEmail.get(emailKey(account.email));

      // The signed-in profile account can mint its hosted credential from the
      // session's Google refresh token the first time it is seen.
      if (
        !statusFetchError
        && !serverCredential
        && snapshot?.providerRefreshToken
        && emailKey(account.email) === emailKey(snapshot.email || '')
      ) {
        try {
          const bootstrap = await deps.bootstrapProfileCredential({
            email: account.email,
            providerRefreshToken: snapshot.providerRefreshToken,
          });
          serverCredential = bootstrap.credential;
          statusByEmail.set(emailKey(account.email), bootstrap.credential);
        } catch (error) {
          if (!(error instanceof GoogleCalendarOAuthFunctionError) || error.code !== 'missing_refresh_token') {
            statusFetchError = errorMessage(error);
            statusFetchErrorCode = error instanceof GoogleCalendarOAuthFunctionError ? error.code : statusFetchErrorCode;
            statusFetchReadiness = error instanceof GoogleCalendarOAuthFunctionError
              ? (error.readiness || statusFetchReadiness)
              : statusFetchReadiness;
          }
        }
      }

      const runtimeState: GoogleCalendarRuntimeCredentialState = statusFetchError
        ? {
            ...deps.getRuntimeCredentialState(account, { snapshot }),
            credentialHealth: 'temporary_unavailable',
            message: statusFetchError,
          }
        : deps.getRuntimeCredentialState(account, { serverCredential, snapshot });

      statuses[account.id] = runtimeState;

      const accountPatch = planCredentialAccountPatch(account, runtimeState, statusCheckedAt);
      if (isClearingStaleFailure(account, runtimeState, accountPatch)) {
        deps.recordDiagnosticEvent({
          operation: 'credential_status',
          phase: 'success',
          outcome: 'success',
          triggerSource: 'system',
          accountId: account.id,
          email: account.email,
          resolvedAuthProvider: runtimeState.resolvedAuthProvider,
          credentialSource: runtimeState.credentialSource,
          message: `Hosted Google Calendar credential for ${account.email} is refreshable; clearing stale ${account.authStatus} status.`,
        });
      }

      if (hasAccountChanges(account, accountPatch)) {
        deps.readApp().updateCalendarAccount(account.id, accountPatch);
      }
    }

    return { statuses, serverRuntimeStatus };
  }

  return { beginSyncRun, syncAccount, finishSyncRun, refreshCredentialStatuses };
}
