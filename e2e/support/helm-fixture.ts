import {
  expect,
  test as base,
  type Page,
} from '@playwright/test';

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
    await seedStorage(page, name, options.storage, options.surface);
    return;
  }

  if (name === 'projects') {
    const projectOptions = options as ProjectsScenarioOptions;
    await seedStorage(page, name, {
      ...projectOptions.storage,
      'helm:projects': projectOptions.projects || DEFAULT_PROJECTS,
    }, projectOptions.surface);
    return;
  }

  if (name === 'hosted-assistant') {
    const hostedOptions = options as HostedAssistantScenarioOptions;
    await seedStorage(page, name, {
      ...hostedOptions.storage,
      'helm:settings': {
        ...DEFAULT_HOSTED_SETTINGS,
        ...hostedOptions.settings,
      },
    }, hostedOptions.surface);
    await mockHostedAssistant(page, hostedOptions.assistant);
    return;
  }

  if (name === 'signed-in-sync') {
    const syncOptions = options as SignedInSyncScenarioOptions;
    const userId = syncOptions.userId || 'user-sync-fixture';
    await seedStorage(page, name, {
      ...syncOptions.storage,
      ...Object.fromEntries(
        Object.entries(syncOptions.localStores || {}).map(([key, value]) => [`helm:${key}`, value]),
      ),
      'helm:settings': {
        supabaseAnonKey: 'helm-test-anon-key',
        supabaseUrl: 'https://helm.test.supabase.co',
        telemetry: false,
        theme: 'dark',
        ...syncOptions.settings,
      },
      'sb-helm-auth-token': {
        access_token: 'test-access-token',
        expires_at: 4_102_444_800,
        expires_in: 3600,
        refresh_token: 'test-refresh-token',
        token_type: 'bearer',
        user: {
          app_metadata: { provider: 'google' },
          aud: 'authenticated',
          email: syncOptions.email || 'sync@example.com',
          id: userId,
          role: 'authenticated',
          user_metadata: {},
        },
      },
    }, syncOptions.surface);
    await mockSupabaseStores(page, syncOptions.remoteStores || {});
    return;
  }

  const prayerOptions = options as PrayerScenarioOptions;
  await page.clock.install({
    time: new Date(prayerOptions.now || '2026-07-28T05:36:00.000Z'),
  });
  await seedStorage(page, name, {
    ...prayerOptions.storage,
    'helm:settings': {
      ...DEFAULT_HOSTED_SETTINGS,
      assistantEnabled: true,
      prayerCity: 'Bedford',
      prayerCountry: 'United Kingdom',
      prayerEnabled: true,
      prayerReminderEnabled: true,
      prayerReminderMinutes: 15,
      ...prayerOptions.settings,
    },
    'helm:tasks': prayerOptions.tasks || DEFAULT_PRAYER_TASKS,
  }, prayerOptions.surface || 'settings');
  await mockHostedAssistant(page, prayerOptions.assistant);
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

async function mockSupabaseStores(
  page: Page,
  stores: Record<string, RemoteStoreFixture>,
): Promise<void> {
  await page.route('https://helm.test.supabase.co/rest/v1/kv_store**', async route => {
    if (route.request().method() !== 'GET') {
      await route.fulfill({
        status: 201,
        contentType: 'application/json',
        body: '[]',
      });
      return;
    }

    const url = decodeURIComponent(route.request().url());
    const match = Object.entries(stores).find(([key]) => url.includes(`key=eq.${key}`));
    if (!match) {
      await route.fulfill({
        status: 406,
        contentType: 'application/json',
        body: JSON.stringify({ message: 'No rows found' }),
      });
      return;
    }

    const [, store] = match;
    await route.fulfill({
      status: 200,
      contentType: 'application/json',
      body: JSON.stringify({
        value: store.value,
        updated_at: store.updatedAt || '2026-05-01T10:00:00.000Z',
      }),
    });
  });
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
