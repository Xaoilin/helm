/**
 * Runtime contracts for the Spring Boot life admin service (inventory, trips, health and jobs).
 * Responses are parsed straight into the app's domain types: an absent optional value arrives as
 * `null` and becomes `undefined`, and an undated trip part keeps the app's empty-string date.
 * `contracts/life-service/*.json` holds one example per response.
 */
import { z } from 'zod';
import type {
  EmploymentApplication,
  EmploymentHistoryEntry,
  FastFoodLogEntry,
  InventoryItem,
  InventoryNeed,
  Trip,
  TripBooking,
  TripBudgetEntry,
  TripItineraryItem,
  TripLeg,
} from '../../types/domain';
import { apiErrorSchema } from './contracts';

const isoDate = z.string().regex(/^\d{4}-\d{2}-\d{2}$/u);
const instant = z.string().datetime({ offset: true });
const localTime = z.string().regex(/^\d{2}:\d{2}$/u);
const localDateTime = z.string().regex(/^\d{4}-\d{2}-\d{2}T\d{2}:\d{2}$/u);

/** A nullable value the app keeps as an optional field. */
function optional<T extends z.ZodType>(schema: T) {
  return schema.nullable().transform(value => value ?? undefined);
}

/** A nullable date the app keeps as a string, empty when unknown. */
const appDate = isoDate.nullable().transform(value => value ?? '');

// ── Health ──

export const fastFoodEntrySchema = z.object({
  id: z.string(),
  venue: z.string(),
  date: isoDate,
  order: optional(z.string()),
  rating: z.enum(['good', 'mixed', 'bad', 'awful']),
  symptoms: z.array(z.enum(['fine', 'bloated', 'sluggish', 'nauseous', 'headache', 'thirsty', 'brain-fog', 'cravings'])),
  notes: z.string(),
  createdAt: instant,
  updatedAt: instant,
}).transform((entry): FastFoodLogEntry => entry);

export const fastFoodEntriesSchema = z.object({ entries: z.array(fastFoodEntrySchema) });

// ── Jobs ──

const historyEntrySchema = z.object({
  id: z.string(),
  kind: z.enum(['application', 'contact', 'document', 'remote_evidence', 'note']),
  date: optional(isoDate),
  summary: z.string(),
  details: z.string(),
  evidenceUrl: optional(z.string()),
}).transform((entry): EmploymentHistoryEntry => entry);

export const jobApplicationSchema = z.object({
  id: z.string(),
  company: z.string(),
  role: z.string(),
  url: optional(z.string()),
  workType: z.enum(['contract', 'permanent', 'unknown']),
  remoteRegion: z.enum(['uk', 'emea', 'global', 'unknown']),
  remoteStatus: z.enum(['confirmed', 'needs_verification']),
  remoteEvidence: z.string(),
  remoteCaveat: optional(z.string()),
  compensation: optional(z.string()),
  status: z.enum(['lead', 'recruiter', 'applied', 'interview', 'offer', 'closed']),
  applicationDate: optional(isoDate),
  nextAction: z.string(),
  nextActionDate: optional(isoDate),
  notes: z.string(),
  history: z.array(historyEntrySchema),
  createdAt: instant,
  updatedAt: instant,
}).transform((application): EmploymentApplication => application);

export const jobsSchema = z.object({ applications: z.array(jobApplicationSchema) });

export const applicationChangeSchema = z.object({
  applicationId: z.string(),
  application: jobApplicationSchema.nullable(),
  duplicate: z.boolean(),
});

export const applicationPageSchema = z.object({
  applications: z.array(jobApplicationSchema),
  total: z.number().int(),
  limit: z.number().int(),
  offset: z.number().int(),
});

export const applicationDetailSchema = z.object({ application: jobApplicationSchema });

// ── Inventory ──

const category = z.enum(['machine', 'tool', 'electronics', 'component', 'material', 'consumable', 'fastener',
  'safety', 'storage', 'other']);
const subcategory = z.string() as unknown as z.ZodType<NonNullable<InventoryItem['subcategory']>>;

const dimensionsSchema = z.object({
  length: optional(z.number()),
  width: optional(z.number()),
  height: optional(z.number()),
  unit: z.enum(['mm', 'cm', 'm', 'in']),
});

export const inventoryItemSchema = z.object({
  id: z.string(),
  name: z.string(),
  category,
  subcategory: optional(subcategory),
  imageUrl: optional(z.string()),
  trackingMode: z.enum(['durable', 'counted', 'measured']),
  quantity: z.number(),
  unit: z.string(),
  lowStockThreshold: optional(z.number()),
  brand: optional(z.string()),
  model: optional(z.string()),
  dimensions: optional(dimensionsSchema),
  specifications: z.record(z.string(), z.string()),
  condition: z.enum(['unknown', 'new', 'good', 'worn', 'needs_repair']),
  location: optional(z.string()),
  tags: z.array(z.string()),
  notes: z.string(),
  projectCatalogKeys: z.array(z.string()),
  lastVerifiedAt: instant,
  archivedAt: optional(instant),
  createdAt: instant,
  updatedAt: instant,
}).transform((item): InventoryItem => item);

export const inventoryNeedSchema = z.object({
  id: z.string(),
  name: z.string(),
  category: optional(category),
  subcategory: optional(subcategory),
  imageUrl: optional(z.string()),
  linkedItemId: optional(z.string()),
  projectCatalogKey: optional(z.string()),
  requiredQuantity: z.number(),
  unit: z.string(),
  dimensions: optional(dimensionsSchema),
  specifications: z.record(z.string(), z.string()),
  priority: z.enum(['low', 'normal', 'high']),
  status: z.enum(['needed', 'ordered', 'acquired', 'dismissed']),
  notes: z.string(),
  orderedAt: optional(instant),
  acquiredAt: optional(instant),
  dismissedAt: optional(instant),
  createdAt: instant,
  updatedAt: instant,
}).transform((need): InventoryNeed => need);

export const inventorySchema = z.object({
  items: z.array(inventoryItemSchema),
  needs: z.array(inventoryNeedSchema),
});

export const savedItemsSchema = z.object({ items: z.array(inventoryItemSchema) });

export const stockCheckSchema = z.object({
  query: z.string(),
  requiredQuantity: z.number(),
  unit: z.string().nullable(),
  sufficient: z.boolean(),
  matches: z.array(inventoryItemSchema),
});

export const acquisitionSchema = z.object({ need: inventoryNeedSchema, item: inventoryItemSchema.nullable() });

// ── Trips ──

const budgetStatus = z.enum(['planned', 'paid']);
const budgetCategory = z.enum(['transport', 'food', 'events', 'rent', 'shopping', 'fees', 'other']);

export const tripBudgetSchema = z.object({
  forecastTotal: z.number().int(),
  paidTotal: z.number().int(),
  remaining: z.number().int(),
  uncostedBookingCount: z.number().int(),
  byCategory: z.array(z.object({
    category: budgetCategory,
    forecast: z.number().int(),
    paid: z.number().int(),
    count: z.number().int(),
    uncostedCount: z.number().int(),
  })),
});

const tripSchema = z.object({
  id: z.string(),
  name: z.string(),
  summary: z.string(),
  notes: z.string(),
  status: z.enum(['planning', 'booked', 'in_trip', 'completed', 'archived']),
  startDate: appDate,
  endDate: appDate,
  budgetCurrency: z.string(),
  budgetTotal: z.number().int(),
  budget: tripBudgetSchema,
  createdAt: instant,
  updatedAt: instant,
}).transform(({ budget, ...trip }) => ({ trip: trip as Trip, budget }));

const tripLegSchema = z.object({
  id: z.string(),
  tripId: z.string(),
  country: z.string(),
  city: z.string(),
  startDate: appDate,
  endDate: appDate,
  sortOrder: z.number().int(),
  createdAt: instant,
  updatedAt: instant,
}).transform((leg): TripLeg => leg);

const itineraryItemSchema = z.object({
  id: z.string(),
  tripId: z.string(),
  legId: z.string(),
  date: appDate,
  title: z.string(),
  startTime: optional(localTime),
  endTime: optional(localTime),
  location: optional(z.string()),
  notes: z.string(),
  sortOrder: z.number().int(),
  createdAt: instant,
  updatedAt: instant,
}).transform((item): TripItineraryItem => item);

const bookingSchema = z.object({
  id: z.string(),
  tripId: z.string(),
  legId: optional(z.string()),
  kind: z.enum(['transport', 'stay']),
  title: z.string(),
  mode: z.enum(['flight', 'train', 'bus', 'ferry', 'car', 'other']).nullable(),
  fromLabel: z.string().nullable(),
  toLabel: z.string().nullable(),
  departAt: localDateTime.nullable(),
  arriveAt: localDateTime.nullable(),
  propertyName: z.string().nullable(),
  address: z.string().nullable(),
  city: z.string().nullable(),
  country: z.string().nullable(),
  checkInDate: isoDate.nullable(),
  checkOutDate: isoDate.nullable(),
  budgetAmount: optional(z.number().int()),
  budgetStatus: optional(budgetStatus),
  budgetDate: optional(isoDate),
  provider: optional(z.string()),
  confirmationCode: optional(z.string()),
  link: optional(z.string()),
  notes: z.string(),
  createdAt: instant,
  updatedAt: instant,
}).transform((booking): TripBooking => {
  const base = {
    id: booking.id, tripId: booking.tripId, legId: booking.legId, title: booking.title,
    budgetAmount: booking.budgetAmount, budgetStatus: booking.budgetStatus, budgetDate: booking.budgetDate,
    provider: booking.provider, confirmationCode: booking.confirmationCode, link: booking.link,
    notes: booking.notes, createdAt: booking.createdAt, updatedAt: booking.updatedAt,
  };
  return booking.kind === 'transport'
    ? {
      ...base, kind: 'transport', mode: booking.mode ?? 'other', fromLabel: booking.fromLabel ?? '',
      toLabel: booking.toLabel ?? '', departAt: booking.departAt ?? '', arriveAt: booking.arriveAt ?? '',
    }
    : {
      ...base, kind: 'stay', propertyName: booking.propertyName ?? '', address: booking.address ?? undefined,
      city: booking.city ?? '', country: booking.country ?? '', checkInDate: booking.checkInDate ?? '',
      checkOutDate: booking.checkOutDate ?? '',
    };
});

const budgetEntrySchema = z.object({
  id: z.string(),
  tripId: z.string(),
  title: z.string(),
  category: budgetCategory,
  amount: z.number().int(),
  status: budgetStatus,
  date: appDate,
  notes: z.string(),
  createdAt: instant,
  updatedAt: instant,
}).transform((entry): TripBudgetEntry => entry);

const tripPartsShape = {
  legs: z.array(tripLegSchema),
  itineraryItems: z.array(itineraryItemSchema),
  bookings: z.array(bookingSchema),
  budgetEntries: z.array(budgetEntrySchema),
};

/** One trip after a write, with its budget and every part. */
export const tripBundleSchema = z.object({ trip: tripSchema, ...tripPartsShape });

/** Every trip (newest first) with its budget, and every part. */
export const tripsSchema = z.object({ trips: z.array(tripSchema), ...tripPartsShape });

export type ServiceTripBudget = z.infer<typeof tripBudgetSchema>;
export type ServiceTripBundle = z.infer<typeof tripBundleSchema>;
export type ServiceTrips = z.infer<typeof tripsSchema>;
export type ServiceInventory = z.infer<typeof inventorySchema>;
export type ServiceApplicationChange = z.infer<typeof applicationChangeSchema>;
export type ServiceAcquisition = z.infer<typeof acquisitionSchema>;

/** Life service response schemas keyed by fixture file name in `contracts/life-service/`. */
export const LIFE_CONTRACT_SCHEMAS: Record<string, z.ZodType> = {
  'life-service/fast-food-entries': fastFoodEntriesSchema,
  'life-service/fast-food-entry-saved': fastFoodEntrySchema,
  'life-service/fast-food-entry-invalid': apiErrorSchema,
  'life-service/jobs': jobsSchema,
  'life-service/application': applicationDetailSchema,
  'life-service/applications-page': applicationPageSchema,
  'life-service/application-added': applicationChangeSchema,
  'life-service/application-duplicate': applicationChangeSchema,
  'life-service/application-updated': applicationChangeSchema,
  'life-service/application-history-added': applicationChangeSchema,
  'life-service/application-removed': applicationChangeSchema,
  'life-service/application-changed': apiErrorSchema,
  'life-service/inventory': inventorySchema,
  'life-service/inventory-search': inventorySchema,
  'life-service/stock-check': stockCheckSchema,
  'life-service/item-saved': inventoryItemSchema,
  'life-service/items-saved': savedItemsSchema,
  'life-service/item-archived': inventoryItemSchema,
  'life-service/item-invalid': apiErrorSchema,
  'life-service/need-saved': inventoryNeedSchema,
  'life-service/need-open': inventoryNeedSchema,
  'life-service/need-acquired': acquisitionSchema,
  'life-service/trips': tripsSchema,
  'life-service/trip-plan-created': tripBundleSchema,
  'life-service/trip-saved': tripBundleSchema,
  'life-service/leg-saved': tripBundleSchema,
  'life-service/leg-moved': tripBundleSchema,
  'life-service/leg-deleted': tripBundleSchema,
  'life-service/itinerary-item-saved': tripBundleSchema,
  'life-service/booking-saved': tripBundleSchema,
  'life-service/budget-entry-saved': tripBundleSchema,
  'life-service/trip-deleted': z.null(),
  'life-service/agent-not-approved': apiErrorSchema,
  'life-service/rate-limited': apiErrorSchema,
};
