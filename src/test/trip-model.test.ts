import { describe, expect, it } from 'vitest';
import {
  addHoursToLocalDateTime,
  applyBookingDraftUpdate,
  buildBookingPayload,
  buildLocalDateTime,
  buildRouteDraftBookingSeed,
  buildRouteLegInputs,
  buildStayDraft,
  buildTransportDraft,
  buildTripBasicsPayload,
  buildTripBookingSeed,
  canAdvanceWizardStep,
  createEmptyWizardDraft,
  deriveRangeAfterLegSave,
  deriveTripRange,
  expandDateRange,
  filterTrips,
  findWizardBookingValidationMessage,
  getBookingValidationMessage,
  groupBookingsByDay,
  groupLegsByTrip,
  mapBookingToDraft,
  materializeBookingDraft,
  nextItinerarySortOrder,
  nextWizardStep,
  planLegRemoval,
  planLegSwap,
  previousWizardStep,
  resolveSelectedTripId,
  serializeWizardDraft,
  sortBookingsForDisplay,
  type LegDraft,
  type StayBookingDraft,
  type TransportBookingDraft,
} from '../services/tripModel';
import { makeItineraryItem, makeStayBooking, makeTransportBooking, makeTrip, makeTripLeg } from './tripFixtures';

const TODAY = '2026-09-26';

function transportDraft(overrides: Partial<TransportBookingDraft> = {}): TransportBookingDraft {
  return { ...buildTransportDraft({}, TODAY), ...overrides };
}

function stayDraft(overrides: Partial<StayBookingDraft> = {}): StayBookingDraft {
  return { ...buildStayDraft({}, TODAY), ...overrides };
}

function legDraft(overrides: Partial<LegDraft> = {}): LegDraft {
  return { id: 'draft-leg', country: 'Spain', city: 'Madrid', startDate: '2026-10-01', endDate: '2026-10-03', ...overrides };
}

describe('trip range derivation', () => {
  it('is empty when there are no legs', () => {
    expect(deriveTripRange([])).toEqual({ startDate: '', endDate: '' });
  });

  it('uses the only leg for a single-leg trip', () => {
    expect(deriveTripRange([{ startDate: '2026-10-01', endDate: '2026-10-03', sortOrder: 0 }]))
      .toEqual({ startDate: '2026-10-01', endDate: '2026-10-03' });
  });

  it('follows route order rather than array order', () => {
    const range = deriveTripRange([
      { startDate: '2026-10-08', endDate: '2026-10-10', sortOrder: 2 },
      { startDate: '2026-10-01', endDate: '2026-10-03', sortOrder: 0 },
      { startDate: '2026-10-04', endDate: '2026-10-07', sortOrder: 1 },
    ]);
    expect(range).toEqual({ startDate: '2026-10-01', endDate: '2026-10-10' });
  });

  it('breaks sortOrder ties by start date', () => {
    const range = deriveTripRange([
      { startDate: '2026-10-05', endDate: '2026-10-06', sortOrder: 0 },
      { startDate: '2026-10-01', endDate: '2026-10-02', sortOrder: 0 },
    ]);
    expect(range).toEqual({ startDate: '2026-10-01', endDate: '2026-10-06' });
  });

  it('ignores legs missing either date', () => {
    const range = deriveTripRange([
      { startDate: '', endDate: '2026-09-01', sortOrder: 0 },
      { startDate: '2026-10-01', endDate: '2026-10-03', sortOrder: 1 },
      { startDate: '2026-11-01', endDate: '', sortOrder: 2 },
    ]);
    expect(range).toEqual({ startDate: '2026-10-01', endDate: '2026-10-03' });
  });

  it('recomputes the range for an edited leg before the store applies it', () => {
    const legs = [makeTripLeg(), makeTripLeg({ id: 'leg-2', startDate: '2026-10-04', endDate: '2026-10-06', sortOrder: 1 })];
    expect(deriveRangeAfterLegSave(legs, 'leg-2', { country: 'Portugal', city: 'Lisbon', startDate: '2026-10-04', endDate: '2026-10-12' }))
      .toEqual({ startDate: '2026-10-01', endDate: '2026-10-12' });
  });

  it('appends a new leg at the end of the route when computing the range', () => {
    const legs = [makeTripLeg()];
    expect(deriveRangeAfterLegSave(legs, null, { country: 'Portugal', city: 'Porto', startDate: '2026-09-20', endDate: '2026-09-22' }))
      .toEqual({ startDate: '2026-10-01', endDate: '2026-09-22' });
  });
});

describe('leg ordering plans', () => {
  const legs = [
    makeTripLeg({ id: 'a', sortOrder: 0 }),
    makeTripLeg({ id: 'b', sortOrder: 1, startDate: '2026-10-04', endDate: '2026-10-05' }),
    makeTripLeg({ id: 'c', sortOrder: 2, startDate: '2026-10-06', endDate: '2026-10-09' }),
  ];

  it('swaps sort orders with the neighbour', () => {
    expect(planLegSwap(legs, 'b', -1)).toEqual([{ id: 'b', sortOrder: 0 }, { id: 'a', sortOrder: 1 }]);
    expect(planLegSwap(legs, 'b', 1)).toEqual([{ id: 'b', sortOrder: 2 }, { id: 'c', sortOrder: 1 }]);
  });

  it('does nothing past either end or for an unknown leg', () => {
    expect(planLegSwap(legs, 'a', -1)).toBeNull();
    expect(planLegSwap(legs, 'c', 1)).toBeNull();
    expect(planLegSwap(legs, 'missing', 1)).toBeNull();
  });

  it('renumbers the remaining legs and refits the range on removal', () => {
    const { reindexed, range } = planLegRemoval(legs, 'a');
    expect(reindexed.map(leg => [leg.id, leg.sortOrder])).toEqual([['b', 0], ['c', 1]]);
    expect(range).toEqual({ startDate: '2026-10-04', endDate: '2026-10-09' });
  });

  it('leaves an empty range when the last leg is removed', () => {
    expect(planLegRemoval([legs[0]], 'a')).toEqual({ reindexed: [], range: { startDate: '', endDate: '' } });
  });

  it('turns wizard route drafts into ordered, trimmed leg inputs', () => {
    expect(buildRouteLegInputs([legDraft({ id: 'x', country: ' Spain ', city: ' Madrid ', endDate: '' })])).toEqual([
      { draftId: 'x', country: 'Spain', city: 'Madrid', startDate: '2026-10-01', endDate: '2026-10-01', sortOrder: 0 },
    ]);
  });
});

describe('local date math', () => {
  it('expands a range across a month and a year boundary', () => {
    expect(expandDateRange('2026-12-30', '2027-01-02')).toEqual(['2026-12-30', '2026-12-31', '2027-01-01', '2027-01-02']);
    expect(expandDateRange('2026-02-27', '2026-03-01')).toEqual(['2026-02-27', '2026-02-28', '2026-03-01']);
  });

  it('is empty when either end is missing or the range is reversed', () => {
    expect(expandDateRange('', '2026-10-01')).toEqual([]);
    expect(expandDateRange('2026-10-01', '')).toEqual([]);
    expect(expandDateRange('2026-10-05', '2026-10-01')).toEqual([]);
  });

  it('builds datetime-local values and adds hours across midnight into a new year', () => {
    expect(buildLocalDateTime('2026-12-31', 9)).toBe('2026-12-31T09:00');
    expect(addHoursToLocalDateTime('2026-12-31T23:30', 2)).toBe('2027-01-01T01:30');
  });
});

describe('booking drafts', () => {
  it('defaults a transport draft to 09:00 on the seed start with a two-hour trip', () => {
    const draft = buildTransportDraft({ legId: 'leg-1', startDate: '2026-10-01', endDate: '2026-10-03' }, TODAY);
    expect(draft).toMatchObject({ legId: 'leg-1', departAt: '2026-10-01T09:00', arriveAt: '2026-10-01T11:00', budgetDate: '2026-10-01' });
  });

  it('falls back to today when the seed has no dates', () => {
    expect(buildStayDraft({}, TODAY)).toMatchObject({ checkInDate: TODAY, checkOutDate: TODAY, budgetDate: TODAY });
  });

  it('fills blank transport times from the seed when materialized', () => {
    const draft = materializeBookingDraft(transportDraft({ departAt: '', arriveAt: '' }), { startDate: '2026-10-04' }, TODAY);
    expect(draft).toMatchObject({ departAt: '2026-10-04T09:00', arriveAt: '2026-10-04T11:00', budgetDate: '2026-10-04' });
  });

  it('reseeds untouched dates and places when the destination changes', () => {
    const seeds: Record<string, { legId: string; city: string; country: string; startDate: string; endDate: string }> = {
      madrid: { legId: 'madrid', city: 'Madrid', country: 'Spain', startDate: '2026-10-01', endDate: '2026-10-03' },
      lisbon: { legId: 'lisbon', city: 'Lisbon', country: 'Portugal', startDate: '2026-10-04', endDate: '2026-10-06' },
    };
    const seedFor = (legId?: string) => (legId ? seeds[legId] : {});
    const madridStay = buildStayDraft(seeds.madrid, TODAY);

    const moved = applyBookingDraftUpdate(madridStay, { legId: 'lisbon' }, seedFor, TODAY);

    expect(moved).toMatchObject({ legId: 'lisbon', city: 'Lisbon', country: 'Portugal', checkInDate: '2026-10-04', checkOutDate: '2026-10-06' });
  });

  it('keeps a person-edited check-in when the destination changes', () => {
    const seedFor = (legId?: string) => (legId === 'lisbon' ? { legId, startDate: '2026-10-04', endDate: '2026-10-06' } : {});
    const edited = stayDraft({ checkInDate: '2026-11-01', checkOutDate: '2026-11-02' });

    expect(applyBookingDraftUpdate(edited, { legId: 'lisbon' }, seedFor, TODAY)).toMatchObject({ checkInDate: '2026-11-01', checkOutDate: '2026-11-02' });
  });

  it('moves a default arrival along with a new departure', () => {
    const draft = transportDraft({ departAt: '2026-10-01T09:00', arriveAt: '2026-10-01T11:00' });
    expect(applyBookingDraftUpdate(draft, { departAt: '2026-10-02T20:00' }, () => ({}), TODAY))
      .toMatchObject({ arriveAt: '2026-10-02T22:00', budgetDate: '2026-10-02' });
  });

  it('keeps a check-out that the person set explicitly', () => {
    const draft = stayDraft({ checkInDate: '2026-10-01', checkOutDate: '2026-10-03' });
    expect(applyBookingDraftUpdate(draft, { checkOutDate: '2026-09-30' }, () => ({}), TODAY)).toMatchObject({ checkOutDate: '2026-09-30' });
  });

  it('pulls check-out forward when check-in moves past it', () => {
    const draft = stayDraft({ checkInDate: '2026-10-01', checkOutDate: '2026-10-03' });
    expect(applyBookingDraftUpdate(draft, { checkInDate: '2026-10-05' }, () => ({}), TODAY))
      .toMatchObject({ checkOutDate: '2026-10-05', budgetDate: '2026-10-05' });
  });

  it('maps a saved booking back into an editable draft', () => {
    const draft = mapBookingToDraft(makeTransportBooking({ budgetAmount: 12050, departAt: '2026-10-04T09:00:00.000Z' }));
    expect(draft).toMatchObject({ kind: 'transport', budgetAmount: '120.50', budgetStatus: 'planned', departAt: '2026-10-04T09:00', budgetDate: '2026-10-04' });
  });
});

describe('booking validation', () => {
  it('accepts a valid transport and stay draft', () => {
    expect(getBookingValidationMessage(transportDraft({ budgetAmount: '120.00' }))).toBeNull();
    expect(getBookingValidationMessage(stayDraft({ checkInDate: '2026-10-01', checkOutDate: '2026-10-01' }))).toBeNull();
  });

  it('rejects an unreadable cost', () => {
    expect(getBookingValidationMessage(transportDraft({ budgetAmount: 'lots' }))).toBe('Enter a valid booking cost or leave the cost blank for now.');
    expect(getBookingValidationMessage(transportDraft({ budgetAmount: '-5' }))).toBe('Enter a valid booking cost or leave the cost blank for now.');
  });

  it('rejects arrival before departure and check-out before check-in', () => {
    expect(getBookingValidationMessage(transportDraft({ departAt: '2026-10-01T09:00', arriveAt: '2026-10-01T08:00' })))
      .toBe('Arrival needs to be after the departure time.');
    expect(getBookingValidationMessage(stayDraft({ checkInDate: '2026-10-02', checkOutDate: '2026-10-01' })))
      .toBe('Check-out needs to be on or after the check-in date.');
  });

  it('numbers the first invalid wizard booking', () => {
    const bookings = [stayDraft(), transportDraft({ departAt: '2026-10-01T09:00', arriveAt: '2026-10-01T08:00' })];
    expect(findWizardBookingValidationMessage(bookings)).toBe('Transport booking 2: Arrival needs to be after the departure time.');
    expect(findWizardBookingValidationMessage([stayDraft()])).toBeNull();
  });
});

describe('wizard steps', () => {
  it('needs a name before the route, and a complete route before bookings', () => {
    const draft = createEmptyWizardDraft();
    expect(canAdvanceWizardStep('basics', draft)).toBe(false);
    expect(canAdvanceWizardStep('basics', { ...draft, tripName: 'Summer' })).toBe(true);
    expect(canAdvanceWizardStep('route', draft)).toBe(false);
    expect(canAdvanceWizardStep('route', { ...draft, routeDrafts: [legDraft()] })).toBe(true);
    expect(canAdvanceWizardStep('route', { ...draft, routeDrafts: [legDraft({ endDate: '2026-09-30' })] })).toBe(false);
    expect(canAdvanceWizardStep('route', { ...draft, routeDrafts: [] })).toBe(false);
  });

  it('moves between steps and stops at either end', () => {
    expect(nextWizardStep('basics')).toBe('route');
    expect(nextWizardStep('review')).toBe('review');
    expect(previousWizardStep('bookings')).toBe('route');
    expect(previousWizardStep('basics')).toBe('basics');
  });

  it('treats two fresh drafts as the same despite generated ids', () => {
    expect(serializeWizardDraft(createEmptyWizardDraft())).toBe(serializeWizardDraft(createEmptyWizardDraft()));
  });
});

describe('payloads', () => {
  it('trims trip basics and normalizes the budget', () => {
    expect(buildTripBasicsPayload({
      tripName: ' Summer ', tripSummary: ' Sun ', tripNotes: ' keep ', tripStatus: 'booked', tripBudgetCurrency: 'eur', tripBudgetTotal: '1,250.5',
    })).toEqual({ name: 'Summer', summary: 'Sun', notes: ' keep ', status: 'booked', budgetCurrency: 'EUR', budgetTotal: 125050 });
  });

  it('zeroes an unreadable trip budget and defaults a blank currency', () => {
    expect(buildTripBasicsPayload({
      tripName: 'A', tripSummary: '', tripNotes: '', tripStatus: 'planning', tripBudgetCurrency: '', tripBudgetTotal: 'abc',
    })).toMatchObject({ budgetCurrency: 'GBP', budgetTotal: 0 });
  });

  it('builds a transport payload with a destination-derived title', () => {
    const payload = buildBookingPayload(
      transportDraft({ legId: 'leg-1', mode: 'train', budgetAmount: '45', provider: ' Renfe ', departAt: '2026-10-04T09:00', arriveAt: '2026-10-04T12:00', budgetDate: '' }),
      'trip-1',
      { city: 'Lisbon', country: 'Portugal' },
    );
    expect(payload).toMatchObject({
      kind: 'transport', tripId: 'trip-1', legId: 'leg-1', title: 'Train to Lisbon', toLabel: 'Lisbon, Portugal',
      budgetAmount: 4500, budgetDate: '2026-10-04', provider: 'Renfe', confirmationCode: undefined, link: undefined,
    });
  });

  it('builds a stay payload that inherits its place from the seed', () => {
    const payload = buildBookingPayload(stayDraft({ legId: '', city: '', country: '', budgetAmount: '' }), 'trip-1', { city: 'Madrid', country: 'Spain' });
    expect(payload).toMatchObject({ kind: 'stay', legId: undefined, title: 'Stay in Madrid', propertyName: 'Accommodation', city: 'Madrid', country: 'Spain', budgetAmount: undefined });
  });
});

describe('seeds and planner views', () => {
  it('seeds from the chosen leg, or from the trip dates when none is chosen', () => {
    const trip = makeTrip();
    const legs = [makeTripLeg({ city: ' Madrid ' })];
    expect(buildTripBookingSeed(trip, legs, 'leg-1')).toEqual({ legId: 'leg-1', city: 'Madrid', country: 'Spain', startDate: '2026-10-01', endDate: '2026-10-03' });
    expect(buildTripBookingSeed(trip, legs)).toEqual({ startDate: '2026-10-01', endDate: '2026-10-06' });
  });

  it('seeds wizard bookings from the whole draft route when no leg is chosen', () => {
    const route = [legDraft({ id: 'b', startDate: '2026-10-04', endDate: '2026-10-06' }), legDraft({ id: 'a', startDate: '2026-10-01', endDate: '' })];
    expect(buildRouteDraftBookingSeed(route)).toEqual({ startDate: '2026-10-04', endDate: '2026-10-01' });
    expect(buildRouteDraftBookingSeed(route, 'a')).toMatchObject({ legId: 'a', startDate: '2026-10-01', endDate: '2026-10-01' });
  });

  it('lists upcoming bookings soonest first, then past bookings most recent first', () => {
    const nowMs = new Date('2026-10-04T12:00:00Z').getTime();
    const past1 = makeTransportBooking({ id: 'past-early', departAt: '2026-10-01T09:00', arriveAt: '2026-10-01T10:00' });
    const past2 = makeTransportBooking({ id: 'past-late', departAt: '2026-10-03T09:00', arriveAt: '2026-10-03T10:00' });
    const soon = makeStayBooking({ id: 'soon', checkInDate: '2026-10-04', checkOutDate: '2026-10-05' });
    const later = makeTransportBooking({ id: 'later', departAt: '2026-10-08T09:00', arriveAt: '2026-10-08T10:00' });
    expect(sortBookingsForDisplay([past1, later, past2, soon], nowMs).map(booking => booking.id)).toEqual(['soon', 'later', 'past-late', 'past-early']);
  });

  it('filters by trip text or leg place and puts finished trips last', () => {
    const trips = [
      makeTrip({ id: 'done', name: 'Old', status: 'completed', startDate: '2026-01-01' }),
      makeTrip({ id: 'later', name: 'Later', startDate: '2026-12-01' }),
      makeTrip({ id: 'soon', name: 'Soon', startDate: '2026-10-01' }),
    ];
    const legsByTrip = groupLegsByTrip([makeTripLeg({ tripId: 'later', city: 'Kyoto' })]);
    expect(filterTrips(trips, legsByTrip, '').map(trip => trip.id)).toEqual(['soon', 'later', 'done']);
    expect(filterTrips(trips, legsByTrip, ' kyoto ').map(trip => trip.id)).toEqual(['later']);
  });

  it('keeps a visible selection and otherwise falls back', () => {
    const [a, b] = [makeTrip({ id: 'a' }), makeTrip({ id: 'b' })];
    expect(resolveSelectedTripId('b', [a, b], [a, b])).toBe('b');
    expect(resolveSelectedTripId('b', [a], [a, b])).toBe('a');
    expect(resolveSelectedTripId('b', [], [a, b])).toBe('a');
    expect(resolveSelectedTripId(null, [], [])).toBeNull();
  });

  it('shows bookings on the leg days they touch, including bookings tied to no leg', () => {
    const leg = makeTripLeg({ startDate: '2026-10-01', endDate: '2026-10-02' });
    const stay = makeStayBooking({ legId: 'leg-1', checkInDate: '2026-10-01', checkOutDate: '2026-10-02' });
    const train = makeTransportBooking({ legId: undefined, departAt: '2026-10-02T09:00', arriveAt: '2026-10-02T10:00' });
    const elsewhere = makeStayBooking({ id: 'other', legId: 'leg-9', checkInDate: '2026-10-01', checkOutDate: '2026-10-02' });
    const byDay = groupBookingsByDay([leg], [stay, train, elsewhere]);
    expect(byDay.get('leg-1:2026-10-01')?.map(booking => booking.id)).toEqual(['booking-stay']);
    expect(byDay.get('leg-1:2026-10-02')?.map(booking => booking.id)).toEqual(['booking-stay', 'booking-transport']);
  });

  it('orders a new plan after the other plans on that day', () => {
    const items = [makeItineraryItem(), makeItineraryItem({ id: 'item-2' }), makeItineraryItem({ id: 'item-3', date: '2026-10-02' })];
    expect(nextItinerarySortOrder(items, 'leg-1', '2026-10-01', null)).toBe(2);
    expect(nextItinerarySortOrder(items, 'leg-1', '2026-10-01', 'item-2')).toBe(1);
  });
});
