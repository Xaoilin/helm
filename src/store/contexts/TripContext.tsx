import { createContext, useContext, useEffect, useState, useCallback, type ReactNode } from 'react';
import { v4 as uuid } from 'uuid';
import type {
  Trip,
  TripBooking,
  TripBookingInput,
  TripBudgetCategory,
  TripBudgetEntry,
  TripBudgetEntryInput,
  TripBudgetEntryStatus,
  TripItineraryItem,
  TripLeg,
  TripStatus,
  TripTransportBooking,
  TripTransportMode,
} from '../../types/domain';
import { TRIP_BUDGET } from '../../config/constants';
import { loadStore, saveStore } from '../persistence';
import { useRemoteStoreRefresh } from './useRemoteStoreRefresh';

interface TripContextValue {
  trips: Trip[];
  tripLegs: TripLeg[];
  tripItineraryItems: TripItineraryItem[];
  tripBookings: TripBooking[];
  tripBudgetEntries: TripBudgetEntry[];
  loaded: boolean;
  addTrip: (trip: Omit<Trip, 'id' | 'createdAt' | 'updatedAt'>) => string;
  updateTrip: (id: string, updates: Partial<Trip>) => void;
  removeTrip: (id: string) => void;
  addTripLeg: (leg: Omit<TripLeg, 'id' | 'createdAt' | 'updatedAt'>) => string;
  updateTripLeg: (id: string, updates: Partial<TripLeg>) => void;
  removeTripLeg: (id: string) => void;
  addTripItineraryItem: (item: Omit<TripItineraryItem, 'id' | 'createdAt' | 'updatedAt'>) => string;
  updateTripItineraryItem: (id: string, updates: Partial<TripItineraryItem>) => void;
  removeTripItineraryItem: (id: string) => void;
  addTripBooking: (booking: TripBookingInput) => string;
  updateTripBooking: (id: string, updates: Partial<TripBooking>) => void;
  removeTripBooking: (id: string) => void;
  addTripBudgetEntry: (entry: TripBudgetEntryInput) => string;
  updateTripBudgetEntry: (id: string, updates: Partial<TripBudgetEntry>) => void;
  removeTripBudgetEntry: (id: string) => void;
}

const TripCtx = createContext<TripContextValue | null>(null);

const VALID_TRIP_STATUSES = new Set<TripStatus>(['planning', 'booked', 'in_trip', 'completed', 'archived']);
const VALID_TRANSPORT_MODES = new Set<TripTransportMode>(['flight', 'train', 'bus', 'ferry', 'car', 'other']);
const VALID_TRIP_BUDGET_CATEGORIES = new Set<TripBudgetCategory>(['transport', 'food', 'events', 'rent', 'shopping', 'fees', 'other']);
const VALID_TRIP_BUDGET_STATUSES = new Set<TripBudgetEntryStatus>(['planned', 'paid']);

function normalizeTrip(trip: Trip, fallbackName: string): Trip {
  const createdAt = typeof trip.createdAt === 'string' && trip.createdAt ? trip.createdAt : new Date().toISOString();
  const updatedAt = typeof trip.updatedAt === 'string' && trip.updatedAt ? trip.updatedAt : createdAt;
  const budgetCurrency = typeof trip.budgetCurrency === 'string'
    && trip.budgetCurrency.trim().length === 3
    ? trip.budgetCurrency.trim().toUpperCase()
    : TRIP_BUDGET.DEFAULT_CURRENCY;
  const budgetTotal = Number.isFinite(trip.budgetTotal) ? Math.max(0, Math.round(trip.budgetTotal as number)) : 0;
  return {
    id: trip.id || uuid(),
    name: trip.name?.trim() || fallbackName,
    summary: trip.summary?.trim() || '',
    notes: trip.notes || '',
    status: VALID_TRIP_STATUSES.has(trip.status) ? trip.status : 'planning',
    startDate: trip.startDate || '',
    endDate: trip.endDate || trip.startDate || '',
    budgetCurrency,
    budgetTotal,
    createdAt,
    updatedAt,
  };
}

function normalizeTripLeg(leg: TripLeg, index: number): TripLeg {
  const createdAt = typeof leg.createdAt === 'string' && leg.createdAt ? leg.createdAt : new Date().toISOString();
  const updatedAt = typeof leg.updatedAt === 'string' && leg.updatedAt ? leg.updatedAt : createdAt;
  return {
    id: leg.id || uuid(),
    tripId: leg.tripId,
    country: leg.country?.trim() || 'Unknown country',
    city: leg.city?.trim() || 'Unknown city',
    startDate: leg.startDate || '',
    endDate: leg.endDate || leg.startDate || '',
    sortOrder: Number.isFinite(leg.sortOrder) ? leg.sortOrder : index,
    createdAt,
    updatedAt,
  };
}

function normalizeTripItineraryItem(item: TripItineraryItem, index: number): TripItineraryItem {
  const createdAt = typeof item.createdAt === 'string' && item.createdAt ? item.createdAt : new Date().toISOString();
  const updatedAt = typeof item.updatedAt === 'string' && item.updatedAt ? item.updatedAt : createdAt;
  return {
    id: item.id || uuid(),
    tripId: item.tripId,
    legId: item.legId,
    date: item.date || '',
    title: item.title?.trim() || 'Untitled plan',
    startTime: item.startTime?.trim() || undefined,
    endTime: item.endTime?.trim() || undefined,
    location: item.location?.trim() || undefined,
    notes: item.notes || '',
    sortOrder: Number.isFinite(item.sortOrder) ? item.sortOrder : index,
    createdAt,
    updatedAt,
  };
}

function normalizeTransportBooking(booking: Partial<TripTransportBooking>, base: Pick<TripBooking, 'tripId' | 'notes'>): TripTransportBooking {
  const createdAt = typeof booking.createdAt === 'string' && booking.createdAt ? booking.createdAt : new Date().toISOString();
  const updatedAt = typeof booking.updatedAt === 'string' && booking.updatedAt ? booking.updatedAt : createdAt;
  const budgetAmount = Number.isFinite(booking.budgetAmount) ? Math.max(0, Math.round(booking.budgetAmount as number)) : undefined;
  const budgetStatus = VALID_TRIP_BUDGET_STATUSES.has(booking.budgetStatus as TripBudgetEntryStatus)
    ? booking.budgetStatus as TripBudgetEntryStatus
    : undefined;
  const budgetDate = typeof booking.budgetDate === 'string' && booking.budgetDate ? booking.budgetDate : undefined;
  return {
    id: typeof booking.id === 'string' && booking.id ? booking.id : uuid(),
    tripId: booking.tripId || base.tripId,
    legId: booking.legId?.trim() || undefined,
    kind: 'transport',
    mode: VALID_TRANSPORT_MODES.has(booking.mode as TripTransportMode) ? (booking.mode as TripTransportMode) : 'other',
    title: booking.title?.trim() || 'Transport booking',
    fromLabel: booking.fromLabel?.trim() || '',
    toLabel: booking.toLabel?.trim() || '',
    departAt: booking.departAt || '',
    arriveAt: booking.arriveAt || booking.departAt || '',
    budgetAmount,
    budgetStatus,
    budgetDate,
    provider: booking.provider?.trim() || undefined,
    confirmationCode: booking.confirmationCode?.trim() || undefined,
    link: booking.link?.trim() || undefined,
    notes: booking.notes || base.notes,
    createdAt,
    updatedAt,
  };
}

function normalizeStayBooking(booking: Partial<TripBooking> & { kind: 'stay' }, tripId: string): TripBooking {
  const createdAt = typeof booking.createdAt === 'string' && booking.createdAt ? booking.createdAt : new Date().toISOString();
  const updatedAt = typeof booking.updatedAt === 'string' && booking.updatedAt ? booking.updatedAt : createdAt;
  const budgetAmount = Number.isFinite(booking.budgetAmount) ? Math.max(0, Math.round(booking.budgetAmount as number)) : undefined;
  const budgetStatus = VALID_TRIP_BUDGET_STATUSES.has(booking.budgetStatus as TripBudgetEntryStatus)
    ? booking.budgetStatus as TripBudgetEntryStatus
    : undefined;
  const budgetDate = typeof booking.budgetDate === 'string' && booking.budgetDate ? booking.budgetDate : undefined;
  return {
    id: typeof booking.id === 'string' && booking.id ? booking.id : uuid(),
    tripId: booking.tripId || tripId,
    legId: booking.legId?.trim() || undefined,
    kind: 'stay',
    title: typeof booking.title === 'string' && booking.title.trim() ? booking.title.trim() : 'Stay booking',
    propertyName: typeof booking.propertyName === 'string' && booking.propertyName.trim() ? booking.propertyName.trim() : 'Accommodation',
    address: booking.address?.trim() || undefined,
    city: typeof booking.city === 'string' && booking.city.trim() ? booking.city.trim() : '',
    country: typeof booking.country === 'string' && booking.country.trim() ? booking.country.trim() : '',
    checkInDate: typeof booking.checkInDate === 'string' ? booking.checkInDate : '',
    checkOutDate: typeof booking.checkOutDate === 'string' && booking.checkOutDate ? booking.checkOutDate : (typeof booking.checkInDate === 'string' ? booking.checkInDate : ''),
    budgetAmount,
    budgetStatus,
    budgetDate,
    provider: booking.provider?.trim() || undefined,
    confirmationCode: booking.confirmationCode?.trim() || undefined,
    link: booking.link?.trim() || undefined,
    notes: booking.notes || '',
    createdAt,
    updatedAt,
  };
}

function normalizeTripBooking(booking: TripBooking): TripBooking {
  if (booking.kind === 'transport') {
    return normalizeTransportBooking(booking, { tripId: booking.tripId, notes: booking.notes || '' });
  }
  return normalizeStayBooking(booking, booking.tripId);
}

function normalizeTripBudgetEntry(entry: TripBudgetEntry): TripBudgetEntry {
  const createdAt = typeof entry.createdAt === 'string' && entry.createdAt ? entry.createdAt : new Date().toISOString();
  const updatedAt = typeof entry.updatedAt === 'string' && entry.updatedAt ? entry.updatedAt : createdAt;
  return {
    id: entry.id || uuid(),
    tripId: entry.tripId,
    title: entry.title?.trim() || 'Budget item',
    category: VALID_TRIP_BUDGET_CATEGORIES.has(entry.category) ? entry.category : 'other',
    amount: Number.isFinite(entry.amount) ? Math.max(0, Math.round(entry.amount)) : 0,
    status: VALID_TRIP_BUDGET_STATUSES.has(entry.status) ? entry.status : 'planned',
    date: typeof entry.date === 'string' ? entry.date : '',
    notes: entry.notes || '',
    createdAt,
    updatedAt,
  };
}

export function useTripContext(): TripContextValue {
  const ctx = useContext(TripCtx);
  if (!ctx) throw new Error('useTripContext must be used within TripProvider');
  return ctx;
}

export function TripProvider({ children }: { children: ReactNode }) {
  const [trips, setTrips] = useState<Trip[]>([]);
  const [tripLegs, setTripLegs] = useState<TripLeg[]>([]);
  const [tripItineraryItems, setTripItineraryItems] = useState<TripItineraryItem[]>([]);
  const [tripBookings, setTripBookings] = useState<TripBooking[]>([]);
  const [tripBudgetEntries, setTripBudgetEntries] = useState<TripBudgetEntry[]>([]);
  const [loaded, setLoaded] = useState(false);

  useEffect(() => {
    (async () => {
      const [storedTrips, storedTripLegs, storedTripItems, storedTripBookings, storedTripBudgetEntries] = await Promise.all([
        loadStore<Trip[]>('trips'),
        loadStore<TripLeg[]>('tripLegs'),
        loadStore<TripItineraryItem[]>('tripItineraryItems'),
        loadStore<TripBooking[]>('tripBookings'),
        loadStore<TripBudgetEntry[]>('tripBudgetEntries'),
      ]);

      const nextTrips = (storedTrips || []).map((trip, index) => normalizeTrip(trip, `Trip ${index + 1}`));
      const tripIdSet = new Set(nextTrips.map(trip => trip.id));
      const nextLegs = (storedTripLegs || [])
        .filter(leg => tripIdSet.has(leg.tripId))
        .map((leg, index) => normalizeTripLeg(leg, index));
      const legIdSet = new Set(nextLegs.map(leg => leg.id));
      const nextItems = (storedTripItems || [])
        .filter(item => tripIdSet.has(item.tripId) && legIdSet.has(item.legId))
        .map((item, index) => normalizeTripItineraryItem(item, index));
      const nextBookings = (storedTripBookings || [])
        .filter(booking => tripIdSet.has(booking.tripId))
        .map(normalizeTripBooking);
      const nextBudgetEntries = (storedTripBudgetEntries || [])
        .filter(entry => tripIdSet.has(entry.tripId))
        .map(normalizeTripBudgetEntry);

      setTrips(nextTrips);
      setTripLegs(nextLegs);
      setTripItineraryItems(nextItems);
      setTripBookings(nextBookings);
      setTripBudgetEntries(nextBudgetEntries);
      setLoaded(true);
    })();
  }, []);

  useRemoteStoreRefresh(
    ['trips', 'tripLegs', 'tripItineraryItems', 'tripBookings', 'tripBudgetEntries'],
    async () => {
      const [storedTrips, storedLegs, storedItems, storedBookings, storedBudgetEntries] = await Promise.all([
        loadStore<Trip[]>('trips'),
        loadStore<TripLeg[]>('tripLegs'),
        loadStore<TripItineraryItem[]>('tripItineraryItems'),
        loadStore<TripBooking[]>('tripBookings'),
        loadStore<TripBudgetEntry[]>('tripBudgetEntries'),
      ]);
      const nextTrips = (storedTrips || []).map((trip, index) => normalizeTrip(trip, `Trip ${index + 1}`));
      const tripIds = new Set(nextTrips.map(trip => trip.id));
      const nextLegs = (storedLegs || [])
        .filter(leg => tripIds.has(leg.tripId))
        .map((leg, index) => normalizeTripLeg(leg, index));
      const legIds = new Set(nextLegs.map(leg => leg.id));
      setTrips(nextTrips);
      setTripLegs(nextLegs);
      setTripItineraryItems((storedItems || [])
        .filter(item => tripIds.has(item.tripId) && legIds.has(item.legId))
        .map((item, index) => normalizeTripItineraryItem(item, index)));
      setTripBookings((storedBookings || [])
        .filter(booking => tripIds.has(booking.tripId))
        .map(normalizeTripBooking));
      setTripBudgetEntries((storedBudgetEntries || [])
        .filter(entry => tripIds.has(entry.tripId))
        .map(normalizeTripBudgetEntry));
    },
  );

  useEffect(() => {
    if (loaded) {
      void saveStore('trips', trips);
    }
  }, [trips, loaded]);

  useEffect(() => {
    if (loaded) {
      void saveStore('tripLegs', tripLegs);
    }
  }, [tripLegs, loaded]);

  useEffect(() => {
    if (loaded) {
      void saveStore('tripItineraryItems', tripItineraryItems);
    }
  }, [tripItineraryItems, loaded]);

  useEffect(() => {
    if (loaded) {
      void saveStore('tripBookings', tripBookings);
    }
  }, [tripBookings, loaded]);

  useEffect(() => {
    if (loaded) {
      void saveStore('tripBudgetEntries', tripBudgetEntries);
    }
  }, [tripBudgetEntries, loaded]);

  const addTrip = useCallback((trip: Omit<Trip, 'id' | 'createdAt' | 'updatedAt'>): string => {
    const id = uuid();
    const now = new Date().toISOString();
    const nextTrip = normalizeTrip({
      ...trip,
      id,
      createdAt: now,
      updatedAt: now,
    }, 'New Trip');
    setTrips(prev => [nextTrip, ...prev]);
    return id;
  }, []);

  const updateTrip = useCallback((id: string, updates: Partial<Trip>) => {
    const updatedAt = new Date().toISOString();
    setTrips(prev => prev.map(trip => (
      trip.id === id
        ? normalizeTrip({
          ...trip,
          ...updates,
          id,
          updatedAt,
        }, trip.name)
        : trip
    )));
  }, []);

  const removeTrip = useCallback((id: string) => {
    setTrips(prev => prev.filter(trip => trip.id !== id));
    setTripLegs(prev => prev.filter(leg => leg.tripId !== id));
    setTripItineraryItems(prev => prev.filter(item => item.tripId !== id));
    setTripBookings(prev => prev.filter(booking => booking.tripId !== id));
    setTripBudgetEntries(prev => prev.filter(entry => entry.tripId !== id));
  }, []);

  const addTripLeg = useCallback((leg: Omit<TripLeg, 'id' | 'createdAt' | 'updatedAt'>): string => {
    const id = uuid();
    const now = new Date().toISOString();
    const nextLeg = normalizeTripLeg({
      ...leg,
      id,
      createdAt: now,
      updatedAt: now,
    }, leg.sortOrder);
    setTripLegs(prev => [...prev, nextLeg]);
    return id;
  }, []);

  const updateTripLeg = useCallback((id: string, updates: Partial<TripLeg>) => {
    const updatedAt = new Date().toISOString();
    setTripLegs(prev => prev.map((leg, index) => (
      leg.id === id
        ? normalizeTripLeg({
          ...leg,
          ...updates,
          id,
          updatedAt,
        }, index)
        : leg
    )));
  }, []);

  const removeTripLeg = useCallback((id: string) => {
    setTripLegs(prev => prev.filter(leg => leg.id !== id));
    setTripItineraryItems(prev => prev.filter(item => item.legId !== id));
    setTripBookings(prev => prev.filter(booking => booking.legId !== id));
  }, []);

  const addTripItineraryItem = useCallback((item: Omit<TripItineraryItem, 'id' | 'createdAt' | 'updatedAt'>): string => {
    const id = uuid();
    const now = new Date().toISOString();
    const nextItem = normalizeTripItineraryItem({
      ...item,
      id,
      createdAt: now,
      updatedAt: now,
    }, item.sortOrder);
    setTripItineraryItems(prev => [...prev, nextItem]);
    return id;
  }, []);

  const updateTripItineraryItem = useCallback((id: string, updates: Partial<TripItineraryItem>) => {
    const updatedAt = new Date().toISOString();
    setTripItineraryItems(prev => prev.map((item, index) => (
      item.id === id
        ? normalizeTripItineraryItem({
          ...item,
          ...updates,
          id,
          updatedAt,
        }, index)
        : item
    )));
  }, []);

  const removeTripItineraryItem = useCallback((id: string) => {
    setTripItineraryItems(prev => prev.filter(item => item.id !== id));
  }, []);

  const addTripBooking = useCallback((booking: TripBookingInput): string => {
    const id = uuid();
    const now = new Date().toISOString();
    const nextBooking = normalizeTripBooking({
      ...booking,
      id,
      createdAt: now,
      updatedAt: now,
    } as TripBooking);
    setTripBookings(prev => [...prev, nextBooking]);
    return id;
  }, []);

  const updateTripBooking = useCallback((id: string, updates: Partial<TripBooking>) => {
    const updatedAt = new Date().toISOString();
    setTripBookings(prev => prev.map(booking => (
      booking.id === id
        ? normalizeTripBooking({
          ...booking,
          ...updates,
          id,
          updatedAt,
        } as TripBooking)
        : booking
    )));
  }, []);

  const removeTripBooking = useCallback((id: string) => {
    setTripBookings(prev => prev.filter(booking => booking.id !== id));
  }, []);

  const addTripBudgetEntry = useCallback((entry: TripBudgetEntryInput): string => {
    const id = uuid();
    const now = new Date().toISOString();
    const nextEntry = normalizeTripBudgetEntry({
      ...entry,
      id,
      createdAt: now,
      updatedAt: now,
    });
    setTripBudgetEntries(prev => [...prev, nextEntry]);
    return id;
  }, []);

  const updateTripBudgetEntry = useCallback((id: string, updates: Partial<TripBudgetEntry>) => {
    const updatedAt = new Date().toISOString();
    setTripBudgetEntries(prev => prev.map(entry => (
      entry.id === id
        ? normalizeTripBudgetEntry({
          ...entry,
          ...updates,
          id,
          updatedAt,
        })
        : entry
    )));
  }, []);

  const removeTripBudgetEntry = useCallback((id: string) => {
    setTripBudgetEntries(prev => prev.filter(entry => entry.id !== id));
  }, []);

  return (
    <TripCtx.Provider value={{
      trips,
      tripLegs,
      tripItineraryItems,
      tripBookings,
      tripBudgetEntries,
      loaded,
      addTrip,
      updateTrip,
      removeTrip,
      addTripLeg,
      updateTripLeg,
      removeTripLeg,
      addTripItineraryItem,
      updateTripItineraryItem,
      removeTripItineraryItem,
      addTripBooking,
      updateTripBooking,
      removeTripBooking,
      addTripBudgetEntry,
      updateTripBudgetEntry,
      removeTripBudgetEntry,
    }}
    >
      {children}
    </TripCtx.Provider>
  );
}
