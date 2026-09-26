import { usePrayerContext } from '../../store/contexts/PrayerContext';
import type { PrayerServiceSyncState } from '../../store/contexts/usePrayerServiceSync';

function syncMessage(sync: PrayerServiceSyncState): string {
  switch (sync.status) {
    case 'loading': return 'Loading…';
    case 'syncing': return 'Saving…';
    case 'synced': return 'Synced';
    case 'error': return `Not synced (${sync.error ?? 'unknown error'}). Retrying automatically; changes are kept on this device.`;
    default: return 'Not configured';
  }
}

/** Prayer sync state for assistive tech; shown on screen only when prayer data is not syncing. */
export default function PrayerSyncStatus() {
  const serviceSync = usePrayerContext().serviceSync;
  if (!serviceSync || serviceSync.status === 'disabled') return null;

  return (
    <p
      className={serviceSync.status === 'error' ? 'subtitle' : 'sr-only'}
      role="status"
      aria-label="Prayer data sync"
      aria-live="polite"
    >
      Prayer data: {syncMessage(serviceSync)}
    </p>
  );
}
