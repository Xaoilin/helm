/**
 * Stateful stand-ins for the Spring Boot prayer and profile services. Every response is parsed
 * through the app's contract schemas first, so this fake cannot drift from the contract the real
 * services are verified against (contracts/<service>/*.json).
 */
import { readFileSync } from 'node:fs';
import { join } from 'node:path';
import type { Page, Route } from '@playwright/test';
import type { z } from 'zod';
import {
  apiErrorSchema,
  dashboardSchema,
  globalSettingsSchema,
  importResultSchema,
  outcomeChangeSchema,
  outcomeListSchema,
  preferencesSchema,
  type ServiceGlobalSettings,
  type ServiceOutcome,
  type ServicePreferences,
  type ServiceTracking,
} from '../../src/services/backend/contracts';

export const SERVICES_BASE_URL = 'https://services.helm.test';

const PRAYER_NAMES = new Set(['Fajr', 'Dhuhr', 'Asr', 'Maghrib', 'Isha']);
const STATUSES = new Set(['on_time', 'late', 'missed', 'unclassified']);

export interface FakeServicesOptions {
  /** Every data call answers with this status, e.g. 503 for an outage. */
  failureStatus?: number;
  /** Saved global settings; omitted means the user never saved any. */
  profile?: Pick<ServiceGlobalSettings, 'city' | 'country' | 'timeZone'>;
}

export interface FakeServices {
  outcomes: Map<string, ServiceOutcome>;
  tracking: ServiceTracking | null;
  preferences: ServicePreferences;
  profile: ServiceGlobalSettings;
  calls: string[];
  /** Creates refused because the outcome already existed (the app re-sent known data). */
  conflicts: number;
  failureStatus?: number;
}

export function createFakeServices(options: FakeServicesOptions = {}): FakeServices {
  return {
    outcomes: new Map(),
    tracking: null,
    preferences: { enabled: true, reminderEnabled: true, reminderMinutes: 15 },
    profile: options.profile
      ? { ...options.profile, updatedAt: '2026-08-01T12:00:00Z' }
      : { city: 'Bedford', country: 'United Kingdom', timeZone: null, updatedAt: null },
    calls: [],
    conflicts: 0,
    failureStatus: options.failureStatus,
  };
}

const dashboardExample = JSON.parse(readFileSync(
  join(process.cwd(), 'contracts', 'prayer-service', 'dashboard.json'), 'utf8')).body as z.infer<typeof dashboardSchema>;

export async function installFakeServices(page: Page, services: FakeServices): Promise<void> {
  await page.route(`${SERVICES_BASE_URL}/api/**`, async route => {
    const request = route.request();
    const url = new URL(request.url());
    const call = `${request.method()} ${url.pathname}`;
    if (request.method() === 'OPTIONS') return route.fulfill({ status: 204 });

    if (url.pathname === '/api/prayer/health') return reply(route, 200, { status: 'UP', service: 'prayer-service' });
    if (url.pathname === '/api/prayer/health/database') {
      return reply(route, 200, { status: 'UP', service: 'prayer-service', database: 'UP' });
    }
    services.calls.push(call);
    if (!request.headers().authorization?.startsWith('Bearer ')) {
      return reply(route, 401, { code: 'unauthorized', message: 'Sign in.' }, apiErrorSchema);
    }
    if (services.failureStatus) {
      return reply(route, services.failureStatus, { code: 'unavailable', message: 'Service unavailable.' }, apiErrorSchema);
    }
    const now = new Date(await page.evaluate(() => Date.now()).catch(() => Date.now()));
    return handle(route, services, call, url, request.postDataJSON?.() ?? null, now);
  });
}

async function handle(
  route: Route, services: FakeServices, call: string, url: URL, body: Record<string, unknown> | null, now: Date,
): Promise<void> {
  const outcomeId = /^(PATCH|DELETE) \/api\/prayer\/v1\/outcomes\/([^/]+)$/u.exec(call);
  switch (true) {
    case call === 'GET /api/prayer/v1/dashboard':
      return reply(route, 200, dashboard(services, now), dashboardSchema);
    case call === 'GET /api/prayer/v1/outcomes':
      return reply(route, 200, listOutcomes(services, url), outcomeListSchema);
    case call === 'POST /api/prayer/v1/outcomes':
      return createOutcome(route, services, body ?? {}, now);
    case outcomeId?.[1] === 'PATCH':
      return correctOutcome(route, services, decodeURIComponent(outcomeId![2]), body ?? {}, now);
    case outcomeId?.[1] === 'DELETE':
      return deleteOutcome(route, services, decodeURIComponent(outcomeId![2]));
    case call === 'POST /api/prayer/v1/import':
      return importTracking(route, services, body ?? {}, now);
    case call === 'GET /api/prayer/v1/preferences':
      return reply(route, 200, services.preferences, preferencesSchema);
    case call === 'PUT /api/prayer/v1/preferences':
      services.preferences = preferencesSchema.parse(body);
      return reply(route, 200, services.preferences, preferencesSchema);
    case call === 'GET /api/profile/v1/settings':
      return reply(route, 200, services.profile, globalSettingsSchema);
    case call === 'PUT /api/profile/v1/settings': {
      const next = body as Pick<ServiceGlobalSettings, 'city' | 'country' | 'timeZone'>;
      services.profile = { city: next.city, country: next.country, timeZone: next.timeZone ?? null, updatedAt: now.toISOString() };
      return reply(route, 200, services.profile, globalSettingsSchema);
    }
    default:
      return reply(route, 404, { code: 'not_found', message: `No fake for ${call}.` }, apiErrorSchema);
  }
}

function trackingFor(services: FakeServices, now: Date): ServiceTracking {
  services.tracking ??= { trackingStartedAt: now.toISOString(), activationDate: null, activationPrayers: [], importedAt: null };
  return services.tracking;
}

function dashboard(services: FakeServices, now: Date) {
  const today = now.toISOString().slice(0, 10);
  return {
    ...dashboardExample,
    today,
    preferences: services.preferences,
    tracking: trackingFor(services, now),
    todayOutcomes: sortedOutcomes(services).filter(outcome => outcome.date === today),
  };
}

function listOutcomes(services: FakeServices, url: URL): ServiceOutcome[] {
  const from = url.searchParams.get('from') ?? '0000-01-01';
  const to = url.searchParams.get('to') ?? '9999-12-31';
  return sortedOutcomes(services).filter(outcome => outcome.date >= from && outcome.date <= to);
}

function createOutcome(route: Route, services: FakeServices, body: Record<string, unknown>, now: Date) {
  const key = `${body.date}::${body.prayer}`;
  if (services.outcomes.has(key)) {
    services.conflicts += 1;
    return reply(route, 409, { code: 'outcome_exists', message: `${body.prayer} is already recorded.` }, apiErrorSchema);
  }
  const completed = body.status === 'on_time' || body.status === 'late';
  const outcome: ServiceOutcome = {
    id: crypto.randomUUID(),
    date: String(body.date),
    prayer: body.prayer as ServiceOutcome['prayer'],
    status: body.status as ServiceOutcome['status'],
    recordedAt: now.toISOString(),
    source: typeof body.source === 'string' ? body.source : null,
    taskId: typeof body.taskId === 'string' ? body.taskId : null,
    rewarded: completed,
    deadlineAt: null,
  };
  services.outcomes.set(key, outcome);
  return reply(route, 201, { outcome, firstReward: completed }, outcomeChangeSchema);
}

function correctOutcome(route: Route, services: FakeServices, id: string, body: Record<string, unknown>, now: Date) {
  const entry = [...services.outcomes.entries()].find(([, outcome]) => outcome.id === id);
  if (!entry) return reply(route, 404, { code: 'outcome_not_found', message: 'No such outcome.' }, apiErrorSchema);
  const [key, existing] = entry;
  const status = body.status as ServiceOutcome['status'];
  const firstReward = (status === 'on_time' || status === 'late') && !existing.rewarded;
  const outcome: ServiceOutcome = {
    ...existing,
    status,
    recordedAt: now.toISOString(),
    source: typeof body.source === 'string' ? body.source : existing.source,
    rewarded: existing.rewarded || firstReward,
  };
  services.outcomes.set(key, outcome);
  return reply(route, 200, { outcome, firstReward }, outcomeChangeSchema);
}

function deleteOutcome(route: Route, services: FakeServices, id: string) {
  const entry = [...services.outcomes.entries()].find(([, outcome]) => outcome.id === id);
  if (!entry) return reply(route, 404, { code: 'outcome_not_found', message: 'No such outcome.' }, apiErrorSchema);
  services.outcomes.delete(entry[0]);
  return route.fulfill({ status: 204 });
}

function importTracking(route: Route, services: FakeServices, body: Record<string, unknown>, now: Date) {
  const tracking = trackingFor(services, now);
  if (tracking.importedAt) {
    return reply(route, 409, { code: 'already_imported', message: 'Prayer tracking was already imported.' }, apiErrorSchema);
  }
  const activation = body.activationDayEligibility as { date?: string; prayerNames?: string[] } | undefined;
  services.tracking = {
    trackingStartedAt: new Date(String(body.trackingStartedAt)).toISOString(),
    activationDate: activation?.date ?? null,
    activationPrayers: (activation?.prayerNames ?? []).filter(name => PRAYER_NAMES.has(name)) as ServiceTracking['activationPrayers'],
    importedAt: now.toISOString(),
  };
  const records = Object.values((body.records ?? {}) as Record<string, Record<string, unknown>>);
  let imported = 0;
  for (const record of records) {
    const key = `${record.date}::${record.prayerName}`;
    if (!PRAYER_NAMES.has(String(record.prayerName)) || !STATUSES.has(String(record.status)) || services.outcomes.has(key)) continue;
    services.outcomes.set(key, {
      id: crypto.randomUUID(),
      date: String(record.date),
      prayer: record.prayerName as ServiceOutcome['prayer'],
      status: record.status as ServiceOutcome['status'],
      recordedAt: new Date(String(record.recordedAt ?? body.trackingStartedAt)).toISOString(),
      source: typeof record.source === 'string' ? record.source : null,
      taskId: typeof record.taskId === 'string' ? record.taskId : null,
      rewarded: record.rewarded === true,
      deadlineAt: null,
    });
    imported += 1;
  }
  return reply(route, 200, { imported, skipped: records.length - imported }, importResultSchema);
}

function sortedOutcomes(services: FakeServices): ServiceOutcome[] {
  const order = ['Fajr', 'Dhuhr', 'Asr', 'Maghrib', 'Isha'];
  return [...services.outcomes.values()].sort((left, right) =>
    left.date.localeCompare(right.date) || order.indexOf(left.prayer) - order.indexOf(right.prayer));
}

/** Answers with a body that must satisfy its contract schema. */
async function reply(route: Route, status: number, body: unknown, schema?: z.ZodType): Promise<void> {
  if (schema) schema.parse(body);
  await route.fulfill({ status, contentType: 'application/json', body: JSON.stringify(body) });
}
