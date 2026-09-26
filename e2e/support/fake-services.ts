/**
 * Stateful stand-ins for the Spring Boot prayer, profile and calendar services. Every response is parsed
 * through the app's contract schemas first, so this fake cannot drift from the contract the real
 * services are verified against (contracts/<service>/*.json).
 */
import { readFileSync } from 'node:fs';
import { join } from 'node:path';
import type { Page, Route } from '@playwright/test';
import type { z } from 'zod';
import type { CalendarAccount, CalendarEvent, CalendarSource } from '../../src/types/domain';
import {
  apiErrorSchema,
  appPreferencesSchema,
  integrationSchema,
  integrationsSchema,
  operationalReceiptSchema,
  calendarAccountSchema,
  calendarEventListSchema,
  calendarEventSchema,
  calendarSchema,
  calendarSourceSchema,
  calendarSyncSchema,
  dashboardSchema,
  globalSettingsSchema,
  outcomeChangeSchema,
  outcomeListSchema,
  preferencesSchema,
  type ServiceCalendarAccount,
  type ServiceCalendarEvent,
  type ServiceCalendarSource,
  type ServiceAppPreferences,
  type ServiceGlobalSettings,
  type ServiceIntegration,
  type ServiceOutcome,
  type ServicePreferences,
  type ServiceTracking,
} from '../../src/services/backend/contracts';

export const SERVICES_BASE_URL = 'https://services.helm.test';

export interface FakeServicesOptions {
  /** Every data call answers with this status, e.g. 503 for an outage. */
  failureStatus?: number;
  /** Every outcome create is refused with this 409 error, like the real service's time rules. */
  rejectCreates?: { code: string; message: string };
  /** Saved global settings; omitted means the user never saved any. */
  profile?: Pick<ServiceGlobalSettings, 'city' | 'country' | 'timeZone'>;
  /** Saved prayer preferences; omitted means the service defaults. */
  preferences?: ServicePreferences;
  /** Saved app preferences (profile service); omitted means the service defaults. */
  appPreferences?: Omit<ServiceAppPreferences, 'updatedAt'>;
  /** Saved integration connection records (profile service); omitted means none. */
  integrations?: ServiceIntegration[];
  /** The next write is applied but its response is lost (a 503), like a reply that timed out. */
  loseNextWriteResponse?: boolean;
  /** The calendar the service holds, in the app's shapes (as scenarios describe it). */
  calendar?: { accounts?: CalendarAccount[]; sources?: CalendarSource[]; events?: CalendarEvent[] };
}

export interface FakeCalendar {
  accounts: ServiceCalendarAccount[];
  sources: ServiceCalendarSource[];
  events: ServiceCalendarEvent[];
}

/** A completed write, kept by its Idempotency-Key like the real service's processed-command table. */
interface StoredWrite {
  request: string;
  status: number;
  body: string;
}

export interface FakeServices {
  outcomes: Map<string, ServiceOutcome>;
  tracking: ServiceTracking | null;
  preferences: ServicePreferences;
  profile: ServiceGlobalSettings;
  appPreferences: ServiceAppPreferences;
  integrations: ServiceIntegration[];
  /** Operational events the app reported to the profile service. */
  operationalEvents: unknown[];
  calls: string[];
  /** Creates refused because the outcome already existed (the app re-sent known data). */
  conflicts: number;
  /** Writes answered from a stored result because their Idempotency-Key was seen before. */
  replays: number;
  processedWrites: Map<string, StoredWrite>;
  failureStatus?: number;
  rejectCreates?: { code: string; message: string };
  loseNextWriteResponse?: boolean;
  calendar: FakeCalendar;
}

function toServiceCalendar(calendar: FakeServicesOptions['calendar'] = {}): FakeCalendar {
  return {
    accounts: (calendar.accounts ?? []).map(account => ({
      id: account.id,
      provider: account.provider === 'google' ? 'google' : 'local',
      name: account.name,
      email: account.email,
      isPrimary: account.isPrimary,
      paletteIndex: account.paletteIndex ?? null,
      authStatus: account.authStatus ?? 'connected',
      authError: account.lastAuthError ?? null,
      lastSyncedAt: account.lastSyncTime ?? null,
      syncError: account.syncError ?? null,
    })),
    sources: (calendar.sources ?? []).map(source => ({
      id: source.id,
      accountId: source.accountId,
      name: source.name,
      color: source.color,
      visible: source.visible,
      googleCalendarId: source.googleCalendarId ?? null,
      accessRole: source.accessRole ?? null,
      writable: source.writable ?? true,
    })),
    events: (calendar.events ?? []).map(event => ({
      id: event.id,
      sourceId: event.sourceId,
      title: event.title,
      description: event.description,
      location: event.location ?? null,
      allDay: event.allDay,
      start: event.start,
      end: event.end,
      googleEventId: event.googleEventId ?? null,
    })),
  };
}

export function createFakeServices(options: FakeServicesOptions = {}): FakeServices {
  return {
    outcomes: new Map(),
    tracking: null,
    preferences: options.preferences ?? { enabled: true, reminderEnabled: true, reminderMinutes: 15 },
    profile: options.profile
      ? { ...options.profile, updatedAt: '2026-08-01T12:00:00Z' }
      : { city: 'Bedford', country: 'United Kingdom', timeZone: null, updatedAt: null },
    appPreferences: options.appPreferences
      ? { ...options.appPreferences, updatedAt: '2026-08-01T12:00:00Z' }
      : { theme: 'dark', dataRetentionDays: 90, telemetry: false, defaultCalendarTab: null, goalTags: [], updatedAt: null },
    integrations: options.integrations ?? [],
    operationalEvents: [],
    calls: [],
    conflicts: 0,
    replays: 0,
    processedWrites: new Map(),
    failureStatus: options.failureStatus,
    rejectCreates: options.rejectCreates,
    loseNextWriteResponse: options.loseNextWriteResponse,
    calendar: toServiceCalendar(options.calendar),
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
    if (url.pathname === '/api/calendar/health') return reply(route, 200, { status: 'UP', service: 'calendar-service' });
    if (url.pathname === '/api/calendar/health/database') {
      return reply(route, 200, { status: 'UP', service: 'calendar-service', database: 'UP' });
    }
    services.calls.push(call);
    if (!request.headers().authorization?.startsWith('Bearer ')) {
      return reply(route, 401, { code: 'unauthorized', message: 'Sign in.' }, apiErrorSchema);
    }
    if (services.failureStatus) {
      return reply(route, services.failureStatus, { code: 'unavailable', message: 'Service unavailable.' }, apiErrorSchema);
    }
    const now = new Date(await page.evaluate(() => Date.now()).catch(() => Date.now()));
    const body = request.postDataJSON?.() ?? null;
    // Telemetry is not a data write: no Idempotency-Key, and nothing is stored.
    if (call === 'POST /api/profile/v1/operational-events') {
      const events = Array.isArray(body?.events) ? body.events : [];
      services.operationalEvents.push(...events);
      return reply(route, 200, { ok: true, accepted: events.length, schemaVersion: 1 }, operationalReceiptSchema);
    }
    if (request.method() === 'GET') return handle(route, services, call, url, body, now);
    return handleWrite(route, services, call, url, body, now, request.headers()['idempotency-key']);
  });
}

/**
 * Writes behave like the real service's command queue: a repeated Idempotency-Key replays the stored
 * result, and the same key with another request is refused. The fake also insists every write is
 * named, which is the app's side of the contract.
 */
async function handleWrite(
  route: Route, services: FakeServices, call: string, url: URL, body: Record<string, unknown> | null, now: Date,
  idempotencyKey: string | undefined,
): Promise<void> {
  if (!idempotencyKey) {
    return reply(route, 400, { code: 'missing_idempotency_key', message: `${call} sent no Idempotency-Key.` },
      apiErrorSchema);
  }
  const request = `${call}\n${JSON.stringify(body)}`;
  const stored = services.processedWrites.get(idempotencyKey);
  if (stored) {
    if (stored.request !== request) {
      return reply(route, 422, { code: 'idempotency_key_reused', message: 'Key used for another request.' },
        apiErrorSchema);
    }
    services.replays += 1;
    return route.fulfill({ status: stored.status, contentType: 'application/json', body: stored.body,
      headers: { 'Idempotent-Replayed': 'true' } });
  }
  const recording = {
    fulfill: async (response: { status?: number; body?: string | Buffer }) => {
      const status = response.status ?? 200;
      if (status < 400) services.processedWrites.set(idempotencyKey, { request, status, body: String(response.body ?? '') });
      if (status < 400 && services.loseNextWriteResponse) {
        services.loseNextWriteResponse = false;
        return route.fulfill({ status: 503, contentType: 'application/json',
          body: JSON.stringify({ code: 'write_timeout', message: 'The save was not confirmed in time.' }) });
      }
      return route.fulfill(response);
    },
  } as unknown as Route;
  return handle(recording, services, call, url, body, now);
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
    case call === 'GET /api/profile/v1/preferences':
      return reply(route, 200, services.appPreferences, appPreferencesSchema);
    case call === 'PUT /api/profile/v1/preferences':
      services.appPreferences = appPreferencesSchema.parse({ ...body, updatedAt: now.toISOString() });
      return reply(route, 200, services.appPreferences, appPreferencesSchema);
    case call === 'GET /api/profile/v1/integrations':
      return reply(route, 200, { integrations: services.integrations }, integrationsSchema);
    case /^PUT \/api\/profile\/v1\/integrations\/[^/]+$/u.test(call): {
      const provider = decodeURIComponent(call.split('/').at(-1) ?? '');
      if (provider !== 'google') {
        return reply(route, 404, { code: 'unknown_integration', message: 'No integration is offered for this provider.' },
          apiErrorSchema);
      }
      const saved = integrationSchema.parse({ ...body, provider, updatedAt: now.toISOString() });
      services.integrations = [...services.integrations.filter(record => record.provider !== provider), saved];
      return reply(route, 200, saved, integrationSchema);
    }
    default:
      if (call.startsWith('GET /api/calendar/') || /^\w+ \/api\/calendar\//u.test(call)) {
        return handleCalendar(route, services.calendar, call, url, body, now);
      }
      return reply(route, 404, { code: 'not_found', message: `No fake for ${call}.` }, apiErrorSchema);
  }
}

/** The calendar service: state changes only through its API, like the real one. */
function handleCalendar(
  route: Route, calendar: FakeCalendar, call: string, url: URL, body: Record<string, unknown> | null, now: Date,
): Promise<void> {
  const [method, path] = call.split(' ');
  const id = decodeURIComponent(path.split('/').at(-1) ?? '');
  const notFound = (what: string) => reply(route, 404, { code: `${what}_not_found`, message: `No such ${what}.` },
    apiErrorSchema);
  const inRange = (event: ServiceCalendarEvent) => {
    const from = url.searchParams.get('from') ?? '0000-01-01';
    const to = url.searchParams.get('to') ?? '9999-12-31';
    return event.end.slice(0, 10) >= from && event.start.slice(0, 10) <= to;
  };
  if (method === 'GET' && path === '/api/calendar/v1/calendar') {
    return reply(route, 200, { ...calendar, events: calendar.events.filter(inRange) }, calendarSchema);
  }
  if (method === 'GET' && path === '/api/calendar/v1/events') {
    return reply(route, 200, calendar.events.filter(inRange), calendarEventListSchema);
  }
  if (method === 'POST' && path === '/api/calendar/v1/sync') {
    const accounts = calendar.accounts.filter(account => account.provider === 'google').map(account => {
      const synced = account.authStatus === 'connected';
      if (synced) account.lastSyncedAt = now.toISOString();
      return {
        accountId: account.id, email: account.email,
        status: synced ? 'synced' as const : account.authStatus === 'revoked' ? 'revoked' as const : 'needs_reconnect' as const,
        message: synced ? null : account.authError ?? 'Reconnect this account.',
        syncedAt: account.lastSyncedAt, eventCount: 0,
      };
    });
    return reply(route, 200, { accounts }, calendarSyncSchema);
  }
  if (method === 'POST' && path === '/api/calendar/v1/accounts') {
    const account: ServiceCalendarAccount = {
      id: crypto.randomUUID(), provider: 'local', name: String(body?.name), email: String(body?.email ?? ''),
      isPrimary: calendar.accounts.every(existing => !existing.isPrimary), paletteIndex: null,
      authStatus: 'connected', authError: null, lastSyncedAt: null, syncError: null,
    };
    calendar.accounts.push(account);
    calendar.sources.push({ id: crypto.randomUUID(), accountId: account.id, name: 'Calendar', color: '#4f5bff',
      visible: true, googleCalendarId: null, accessRole: null, writable: true });
    return reply(route, 201, account, calendarAccountSchema);
  }
  if (method === 'PATCH' && path.startsWith('/api/calendar/v1/accounts/')) {
    const account = calendar.accounts.find(candidate => candidate.id === id);
    if (!account) return notFound('account');
    if (body?.primary === true) calendar.accounts.forEach(other => { other.isPrimary = other.id === id; });
    if (typeof body?.name === 'string') account.name = body.name;
    if (typeof body?.paletteIndex === 'number') account.paletteIndex = body.paletteIndex;
    return reply(route, 200, account, calendarAccountSchema);
  }
  if (method === 'DELETE' && path.startsWith('/api/calendar/v1/accounts/')) {
    if (!calendar.accounts.some(account => account.id === id)) return notFound('account');
    const sourceIds = new Set(calendar.sources.filter(source => source.accountId === id).map(source => source.id));
    calendar.accounts = calendar.accounts.filter(account => account.id !== id);
    calendar.sources = calendar.sources.filter(source => !sourceIds.has(source.id));
    calendar.events = calendar.events.filter(event => !sourceIds.has(event.sourceId));
    if (calendar.accounts.length > 0 && !calendar.accounts.some(account => account.isPrimary)) calendar.accounts[0].isPrimary = true;
    return route.fulfill({ status: 204 });
  }
  if (method === 'POST' && path === '/api/calendar/v1/sources') {
    const source: ServiceCalendarSource = { id: crypto.randomUUID(), accountId: String(body?.accountId),
      name: String(body?.name), color: String(body?.color), visible: body?.visible !== false,
      googleCalendarId: null, accessRole: null, writable: true };
    calendar.sources.push(source);
    return reply(route, 201, source, calendarSourceSchema);
  }
  if (method === 'PATCH' && path.startsWith('/api/calendar/v1/sources/')) {
    const source = calendar.sources.find(candidate => candidate.id === id);
    if (!source) return notFound('source');
    Object.assign(source, Object.fromEntries(Object.entries(body ?? {})
      .filter(([key]) => ['name', 'color', 'visible', 'accountId'].includes(key))));
    return reply(route, 200, source, calendarSourceSchema);
  }
  if (method === 'DELETE' && path.startsWith('/api/calendar/v1/sources/')) {
    calendar.sources = calendar.sources.filter(source => source.id !== id);
    calendar.events = calendar.events.filter(event => event.sourceId !== id);
    return route.fulfill({ status: 204 });
  }
  if ((method === 'POST' && path === '/api/calendar/v1/events') || (method === 'PUT' && path.startsWith('/api/calendar/v1/events/'))) {
    const source = calendar.sources.find(candidate => candidate.id === body?.sourceId);
    if (!source) return notFound('source');
    if (!source.writable) {
      return reply(route, 409, { code: 'calendar_read_only', message: 'This Google calendar is read-only.' }, apiErrorSchema);
    }
    const existing = method === 'PUT' ? calendar.events.find(candidate => candidate.id === id) : undefined;
    if (method === 'PUT' && !existing) return notFound('event');
    const event: ServiceCalendarEvent = {
      id: existing?.id ?? crypto.randomUUID(), sourceId: source.id, title: String(body?.title),
      description: String(body?.description ?? ''), location: typeof body?.location === 'string' ? body.location : null,
      allDay: Boolean(body?.allDay), start: String(body?.start), end: String(body?.end),
      googleEventId: source.googleCalendarId ? existing?.googleEventId ?? crypto.randomUUID() : null,
    };
    calendar.events = [...calendar.events.filter(candidate => candidate.id !== event.id), event];
    return reply(route, existing ? 200 : 201, event, calendarEventSchema);
  }
  if (method === 'DELETE' && path.startsWith('/api/calendar/v1/events/')) {
    if (!calendar.events.some(event => event.id === id)) return notFound('event');
    calendar.events = calendar.events.filter(event => event.id !== id);
    return route.fulfill({ status: 204 });
  }
  return reply(route, 404, { code: 'not_found', message: `No fake for ${call}.` }, apiErrorSchema);
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
  if (services.rejectCreates) return reply(route, 409, services.rejectCreates, apiErrorSchema);
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
