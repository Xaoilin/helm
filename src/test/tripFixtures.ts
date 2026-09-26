import { vi } from 'vitest';
import type { TripContextValue } from '../store/contexts/TripContext';
import type { Trip, TripBudgetEntry, TripItineraryItem, TripLeg, TripStayBooking, TripTransportBooking } from '../types/domain';

const STAMP = '2026-09-01T00:00:00.000Z';

export function makeTrip(overrides: Partial<Trip> = {}): Trip {
  return {
    id: 'trip-1',
    name: 'Iberia loop',
    summary: '',
    notes: '',
    status: 'planning',
    startDate: '2026-10-01',
    endDate: '2026-10-06',
    budgetCurrency: 'GBP',
    budgetTotal: 0,
    createdAt: STAMP,
    updatedAt: STAMP,
    ...overrides,
  };
}

export function makeTripLeg(overrides: Partial<TripLeg> = {}): TripLeg {
  return {
    id: 'leg-1',
    tripId: 'trip-1',
    country: 'Spain',
    city: 'Madrid',
    startDate: '2026-10-01',
    endDate: '2026-10-03',
    sortOrder: 0,
    createdAt: STAMP,
    updatedAt: STAMP,
    ...overrides,
  };
}

export function makeItineraryItem(overrides: Partial<TripItineraryItem> = {}): TripItineraryItem {
  return {
    id: 'item-1',
    tripId: 'trip-1',
    legId: 'leg-1',
    date: '2026-10-01',
    title: 'Prado',
    notes: '',
    sortOrder: 0,
    createdAt: STAMP,
    updatedAt: STAMP,
    ...overrides,
  };
}

export function makeTransportBooking(overrides: Partial<TripTransportBooking> = {}): TripTransportBooking {
  return {
    id: 'booking-transport',
    tripId: 'trip-1',
    kind: 'transport',
    mode: 'train',
    title: '',
    fromLabel: 'Madrid',
    toLabel: 'Lisbon',
    departAt: '2026-10-04T09:00',
    arriveAt: '2026-10-04T15:00',
    notes: '',
    createdAt: STAMP,
    updatedAt: STAMP,
    ...overrides,
  };
}

export function makeStayBooking(overrides: Partial<TripStayBooking> = {}): TripStayBooking {
  return {
    id: 'booking-stay',
    tripId: 'trip-1',
    kind: 'stay',
    title: '',
    propertyName: 'Hotel Sol',
    city: 'Madrid',
    country: 'Spain',
    checkInDate: '2026-10-01',
    checkOutDate: '2026-10-03',
    notes: '',
    createdAt: STAMP,
    updatedAt: STAMP,
    ...overrides,
  };
}

export function makeBudgetEntry(overrides: Partial<TripBudgetEntry> = {}): TripBudgetEntry {
  return {
    id: 'budget-1',
    tripId: 'trip-1',
    title: 'Museum tickets',
    category: 'events',
    amount: 2500,
    status: 'planned',
    date: '2026-10-02',
    notes: '',
    createdAt: STAMP,
    updatedAt: STAMP,
    ...overrides,
  };
}

/** A Trip store value whose mutators are spies; `add*` return predictable ids. */
export function fakeTripContext(overrides: Partial<TripContextValue> = {}) {
  let legCount = 0;
  let bookingCount = 0;
  const value = {
    trips: [],
    tripLegs: [],
    tripItineraryItems: [],
    tripBookings: [],
    tripBudgetEntries: [],
    loaded: true,
    addTrip: vi.fn(() => 'trip-new'),
    updateTrip: vi.fn(),
    removeTrip: vi.fn(),
    addTripLeg: vi.fn(() => `leg-created-${++legCount}`),
    updateTripLeg: vi.fn(),
    removeTripLeg: vi.fn(),
    addTripItineraryItem: vi.fn(() => 'item-new'),
    updateTripItineraryItem: vi.fn(),
    removeTripItineraryItem: vi.fn(),
    addTripBooking: vi.fn(() => `booking-created-${++bookingCount}`),
    updateTripBooking: vi.fn(),
    removeTripBooking: vi.fn(),
    addTripBudgetEntry: vi.fn(() => 'budget-new'),
    updateTripBudgetEntry: vi.fn(),
    removeTripBudgetEntry: vi.fn(),
    ...overrides,
  } satisfies TripContextValue;
  return value;
}
