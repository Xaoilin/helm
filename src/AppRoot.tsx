import { useEffect, useState, useSyncExternalStore, type ReactNode } from 'react';
import App from './App';
import { useReleaseRefresh } from './hooks/useReleaseRefresh';
import { getSupabaseRealtimeSnapshot, subscribeSupabaseRealtimeSnapshot } from './store/supabase';
import { AppProviders } from './store/AppProviders';
import { getInitialShellSurface } from './store/ShellContext';
import { getPageCollections } from './store/pageCollections';
import { AuthSessionProvider, useAuthSession } from './store/AuthSessionContext';
import { SyncAvailabilityProvider } from './store/SyncAvailabilityContext';
import {
  bootstrapDatabasePersistence,
  getSyncSessionSnapshot,
  refreshDatabasePersistence,
  resetDatabasePersistence,
  subscribeSyncSession,
  type SyncSessionSnapshot,
} from './store/persistence';

export function BootstrappedApp({ children }: { children?: ReactNode }) {
  const auth = useAuthSession();
  const [syncSession, setSyncSession] = useState(() => getSyncSessionSnapshot());
  const [actionError, setActionError] = useState<string | null>(null);
  const [retrying, setRetrying] = useState(false);

  // A failed account bootstrap must not prevent an available release updating.
  // The hook keeps the same pending-write, editor, and visibility guards.
  useReleaseRefresh();

  useEffect(() => subscribeSyncSession(setSyncSession), []);

  useEffect(() => {
    if (!auth.supabaseReady || !auth.authUser) {
      resetDatabasePersistence(auth.supabaseReady
        ? 'Sign in to load Sabah One data.'
        : 'Sabah One database configuration is unavailable.', auth.supabaseReady ? 'signed_out' : 'configuration');
      return;
    }
    void bootstrapDatabasePersistence(getPageCollections(getInitialShellSurface())).catch(() => {
      // The persistence session exposes the actionable failure state.
    });
  }, [auth.authUser, auth.sessionKey, auth.supabaseReady]);

  useEffect(() => {
    function reloadAppData() {
      void refreshDatabasePersistence();
    }

    window.addEventListener('helm:app-data-refresh', reloadAppData);
    return () => {
      window.removeEventListener('helm:app-data-refresh', reloadAppData);
    };
  }, []);

  if (!auth.bootstrapped) {
    return (
      <OnlineGate eyebrow="SABAH ONE" title="Loading your account" detail="Checking your secure Sabah One session..." />
    );
  }

  if (!auth.supabaseReady) {
    return (
      <OnlineGate
        eyebrow="Database required"
        title="Sabah One cannot open account data"
        detail="This build is missing its Supabase project configuration. Shared data is never opened from a device fallback."
      />
    );
  }

  if (!auth.authUser) {
    return (
      <OnlineGate
        eyebrow="Your Sabah One account"
        title="Sign in to continue"
        detail="Sabah One stores shared data in your signed-in database account. Offline and anonymous data changes are not supported."
        actionLabel="Continue with Google"
        onAction={async () => {
          setActionError(null);
          try {
            await auth.signInWithGoogle();
          } catch {
            setActionError('Sign-in could not start. Check your connection and try again.');
          }
        }}
        error={actionError}
      />
    );
  }

  const fatalSyncReason = syncSession.reason === 'incompatible_schema'
    || syncSession.reason === 'client_update_required';
  const currentAccountUsable = syncSession.hasUsableSnapshot
    && syncSession.userId === auth.authUser.id
    && !fatalSyncReason;
  if (!currentAccountUsable) {
    const offline = typeof navigator !== 'undefined' && navigator.onLine === false;
    const switchingAccount = syncSession.userId !== auth.authUser.id;
    const canRetry = !switchingAccount && !fatalSyncReason
      && (syncSession.reason === 'database_unavailable' || syncSession.reason === 'offline');
    return (
      <OnlineGate
        eyebrow={offline ? 'Connection required' : 'Database source of truth'}
        title={syncSession.reason === 'signed_out' ? 'Sign in again to continue' : switchingAccount ? 'Loading Sabah One' : fatalSyncReason ? 'Sabah One needs an update' : 'Connecting to Sabah One'}
        detail={blockingSyncDetail(syncSession, switchingAccount, offline)}
        actionLabel={canRetry ? retrying ? 'Retrying...' : 'Retry connection' : undefined}
        actionDisabled={retrying}
        onAction={async () => {
          setRetrying(true);
          setActionError(null);
          try {
            await refreshDatabasePersistence();
          } catch (error) {
            setActionError(error instanceof Error ? error.message : String(error));
          } finally {
            setRetrying(false);
          }
        }}
        secondaryActionLabel="Sign out"
        onSecondaryAction={() => auth.signOut()}
        error={actionError || (canRetry ? syncSession.error : null)}
      />
    );
  }

  return (
    <SyncAvailabilityProvider readOnly={syncSession.readOnly} reason={syncSession.reason}>
      <AppProviders key={auth.authUser.id}>
        <div className="account-workspace">
          <SyncStatusBanner syncSession={syncSession} />
          {children ?? <App />}
        </div>
      </AppProviders>
    </SyncAvailabilityProvider>
  );
}

function blockingSyncDetail(
  syncSession: SyncSessionSnapshot,
  switchingAccount: boolean,
  offline: boolean,
): string {
  if (syncSession.reason === 'signed_out') return syncSession.error || 'Your account authorization is no longer valid. Sign out and sign in again.';
  if (switchingAccount) return 'Clearing the previous account and securely loading this account...';
  if (syncSession.reason === 'incompatible_schema') {
    return 'This build cannot safely open the current Sabah One database schema.';
  }
  if (syncSession.reason === 'client_update_required') {
    return 'Install the latest Sabah One release to open this account safely.';
  }
  if (offline) return 'Reconnect to the internet, then use Retry connection to load your account.';
  if (syncSession.reason === 'database_unavailable') {
    return 'Your account could not be loaded. Automatic retries are limited. Use Retry connection to try again.';
  }
  return 'Loading your account from the database.';
}

function SyncStatusBanner({ syncSession }: { syncSession: SyncSessionSnapshot }) {
  const realtimeState = useSyncExternalStore(subscribeSupabaseRealtimeSnapshot, () => getSupabaseRealtimeSnapshot().state);
  const [retrying, setRetrying] = useState(false);
  const [retryError, setRetryError] = useState<string | null>(null);
  const liveUpdatesDelayed = realtimeState !== 'subscribed';
  if (!syncSession.hasUsableSnapshot || (!syncSession.readOnly && !liveUpdatesDelayed)) return null;
  const offline = syncSession.reason === 'offline';
  const label = !syncSession.readOnly ? 'Live updates delayed' : offline ? 'Offline' : 'Read-only';
  const detail = !syncSession.readOnly
    ? 'Your saved data remains available. Checking for changes automatically.'
    : offline
    ? 'Showing your last confirmed data. Sabah One will reconnect automatically.'
    : 'Showing your last confirmed data while Sabah One reconnects.';
  return (
    <div
      className="sync-status-banner"
      role="status"
      aria-label={`${label}. ${detail}`}
      data-testid="sync-status-banner"
    >
      <strong>{label}</strong>
      <span>{detail}</span>
      {syncSession.readOnly && (
        <button type="button" className="btn btn-secondary btn-sm" disabled={retrying} onClick={() => {
          setRetrying(true);
          setRetryError(null);
          void refreshDatabasePersistence().catch(error => {
            setRetryError(error instanceof Error ? error.message : String(error));
          }).finally(() => setRetrying(false));
        }}>{retrying ? 'Retrying...' : 'Retry connection'}</button>
      )}
      {retryError && <span role="alert">{retryError}</span>}
    </div>
  );
}

interface OnlineGateProps {
  eyebrow: string;
  title: string;
  detail: string;
  actionLabel?: string;
  actionDisabled?: boolean;
  onAction?: () => Promise<void> | void;
  secondaryActionLabel?: string;
  onSecondaryAction?: () => Promise<void> | void;
  error?: string | null;
}

function OnlineGate({
  eyebrow,
  title,
  detail,
  actionLabel,
  actionDisabled,
  onAction,
  secondaryActionLabel,
  onSecondaryAction,
  error,
}: OnlineGateProps) {
  return (
    <main className="online-gate">
      <section className="online-gate-card" aria-live="polite">
        <div className="online-gate-mark" aria-hidden="true">S1</div>
        <div className="online-gate-eyebrow">{eyebrow}</div>
        <h1>{title}</h1>
        <p>{detail}</p>
        {error && <div className="online-gate-error" role="alert">{error}</div>}
        {(actionLabel || secondaryActionLabel) && (
          <div className="online-gate-actions">
            {actionLabel && onAction && (
              <button className="btn btn-primary" type="button" disabled={actionDisabled} onClick={() => void onAction()}>{actionLabel}</button>
            )}
            {secondaryActionLabel && onSecondaryAction && (
              <button className="btn btn-secondary" type="button" onClick={() => void onSecondaryAction()}>{secondaryActionLabel}</button>
            )}
          </div>
        )}
      </section>
    </main>
  );
}

export default function AppRoot() {
  return (
    <AuthSessionProvider>
      <BootstrappedApp />
    </AuthSessionProvider>
  );
}
