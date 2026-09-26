import { formatBudgetMoney, getTripBudgetStatusLabel, hasBudgetAmount } from '../../services/tripBudget';
import { buildBookingCalendarTarget, type CalendarImportTarget } from '../../services/tripCalendarImport';
import { getBookingDisplayTitle, getBookingRouteLabel, getBookingTimelineLabel } from '../../services/tripDisplay';
import { isUpcomingBooking, type BookingKind, type BookingSeed } from '../../services/tripModel';
import { useTripContext } from '../../store/contexts/TripContext';
import type { TripBooking } from '../../types/domain';

interface BookingActions {
  onEdit: (kind: BookingKind, booking: TripBooking) => void;
  onShowBudget: () => void;
  onAddToCalendar: (target: CalendarImportTarget) => void;
}

function BookingCard({ booking, seed, currency, nowMs, onEdit, onShowBudget, onAddToCalendar }: BookingActions & {
  booking: TripBooking;
  seed: BookingSeed;
  currency: string;
  nowMs: number;
}) {
  const { removeTripBooking } = useTripContext();
  const title = getBookingDisplayTitle(booking, seed);
  const upcoming = isUpcomingBooking(booking, nowMs);
  return (
    <div style={{ padding: 14, borderRadius: 14, background: '#141926', border: '1px solid #23283c', display: 'grid', gap: 8 }}>
      <div style={{ display: 'flex', justifyContent: 'space-between', gap: 8, alignItems: 'center', flexWrap: 'wrap' }}>
        <div style={{ fontWeight: 700 }}>{title}</div>
        <div style={{ display: 'flex', gap: 8, flexWrap: 'wrap' }}>
          <span className={`tag ${upcoming ? 'tag-primary' : 'tag-disconnected'}`}>{upcoming ? 'Upcoming' : 'Past'}</span>
          <span className={`tag ${hasBudgetAmount(booking.budgetAmount) ? 'tag-primary' : 'tag-disconnected'}`}>
            {hasBudgetAmount(booking.budgetAmount) ? formatBudgetMoney(booking.budgetAmount, currency) : 'Needs cost'}
          </span>
          {hasBudgetAmount(booking.budgetAmount) && (
            <span className={`tag ${booking.budgetStatus === 'paid' ? 'tag-connected' : 'tag-primary'}`}>
              {getTripBudgetStatusLabel(booking.budgetStatus || 'planned')}
            </span>
          )}
        </div>
      </div>
      <div style={{ fontSize: 12, color: '#9ea4c5' }}>{getBookingRouteLabel(booking, seed)}</div>
      <div style={{ fontSize: 12, color: '#8b8fa3' }}>{getBookingTimelineLabel(booking)}</div>
      {booking.kind === 'transport' && booking.confirmationCode && <div style={{ fontSize: 12, color: '#8b8fa3' }}>Confirmation {booking.confirmationCode}</div>}
      <div className="actions-row" style={{ margin: 0, flexWrap: 'wrap' }}>
        <button className="btn btn-secondary btn-sm" onClick={() => onEdit(booking.kind, booking)}>Edit</button>
        <button className="btn btn-secondary btn-sm" onClick={onShowBudget}>Budget</button>
        <button className="btn btn-secondary btn-sm" onClick={() => onAddToCalendar(buildBookingCalendarTarget(booking, seed))}>Add to Calendar</button>
        <button className="btn btn-danger btn-sm" onClick={() => {
          if (window.confirm(`Delete booking "${title}"?`)) {
            removeTripBooking(booking.id);
          }
        }}>Delete</button>
      </div>
    </div>
  );
}

function BookingColumn({ heading, emptyText, bookings, ...cardProps }: BookingActions & {
  heading: string;
  emptyText: string;
  bookings: TripBooking[];
  seedFor: (booking: TripBooking) => BookingSeed;
  currency: string;
  nowMs: number;
}) {
  const { seedFor, ...shared } = cardProps;
  return (
    <div className="card" style={{ padding: 18, display: 'grid', gap: 12, alignContent: 'start' }}>
      <div style={{ fontSize: 16, fontWeight: 700 }}>{heading}</div>
      {bookings.length === 0 ? (
        <div style={{ fontSize: 13, color: '#8b8fa3' }}>{emptyText}</div>
      ) : (
        bookings.map(booking => <BookingCard key={booking.id} booking={booking} seed={seedFor(booking)} {...shared} />)
      )}
    </div>
  );
}

export default function TripBookingsTab({
  bookings,
  seedFor,
  currency,
  nowMs,
  onCreate,
  ...actions
}: BookingActions & {
  bookings: TripBooking[];
  seedFor: (booking: TripBooking) => BookingSeed;
  currency: string;
  nowMs: number;
  onCreate: (kind: BookingKind) => void;
}) {
  const shared = { seedFor, currency, nowMs, ...actions };
  return (
    <div style={{ display: 'grid', gap: 16 }}>
      <div className="card" style={{ padding: 18, display: 'flex', justifyContent: 'space-between', gap: 12, flexWrap: 'wrap', alignItems: 'center' }}>
        <div>
          <div style={{ fontSize: 16, fontWeight: 700 }}>Bookings</div>
          <div style={{ fontSize: 13, color: '#8b8fa3' }}>Each booking can carry its own cost, payment state, and timeline details, and the Budget tab stays linked automatically.</div>
        </div>
        <div className="actions-row" style={{ margin: 0, flexWrap: 'wrap' }}>
          <button className="btn btn-secondary" onClick={() => onCreate('transport')}>+ Transport</button>
          <button className="btn btn-primary" onClick={() => onCreate('stay')}>+ Stay</button>
        </div>
      </div>

      <div className="trip-bookings-grid">
        <BookingColumn heading="Transport" emptyText="No transport bookings yet." bookings={bookings.filter(booking => booking.kind === 'transport')} {...shared} />
        <BookingColumn heading="Stay" emptyText="No stay bookings yet." bookings={bookings.filter(booking => booking.kind === 'stay')} {...shared} />
      </div>
    </div>
  );
}
