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
import { fetchCalendarList, fetchEvents } from '../services/googleCalendarApi';
import { appendGoogleCalendarDiagnosticEvent } from '../services/googleCalendarDiagnosticEvents';
import {
  type GoogleCalendarRuntimeCredentialState,
  getGoogleCalendarPassiveAccessTokenWithRefresh,
  getGoogleCalendarPassiveSyncEligibility,
  getGoogleCalendarRuntimeCredentialState,
  isGoogleCalendarAccount,
} from '../services/googleCalendarAuthManager';
import {
  bootstrapGoogleCalendarProfileCredential,
  getGoogleCalendarCredentialStatusSnapshot,
} from '../services/googleCalendarServerAuth';
import {
  getAuthSessionSnapshot,
  isAuthSessionBootstrapped,
} from '../store/supabase';
import { CALENDAR_SYNC_REQUEST_EVENT } from '../store/persistence';
import { logWarn } from '../services/logger';
import {
  createGoogleCalendarSyncService,
  type GoogleCalendarSyncDeps,
} from '../services/googleCalendarSync/service';
import {
  getLatestAccountSyncTime,
  markAccountSyncing,
  mergeAccountCredentialStatus,
  rememberAccountDiagnostic,
  rememberSyncTrigger,
  settleAccountSyncState,
  type AccountSyncStates,
  type CredentialStatuses,
} from '../services/googleCalendarSync/syncState';
import type {
  GoogleCalendarServerRuntimeStatus,
  GoogleSyncApp,
  GoogleSyncDiagnostics,
  GoogleSyncTriggerSource,
  SyncState,
} from '../services/googleCalendarSync/types';

export type {
  GoogleCalendarServerRuntimeStatus,
  GoogleSyncAccountDiagnostic,
  GoogleSyncApp,
  GoogleSyncDiagnosticOutcome,
  GoogleSyncDiagnostics,
  GoogleSyncTriggerSource,
  SyncState,
} from '../services/googleCalendarSync/types';
export { cleanupDuplicateEvents, cleanupDuplicateSources } from '../services/googleCalendarSync/duplicates';

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

const GoogleSyncContext = createContext<GoogleSyncResult | null>(null);

/** The live browser, Supabase and Google implementations the sync service runs on. */
function createBrowserSyncDeps(readApp: () => GoogleSyncApp): GoogleCalendarSyncDeps {
  return {
    readApp,
    now: () => new Date(),
    getAuthSessionSnapshot,
    getPassiveSyncEligibility: getGoogleCalendarPassiveSyncEligibility,
    getRuntimeCredentialState: getGoogleCalendarRuntimeCredentialState,
    getCredentialStatusSnapshot: getGoogleCalendarCredentialStatusSnapshot,
    bootstrapProfileCredential: bootstrapGoogleCalendarProfileCredential,
    getPassiveAccessToken: account => getGoogleCalendarPassiveAccessTokenWithRefresh(account, ''),
    fetchCalendarList,
    fetchEvents,
    recordDiagnosticEvent: event => {
      appendGoogleCalendarDiagnosticEvent(event);
    },
    logWarn,
  };
}

function useGoogleSyncController(app: GoogleSyncApp): GoogleSyncResult {
  const [syncState, setSyncState] = useState<SyncState>('idle');
  const [syncError, setSyncError] = useState<string | null>(null);
  const [accountSyncStates, setAccountSyncStates] = useState<AccountSyncStates>({});
  const [diagnostics, setDiagnostics] = useState<GoogleSyncDiagnostics>({ accounts: {} });
  const [credentialStatuses, setCredentialStatuses] = useState<CredentialStatuses>({});
  const [serverRuntimeStatus, setServerRuntimeStatus] = useState<GoogleCalendarServerRuntimeStatus | null>(null);
  const syncingRef = useRef(false);
  const appRef = useRef(app);

  useEffect(() => {
    appRef.current = app;
  }, [app]);

  // The service is stateless, so it is built per operation (outside render) and
  // reads the latest Calendar data through the ref when it runs.
  const getService = useCallback(
    () => createGoogleCalendarSyncService(createBrowserSyncDeps(() => appRef.current)),
    [],
  );

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

  const refreshCredentialStatuses = useCallback(async () => {
    const result = await getService().refreshCredentialStatuses();
    setServerRuntimeStatus(result.serverRuntimeStatus);
    setCredentialStatuses(result.statuses);
  }, [getService]);

  useEffect(() => {
    void refreshCredentialStatuses();
  }, [authSessionSignature, googleAccountsSignature, refreshCredentialStatuses]);

  const syncAccount = useCallback(async (accountId: string, triggerSource: GoogleSyncTriggerSource): Promise<boolean> => {
    const account = appRef.current.calendarAccounts.find(candidate => candidate.id === accountId);
    if (!account) return false;

    setAccountSyncStates(prev => markAccountSyncing(prev, account));
    const result = await getService().syncAccount(accountId, triggerSource);
    if (!result) return false;

    setAccountSyncStates(prev => settleAccountSyncState(prev, result));
    setCredentialStatuses(prev => mergeAccountCredentialStatus(prev, result));
    setDiagnostics(prev => rememberAccountDiagnostic(prev, result.diagnostic));
    return result.synced;
  }, [getService]);

  const triggerSync = useCallback(async (manual = false) => {
    if (syncingRef.current) return;
    const service = getService();
    const run = service.beginSyncRun(manual);
    if (!run) return;

    syncingRef.current = true;
    setSyncState('syncing');
    setSyncError(null);
    setDiagnostics(prev => run.blockedDiagnostics.reduce(
      rememberAccountDiagnostic,
      rememberSyncTrigger(prev, run.triggerSource, run.triggeredAt),
    ));

    let hasError = run.blockedDiagnostics.length > 0;
    for (const account of run.syncableAccounts) {
      const synced = await syncAccount(account.id, run.triggerSource);
      if (!synced) {
        hasError = true;
      }
    }

    syncingRef.current = false;
    const summary = service.finishSyncRun(run.triggerSource, hasError);
    setSyncState(summary.hasError ? 'error' : 'idle');
    setSyncError(summary.syncError);
  }, [getService, syncAccount]);

  useEffect(() => {
    if (shouldAutoSync) {
      const timer = window.setTimeout(() => {
        void triggerSync(false);
      }, 0);
      return () => window.clearTimeout(timer);
    }
  }, [googleAccountsSignature, shouldAutoSync, triggerSync]);

  useEffect(() => {
    const handleCalendarSyncRequest = () => {
      void triggerSync(false);
    };

    window.addEventListener(CALENDAR_SYNC_REQUEST_EVENT, handleCalendarSyncRequest);
    return () => {
      window.removeEventListener(CALENDAR_SYNC_REQUEST_EVENT, handleCalendarSyncRequest);
    };
  }, [triggerSync]);

  return {
    syncState,
    lastSyncTime: getLatestAccountSyncTime(googleAccounts),
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
