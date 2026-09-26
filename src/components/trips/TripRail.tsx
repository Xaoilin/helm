import { formatTripRange } from '../../services/tripDisplay';
import type { Trip, TripLeg } from '../../types/domain';
import TripStatusPill from './TripStatusPill';

/** The searchable list of trips beside the planner. */
export default function TripRail({
  trips,
  legsByTrip,
  selectedTripId,
  searchQuery,
  onSearchChange,
  onSelect,
}: {
  trips: Trip[];
  legsByTrip: Map<string, TripLeg[]>;
  selectedTripId: string | null;
  searchQuery: string;
  onSearchChange: (query: string) => void;
  onSelect: (tripId: string) => void;
}) {
  return (
    <aside className="card" style={{ padding: 18, display: 'grid', gap: 14, alignContent: 'start' }}>
      <input
        className="form-input"
        value={searchQuery}
        onChange={event => onSearchChange(event.target.value)}
        placeholder="Search trips, countries, or cities"
        aria-label="Search trips"
      />
      <div style={{ display: 'grid', gap: 10 }}>
        {trips.map(trip => {
          const tripLegs = legsByTrip.get(trip.id) || [];
          const selected = selectedTripId === trip.id;
          return (
            <button
              key={trip.id}
              type="button"
              onClick={() => onSelect(trip.id)}
              style={{
                textAlign: 'left',
                padding: 14,
                borderRadius: 14,
                border: selected ? '1px solid #4f5bff' : '1px solid #23283c',
                background: selected ? 'rgba(79, 91, 255, 0.12)' : '#121620',
                color: '#f5f7ff',
                cursor: 'pointer',
                display: 'grid',
                gap: 8,
              }}
            >
              <div style={{ display: 'flex', justifyContent: 'space-between', gap: 8, alignItems: 'center' }}>
                <div style={{ fontWeight: 700, fontSize: 14 }}>{trip.name}</div>
                <TripStatusPill status={trip.status} />
              </div>
              <div style={{ fontSize: 12, color: '#8b8fa3' }}>{formatTripRange(trip.startDate, trip.endDate)}</div>
              <div style={{ fontSize: 12, color: '#9ea4c5' }}>{trip.summary || 'No summary yet.'}</div>
              <div style={{ fontSize: 12, color: '#6b6f85' }}>
                {tripLegs.length === 0
                  ? 'No destinations yet'
                  : tripLegs.map(leg => `${leg.city}, ${leg.country}`).join(' · ')}
              </div>
            </button>
          );
        })}
        {trips.length === 0 && (
          <div style={{ fontSize: 13, color: '#8b8fa3' }}>No trips match that search.</div>
        )}
      </div>
    </aside>
  );
}
