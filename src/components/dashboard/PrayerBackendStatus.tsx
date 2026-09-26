import { useEffect, useState } from 'react';
import {
  checkPrayerBackendHealth,
  checkPrayerDatabaseHealth,
  type PrayerBackendHealthCheck,
} from '../../services/prayerApi';
import { usePrayerContext } from '../../store/contexts/PrayerContext';
import type { PrayerServiceSyncState } from '../../store/contexts/usePrayerServiceSync';

type ViewState = PrayerBackendHealthCheck | { status: 'checking' };

function syncMessage(sync: PrayerServiceSyncState): string {
  switch (sync.status) {
    case 'loading': return 'Loading…';
    case 'syncing': return 'Saving…';
    case 'synced': return 'Synced';
    case 'error': return `Not synced (${sync.error ?? 'unknown error'}). Retrying automatically; changes are kept on this device.`;
    default: return 'Not configured';
  }
}

export default function PrayerBackendStatus() {
  const serviceSync = usePrayerContext().serviceSync;
  const [backendCheck, setBackendCheck] = useState<ViewState>({ status: 'checking' });
  const [databaseCheck, setDatabaseCheck] = useState<ViewState>({ status: 'checking' });

  useEffect(() => {
    let mounted = true;
    void Promise.all([checkPrayerBackendHealth(), checkPrayerDatabaseHealth()]).then(([backend, database]) => {
      if (!mounted) return;
      setBackendCheck(backend);
      setDatabaseCheck(database);
    });
    return () => { mounted = false; };
  }, []);

  const backendMessage = backendCheck.status === 'checking'
    ? 'Checking…'
    : backendCheck.status === 'connected'
      ? 'Connected'
      : backendCheck.status === 'not_configured'
        ? 'Not configured'
        : `Unavailable (${backendCheck.detail})`;
  const databaseMessage = databaseCheck.status === 'checking'
    ? 'Checking…'
    : databaseCheck.status === 'connected'
      ? 'Connected'
      : databaseCheck.status === 'not_configured'
        ? 'Not configured'
        : `Unavailable (${databaseCheck.detail})`;

  return (
    <div className="prayer-backend-status" aria-live="polite">
      <p className="subtitle" role="status" aria-label="Spring Boot prayer backend">
        Spring Boot prayer backend: {backendMessage}
        {(backendCheck.status === 'unavailable' || backendCheck.status === 'not_configured') && ' Prayer features still use the current app path.'}
      </p>
      {serviceSync && serviceSync.status !== 'disabled' && (
        <p className="subtitle" role="status" aria-label="Prayer data sync">
          Prayer data: {syncMessage(serviceSync)}
        </p>
      )}
      <p className="subtitle" role="status" aria-label="Spring Boot prayer database">
        Spring Boot prayer database: {databaseMessage}
      </p>
    </div>
  );
}
