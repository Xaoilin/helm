/**
 * Typed calls to the profile service (`/api/profile/v1`): account-wide settings such as location,
 * app preferences, integration records, the operational-event collector, and product usage
 * ("Activity") events and insights.
 */
import { PROFILE_BACKEND_URL } from '../../config';
import type { ProductUsageEvent, ProductUsageIngestReceipt } from '../../types/domain';
import type { ProductUsageFilters } from '../productUsageInsights';
import { activityInsightsSchema, activityReceiptSchema, type ServiceActivityInsights } from './activityContracts';
import { activityBatchKey, newWriteKey } from './idempotencyKeys';
import { callService } from './serviceClient';
import {
  appPreferencesSchema,
  globalSettingsSchema,
  integrationSchema,
  integrationsSchema,
  type ServiceAppPreferences,
  type ServiceGlobalSettings,
  type ServiceIntegration,
} from './contracts';

const SETTINGS = '/api/profile/v1/settings';
const PREFERENCES = '/api/profile/v1/preferences';
const INTEGRATIONS = '/api/profile/v1/integrations';
export const OPERATIONAL_EVENTS_PATH = '/api/profile/v1/operational-events';
const ACTIVITY_EVENTS = '/api/profile/v1/activity/events';
const ACTIVITY_INSIGHTS = '/api/profile/v1/activity/insights';
const MAX_ACTIVITY_BATCH = 25;

export type AppPreferencesInput = Omit<ServiceAppPreferences, 'updatedAt'>;
export type IntegrationInput = Pick<ServiceIntegration, 'status' | 'configuredAt' | 'lastError'>;

export function isProfileServiceEnabled(): boolean {
  return Boolean(PROFILE_BACKEND_URL.trim());
}

export function getGlobalSettings(): Promise<ServiceGlobalSettings> {
  return callService(PROFILE_BACKEND_URL, 'GET', SETTINGS, globalSettingsSchema);
}

export function saveGlobalSettings(
  settings: Pick<ServiceGlobalSettings, 'city' | 'country' | 'timeZone'>,
): Promise<ServiceGlobalSettings> {
  return callService(PROFILE_BACKEND_URL, 'PUT', SETTINGS, globalSettingsSchema, settings,
    { idempotencyKey: newWriteKey() });
}

export function getAppPreferences(): Promise<ServiceAppPreferences> {
  return callService(PROFILE_BACKEND_URL, 'GET', PREFERENCES, appPreferencesSchema);
}

export function saveAppPreferences(preferences: AppPreferencesInput): Promise<ServiceAppPreferences> {
  return callService(PROFILE_BACKEND_URL, 'PUT', PREFERENCES, appPreferencesSchema, preferences,
    { idempotencyKey: newWriteKey() });
}

export async function getIntegrations(): Promise<ServiceIntegration[]> {
  return (await callService(PROFILE_BACKEND_URL, 'GET', INTEGRATIONS, integrationsSchema)).integrations;
}

export function saveIntegration(provider: string, integration: IntegrationInput): Promise<ServiceIntegration> {
  return callService(PROFILE_BACKEND_URL, 'PUT', `${INTEGRATIONS}/${encodeURIComponent(provider)}`,
    integrationSchema, integration, { idempotencyKey: newWriteKey() });
}

/** Where operational events go, or null when the profile service is not configured. */
export function operationalEventsUrl(): string | null {
  const base = PROFILE_BACKEND_URL.trim().replace(/\/+$/u, '');
  return base ? `${base}${OPERATIONAL_EVENTS_PATH}` : null;
}

/**
 * Stores a batch of product-usage events. The batch's Idempotency-Key comes from its event IDs, so a
 * retried batch is applied once; an event already stored comes back as a duplicate, never an error.
 */
export async function ingestProductUsageEvents(events: ProductUsageEvent[]): Promise<ProductUsageIngestReceipt> {
  if (events.length < 1 || events.length > MAX_ACTIVITY_BATCH) {
    throw new Error(`Product usage batches must contain between 1 and ${MAX_ACTIVITY_BATCH} events.`);
  }
  const receipt = await callService(PROFILE_BACKEND_URL, 'POST', ACTIVITY_EVENTS, activityReceiptSchema, { events },
    { idempotencyKey: activityBatchKey(events) });
  if (receipt.accepted + receipt.duplicates !== events.length) {
    throw new Error('The Sabah One product analytics receipt was invalid.');
  }
  return receipt;
}

/** The Activity page for the chosen filters, computed by the service. */
export function getActivityInsights(filters: ProductUsageFilters): Promise<ServiceActivityInsights> {
  const query = new URLSearchParams({
    rangeDays: String(filters.rangeDays),
    kind: filters.kind,
    surface: filters.surface,
    outcome: filters.outcome,
    feature: filters.feature,
  });
  return callService(PROFILE_BACKEND_URL, 'GET', `${ACTIVITY_INSIGHTS}?${query.toString()}`, activityInsightsSchema);
}
