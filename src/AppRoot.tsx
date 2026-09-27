import { useEffect, useState, type ReactNode } from 'react';
import App from './App';
import { useReleaseRefresh } from './hooks/useReleaseRefresh';
import { useOnlineStatus } from './hooks/useOnlineStatus';
import { AppProviders } from './store/AppProviders';
import { AuthSessionProvider, useAuthSession } from './store/AuthSessionContext';
import { SyncAvailabilityProvider } from './store/SyncAvailabilityContext';
import { checkPrayerDatabaseHealth } from './services/prayerApi';

export function BootstrappedApp({ children }: { children?: ReactNode }) {
  const auth = useAuthSession();
  const online = useOnlineStatus();
  const [actionError, setActionError] = useState<string | null>(null);

  // A sign-in or session problem must not prevent an available release updating.
  // The hook keeps the same editor, dialog, and visibility guards.
  useReleaseRefresh();

  if (!auth.bootstrapped) {
    return (
      <OnlineGate eyebrow="SABAH ONE" title="Loading your account" detail="Checking your secure Sabah One session..." />
    );
  }

  if (!auth.supabaseReady) {
    return (
      <OnlineGate
        eyebrow="Sign-in required"
        title="Sabah One cannot open account data"
        detail="This build is missing its Supabase sign-in configuration. Account data is never opened from a device fallback."
      />
    );
  }

  if (!auth.authUser && auth.sessionUnavailable) {
    return (
      <OnlineGate
        eyebrow="Connection required"
        title="Reconnecting to Sabah One"
        detail="Your session is still saved, but Sabah One could not reach its sign-in service to renew it. Check your connection and retry; you do not need to sign in again."
        actionLabel="Retry"
        onAction={() => auth.retrySession()}
      />
    );
  }

  if (!auth.authUser) {
    return (
      <OnlineGate
        eyebrow="Your Sabah One account"
        title="Sign in to continue"
        detail="Sabah One keeps your data in your signed-in account. Offline and anonymous data changes are not supported."
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

  // Remounting the providers for each signed-in session clears the previous account's data before
  // the next account's pages load theirs from the services.
  return (
    <SyncAvailabilityProvider readOnly={!online}>
      <AppProviders key={auth.sessionKey}>
        <div className="account-workspace">
          {!online && <OfflineBanner />}
          {children ?? <App />}
        </div>
      </AppProviders>
    </SyncAvailabilityProvider>
  );
}

function OfflineBanner() {
  const label = 'Offline';
  const detail = 'Showing your last confirmed data. Sabah One will reconnect automatically.';
  return (
    <div
      className="sync-status-banner"
      role="status"
      aria-label={`${label}. ${detail}`}
      data-testid="sync-status-banner"
    >
      <strong>{label}</strong>
      <span>{detail}</span>
    </div>
  );
}

interface OnlineGateProps {
  eyebrow: string;
  title: string;
  detail: string;
  actionLabel?: string;
  onAction?: () => Promise<void> | void;
  error?: string | null;
}

function OnlineGate({ eyebrow, title, detail, actionLabel, onAction, error }: OnlineGateProps) {
  return (
    <main className="online-gate">
      <section className="online-gate-card" aria-live="polite">
        <div className="online-gate-mark" aria-hidden="true">S1</div>
        <div className="online-gate-eyebrow">{eyebrow}</div>
        <h1>{title}</h1>
        <p>{detail}</p>
        {error && <div className="online-gate-error" role="alert">{error}</div>}
        {actionLabel && onAction && (
          <div className="online-gate-actions">
            <button className="btn btn-primary" type="button" onClick={() => void onAction()}>{actionLabel}</button>
          </div>
        )}
      </section>
    </main>
  );
}

export default function AppRoot() {
  useEffect(() => {
    void checkPrayerDatabaseHealth();
  }, []);

  return (
    <AuthSessionProvider>
      <BootstrappedApp />
    </AuthSessionProvider>
  );
}
