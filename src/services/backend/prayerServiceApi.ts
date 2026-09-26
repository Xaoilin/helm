/** Typed calls to the prayer service (`/api/prayer/v1`). */
import { PRAYER_BACKEND_URL } from '../../config';
import type { PrayerCompletionSource, PrayerName, PrayerOutcomeStatus, PrayerTrackingState } from '../../types/domain';
import { callService } from './serviceClient';
import {
  dashboardSchema,
  importResultSchema,
  outcomeChangeSchema,
  outcomeListSchema,
  preferencesSchema,
  type ServiceDashboard,
  type ServiceImportResult,
  type ServiceOutcome,
  type ServiceOutcomeChange,
  type ServicePreferences,
} from './contracts';

const BASE = '/api/prayer/v1';

export function isPrayerServiceEnabled(): boolean {
  return Boolean(PRAYER_BACKEND_URL.trim());
}

export function getPrayerDashboard(city: string, country: string): Promise<ServiceDashboard> {
  const query = new URLSearchParams({ city, country });
  return callService(PRAYER_BACKEND_URL, 'GET', `${BASE}/dashboard?${query}`, dashboardSchema);
}

export function listPrayerOutcomes(from: string, to: string): Promise<ServiceOutcome[]> {
  const query = new URLSearchParams({ from, to });
  return callService(PRAYER_BACKEND_URL, 'GET', `${BASE}/outcomes?${query}`, outcomeListSchema);
}

export interface CreateOutcomeRequest {
  date: string;
  prayer: PrayerName;
  status: Exclude<PrayerOutcomeStatus, 'unclassified'>;
  source?: PrayerCompletionSource;
  taskId?: string;
}

export function createPrayerOutcome(request: CreateOutcomeRequest): Promise<ServiceOutcomeChange> {
  return callService(PRAYER_BACKEND_URL, 'POST', `${BASE}/outcomes`, outcomeChangeSchema, request);
}

export function correctPrayerOutcome(
  id: string,
  status: Exclude<PrayerOutcomeStatus, 'unclassified'>,
  source?: PrayerCompletionSource,
): Promise<ServiceOutcomeChange> {
  return callService(PRAYER_BACKEND_URL, 'PATCH', `${BASE}/outcomes/${encodeURIComponent(id)}`,
    outcomeChangeSchema, { status, ...(source ? { source } : {}) });
}

export function deletePrayerOutcome(id: string): Promise<void> {
  return callService(PRAYER_BACKEND_URL, 'DELETE', `${BASE}/outcomes/${encodeURIComponent(id)}`, null);
}

/** One-time import of this browser account's legacy tracking; the service answers 409 afterwards. */
export function importPrayerTracking(state: PrayerTrackingState): Promise<ServiceImportResult> {
  return callService(PRAYER_BACKEND_URL, 'POST', `${BASE}/import`, importResultSchema, {
    trackingStartedAt: state.trackingStartedAt,
    activationDayEligibility: state.activationDayEligibility,
    records: state.records,
  });
}

export function getPrayerPreferences(): Promise<ServicePreferences> {
  return callService(PRAYER_BACKEND_URL, 'GET', `${BASE}/preferences`, preferencesSchema);
}

export function savePrayerPreferences(preferences: ServicePreferences): Promise<ServicePreferences> {
  return callService(PRAYER_BACKEND_URL, 'PUT', `${BASE}/preferences`, preferencesSchema, preferences);
}
