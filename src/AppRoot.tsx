import { useEffect, useState, type ReactNode } from 'react';
import App from './App';
import { AppProvider } from './store/AppContext';
import { AuthSessionProvider, useAuthSession } from './store/AuthSessionContext';
import {
  bootstrapDatabasePersistence,
  getPersistenceHealthSnapshot,
  getSyncSessionSnapshot,
  refreshDatabasePersistence,
  resetDatabasePersistence,
  subscribeStoreChanges,
  subscribeSyncSession,
} from './store/persistence';

export function BootstrappedApp({ children }: { children?: ReactNode }) {
  const auth = useAuthSession();
  const [remoteGeneration, setRemoteGeneration] = useState(0);
  const [syncSession, setSyncSession] = useState(() => getSyncSessionSnapshot());
  const [actionError, setActionError] = useState<string | null>(null);

  useEffect(() => subscribeSyncSession(setSyncSession), []);

  useEffect(() => {
    if (!auth.supabaseReady || !auth.authUser) {
      resetDatabasePersistence(auth.supabaseReady
        ? 'Sign in to load HELM data.'
        : 'HELM database configuration is unavailable.');
      return;
    }
    void bootstrapDatabasePersistence().catch(() => {
      // The persistence session exposes the actionable failure state.
    });
  }, [auth.authUser, auth.sessionKey, auth.supabaseReady]);

  useEffect(() => {
    if (!auth.supabaseReady || !auth.authUser) return undefined;

    return subscribeStoreChanges(change => {
      const snapshot = getPersistenceHealthSnapshot();
      const lastOwnWriteAt = snapshot.lastRemoteWriteAt
        ? new Date(snapshot.lastRemoteWriteAt).getTime()
        : 0;
      const looksLikeOwnRecentWrite = snapshot.lastRemoteWriteKey === change.key
        && Date.now() - lastOwnWriteAt < 5000;
      if (!looksLikeOwnRecentWrite) {
        setRemoteGeneration(current => current + 1);
      }
    });
  }, [auth.authUser, auth.supabaseReady]);

  useEffect(() => {
    function reloadAppData() {
      setRemoteGeneration(current => current + 1);
    }

    window.addEventListener('helm:app-data-refresh', reloadAppData);
    return () => {
      window.removeEventListener('helm:app-data-refresh', reloadAppData);
    };
  }, []);

  if (!auth.bootstrapped) {
    return (
      <OnlineGate eyebrow="HELM" title="Loading your account" detail="Checking your secure HELM session..." />
    );
  }

  if (!auth.supabaseReady) {
    return (
      <OnlineGate
        eyebrow="Database required"
        title="HELM cannot open account data"
        detail="This build is missing its Supabase project configuration. Shared data is never opened from a device fallback."
      />
    );
  }

  if (!auth.authUser) {
    return (
      <OnlineGate
        eyebrow="Your HELM account"
        title="Sign in to continue"
        detail="HELM stores shared data in your signed-in database account. Offline and anonymous data changes are not supported."
        actionLabel="Continue with Google"
        onAction={async () => {
          setActionError(null);
          try {
            await auth.signInWithGoogle();
          } catch (error) {
            setActionError(error instanceof Error ? error.message : String(error));
          }
        }}
        error={actionError}
      />
    );
  }

  const currentAccountReady = syncSession.status === 'ready'
    && syncSession.userId === auth.authUser.id;
  if (!currentAccountReady) {
    const offline = typeof navigator !== 'undefined' && navigator.onLine === false;
    const switchingAccount = syncSession.userId !== auth.authUser.id;
    return (
      <OnlineGate
        eyebrow={offline ? 'Connection required' : 'Database source of truth'}
        title={syncSession.status === 'bootstrapping' || switchingAccount ? 'Loading your HELM' : 'HELM is reconnecting'}
        detail={switchingAccount
          ? 'Clearing the previous account and loading this account from the database...'
          : syncSession.error || 'Refreshing the latest account data from the database...'}
        actionLabel={syncSession.status === 'bootstrapping' || switchingAccount ? undefined : 'Try again'}
        onAction={syncSession.status === 'bootstrapping' || switchingAccount ? undefined : async () => {
          setActionError(null);
          await refreshDatabasePersistence();
        }}
        secondaryActionLabel="Sign out"
        onSecondaryAction={() => auth.signOut()}
        error={actionError}
      />
    );
  }

  return (
    <AppProvider key={`${auth.sessionKey}:${remoteGeneration}`}>
      {children ?? <App />}
    </AppProvider>
  );
}

interface OnlineGateProps {
  eyebrow: string;
  title: string;
  detail: string;
  actionLabel?: string;
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
  onAction,
  secondaryActionLabel,
  onSecondaryAction,
  error,
}: OnlineGateProps) {
  return (
    <main className="online-gate">
      <section className="online-gate-card" aria-live="polite">
        <div className="online-gate-mark" aria-hidden="true">H</div>
        <div className="online-gate-eyebrow">{eyebrow}</div>
        <h1>{title}</h1>
        <p>{detail}</p>
        {error && <div className="online-gate-error" role="alert">{error}</div>}
        {(actionLabel || secondaryActionLabel) && (
          <div className="online-gate-actions">
            {actionLabel && onAction && (
              <button className="btn btn-primary" type="button" onClick={() => void onAction()}>{actionLabel}</button>
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
