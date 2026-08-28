import NightCompassDashboard from '../components/dashboard/NightCompassDashboard';

export default function DashboardSurface() {
  return (
    <>
      <div className="surface-header nc-surface-header">
        <div>
          <h1>Night Compass</h1>
          <div className="subtitle">Prayer first · Learn and Move daily · Tasks second-order</div>
        </div>
      </div>
      <div className="surface-body nc-dashboard-body">
        <NightCompassDashboard />
      </div>
    </>
  );
}
