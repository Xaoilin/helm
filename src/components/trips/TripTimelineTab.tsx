import { useTripContext } from '../../store/contexts/TripContext';
import { useTripWorkflows } from '../../store/workflows/useTripWorkflows';
import { formatBudgetMoney, hasBudgetAmount } from '../../services/tripBudget';
import { buildItineraryCalendarTarget, type CalendarImportTarget } from '../../services/tripCalendarImport';
import {
  formatDate,
  formatItineraryTimeLabel,
  formatTripRange,
  getBookingDisplayTitle,
  getBookingRouteLabel,
  getBookingTimelineLabel,
} from '../../services/tripDisplay';
import { dayKey, expandDateRange, type BookingSeed } from '../../services/tripModel';
import type { Trip, TripBooking, TripItineraryItem, TripLeg } from '../../types/domain';

function TimelineBookingRef({ booking, seed, currency }: { booking: TripBooking; seed: BookingSeed; currency: string }) {
  return (
    <div style={{ padding: 10, borderRadius: 10, background: '#161b29', border: '1px solid #293046' }}>
      <div style={{ display: 'flex', justifyContent: 'space-between', gap: 8, alignItems: 'center', flexWrap: 'wrap' }}>
        <div style={{ fontWeight: 600, fontSize: 13 }}>{getBookingDisplayTitle(booking, seed)}</div>
        <div style={{ display: 'flex', gap: 8, flexWrap: 'wrap' }}>
          <span className="tag tag-connected">{booking.kind === 'transport' ? 'Booking' : 'Stay'}</span>
          <span className={`tag ${hasBudgetAmount(booking.budgetAmount) ? 'tag-primary' : 'tag-disconnected'}`}>
            {hasBudgetAmount(booking.budgetAmount) ? formatBudgetMoney(booking.budgetAmount, currency) : 'Needs cost'}
          </span>
        </div>
      </div>
      <div style={{ fontSize: 12, color: '#9ea4c5', marginTop: 6 }}>{getBookingRouteLabel(booking, seed)}</div>
      <div style={{ fontSize: 12, color: '#8b8fa3', marginTop: 6 }}>{getBookingTimelineLabel(booking)}</div>
    </div>
  );
}

/** Route legs in order, each expanded into its days with plans and the bookings that touch them. */
export default function TripTimelineTab({
  trip,
  legs,
  itineraryByDay,
  bookingsByDay,
  seedFor,
  currency,
  today,
  onOpenLegEditor,
  onOpenPlanEditor,
  onAddToCalendar,
}: {
  trip: Trip;
  legs: TripLeg[];
  itineraryByDay: Map<string, TripItineraryItem[]>;
  bookingsByDay: Map<string, TripBooking[]>;
  seedFor: (booking: TripBooking) => BookingSeed;
  currency: string;
  today: string;
  onOpenLegEditor: (leg?: TripLeg) => void;
  onOpenPlanEditor: (leg: TripLeg, date: string, item?: TripItineraryItem) => void;
  onAddToCalendar: (target: CalendarImportTarget) => void;
}) {
  const { removeTripItineraryItem } = useTripContext();
  const { moveLeg, removeLeg } = useTripWorkflows();

  return (
    <div style={{ display: 'grid', gap: 16 }}>
      <div className="card" style={{ padding: 18, display: 'flex', justifyContent: 'space-between', gap: 12, flexWrap: 'wrap', alignItems: 'center' }}>
        <div>
          <div style={{ fontSize: 16, fontWeight: 700 }}>Trip Timeline</div>
          <div style={{ fontSize: 13, color: '#8b8fa3' }}>Manage route legs, then fill each day with plans and attach important booking references.</div>
        </div>
        <button className="btn btn-primary" onClick={() => onOpenLegEditor()}>+ Add Destination</button>
      </div>

      {legs.length === 0 ? (
        <div className="empty-state" role="status">
          <div className="empty-icon">&#127963;&#65039;</div>
          <h3>No destinations yet</h3>
          <p>Add at least one country and city leg to build the day-by-day itinerary.</p>
          <button className="btn btn-primary" onClick={() => onOpenLegEditor()}>+ Add Destination</button>
        </div>
      ) : (
        <div style={{ display: 'grid', gap: 18 }}>
          {legs.map((leg, index) => {
            const dayList = expandDateRange(leg.startDate, leg.endDate);
            return (
              <section key={leg.id} className="card" style={{ padding: 18, display: 'grid', gap: 16 }}>
                <div style={{ display: 'flex', justifyContent: 'space-between', gap: 12, flexWrap: 'wrap', alignItems: 'flex-start' }}>
                  <div style={{ display: 'grid', gap: 6 }}>
                    <div style={{ display: 'flex', alignItems: 'center', gap: 8, flexWrap: 'wrap' }}>
                      <div style={{ fontSize: 18, fontWeight: 700 }}>{index + 1}. {leg.city}, {leg.country}</div>
                      <span className="tag tag-primary">{formatTripRange(leg.startDate, leg.endDate)}</span>
                    </div>
                    <div style={{ fontSize: 12, color: '#8b8fa3' }}>{dayList.length} day{dayList.length === 1 ? '' : 's'} in this destination.</div>
                  </div>
                  <div className="actions-row" style={{ margin: 0, flexWrap: 'wrap' }}>
                    <button className="btn btn-secondary btn-sm" onClick={() => moveLeg(legs, leg.id, -1)} disabled={index === 0}>&larr; Earlier</button>
                    <button className="btn btn-secondary btn-sm" onClick={() => moveLeg(legs, leg.id, 1)} disabled={index === legs.length - 1}>Later &rarr;</button>
                    <button className="btn btn-secondary btn-sm" onClick={() => onOpenLegEditor(leg)}>Edit</button>
                    <button className="btn btn-danger btn-sm" onClick={() => {
                      if (window.confirm(`Delete destination "${leg.city}, ${leg.country}"?`)) {
                        removeLeg({ tripId: trip.id, orderedLegs: legs, legId: leg.id });
                      }
                    }}>Delete</button>
                  </div>
                </div>

                <div className="trip-days-grid">
                  {dayList.map(date => {
                    const items = itineraryByDay.get(dayKey(leg.id, date)) || [];
                    const bookingRefs = bookingsByDay.get(dayKey(leg.id, date)) || [];
                    return (
                      <div key={`${leg.id}:${date}`} className="card" style={{ padding: 14, display: 'grid', gap: 10, background: '#121620' }}>
                        <div style={{ display: 'flex', justifyContent: 'space-between', gap: 8, alignItems: 'center' }}>
                          <div>
                            <div style={{ fontWeight: 700 }}>{formatDate(date)}</div>
                            <div style={{ fontSize: 12, color: '#8b8fa3' }}>{date === today ? 'Today' : 'Trip day'}</div>
                          </div>
                          <button className="btn btn-secondary btn-sm" onClick={() => onOpenPlanEditor(leg, date)}>+ Add Plan</button>
                        </div>

                        {bookingRefs.length > 0 && (
                          <div style={{ display: 'grid', gap: 8 }}>
                            {bookingRefs.map(booking => <TimelineBookingRef key={booking.id} booking={booking} seed={seedFor(booking)} currency={currency} />)}
                          </div>
                        )}

                        {items.length === 0 ? (
                          <div style={{ fontSize: 12, color: '#6b6f85', padding: 12, borderRadius: 10, background: '#10141d' }}>
                            No plans for this day yet.
                          </div>
                        ) : (
                          <div style={{ display: 'grid', gap: 8 }}>
                            {items.map(item => (
                              <div key={item.id} style={{ padding: 12, borderRadius: 12, background: '#141926', border: '1px solid #23283c', display: 'grid', gap: 8 }}>
                                <div style={{ display: 'flex', justifyContent: 'space-between', gap: 8, alignItems: 'center' }}>
                                  <div style={{ fontWeight: 600 }}>{item.title}</div>
                                  <span className="tag tag-primary">{formatItineraryTimeLabel(item.startTime, item.endTime)}</span>
                                </div>
                                {item.location && <div style={{ fontSize: 12, color: '#9ea4c5' }}>{item.location}</div>}
                                {item.notes && <div style={{ fontSize: 12, color: '#8b8fa3' }}>{item.notes}</div>}
                                <div className="actions-row" style={{ margin: 0, flexWrap: 'wrap' }}>
                                  <button className="btn btn-secondary btn-sm" onClick={() => onOpenPlanEditor(leg, date, item)}>Edit</button>
                                  <button className="btn btn-secondary btn-sm" onClick={() => onAddToCalendar(buildItineraryCalendarTarget(item, leg))}>Add to Calendar</button>
                                  <button className="btn btn-danger btn-sm" onClick={() => {
                                    if (window.confirm(`Delete "${item.title}"?`)) {
                                      removeTripItineraryItem(item.id);
                                    }
                                  }}>Delete</button>
                                </div>
                              </div>
                            ))}
                          </div>
                        )}
                      </div>
                    );
                  })}
                </div>
              </section>
            );
          })}
        </div>
      )}
    </div>
  );
}
