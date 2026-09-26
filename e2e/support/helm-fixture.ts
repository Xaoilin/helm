import { expect, test as base, type Page, type Response } from '@playwright/test';
import { encodeStoreValue } from '../../src/store/recordCodec';
import { STORAGE_KEYS } from '../../src/config/constants';
import type { HelmMutation, HelmRealtimeEvent } from '../../src/store/databaseTypes';
import {
  createFakeServices,
  installFakeServices,
  SERVICES_BASE_URL,
  type FakeServices,
  type FakeServicesOptions,
} from './fake-services';
import type {
  CalendarAccount,
  CalendarEvent,
  CalendarSource,
  EmploymentApplication,
  EmploymentHistoryEntry,
  EquityPosition,
  EquityPositionDraft,
  Surface,
} from '../../src/types/domain';

const TEST_USER_ID = '11111111-1111-4111-8111-111111111111';
const TEST_EMAIL = 'e2e@example.test';
const SNAPSHOT_TIME = '2026-08-01T12:00:00.000Z';

const DEFAULT_SETTINGS = {
  theme: 'dark',
  dataRetentionDays: 90,
  telemetry: false,
  prayerEnabled: false,
  prayerCity: 'Bedford',
  prayerCountry: 'United Kingdom',
  prayerReminderEnabled: true,
  prayerReminderMinutes: 15,
  assistantEnabled: false,
  assistantProvider: 'hosted',
  assistantLanguage: 'en',
} as const;

const DEFAULT_TIMINGS = {
  Fajr: '05:00',
  Sunrise: '06:50',
  Dhuhr: '13:00',
  Asr: '16:30',
  Sunset: '20:00',
  Maghrib: '20:15',
  Isha: '21:45',
  Midnight: '00:15',
} as const;

type PrayerTimingName = keyof typeof DEFAULT_TIMINGS;

export interface HelmScenarioOptions {
  authenticated?: boolean;
  analytics?: {
    events?: Array<Record<string, unknown>>;
    failureStatus?: number;
  };
  email?: string;
  initialSurface?: Surface;
  lifeHero?: {
    failureStatus?: number;
    snapshot?: Record<string, unknown>;
  };
  now?: string;
  prayer?: {
    failureStatus?: number;
    timezone?: string;
    timings?: Partial<Record<PrayerTimingName, string>>;
  };
  /** The Spring Boot prayer and profile services (always installed, stateful per scenario). */
  services?: FakeServicesOptions;
  settings?: Record<string, unknown>;
  stores?: Record<string, unknown>;
  snapshotStatus?: number;
  userId?: string;
}

export interface HelmScenarioControl {
  setRealtimeAvailable: (available: boolean) => void;
  setBroadcastDelivery: (enabled: boolean) => void;
  getDeliveredBroadcastCount: () => number;
  addClient: (page: Page, options?: Pick<HelmScenarioOptions, 'initialSurface'>) => Promise<HelmScenarioControl>;
  applyRemoteMutations: (operations: HelmMutation[], confirmedAt?: string) => void;
  services: FakeServices;
}

export type ScenarioLoader = (options?: HelmScenarioOptions) => Promise<HelmScenarioControl>;

export const test = base.extend<{ scenario: ScenarioLoader }>({
  scenario: async ({ page }, provide) => {
    await provide(options => installScenario(page, options));
  },
});

export { expect };

export async function openApp(page: Page): Promise<void> {
  await page.goto('/');
  const navigationName = (page.viewportSize()?.width ?? 1280) <= 760
    ? 'Mobile navigation'
    : 'Main navigation';
  await expect(page.getByRole('navigation', { name: navigationName })).toBeVisible();
  await expect(page.getByRole('main', { name: 'dashboard surface' })).toBeVisible();
}

export function waitForMutation(page: Page, collection: string): Promise<Response> {
  return page.waitForResponse(response => {
    if (response.request().method() !== 'POST') return false;
    if (collection === 'employment' && /\/rpc\/employment_(add_application|update_application|add_history|remove_application)/u.test(response.url())) {
      return true;
    }
    if (collection === 'equityPositions' && /\/rpc\/equity_(add_position|update_position|remove_position)/u.test(response.url())) {
      return true;
    }
    if (!response.url().includes('/rest/v1/rpc/apply_helm_mutations')) return false;

    try {
      const body = response.request().postDataJSON() as { p_operations?: HelmMutation[] };
      return body.p_operations?.some(operation => operation.collection === collection) ?? false;
    } catch {
      return false;
    }
  });
}

async function installScenario(
  page: Page,
  options: HelmScenarioOptions = {},
  sharedDatabase?: MockDatabase,
): Promise<HelmScenarioControl> {
  if (options.now) {
    await page.clock.install({ time: new Date(options.now) });
  }

  const userId = options.userId || TEST_USER_ID;
  const stores = buildStores(options);
  const database = sharedDatabase ?? createMockDatabase(stores, userId);
  const authenticated = options.authenticated !== false;

  await page.addInitScript(({ authenticated: shouldAuthenticate, email, marker, user, initialSurface, surfaceKey }) => {
    if (sessionStorage.getItem(marker) === 'ready') return;

    localStorage.clear();
    sessionStorage.clear();
    if (initialSurface) sessionStorage.setItem(surfaceKey, initialSurface);
    if (shouldAuthenticate) {
      localStorage.setItem('sb-helm-auth-token', JSON.stringify({
        access_token: 'e2e-access-token',
        expires_at: 4_102_444_800,
        expires_in: 3600,
        refresh_token: 'e2e-refresh-token',
        token_type: 'bearer',
        user: {
          app_metadata: { provider: 'google' },
          aud: 'authenticated',
          email,
          id: user,
          role: 'authenticated',
          user_metadata: { full_name: 'E2E User' },
        },
      }));
    }
    sessionStorage.setItem(marker, 'ready');
  }, {
    authenticated,
    email: options.email || TEST_EMAIL,
    marker: 'helm-kan252-e2e-scenario-ready',
    user: userId,
    initialSurface: options.initialSurface,
    surfaceKey: STORAGE_KEYS.SHELL_SURFACE,
  });

  database.services ??= createFakeServices(servicesFromScenario(options, stores.settings as Record<string, unknown>));
  await installFakeServices(page, database.services);
  // Registered after the fake services so it answers timetable requests first.
  await installPrayerRoute(page, options.prayer);
  const control = await installDatabaseRoutes(page, {
    email: options.email || TEST_EMAIL,
    analytics: options.analytics,
    lifeHero: options.lifeHero,
    snapshotStatus: options.snapshotStatus,
    userId,
  }, database);
  await installAssistantRoute(page);
  return {
    ...control,
    services: database.services,
    addClient: (clientPage, clientOptions) => installScenario(clientPage, { ...options, ...clientOptions }, database),
  };
}

function buildStores(options: HelmScenarioOptions): Record<string, unknown> {
  const suppliedSettings = options.stores?.settings;
  const settings = {
    ...DEFAULT_SETTINGS,
    ...(suppliedSettings && typeof suppliedSettings === 'object' ? suppliedSettings : {}),
    ...(options.settings || {}),
  };

  return {
    integrations: [],
    tasks: [],
    ...options.stores,
    settings,
  };
}

interface DatabaseRouteOptions {
  analytics?: HelmScenarioOptions['analytics'];
  email: string;
  lifeHero?: HelmScenarioOptions['lifeHero'];
  snapshotStatus?: number;
  userId: string;
}

interface MockRow {
  userId: string;
  collection: string;
  recordId: string;
  payload: Record<string, unknown>;
  position: number | null;
  revision: number;
  accountVersion: number;
  createdAt: string;
  updatedAt: string;
  deletedAt: string | null;
}

interface MockDatabase {
  services?: FakeServices;
  rows: Map<string, MockRow>;
  accountVersion: number;
  listeners: Set<(event: HelmRealtimeEvent) => void>;
}

function createMockDatabase(stores: Record<string, unknown>, userId: string): MockDatabase {
  const database: MockDatabase = { rows: new Map(), accountVersion: 1, listeners: new Set() };
  for (const [collection, value] of Object.entries(stores)) {
    for (const record of encodeStoreValue(collection, value)) {
      database.rows.set(rowKey(collection, record.recordId), {
        userId, collection, recordId: record.recordId, payload: record.payload,
        position: record.position, revision: 1, accountVersion: 1,
        createdAt: SNAPSHOT_TIME, updatedAt: SNAPSHOT_TIME, deletedAt: null,
      });
    }
  }
  return database;
}

async function installDatabaseRoutes(
  page: Page,
  options: DatabaseRouteOptions,
  database: MockDatabase,
): Promise<Omit<HelmScenarioControl, 'addClient'>> {
  const { rows } = database;
  const realtime = await mockRealtime(page, database, options.userId);
  const publishChanges = (changes: MockRow[], requestId = 'e2e-request') => {
    const event: HelmRealtimeEvent = {
      requestId, accountVersion: database.accountVersion,
      changes: changes.map(({ collection, recordId, revision, deletedAt }) => ({ collection, recordId, revision, deletedAt })),
    };
    database.listeners.forEach(listener => listener(event));
  };

  await page.route('**/rest/v1/rpc/sync_life_hero_evidence*', async route => {
    if (options.lifeHero?.failureStatus) {
      await route.fulfill({
        status: options.lifeHero.failureStatus,
        contentType: 'application/json',
        body: JSON.stringify({ message: 'Life Hero evidence sync fixture unavailable.' }),
      });
      return;
    }
    await route.fulfill({
      status: 200,
      contentType: 'application/json',
      body: JSON.stringify({
        scanned: 0,
        accepted: 0,
        duplicates: 0,
        snapshot: options.lifeHero?.snapshot ?? defaultLifeHeroSnapshot(),
      }),
    });
  });

  await page.route('**/rest/v1/rpc/get_life_hero_snapshot*', async route => {
    if (options.lifeHero?.failureStatus) {
      await route.fulfill({
        status: options.lifeHero.failureStatus,
        contentType: 'application/json',
        body: JSON.stringify({ message: 'Life Hero snapshot fixture unavailable.' }),
      });
      return;
    }
    await route.fulfill({
      status: 200,
      contentType: 'application/json',
      body: JSON.stringify(options.lifeHero?.snapshot ?? defaultLifeHeroSnapshot()),
    });
  });

  await page.route('**/rest/v1/rpc/ingest_product_usage_events*', async route => {
    const events = (route.request().postDataJSON() as { p_events?: unknown[] }).p_events ?? [];
    await route.fulfill({
      status: 200,
      contentType: 'application/json',
      body: JSON.stringify({ accepted: events.length, duplicates: 0 }),
    });
  });

  await page.route('**/rest/v1/product_usage_events*', async route => {
    if (options.analytics?.failureStatus) {
      await route.fulfill({
        status: options.analytics.failureStatus,
        contentType: 'application/json',
        body: JSON.stringify({ message: 'Product usage fixture unavailable.' }),
      });
      return;
    }
    await route.fulfill({
      status: 200,
      contentType: 'application/json',
      body: JSON.stringify(options.analytics?.events || []),
    });
  });

  await page.route('**/rest/v1/rpc/get_helm_account_snapshot*', async route => {
    if (options.snapshotStatus) {
      await route.fulfill({
        status: options.snapshotStatus,
        contentType: 'application/json',
        body: JSON.stringify({ message: 'Snapshot fixture unavailable.' }),
      });
      return;
    }

    const scoped = new URL(route.request().url()).pathname.endsWith('/get_helm_account_snapshot_for_collections');
    const collections = scoped
      ? (route.request().postDataJSON() as { p_collections?: string[] }).p_collections ?? []
      : undefined;
    await route.fulfill({
      status: 200,
      contentType: 'application/json',
      body: JSON.stringify({
        state: {
          userId: options.userId,
          schemaVersion: 1,
          accountVersion: database.accountVersion,
          minimumClientVersion: '0.2.83',
          migratedAt: SNAPSHOT_TIME,
          updatedAt: SNAPSHOT_TIME,
        },
        records: [...rows.values()]
          .filter(row => collections === undefined || collections.includes(row.collection))
          .map(toSnapshotRow),
      }),
    });
  });

  await page.route('**/rest/v1/rpc/get_helm_changed_collections*', async route => {
    const { p_since_version: sinceVersion } = route.request().postDataJSON() as { p_since_version: number };
    await route.fulfill({ json: {
      accountVersion: database.accountVersion,
      collections: [...new Set([...rows.values()].filter(row => row.accountVersion > sinceVersion).map(row => row.collection))].sort(),
      secretsChanged: false,
    } });
  });

  await page.route('**/rest/v1/helm_account_state*', async route => {
    await route.fulfill({
      status: 200,
      contentType: 'application/json',
      body: JSON.stringify({
        user_id: options.userId,
        schema_version: 1,
        account_version: database.accountVersion,
        minimum_client_version: '0.2.83',
        migrated_at: SNAPSHOT_TIME,
        updated_at: SNAPSHOT_TIME,
      }),
    });
  });

  await page.route('**/rest/v1/helm_records*', async route => {
    const query = new URL(route.request().url()).searchParams;
    let selected = [...rows.values()].map(toDatabaseRow);
    for (const [field, filter] of query) {
      if (filter.startsWith('eq.')) {
        selected = selected.filter(row => String(row[field as keyof typeof row]) === filter.slice(3));
      } else if (filter === 'is.null') {
        selected = selected.filter(row => row[field as keyof typeof row] === null);
      }
    }
    const order = (query.get('order') ?? '').split(',').filter(Boolean);
    selected.sort((left, right) => {
      for (const term of order) {
        const [field, direction, nulls] = term.split('.');
        const a = left[field as keyof typeof left];
        const b = right[field as keyof typeof right];
        if (a === b) continue;
        if (a === null) return nulls === 'nullsfirst' ? -1 : 1;
        if (b === null) return nulls === 'nullsfirst' ? 1 : -1;
        const comparison = typeof a === 'number' && typeof b === 'number'
          ? a - b : String(a).localeCompare(String(b));
        if (comparison) return direction === 'desc' ? -comparison : comparison;
      }
      return 0;
    });
    const range = route.request().headers().range?.match(/^(\d+)-(\d+)$/u);
    const offset = Number(query.get('offset') ?? range?.[1] ?? 0);
    const limit = query.has('limit') ? Number(query.get('limit'))
      : range ? Number(range[2]) - offset + 1 : selected.length;
    await route.fulfill({
      status: 200,
      contentType: 'application/json',
      body: JSON.stringify(selected.slice(offset, offset + limit)),
    });
  });

  await page.route('**/rest/v1/rpc/apply_helm_mutations*', async route => {
    const request = route.request().postDataJSON() as {
      p_operations?: HelmMutation[];
      p_request_id?: string;
    };
    database.accountVersion += 1;
    const changes = applyMutations(rows, options.userId, database.accountVersion, request.p_operations || []);

    await route.fulfill({
      status: 200,
      contentType: 'application/json',
      body: JSON.stringify({
        requestId: request.p_request_id || 'e2e-request',
        accountVersion: database.accountVersion,
        changes: changes.map(toSnapshotRow),
      }),
    });
    publishChanges(changes, request.p_request_id);
  });

  await page.route(/\/rest\/v1\/rpc\/employment_(add_application|update_application|add_history|remove_application)(\?|$)/u, async route => {
    const name = new URL(route.request().url()).pathname.split('/').at(-1);
    const request = route.request().postDataJSON() as {
      p_application?: EmploymentApplication;
      p_application_id?: string;
      p_patch?: Partial<EmploymentApplication>;
      p_history?: EmploymentHistoryEntry;
      p_expected_updated_at?: string;
      p_confirm?: boolean;
    };
    const row = rows.get(rowKey('employment', 'singleton'));
    if (!row || row.deletedAt) {
      await route.fulfill({ status: 404, json: { message: 'Employment tracker not found.' } });
      return;
    }
    let applications = [...row.payload.applications as EmploymentApplication[]];
    let application = applications.find(item => item.id === request.p_application_id);
    const now = new Date().toISOString();
    if (name === 'employment_add_application' && request.p_application) {
      application = { ...request.p_application, createdAt: now, updatedAt: now };
      applications.push(application);
    } else if (!application) {
      await route.fulfill({ status: 404, json: { message: 'Employment application not found.' } });
      return;
    } else if (request.p_expected_updated_at && request.p_expected_updated_at !== application.updatedAt) {
      await route.fulfill({ status: 409, json: { message: 'Employment application changed; reload before saving.' } });
      return;
    } else if (name === 'employment_remove_application') {
      if (!request.p_confirm) {
        await route.fulfill({ status: 400, json: { message: 'Employment removal requires explicit confirmation.' } });
        return;
      }
      applications = applications.filter(item => item.id !== application.id);
    } else {
      const history = [...application.history];
      const newHistory = name === 'employment_add_history'
        ? (request.p_history ? [request.p_history] : [])
        : (request.p_patch?.history ?? []);
      for (const entry of newHistory) {
        if (!history.some(existing => existing.id === entry.id || (entry.evidenceUrl && existing.evidenceUrl === entry.evidenceUrl))) {
          history.push(entry);
        }
      }
      const updated = { ...application, ...request.p_patch, history, updatedAt: now };
      for (const key of Object.keys(updated) as Array<keyof EmploymentApplication>) {
        if (updated[key] === null) delete updated[key];
      }
      application = updated;
      applications = applications.map(item => item.id === application.id ? application : item);
    }
    database.accountVersion += 1;
    row.payload = { ...row.payload, applications };
    row.revision += 1;
    row.accountVersion = database.accountVersion;
    row.updatedAt = now;
    await route.fulfill({ json: { applicationId: application.id, accountVersion: database.accountVersion, duplicate: false } });
    publishChanges([row]);
  });

  await page.route(/\/rest\/v1\/rpc\/equity_(add_position|update_position|remove_position)(\?|$)/u, async route => {
    const name = new URL(route.request().url()).pathname.split('/').at(-1);
    const request = route.request().postDataJSON() as {
      p_position?: EquityPositionDraft & { id?: string };
      p_position_id?: string;
      p_expected_updated_at?: string;
      p_confirm?: boolean;
    };
    const positionId = request.p_position_id ?? request.p_position?.id;
    if (!positionId) {
      await route.fulfill({ status: 400, json: { message: 'Equity position ID is required.' } });
      return;
    }
    const key = rowKey('equityPositions', positionId);
    let row = rows.get(key);
    const now = new Date().toISOString();
    if (name === 'equity_add_position' && request.p_position) {
      if (row && !row.deletedAt) {
        await route.fulfill({ status: 409, json: { message: 'Equity position already exists.' } });
        return;
      }
      const position: EquityPosition = { ...request.p_position, id: positionId, createdAt: now, updatedAt: now };
      row = {
        userId: options.userId, collection: 'equityPositions', recordId: positionId,
        payload: { ...position }, position: null, revision: 1, accountVersion: database.accountVersion + 1,
        createdAt: now, updatedAt: now, deletedAt: null,
      };
      rows.set(key, row);
    } else if (!row || row.deletedAt) {
      await route.fulfill({ status: 404, json: { message: 'Equity position not found.' } });
      return;
    } else if (request.p_expected_updated_at !== row.payload.updatedAt) {
      await route.fulfill({ status: 409, json: { message: 'Equity position changed; reload before saving.' } });
      return;
    } else if (name === 'equity_remove_position') {
      if (!request.p_confirm) {
        await route.fulfill({ status: 400, json: { message: 'Equity removal requires explicit confirmation.' } });
        return;
      }
      row.deletedAt = now;
    } else if (request.p_position) {
      row.payload = { ...request.p_position, id: positionId, createdAt: row.payload.createdAt, updatedAt: now };
    }
    database.accountVersion += 1;
    row.revision += 1;
    row.accountVersion = database.accountVersion;
    row.updatedAt = now;
    await route.fulfill({ json: { positionId, position: row.deletedAt ? null : row.payload, accountVersion: database.accountVersion } });
    publishChanges([row]);
  });

  await page.route('**/rest/v1/rpc/list_equity_oauth_clients*', async route => {
    await route.fulfill({ json: [] });
  });

  await page.route('**/rest/v1/rpc/list_inventory_oauth_clients*', async route => {
    await route.fulfill({
      status: 200,
      contentType: 'application/json',
      body: '[]',
    });
  });

  await page.route('**/rest/v1/rpc/list_employment_oauth_clients*', async route => {
    await route.fulfill({ json: [] });
  });

  await page.route('**/rest/v1/rpc/list_helm_secrets*', route => route.fulfill({
    status: 200, contentType: 'application/json', body: JSON.stringify({ accountVersion: database.accountVersion, secrets: [] }),
  }));

  return {
    ...realtime,
    applyRemoteMutations(operations, confirmedAt) {
      // Simulate a separate client's confirmed write without delivering Broadcast.
      database.accountVersion += 1;
      applyMutations(rows, options.userId, database.accountVersion, operations, confirmedAt);
    },
  };
}

function defaultLifeHeroSnapshot(): Record<string, unknown> {
  const stat = (
    name: string,
    totalXp: number,
    level: number,
    condition: 'awaiting_first_step' | 'steady' | 'renewal_due',
    lastEvidenceLocalDate: string | null,
    attentionAfterDays: number,
  ) => ({ name, stat: name, totalXp, level, condition, lastEvidenceLocalDate, attentionAfterDays });

  return {
    rulesetVersion: 'life-hero-v1',
    totalXp: 210,
    overallLevel: 2,
    updatedAt: SNAPSHOT_TIME,
    recomputedAt: SNAPSHOT_TIME,
    stats: [
      stat('faith', 40, 1, 'steady', '2026-08-01', 1),
      stat('vitality', 40, 1, 'steady', '2026-08-01', 2),
      stat('knowledge', 40, 1, 'steady', '2026-08-01', 3),
      stat('discipline', 30, 1, 'renewal_due', '2026-07-26', 2),
      stat('finances', 25, 1, 'steady', '2026-08-01', 7),
      stat('craft', 20, 1, 'steady', '2026-08-01', 7),
      stat('community', 15, 1, 'awaiting_first_step', null, 7),
    ],
    recentActivity: [{
      evidence: {
        id: '22222222-2222-4222-8222-222222222222',
        rulesetVersion: 'life-hero-v1',
        stat: 'knowledge',
        evidenceType: 'knowledge_learning',
        sourceTier: 'verified',
        sourceReference: 'e2e-learning',
        idempotencyKey: 'e2e-learning-1',
        occurredAt: SNAPSHOT_TIME,
        localDate: '2026-08-01',
        metadata: {},
        createdAt: SNAPSHOT_TIME,
      },
      award: {
        id: '33333333-3333-4333-8333-333333333333',
        evidenceId: '22222222-2222-4222-8222-222222222222',
        rulesetVersion: 'life-hero-v1',
        stat: 'knowledge',
        baseXp: 20,
        sourceMultiplier: 1,
        momentumDays: 7,
        momentumMultiplier: 1.25,
        awardedXp: 25,
        awardedAt: SNAPSHOT_TIME,
      },
    }],
  };
}

async function installAssistantRoute(page: Page): Promise<void> {
  await page.route('**/functions/v1/assistant-openai*', async route => {
    await route.fulfill({
      status: 200,
      contentType: 'application/json',
      body: JSON.stringify({ ok: true, provider: 'openai', model: 'gpt-5.4' }),
    });
  });
}

/**
 * Prayer preferences and location are owned by the prayer and profile services, so a scenario's
 * prayer settings become those services' saved values.
 */
function servicesFromScenario(options: HelmScenarioOptions, settings: Record<string, unknown>): FakeServicesOptions {
  const explicit = { ...(options.stores?.settings as Record<string, unknown> | undefined), ...options.settings };
  const location = ['prayerCity', 'prayerCountry', 'appTimezone'].some(key => key in explicit)
    ? {
        city: String(settings.prayerCity ?? 'Bedford'),
        country: String(settings.prayerCountry ?? 'United Kingdom'),
        timeZone: typeof settings.appTimezone === 'string' ? settings.appTimezone : null,
      }
    : undefined;
  return {
    preferences: {
      enabled: settings.prayerEnabled !== false,
      reminderEnabled: settings.prayerReminderEnabled !== false,
      reminderMinutes: typeof settings.prayerReminderMinutes === 'number' ? settings.prayerReminderMinutes : 15,
    },
    ...(location ? { profile: location } : {}),
    calendar: {
      accounts: options.stores?.calendarAccounts as CalendarAccount[] | undefined,
      sources: options.stores?.calendarSources as CalendarSource[] | undefined,
      events: options.stores?.calendarEvents as CalendarEvent[] | undefined,
    },
    ...options.services,
  };
}

interface PrayerRouteOptions {
  failureStatus?: number;
  timezone?: string;
  timings?: Partial<Record<PrayerTimingName, string>>;
}

/** The prayer service's timetable endpoint, with the scenario's timings. */
async function installPrayerRoute(page: Page, options?: PrayerRouteOptions): Promise<void> {
  await page.route(`${SERVICES_BASE_URL}/api/prayer/v1/schedule*`, async route => {
    if (options?.failureStatus) {
      await route.fulfill({
        status: options.failureStatus,
        contentType: 'application/json',
        body: JSON.stringify({ code: 'schedule_unavailable', message: 'Prayer schedule fixture unavailable.' }),
      });
      return;
    }

    const url = new URL(route.request().url());
    const timezone = options?.timezone || 'Europe/London';
    const now = await page.evaluate(() => Date.now()).catch(() => Date.now());
    const date = url.searchParams.get('date')
      ?? new Intl.DateTimeFormat('en-CA', { timeZone: timezone }).format(new Date(now));
    const timings = { ...DEFAULT_TIMINGS, ...(options?.timings || {}) };
    await route.fulfill({
      status: 200,
      contentType: 'application/json',
      body: JSON.stringify({
        date,
        hijriDate: '7 Safar 1448',
        city: url.searchParams.get('city') ?? 'Bedford',
        country: url.searchParams.get('country') ?? 'United Kingdom',
        timezone,
        method: 'Shia Ithna-Ashari, Leva Institute, Qum',
        times: Object.entries(timings).map(([name, time]) => ({
          name,
          nameArabic: name,
          time,
          type: ['Sunrise', 'Sunset', 'Midnight'].includes(name) ? 'event' : 'prayer',
        })),
        windows: [],
      }),
    });
  });
}

async function mockRealtime(
  page: Page,
  database: MockDatabase,
  userId: string,
): Promise<Pick<HelmScenarioControl, 'setRealtimeAvailable' | 'setBroadcastDelivery' | 'getDeliveredBroadcastCount'>> {
  let available = true;
  let deliverBroadcast = true;
  let deliveredBroadcasts = 0;
  const interruptChannels = new Set<() => void>();
  await page.routeWebSocket('wss://helm.test.supabase.co/realtime/v1/websocket**', socket => {
    let joined = false;
    let interrupt = () => {};
    let sendBroadcast: (event: HelmRealtimeEvent) => void = () => {};
    const deliver = (event: HelmRealtimeEvent) => {
      if (available && deliverBroadcast && joined) {
        sendBroadcast(event);
        deliveredBroadcasts += 1;
      }
    };
    database.listeners.add(deliver);
    const cleanup = () => {
      joined = false;
      interruptChannels.delete(interrupt);
      database.listeners.delete(deliver);
    };
    socket.onClose(async (code, reason) => {
      cleanup();
      // onClose disables Playwright's default closure forwarding. Complete
      // the handshake so the SDK can leave its disconnecting state.
      await socket.close({ code, reason });
    });
    page.once('close', cleanup);
    socket.onMessage(message => {
      let frame: unknown;
      try {
        frame = JSON.parse(message);
      } catch {
        return;
      }
      if (!frame || typeof frame !== 'object') return;
      const envelope = Array.isArray(frame)
        ? { join_ref: frame[0], ref: frame[1], topic: frame[2], event: frame[3], payload: frame[4] }
        : frame as Record<string, unknown>;
      const send = (event: string, payload: unknown, ref: unknown = null) => socket.send(JSON.stringify(
        Array.isArray(frame)
          ? [envelope.join_ref, ref, envelope.topic, event, payload]
          : { topic: envelope.topic, event, payload, ref, join_ref: envelope.join_ref },
      ));
      if (envelope.event === 'phx_join') {
        const payload = envelope.payload as { config?: { private?: boolean } };
        joined = available && envelope.topic === `realtime:helm:account:${userId}` && payload.config?.private === true;
        interruptChannels.delete(interrupt);
        interrupt = () => {
          joined = false;
          send('phx_error', {});
        };
        interruptChannels.add(interrupt);
        sendBroadcast = event => send('broadcast', { type: 'broadcast', event: 'helm_records_changed', payload: event });
      } else if (envelope.event === 'phx_leave') {
        joined = false;
        interruptChannels.delete(interrupt);
      }
      if (['phx_join', 'phx_leave', 'heartbeat', 'access_token'].includes(String(envelope.event))) {
        send('phx_reply', {
          status: envelope.event === 'phx_join' && !available ? 'error' : 'ok', response: {},
        }, envelope.ref);
      }
    });
  });
  return {
    setRealtimeAvailable(nextAvailable) {
      available = nextAvailable;
      if (!available) interruptChannels.forEach(interrupt => interrupt());
    },
    setBroadcastDelivery(enabled) { deliverBroadcast = enabled; },
    getDeliveredBroadcastCount: () => deliveredBroadcasts,
  };
}

function applyMutations(
  rows: Map<string, MockRow>,
  userId: string,
  accountVersion: number,
  operations: HelmMutation[],
  confirmedAt?: string,
): MockRow[] {
  const changed = new Map<string, MockRow>();
  const now = confirmedAt ?? new Date().toISOString();
  const mark = (row: MockRow) => {
    row.revision += 1;
    row.accountVersion = accountVersion;
    row.updatedAt = now;
    changed.set(rowKey(row.collection, row.recordId), row);
  };

  for (const operation of operations) {
    if (operation.op === 'reorder') {
      operation.orderedRecordIds.forEach((recordId, position) => {
        const row = rows.get(rowKey(operation.collection, recordId));
        if (row && row.deletedAt === null && row.position !== position) {
          row.position = position;
          mark(row);
        }
      });
      continue;
    }

    const key = rowKey(operation.collection, operation.recordId);
    const existing = rows.get(key);
    if (operation.op === 'create') {
      const row: MockRow = {
        userId,
        collection: operation.collection,
        recordId: operation.recordId,
        payload: operation.payload,
        position: operation.position ?? null,
        revision: 1,
        accountVersion,
        createdAt: now,
        updatedAt: now,
        deletedAt: null,
      };
      rows.set(key, row);
      changed.set(key, row);
    } else if (existing && operation.op === 'patch' && existing.deletedAt === null) {
      existing.payload = { ...existing.payload, ...operation.set };
      for (const field of operation.unset || []) delete existing.payload[field];
      mark(existing);
    } else if (existing && operation.op === 'increment' && existing.deletedAt === null) {
      existing.payload[operation.field] = Number(existing.payload[operation.field] || 0) + operation.amount;
      mark(existing);
    } else if (existing && operation.op === 'delete' && existing.deletedAt === null) {
      existing.deletedAt = now;
      mark(existing);
    } else if (existing && operation.op === 'restore' && existing.deletedAt !== null) {
      existing.deletedAt = null;
      mark(existing);
    }
  }

  return [...changed.values()];
}

function rowKey(collection: string, recordId: string): string {
  return `${collection}\0${recordId}`;
}

function toSnapshotRow(row: MockRow) {
  return {
    userId: row.userId,
    collection: row.collection,
    recordId: row.recordId,
    payload: row.payload,
    position: row.position,
    revision: row.revision,
    accountVersion: row.accountVersion,
    createdAt: row.createdAt,
    updatedAt: row.updatedAt,
    deletedAt: row.deletedAt,
  };
}

function toDatabaseRow(row: MockRow) {
  return {
    user_id: row.userId,
    collection: row.collection,
    record_id: row.recordId,
    payload: row.payload,
    position: row.position,
    revision: row.revision,
    account_version: row.accountVersion,
    created_at: row.createdAt,
    updated_at: row.updatedAt,
    deleted_at: row.deletedAt,
  };
}
