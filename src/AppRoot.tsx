import { useEffect, useState, type ReactNode } from 'react';
import App from './App';
import { AppProvider } from './store/AppContext';
import { AuthSessionProvider, useAuthSession } from './store/AuthSessionContext';
import { getPersistenceHealthSnapshot, subscribeStoreChanges } from './store/persistence';

export function BootstrappedApp({ children }: { children?: ReactNode }) {
  const auth = useAuthSession();
  const [remoteGeneration, setRemoteGeneration] = useState(0);

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
      <div style={{ display: 'flex', alignItems: 'center', justifyContent: 'center', height: '100vh', color: '#8b8fa3' }}>
        Loading HELM...
      </div>
    );
  }

  return (
    <AppProvider key={`${auth.sessionKey}:${remoteGeneration}`}>
      {children ?? <App />}
    </AppProvider>
  );
}

export default function AppRoot() {
  return (
    <AuthSessionProvider>
      <BootstrappedApp />
    </AuthSessionProvider>
  );
}
