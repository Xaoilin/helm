/**
 * Typed calls to the life admin service (`/api/life/v1`), the system of record for inventory, trips,
 * the health journal and the job tracker. Record IDs are chosen here, so a retried create never makes
 * a second record; every write names one record and carries an Idempotency-Key.
 */
import type { z } from 'zod';
import { LIFE_BACKEND_URL } from '../../config';
import type {
  EmploymentApplication,
  EmploymentHistoryEntry,
  FastFoodLogEntry,
  InventoryDimensions,
  InventoryItem,
  InventoryNeed,
  Trip,
  TripBooking,
  TripBudgetEntry,
  TripItineraryItem,
  TripLeg,
} from '../../types/domain';
import { newWriteKey } from './idempotencyKeys';
import {
  acquisitionSchema,
  applicationChangeSchema,
  fastFoodEntriesSchema,
  fastFoodEntrySchema,
  inventoryItemSchema,
  inventoryNeedSchema,
  inventorySchema,
  jobsSchema,
  savedItemsSchema,
  tripBundleSchema,
  tripsSchema,
  type ServiceAcquisition,
  type ServiceApplicationChange,
  type ServiceInventory,
  type ServiceTripBundle,
  type ServiceTrips,
} from './lifeContracts';
import { callService } from './serviceClient';

const BASE = '/api/life/v1';

export function isLifeServiceEnabled(): boolean {
  return Boolean(LIFE_BACKEND_URL.trim());
}

function path(...segments: string[]): string {
  return `${BASE}/${segments.map(segment => encodeURIComponent(segment)).join('/')}`;
}

function write<T>(method: 'POST' | 'PUT' | 'PATCH' | 'DELETE', to: string, schema: z.ZodType<T> | null,
  body?: unknown): Promise<T> {
  return callService<T>(LIFE_BACKEND_URL, method, to, schema, body, { idempotencyKey: newWriteKey() });
}

/** A copy without the named fields, e.g. the stamps the service assigns. */
export function withoutKeys<T extends object, K extends keyof T>(value: T, ...keys: K[]): Omit<T, K> {
  return Object.fromEntries(Object.entries(value).filter(([key]) => !keys.includes(key as K))) as Omit<T, K>;
}

/** Optional values the app keeps as `undefined` are sent as JSON null (absent). */
function withoutUndefined<T extends object>(value: T): T {
  return JSON.parse(JSON.stringify(value)) as T;
}

// ── Health ──

export type FastFoodEntryInput = Omit<FastFoodLogEntry, 'id' | 'createdAt' | 'updatedAt'>;

export async function getFastFoodEntries(): Promise<FastFoodLogEntry[]> {
  return (await callService(LIFE_BACKEND_URL, 'GET', `${BASE}/health/fast-food`, fastFoodEntriesSchema)).entries;
}

export function saveFastFoodEntry(id: string, entry: FastFoodEntryInput): Promise<FastFoodLogEntry> {
  return write('PUT', path('health', 'fast-food', id), fastFoodEntrySchema, withoutUndefined(entry));
}

export function deleteFastFoodEntry(id: string): Promise<void> {
  return write('DELETE', path('health', 'fast-food', id), null);
}

// ── Jobs ──

export type ApplicationInput = Omit<EmploymentApplication, 'createdAt' | 'updatedAt'>;
export type ApplicationFields = Omit<EmploymentApplication, 'id' | 'history' | 'createdAt' | 'updatedAt'>;

export async function getJobApplications(): Promise<EmploymentApplication[]> {
  return (await callService(LIFE_BACKEND_URL, 'GET', `${BASE}/jobs`, jobsSchema)).applications;
}

export function addJobApplication(application: ApplicationInput): Promise<ServiceApplicationChange> {
  return write('POST', `${BASE}/jobs/applications`, applicationChangeSchema, withoutUndefined(application));
}

/**
 * Sets the given fields and clears the optional ones named in `clear`; everything else, including the
 * history, is kept. `expectedUpdatedAt` refuses the change when the application moved on.
 */
export function updateJobApplication(id: string, fields: Partial<ApplicationFields>, clear: string[],
  expectedUpdatedAt?: string): Promise<ServiceApplicationChange> {
  return write('PATCH', path('jobs', 'applications', id), applicationChangeSchema,
    withoutUndefined({ ...fields, clear, expectedUpdatedAt }));
}

export function addJobHistory(applicationId: string, entry: EmploymentHistoryEntry): Promise<ServiceApplicationChange> {
  return write('POST', `${path('jobs', 'applications', applicationId)}/history`, applicationChangeSchema,
    withoutUndefined(entry));
}

export function removeJobApplication(id: string, expectedUpdatedAt?: string): Promise<ServiceApplicationChange> {
  const query = new URLSearchParams({ confirm: 'true', ...(expectedUpdatedAt ? { expectedUpdatedAt } : {}) });
  return write('DELETE', `${path('jobs', 'applications', id)}?${query}`, applicationChangeSchema);
}

// ── Inventory ──

export type ItemInput = Omit<InventoryItem, 'id' | 'createdAt' | 'updatedAt'>;
export type NeedInput = Omit<InventoryNeed, 'id' | 'orderedAt' | 'acquiredAt' | 'dismissedAt' | 'createdAt' | 'updatedAt'>;

export function getInventory(): Promise<ServiceInventory> {
  return callService(LIFE_BACKEND_URL, 'GET', `${BASE}/inventory`, inventorySchema);
}

function dimensionsBody(dimensions?: InventoryDimensions) {
  return dimensions ? withoutUndefined(dimensions) : undefined;
}

export function saveInventoryItem(id: string, item: ItemInput): Promise<InventoryItem> {
  return write('PUT', path('inventory', 'items', id), inventoryItemSchema,
    withoutUndefined({ ...item, dimensions: dimensionsBody(item.dimensions) }));
}

/** Creates items together, all or none (a paste review). */
export async function saveInventoryItems(items: Array<ItemInput & { id: string }>): Promise<InventoryItem[]> {
  return (await write('POST', `${BASE}/inventory/items`, savedItemsSchema, withoutUndefined({ items }))).items;
}

export function archiveInventoryItem(id: string): Promise<InventoryItem> {
  return write('POST', `${path('inventory', 'items', id)}/archive`, inventoryItemSchema);
}

export function saveInventoryNeed(id: string, need: NeedInput): Promise<InventoryNeed> {
  return write('PUT', path('inventory', 'needs', id), inventoryNeedSchema,
    withoutUndefined({ ...need, dimensions: dimensionsBody(need.dimensions) }));
}

/** Closes the need and adds its quantity to its linked item, or to a new item with `newItemId`. */
export function acquireInventoryNeed(id: string, newItemId: string): Promise<ServiceAcquisition> {
  return write('POST', `${path('inventory', 'needs', id)}/acquire`, acquisitionSchema, { newItemId });
}

// ── Trips ──

export type TripInput = Omit<Trip, 'id' | 'createdAt' | 'updatedAt'>;
export type LegInput = Pick<TripLeg, 'tripId' | 'country' | 'city' | 'startDate' | 'endDate'>;
export type ItineraryInput = Omit<TripItineraryItem, 'id' | 'createdAt' | 'updatedAt'>;
export type BookingInput = Omit<TripBooking, 'id' | 'createdAt' | 'updatedAt'>;
export type BudgetEntryInput = Omit<TripBudgetEntry, 'id' | 'createdAt' | 'updatedAt'>;

/** The app keeps unknown dates as empty strings; the service takes them as absent. */
function blankToNull<T extends object>(value: T): T {
  return Object.fromEntries(Object.entries(value).map(([key, field]) => [key, field === '' ? null : field])) as T;
}

export function getTrips(): Promise<ServiceTrips> {
  return callService(LIFE_BACKEND_URL, 'GET', `${BASE}/trips`, tripsSchema);
}

/** Creates a trip with its route (in order) and first bookings together; bookings name legs by their plan IDs. */
export function createTripPlan(id: string, trip: TripInput, legs: Array<Omit<LegInput, 'tripId'> & { id: string }>,
  bookings: Array<BookingInput & { id: string }>): Promise<ServiceTripBundle> {
  return write('POST', `${BASE}/trips/plans`, tripBundleSchema, withoutUndefined({
    id,
    trip: blankToNull(trip),
    legs: legs.map(blankToNull),
    bookings: bookings.map(booking => blankToNull({ ...booking, tripId: id })),
  }));
}

export function saveTrip(id: string, trip: TripInput): Promise<ServiceTripBundle> {
  return write('PUT', path('trips', id), tripBundleSchema, withoutUndefined(blankToNull(trip)));
}

export function deleteTrip(id: string): Promise<void> {
  return write('DELETE', path('trips', id), null);
}

export function saveTripLeg(id: string, leg: LegInput): Promise<ServiceTripBundle> {
  return write('PUT', path('trips', 'legs', id), tripBundleSchema, withoutUndefined(blankToNull(leg)));
}

export function deleteTripLeg(id: string): Promise<ServiceTripBundle> {
  return write('DELETE', path('trips', 'legs', id), tripBundleSchema);
}

export function moveTripLeg(id: string, direction: -1 | 1): Promise<ServiceTripBundle> {
  return write('POST', `${path('trips', 'legs', id)}/move`, tripBundleSchema, { direction });
}

export function saveTripItineraryItem(id: string, item: ItineraryInput): Promise<ServiceTripBundle> {
  return write('PUT', path('trips', 'itinerary-items', id), tripBundleSchema, withoutUndefined(blankToNull(item)));
}

export function deleteTripItineraryItem(id: string): Promise<ServiceTripBundle> {
  return write('DELETE', path('trips', 'itinerary-items', id), tripBundleSchema);
}

export function saveTripBooking(id: string, booking: BookingInput): Promise<ServiceTripBundle> {
  return write('PUT', path('trips', 'bookings', id), tripBundleSchema, withoutUndefined(blankToNull(booking)));
}

export function deleteTripBooking(id: string): Promise<ServiceTripBundle> {
  return write('DELETE', path('trips', 'bookings', id), tripBundleSchema);
}

export function saveTripBudgetEntry(id: string, entry: BudgetEntryInput): Promise<ServiceTripBundle> {
  return write('PUT', path('trips', 'budget-entries', id), tripBundleSchema, withoutUndefined(blankToNull(entry)));
}

export function deleteTripBudgetEntry(id: string): Promise<ServiceTripBundle> {
  return write('DELETE', path('trips', 'budget-entries', id), tripBundleSchema);
}
