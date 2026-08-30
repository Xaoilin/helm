import { expect, test as base, type Page, type Response } from '@playwright/test';
import { encodeStoreValue } from '../../src/store/recordCodec';
import type { HelmMutation } from '../../src/store/databaseTypes';

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
  email?: string;
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
  settings?: Record<string, unknown>;
  stores?: Record<string, unknown>;
  snapshotStatus?: number;
  userId?: string;
}

export type ScenarioLoader = (options?: HelmScenarioOptions) => Promise<void>;

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
    if (
      response.request().method() !== 'POST'
      || !response.url().includes('/rest/v1/rpc/apply_helm_mutations')
    ) return false;

    try {
      const body = response.request().postDataJSON() as { p_operations?: HelmMutation[] };
      return body.p_operations?.some(operation => operation.collection === collection) ?? false;
    } catch {
      return false;
    }
  });
}

async function installScenario(page: Page, options: HelmScenarioOptions = {}): Promise<void> {
  if (options.now) {
    await page.clock.install({ time: new Date(options.now) });
  }

  const userId = options.userId || TEST_USER_ID;
  const stores = buildStores(options);
  const authenticated = options.authenticated !== false;

  await page.addInitScript(({ authenticated: shouldAuthenticate, email, marker, user }) => {
    if (sessionStorage.getItem(marker) === 'ready') return;

    localStorage.clear();
    sessionStorage.clear();
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
  });

  await installPrayerRoute(page, options.prayer);
  await installDatabaseRoutes(page, {
    email: options.email || TEST_EMAIL,
    lifeHero: options.lifeHero,
    snapshotStatus: options.snapshotStatus,
    stores,
    userId,
  });
  await installAssistantRoute(page);
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
  email: string;
  lifeHero?: HelmScenarioOptions['lifeHero'];
  snapshotStatus?: number;
  stores: Record<string, unknown>;
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

async function installDatabaseRoutes(page: Page, options: DatabaseRouteOptions): Promise<void> {
  const rows = new Map<string, MockRow>();
  let accountVersion = 1;

  for (const [collection, value] of Object.entries(options.stores)) {
    for (const record of encodeStoreValue(collection, value)) {
      const row: MockRow = {
        userId: options.userId,
        collection,
        recordId: record.recordId,
        payload: record.payload,
        position: record.position,
        revision: 1,
        accountVersion,
        createdAt: SNAPSHOT_TIME,
        updatedAt: SNAPSHOT_TIME,
        deletedAt: null,
      };
      rows.set(rowKey(row.collection, row.recordId), row);
    }
  }

  await mockRealtime(page);

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

  await page.route('**/rest/v1/rpc/get_helm_account_snapshot*', async route => {
    if (options.snapshotStatus) {
      await route.fulfill({
        status: options.snapshotStatus,
        contentType: 'application/json',
        body: JSON.stringify({ message: 'Snapshot fixture unavailable.' }),
      });
      return;
    }

    await route.fulfill({
      status: 200,
      contentType: 'application/json',
      body: JSON.stringify({
        state: {
          userId: options.userId,
          schemaVersion: 1,
          accountVersion,
          minimumClientVersion: '0.2.83',
          migratedAt: SNAPSHOT_TIME,
          updatedAt: SNAPSHOT_TIME,
        },
        records: [...rows.values()].map(toSnapshotRow),
      }),
    });
  });

  await page.route('**/rest/v1/helm_account_state*', async route => {
    await route.fulfill({
      status: 200,
      contentType: 'application/json',
      body: JSON.stringify({
        user_id: options.userId,
        schema_version: 1,
        account_version: accountVersion,
        minimum_client_version: '0.2.83',
        migrated_at: SNAPSHOT_TIME,
        updated_at: SNAPSHOT_TIME,
      }),
    });
  });

  await page.route('**/rest/v1/helm_records*', async route => {
    await route.fulfill({
      status: 200,
      contentType: 'application/json',
      body: JSON.stringify([...rows.values()].map(toDatabaseRow)),
    });
  });

  await page.route('**/rest/v1/rpc/apply_helm_mutations*', async route => {
    const request = route.request().postDataJSON() as {
      p_operations?: HelmMutation[];
      p_request_id?: string;
    };
    accountVersion += 1;
    const changes = applyMutations(rows, options.userId, accountVersion, request.p_operations || []);

    await route.fulfill({
      status: 200,
      contentType: 'application/json',
      body: JSON.stringify({
        requestId: request.p_request_id || 'e2e-request',
        accountVersion,
        changes: changes.map(toSnapshotRow),
      }),
    });
  });

  await page.route('**/rest/v1/rpc/list_inventory_oauth_clients*', async route => {
    await route.fulfill({
      status: 200,
      contentType: 'application/json',
      body: '[]',
    });
  });
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

interface PrayerRouteOptions {
  failureStatus?: number;
  timezone?: string;
  timings?: Partial<Record<PrayerTimingName, string>>;
}

async function installPrayerRoute(page: Page, options?: PrayerRouteOptions): Promise<void> {
  await page.route('**/api.aladhan.com/v1/timingsByCity*', async route => {
    if (options?.failureStatus) {
      await route.fulfill({
        status: options.failureStatus,
        contentType: 'application/json',
        body: JSON.stringify({ message: 'Prayer schedule fixture unavailable.' }),
      });
      return;
    }

    const timings = { ...DEFAULT_TIMINGS, ...(options?.timings || {}) };
    await route.fulfill({
      status: 200,
      contentType: 'application/json',
      body: JSON.stringify({
        data: {
          timings,
          date: { hijri: { day: '7', month: { en: 'Safar' }, year: '1448' } },
          meta: { timezone: options?.timezone || 'Europe/London' },
        },
      }),
    });
  });
}

async function mockRealtime(page: Page): Promise<void> {
  await page.routeWebSocket('wss://helm.test.supabase.co/realtime/v1/websocket**', socket => {
    socket.onMessage(message => {
      let frame: unknown;
      try {
        frame = JSON.parse(message);
      } catch {
        return;
      }

      if (Array.isArray(frame)) {
        const [joinRef, ref, topic, event] = frame;
        if (event === 'phx_join' || event === 'heartbeat' || event === 'access_token') {
          socket.send(JSON.stringify([joinRef, ref, topic, 'phx_reply', { status: 'ok', response: {} }]));
        }
        return;
      }

      if (frame && typeof frame === 'object') {
        const envelope = frame as Record<string, unknown>;
        if (envelope.event === 'phx_join' || envelope.event === 'heartbeat' || envelope.event === 'access_token') {
          socket.send(JSON.stringify({
            topic: envelope.topic,
            event: 'phx_reply',
            payload: { status: 'ok', response: {} },
            ref: envelope.ref,
            join_ref: envelope.join_ref,
          }));
        }
      }
    });
  });
}

function applyMutations(
  rows: Map<string, MockRow>,
  userId: string,
  accountVersion: number,
  operations: HelmMutation[],
): MockRow[] {
  const changed = new Map<string, MockRow>();
  const now = new Date().toISOString();
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
