import { formatBudgetMoney, getTripBudgetStatusLabel, hasBudgetAmount, type BudgetTotals } from '../../services/tripBudget';
import { formatTripRange, getBookingDisplayTitle, getBookingRouteLabel, getBookingTimelineLabel } from '../../services/tripDisplay';
import { expandDateRange, type BookingSeed } from '../../services/tripModel';
import type { Trip, TripBooking, TripLeg } from '../../types/domain';
import TripMetricCard from './TripMetricCard';

export default function TripOverviewTab({
  trip,
  legs,
  bookingCount,
  planCount,
  nextBooking,
  seedFor,
  currency,
  budgetTotals,
  ledgerCount,
}: {
  trip: Trip;
  legs: TripLeg[];
  bookingCount: number;
  planCount: number;
  nextBooking: TripBooking | null;
  seedFor: (booking: TripBooking) => BookingSeed;
  currency: string;
  budgetTotals: BudgetTotals;
  ledgerCount: number;
}) {
  const budgetTotal = trip.budgetTotal || 0;
  const { forecastTotal, remaining, uncostedBookingCount } = budgetTotals;
  const nextSeed = nextBooking ? seedFor(nextBooking) : {};

  return (
    <div style={{ display: 'grid', gap: 16 }}>
      <div className="projects-metrics-grid">
        <TripMetricCard label="Trip Span" value={trip.startDate && trip.endDate ? `${expandDateRange(trip.startDate, trip.endDate).length} days` : 'TBD'} note="Calculated from your destination legs." />
        <TripMetricCard label="Destinations" value={String(legs.length)} note="Ordered country and city stops in the route." />
        <TripMetricCard label="Bookings" value={String(bookingCount)} note="Transport and stay reservations linked to this trip." />
        <TripMetricCard label="Plans" value={String(planCount)} note="Itinerary items across the trip timeline." />
        <TripMetricCard label="Needs Cost" value={String(uncostedBookingCount)} note={uncostedBookingCount === 0 ? 'Every booking is already priced.' : 'Bookings that already show up in Budget but still need a cost.'} />
        <TripMetricCard
          label="Budget Left"
          value={budgetTotal > 0 ? formatBudgetMoney(remaining, currency) : 'Not set'}
          note={budgetTotal > 0
            ? `${formatBudgetMoney(forecastTotal, currency)} forecast across ${ledgerCount} linked item${ledgerCount === 1 ? '' : 's'}${uncostedBookingCount > 0 ? ` · ${uncostedBookingCount} still need cost` : ''}.`
            : 'Set a trip budget to track transport, food, events, and stay costs.'}
        />
      </div>

      <div className="trip-detail-grid">
        <div className="card" style={{ padding: 18, display: 'grid', gap: 12 }}>
          <div style={{ fontSize: 16, fontWeight: 700 }}>Route Summary</div>
          {legs.length === 0 ? (
            <div style={{ fontSize: 13, color: '#8b8fa3' }}>No destinations added yet.</div>
          ) : (
            legs.map((leg, index) => (
              <div key={leg.id} style={{ padding: 12, borderRadius: 12, background: '#141926', border: '1px solid #23283c' }}>
                <div style={{ display: 'flex', justifyContent: 'space-between', gap: 8, alignItems: 'center' }}>
                  <div style={{ fontWeight: 600 }}>{index + 1}. {leg.city}, {leg.country}</div>
                  <span className="tag tag-primary">{formatTripRange(leg.startDate, leg.endDate)}</span>
                </div>
              </div>
            ))
          )}
        </div>

        <div className="card" style={{ padding: 18, display: 'grid', gap: 12 }}>
          <div style={{ fontSize: 16, fontWeight: 700 }}>Next Booking</div>
          {nextBooking ? (
            <div style={{ padding: 12, borderRadius: 12, background: '#141926', border: '1px solid #23283c' }}>
              <div style={{ display: 'flex', justifyContent: 'space-between', gap: 8, alignItems: 'center' }}>
                <div style={{ fontWeight: 600 }}>{getBookingDisplayTitle(nextBooking, nextSeed)}</div>
                <span className="tag tag-connected">{nextBooking.kind === 'transport' ? 'Transport' : 'Stay'}</span>
              </div>
              <div style={{ display: 'flex', gap: 8, flexWrap: 'wrap', marginTop: 6 }}>
                <span className={`tag ${hasBudgetAmount(nextBooking.budgetAmount) ? 'tag-primary' : 'tag-disconnected'}`}>
                  {hasBudgetAmount(nextBooking.budgetAmount) ? formatBudgetMoney(nextBooking.budgetAmount, currency) : 'Needs cost'}
                </span>
                {hasBudgetAmount(nextBooking.budgetAmount) && (
                  <span className={`tag ${nextBooking.budgetStatus === 'paid' ? 'tag-connected' : 'tag-primary'}`}>
                    {getTripBudgetStatusLabel(nextBooking.budgetStatus || 'planned')}
                  </span>
                )}
              </div>
              <div style={{ fontSize: 12, color: '#9ea4c5', marginTop: 6 }}>{getBookingRouteLabel(nextBooking, nextSeed)}</div>
              <div style={{ fontSize: 12, color: '#9ea4c5', marginTop: 6 }}>{getBookingTimelineLabel(nextBooking)}</div>
              <div style={{ fontSize: 12, color: '#8b8fa3', marginTop: 6 }}>{nextBooking.notes || 'No extra notes recorded.'}</div>
            </div>
          ) : (
            <div style={{ fontSize: 13, color: '#8b8fa3' }}>No bookings yet. Add flights, trains, or stays in the Bookings tab.</div>
          )}
        </div>

        <div className="card" style={{ padding: 18, display: 'grid', gap: 12 }}>
          <div style={{ fontSize: 16, fontWeight: 700 }}>Trip Notes</div>
          <div style={{ fontSize: 13, lineHeight: 1.7, color: '#9ea4c5', whiteSpace: 'pre-wrap' }}>
            {trip.notes || 'No trip notes yet.'}
          </div>
        </div>
      </div>
    </div>
  );
}
