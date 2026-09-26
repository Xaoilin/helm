/** Typed calls to the prayer service (`/api/prayer/v1`). */
import { PRAYER_BACKEND_URL } from '../../config';
import type { PrayerCompletionSource, PrayerName, PrayerOutcomeStatus } from '../../types/domain';
import { newWriteKey } from './idempotencyKeys';
import { callService } from './serviceClient';
import {
  dashboardSchema,
  outcomeChangeSchema,
  outcomeListSchema,
  preferencesSchema,
  scheduleSchema,
  type ServiceDashboard,
  type ServiceOutcome,
  type ServiceOutcomeChange,
  type ServicePreferences,
  type ServiceSchedule,
} from './contracts';

const BASE = '/api/prayer/v1';

export function isPrayerServiceEnabled(): boolean {
  return Boolean(PRAYER_BACKEND_URL.trim());
}

export function getPrayerDashboard(city: string, country: string): Promise<ServiceDashboard> {
  const query = new URLSearchParams({ city, country });
  return callService(PRAYER_BACKEND_URL, 'GET', `${BASE}/dashboard?${query}`, dashboardSchema);
}

/** A location's timetable for `date` (a YYYY-MM-DD in the location's zone), today when omitted. */
export function getPrayerSchedule(city: string, country: string, date?: string): Promise<ServiceSchedule> {
  const query = new URLSearchParams({ city, country, ...(date ? { date } : {}) });
  return callService(PRAYER_BACKEND_URL, 'GET', `${BASE}/schedule?${query}`, scheduleSchema);
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

export function createPrayerOutcome(request: CreateOutcomeRequest, idempotencyKey: string): Promise<ServiceOutcomeChange> {
  return callService(PRAYER_BACKEND_URL, 'POST', `${BASE}/outcomes`, outcomeChangeSchema, request, { idempotencyKey });
}

export function correctPrayerOutcome(
  id: string,
  status: Exclude<PrayerOutcomeStatus, 'unclassified'>,
  source: PrayerCompletionSource | undefined,
  idempotencyKey: string,
): Promise<ServiceOutcomeChange> {
  return callService(PRAYER_BACKEND_URL, 'PATCH', `${BASE}/outcomes/${encodeURIComponent(id)}`,
    outcomeChangeSchema, { status, ...(source ? { source } : {}) }, { idempotencyKey });
}

export function deletePrayerOutcome(id: string, idempotencyKey: string): Promise<void> {
  return callService(PRAYER_BACKEND_URL, 'DELETE', `${BASE}/outcomes/${encodeURIComponent(id)}`, null, undefined,
    { idempotencyKey });
}

export function getPrayerPreferences(): Promise<ServicePreferences> {
  return callService(PRAYER_BACKEND_URL, 'GET', `${BASE}/preferences`, preferencesSchema);
}

export function savePrayerPreferences(preferences: ServicePreferences): Promise<ServicePreferences> {
  return callService(PRAYER_BACKEND_URL, 'PUT', `${BASE}/preferences`, preferencesSchema, preferences,
    { idempotencyKey: newWriteKey() });
}
