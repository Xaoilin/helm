/**
 * Trips, owned by the life admin service. Each change is shown at once and saved as one record; the
 * service answers with the whole trip (dates refitted to its legs, the route renumbered, the budget
 * worked out), which replaces the app's copy of that trip. A refused save shows why and reloads.
 */
import { createContext, useCallback, useContext, useMemo, useRef, useState, type ReactNode } from 'react';
import { v4 as uuid } from 'uuid';
import type {
  Trip,
  TripBooking,
  TripBookingInput,
  TripBudgetEntry,
  TripBudgetEntryInput,
  TripItineraryItem,
  TripLeg,
} from '../../types/domain';
import {
  createTripPlan as createTripPlanInService,
  deleteTrip,
  deleteTripBooking,
  deleteTripBudgetEntry,
  deleteTripItineraryItem,
  deleteTripLeg,
  getTrips,
  isLifeServiceEnabled,
  moveTripLeg as moveTripLegInService,
  saveTrip,
  saveTripBooking,
  saveTripBudgetEntry,
  saveTripItineraryItem,
  saveTripLeg,
  withoutKeys,
  type BookingInput,
  type LegInput,
  type TripInput,
} from '../../services/backend/lifeServiceApi';
import type { ServiceTripBudget, ServiceTripBundle } from '../../services/backend/lifeContracts';
import { useServiceLoad } from './useServiceLoad';

export type NewTrip = Omit<Trip, 'id' | 'createdAt' | 'updatedAt'>;
export type PlanLeg = Omit<LegInput, 'tripId'> & { id: string };
export type PlanBooking = TripBookingInput & { id: string };

export interface TripContextValue {
  trips: Trip[];
  tripLegs: TripLeg[];
  tripItineraryItems: TripItineraryItem[];
  tripBookings: TripBooking[];
  tripBudgetEntries: TripBudgetEntry[];
  /** Each trip's budget, worked out by the service from its bookings and budget items. */
  tripBudgets: Record<string, ServiceTripBudget>;
  loaded: boolean;
  /** Why trips may be out of date; null while they are current. */
  error: string | null;
  reload: () => Promise<void>;
  addTrip: (trip: NewTrip) => string;
  /** Creates a trip with its route (in order) and first bookings in one save; bookings name plan leg IDs. */
  createTripPlan: (trip: NewTrip, legs: PlanLeg[], bookings: PlanBooking[]) => string;
  updateTrip: (id: string, updates: Partial<Trip>) => void;
  removeTrip: (id: string) => void;
  addTripLeg: (leg: Omit<TripLeg, 'id' | 'createdAt' | 'updatedAt'>) => string;
  updateTripLeg: (id: string, updates: Partial<TripLeg>) => void;
  /** Moves a leg one place earlier (-1) or later (1) in its route. */
  moveTripLeg: (id: string, direction: -1 | 1) => void;
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

interface TripState {
  trips: Trip[];
  legs: TripLeg[];
  itineraryItems: TripItineraryItem[];
  bookings: TripBooking[];
  budgetEntries: TripBudgetEntry[];
  budgets: Record<string, ServiceTripBudget>;
}

const EMPTY: TripState = { trips: [], legs: [], itineraryItems: [], bookings: [], budgetEntries: [], budgets: {} };

export const TripCtx = createContext<TripContextValue | null>(null);

export function useTripContext(): TripContextValue {
  const ctx = useContext(TripCtx);
  if (!ctx) throw new Error('useTripContext must be used within TripProvider');
  return ctx;
}

function stamp<T extends object>(record: T, id: string, existing?: { createdAt: string }) {
  const now = new Date().toISOString();
  return { ...record, id, createdAt: existing?.createdAt ?? now, updatedAt: now };
}

function withoutStamps<T extends { id: string; createdAt: string; updatedAt: string }>(record: T) {
  return withoutKeys(record, 'id', 'createdAt', 'updatedAt');
}

function replaceById<T extends { id: string }>(records: T[], record: T): T[] {
  return records.some(existing => existing.id === record.id)
    ? records.map(existing => (existing.id === record.id ? record : existing))
    : [...records, record];
}

/** The service's copy of one trip replaces the app's copy of it and all its parts. */
function withBundle(state: TripState, bundle: ServiceTripBundle): TripState {
  const tripId = bundle.trip.trip.id;
  const others = <T extends { tripId: string }>(records: T[]) => records.filter(record => record.tripId !== tripId);
  const exists = state.trips.some(trip => trip.id === tripId);
  return {
    trips: exists
      ? state.trips.map(trip => (trip.id === tripId ? bundle.trip.trip : trip))
      : [bundle.trip.trip, ...state.trips],
    legs: [...others(state.legs), ...bundle.legs],
    itineraryItems: [...others(state.itineraryItems), ...bundle.itineraryItems],
    bookings: [...others(state.bookings), ...bundle.bookings],
    budgetEntries: [...others(state.budgetEntries), ...bundle.budgetEntries],
    budgets: { ...state.budgets, [tripId]: bundle.trip.budget },
  };
}

export function TripProvider({ children }: { children: ReactNode }) {
  const [state, setState] = useState<TripState>(EMPTY);
  const stateRef = useRef<TripState>(EMPTY);
  const publish = useCallback((next: TripState) => {
    stateRef.current = next;
    setState(next);
  }, []);
  const change = useCallback((update: (current: TripState) => TripState) => publish(update(stateRef.current)),
    [publish]);

  const load = useCallback(async () => {
    const all = await getTrips();
    publish({
      trips: all.trips.map(entry => entry.trip),
      legs: all.legs,
      itineraryItems: all.itineraryItems,
      bookings: all.bookings,
      budgetEntries: all.budgetEntries,
      budgets: Object.fromEntries(all.trips.map(entry => [entry.trip.id, entry.budget])),
    });
  }, [publish]);
  const { loaded, error, reload, reportFailure } = useServiceLoad('Trips', isLifeServiceEnabled(), load);

  const save = useCallback((write: Promise<ServiceTripBundle>) => {
    write.then(bundle => change(current => withBundle(current, bundle)), reportFailure);
  }, [change, reportFailure]);

  const addTrip = useCallback((trip: NewTrip) => {
    const id = uuid();
    const input = { ...trip, name: trip.name.trim() || 'New Trip' };
    change(current => ({ ...current, trips: [stamp(input, id) as Trip, ...current.trips] }));
    save(saveTrip(id, input));
    return id;
  }, [change, save]);

  const createTripPlan = useCallback((trip: NewTrip, legs: PlanLeg[], bookings: PlanBooking[]) => {
    const id = uuid();
    const input = { ...trip, name: trip.name.trim() || 'New Trip' };
    change(current => ({
      ...current,
      trips: [stamp(input, id) as Trip, ...current.trips],
      legs: [...current.legs, ...legs.map((leg, index) => stamp({ ...leg, tripId: id, sortOrder: index }, leg.id))],
      bookings: [...current.bookings, ...bookings.map(booking => stamp({ ...booking, tripId: id }, booking.id) as TripBooking)],
    }));
    save(createTripPlanInService(id, input, legs, bookings.map(booking => ({ ...booking, tripId: id }))));
    return id;
  }, [change, save]);

  const updateTrip = useCallback((id: string, updates: Partial<Trip>) => {
    const current = stateRef.current.trips.find(trip => trip.id === id);
    if (!current) return;
    const next = { ...current, ...updates, id, name: (updates.name ?? current.name).trim() || current.name };
    change(state => ({ ...state, trips: replaceById(state.trips, stamp(next, id, current)) }));
    save(saveTrip(id, withoutStamps(next) as TripInput));
  }, [change, save]);

  const removeTrip = useCallback((id: string) => {
    change(state => ({
      trips: state.trips.filter(trip => trip.id !== id),
      legs: state.legs.filter(leg => leg.tripId !== id),
      itineraryItems: state.itineraryItems.filter(item => item.tripId !== id),
      bookings: state.bookings.filter(booking => booking.tripId !== id),
      budgetEntries: state.budgetEntries.filter(entry => entry.tripId !== id),
      budgets: Object.fromEntries(Object.entries(state.budgets).filter(([tripId]) => tripId !== id)),
    }));
    deleteTrip(id).catch(reportFailure);
  }, [change, reportFailure]);

  const legInput = (leg: Pick<TripLeg, 'tripId' | 'country' | 'city' | 'startDate' | 'endDate'>): LegInput => ({
    tripId: leg.tripId,
    country: leg.country.trim() || 'Unknown country',
    city: leg.city.trim() || 'Unknown city',
    startDate: leg.startDate,
    endDate: leg.endDate || leg.startDate,
  });

  const addTripLeg = useCallback((leg: Omit<TripLeg, 'id' | 'createdAt' | 'updatedAt'>) => {
    const id = uuid();
    change(state => ({ ...state, legs: [...state.legs, stamp(leg, id)] }));
    save(saveTripLeg(id, legInput(leg)));
    return id;
  }, [change, save]);

  const updateTripLeg = useCallback((id: string, updates: Partial<TripLeg>) => {
    const current = stateRef.current.legs.find(leg => leg.id === id);
    if (!current) return;
    const next = { ...current, ...updates, id };
    change(state => ({ ...state, legs: replaceById(state.legs, stamp(next, id, current)) }));
    save(saveTripLeg(id, legInput(next)));
  }, [change, save]);

  const moveTripLeg = useCallback((id: string, direction: -1 | 1) => {
    save(moveTripLegInService(id, direction));
  }, [save]);

  const removeTripLeg = useCallback((id: string) => {
    change(state => ({
      ...state,
      legs: state.legs.filter(leg => leg.id !== id),
      itineraryItems: state.itineraryItems.filter(item => item.legId !== id),
      bookings: state.bookings.filter(booking => booking.legId !== id),
    }));
    save(deleteTripLeg(id));
  }, [change, save]);

  const itineraryInput = (item: Omit<TripItineraryItem, 'id' | 'createdAt' | 'updatedAt'>) => ({
    ...item, title: item.title.trim() || 'Untitled plan',
  });

  const addTripItineraryItem = useCallback((item: Omit<TripItineraryItem, 'id' | 'createdAt' | 'updatedAt'>) => {
    const id = uuid();
    change(state => ({ ...state, itineraryItems: [...state.itineraryItems, stamp(item, id)] }));
    save(saveTripItineraryItem(id, itineraryInput(item)));
    return id;
  }, [change, save]);

  const updateTripItineraryItem = useCallback((id: string, updates: Partial<TripItineraryItem>) => {
    const current = stateRef.current.itineraryItems.find(item => item.id === id);
    if (!current) return;
    const next = { ...current, ...updates, id };
    change(state => ({ ...state, itineraryItems: replaceById(state.itineraryItems, stamp(next, id, current)) }));
    save(saveTripItineraryItem(id, itineraryInput(withoutStamps(next))));
  }, [change, save]);

  const removeTripItineraryItem = useCallback((id: string) => {
    change(state => ({ ...state, itineraryItems: state.itineraryItems.filter(item => item.id !== id) }));
    save(deleteTripItineraryItem(id));
  }, [change, save]);

  const addTripBooking = useCallback((booking: TripBookingInput) => {
    const id = uuid();
    change(state => ({ ...state, bookings: [...state.bookings, stamp(booking, id) as TripBooking] }));
    save(saveTripBooking(id, booking as BookingInput));
    return id;
  }, [change, save]);

  const updateTripBooking = useCallback((id: string, updates: Partial<TripBooking>) => {
    const current = stateRef.current.bookings.find(booking => booking.id === id);
    if (!current) return;
    const next = { ...current, ...updates, id } as TripBooking;
    change(state => ({ ...state, bookings: replaceById(state.bookings, stamp(next, id, current) as TripBooking) }));
    save(saveTripBooking(id, withoutStamps(next) as BookingInput));
  }, [change, save]);

  const removeTripBooking = useCallback((id: string) => {
    change(state => ({ ...state, bookings: state.bookings.filter(booking => booking.id !== id) }));
    save(deleteTripBooking(id));
  }, [change, save]);

  const budgetInput = (entry: TripBudgetEntryInput): TripBudgetEntryInput => ({
    ...entry, title: entry.title.trim() || 'Budget item',
  });

  const addTripBudgetEntry = useCallback((entry: TripBudgetEntryInput) => {
    const id = uuid();
    change(state => ({ ...state, budgetEntries: [...state.budgetEntries, stamp(entry, id)] }));
    save(saveTripBudgetEntry(id, budgetInput(entry)));
    return id;
  }, [change, save]);

  const updateTripBudgetEntry = useCallback((id: string, updates: Partial<TripBudgetEntry>) => {
    const current = stateRef.current.budgetEntries.find(entry => entry.id === id);
    if (!current) return;
    const next = { ...current, ...updates, id };
    change(state => ({ ...state, budgetEntries: replaceById(state.budgetEntries, stamp(next, id, current)) }));
    save(saveTripBudgetEntry(id, budgetInput(withoutStamps(next))));
  }, [change, save]);

  const removeTripBudgetEntry = useCallback((id: string) => {
    change(state => ({ ...state, budgetEntries: state.budgetEntries.filter(entry => entry.id !== id) }));
    save(deleteTripBudgetEntry(id));
  }, [change, save]);

  const value = useMemo<TripContextValue>(() => ({
    trips: state.trips,
    tripLegs: state.legs,
    tripItineraryItems: state.itineraryItems,
    tripBookings: state.bookings,
    tripBudgetEntries: state.budgetEntries,
    tripBudgets: state.budgets,
    loaded,
    error,
    reload,
    addTrip,
    createTripPlan,
    updateTrip,
    removeTrip,
    addTripLeg,
    updateTripLeg,
    moveTripLeg,
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
  }), [state, loaded, error, reload, addTrip, createTripPlan, updateTrip, removeTrip, addTripLeg, updateTripLeg,
    moveTripLeg, removeTripLeg, addTripItineraryItem, updateTripItineraryItem, removeTripItineraryItem,
    addTripBooking, updateTripBooking, removeTripBooking, addTripBudgetEntry, updateTripBudgetEntry,
    removeTripBudgetEntry]);

  return <TripCtx.Provider value={value}>{children}</TripCtx.Provider>;
}
