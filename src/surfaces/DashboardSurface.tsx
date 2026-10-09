import NightCompassDashboard from '../components/dashboard/NightCompassDashboard';
import PrayerSyncStatus from '../components/dashboard/PrayerSyncStatus';
import { useSharedPageReady } from '../store/PageReadinessGate';

export default function DashboardSurface() {
  const prayerActionsReady = useSharedPageReady();
  return (
    <>
      <div className="surface-header nc-surface-header">
        <div>
          <h1>Night Compass</h1>
          <div className="subtitle">Prayer first · Learn and Move daily · Tasks second-order</div>
        </div>
      </div>
      <div className="surface-body nc-dashboard-body" tabIndex={0} aria-label="Dashboard content">
        <PrayerSyncStatus />
        <NightCompassDashboard prayerActionsReady={prayerActionsReady} />
      </div>
    </>
  );
}
