import {
  expect,
  test as base,
  type Page,
} from '@playwright/test';
import { encodeStoreValue } from '../../src/store/recordCodec';
import type { HelmMutation } from '../../src/store/databaseTypes';
import type { SecretKind } from '../../src/types/domain';

export type HelmScenarioName =
  | 'empty'
  | 'projects'
  | 'hosted-assistant'
  | 'signed-in-sync'
  | 'prayer';

export interface AssistantMockRequest {
  action?: string;
  messages?: Array<{ role: string; content: string }>;
  [key: string]: unknown;
}

export type AssistantMockHandler = (
  request: AssistantMockRequest,
) => Promise<Record<string, unknown>> | Record<string, unknown>;

interface EmptyScenarioOptions {
  storage?: Record<string, unknown>;
  surface?: string;
  secrets?: SecretFixture[];
}

interface ProjectsScenarioOptions extends EmptyScenarioOptions {
  projects?: unknown[];
}

interface HostedAssistantScenarioOptions extends EmptyScenarioOptions {
  assistant?: AssistantMockHandler;
  settings?: Record<string, unknown>;
}

export interface RemoteStoreFixture {
  value: unknown;
  updatedAt?: string;
}

interface DatabaseScenarioOptions {
  email?: string;
  localStorage?: Record<string, unknown>;
  stores?: Record<string, unknown>;
  secrets?: SecretFixture[];
  surface?: string;
  userId?: string;
}

export interface SecretFixture {
  secretId?: string;
  label: string;
  kind: SecretKind;
  environment?: string | null;
  projectCatalogKeys?: string[];
  value: string;
  username?: string | null;
  url?: string | null;
  notes?: string | null;
  sourceRef?: string | null;
  archivedAt?: string | null;
}

interface SignedInSyncScenarioOptions extends EmptyScenarioOptions {
  email?: string;
  localStores?: Record<string, unknown>;
  remoteStores?: Record<string, RemoteStoreFixture>;
  settings?: Record<string, unknown>;
  userId?: string;
}

interface PrayerScenarioOptions extends EmptyScenarioOptions {
  assistant?: AssistantMockHandler;
  now?: string;
  settings?: Record<string, unknown>;
  tasks?: unknown[];
}

interface ScenarioOptions {
  empty: EmptyScenarioOptions;
  projects: ProjectsScenarioOptions;
  'hosted-assistant': HostedAssistantScenarioOptions;
  'signed-in-sync': SignedInSyncScenarioOptions;
  prayer: PrayerScenarioOptions;
}

export type ScenarioLoader = <Name extends HelmScenarioName>(
  name: Name,
  options?: ScenarioOptions[Name],
) => Promise<void>;

export const test = base.extend<{ scenario: ScenarioLoader }>({
  scenario: async ({ page }, provide) => {
    await provide(async (name, options = {}) => {
      await installScenario(page, name, options);
    });
  },
});

export { expect };

const DEFAULT_HOSTED_SETTINGS = {
  assistantLanguage: 'en',
  assistantProvider: 'hosted',
  credentialSource: 'onepassword-first',
  dataRetentionDays: 90,
  prayerEnabled: false,
  supabaseAnonKey: 'helm-test-anon-key',
  supabaseUrl: 'https://helm.test.supabase.co',
  telemetry: false,
  theme: 'dark',
};

const DEFAULT_PROJECTS = [
  {
    id: 'project-orbit-console',
    catalogKey: 'fixture:orbit-console',
    name: 'Orbit Console',
    kind: 'desktop_app',
    summary: 'A desktop command centre and project reference example.',
    status: 'active',
    tags: ['app', 'productivity', 'tauri'],
    isPinned: true,
    links: [
      {
        id: 'orbit-live',
        kind: 'deployment',
        label: 'Live Orbit Console',
        url: 'https://example.com/orbit/',
      },
      {
        id: 'orbit-repo',
        kind: 'repository',
        label: 'GitHub repository',
        url: 'https://github.com/example/orbit-console',
      },
    ],
    setupSteps: [
      {
        id: 'orbit-install',
        title: 'Install dependencies',
        description: 'Requires Node.js and npm.',
        displayCode: 'npm install',
      },
    ],
    runRecipes: [
      {
        id: 'orbit-dev',
        label: 'Development server',
        displayCommand: 'npm run dev',
        executable: 'npm',
        args: ['run', 'dev'],
        prerequisites: ['Node.js', 'npm'],
        mode: 'service',
      },
    ],
    preview: { icon: 'OC', accentColor: '#8b7cff', backgroundColor: '#17172a' },
    verifiedAt: '2026-07-29T12:00:00.000Z',
    createdAt: '2026-07-29T12:00:00.000Z',
    updatedAt: '2026-07-29T12:00:00.000Z',
  },
  {
    id: 'project-canvas-studio',
    catalogKey: 'fixture:canvas-studio',
    name: 'Canvas Studio',
    kind: 'web_app',
    summary: 'A collaborative visual whiteboard with a WebGL canvas.',
    status: 'active',
    tags: ['app', 'whiteboard'],
    isPinned: true,
    links: [
      {
        id: 'canvas-live',
        kind: 'deployment',
        label: 'Live Canvas Studio',
        url: 'https://example.com/canvas/',
      },
    ],
    setupSteps: [],
    runRecipes: [],
    preview: { icon: 'CS', accentColor: '#4f9cff', backgroundColor: '#112033' },
    verifiedAt: '2026-07-29T12:00:00.000Z',
    createdAt: '2026-07-29T12:00:00.000Z',
    updatedAt: '2026-07-29T12:00:00.000Z',
  },
  {
    id: 'project-caption-local',
    catalogKey: 'fixture:caption-local',
    name: 'Caption Local',
    kind: 'web_app',
    summary: 'A private local media transcription utility.',
    status: 'active',
    tags: ['app', 'local-first'],
    isPinned: false,
    links: [],
    setupSteps: [],
    runRecipes: [
      {
        id: 'caption-ui',
        label: 'Local transcription UI',
        displayCommand: 'caption-local --host 127.0.0.1 --port 7860',
        executable: 'caption-local',
        args: ['--host', '127.0.0.1', '--port', '7860'],
        prerequisites: ['Python 3.10+', 'ffmpeg'],
        localUrl: 'http://127.0.0.1:7860/',
        mode: 'service',
      },
    ],
    preview: { icon: 'CL', accentColor: '#ef4444', backgroundColor: '#2a1218' },
    verifiedAt: '2026-07-29T12:00:00.000Z',
    createdAt: '2026-07-29T12:00:00.000Z',
    updatedAt: '2026-07-29T12:00:00.000Z',
  },
  {
    id: 'project-sensor-bench',
    catalogKey: 'fixture:sensor-bench',
    name: 'Sensor Bench',
    kind: 'hardware',
    summary: 'An electronics, firmware, and enclosure reference workspace.',
    status: 'active',
    tags: ['hardware', 'electronics'],
    isPinned: false,
    links: [],
    setupSteps: [],
    runRecipes: [],
    preview: { icon: 'SB', accentColor: '#f472b6', backgroundColor: '#2b1624' },
    verifiedAt: '2026-07-29T12:00:00.000Z',
    createdAt: '2026-07-29T12:00:00.000Z',
    updatedAt: '2026-07-29T12:00:00.000Z',
  },
  {
    id: 'project-release-vault',
    catalogKey: 'fixture:release-vault',
    name: 'Release Vault',
    kind: 'research',
    summary: 'A completed reference retained for future decisions.',
    status: 'archived',
    statusBeforeArchive: 'completed',
    tags: ['reference'],
    isPinned: false,
    links: [],
    setupSteps: [],
    runRecipes: [],
    preview: { icon: 'RV', accentColor: '#94a3b8', backgroundColor: '#171b24' },
    verifiedAt: '2026-07-29T12:00:00.000Z',
    createdAt: '2026-07-29T12:00:00.000Z',
    updatedAt: '2026-07-29T12:00:00.000Z',
  },
] as const;

const DEFAULT_PRAYER_TASKS = ['Fajr', 'Dhuhr', 'Asr'].map((prayerName, index) => ({
  id: `prayer-${prayerName.toLowerCase()}`,
  title: `${prayerName} Prayer`,
  description: '',
  completed: false,
  priority: 'medium',
  category: 'prayer',
  prayerName,
  recurring: { frequency: 'daily' },
  createdAt: `2026-07-28T04:0${index}:00.000Z`,
  updatedAt: `2026-07-28T04:0${index}:00.000Z`,
}));

async function installScenario<Name extends HelmScenarioName>(
  page: Page,
  name: Name,
  options: ScenarioOptions[Name],
): Promise<void> {
  await mockPrayerTimes(page);

  if (name === 'empty') {
    const normalized = normalizeScenarioStorage(options.storage);
    await installDatabaseScenario(page, name, {
      localStorage: normalized.local,
      stores: normalized.stores,
      secrets: options.secrets,
      surface: options.surface,
    });
    return;
  }

  if (name === 'projects') {
    const projectOptions = options as ProjectsScenarioOptions;
    const normalized = normalizeScenarioStorage(projectOptions.storage);
    await installDatabaseScenario(page, name, {
      localStorage: normalized.local,
      stores: {
        ...normalized.stores,
        projects: projectOptions.projects || DEFAULT_PROJECTS,
      },
      surface: projectOptions.surface,
    });
    return;
  }

  if (name === 'hosted-assistant') {
    const hostedOptions = options as HostedAssistantScenarioOptions;
    const normalized = normalizeScenarioStorage(hostedOptions.storage);
    await installDatabaseScenario(page, name, {
      localStorage: normalized.local,
      stores: {
        ...normalized.stores,
        settings: {
        ...DEFAULT_HOSTED_SETTINGS,
        ...hostedOptions.settings,
        },
      },
      surface: hostedOptions.surface,
    });
    await mockHostedAssistant(page, hostedOptions.assistant);
    return;
  }

  if (name === 'signed-in-sync') {
    const syncOptions = options as SignedInSyncScenarioOptions;
    const normalized = normalizeScenarioStorage(syncOptions.storage);
    await installDatabaseScenario(page, name, {
      email: syncOptions.email,
      userId: syncOptions.userId,
      localStorage: {
        ...normalized.local,
      ...Object.fromEntries(
        Object.entries(syncOptions.localStores || {}).map(([key, value]) => [`helm:${key}`, value]),
      ),
      },
      stores: {
        ...normalized.stores,
        ...Object.fromEntries(
          Object.entries(syncOptions.remoteStores || {}).map(([key, fixture]) => [key, fixture.value]),
        ),
        settings: {
        telemetry: false,
        theme: 'dark',
        ...syncOptions.settings,
      },
      },
      surface: syncOptions.surface,
    });
    return;
  }

  const prayerOptions = options as PrayerScenarioOptions;
  await page.clock.install({
    time: new Date(prayerOptions.now || '2026-07-28T05:36:00.000Z'),
  });
  const normalized = normalizeScenarioStorage(prayerOptions.storage);
  await installDatabaseScenario(page, name, {
    localStorage: normalized.local,
    stores: {
      ...normalized.stores,
      settings: {
      ...DEFAULT_HOSTED_SETTINGS,
      assistantEnabled: true,
      prayerCity: 'Bedford',
      prayerCountry: 'United Kingdom',
      prayerEnabled: true,
      prayerReminderEnabled: true,
      prayerReminderMinutes: 15,
      ...prayerOptions.settings,
      },
      tasks: prayerOptions.tasks || DEFAULT_PRAYER_TASKS,
    },
    surface: prayerOptions.surface || 'settings',
  });
  await mockHostedAssistant(page, prayerOptions.assistant);
}

function normalizeScenarioStorage(storage: Record<string, unknown> = {}): {
  local: Record<string, unknown>;
  stores: Record<string, unknown>;
} {
  const local: Record<string, unknown> = {};
  const stores: Record<string, unknown> = {};
  for (const [key, value] of Object.entries(storage)) {
    if (key.startsWith('helm:device:')) {
      local[key] = value;
    } else if (key.startsWith('helm:')) {
      stores[key.slice('helm:'.length)] = value;
    } else {
      local[key] = value;
    }
  }
  return { local, stores };
}

async function installDatabaseScenario(
  page: Page,
  scenario: HelmScenarioName,
  options: DatabaseScenarioOptions,
): Promise<void> {
  const userId = options.userId || '11111111-1111-4111-8111-111111111111';
  await seedStorage(page, scenario, {
    ...options.localStorage,
    'sb-helm-auth-token': {
      access_token: 'test-access-token',
      expires_at: 4_102_444_800,
      expires_in: 3600,
      refresh_token: 'test-refresh-token',
      token_type: 'bearer',
      user: {
        app_metadata: { provider: 'google' },
        aud: 'authenticated',
        email: options.email || 'sync@example.com',
        id: userId,
        role: 'authenticated',
        user_metadata: {},
      },
    },
  }, options.surface);
  await mockHelmDatabase(page, userId, options.stores || {}, options.secrets || []);
}

async function seedStorage(
  page: Page,
  scenario: HelmScenarioName,
  storage: Record<string, unknown> = {},
  surface?: string,
): Promise<void> {
  await page.addInitScript(({ entries, marker, surfaceName }) => {
    if (sessionStorage.getItem(marker) === 'ready') return;
    localStorage.clear();
    sessionStorage.clear();
    for (const [key, value] of entries) {
      localStorage.setItem(key, JSON.stringify(value));
    }
    if (surfaceName) {
      sessionStorage.setItem('helm:shell-surface', surfaceName);
    }
    sessionStorage.setItem(marker, 'ready');
  }, {
    entries: Object.entries(storage),
    marker: `helm:e2e-scenario:${scenario}`,
    surfaceName: surface,
  });
}

async function mockHostedAssistant(
  page: Page,
  handler: AssistantMockHandler = defaultAssistantHandler,
): Promise<void> {
  await page.route('**/functions/v1/assistant-openai', async route => {
    const request = (route.request().postDataJSON() || {}) as AssistantMockRequest;
    const body = await handler(request);
    await route.fulfill({
      status: 200,
      contentType: 'application/json',
      body: JSON.stringify(body),
    });
  });
}

interface MockDatabaseRow {
  user_id: string;
  collection: string;
  record_id: string;
  payload: Record<string, unknown>;
  position: number | null;
  revision: number;
  account_version: number;
  created_at: string;
  updated_at: string;
  deleted_at: string | null;
}

interface MockSecretRecord extends SecretFixture {
  secretId: string;
  environment: string | null;
  projectCatalogKeys: string[];
  sourceRef: string | null;
  revision: number;
  accountVersion: number;
  createdAt: string;
  updatedAt: string;
  archivedAt: string | null;
}

async function mockHelmDatabase(
  page: Page,
  userId: string,
  stores: Record<string, unknown>,
  secretFixtures: SecretFixture[],
): Promise<void> {
  await mockHelmRealtime(page);
  const timestamp = '2026-07-31T12:00:00.000Z';
  let accountVersion = 1;
  const rows = new Map<string, MockDatabaseRow>();
  const secrets = new Map<string, MockSecretRecord>();
  secretFixtures.forEach((fixture, index) => {
    const secretId = fixture.secretId || `88888888-8888-4888-8888-${String(index + 1).padStart(12, '0')}`;
    secrets.set(secretId, {
      ...fixture,
      secretId,
      environment: fixture.environment || null,
      projectCatalogKeys: fixture.projectCatalogKeys || [],
      sourceRef: fixture.sourceRef || null,
      revision: 1,
      accountVersion,
      createdAt: timestamp,
      updatedAt: timestamp,
      archivedAt: fixture.archivedAt || null,
    });
  });
  for (const [collection, value] of Object.entries(stores)) {
    for (const record of encodeStoreValue(collection, value)) {
      const row: MockDatabaseRow = {
        user_id: userId,
        collection,
        record_id: record.recordId,
        payload: record.payload,
        position: record.position,
        revision: 1,
        account_version: accountVersion,
        created_at: timestamp,
        updated_at: timestamp,
        deleted_at: null,
      };
      rows.set(`${collection}\0${record.recordId}`, row);
    }
  }

  await page.route('**/__helm_e2e_db', async route => {
    await route.fulfill({
      status: 200,
      contentType: 'application/json',
      body: JSON.stringify([...rows.values()]),
    });
  });

  await page.route('https://helm.test.supabase.co/rest/v1/helm_records**', async route => {
    await route.fulfill({
      status: 200,
      contentType: 'application/json',
      body: JSON.stringify([...rows.values()]),
    });
  });

  await page.route('https://helm.test.supabase.co/rest/v1/helm_account_state**', async route => {
    await route.fulfill({
      status: 200,
      contentType: 'application/json',
      body: JSON.stringify({
        user_id: userId,
        schema_version: 1,
        account_version: accountVersion,
        minimum_client_version: '0.2.82',
        migrated_at: timestamp,
        updated_at: timestamp,
      }),
    });
  });

  await page.route('https://helm.test.supabase.co/rest/v1/rpc/apply_helm_mutations', async route => {
    const request = route.request().postDataJSON() as {
      p_operations?: HelmMutation[];
      p_request_id?: string;
    };
    accountVersion += 1;
    const changed = applyMockMutations(
      rows,
      userId,
      accountVersion,
      request.p_operations || [],
      new Date().toISOString(),
    );
    await route.fulfill({
      status: 200,
      contentType: 'application/json',
      body: JSON.stringify({
        requestId: request.p_request_id,
        accountVersion,
        changes: changed.map(toMutationResponseRow),
      }),
    });
  });

  const secretSummary = (secret: MockSecretRecord) => ({
    secretId: secret.secretId,
    label: secret.label,
    kind: secret.kind,
    environment: secret.environment,
    projectCatalogKeys: secret.projectCatalogKeys,
    sourceRef: secret.sourceRef,
    revision: secret.revision,
    accountVersion: secret.accountVersion,
    createdAt: secret.createdAt,
    updatedAt: secret.updatedAt,
    archivedAt: secret.archivedAt,
  });

  await page.route('https://helm.test.supabase.co/rest/v1/rpc/list_helm_secrets', async route => {
    await route.fulfill({
      status: 200,
      contentType: 'application/json',
      body: JSON.stringify({
        accountVersion,
        secrets: [...secrets.values()]
          .sort((left, right) => left.label.localeCompare(right.label))
          .map(secretSummary),
      }),
    });
  });

  await page.route('https://helm.test.supabase.co/rest/v1/rpc/reveal_helm_secret', async route => {
    const request = route.request().postDataJSON() as { p_secret_id?: string };
    const secret = request.p_secret_id ? secrets.get(request.p_secret_id) : undefined;
    if (!secret) {
      await route.fulfill({ status: 404, contentType: 'application/json', body: JSON.stringify({ message: 'Secret unavailable.' }) });
      return;
    }
    await route.fulfill({
      status: 200,
      contentType: 'application/json',
      body: JSON.stringify({
        secretId: secret.secretId,
        value: secret.value,
        username: secret.username || null,
        url: secret.url || null,
        notes: secret.notes || null,
      }),
    });
  });

  await page.route('https://helm.test.supabase.co/rest/v1/rpc/save_helm_secret', async route => {
    const request = route.request().postDataJSON() as {
      p_secret_id?: string | null;
      p_label?: string;
      p_kind?: SecretKind;
      p_environment?: string | null;
      p_project_catalog_keys?: string[];
      p_value?: string | null;
      p_username?: string | null;
      p_url?: string | null;
      p_notes?: string | null;
      p_source_ref?: string | null;
    };
    const existing = request.p_secret_id ? secrets.get(request.p_secret_id) : undefined;
    accountVersion += 1;
    const secretId = existing?.secretId
      || `88888888-8888-4888-8888-${String(secrets.size + 1).padStart(12, '0')}`;
    const now = new Date().toISOString();
    const secret: MockSecretRecord = {
      secretId,
      label: request.p_label || existing?.label || 'Secret',
      kind: request.p_kind || existing?.kind || 'other',
      environment: request.p_environment || null,
      projectCatalogKeys: request.p_project_catalog_keys || [],
      value: request.p_value || existing?.value || '',
      username: request.p_username || null,
      url: request.p_url || null,
      notes: request.p_notes || null,
      sourceRef: request.p_source_ref || null,
      revision: existing ? existing.revision + 1 : 1,
      accountVersion,
      createdAt: existing?.createdAt || now,
      updatedAt: now,
      archivedAt: existing?.archivedAt || null,
    };
    secrets.set(secretId, secret);
    await route.fulfill({ status: 200, contentType: 'application/json', body: JSON.stringify(secretSummary(secret)) });
  });

  await page.route('https://helm.test.supabase.co/rest/v1/rpc/set_helm_secret_archived', async route => {
    const request = route.request().postDataJSON() as { p_secret_id?: string; p_archived?: boolean };
    const secret = request.p_secret_id ? secrets.get(request.p_secret_id) : undefined;
    if (!secret) {
      await route.fulfill({ status: 404, contentType: 'application/json', body: JSON.stringify({ message: 'Secret unavailable.' }) });
      return;
    }
    accountVersion += 1;
    secret.revision += 1;
    secret.accountVersion = accountVersion;
    secret.updatedAt = new Date().toISOString();
    secret.archivedAt = request.p_archived ? secret.updatedAt : null;
    await route.fulfill({ status: 200, contentType: 'application/json', body: JSON.stringify(secretSummary(secret)) });
  });
}

async function mockHelmRealtime(page: Page): Promise<void> {
  await page.routeWebSocket('wss://helm.test.supabase.co/realtime/v1/websocket**', socket => {
    socket.onMessage(message => {
      if (typeof message !== 'string') return;
      let frame: unknown;
      try {
        frame = JSON.parse(message);
      } catch {
        return;
      }
      if (Array.isArray(frame) && frame.length >= 5) {
        const [joinRef, ref, topic, event] = frame;
        if (event === 'phx_join' || event === 'heartbeat' || event === 'access_token') {
          socket.send(JSON.stringify([
            joinRef,
            ref,
            topic,
            'phx_reply',
            { status: 'ok', response: {} },
          ]));
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

function applyMockMutations(
  rows: Map<string, MockDatabaseRow>,
  userId: string,
  accountVersion: number,
  operations: HelmMutation[],
  now: string,
): MockDatabaseRow[] {
  const changed = new Map<string, MockDatabaseRow>();
  const mark = (row: MockDatabaseRow) => {
    row.revision += 1;
    row.account_version = accountVersion;
    row.updated_at = now;
    changed.set(`${row.collection}\0${row.record_id}`, row);
  };
  for (const operation of operations) {
    if (operation.op === 'reorder') {
      operation.orderedRecordIds.forEach((recordId, position) => {
        const row = rows.get(`${operation.collection}\0${recordId}`);
        if (row && row.deleted_at === null && row.position !== position) {
          row.position = position;
          mark(row);
        }
      });
      continue;
    }
    const key = `${operation.collection}\0${operation.recordId}`;
    const existing = rows.get(key);
    if (operation.op === 'create') {
      const row: MockDatabaseRow = {
        user_id: userId,
        collection: operation.collection,
        record_id: operation.recordId,
        payload: operation.payload,
        position: operation.position ?? null,
        revision: 1,
        account_version: accountVersion,
        created_at: now,
        updated_at: now,
        deleted_at: null,
      };
      rows.set(key, row);
      changed.set(key, row);
    } else if (existing && operation.op === 'patch' && existing.deleted_at === null) {
      existing.payload = { ...existing.payload, ...operation.set };
      for (const field of operation.unset || []) delete existing.payload[field];
      mark(existing);
    } else if (existing && operation.op === 'increment' && existing.deleted_at === null) {
      existing.payload[operation.field] = Number(existing.payload[operation.field] || 0) + operation.amount;
      mark(existing);
    } else if (existing && operation.op === 'delete' && existing.deleted_at === null) {
      existing.deleted_at = now;
      mark(existing);
    } else if (existing && operation.op === 'restore' && existing.deleted_at !== null) {
      existing.deleted_at = null;
      mark(existing);
    }
  }
  return [...changed.values()];
}

function toMutationResponseRow(row: MockDatabaseRow) {
  return {
    userId: row.user_id,
    collection: row.collection,
    recordId: row.record_id,
    payload: row.payload,
    position: row.position,
    revision: row.revision,
    accountVersion: row.account_version,
    createdAt: row.created_at,
    updatedAt: row.updated_at,
    deletedAt: row.deleted_at,
  };
}

async function mockPrayerTimes(page: Page): Promise<void> {
  await page.route('**/api.aladhan.com/v1/timingsByCity**', async route => {
    await route.fulfill({
      status: 200,
      contentType: 'application/json',
      body: JSON.stringify({
        data: {
          timings: {
            Fajr: '05:00',
            Sunrise: '06:50',
            Dhuhr: '13:00',
            Asr: '16:30',
            Sunset: '20:00',
            Maghrib: '20:15',
            Isha: '21:45',
            Midnight: '00:15',
          },
          date: {
            hijri: {
              day: '12',
              month: { en: 'Safar' },
              year: '1448',
            },
          },
          meta: { timezone: 'Europe/London' },
        },
      }),
    });
  });
}

function defaultAssistantHandler(request: AssistantMockRequest): Record<string, unknown> {
  if (request.action === 'health') {
    return {
      ok: true,
      provider: 'openai',
      model: 'gpt-5.4',
    };
  }

  if (request.action === 'turn') {
    const turn = {
      type: 'text',
      text: JSON.stringify({
        mode: 'reply',
        assistantMessage: 'Here is a deterministic hosted reply.',
        toolCalls: [],
      }),
    };
    return {
      ok: true,
      provider: 'openai',
      model: 'gpt-5.4',
      rawResponse: turn.text,
      turn,
    };
  }

  return {
    ok: true,
    provider: 'openai',
    model: 'gpt-5.4',
    text: JSON.stringify({
      assistantMessage: 'Here is a deterministic hosted reply.',
    }),
  };
}
