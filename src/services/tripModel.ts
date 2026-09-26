/**
 * Trip planning rules with no React: editor draft shapes, date math on
 * `YYYY-MM-DD` keys, route ordering and trip range derivation, booking draft
 * defaults and validation, and the payloads the Trip store mutators accept.
 *
 * "Today" is always a parameter. Trips pass the device-local date because the
 * dates people type into Trip editors are device-local `date` and
 * `datetime-local` values (see `localDate.ts`).
 */
import { TRIP_BUDGET } from '../config/constants';
import type {
  Trip,
  TripBooking,
  TripBookingInput,
  TripBudgetEntryStatus,
  TripItineraryItem,
  TripLeg,
  TripStatus,
  TripStayBooking,
  TripTransportBooking,
  TripTransportMode,
} from '../types/domain';
import { addLocalDays, toLocalDateStr } from './localDate';
import { formatBudgetAmountInput, getBookingBudgetDate, parseBudgetAmountInput, resolveTripBudgetInput } from './tripBudget';
import { buildStayDisplayTitle, buildTransportDisplayTitle, getDestinationLabel } from './tripDisplay';

// ── Draft shapes ──

export type WizardStep = 'basics' | 'route' | 'bookings' | 'review';
export type BookingKind = TripBooking['kind'];

export interface LegDraft {
  id: string;
  country: string;
  city: string;
  startDate: string;
  endDate: string;
}

interface BookingDraftBase {
  id: string;
  legId?: string;
  title: string;
  budgetAmount: string;
  budgetStatus: TripBudgetEntryStatus;
  budgetDate: string;
  provider: string;
  confirmationCode: string;
  link: string;
  notes: string;
}

export interface TransportBookingDraft extends BookingDraftBase {
  kind: 'transport';
  mode: TripTransportMode;
  fromLabel: string;
  toLabel: string;
  departAt: string;
  arriveAt: string;
}

export interface StayBookingDraft extends BookingDraftBase {
  kind: 'stay';
  propertyName: string;
  address: string;
  city: string;
  country: string;
  checkInDate: string;
  checkOutDate: string;
}

export type BookingDraft = TransportBookingDraft | StayBookingDraft;

/** Every field of the Trip basics form, shared by the Plan Trip wizard and the Trip editor. */
export interface TripBasicsDraft {
  tripName: string;
  tripSummary: string;
  tripNotes: string;
  tripStatus: TripStatus;
  tripBudgetCurrency: string;
  tripBudgetTotal: string;
}

export interface WizardDraftState extends TripBasicsDraft {
  routeDrafts: LegDraft[];
  wizardBookings: BookingDraft[];
}

export interface LegFormDraft {
  country: string;
  city: string;
  startDate: string;
  endDate: string;
}

export interface ItineraryFormDraft {
  legId: string;
  date: string;
  title: string;
  startTime: string;
  endTime: string;
  location: string;
  notes: string;
}

/** The destination and dates a new booking inherits from its leg or trip. */
export interface BookingSeed {
  legId?: string;
  city?: string;
  country?: string;
  startDate?: string;
  endDate?: string;
}

export interface BookingSeedableLeg {
  id: string;
  city: string;
  country: string;
  startDate: string;
  endDate: string;
}

export type TripRange = Pick<Trip, 'startDate' | 'endDate'>;

export const TRIP_STATUS_OPTIONS: TripStatus[] = ['planning', 'booked', 'in_trip', 'completed', 'archived'];
export const TRANSPORT_MODE_OPTIONS: TripTransportMode[] = ['flight', 'train', 'bus', 'ferry', 'car', 'other'];
export const WIZARD_STEPS: WizardStep[] = ['basics', 'route', 'bookings', 'review'];

/** Hours a new transport booking lasts until the person sets an arrival. */
const DEFAULT_TRANSPORT_HOURS = 2;
/** Local hour a new transport booking departs until the person sets one. */
const DEFAULT_DEPARTURE_HOUR = 9;

export function createDraftId(prefix: string): string {
  return `${prefix}-${Math.random().toString(36).slice(2, 10)}`;
}

export function createEmptyLegDraft(): LegDraft {
  return { id: createDraftId('leg'), country: '', city: '', startDate: '', endDate: '' };
}

export function createEmptyWizardDraft(): WizardDraftState {
  return {
    tripName: '',
    tripSummary: '',
    tripNotes: '',
    tripStatus: 'planning',
    tripBudgetCurrency: TRIP_BUDGET.DEFAULT_CURRENCY,
    tripBudgetTotal: '',
    routeDrafts: [createEmptyLegDraft()],
    wizardBookings: [],
  };
}

/** Draft identity for dirty checks: ignores generated draft ids. */
export function serializeWizardDraft(draft: WizardDraftState): string {
  return JSON.stringify(draft, (key, value) => key === 'id' ? undefined : value);
}

export function mapTripToBasicsDraft(trip: Trip): TripBasicsDraft {
  return {
    tripName: trip.name,
    tripSummary: trip.summary,
    tripNotes: trip.notes,
    tripStatus: trip.status,
    tripBudgetCurrency: trip.budgetCurrency || TRIP_BUDGET.DEFAULT_CURRENCY,
    tripBudgetTotal: formatBudgetAmountInput(trip.budgetTotal || 0),
  };
}

export function buildTripBasicsPayload(draft: TripBasicsDraft): Pick<Trip, 'name' | 'summary' | 'notes' | 'status'> & { budgetCurrency: string; budgetTotal: number } {
  return {
    name: draft.tripName.trim(),
    summary: draft.tripSummary.trim(),
    notes: draft.tripNotes,
    status: draft.tripStatus,
    ...resolveTripBudgetInput(draft.tripBudgetCurrency, draft.tripBudgetTotal),
  };
}

// ── Date math ──

function toLocalDateTimeInput(date: Date): string {
  return `${toLocalDateStr(date)}T${String(date.getHours()).padStart(2, '0')}:${String(date.getMinutes()).padStart(2, '0')}`;
}

/** A `datetime-local` value at the given local hour of a `YYYY-MM-DD` day. */
export function buildLocalDateTime(value: string, hours: number, minutes = 0): string {
  const next = new Date(`${value}T00:00:00`);
  next.setHours(hours, minutes, 0, 0);
  return toLocalDateTimeInput(next);
}

export function addHoursToLocalDateTime(value: string, hours: number): string {
  const next = new Date(value);
  next.setHours(next.getHours() + hours);
  return toLocalDateTimeInput(next);
}

/** Every `YYYY-MM-DD` day from start to end inclusive; empty when either end is missing. */
export function expandDateRange(startDate: string, endDate: string): string[] {
  if (!startDate || !endDate) return [];
  const days: string[] = [];
  let cursor: string | null = startDate;
  while (cursor && cursor <= endDate) {
    days.push(cursor);
    cursor = addLocalDays(cursor, 1);
  }
  return days;
}

export function getBookingDateRange(seed: BookingSeed, today: string): TripRange {
  const startDate = seed.startDate || seed.endDate || today;
  const endDate = seed.endDate || seed.startDate || startDate;
  return { startDate, endDate };
}

// ── Ordering and range ──

export function compareLegs(left: TripLeg, right: TripLeg): number {
  if (left.sortOrder !== right.sortOrder) return left.sortOrder - right.sortOrder;
  if (left.startDate !== right.startDate) return left.startDate.localeCompare(right.startDate);
  return left.city.localeCompare(right.city);
}

export function compareItinerary(left: TripItineraryItem, right: TripItineraryItem): number {
  if (left.startTime && right.startTime && left.startTime !== right.startTime) return left.startTime.localeCompare(right.startTime);
  if (left.startTime && !right.startTime) return -1;
  if (!left.startTime && right.startTime) return 1;
  return left.sortOrder - right.sortOrder;
}

/**
 * The trip's start and end from its legs: the first dated leg's start and the
 * last dated leg's end, in route order (sortOrder, then start date). Legs
 * missing either date are ignored; no dated legs gives an empty range.
 */
export function deriveTripRange(legs: Array<Pick<TripLeg, 'startDate' | 'endDate' | 'sortOrder'>>): TripRange {
  const valid = legs.filter(leg => leg.startDate && leg.endDate).sort((left, right) => {
    if (left.sortOrder !== right.sortOrder) return left.sortOrder - right.sortOrder;
    return left.startDate.localeCompare(right.startDate);
  });
  return {
    startDate: valid[0]?.startDate || '',
    endDate: valid[valid.length - 1]?.endDate || valid[0]?.startDate || '',
  };
}

/** Range after saving the leg editor, before the store has applied the leg write. */
export function deriveRangeAfterLegSave(legs: TripLeg[], editingLegId: string | null, form: LegFormDraft): TripRange {
  if (editingLegId) {
    return deriveTripRange(legs.map(leg => leg.id === editingLegId ? { ...leg, startDate: form.startDate, endDate: form.endDate } : leg));
  }
  return deriveTripRange([...legs, { startDate: form.startDate, endDate: form.endDate, sortOrder: legs.length }]);
}

/** The two sortOrder writes that move a leg one place earlier (-1) or later (1), or null at either end. */
export function planLegSwap(orderedLegs: TripLeg[], legId: string, direction: -1 | 1): Array<{ id: string; sortOrder: number }> | null {
  const index = orderedLegs.findIndex(item => item.id === legId);
  const nextIndex = index + direction;
  if (index < 0 || nextIndex < 0 || nextIndex >= orderedLegs.length) return null;
  const leg = orderedLegs[index];
  const swap = orderedLegs[nextIndex];
  return [
    { id: leg.id, sortOrder: swap.sortOrder },
    { id: swap.id, sortOrder: leg.sortOrder },
  ];
}

/** The remaining legs renumbered 0..n-1 in route order, and the trip range they leave. */
export function planLegRemoval(orderedLegs: TripLeg[], legId: string): { reindexed: TripLeg[]; range: TripRange } {
  const reindexed = orderedLegs.filter(item => item.id !== legId).map((item, index) => ({ ...item, sortOrder: index }));
  return { reindexed, range: deriveTripRange(reindexed) };
}

/** Wizard route drafts as leg inputs in route order, with a missing end date defaulting to the start. */
export function buildRouteLegInputs(routeDrafts: LegDraft[]): Array<{ draftId: string; country: string; city: string; startDate: string; endDate: string; sortOrder: number }> {
  return routeDrafts.map((draft, index) => ({
    draftId: draft.id,
    country: draft.country.trim(),
    city: draft.city.trim(),
    startDate: draft.startDate,
    endDate: draft.endDate || draft.startDate,
    sortOrder: index,
  }));
}

// ── Booking timing ──

export function getBookingStartMs(booking: TripBooking): number {
  const value = booking.kind === 'transport' ? booking.departAt : `${booking.checkInDate}T00:00:00`;
  return new Date(value).getTime();
}

export function getBookingEndMs(booking: TripBooking): number {
  const value = booking.kind === 'transport' ? (booking.arriveAt || booking.departAt) : `${booking.checkOutDate}T23:59:00`;
  return new Date(value).getTime();
}

export function isUpcomingBooking(booking: TripBooking, nowMs: number): boolean {
  return getBookingEndMs(booking) >= nowMs;
}

/** Upcoming bookings first, soonest first; then past bookings, most recent first. */
export function sortBookingsForDisplay(bookings: TripBooking[], nowMs: number): TripBooking[] {
  return [...bookings].sort((left, right) => {
    const leftUpcoming = isUpcomingBooking(left, nowMs);
    const rightUpcoming = isUpcomingBooking(right, nowMs);
    if (leftUpcoming !== rightUpcoming) return leftUpcoming ? -1 : 1;
    if (leftUpcoming) return getBookingStartMs(left) - getBookingStartMs(right);
    return getBookingStartMs(right) - getBookingStartMs(left);
  });
}

export function bookingMatchesDate(booking: TripBooking, date: string): boolean {
  if (booking.kind === 'transport') {
    return booking.departAt.slice(0, 10) === date || booking.arriveAt.slice(0, 10) === date;
  }
  return booking.checkInDate <= date && booking.checkOutDate >= date;
}

// ── Grouping for the planner views ──

export function groupLegsByTrip(legs: TripLeg[]): Map<string, TripLeg[]> {
  const map = new Map<string, TripLeg[]>();
  legs.forEach(leg => {
    const current = map.get(leg.tripId) || [];
    current.push(leg);
    map.set(leg.tripId, current);
  });
  map.forEach((tripLegs, tripId) => map.set(tripId, [...tripLegs].sort(compareLegs)));
  return map;
}

/** Trips matching the search, active ones soonest first, then completed and archived most recent first. */
export function filterTrips(trips: Trip[], legsByTrip: Map<string, TripLeg[]>, searchQuery: string): Trip[] {
  const query = searchQuery.trim().toLowerCase();
  const matching = trips.filter(trip => {
    if (!query) return true;
    const tripLegs = legsByTrip.get(trip.id) || [];
    return trip.name.toLowerCase().includes(query)
      || trip.summary.toLowerCase().includes(query)
      || trip.notes.toLowerCase().includes(query)
      || tripLegs.some(leg => leg.city.toLowerCase().includes(query) || leg.country.toLowerCase().includes(query));
  });
  const isInactive = (trip: Trip) => trip.status === 'completed' || trip.status === 'archived';
  const active = matching.filter(trip => !isInactive(trip)).sort((left, right) => left.startDate.localeCompare(right.startDate));
  const inactive = matching.filter(isInactive).sort((left, right) => right.startDate.localeCompare(left.startDate));
  return [...active, ...inactive];
}

/** Keep the chosen trip while it is visible; otherwise fall back to the first visible, then the first trip. */
export function resolveSelectedTripId(selectedId: string | null, visibleTrips: Trip[], allTrips: Trip[]): string | null {
  if (selectedId && visibleTrips.some(trip => trip.id === selectedId)) return selectedId;
  return visibleTrips[0]?.id || allTrips[0]?.id || null;
}

export function sortItinerary(items: TripItineraryItem[]): TripItineraryItem[] {
  return [...items].sort((left, right) => {
    if (left.date !== right.date) return left.date.localeCompare(right.date);
    return compareItinerary(left, right);
  });
}

export function dayKey(legId: string, date: string): string {
  return `${legId}:${date}`;
}

export function groupItineraryByDay(items: TripItineraryItem[]): Map<string, TripItineraryItem[]> {
  const map = new Map<string, TripItineraryItem[]>();
  items.forEach(item => {
    const key = dayKey(item.legId, item.date);
    const current = map.get(key) || [];
    current.push(item);
    map.set(key, current);
  });
  map.forEach((dayItems, key) => map.set(key, [...dayItems].sort(compareItinerary)));
  return map;
}

/** Bookings shown on each leg day: those on that date that are tied to the leg or to no leg. */
export function groupBookingsByDay(legs: TripLeg[], bookings: TripBooking[]): Map<string, TripBooking[]> {
  const map = new Map<string, TripBooking[]>();
  legs.forEach(leg => {
    expandDateRange(leg.startDate, leg.endDate).forEach(date => {
      map.set(dayKey(leg.id, date), bookings.filter(booking => (!booking.legId || booking.legId === leg.id) && bookingMatchesDate(booking, date)));
    });
  });
  return map;
}

// ── Booking seeds ──

export function buildBookingSeedFromLeg(leg?: BookingSeedableLeg): BookingSeed {
  if (!leg) return {};
  return {
    legId: leg.id,
    city: leg.city.trim(),
    country: leg.country.trim(),
    startDate: leg.startDate,
    endDate: leg.endDate || leg.startDate,
  };
}

/** Seed for a saved trip: the chosen leg, or the whole trip's dates when no leg is chosen. */
export function buildTripBookingSeed(trip: TripRange | null, legs: BookingSeedableLeg[], legId?: string): BookingSeed {
  if (legId) return buildBookingSeedFromLeg(legs.find(leg => leg.id === legId));
  return { startDate: trip?.startDate, endDate: trip?.endDate };
}

/** Seed for the Plan Trip wizard: the chosen route draft, or the range the whole draft route covers. */
export function buildRouteDraftBookingSeed(routeDrafts: LegDraft[], legId?: string): BookingSeed {
  if (legId) return buildBookingSeedFromLeg(routeDrafts.find(leg => leg.id === legId));
  const range = deriveTripRange(routeDrafts.map((leg, index) => ({
    startDate: leg.startDate || leg.endDate,
    endDate: leg.endDate || leg.startDate,
    sortOrder: index,
  })));
  return { startDate: range.startDate, endDate: range.endDate };
}

// ── Booking drafts ──

export function buildTransportDraft(seed: BookingSeed, today: string): TransportBookingDraft {
  const { startDate } = getBookingDateRange(seed, today);
  const departAt = buildLocalDateTime(startDate, DEFAULT_DEPARTURE_HOUR);
  return {
    id: createDraftId('transport'),
    kind: 'transport',
    legId: seed.legId,
    mode: 'flight',
    title: '',
    fromLabel: '',
    toLabel: '',
    departAt,
    arriveAt: addHoursToLocalDateTime(departAt, DEFAULT_TRANSPORT_HOURS),
    budgetAmount: '',
    budgetStatus: 'planned',
    budgetDate: startDate,
    provider: '',
    confirmationCode: '',
    link: '',
    notes: '',
  };
}

export function buildStayDraft(seed: BookingSeed, today: string): StayBookingDraft {
  const { startDate, endDate } = getBookingDateRange(seed, today);
  return {
    id: createDraftId('stay'),
    kind: 'stay',
    legId: seed.legId,
    title: '',
    propertyName: '',
    address: '',
    city: seed.city || '',
    country: seed.country || '',
    checkInDate: startDate,
    checkOutDate: endDate,
    budgetAmount: '',
    budgetStatus: 'planned',
    budgetDate: startDate,
    provider: '',
    confirmationCode: '',
    link: '',
    notes: '',
  };
}

export function buildBookingDraft(kind: BookingKind, seed: BookingSeed, today: string): BookingDraft {
  return kind === 'transport' ? buildTransportDraft(seed, today) : buildStayDraft(seed, today);
}

/** Fill blank dates and places from the seed so a draft can be validated and saved. */
export function materializeBookingDraft(draft: BookingDraft, seed: BookingSeed, today: string): BookingDraft {
  if (draft.kind === 'transport') {
    const seededDraft = buildTransportDraft({ ...seed, legId: draft.legId || seed.legId }, today);
    const departAt = draft.departAt || seededDraft.departAt;
    return {
      ...seededDraft,
      ...draft,
      legId: draft.legId || seed.legId,
      departAt,
      arriveAt: draft.arriveAt || addHoursToLocalDateTime(departAt, DEFAULT_TRANSPORT_HOURS),
      budgetDate: departAt.slice(0, 10),
    };
  }

  const seededDraft = buildStayDraft({ ...seed, legId: draft.legId || seed.legId }, today);
  const checkInDate = draft.checkInDate || seededDraft.checkInDate;
  return {
    ...seededDraft,
    ...draft,
    legId: draft.legId || seed.legId,
    city: draft.city || seededDraft.city,
    country: draft.country || seededDraft.country,
    checkInDate,
    checkOutDate: draft.checkOutDate || checkInDate || seededDraft.checkOutDate,
    budgetDate: checkInDate || seededDraft.checkInDate,
  };
}

/** Move a draft to another destination, replacing only the fields still at the old destination's defaults. */
export function applySeedToExistingBookingDraft(draft: BookingDraft, previousSeed: BookingSeed, nextSeed: BookingSeed, today: string): BookingDraft {
  if (draft.kind === 'transport') {
    const previousDefaults = buildTransportDraft({ ...previousSeed, legId: draft.legId || previousSeed.legId }, today);
    const nextDefaults = buildTransportDraft(nextSeed, today);
    return {
      ...draft,
      legId: nextSeed.legId,
      departAt: !draft.departAt || draft.departAt === previousDefaults.departAt ? nextDefaults.departAt : draft.departAt,
      arriveAt: !draft.arriveAt || draft.arriveAt === previousDefaults.arriveAt ? nextDefaults.arriveAt : draft.arriveAt,
      budgetDate: (!draft.budgetDate || draft.budgetDate === previousDefaults.budgetDate) ? nextDefaults.budgetDate : draft.budgetDate,
    };
  }

  const previousDefaults = buildStayDraft({ ...previousSeed, legId: draft.legId || previousSeed.legId }, today);
  const nextDefaults = buildStayDraft(nextSeed, today);
  return {
    ...draft,
    legId: nextSeed.legId,
    city: !draft.city || draft.city === previousDefaults.city ? nextDefaults.city : draft.city,
    country: !draft.country || draft.country === previousDefaults.country ? nextDefaults.country : draft.country,
    checkInDate: !draft.checkInDate || draft.checkInDate === previousDefaults.checkInDate ? nextDefaults.checkInDate : draft.checkInDate,
    checkOutDate: !draft.checkOutDate || draft.checkOutDate === previousDefaults.checkOutDate ? nextDefaults.checkOutDate : draft.checkOutDate,
    budgetDate: (!draft.budgetDate || draft.budgetDate === previousDefaults.budgetDate) ? nextDefaults.budgetDate : draft.budgetDate,
  };
}

/** Keep arrival, check-out, and budget date consistent after a departure or check-in edit. */
export function syncBookingDependentFields(previous: BookingDraft, next: BookingDraft, updates: Partial<BookingDraft>): BookingDraft {
  if (next.kind === 'transport' && previous.kind === 'transport') {
    if ('arriveAt' in updates || !next.departAt) return next;
    const previousDefaultArrival = previous.departAt ? addHoursToLocalDateTime(previous.departAt, DEFAULT_TRANSPORT_HOURS) : '';
    const arrivalWasDefault = !previous.arriveAt || previous.arriveAt === previousDefaultArrival;
    if (!next.arriveAt || (arrivalWasDefault && previous.departAt !== next.departAt) || (arrivalWasDefault && new Date(next.arriveAt).getTime() < new Date(next.departAt).getTime())) {
      return {
        ...next,
        arriveAt: addHoursToLocalDateTime(next.departAt, DEFAULT_TRANSPORT_HOURS),
        budgetDate: next.departAt.slice(0, 10),
      };
    }
    return {
      ...next,
      budgetDate: next.departAt.slice(0, 10),
    };
  }

  if (next.kind === 'stay' && previous.kind === 'stay') {
    if ('checkOutDate' in updates) return next;
    if (next.checkInDate && (!next.checkOutDate || next.checkOutDate < next.checkInDate)) {
      return {
        ...next,
        checkOutDate: next.checkInDate,
        budgetDate: next.checkInDate,
      };
    }
    return {
      ...next,
      budgetDate: next.checkInDate,
    };
  }

  return next;
}

/** Wizard bookings with blank fields filled from their draft destination, ready to validate and save. */
export function prepareWizardBookings(draft: WizardDraftState, today: string): BookingDraft[] {
  return draft.wizardBookings.map(booking => materializeBookingDraft(booking, buildRouteDraftBookingSeed(draft.routeDrafts, booking.legId), today));
}

/** Apply one booking form edit, reseeding defaults when the destination changes. */
export function applyBookingDraftUpdate(
  previous: BookingDraft,
  updates: Partial<BookingDraft>,
  seedFor: (legId?: string) => BookingSeed,
  today: string,
): BookingDraft {
  const nextDraft = { ...previous, ...updates } as BookingDraft;
  if ('legId' in updates) {
    return syncBookingDependentFields(
      previous,
      applySeedToExistingBookingDraft(nextDraft, seedFor(previous.legId), seedFor(updates.legId), today),
      updates,
    );
  }
  return syncBookingDependentFields(previous, nextDraft, updates);
}

export function mapBookingToDraft(booking: TripBooking): BookingDraft {
  const shared = {
    id: booking.id,
    legId: booking.legId,
    title: booking.title,
    budgetAmount: booking.budgetAmount ? formatBudgetAmountInput(booking.budgetAmount) : '',
    budgetStatus: booking.budgetStatus || 'planned',
    budgetDate: getBookingBudgetDate(booking),
    provider: booking.provider || '',
    confirmationCode: booking.confirmationCode || '',
    link: booking.link || '',
    notes: booking.notes,
  } satisfies BookingDraftBase;

  if (booking.kind === 'transport') {
    return {
      ...shared,
      kind: 'transport',
      mode: booking.mode,
      fromLabel: booking.fromLabel,
      toLabel: booking.toLabel,
      departAt: booking.departAt.slice(0, 16),
      arriveAt: booking.arriveAt.slice(0, 16),
    };
  }

  return {
    ...shared,
    kind: 'stay',
    propertyName: booking.propertyName,
    address: booking.address || '',
    city: booking.city,
    country: booking.country,
    checkInDate: booking.checkInDate,
    checkOutDate: booking.checkOutDate,
  };
}

// ── Validation ──

export function getBookingValidationMessage(draft: BookingDraft): string | null {
  if (draft.budgetAmount.trim() && parseBudgetAmountInput(draft.budgetAmount) === null) {
    return 'Enter a valid booking cost or leave the cost blank for now.';
  }

  if (draft.kind === 'transport') {
    if (new Date(draft.arriveAt).getTime() < new Date(draft.departAt).getTime()) {
      return 'Arrival needs to be after the departure time.';
    }
    return null;
  }

  if (draft.checkOutDate < draft.checkInDate) {
    return 'Check-out needs to be on or after the check-in date.';
  }

  return null;
}

/** The first invalid wizard booking's message, numbered the way the wizard lists them. */
export function findWizardBookingValidationMessage(bookings: BookingDraft[]): string | null {
  for (const [index, booking] of bookings.entries()) {
    const message = getBookingValidationMessage(booking);
    if (message) return `${booking.kind === 'transport' ? 'Transport' : 'Stay'} booking ${index + 1}: ${message}`;
  }
  return null;
}

export function isRouteDraftComplete(leg: LegDraft): boolean {
  return Boolean(leg.country.trim() && leg.city.trim() && leg.startDate && leg.endDate && leg.endDate >= leg.startDate);
}

export function canAdvanceWizardStep(step: WizardStep, draft: WizardDraftState): boolean {
  if (step === 'basics') return draft.tripName.trim().length > 0;
  if (step === 'route') return draft.routeDrafts.length > 0 && draft.routeDrafts.every(isRouteDraftComplete);
  return true;
}

export function nextWizardStep(step: WizardStep): WizardStep {
  return WIZARD_STEPS[Math.min(WIZARD_STEPS.indexOf(step) + 1, WIZARD_STEPS.length - 1)];
}

export function previousWizardStep(step: WizardStep): WizardStep {
  return WIZARD_STEPS[Math.max(WIZARD_STEPS.indexOf(step) - 1, 0)];
}

export function isLegFormComplete(form: LegFormDraft): boolean {
  return Boolean(form.country.trim() && form.city.trim() && form.startDate && form.endDate);
}

// ── Payloads ──

export function buildTransportBookingPayload(draft: TransportBookingDraft, tripId: string, seed: BookingSeed = {}): Omit<TripTransportBooking, 'id' | 'createdAt' | 'updatedAt'> {
  const budgetAmount = draft.budgetAmount.trim() ? parseBudgetAmountInput(draft.budgetAmount) : null;
  return {
    kind: 'transport',
    tripId,
    legId: draft.legId || undefined,
    mode: draft.mode,
    title: buildTransportDisplayTitle(draft, seed),
    fromLabel: draft.fromLabel.trim(),
    toLabel: draft.toLabel.trim() || getDestinationLabel(seed),
    departAt: draft.departAt,
    arriveAt: draft.arriveAt,
    budgetAmount: budgetAmount === null ? undefined : budgetAmount,
    budgetStatus: draft.budgetStatus,
    budgetDate: draft.budgetDate || draft.departAt.slice(0, 10),
    provider: draft.provider.trim() || undefined,
    confirmationCode: draft.confirmationCode.trim() || undefined,
    link: draft.link.trim() || undefined,
    notes: draft.notes,
  };
}

export function buildStayBookingPayload(draft: StayBookingDraft, tripId: string, seed: BookingSeed = {}): Omit<TripStayBooking, 'id' | 'createdAt' | 'updatedAt'> {
  const budgetAmount = draft.budgetAmount.trim() ? parseBudgetAmountInput(draft.budgetAmount) : null;
  return {
    kind: 'stay',
    tripId,
    legId: draft.legId || undefined,
    title: buildStayDisplayTitle(draft, seed),
    propertyName: draft.propertyName.trim() || 'Accommodation',
    address: draft.address.trim() || undefined,
    city: draft.city.trim() || seed.city || '',
    country: draft.country.trim() || seed.country || '',
    checkInDate: draft.checkInDate,
    checkOutDate: draft.checkOutDate,
    budgetAmount: budgetAmount === null ? undefined : budgetAmount,
    budgetStatus: draft.budgetStatus,
    budgetDate: draft.budgetDate || draft.checkInDate,
    provider: draft.provider.trim() || undefined,
    confirmationCode: draft.confirmationCode.trim() || undefined,
    link: draft.link.trim() || undefined,
    notes: draft.notes,
  };
}

export function buildBookingPayload(draft: BookingDraft, tripId: string, seed: BookingSeed = {}): TripBookingInput {
  return draft.kind === 'transport'
    ? buildTransportBookingPayload(draft, tripId, seed)
    : buildStayBookingPayload(draft, tripId, seed);
}

export function buildLegFormDraft(leg?: TripLeg): LegFormDraft {
  return {
    country: leg?.country || '',
    city: leg?.city || '',
    startDate: leg?.startDate || '',
    endDate: leg?.endDate || '',
  };
}

export function buildItineraryFormDraft(legId: string, date: string, item?: TripItineraryItem): ItineraryFormDraft {
  return {
    legId: item?.legId || legId,
    date: item?.date || date,
    title: item?.title || '',
    startTime: item?.startTime || '',
    endTime: item?.endTime || '',
    location: item?.location || '',
    notes: item?.notes || '',
  };
}

export function isItineraryFormComplete(form: ItineraryFormDraft): boolean {
  return Boolean(form.legId && form.date && form.title.trim());
}

export function buildItineraryFields(form: ItineraryFormDraft): Pick<TripItineraryItem, 'legId' | 'date' | 'title' | 'startTime' | 'endTime' | 'location' | 'notes'> {
  return {
    legId: form.legId,
    date: form.date,
    title: form.title.trim(),
    startTime: form.startTime || undefined,
    endTime: form.endTime || undefined,
    location: form.location.trim() || undefined,
    notes: form.notes,
  };
}

/** A new plan goes after the other plans already on that leg day. */
export function nextItinerarySortOrder(items: TripItineraryItem[], legId: string, date: string, excludeId: string | null): number {
  return items.filter(item => item.legId === legId && item.date === date && item.id !== excludeId).length;
}
