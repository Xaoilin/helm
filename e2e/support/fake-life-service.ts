/**
 * A stateful stand-in for the life admin service (inventory, trips, health, jobs). It keeps records in
 * the service's JSON shapes and answers through the app's contract schemas, so it cannot drift from
 * contracts/life-service. Writes are one record each, like the real service; the shared write path in
 * fake-services.ts applies the Idempotency-Key rules.
 */
import type { Route } from '@playwright/test';
import type { z } from 'zod';
import type {
  EmploymentApplication,
  FastFoodLogEntry,
  InventoryItem,
  InventoryNeed,
  Trip,
  TripBooking,
  TripBudgetEntry,
  TripItineraryItem,
  TripLeg,
} from '../../src/types/domain';
import { apiErrorSchema } from '../../src/services/backend/contracts';
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
} from '../../src/services/backend/lifeContracts';

type Json = Record<string, unknown>;

/** Scenario records in the app's shapes; the fake stores them in the service's shapes. */
export interface FakeLifeSeed {
  fastFoodEntries?: FastFoodLogEntry[];
  applications?: EmploymentApplication[];
  inventoryItems?: InventoryItem[];
  inventoryNeeds?: InventoryNeed[];
  trips?: Trip[];
  tripLegs?: TripLeg[];
  tripItineraryItems?: TripItineraryItem[];
  tripBookings?: TripBooking[];
  tripBudgetEntries?: TripBudgetEntry[];
}

export interface FakeLife {
  entries: Json[];
  applications: Json[];
  items: Json[];
  needs: Json[];
  trips: Json[];
  legs: Json[];
  itineraryItems: Json[];
  bookings: Json[];
  budgetEntries: Json[];
}

/** Undefined optional values become null and empty trip dates become null, as the service sends them. */
function toService(record: object): Json {
  return Object.fromEntries(Object.entries(record).map(([key, value]) => [key, value === undefined || value === '' && /Date$|At$|^date$/u.test(key) ? null : value]));
}

const BOOKING_FIELDS = ['legId', 'mode', 'fromLabel', 'toLabel', 'departAt', 'arriveAt', 'propertyName', 'address',
  'city', 'country', 'checkInDate', 'checkOutDate', 'budgetAmount', 'budgetStatus', 'budgetDate', 'provider',
  'confirmationCode', 'link'];
const ITEM_FIELDS = ['subcategory', 'imageUrl', 'lowStockThreshold', 'brand', 'model', 'dimensions', 'location', 'archivedAt'];
const NEED_FIELDS = ['category', 'subcategory', 'imageUrl', 'linkedItemId', 'projectCatalogKey', 'dimensions', 'orderedAt',
  'acquiredAt', 'dismissedAt'];
const APPLICATION_FIELDS = ['url', 'remoteCaveat', 'compensation', 'applicationDate', 'nextActionDate'];

function withNulls(record: Json, fields: string[]): Json {
  return { ...Object.fromEntries(fields.map(field => [field, null])), ...toService(record) };
}

function application(record: EmploymentApplication | Json): Json {
  const value = withNulls(record as Json, APPLICATION_FIELDS);
  value.history = ((value.history as Json[] | undefined) ?? []).map(entry => withNulls(entry, ['date', 'evidenceUrl']));
  return value;
}

export function createFakeLife(seed: FakeLifeSeed = {}): FakeLife {
  return {
    entries: (seed.fastFoodEntries ?? []).map(entry => withNulls(entry as unknown as Json, ['order'])),
    applications: (seed.applications ?? []).map(application),
    items: (seed.inventoryItems ?? []).map(item => withNulls(item as unknown as Json, ITEM_FIELDS)),
    needs: (seed.inventoryNeeds ?? []).map(need => withNulls(need as unknown as Json, NEED_FIELDS)),
    trips: (seed.trips ?? []).map(trip => toService(trip)),
    legs: (seed.tripLegs ?? []).map(leg => toService(leg)),
    itineraryItems: (seed.tripItineraryItems ?? []).map(item => withNulls(item as unknown as Json, ['startTime', 'endTime', 'location'])),
    bookings: (seed.tripBookings ?? []).map(booking => withNulls(booking as unknown as Json, BOOKING_FIELDS)),
    budgetEntries: (seed.tripBudgetEntries ?? []).map(entry => toService(entry)),
  };
}

async function reply(route: Route, status: number, body: unknown, schema?: z.ZodType): Promise<void> {
  if (schema) schema.parse(body);
  await route.fulfill({ status, contentType: 'application/json', body: JSON.stringify(body) });
}

function upsert(records: Json[], record: Json): Json {
  const index = records.findIndex(existing => existing.id === record.id);
  if (index >= 0) records[index] = record;
  else records.push(record);
  return record;
}

function budget(life: FakeLife, trip: Json) {
  const bookings = life.bookings.filter(booking => booking.tripId === trip.id);
  const entries = life.budgetEntries.filter(entry => entry.tripId === trip.id);
  const lines = [
    ...bookings.map(booking => ({ category: booking.kind === 'transport' ? 'transport' : 'rent',
      amount: booking.budgetAmount as number | null, status: (booking.budgetStatus as string | null) ?? 'planned' })),
    ...entries.map(entry => ({ category: entry.category as string, amount: entry.amount as number, status: entry.status as string })),
  ];
  const sum = (selected: typeof lines, paidOnly = false) => selected
    .filter(line => line.amount !== null && (!paidOnly || line.status === 'paid'))
    .reduce((total, line) => total + (line.amount ?? 0), 0);
  const forecastTotal = sum(lines);
  return {
    forecastTotal,
    paidTotal: sum(lines, true),
    remaining: (trip.budgetTotal as number) - forecastTotal,
    uncostedBookingCount: bookings.filter(booking => booking.budgetAmount === null).length,
    byCategory: ['transport', 'food', 'events', 'rent', 'shopping', 'fees', 'other'].map(category => {
      const selected = lines.filter(line => line.category === category);
      return { category, forecast: sum(selected), paid: sum(selected, true), count: selected.length,
        uncostedCount: selected.filter(line => line.amount === null).length };
    }),
  };
}

/** The trip's dates follow its dated legs in route order, as the real service refits them. */
function refit(life: FakeLife, tripId: string, now: Date): void {
  const trip = life.trips.find(candidate => candidate.id === tripId);
  if (!trip) return;
  const dated = life.legs.filter(leg => leg.tripId === tripId && leg.startDate && leg.endDate)
    .sort((left, right) => (left.sortOrder as number) - (right.sortOrder as number));
  trip.startDate = dated[0]?.startDate ?? null;
  trip.endDate = dated.at(-1)?.endDate ?? null;
  trip.updatedAt = now.toISOString();
}

function bundle(life: FakeLife, tripId: string) {
  const trip = life.trips.find(candidate => candidate.id === tripId)!;
  const parts = <T extends Json>(records: T[]) => records.filter(record => record.tripId === tripId);
  return {
    trip: { ...trip, budget: budget(life, trip) },
    legs: parts(life.legs).sort((left, right) => (left.sortOrder as number) - (right.sortOrder as number)),
    itineraryItems: parts(life.itineraryItems),
    bookings: parts(life.bookings),
    budgetEntries: parts(life.budgetEntries),
  };
}

/** Handles one `/api/life/v1/...` call against the fake's state. */
export async function handleLife(route: Route, life: FakeLife, method: string, path: string,
  body: Json | null, now: Date): Promise<void> {
  const at = now.toISOString();
  const segments = path.replace('/api/life/v1/', '').split('/').map(decodeURIComponent);
  const stamped = (existing: Json | undefined, record: Json) => ({ ...record,
    createdAt: existing?.createdAt ?? at, updatedAt: at });
  const notFound = () => reply(route, 404, { code: 'not_found', message: 'No such record.' }, apiErrorSchema);
  const [domain, kind, id, action] = segments;

  if (domain === 'health') {
    if (method === 'GET') return reply(route, 200, { entries: life.entries }, fastFoodEntriesSchema);
    const existing = life.entries.find(entry => entry.id === id);
    if (method === 'DELETE') {
      if (!existing) return notFound();
      life.entries = life.entries.filter(entry => entry.id !== id);
      return route.fulfill({ status: 204 });
    }
    const saved = upsert(life.entries, stamped(existing, withNulls({ ...body, id }, ['order'])));
    return reply(route, 200, saved, fastFoodEntrySchema);
  }

  if (domain === 'jobs') {
    if (method === 'GET') return reply(route, 200, { applications: life.applications }, jobsSchema);
    const existing = life.applications.find(candidate => candidate.id === (id ?? body?.id));
    const change = (record: Json | null, duplicate = false) => reply(route, 200,
      { applicationId: id ?? record?.id, application: record, duplicate }, applicationChangeSchema);
    if (method === 'POST' && !id) {
      if (existing) return change(existing, true);
      const history = ((body?.history as Json[] | undefined) ?? []).map(entry => ({ details: '', ...entry }));
      return change(upsert(life.applications, stamped(undefined, application({ ...body, history }))));
    }
    if (!existing) return notFound();
    if (method === 'DELETE') {
      life.applications = life.applications.filter(candidate => candidate.id !== id);
      return reply(route, 200, { applicationId: id, application: null, duplicate: false }, applicationChangeSchema);
    }
    if (method === 'POST' && action === 'history') {
      const history = [...(existing.history as Json[]), withNulls({ details: '', ...body }, ['date', 'evidenceUrl'])];
      return change(upsert(life.applications, stamped(existing, { ...existing, history })));
    }
    const fields: Json = { ...body };
    const clear = (fields.clear as string[] | undefined) ?? [];
    delete fields.clear;
    delete fields.expectedUpdatedAt;
    const next: Json = { ...existing, ...fields };
    for (const field of clear) next[field] = null;
    return change(upsert(life.applications, stamped(existing, next)));
  }

  if (domain === 'inventory') {
    if (method === 'GET') {
      return reply(route, 200, { items: life.items, needs: life.needs }, inventorySchema);
    }
    if (kind === 'items' && method === 'POST' && !id) {
      const saved = ((body?.items as Json[]) ?? []).map(candidate => {
        const existing = life.items.find(item => item.id === candidate.id);
        return upsert(life.items, stamped(existing, withNulls({ lastVerifiedAt: at, ...existing, ...candidate }, ITEM_FIELDS)));
      });
      return reply(route, 200, { items: saved }, savedItemsSchema);
    }
    if (kind === 'items') {
      const existing = life.items.find(item => item.id === id);
      if (action === 'archive') {
        if (!existing) return notFound();
        return reply(route, 200, upsert(life.items, stamped(existing, { ...existing, archivedAt: at })), inventoryItemSchema);
      }
      const saved = upsert(life.items, stamped(existing, withNulls({ lastVerifiedAt: at, ...body, id }, ITEM_FIELDS)));
      return reply(route, 200, saved, inventoryItemSchema);
    }
    const existing = life.needs.find(need => need.id === id);
    if (action === 'acquire') {
      if (!existing) return notFound();
      const linked = life.items.find(item => item.id === existing.linkedItemId && !item.archivedAt);
      const item = linked
        ? upsert(life.items, stamped(linked, { ...linked, quantity: (linked.quantity as number) + (existing.requiredQuantity as number) }))
        : upsert(life.items, stamped(undefined, withNulls({ id: body?.newItemId, name: existing.name,
          category: existing.category ?? 'other', trackingMode: 'counted', quantity: existing.requiredQuantity,
          unit: existing.unit, specifications: existing.specifications, condition: 'new', tags: [], notes: existing.notes,
          projectCatalogKeys: [], lastVerifiedAt: at }, ITEM_FIELDS)));
      const need = upsert(life.needs, stamped(existing, { ...existing, status: 'acquired', acquiredAt: at, linkedItemId: item.id }));
      return reply(route, 200, { need, item }, acquisitionSchema);
    }
    const saved = upsert(life.needs, stamped(existing, withNulls({ ...body, id,
      orderedAt: existing?.orderedAt ?? (body?.status === 'ordered' ? at : null) }, NEED_FIELDS)));
    return reply(route, 200, saved, inventoryNeedSchema);
  }

  if (domain === 'trips') {
    if (method === 'GET' && !kind) {
      return reply(route, 200, { trips: life.trips.map(trip => ({ ...trip, budget: budget(life, trip) })),
        legs: life.legs, itineraryItems: life.itineraryItems, bookings: life.bookings,
        budgetEntries: life.budgetEntries }, tripsSchema);
    }
    if (kind === 'plans') {
      const tripId = String(body?.id);
      life.trips.unshift(stamped(undefined, { ...(body?.trip as Json), id: tripId, startDate: null, endDate: null,
        budgetCurrency: (body?.trip as Json)?.budgetCurrency ?? 'GBP', budgetTotal: (body?.trip as Json)?.budgetTotal ?? 0,
        summary: (body?.trip as Json)?.summary ?? '', notes: (body?.trip as Json)?.notes ?? '' }));
      ((body?.legs as Json[]) ?? []).forEach((leg, index) => life.legs.push(stamped(undefined, toService({ ...leg, tripId, sortOrder: index }))));
      ((body?.bookings as Json[]) ?? []).forEach(booking => life.bookings.push(stamped(undefined, withNulls({ notes: '', ...booking, tripId }, BOOKING_FIELDS))));
      refit(life, tripId, now);
      return reply(route, 200, bundle(life, tripId), tripBundleSchema);
    }
    const collections: Record<string, keyof FakeLife> = {
      legs: 'legs', 'itinerary-items': 'itineraryItems', bookings: 'bookings', 'budget-entries': 'budgetEntries',
    };
    const collection = collections[kind];
    if (!collection) {
      const tripId = kind;
      const existing = life.trips.find(trip => trip.id === tripId);
      if (method === 'DELETE') {
        life.trips = life.trips.filter(trip => trip.id !== tripId);
        for (const name of Object.values(collections)) life[name] = life[name].filter(record => record.tripId !== tripId);
        return route.fulfill({ status: 204 });
      }
      upsert(life.trips, stamped(existing, { summary: '', notes: '', budgetTotal: 0, budgetCurrency: 'GBP',
        ...toService(body ?? {}), id: tripId }));
      refit(life, tripId, now);
      return reply(route, 200, bundle(life, tripId), tripBundleSchema);
    }
    const records = life[collection];
    const existing = records.find(record => record.id === id);
    if (method === 'DELETE') {
      if (!existing) return notFound();
      life[collection] = records.filter(record => record.id !== id);
      if (collection === 'legs') {
        life.itineraryItems = life.itineraryItems.filter(item => item.legId !== id);
        life.bookings = life.bookings.filter(booking => booking.legId !== id);
        life.legs.filter(leg => leg.tripId === existing.tripId)
          .sort((left, right) => (left.sortOrder as number) - (right.sortOrder as number))
          .forEach((leg, index) => { leg.sortOrder = index; });
        refit(life, String(existing.tripId), now);
      }
      return reply(route, 200, bundle(life, String(existing.tripId)), tripBundleSchema);
    }
    if (action === 'move' && existing) {
      const legs = life.legs.filter(leg => leg.tripId === existing.tripId)
        .sort((left, right) => (left.sortOrder as number) - (right.sortOrder as number));
      const index = legs.indexOf(existing);
      const neighbour = legs[index + Number(body?.direction)];
      if (neighbour) [existing.sortOrder, neighbour.sortOrder] = [neighbour.sortOrder, existing.sortOrder];
      refit(life, String(existing.tripId), now);
      return reply(route, 200, bundle(life, String(existing.tripId)), tripBundleSchema);
    }
    const nullable = collection === 'bookings' ? BOOKING_FIELDS
      : collection === 'itineraryItems' ? ['startTime', 'endTime', 'location'] : [];
    const sortOrder = collection === 'legs'
      ? existing?.sortOrder ?? life.legs.filter(leg => leg.tripId === body?.tripId).length
      : body?.sortOrder ?? 0;
    upsert(records, stamped(existing, withNulls({ notes: '', ...body, id, ...(collection === 'legs' || collection === 'itineraryItems' ? { sortOrder } : {}) }, nullable)));
    if (collection === 'legs') refit(life, String(body?.tripId), now);
    return reply(route, 200, bundle(life, String(body?.tripId)), tripBundleSchema);
  }

  return reply(route, 404, { code: 'not_found', message: `No fake for ${method} ${path}.` }, apiErrorSchema);
}
