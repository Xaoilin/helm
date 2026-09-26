import { formatTripRange } from '../../services/tripDisplay';
import type { Trip } from '../../types/domain';
import TripStatusPill from './TripStatusPill';

export type TripsTab = 'overview' | 'timeline' | 'bookings' | 'budget';

const TABS: Array<{ value: TripsTab; label: string }> = [
  { value: 'overview', label: 'Overview' },
  { value: 'timeline', label: 'Timeline' },
  { value: 'bookings', label: 'Bookings' },
  { value: 'budget', label: 'Budget' },
];

/** The selected trip's title card: summary, counts, trip actions, and the planner tabs. */
export default function TripDetailHeader({
  trip,
  destinationCount,
  bookingCount,
  activeTab,
  onTabChange,
  onEdit,
  onDelete,
}: {
  trip: Trip;
  destinationCount: number;
  bookingCount: number;
  activeTab: TripsTab;
  onTabChange: (tab: TripsTab) => void;
  onEdit: () => void;
  onDelete: () => void;
}) {
  return (
    <div className="card" style={{ padding: 20, display: 'grid', gap: 16 }}>
      <div style={{ display: 'flex', justifyContent: 'space-between', gap: 12, flexWrap: 'wrap', alignItems: 'flex-start' }}>
        <div style={{ display: 'grid', gap: 10 }}>
          <div style={{ display: 'flex', alignItems: 'center', gap: 10, flexWrap: 'wrap' }}>
            <h2 style={{ margin: 0 }}>{trip.name}</h2>
            <TripStatusPill status={trip.status} />
          </div>
          <div style={{ color: '#9ea4c5', maxWidth: 760 }}>
            {trip.summary || 'Add a short summary so this trip has context at a glance.'}
          </div>
          <div style={{ fontSize: 12, color: '#8b8fa3' }}>
            {formatTripRange(trip.startDate, trip.endDate)} · {destinationCount} destination{destinationCount === 1 ? '' : 's'} · {bookingCount} booking{bookingCount === 1 ? '' : 's'}
          </div>
        </div>
        <div className="actions-row" style={{ margin: 0, flexWrap: 'wrap' }}>
          <button className="btn btn-secondary btn-sm" onClick={onEdit}>Edit Trip</button>
          <button className="btn btn-danger btn-sm" onClick={onDelete}>Delete</button>
        </div>
      </div>

      <div className="tabs">
        {TABS.map(tab => (
          <button key={tab.value} className={`tab ${activeTab === tab.value ? 'active' : ''}`} onClick={() => onTabChange(tab.value)}>{tab.label}</button>
        ))}
      </div>
    </div>
  );
}
