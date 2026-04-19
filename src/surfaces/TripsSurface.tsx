import { useMemo, useState } from 'react';
import { useApp } from '../store/AppContext';
import type {
  CalendarSource,
  Trip,
  TripBooking,
  TripItineraryItem,
  TripLeg,
  TripStatus,
  TripTransportMode,
} from '../types/domain';

type TripsTab = 'overview' | 'timeline' | 'bookings';
type WizardStep = 'basics' | 'route' | 'bookings' | 'review';

interface LegDraft {
  id: string;
  country: string;
  city: string;
  startDate: string;
  endDate: string;
}

interface TransportBookingDraft {
  id: string;
  kind: 'transport';
  legId?: string;
  mode: TripTransportMode;
  title: string;
  fromLabel: string;
  toLabel: string;
  departAt: string;
  arriveAt: string;
  provider: string;
  confirmationCode: string;
  link: string;
  notes: string;
}

interface StayBookingDraft {
  id: string;
  kind: 'stay';
  legId?: string;
  title: string;
  propertyName: string;
  address: string;
  city: string;
  country: string;
  checkInDate: string;
  checkOutDate: string;
  provider: string;
  confirmationCode: string;
  link: string;
  notes: string;
}

type BookingDraft = TransportBookingDraft | StayBookingDraft;

interface BookingSeed {
  legId?: string;
  city?: string;
  country?: string;
  startDate?: string;
  endDate?: string;
}

interface BookingSeedableLeg {
  id: string;
  city: string;
  country: string;
  startDate: string;
  endDate: string;
}

const TRIP_STATUS_OPTIONS: TripStatus[] = ['planning', 'booked', 'in_trip', 'completed', 'archived'];
const TRANSPORT_MODE_OPTIONS: TripTransportMode[] = ['flight', 'train', 'bus', 'ferry', 'car', 'other'];

function createDraftId(prefix: string): string {
  return `${prefix}-${Math.random().toString(36).slice(2, 10)}`;
}

function toLocalDateStr(date: Date): string {
  return `${date.getFullYear()}-${String(date.getMonth() + 1).padStart(2, '0')}-${String(date.getDate()).padStart(2, '0')}`;
}

function addDays(value: string, days: number): string {
  const next = new Date(`${value}T00:00:00`);
  next.setDate(next.getDate() + days);
  return toLocalDateStr(next);
}

function toLocalDateTimeInput(date: Date): string {
  return `${toLocalDateStr(date)}T${String(date.getHours()).padStart(2, '0')}:${String(date.getMinutes()).padStart(2, '0')}`;
}

function buildLocalDateTime(value: string, hours: number, minutes = 0): string {
  const next = new Date(`${value}T00:00:00`);
  next.setHours(hours, minutes, 0, 0);
  return toLocalDateTimeInput(next);
}

function addHoursToLocalDateTime(value: string, hours: number): string {
  const next = new Date(value);
  next.setHours(next.getHours() + hours);
  return toLocalDateTimeInput(next);
}

function getBookingDateRange(seed: BookingSeed): { startDate: string; endDate: string } {
  const todayStr = toLocalDateStr(new Date());
  const startDate = seed.startDate || seed.endDate || todayStr;
  const endDate = seed.endDate || seed.startDate || startDate;
  return { startDate, endDate };
}

function expandDateRange(startDate: string, endDate: string): string[] {
  if (!startDate || !endDate) return [];
  const days: string[] = [];
  let cursor = startDate;
  while (cursor <= endDate) {
    days.push(cursor);
    cursor = addDays(cursor, 1);
  }
  return days;
}

function formatDate(value: string): string {
  if (!value) return 'Not set';
  const parsed = new Date(`${value}T00:00:00`);
  if (Number.isNaN(parsed.getTime())) return value;
  return parsed.toLocaleDateString(undefined, {
    month: 'short',
    day: 'numeric',
    year: 'numeric',
  });
}

function formatDateTime(value: string): string {
  if (!value) return 'Not set';
  const parsed = new Date(value);
  if (Number.isNaN(parsed.getTime())) return value;
  return parsed.toLocaleString(undefined, {
    month: 'short',
    day: 'numeric',
    hour: '2-digit',
    minute: '2-digit',
  });
}

function formatTripRange(startDate: string, endDate: string): string {
  if (!startDate && !endDate) return 'Dates not set';
  if (!startDate || startDate === endDate) return formatDate(startDate || endDate);
  return `${formatDate(startDate)} - ${formatDate(endDate)}`;
}

function formatTimeLabel(value?: string): string {
  if (!value) return 'Any time';
  return value;
}

function getBookingValidationMessage(draft: BookingDraft): string | null {
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

function compareLegs(left: TripLeg, right: TripLeg): number {
  if (left.sortOrder !== right.sortOrder) return left.sortOrder - right.sortOrder;
  if (left.startDate !== right.startDate) return left.startDate.localeCompare(right.startDate);
  return left.city.localeCompare(right.city);
}

function compareItinerary(left: TripItineraryItem, right: TripItineraryItem): number {
  if (left.startTime && right.startTime && left.startTime !== right.startTime) return left.startTime.localeCompare(right.startTime);
  if (left.startTime && !right.startTime) return -1;
  if (!left.startTime && right.startTime) return 1;
  return left.sortOrder - right.sortOrder;
}

function getTripStatusLabel(status: TripStatus): string {
  switch (status) {
    case 'planning': return 'Planning';
    case 'booked': return 'Booked';
    case 'in_trip': return 'In Trip';
    case 'completed': return 'Completed';
    case 'archived': return 'Archived';
  }
}

function getTripStatusTone(status: TripStatus): { background: string; border: string; color: string } {
  switch (status) {
    case 'planning':
      return { background: 'rgba(59, 130, 246, 0.12)', border: 'rgba(59, 130, 246, 0.35)', color: '#93c5fd' };
    case 'booked':
      return { background: 'rgba(34, 197, 94, 0.12)', border: 'rgba(34, 197, 94, 0.35)', color: '#86efac' };
    case 'in_trip':
      return { background: 'rgba(245, 158, 11, 0.12)', border: 'rgba(245, 158, 11, 0.35)', color: '#fcd34d' };
    case 'completed':
      return { background: 'rgba(168, 85, 247, 0.12)', border: 'rgba(168, 85, 247, 0.35)', color: '#d8b4fe' };
    case 'archived':
      return { background: 'rgba(107, 114, 128, 0.12)', border: 'rgba(107, 114, 128, 0.35)', color: '#d1d5db' };
  }
}

function deriveTripRange(legs: Array<Pick<TripLeg, 'startDate' | 'endDate' | 'sortOrder'>>): { startDate: string; endDate: string } {
  const valid = legs.filter(leg => leg.startDate && leg.endDate).sort((left, right) => {
    if (left.sortOrder !== right.sortOrder) return left.sortOrder - right.sortOrder;
    return left.startDate.localeCompare(right.startDate);
  });
  return {
    startDate: valid[0]?.startDate || '',
    endDate: valid[valid.length - 1]?.endDate || valid[0]?.startDate || '',
  };
}

function getBookingStartMs(booking: TripBooking): number {
  const value = booking.kind === 'transport' ? booking.departAt : `${booking.checkInDate}T00:00:00`;
  return new Date(value).getTime();
}

function getBookingEndMs(booking: TripBooking): number {
  const value = booking.kind === 'transport' ? (booking.arriveAt || booking.departAt) : `${booking.checkOutDate}T23:59:00`;
  return new Date(value).getTime();
}

function isUpcomingBooking(booking: TripBooking): boolean {
  return getBookingEndMs(booking) >= Date.now();
}

function bookingMatchesDate(booking: TripBooking, date: string): boolean {
  if (booking.kind === 'transport') {
    return booking.departAt.slice(0, 10) === date || booking.arriveAt.slice(0, 10) === date;
  }
  return booking.checkInDate <= date && booking.checkOutDate >= date;
}

function getBookingTimelineLabel(booking: TripBooking): string {
  if (booking.kind === 'transport') {
    return `${formatDateTime(booking.departAt)} -> ${formatDateTime(booking.arriveAt)}`;
  }
  return `${formatDate(booking.checkInDate)} -> ${formatDate(booking.checkOutDate)}`;
}

function buildTransportDraft(seed: BookingSeed = {}): TransportBookingDraft {
  const { startDate } = getBookingDateRange(seed);
  const departAt = buildLocalDateTime(startDate, 9);
  return {
    id: createDraftId('transport'),
    kind: 'transport',
    legId: seed.legId,
    mode: 'flight',
    title: '',
    fromLabel: '',
    toLabel: '',
    departAt,
    arriveAt: addHoursToLocalDateTime(departAt, 2),
    provider: '',
    confirmationCode: '',
    link: '',
    notes: '',
  };
}

function buildStayDraft(seed: BookingSeed = {}): StayBookingDraft {
  const { startDate, endDate } = getBookingDateRange(seed);
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
    provider: '',
    confirmationCode: '',
    link: '',
    notes: '',
  };
}

function materializeBookingDraft(draft: BookingDraft, seed: BookingSeed = {}): BookingDraft {
  if (draft.kind === 'transport') {
    const seededDraft = buildTransportDraft({ ...seed, legId: draft.legId || seed.legId });
    const departAt = draft.departAt || seededDraft.departAt;
    return {
      ...seededDraft,
      ...draft,
      legId: draft.legId || seed.legId,
      departAt,
      arriveAt: draft.arriveAt || addHoursToLocalDateTime(departAt, 2),
    };
  }

  const seededDraft = buildStayDraft({ ...seed, legId: draft.legId || seed.legId });
  const checkInDate = draft.checkInDate || seededDraft.checkInDate;
  return {
    ...seededDraft,
    ...draft,
    legId: draft.legId || seed.legId,
    city: draft.city || seededDraft.city,
    country: draft.country || seededDraft.country,
    checkInDate,
    checkOutDate: draft.checkOutDate || checkInDate || seededDraft.checkOutDate,
  };
}

function applySeedToExistingBookingDraft(draft: BookingDraft, previousSeed: BookingSeed, nextSeed: BookingSeed): BookingDraft {
  if (draft.kind === 'transport') {
    const previousDefaults = buildTransportDraft({ ...previousSeed, legId: draft.legId || previousSeed.legId });
    const nextDefaults = buildTransportDraft(nextSeed);
    return {
      ...draft,
      legId: nextSeed.legId,
      departAt: !draft.departAt || draft.departAt === previousDefaults.departAt ? nextDefaults.departAt : draft.departAt,
      arriveAt: !draft.arriveAt || draft.arriveAt === previousDefaults.arriveAt ? nextDefaults.arriveAt : draft.arriveAt,
    };
  }

  const previousDefaults = buildStayDraft({ ...previousSeed, legId: draft.legId || previousSeed.legId });
  const nextDefaults = buildStayDraft(nextSeed);
  return {
    ...draft,
    legId: nextSeed.legId,
    city: !draft.city || draft.city === previousDefaults.city ? nextDefaults.city : draft.city,
    country: !draft.country || draft.country === previousDefaults.country ? nextDefaults.country : draft.country,
    checkInDate: !draft.checkInDate || draft.checkInDate === previousDefaults.checkInDate ? nextDefaults.checkInDate : draft.checkInDate,
    checkOutDate: !draft.checkOutDate || draft.checkOutDate === previousDefaults.checkOutDate ? nextDefaults.checkOutDate : draft.checkOutDate,
  };
}

function buildBookingSeedFromLeg(leg?: BookingSeedableLeg): BookingSeed {
  if (!leg) return {};
  return {
    legId: leg.id,
    city: leg.city.trim(),
    country: leg.country.trim(),
    startDate: leg.startDate,
    endDate: leg.endDate || leg.startDate,
  };
}

function syncBookingDependentFields(previous: BookingDraft, next: BookingDraft, updates: Partial<BookingDraft>): BookingDraft {
  if (next.kind === 'transport' && previous.kind === 'transport') {
    if ('arriveAt' in updates || !next.departAt) return next;
    const previousDefaultArrival = previous.departAt ? addHoursToLocalDateTime(previous.departAt, 2) : '';
    const arrivalWasDefault = !previous.arriveAt || previous.arriveAt === previousDefaultArrival;
    if (!next.arriveAt || (arrivalWasDefault && previous.departAt !== next.departAt) || (arrivalWasDefault && new Date(next.arriveAt).getTime() < new Date(next.departAt).getTime())) {
      return { ...next, arriveAt: addHoursToLocalDateTime(next.departAt, 2) };
    }
    return next;
  }

  if (next.kind === 'stay' && previous.kind === 'stay') {
    if ('checkOutDate' in updates) return next;
    if (next.checkInDate && (!next.checkOutDate || next.checkOutDate < next.checkInDate)) {
      return { ...next, checkOutDate: next.checkInDate };
    }
  }

  return next;
}

function buildWizardBookingValidationMessage(booking: BookingDraft, index: number): string | null {
  const validationMessage = getBookingValidationMessage(booking);
  if (!validationMessage) return null;
  return `${booking.kind === 'transport' ? 'Transport' : 'Stay'} booking ${index + 1}: ${validationMessage}`;
}

function mapBookingToDraft(booking: TripBooking): BookingDraft {
  if (booking.kind === 'transport') {
    return {
      id: booking.id,
      kind: 'transport',
      legId: booking.legId,
      mode: booking.mode,
      title: booking.title,
      fromLabel: booking.fromLabel,
      toLabel: booking.toLabel,
      departAt: booking.departAt.slice(0, 16),
      arriveAt: booking.arriveAt.slice(0, 16),
      provider: booking.provider || '',
      confirmationCode: booking.confirmationCode || '',
      link: booking.link || '',
      notes: booking.notes,
    };
  }

  return {
    id: booking.id,
    kind: 'stay',
    legId: booking.legId,
    title: booking.title,
    propertyName: booking.propertyName,
    address: booking.address || '',
    city: booking.city,
    country: booking.country,
    checkInDate: booking.checkInDate,
    checkOutDate: booking.checkOutDate,
    provider: booking.provider || '',
    confirmationCode: booking.confirmationCode || '',
    link: booking.link || '',
    notes: booking.notes,
  };
}

function MetricCard({ label, value, note }: { label: string; value: string; note?: string }) {
  return (
    <div className="card" style={{ padding: 16 }}>
      <div style={{ fontSize: 11, textTransform: 'uppercase', letterSpacing: 0.6, color: '#6b6f85', marginBottom: 8 }}>{label}</div>
      <div style={{ fontSize: 28, fontWeight: 700, color: '#f5f7ff' }}>{value}</div>
      {note && <div style={{ fontSize: 12, color: '#8b8fa3', marginTop: 6 }}>{note}</div>}
    </div>
  );
}

function StatusPill({ status }: { status: TripStatus }) {
  const tone = getTripStatusTone(status);
  return (
    <span
      style={{
        display: 'inline-flex',
        alignItems: 'center',
        gap: 6,
        padding: '4px 10px',
        borderRadius: 999,
        border: `1px solid ${tone.border}`,
        background: tone.background,
        color: tone.color,
        fontSize: 12,
        fontWeight: 600,
      }}
    >
      {getTripStatusLabel(status)}
    </span>
  );
}

export default function TripsSurface() {
  const app = useApp();
  const todayStr = toLocalDateStr(new Date());

  const [activeTab, setActiveTab] = useState<TripsTab>('overview');
  const [selectedTripIdState, setSelectedTripIdState] = useState<string | null>(null);
  const [searchQuery, setSearchQuery] = useState('');

  const [showWizard, setShowWizard] = useState(false);
  const [wizardStep, setWizardStep] = useState<WizardStep>('basics');
  const [tripName, setTripName] = useState('');
  const [tripSummary, setTripSummary] = useState('');
  const [tripNotes, setTripNotes] = useState('');
  const [tripStatus, setTripStatus] = useState<TripStatus>('planning');
  const [routeDrafts, setRouteDrafts] = useState<LegDraft[]>([]);
  const [wizardBookings, setWizardBookings] = useState<BookingDraft[]>([]);

  const [showTripEdit, setShowTripEdit] = useState(false);
  const [editingTripId, setEditingTripId] = useState<string | null>(null);

  const [showLegModal, setShowLegModal] = useState(false);
  const [editingLegId, setEditingLegId] = useState<string | null>(null);
  const [legCountry, setLegCountry] = useState('');
  const [legCity, setLegCity] = useState('');
  const [legStartDate, setLegStartDate] = useState('');
  const [legEndDate, setLegEndDate] = useState('');

  const [showItineraryModal, setShowItineraryModal] = useState(false);
  const [editingItineraryId, setEditingItineraryId] = useState<string | null>(null);
  const [itineraryLegId, setItineraryLegId] = useState('');
  const [itineraryDate, setItineraryDate] = useState('');
  const [itineraryTitle, setItineraryTitle] = useState('');
  const [itineraryStartTime, setItineraryStartTime] = useState('');
  const [itineraryEndTime, setItineraryEndTime] = useState('');
  const [itineraryLocation, setItineraryLocation] = useState('');
  const [itineraryNotes, setItineraryNotes] = useState('');

  const [showBookingModal, setShowBookingModal] = useState(false);
  const [editingBookingId, setEditingBookingId] = useState<string | null>(null);
  const [bookingDraft, setBookingDraft] = useState<BookingDraft>(buildTransportDraft());
  const [bookingFeedback, setBookingFeedback] = useState<string | null>(null);
  const [wizardFeedback, setWizardFeedback] = useState<string | null>(null);

  const [calendarTarget, setCalendarTarget] = useState<{ title: string; start: string; end: string; description: string; allDay: boolean; location?: string } | null>(null);
  const [calendarSourceId, setCalendarSourceId] = useState('');
  const [calendarNotice, setCalendarNotice] = useState<string | null>(null);

  const legsByTrip = useMemo(() => {
    const map = new Map<string, TripLeg[]>();
    app.tripLegs.forEach(leg => {
      const current = map.get(leg.tripId) || [];
      current.push(leg);
      map.set(leg.tripId, current);
    });
    map.forEach((legs, tripId) => {
      map.set(tripId, [...legs].sort(compareLegs));
    });
    return map;
  }, [app.tripLegs]);

  const filteredTrips = useMemo(() => {
    const query = searchQuery.trim().toLowerCase();
    const matching = app.trips.filter(trip => {
      const tripLegs = legsByTrip.get(trip.id) || [];
      if (!query) return true;
      return trip.name.toLowerCase().includes(query)
        || trip.summary.toLowerCase().includes(query)
        || trip.notes.toLowerCase().includes(query)
        || tripLegs.some(leg =>
          leg.city.toLowerCase().includes(query)
          || leg.country.toLowerCase().includes(query));
    });

    const active = matching
      .filter(trip => trip.status !== 'completed' && trip.status !== 'archived')
      .sort((left, right) => left.startDate.localeCompare(right.startDate));
    const inactive = matching
      .filter(trip => trip.status === 'completed' || trip.status === 'archived')
      .sort((left, right) => right.startDate.localeCompare(left.startDate));

    return [...active, ...inactive];
  }, [app.trips, legsByTrip, searchQuery]);

  const selectedTripId = useMemo(() => {
    if (selectedTripIdState && filteredTrips.some(trip => trip.id === selectedTripIdState)) {
      return selectedTripIdState;
    }
    return filteredTrips[0]?.id || app.trips[0]?.id || null;
  }, [app.trips, filteredTrips, selectedTripIdState]);

  const selectedTrip = useMemo(
    () => app.trips.find(trip => trip.id === selectedTripId) || null,
    [app.trips, selectedTripId],
  );

  const selectedLegs = useMemo(
    () => app.tripLegs.filter(leg => leg.tripId === selectedTripId).sort(compareLegs),
    [app.tripLegs, selectedTripId],
  );

  const selectedItinerary = useMemo(
    () => app.tripItineraryItems.filter(item => item.tripId === selectedTripId).sort((left, right) => {
      if (left.date !== right.date) return left.date.localeCompare(right.date);
      return compareItinerary(left, right);
    }),
    [app.tripItineraryItems, selectedTripId],
  );

  const selectedBookings = useMemo(
    () => app.tripBookings
      .filter(booking => booking.tripId === selectedTripId)
      .sort((left, right) => {
        const leftUpcoming = isUpcomingBooking(left);
        const rightUpcoming = isUpcomingBooking(right);
        if (leftUpcoming !== rightUpcoming) return leftUpcoming ? -1 : 1;
        if (leftUpcoming) return getBookingStartMs(left) - getBookingStartMs(right);
        return getBookingStartMs(right) - getBookingStartMs(left);
      }),
    [app.tripBookings, selectedTripId],
  );

  const itineraryByDay = useMemo(() => {
    const map = new Map<string, TripItineraryItem[]>();
    selectedItinerary.forEach(item => {
      const key = `${item.legId}:${item.date}`;
      const current = map.get(key) || [];
      current.push(item);
      map.set(key, current);
    });
    map.forEach((items, key) => map.set(key, [...items].sort(compareItinerary)));
    return map;
  }, [selectedItinerary]);

  const bookingsByDay = useMemo(() => {
    const map = new Map<string, TripBooking[]>();
    selectedLegs.forEach(leg => {
      expandDateRange(leg.startDate, leg.endDate).forEach(date => {
        map.set(`${leg.id}:${date}`, selectedBookings.filter(booking => (!booking.legId || booking.legId === leg.id) && bookingMatchesDate(booking, date)));
      });
    });
    return map;
  }, [selectedBookings, selectedLegs]);

  const destinationCount = selectedLegs.length;
  const bookingCount = selectedBookings.length;
  const nextBooking = useMemo(
    () => selectedBookings.find(isUpcomingBooking) || selectedBookings[0] || null,
    [selectedBookings],
  );

  const defaultCalendarSource = useMemo(() => {
    const primaryAccount = app.calendarAccounts.find(account => account.isPrimary);
    const visibleSource = app.calendarSources.find(source => source.visible && source.accountId === primaryAccount?.id);
    return visibleSource || app.calendarSources.find(source => source.visible) || app.calendarSources[0] || null;
  }, [app.calendarAccounts, app.calendarSources]);

  const transportBookings = selectedBookings.filter(booking => booking.kind === 'transport');
  const stayBookings = selectedBookings.filter(booking => booking.kind === 'stay');

  function getSelectedTripBookingSeed(legId?: string): BookingSeed {
    if (legId) {
      return buildBookingSeedFromLeg(selectedLegs.find(leg => leg.id === legId));
    }
    return {
      startDate: selectedTrip?.startDate,
      endDate: selectedTrip?.endDate,
    };
  }

  function getWizardBookingSeed(legId?: string): BookingSeed {
    if (legId) {
      return buildBookingSeedFromLeg(routeDrafts.find(leg => leg.id === legId));
    }
    const range = deriveTripRange(routeDrafts.map((leg, index) => ({
      startDate: leg.startDate || leg.endDate,
      endDate: leg.endDate || leg.startDate,
      sortOrder: index,
    })));
    return {
      startDate: range.startDate,
      endDate: range.endDate,
    };
  }

  function resetWizard(): void {
    setWizardStep('basics');
    setTripName('');
    setTripSummary('');
    setTripNotes('');
    setTripStatus('planning');
    setRouteDrafts([{ id: createDraftId('leg'), country: '', city: '', startDate: '', endDate: '' }]);
    setWizardBookings([]);
    setWizardFeedback(null);
  }

  function openCreateWizard(): void {
    resetWizard();
    setShowWizard(true);
  }

  function canAdvanceWizard(): boolean {
    if (wizardStep === 'basics') {
      return tripName.trim().length > 0;
    }
    if (wizardStep === 'route') {
      return routeDrafts.length > 0 && routeDrafts.every(leg => leg.country.trim() && leg.city.trim() && leg.startDate && leg.endDate && leg.endDate >= leg.startDate);
    }
    return true;
  }

  function saveWizard(): void {
    const preparedBookings = wizardBookings.map(booking => materializeBookingDraft(booking, getWizardBookingSeed(booking.legId)));
    setWizardBookings(preparedBookings);
    const bookingValidationMessage = preparedBookings
      .map((booking, index) => buildWizardBookingValidationMessage(booking, index))
      .find((message): message is string => Boolean(message));
    if (bookingValidationMessage) {
      setWizardFeedback(bookingValidationMessage);
      return;
    }
    setWizardFeedback(null);

    const preparedLegs = routeDrafts.map((leg, index) => ({
      country: leg.country.trim(),
      city: leg.city.trim(),
      startDate: leg.startDate,
      endDate: leg.endDate || leg.startDate,
      sortOrder: index,
    }));
    const range = deriveTripRange(preparedLegs);
    const tripId = app.addTrip({
      name: tripName.trim(),
      summary: tripSummary.trim(),
      notes: tripNotes,
      status: tripStatus,
      startDate: range.startDate,
      endDate: range.endDate,
    });

    const legIdMap = new Map<string, string>();
    routeDrafts.forEach((draft, index) => {
      const createdId = app.addTripLeg({
        tripId,
        country: draft.country.trim(),
        city: draft.city.trim(),
        startDate: draft.startDate,
        endDate: draft.endDate || draft.startDate,
        sortOrder: index,
      });
      legIdMap.set(draft.id, createdId);
    });

    preparedBookings.forEach(booking => {
      if (booking.kind === 'transport') {
        app.addTripBooking({
          kind: 'transport',
          tripId,
          legId: booking.legId ? legIdMap.get(booking.legId) : undefined,
          mode: booking.mode,
          title: booking.title.trim() || 'Transport booking',
          fromLabel: booking.fromLabel.trim(),
          toLabel: booking.toLabel.trim(),
          departAt: booking.departAt,
          arriveAt: booking.arriveAt,
          provider: booking.provider.trim() || undefined,
          confirmationCode: booking.confirmationCode.trim() || undefined,
          link: booking.link.trim() || undefined,
          notes: booking.notes,
        });
        return;
      }

      app.addTripBooking({
        kind: 'stay',
        tripId,
        legId: booking.legId ? legIdMap.get(booking.legId) : undefined,
        title: booking.title.trim() || 'Stay booking',
        propertyName: booking.propertyName.trim() || 'Accommodation',
        address: booking.address.trim() || undefined,
        city: booking.city.trim(),
        country: booking.country.trim(),
        checkInDate: booking.checkInDate,
        checkOutDate: booking.checkOutDate,
        provider: booking.provider.trim() || undefined,
        confirmationCode: booking.confirmationCode.trim() || undefined,
        link: booking.link.trim() || undefined,
        notes: booking.notes,
      });
    });

    setSelectedTripIdState(tripId);
    setActiveTab('overview');
    setShowWizard(false);
  }

  function openTripEdit(trip: Trip): void {
    setEditingTripId(trip.id);
    setTripName(trip.name);
    setTripSummary(trip.summary);
    setTripNotes(trip.notes);
    setTripStatus(trip.status);
    setShowTripEdit(true);
  }

  function saveTripEdit(): void {
    if (!editingTripId || !tripName.trim()) return;
    app.updateTrip(editingTripId, {
      name: tripName.trim(),
      summary: tripSummary.trim(),
      notes: tripNotes,
      status: tripStatus,
    });
    setShowTripEdit(false);
  }

  function updateRouteDraft(id: string, updates: Partial<LegDraft>): void {
    setRouteDrafts(prev => prev.map(leg => leg.id === id ? { ...leg, ...updates } : leg));
  }

  function addRouteDraft(): void {
    setRouteDrafts(prev => [...prev, { id: createDraftId('leg'), country: '', city: '', startDate: '', endDate: '' }]);
  }

  function removeRouteDraft(id: string): void {
    setRouteDrafts(prev => prev.filter(leg => leg.id !== id));
  }

  function addWizardBooking(kind: 'transport' | 'stay'): void {
    setWizardFeedback(null);
    const seed = getWizardBookingSeed(routeDrafts[0]?.id);
    setWizardBookings(prev => [...prev, kind === 'transport' ? buildTransportDraft(seed) : buildStayDraft(seed)]);
  }

  function updateWizardBooking(id: string, updates: Partial<BookingDraft>): void {
    setWizardFeedback(null);
    setWizardBookings(prev => prev.map(booking => {
      if (booking.id !== id) return booking;
      const nextDraft = { ...booking, ...updates } as BookingDraft;
      if ('legId' in updates) {
        return syncBookingDependentFields(
          booking,
          applySeedToExistingBookingDraft(nextDraft, getWizardBookingSeed(booking.legId), getWizardBookingSeed(updates.legId)),
          updates,
        );
      }
      return syncBookingDependentFields(booking, nextDraft, updates);
    }));
  }

  function removeWizardBooking(id: string): void {
    setWizardFeedback(null);
    setWizardBookings(prev => prev.filter(booking => booking.id !== id));
  }

  function openLegModal(leg?: TripLeg): void {
    setEditingLegId(leg?.id || null);
    setLegCountry(leg?.country || '');
    setLegCity(leg?.city || '');
    setLegStartDate(leg?.startDate || '');
    setLegEndDate(leg?.endDate || '');
    setShowLegModal(true);
  }

  function saveLeg(): void {
    if (!selectedTrip || !legCountry.trim() || !legCity.trim() || !legStartDate || !legEndDate) return;
    if (editingLegId) {
      app.updateTripLeg(editingLegId, {
        country: legCountry.trim(),
        city: legCity.trim(),
        startDate: legStartDate,
        endDate: legEndDate,
      });
    } else {
      app.addTripLeg({
        tripId: selectedTrip.id,
        country: legCountry.trim(),
        city: legCity.trim(),
        startDate: legStartDate,
        endDate: legEndDate,
        sortOrder: selectedLegs.length,
      });
    }
    const nextRange = deriveTripRange(editingLegId
      ? selectedLegs.map(leg => leg.id === editingLegId ? { ...leg, startDate: legStartDate, endDate: legEndDate } : leg)
      : [...selectedLegs, { id: '', tripId: selectedTrip.id, country: legCountry, city: legCity, startDate: legStartDate, endDate: legEndDate, sortOrder: selectedLegs.length, createdAt: '', updatedAt: '' }]);
    app.updateTrip(selectedTrip.id, nextRange);
    setShowLegModal(false);
  }

  function moveLeg(leg: TripLeg, direction: -1 | 1): void {
    const ordered = [...selectedLegs];
    const index = ordered.findIndex(item => item.id === leg.id);
    const nextIndex = index + direction;
    if (index < 0 || nextIndex < 0 || nextIndex >= ordered.length) return;
    const swap = ordered[nextIndex];
    app.updateTripLeg(leg.id, { sortOrder: swap.sortOrder });
    app.updateTripLeg(swap.id, { sortOrder: leg.sortOrder });
  }

  function removeLeg(leg: TripLeg): void {
    if (!selectedTrip) return;
    app.removeTripLeg(leg.id);
    const remaining = selectedLegs.filter(item => item.id !== leg.id).map((item, index) => ({ ...item, sortOrder: index }));
    remaining.forEach(item => app.updateTripLeg(item.id, { sortOrder: item.sortOrder }));
    const nextRange = deriveTripRange(remaining);
    app.updateTrip(selectedTrip.id, nextRange);
  }

  function openItineraryModal(leg: TripLeg, date: string, item?: TripItineraryItem): void {
    setEditingItineraryId(item?.id || null);
    setItineraryLegId(item?.legId || leg.id);
    setItineraryDate(item?.date || date);
    setItineraryTitle(item?.title || '');
    setItineraryStartTime(item?.startTime || '');
    setItineraryEndTime(item?.endTime || '');
    setItineraryLocation(item?.location || '');
    setItineraryNotes(item?.notes || '');
    setShowItineraryModal(true);
  }

  function saveItineraryItem(): void {
    if (!selectedTrip || !itineraryLegId || !itineraryDate || !itineraryTitle.trim()) return;
    const sameDayItems = selectedItinerary.filter(item => item.legId === itineraryLegId && item.date === itineraryDate && item.id !== editingItineraryId);
    const sortOrder = sameDayItems.length;
    if (editingItineraryId) {
      app.updateTripItineraryItem(editingItineraryId, {
        legId: itineraryLegId,
        date: itineraryDate,
        title: itineraryTitle.trim(),
        startTime: itineraryStartTime || undefined,
        endTime: itineraryEndTime || undefined,
        location: itineraryLocation.trim() || undefined,
        notes: itineraryNotes,
      });
    } else {
      app.addTripItineraryItem({
        tripId: selectedTrip.id,
        legId: itineraryLegId,
        date: itineraryDate,
        title: itineraryTitle.trim(),
        startTime: itineraryStartTime || undefined,
        endTime: itineraryEndTime || undefined,
        location: itineraryLocation.trim() || undefined,
        notes: itineraryNotes,
        sortOrder,
      });
    }
    setShowItineraryModal(false);
  }

  function openBookingModal(kind: 'transport' | 'stay', booking?: TripBooking, legId?: string): void {
    const seed = getSelectedTripBookingSeed(legId || booking?.legId);
    setEditingBookingId(booking?.id || null);
    setBookingDraft(booking ? materializeBookingDraft(mapBookingToDraft(booking), seed) : (kind === 'transport' ? buildTransportDraft(seed) : buildStayDraft(seed)));
    setBookingFeedback(null);
    setShowBookingModal(true);
  }

  function replaceBookingDraft(nextDraft: BookingDraft): void {
    setBookingFeedback(null);
    setBookingDraft(nextDraft);
  }

  function updateBookingDraft(updates: Partial<BookingDraft>): void {
    setBookingFeedback(null);
    setBookingDraft(previous => {
      const nextDraft = { ...previous, ...updates } as BookingDraft;
      if ('legId' in updates) {
        return syncBookingDependentFields(
          previous,
          applySeedToExistingBookingDraft(nextDraft, getSelectedTripBookingSeed(previous.legId), getSelectedTripBookingSeed(updates.legId)),
          updates,
        );
      }
      return syncBookingDependentFields(previous, nextDraft, updates);
    });
  }

  function saveBooking(): void {
    if (!selectedTrip) {
      setBookingFeedback('Select a trip before saving a booking.');
      return;
    }

    const preparedDraft = materializeBookingDraft(bookingDraft, getSelectedTripBookingSeed(bookingDraft.legId));
    setBookingDraft(preparedDraft);
    const validationMessage = getBookingValidationMessage(preparedDraft);
    if (validationMessage) {
      setBookingFeedback(validationMessage);
      return;
    }

    try {
      if (preparedDraft.kind === 'transport') {
        const payload = {
          kind: 'transport' as const,
          tripId: selectedTrip.id,
          legId: preparedDraft.legId || undefined,
          mode: preparedDraft.mode,
          title: preparedDraft.title.trim() || 'Transport booking',
          fromLabel: preparedDraft.fromLabel.trim(),
          toLabel: preparedDraft.toLabel.trim(),
          departAt: preparedDraft.departAt,
          arriveAt: preparedDraft.arriveAt,
          provider: preparedDraft.provider.trim() || undefined,
          confirmationCode: preparedDraft.confirmationCode.trim() || undefined,
          link: preparedDraft.link.trim() || undefined,
          notes: preparedDraft.notes,
        };
        if (editingBookingId) {
          app.updateTripBooking(editingBookingId, payload);
        } else {
          app.addTripBooking(payload);
        }
      } else {
        const payload = {
          kind: 'stay' as const,
          tripId: selectedTrip.id,
          legId: preparedDraft.legId || undefined,
          title: preparedDraft.title.trim() || 'Stay booking',
          propertyName: preparedDraft.propertyName.trim() || 'Accommodation',
          address: preparedDraft.address.trim() || undefined,
          city: preparedDraft.city.trim(),
          country: preparedDraft.country.trim(),
          checkInDate: preparedDraft.checkInDate,
          checkOutDate: preparedDraft.checkOutDate,
          provider: preparedDraft.provider.trim() || undefined,
          confirmationCode: preparedDraft.confirmationCode.trim() || undefined,
          link: preparedDraft.link.trim() || undefined,
          notes: preparedDraft.notes,
        };
        if (editingBookingId) {
          app.updateTripBooking(editingBookingId, payload);
        } else {
          app.addTripBooking(payload);
        }
      }
      setBookingFeedback(null);
      setShowBookingModal(false);
    } catch (error) {
      setBookingFeedback(error instanceof Error ? error.message : 'Booking could not be saved. Please try again.');
    }
  }

  function openCalendarImport(target: { title: string; start: string; end: string; description: string; allDay: boolean; location?: string }): void {
    if (app.calendarSources.length === 0) {
      setCalendarNotice('Add a calendar source first, then you can import trip items into Calendar.');
      return;
    }
    setCalendarNotice(null);
    setCalendarTarget(target);
    setCalendarSourceId(defaultCalendarSource?.id || app.calendarSources[0]?.id || '');
  }

  function importToCalendar(): void {
    if (!calendarTarget || !calendarSourceId) return;
    app.addCalendarEvent({
      sourceId: calendarSourceId,
      title: calendarTarget.title,
      description: calendarTarget.description,
      start: new Date(calendarTarget.start).toISOString(),
      end: new Date(calendarTarget.end).toISOString(),
      allDay: calendarTarget.allDay,
      location: calendarTarget.location,
    });
    setCalendarTarget(null);
  }

  function buildCalendarPayloadForItinerary(item: TripItineraryItem, leg: TripLeg | undefined) {
    const start = item.startTime ? `${item.date}T${item.startTime}` : `${item.date}T09:00`;
    const end = item.endTime ? `${item.date}T${item.endTime}` : `${item.date}T10:00`;
    openCalendarImport({
      title: item.title,
      start,
      end,
      allDay: !item.startTime && !item.endTime,
      location: item.location,
      description: [
        leg ? `${leg.city}, ${leg.country}` : null,
        item.notes || null,
      ].filter(Boolean).join('\n\n'),
    });
  }

  function buildCalendarPayloadForBooking(booking: TripBooking) {
    if (booking.kind === 'transport') {
      openCalendarImport({
        title: booking.title,
        start: booking.departAt,
        end: booking.arriveAt,
        allDay: false,
        description: [
          booking.fromLabel || null,
          booking.toLabel || null,
          booking.provider ? `Provider: ${booking.provider}` : null,
          booking.confirmationCode ? `Confirmation: ${booking.confirmationCode}` : null,
          booking.notes || null,
        ].filter(Boolean).join('\n'),
      });
      return;
    }

    openCalendarImport({
      title: booking.title,
      start: `${booking.checkInDate}T00:00`,
      end: `${booking.checkOutDate}T23:59`,
      allDay: true,
      location: booking.address,
      description: [
        booking.propertyName,
        booking.city || null,
        booking.country || null,
        booking.provider ? `Provider: ${booking.provider}` : null,
        booking.confirmationCode ? `Confirmation: ${booking.confirmationCode}` : null,
        booking.notes || null,
      ].filter(Boolean).join('\n'),
    });
  }

  function renderRailItem(trip: Trip) {
    const tripLegs = legsByTrip.get(trip.id) || [];
    return (
      <button
        key={trip.id}
        type="button"
        onClick={() => {
          setSelectedTripIdState(trip.id);
          setActiveTab('overview');
        }}
        style={{
          textAlign: 'left',
          padding: 14,
          borderRadius: 14,
          border: selectedTripId === trip.id ? '1px solid #4f5bff' : '1px solid #23283c',
          background: selectedTripId === trip.id ? 'rgba(79, 91, 255, 0.12)' : '#121620',
          color: '#f5f7ff',
          cursor: 'pointer',
          display: 'grid',
          gap: 8,
        }}
      >
        <div style={{ display: 'flex', justifyContent: 'space-between', gap: 8, alignItems: 'center' }}>
          <div style={{ fontWeight: 700, fontSize: 14 }}>{trip.name}</div>
          <StatusPill status={trip.status} />
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
  }

  return (
    <>
      <div className="surface-header">
        <div>
          <h1>Trips</h1>
          <div className="subtitle">
            {app.trips.length === 0
              ? 'Plan multi-country travel without leaving HELM'
              : `${app.trips.length} trip${app.trips.length === 1 ? '' : 's'} tracked locally`}
          </div>
        </div>
        <button className="btn btn-primary" onClick={openCreateWizard}>+ Plan Trip</button>
      </div>

      <div className="surface-body">
        {app.trips.length === 0 ? (
          <div className="empty-state" role="status">
            <div className="empty-icon">&#9992;&#65039;</div>
            <h3>Plan your first trip</h3>
            <p>Create a travel timeline with destinations, bookings, and day plans that stay local-first inside HELM.</p>
            <button className="btn btn-primary" onClick={openCreateWizard}>Plan your first trip</button>
          </div>
        ) : (
          <div className="trips-layout">
            <aside className="card" style={{ padding: 18, display: 'grid', gap: 14, alignContent: 'start' }}>
              <input
                className="form-input"
                value={searchQuery}
                onChange={event => setSearchQuery(event.target.value)}
                placeholder="Search trips, countries, or cities"
                aria-label="Search trips"
              />
              <div style={{ display: 'grid', gap: 10 }}>
                {filteredTrips.map(renderRailItem)}
                {filteredTrips.length === 0 && (
                  <div style={{ fontSize: 13, color: '#8b8fa3' }}>No trips match that search.</div>
                )}
              </div>
            </aside>

            <section style={{ display: 'grid', gap: 16, minWidth: 0 }}>
              {selectedTrip ? (
                <>
                  <div className="card" style={{ padding: 20, display: 'grid', gap: 16 }}>
                    <div style={{ display: 'flex', justifyContent: 'space-between', gap: 12, flexWrap: 'wrap', alignItems: 'flex-start' }}>
                      <div style={{ display: 'grid', gap: 10 }}>
                        <div style={{ display: 'flex', alignItems: 'center', gap: 10, flexWrap: 'wrap' }}>
                          <h2 style={{ margin: 0 }}>{selectedTrip.name}</h2>
                          <StatusPill status={selectedTrip.status} />
                        </div>
                        <div style={{ color: '#9ea4c5', maxWidth: 760 }}>
                          {selectedTrip.summary || 'Add a short summary so this trip has context at a glance.'}
                        </div>
                        <div style={{ fontSize: 12, color: '#8b8fa3' }}>
                          {formatTripRange(selectedTrip.startDate, selectedTrip.endDate)} · {destinationCount} destination{destinationCount === 1 ? '' : 's'} · {bookingCount} booking{bookingCount === 1 ? '' : 's'}
                        </div>
                      </div>
                      <div className="actions-row" style={{ margin: 0, flexWrap: 'wrap' }}>
                        <button className="btn btn-secondary btn-sm" onClick={() => openTripEdit(selectedTrip)}>Edit Trip</button>
                        <button className="btn btn-danger btn-sm" onClick={() => {
                          if (window.confirm(`Delete trip "${selectedTrip.name}"?`)) {
                            app.removeTrip(selectedTrip.id);
                            setSelectedTripIdState(null);
                          }
                        }}>Delete</button>
                      </div>
                    </div>

                    <div className="tabs">
                      <button className={`tab ${activeTab === 'overview' ? 'active' : ''}`} onClick={() => setActiveTab('overview')}>Overview</button>
                      <button className={`tab ${activeTab === 'timeline' ? 'active' : ''}`} onClick={() => setActiveTab('timeline')}>Timeline</button>
                      <button className={`tab ${activeTab === 'bookings' ? 'active' : ''}`} onClick={() => setActiveTab('bookings')}>Bookings</button>
                    </div>
                  </div>

                  {calendarNotice && (
                    <div className="info-box warning" style={{ marginBottom: 0 }}>
                      <div style={{ display: 'flex', justifyContent: 'space-between', gap: 12, flexWrap: 'wrap', alignItems: 'center' }}>
                        <span>{calendarNotice}</span>
                        <button className="btn btn-secondary btn-sm" onClick={() => app.navigate('calendar')}>Open Calendar</button>
                      </div>
                    </div>
                  )}

                  {activeTab === 'overview' && (
                    <div style={{ display: 'grid', gap: 16 }}>
                      <div className="projects-metrics-grid">
                        <MetricCard label="Trip Span" value={selectedTrip.startDate && selectedTrip.endDate ? `${expandDateRange(selectedTrip.startDate, selectedTrip.endDate).length} days` : 'TBD'} note="Calculated from your destination legs." />
                        <MetricCard label="Destinations" value={String(destinationCount)} note="Ordered country and city stops in the route." />
                        <MetricCard label="Bookings" value={String(bookingCount)} note="Transport and stay reservations linked to this trip." />
                        <MetricCard label="Plans" value={String(selectedItinerary.length)} note="Itinerary items across the trip timeline." />
                      </div>

                      <div className="trip-detail-grid">
                        <div className="card" style={{ padding: 18, display: 'grid', gap: 12 }}>
                          <div style={{ fontSize: 16, fontWeight: 700 }}>Route Summary</div>
                          {selectedLegs.length === 0 ? (
                            <div style={{ fontSize: 13, color: '#8b8fa3' }}>No destinations added yet.</div>
                          ) : (
                            selectedLegs.map((leg, index) => (
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
                                <div style={{ fontWeight: 600 }}>{nextBooking.title}</div>
                                <span className="tag tag-connected">{nextBooking.kind === 'transport' ? 'Transport' : 'Stay'}</span>
                              </div>
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
                            {selectedTrip.notes || 'No trip notes yet.'}
                          </div>
                        </div>
                      </div>
                    </div>
                  )}

                  {activeTab === 'timeline' && (
                    <div style={{ display: 'grid', gap: 16 }}>
                      <div className="card" style={{ padding: 18, display: 'flex', justifyContent: 'space-between', gap: 12, flexWrap: 'wrap', alignItems: 'center' }}>
                        <div>
                          <div style={{ fontSize: 16, fontWeight: 700 }}>Trip Timeline</div>
                          <div style={{ fontSize: 13, color: '#8b8fa3' }}>Manage route legs, then fill each day with plans and attach important booking references.</div>
                        </div>
                        <button className="btn btn-primary" onClick={() => openLegModal()}>+ Add Destination</button>
                      </div>

                      {selectedLegs.length === 0 ? (
                        <div className="empty-state" role="status">
                          <div className="empty-icon">&#127963;&#65039;</div>
                          <h3>No destinations yet</h3>
                          <p>Add at least one country and city leg to build the day-by-day itinerary.</p>
                          <button className="btn btn-primary" onClick={() => openLegModal()}>+ Add Destination</button>
                        </div>
                      ) : (
                        <div style={{ display: 'grid', gap: 18 }}>
                          {selectedLegs.map((leg, index) => {
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
                                    <button className="btn btn-secondary btn-sm" onClick={() => moveLeg(leg, -1)} disabled={index === 0}>&larr; Earlier</button>
                                    <button className="btn btn-secondary btn-sm" onClick={() => moveLeg(leg, 1)} disabled={index === selectedLegs.length - 1}>Later &rarr;</button>
                                    <button className="btn btn-secondary btn-sm" onClick={() => openLegModal(leg)}>Edit</button>
                                    <button className="btn btn-danger btn-sm" onClick={() => {
                                      if (window.confirm(`Delete destination "${leg.city}, ${leg.country}"?`)) {
                                        removeLeg(leg);
                                      }
                                    }}>Delete</button>
                                  </div>
                                </div>

                                <div className="trip-days-grid">
                                  {dayList.map(date => {
                                    const items = itineraryByDay.get(`${leg.id}:${date}`) || [];
                                    const bookingRefs = bookingsByDay.get(`${leg.id}:${date}`) || [];
                                    return (
                                      <div key={`${leg.id}:${date}`} className="card" style={{ padding: 14, display: 'grid', gap: 10, background: '#121620' }}>
                                        <div style={{ display: 'flex', justifyContent: 'space-between', gap: 8, alignItems: 'center' }}>
                                          <div>
                                            <div style={{ fontWeight: 700 }}>{formatDate(date)}</div>
                                            <div style={{ fontSize: 12, color: '#8b8fa3' }}>{date === todayStr ? 'Today' : 'Trip day'}</div>
                                          </div>
                                          <button className="btn btn-secondary btn-sm" onClick={() => openItineraryModal(leg, date)}>+ Add Plan</button>
                                        </div>

                                        {bookingRefs.length > 0 && (
                                          <div style={{ display: 'grid', gap: 8 }}>
                                            {bookingRefs.map(booking => (
                                              <div key={booking.id} style={{ padding: 10, borderRadius: 10, background: '#161b29', border: '1px solid #293046' }}>
                                                <div style={{ display: 'flex', justifyContent: 'space-between', gap: 8, alignItems: 'center' }}>
                                                  <div style={{ fontWeight: 600, fontSize: 13 }}>{booking.title}</div>
                                                  <span className="tag tag-connected">{booking.kind === 'transport' ? 'Booking' : 'Stay'}</span>
                                                </div>
                                                <div style={{ fontSize: 12, color: '#8b8fa3', marginTop: 6 }}>{getBookingTimelineLabel(booking)}</div>
                                              </div>
                                            ))}
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
                                                  <span className="tag tag-primary">{item.startTime ? `${formatTimeLabel(item.startTime)}${item.endTime ? ` - ${formatTimeLabel(item.endTime)}` : ''}` : 'Flexible'}</span>
                                                </div>
                                                {item.location && <div style={{ fontSize: 12, color: '#9ea4c5' }}>{item.location}</div>}
                                                {item.notes && <div style={{ fontSize: 12, color: '#8b8fa3' }}>{item.notes}</div>}
                                                <div className="actions-row" style={{ margin: 0, flexWrap: 'wrap' }}>
                                                  <button className="btn btn-secondary btn-sm" onClick={() => openItineraryModal(leg, date, item)}>Edit</button>
                                                  <button className="btn btn-secondary btn-sm" onClick={() => buildCalendarPayloadForItinerary(item, leg)}>Add to Calendar</button>
                                                  <button className="btn btn-danger btn-sm" onClick={() => {
                                                    if (window.confirm(`Delete "${item.title}"?`)) {
                                                      app.removeTripItineraryItem(item.id);
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
                  )}

                  {activeTab === 'bookings' && (
                    <div style={{ display: 'grid', gap: 16 }}>
                      <div className="card" style={{ padding: 18, display: 'flex', justifyContent: 'space-between', gap: 12, flexWrap: 'wrap', alignItems: 'center' }}>
                        <div>
                          <div style={{ fontSize: 16, fontWeight: 700 }}>Bookings</div>
                          <div style={{ fontSize: 13, color: '#8b8fa3' }}>Track transport and accommodation details without auto-syncing anything to external tools.</div>
                        </div>
                        <div className="actions-row" style={{ margin: 0, flexWrap: 'wrap' }}>
                          <button className="btn btn-secondary" onClick={() => openBookingModal('transport')}>+ Transport</button>
                          <button className="btn btn-primary" onClick={() => openBookingModal('stay')}>+ Stay</button>
                        </div>
                      </div>

                      <div className="trip-bookings-grid">
                        <div className="card" style={{ padding: 18, display: 'grid', gap: 12, alignContent: 'start' }}>
                          <div style={{ fontSize: 16, fontWeight: 700 }}>Transport</div>
                          {transportBookings.length === 0 ? (
                            <div style={{ fontSize: 13, color: '#8b8fa3' }}>No transport bookings yet.</div>
                          ) : (
                            transportBookings.map(booking => (
                              <div key={booking.id} style={{ padding: 14, borderRadius: 14, background: '#141926', border: '1px solid #23283c', display: 'grid', gap: 8 }}>
                                <div style={{ display: 'flex', justifyContent: 'space-between', gap: 8, alignItems: 'center' }}>
                                  <div style={{ fontWeight: 700 }}>{booking.title}</div>
                                  <span className={`tag ${isUpcomingBooking(booking) ? 'tag-primary' : 'tag-disconnected'}`}>{isUpcomingBooking(booking) ? 'Upcoming' : 'Past'}</span>
                                </div>
                                <div style={{ fontSize: 12, color: '#9ea4c5' }}>{`${booking.fromLabel || 'Origin TBD'} -> ${booking.toLabel || 'Destination TBD'}`}</div>
                                <div style={{ fontSize: 12, color: '#8b8fa3' }}>{getBookingTimelineLabel(booking)}</div>
                                {booking.confirmationCode && <div style={{ fontSize: 12, color: '#8b8fa3' }}>Confirmation {booking.confirmationCode}</div>}
                                <div className="actions-row" style={{ margin: 0, flexWrap: 'wrap' }}>
                                  <button className="btn btn-secondary btn-sm" onClick={() => openBookingModal('transport', booking)}>Edit</button>
                                  <button className="btn btn-secondary btn-sm" onClick={() => buildCalendarPayloadForBooking(booking)}>Add to Calendar</button>
                                  <button className="btn btn-danger btn-sm" onClick={() => {
                                    if (window.confirm(`Delete booking "${booking.title}"?`)) {
                                      app.removeTripBooking(booking.id);
                                    }
                                  }}>Delete</button>
                                </div>
                              </div>
                            ))
                          )}
                        </div>

                        <div className="card" style={{ padding: 18, display: 'grid', gap: 12, alignContent: 'start' }}>
                          <div style={{ fontSize: 16, fontWeight: 700 }}>Stay</div>
                          {stayBookings.length === 0 ? (
                            <div style={{ fontSize: 13, color: '#8b8fa3' }}>No stay bookings yet.</div>
                          ) : (
                            stayBookings.map(booking => (
                              <div key={booking.id} style={{ padding: 14, borderRadius: 14, background: '#141926', border: '1px solid #23283c', display: 'grid', gap: 8 }}>
                                <div style={{ display: 'flex', justifyContent: 'space-between', gap: 8, alignItems: 'center' }}>
                                  <div style={{ fontWeight: 700 }}>{booking.title}</div>
                                  <span className={`tag ${isUpcomingBooking(booking) ? 'tag-primary' : 'tag-disconnected'}`}>{isUpcomingBooking(booking) ? 'Upcoming' : 'Past'}</span>
                                </div>
                                <div style={{ fontSize: 12, color: '#9ea4c5' }}>{booking.propertyName}</div>
                                <div style={{ fontSize: 12, color: '#8b8fa3' }}>{booking.city}, {booking.country}</div>
                                <div style={{ fontSize: 12, color: '#8b8fa3' }}>{getBookingTimelineLabel(booking)}</div>
                                <div className="actions-row" style={{ margin: 0, flexWrap: 'wrap' }}>
                                  <button className="btn btn-secondary btn-sm" onClick={() => openBookingModal('stay', booking)}>Edit</button>
                                  <button className="btn btn-secondary btn-sm" onClick={() => buildCalendarPayloadForBooking(booking)}>Add to Calendar</button>
                                  <button className="btn btn-danger btn-sm" onClick={() => {
                                    if (window.confirm(`Delete booking "${booking.title}"?`)) {
                                      app.removeTripBooking(booking.id);
                                    }
                                  }}>Delete</button>
                                </div>
                              </div>
                            ))
                          )}
                        </div>
                      </div>
                    </div>
                  )}
                </>
              ) : (
                <div className="card" style={{ padding: 20, color: '#8b8fa3' }}>
                  Pick a trip from the rail or create a new one to open the planner.
                </div>
              )}
            </section>
          </div>
        )}
      </div>

      {showWizard && (
        <div className="modal-overlay" onClick={() => setShowWizard(false)}>
          <div className="modal trip-wizard-modal" onClick={event => event.stopPropagation()} role="dialog" aria-modal="true" aria-label="Plan trip">
            <h2>Plan Trip</h2>
            <div style={{ display: 'flex', gap: 8, flexWrap: 'wrap', marginBottom: 12 }}>
              {(['basics', 'route', 'bookings', 'review'] as WizardStep[]).map(step => (
                <span key={step} className={`tag ${wizardStep === step ? 'tag-primary' : 'tag-disconnected'}`}>{step}</span>
              ))}
            </div>

            {wizardStep === 'basics' && (
              <div style={{ display: 'grid', gap: 12 }}>
                <div className="form-group">
                  <label htmlFor="trip-name">Trip Name</label>
                  <input id="trip-name" className="form-input" value={tripName} onChange={event => setTripName(event.target.value)} placeholder="Summer Europe route" autoFocus />
                </div>
                <div className="form-group">
                  <label htmlFor="trip-summary">Short Summary</label>
                  <textarea id="trip-summary" className="form-input" value={tripSummary} onChange={event => setTripSummary(event.target.value)} placeholder="What kind of trip is this?" />
                </div>
                <div className="form-group">
                  <label htmlFor="trip-notes">Notes</label>
                  <textarea id="trip-notes" className="form-input" value={tripNotes} onChange={event => setTripNotes(event.target.value)} placeholder="Priorities, reminders, companion notes, or context." />
                </div>
                <div className="form-group">
                  <label htmlFor="trip-status">Status</label>
                  <select id="trip-status" className="form-select" value={tripStatus} onChange={event => setTripStatus(event.target.value as TripStatus)}>
                    {TRIP_STATUS_OPTIONS.map(status => (
                      <option key={status} value={status}>{getTripStatusLabel(status)}</option>
                    ))}
                  </select>
                </div>
              </div>
            )}

            {wizardStep === 'route' && (
              <div style={{ display: 'grid', gap: 12 }}>
                {routeDrafts.map((leg, index) => (
                  <div key={leg.id} className="card" style={{ padding: 14, display: 'grid', gap: 10, background: '#141926' }}>
                    <div style={{ display: 'flex', justifyContent: 'space-between', gap: 8, alignItems: 'center' }}>
                      <div style={{ fontWeight: 700 }}>Destination {index + 1}</div>
                      {routeDrafts.length > 1 && <button className="btn btn-danger btn-sm" onClick={() => removeRouteDraft(leg.id)}>Remove</button>}
                    </div>
                    <div style={{ display: 'grid', gridTemplateColumns: '1fr 1fr', gap: 10 }}>
                      <input className="form-input" value={leg.country} onChange={event => updateRouteDraft(leg.id, { country: event.target.value })} placeholder="Country" />
                      <input className="form-input" value={leg.city} onChange={event => updateRouteDraft(leg.id, { city: event.target.value })} placeholder="City" />
                    </div>
                    <div style={{ display: 'grid', gridTemplateColumns: '1fr 1fr', gap: 10 }}>
                      <input className="form-input" type="date" value={leg.startDate} onChange={event => updateRouteDraft(leg.id, { startDate: event.target.value })} />
                      <input className="form-input" type="date" value={leg.endDate} onChange={event => updateRouteDraft(leg.id, { endDate: event.target.value })} />
                    </div>
                  </div>
                ))}
                <button className="btn btn-secondary" onClick={addRouteDraft}>+ Add Destination</button>
              </div>
            )}

            {wizardStep === 'bookings' && (
              <div style={{ display: 'grid', gap: 12 }}>
                <div style={{ fontSize: 13, color: '#8b8fa3' }}>Optional: add any bookings you already know. You can skip this and manage bookings later.</div>
                <div className="actions-row" style={{ margin: 0, flexWrap: 'wrap' }}>
                  <button className="btn btn-secondary" onClick={() => addWizardBooking('transport')}>+ Transport</button>
                  <button className="btn btn-primary" onClick={() => addWizardBooking('stay')}>+ Stay</button>
                </div>
                {wizardBookings.map(booking => (
                  <div key={booking.id} className="card" style={{ padding: 14, display: 'grid', gap: 10, background: '#141926' }}>
                    <div style={{ display: 'flex', justifyContent: 'space-between', gap: 8, alignItems: 'center' }}>
                      <div style={{ fontWeight: 700 }}>{booking.kind === 'transport' ? 'Transport Booking' : 'Stay Booking'}</div>
                      <button className="btn btn-danger btn-sm" onClick={() => removeWizardBooking(booking.id)}>Remove</button>
                    </div>
                    <select className="form-select" value={booking.legId || ''} onChange={event => updateWizardBooking(booking.id, { legId: event.target.value || undefined })}>
                      <option value="">Not tied to one destination</option>
                      {routeDrafts.map(leg => (
                        <option key={leg.id} value={leg.id}>{leg.city || 'City'} · {leg.country || 'Country'}</option>
                      ))}
                    </select>
                    {booking.kind === 'transport' ? (
                      <>
                        <div style={{ display: 'grid', gridTemplateColumns: '1fr 1fr', gap: 10 }}>
                          <input className="form-input" value={booking.title} onChange={event => updateWizardBooking(booking.id, { title: event.target.value })} placeholder="Title" />
                          <select className="form-select" value={booking.mode} onChange={event => updateWizardBooking(booking.id, { mode: event.target.value as TripTransportMode })}>
                            {TRANSPORT_MODE_OPTIONS.map(mode => <option key={mode} value={mode}>{mode}</option>)}
                          </select>
                        </div>
                        <div style={{ display: 'grid', gridTemplateColumns: '1fr 1fr', gap: 10 }}>
                          <input className="form-input" value={booking.fromLabel} onChange={event => updateWizardBooking(booking.id, { fromLabel: event.target.value })} placeholder="From" />
                          <input className="form-input" value={booking.toLabel} onChange={event => updateWizardBooking(booking.id, { toLabel: event.target.value })} placeholder="To" />
                        </div>
                        <div style={{ display: 'grid', gridTemplateColumns: '1fr 1fr', gap: 10 }}>
                          <input className="form-input" type="datetime-local" value={booking.departAt} onChange={event => updateWizardBooking(booking.id, { departAt: event.target.value })} />
                          <input className="form-input" type="datetime-local" value={booking.arriveAt} onChange={event => updateWizardBooking(booking.id, { arriveAt: event.target.value })} />
                        </div>
                      </>
                    ) : (
                      <>
                        <div style={{ display: 'grid', gridTemplateColumns: '1fr 1fr', gap: 10 }}>
                          <input className="form-input" value={booking.title} onChange={event => updateWizardBooking(booking.id, { title: event.target.value })} placeholder="Title" />
                          <input className="form-input" value={booking.propertyName} onChange={event => updateWizardBooking(booking.id, { propertyName: event.target.value })} placeholder="Hotel / Airbnb" />
                        </div>
                        <div style={{ display: 'grid', gridTemplateColumns: '1fr 1fr', gap: 10 }}>
                          <input className="form-input" value={booking.city} onChange={event => updateWizardBooking(booking.id, { city: event.target.value })} placeholder="City" />
                          <input className="form-input" value={booking.country} onChange={event => updateWizardBooking(booking.id, { country: event.target.value })} placeholder="Country" />
                        </div>
                        <div style={{ display: 'grid', gridTemplateColumns: '1fr 1fr', gap: 10 }}>
                          <input className="form-input" type="date" value={booking.checkInDate} onChange={event => updateWizardBooking(booking.id, { checkInDate: event.target.value })} />
                          <input className="form-input" type="date" value={booking.checkOutDate} onChange={event => updateWizardBooking(booking.id, { checkOutDate: event.target.value })} />
                        </div>
                      </>
                    )}
                  </div>
                ))}
              </div>
            )}

            {wizardStep === 'review' && (
              <div style={{ display: 'grid', gap: 14 }}>
                <div className="info-box" style={{ marginBottom: 0 }}>
                  <strong>{tripName || 'Untitled trip'}</strong><br />
                  {tripSummary || 'No summary yet.'}
                </div>
                <div>
                  <div style={{ fontSize: 13, fontWeight: 700, marginBottom: 8 }}>Route</div>
                  <div style={{ display: 'grid', gap: 8 }}>
                    {routeDrafts.map((leg, index) => (
                      <div key={leg.id} style={{ padding: 12, borderRadius: 12, background: '#141926', border: '1px solid #23283c' }}>
                        {index + 1}. {leg.city}, {leg.country} · {formatTripRange(leg.startDate, leg.endDate)}
                      </div>
                    ))}
                  </div>
                </div>
                <div>
                  <div style={{ fontSize: 13, fontWeight: 700, marginBottom: 8 }}>Initial bookings</div>
                  <div style={{ fontSize: 13, color: '#8b8fa3' }}>{wizardBookings.length === 0 ? 'No initial bookings. You can add them later.' : `${wizardBookings.length} booking${wizardBookings.length === 1 ? '' : 's'} ready to save.`}</div>
                </div>
              </div>
            )}

            {wizardFeedback && (
              <div className="info-box error" role="alert" aria-live="polite" style={{ marginBottom: 0 }}>
                {wizardFeedback}
              </div>
            )}

            <div className="modal-actions">
              <button className="btn btn-secondary" onClick={() => {
                setWizardFeedback(null);
                if (wizardStep === 'basics') {
                  setShowWizard(false);
                  return;
                }
                setWizardStep(wizardStep === 'route' ? 'basics' : wizardStep === 'bookings' ? 'route' : 'bookings');
              }}>
                {wizardStep === 'basics' ? 'Cancel' : 'Back'}
              </button>
              {wizardStep !== 'review' ? (
                <button className="btn btn-primary" onClick={() => {
                  if (!canAdvanceWizard()) return;
                  setWizardFeedback(null);
                  setWizardStep(wizardStep === 'basics' ? 'route' : wizardStep === 'route' ? 'bookings' : 'review');
                }} disabled={!canAdvanceWizard()}>
                  Next
                </button>
              ) : (
                <button className="btn btn-primary" onClick={saveWizard} disabled={!canAdvanceWizard()}>Create Trip</button>
              )}
            </div>
          </div>
        </div>
      )}

      {showTripEdit && (
        <div className="modal-overlay" onClick={() => setShowTripEdit(false)}>
          <div className="modal" onClick={event => event.stopPropagation()} role="dialog" aria-modal="true" aria-label="Edit trip">
            <h2>Edit Trip</h2>
            <div className="form-group">
              <label htmlFor="edit-trip-name">Trip Name</label>
              <input id="edit-trip-name" className="form-input" value={tripName} onChange={event => setTripName(event.target.value)} autoFocus />
            </div>
            <div className="form-group">
              <label htmlFor="edit-trip-summary">Summary</label>
              <textarea id="edit-trip-summary" className="form-input" value={tripSummary} onChange={event => setTripSummary(event.target.value)} />
            </div>
            <div className="form-group">
              <label htmlFor="edit-trip-notes">Notes</label>
              <textarea id="edit-trip-notes" className="form-input" value={tripNotes} onChange={event => setTripNotes(event.target.value)} />
            </div>
            <div className="form-group">
              <label htmlFor="edit-trip-status">Status</label>
              <select id="edit-trip-status" className="form-select" value={tripStatus} onChange={event => setTripStatus(event.target.value as TripStatus)}>
                {TRIP_STATUS_OPTIONS.map(status => (
                  <option key={status} value={status}>{getTripStatusLabel(status)}</option>
                ))}
              </select>
            </div>
            <div className="modal-actions">
              <button className="btn btn-secondary" onClick={() => setShowTripEdit(false)}>Cancel</button>
              <button className="btn btn-primary" onClick={saveTripEdit} disabled={!tripName.trim()}>Save Trip</button>
            </div>
          </div>
        </div>
      )}

      {showLegModal && (
        <div className="modal-overlay" onClick={() => setShowLegModal(false)}>
          <div className="modal" onClick={event => event.stopPropagation()} role="dialog" aria-modal="true" aria-label={editingLegId ? 'Edit destination' : 'Add destination'}>
            <h2>{editingLegId ? 'Edit Destination' : 'Add Destination'}</h2>
            <div style={{ display: 'grid', gridTemplateColumns: '1fr 1fr', gap: 12 }}>
              <div className="form-group">
                <label htmlFor="leg-country">Country</label>
                <input id="leg-country" className="form-input" value={legCountry} onChange={event => setLegCountry(event.target.value)} autoFocus />
              </div>
              <div className="form-group">
                <label htmlFor="leg-city">City</label>
                <input id="leg-city" className="form-input" value={legCity} onChange={event => setLegCity(event.target.value)} />
              </div>
            </div>
            <div style={{ display: 'grid', gridTemplateColumns: '1fr 1fr', gap: 12 }}>
              <div className="form-group">
                <label htmlFor="leg-start">Start Date</label>
                <input id="leg-start" className="form-input" type="date" value={legStartDate} onChange={event => setLegStartDate(event.target.value)} />
              </div>
              <div className="form-group">
                <label htmlFor="leg-end">End Date</label>
                <input id="leg-end" className="form-input" type="date" value={legEndDate} onChange={event => setLegEndDate(event.target.value)} />
              </div>
            </div>
            <div className="modal-actions">
              <button className="btn btn-secondary" onClick={() => setShowLegModal(false)}>Cancel</button>
              <button className="btn btn-primary" onClick={saveLeg} disabled={!legCountry.trim() || !legCity.trim() || !legStartDate || !legEndDate}>Save Destination</button>
            </div>
          </div>
        </div>
      )}

      {showItineraryModal && (
        <div className="modal-overlay" onClick={() => setShowItineraryModal(false)}>
          <div className="modal" onClick={event => event.stopPropagation()} role="dialog" aria-modal="true" aria-label={editingItineraryId ? 'Edit itinerary item' : 'Add itinerary item'}>
            <h2>{editingItineraryId ? 'Edit Plan' : 'Add Plan'}</h2>
            <div className="form-group">
              <label htmlFor="itinerary-leg">Destination</label>
              <select id="itinerary-leg" className="form-select" value={itineraryLegId} onChange={event => setItineraryLegId(event.target.value)}>
                {selectedLegs.map(leg => (
                  <option key={leg.id} value={leg.id}>{leg.city}, {leg.country}</option>
                ))}
              </select>
            </div>
            <div className="form-group">
              <label htmlFor="itinerary-date">Date</label>
              <input id="itinerary-date" className="form-input" type="date" value={itineraryDate} onChange={event => setItineraryDate(event.target.value)} />
            </div>
            <div className="form-group">
              <label htmlFor="itinerary-title">Title</label>
              <input id="itinerary-title" className="form-input" value={itineraryTitle} onChange={event => setItineraryTitle(event.target.value)} autoFocus />
            </div>
            <div style={{ display: 'grid', gridTemplateColumns: '1fr 1fr', gap: 12 }}>
              <div className="form-group">
                <label htmlFor="itinerary-start-time">Start Time</label>
                <input id="itinerary-start-time" className="form-input" type="time" value={itineraryStartTime} onChange={event => setItineraryStartTime(event.target.value)} />
              </div>
              <div className="form-group">
                <label htmlFor="itinerary-end-time">End Time</label>
                <input id="itinerary-end-time" className="form-input" type="time" value={itineraryEndTime} onChange={event => setItineraryEndTime(event.target.value)} />
              </div>
            </div>
            <div className="form-group">
              <label htmlFor="itinerary-location">Location</label>
              <input id="itinerary-location" className="form-input" value={itineraryLocation} onChange={event => setItineraryLocation(event.target.value)} />
            </div>
            <div className="form-group">
              <label htmlFor="itinerary-notes">Notes</label>
              <textarea id="itinerary-notes" className="form-input" value={itineraryNotes} onChange={event => setItineraryNotes(event.target.value)} />
            </div>
            <div className="modal-actions">
              <button className="btn btn-secondary" onClick={() => setShowItineraryModal(false)}>Cancel</button>
              <button className="btn btn-primary" onClick={saveItineraryItem} disabled={!itineraryLegId || !itineraryDate || !itineraryTitle.trim()}>Save Plan</button>
            </div>
          </div>
        </div>
      )}

      {showBookingModal && (
        <div className="modal-overlay" onClick={() => setShowBookingModal(false)}>
          <div className="modal trip-booking-modal" onClick={event => event.stopPropagation()} role="dialog" aria-modal="true" aria-label={editingBookingId ? 'Edit booking' : 'Add booking'}>
            <h2>{editingBookingId ? 'Edit Booking' : 'Add Booking'}</h2>
            <div className="form-group">
              <label htmlFor="booking-kind">Booking Type</label>
              <select
                id="booking-kind"
                className="form-select"
                value={bookingDraft.kind}
                onChange={event => replaceBookingDraft(event.target.value === 'transport'
                  ? buildTransportDraft(getSelectedTripBookingSeed(bookingDraft.legId))
                  : buildStayDraft(getSelectedTripBookingSeed(bookingDraft.legId)))}
                disabled={Boolean(editingBookingId)}
              >
                <option value="transport">Transport</option>
                <option value="stay">Stay</option>
              </select>
            </div>
            <div className="form-group">
              <label htmlFor="booking-leg">Destination</label>
              <select id="booking-leg" className="form-select" value={bookingDraft.legId || ''} onChange={event => updateBookingDraft({ legId: event.target.value || undefined })}>
                <option value="">Not tied to one destination</option>
                {selectedLegs.map(leg => (
                  <option key={leg.id} value={leg.id}>{leg.city}, {leg.country}</option>
                ))}
              </select>
            </div>

            {bookingDraft.kind === 'transport' ? (
              <>
                <div style={{ display: 'grid', gridTemplateColumns: '1fr 1fr', gap: 12 }}>
                  <div className="form-group">
                    <label htmlFor="booking-transport-title">Title</label>
                    <input id="booking-transport-title" className="form-input" value={bookingDraft.title} onChange={event => updateBookingDraft({ title: event.target.value })} autoFocus />
                  </div>
                  <div className="form-group">
                    <label htmlFor="booking-transport-mode">Mode</label>
                    <select id="booking-transport-mode" className="form-select" value={bookingDraft.mode} onChange={event => updateBookingDraft({ mode: event.target.value as TripTransportMode })}>
                      {TRANSPORT_MODE_OPTIONS.map(mode => (
                        <option key={mode} value={mode}>{mode}</option>
                      ))}
                    </select>
                  </div>
                </div>
                <div style={{ display: 'grid', gridTemplateColumns: '1fr 1fr', gap: 12 }}>
                  <div className="form-group">
                    <label htmlFor="booking-from">From</label>
                    <input id="booking-from" className="form-input" value={bookingDraft.fromLabel} onChange={event => updateBookingDraft({ fromLabel: event.target.value })} />
                  </div>
                  <div className="form-group">
                    <label htmlFor="booking-to">To</label>
                    <input id="booking-to" className="form-input" value={bookingDraft.toLabel} onChange={event => updateBookingDraft({ toLabel: event.target.value })} />
                  </div>
                </div>
                <div style={{ display: 'grid', gridTemplateColumns: '1fr 1fr', gap: 12 }}>
                  <div className="form-group">
                    <label htmlFor="booking-depart">Depart</label>
                    <input id="booking-depart" className="form-input" type="datetime-local" value={bookingDraft.departAt} onChange={event => updateBookingDraft({ departAt: event.target.value })} />
                  </div>
                  <div className="form-group">
                    <label htmlFor="booking-arrive">Arrive</label>
                    <input id="booking-arrive" className="form-input" type="datetime-local" value={bookingDraft.arriveAt} onChange={event => updateBookingDraft({ arriveAt: event.target.value })} />
                  </div>
                </div>
              </>
            ) : (
              <>
                <div style={{ display: 'grid', gridTemplateColumns: '1fr 1fr', gap: 12 }}>
                  <div className="form-group">
                    <label htmlFor="booking-stay-title">Title</label>
                    <input id="booking-stay-title" className="form-input" value={bookingDraft.title} onChange={event => updateBookingDraft({ title: event.target.value })} autoFocus />
                  </div>
                  <div className="form-group">
                    <label htmlFor="booking-property">Property</label>
                    <input id="booking-property" className="form-input" value={bookingDraft.propertyName} onChange={event => updateBookingDraft({ propertyName: event.target.value })} />
                  </div>
                </div>
                <div style={{ display: 'grid', gridTemplateColumns: '1fr 1fr', gap: 12 }}>
                  <div className="form-group">
                    <label htmlFor="booking-city">City</label>
                    <input id="booking-city" className="form-input" value={bookingDraft.city} onChange={event => updateBookingDraft({ city: event.target.value })} />
                  </div>
                  <div className="form-group">
                    <label htmlFor="booking-country">Country</label>
                    <input id="booking-country" className="form-input" value={bookingDraft.country} onChange={event => updateBookingDraft({ country: event.target.value })} />
                  </div>
                </div>
                <div style={{ display: 'grid', gridTemplateColumns: '1fr 1fr', gap: 12 }}>
                  <div className="form-group">
                    <label htmlFor="booking-check-in">Check In</label>
                    <input id="booking-check-in" className="form-input" type="date" value={bookingDraft.checkInDate} onChange={event => updateBookingDraft({ checkInDate: event.target.value })} />
                  </div>
                  <div className="form-group">
                    <label htmlFor="booking-check-out">Check Out</label>
                    <input id="booking-check-out" className="form-input" type="date" value={bookingDraft.checkOutDate} onChange={event => updateBookingDraft({ checkOutDate: event.target.value })} />
                  </div>
                </div>
                <div className="form-group">
                  <label htmlFor="booking-address">Address</label>
                  <input id="booking-address" className="form-input" value={bookingDraft.address} onChange={event => updateBookingDraft({ address: event.target.value })} />
                </div>
              </>
            )}

            <div style={{ display: 'grid', gridTemplateColumns: '1fr 1fr', gap: 12 }}>
              <div className="form-group">
                <label htmlFor="booking-provider">Provider</label>
                <input id="booking-provider" className="form-input" value={bookingDraft.provider} onChange={event => updateBookingDraft({ provider: event.target.value })} />
              </div>
              <div className="form-group">
                <label htmlFor="booking-confirmation">Confirmation Code</label>
                <input id="booking-confirmation" className="form-input" value={bookingDraft.confirmationCode} onChange={event => updateBookingDraft({ confirmationCode: event.target.value })} />
              </div>
            </div>
            <div className="form-group">
              <label htmlFor="booking-link">Link</label>
              <input id="booking-link" className="form-input" value={bookingDraft.link} onChange={event => updateBookingDraft({ link: event.target.value })} />
            </div>
            <div className="form-group">
              <label htmlFor="booking-notes">Notes</label>
              <textarea id="booking-notes" className="form-input" value={bookingDraft.notes} onChange={event => updateBookingDraft({ notes: event.target.value })} />
            </div>
            {bookingFeedback && (
              <div className="info-box error" role="alert" aria-live="polite" style={{ marginBottom: 0 }}>
                {bookingFeedback}
              </div>
            )}
            <div className="modal-actions">
              <button className="btn btn-secondary" onClick={() => setShowBookingModal(false)}>Cancel</button>
              <button className="btn btn-primary" onClick={saveBooking}>
                {editingBookingId ? 'Save Booking' : 'Create Booking'}
              </button>
            </div>
          </div>
        </div>
      )}

      {calendarTarget && (
        <div className="modal-overlay" onClick={() => setCalendarTarget(null)}>
          <div className="modal" onClick={event => event.stopPropagation()} role="dialog" aria-modal="true" aria-label="Add to calendar">
            <h2>Add to Calendar</h2>
            <div className="info-box" style={{ marginBottom: 0 }}>
              <strong>{calendarTarget.title}</strong><br />
              {calendarTarget.allDay ? formatTripRange(calendarTarget.start.slice(0, 10), calendarTarget.end.slice(0, 10)) : `${formatDateTime(calendarTarget.start)} -> ${formatDateTime(calendarTarget.end)}`}
            </div>
            <div className="form-group">
              <label htmlFor="trip-calendar-source">Calendar Source</label>
              <select id="trip-calendar-source" className="form-select" value={calendarSourceId} onChange={event => setCalendarSourceId(event.target.value)}>
                {app.calendarSources.map((source: CalendarSource) => (
                  <option key={source.id} value={source.id}>{source.name}</option>
                ))}
              </select>
            </div>
            <div className="modal-actions">
              <button className="btn btn-secondary" onClick={() => setCalendarTarget(null)}>Cancel</button>
              <button className="btn btn-primary" onClick={importToCalendar} disabled={!calendarSourceId}>Add Event</button>
            </div>
          </div>
        </div>
      )}
    </>
  );
}
