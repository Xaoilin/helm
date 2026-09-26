import { useCallback, useMemo } from 'react';
import { buildBudgetLedger, summarizeBudget } from '../../services/tripBudget';
import {
  buildTripBookingSeed,
  compareLegs,
  filterTrips,
  groupBookingsByDay,
  groupItineraryByDay,
  groupLegsByTrip,
  isUpcomingBooking,
  resolveSelectedTripId,
  sortBookingsForDisplay,
  sortItinerary,
  type BookingSeed,
} from '../../services/tripModel';
import { useTripContext } from '../../store/contexts/TripContext';
import type { TripBooking } from '../../types/domain';

/**
 * Everything the Trips planner shows for the current search and selection,
 * derived from the Trip store through the pure rules in `tripModel` and
 * `tripBudget`. `nowMs` is the render's clock reading; it decides which
 * bookings are upcoming for the booking order and the next booking.
 */
export function useTripPlannerView({ requestedTripId, searchQuery, today, nowMs }: {
  requestedTripId: string | null;
  searchQuery: string;
  today: string;
  nowMs: number;
}) {
  const { trips, tripLegs, tripItineraryItems, tripBookings, tripBudgetEntries } = useTripContext();

  const legsByTrip = useMemo(() => groupLegsByTrip(tripLegs), [tripLegs]);
  const filteredTrips = useMemo(() => filterTrips(trips, legsByTrip, searchQuery), [trips, legsByTrip, searchQuery]);
  const selectedTripId = useMemo(
    () => resolveSelectedTripId(requestedTripId, filteredTrips, trips),
    [requestedTripId, filteredTrips, trips],
  );
  const selectedTrip = useMemo(() => trips.find(trip => trip.id === selectedTripId) || null, [trips, selectedTripId]);

  const legs = useMemo(
    () => tripLegs.filter(leg => leg.tripId === selectedTripId).sort(compareLegs),
    [tripLegs, selectedTripId],
  );
  const itinerary = useMemo(
    () => sortItinerary(tripItineraryItems.filter(item => item.tripId === selectedTripId)),
    [tripItineraryItems, selectedTripId],
  );
  const tripBookingsForSelection = useMemo(
    () => tripBookings.filter(booking => booking.tripId === selectedTripId),
    [tripBookings, selectedTripId],
  );
  const bookings = useMemo(() => sortBookingsForDisplay(tripBookingsForSelection, nowMs), [tripBookingsForSelection, nowMs]);
  const manualBudgetEntries = useMemo(
    () => tripBudgetEntries.filter(entry => entry.tripId === selectedTripId),
    [tripBudgetEntries, selectedTripId],
  );

  const itineraryByDay = useMemo(() => groupItineraryByDay(itinerary), [itinerary]);
  const bookingsByDay = useMemo(() => groupBookingsByDay(legs, bookings), [legs, bookings]);
  const nextBooking = useMemo(
    () => bookings.find(booking => isUpcomingBooking(booking, nowMs)) || bookings[0] || null,
    [bookings, nowMs],
  );

  const seedFor = useCallback(
    (booking: TripBooking): BookingSeed => buildTripBookingSeed(selectedTrip, legs, booking.legId),
    [selectedTrip, legs],
  );
  const budgetLedger = useMemo(
    () => buildBudgetLedger({ bookings, manualEntries: manualBudgetEntries, trip: selectedTrip, seedFor, today }),
    [bookings, manualBudgetEntries, selectedTrip, seedFor, today],
  );
  const budgetTotals = useMemo(
    () => summarizeBudget(budgetLedger, bookings, selectedTrip?.budgetTotal || 0),
    [budgetLedger, bookings, selectedTrip?.budgetTotal],
  );

  return {
    legsByTrip,
    filteredTrips,
    selectedTripId,
    selectedTrip,
    legs,
    itinerary,
    bookings,
    itineraryByDay,
    bookingsByDay,
    nextBooking,
    seedFor,
    budgetLedger,
    budgetTotals,
  };
}
