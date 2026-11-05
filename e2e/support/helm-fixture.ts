import { expect, test as base, type Page, type Response } from '@playwright/test';
import { STORAGE_KEYS } from '../../src/config/constants';
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
  ClockState,
  EmploymentApplication,
  FinanceReview,
  GamificationProfile,
  Integration,
  Surface,
  Task,
} from '../../src/types/domain';
import type { ServiceIntegration } from '../../src/services/backend/contracts';
import type { FakeFinanceSeed } from './fake-finance-service';
import type { FakeKnowledgeSeed } from './fake-knowledge-service';
import type { FakeLifeSeed } from './fake-life-service';
import type { FakePlannerSeed } from './fake-planner-service';
import { installQuranRoute } from './fake-quran';

const TEST_USER_ID = '11111111-1111-4111-8111-111111111111';
const TEST_EMAIL = 'e2e@example.test';
const FIXTURE_TIME = '2026-08-01T12:00:00.000Z';

const DEFAULT_SETTINGS = {
  theme: 'dark',
  dataRetentionDays: 90,
  telemetry: false,
  prayerEnabled: false,
  prayerCity: 'Bedford',
  prayerCountry: 'United Kingdom',
  prayerReminderEnabled: true,
  prayerReminderMinutes: 15,
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
  initialSurface?: Surface;
  now?: string;
  prayer?: {
    failureStatus?: number;
    timezone?: string;
    timings?: Partial<Record<PrayerTimingName, string>>;
  };
  /** The Spring Boot services (always installed, stateful per scenario). */
  services?: FakeServicesOptions;
  settings?: Record<string, unknown>;
  /** Account data in the app's shapes, keyed by the old collection names; each seeds its owning service. */
  stores?: Record<string, unknown>;
  userId?: string;
}

export interface HelmScenarioControl {
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

/** Service write paths, by the collection the scenario names. */
const SERVICE_WRITE_PATHS: Record<string, string> = {
  employment: '/api/life/v1/jobs',
  healthFastFoodEntries: '/api/life/v1/health/',
  inventoryItems: '/api/life/v1/inventory/',
  inventoryNeeds: '/api/life/v1/inventory/',
  trips: '/api/life/v1/trips/',
  tripLegs: '/api/life/v1/trips/',
  tripItineraryItems: '/api/life/v1/trips/',
  tripBookings: '/api/life/v1/trips/',
  tripBudgetEntries: '/api/life/v1/trips/',
  knowledgeTopics: '/api/knowledge/v1/knowledge/',
  knowledgeEntries: '/api/knowledge/v1/knowledge/',
  lifestyleItems: '/api/knowledge/v1/lifestyle',
  projects: '/api/knowledge/v1/projects',
  projectPages: '/api/knowledge/v1/projects/pages/',
  tasks: '/api/planner/v1/tasks',
  // Daily momentum, kept in the progress record before, saves per pillar to the planner.
  gamification: '/api/planner/v1/momentum/',
  clock: '/api/planner/v1/clock/',
  financeAccounts: '/api/finance/v1/accounts/',
  transactions: '/api/finance/v1/transactions/',
  financeBudgets: '/api/finance/v1/budgets/',
  savingsGoals: '/api/finance/v1/savings-goals/',
  financeReviews: '/api/finance/v1/review',
  equityPositions: '/api/finance/v1/equity/',
};

export function waitForMutation(page: Page, collection: string): Promise<Response> {
  return page.waitForResponse(response => {
    const path = SERVICE_WRITE_PATHS[collection];
    if (!path) throw new Error(`No service owns the ${collection} collection.`);
    return response.request().method() !== 'GET' && new URL(response.url()).pathname.startsWith(path);
  });
}

export async function installScenario(page: Page, options: HelmScenarioOptions = {}): Promise<HelmScenarioControl> {
  if (options.now) {
    await page.clock.install({ time: new Date(options.now) });
  }

  const userId = options.userId || TEST_USER_ID;
  const settings = scenarioSettings(options);
  const authenticated = options.authenticated !== false;

  await page.addInitScript(({ marker, initialSurface, surfaceKey }) => {
    if (sessionStorage.getItem(marker) === 'ready') return;
    localStorage.clear(); sessionStorage.clear();
    if (initialSurface) sessionStorage.setItem(surfaceKey, initialSurface);
    sessionStorage.setItem(marker, 'ready');
  }, {
    marker: 'helm-kan252-e2e-scenario-ready', initialSurface: options.initialSurface, surfaceKey: STORAGE_KEYS.SHELL_SURFACE,
  });

  const services = createFakeServices(servicesFromScenario(options, settings));
  await installFakeServices(page, services);
  // Registered after the fake services so it answers timetable requests first.
  await installPrayerRoute(page, options.prayer);
  await installAccessRoutes(page, { authenticated, userId, email: options.email || TEST_EMAIL });
  await installQuranRoute(page);
  return { services };
}

function scenarioSettings(options: HelmScenarioOptions): Record<string, unknown> {
  const suppliedSettings = options.stores?.settings;
  return {
    ...DEFAULT_SETTINGS,
    ...(suppliedSettings && typeof suppliedSettings === 'object' ? suppliedSettings : {}),
    ...(options.settings || {}),
  };
}

function financeFromScenario(stores: Record<string, unknown> | undefined): FakeFinanceSeed {
  const list = <T,>(key: string) => stores?.[key] as T[] | undefined;
  return {
    accounts: list('financeAccounts'),
    transactions: list('transactions'),
    budgets: list('financeBudgets'),
    savingsGoals: list('savingsGoals'),
    review: list<FinanceReview>('financeReviews')?.find(review => review.id === 'current') ?? null,
    equityPositions: list('equityPositions'),
  };
}

function plannerFromScenario(stores: Record<string, unknown> | undefined): FakePlannerSeed {
  return {
    tasks: stores?.tasks as Task[] | undefined,
    gamification: stores?.gamification as GamificationProfile | undefined,
    clock: stores?.clock as ClockState | undefined,
  };
}

function knowledgeFromScenario(stores: Record<string, unknown> | undefined): FakeKnowledgeSeed {
  const list = <T,>(key: string) => stores?.[key] as T[] | undefined;
  return {
    knowledgeTopics: list('knowledgeTopics'),
    knowledgeEntries: list('knowledgeEntries'),
    lifestyleItems: list('lifestyleItems'),
    projects: list('projects'),
    projectPages: list('projectPages'),
  };
}

function lifeFromScenario(stores: Record<string, unknown> | undefined): FakeLifeSeed {
  const list = <T,>(key: string) => stores?.[key] as T[] | undefined;
  const employment = stores?.employment as { applications?: EmploymentApplication[] } | undefined;
  return {
    applications: employment?.applications,
    fastFoodEntries: list('healthFastFoodEntries'),
    inventoryItems: list('inventoryItems'),
    inventoryNeeds: list('inventoryNeeds'),
    trips: list('trips'),
    tripLegs: list('tripLegs'),
    tripItineraryItems: list('tripItineraryItems'),
    tripBookings: list('tripBookings'),
    tripBudgetEntries: list('tripBudgetEntries'),
  };
}

/** Native browser-session and approval APIs; no credentials are injected into browser storage. */
async function installAccessRoutes(page: Page, account: { authenticated: boolean; userId: string; email: string }): Promise<void> {
  let signedIn = account.authenticated;
  const cors = { 'Access-Control-Allow-Origin': '*', 'Access-Control-Allow-Credentials': 'true' };
  await page.route('**/api/access/**', async route => {
    const request = route.request();
    const origin = request.headers().origin;
    const headers = { ...cors, 'Access-Control-Allow-Origin': origin || '*' };
    if (request.method() === 'OPTIONS') {
      await route.fulfill({ status: 204, headers: { ...headers, 'Access-Control-Allow-Methods': 'GET, POST, DELETE, OPTIONS',
        'Access-Control-Allow-Headers': 'content-type,x-csrf-token' } });
      return;
    }
    const path = new URL(request.url()).pathname;
    if (path.endsWith('/session')) {
      await route.fulfill({ headers, json: signedIn ? {
        user: { id: account.userId, email: account.email, user_metadata: { full_name: 'E2E User' } },
        accessToken: 'e2e-access-token', expiresAt: '2100-01-01T00:00:00Z',
      } : { user: null, accessToken: null, expiresAt: null } });
    } else if (path.endsWith('/csrf')) {
      await route.fulfill({ headers, json: { headerName: 'X-CSRF-TOKEN', token: 'fixture-csrf' } });
    } else if (path.endsWith('/signout')) {
      signedIn = false;
      await route.fulfill({ headers, status: 204 });
    } else if (/\/agents\/(inventory|employment|equity|finance)\/clients$/.test(path)) {
      await route.fulfill({ headers, json: [] });
    } else await route.fulfill({ headers, status: 404, json: { message: 'Unconfigured synthetic access endpoint.' } });
  });
}

const APP_PREFERENCE_KEYS = ['theme', 'dataRetentionDays', 'telemetry', 'defaultCalendarTab', 'goalTags'];

/** A scenario's integrations (app shape) become the profile service's saved connection records. */
function serviceIntegrations(stored: unknown): ServiceIntegration[] | undefined {
  if (!Array.isArray(stored)) return undefined;
  const byProvider = new Map<string, ServiceIntegration>();
  for (const integration of stored as Integration[]) {
    if (byProvider.has(integration.provider) || integration.status === 'mocked') continue;
    byProvider.set(integration.provider, {
      provider: integration.provider,
      status: integration.status,
      configuredAt: integration.configuredAt ?? null,
      lastError: integration.lastError ?? null,
      updatedAt: FIXTURE_TIME,
    });
  }
  return [...byProvider.values()];
}

/**
 * Prayer preferences, location, app preferences and integrations are owned by the prayer and
 * profile services, so a scenario's settings become those services' saved values.
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
    ...(APP_PREFERENCE_KEYS.some(key => key in explicit)
      ? {
          appPreferences: {
            theme: String(settings.theme),
            dataRetentionDays: Number(settings.dataRetentionDays),
            telemetry: settings.telemetry === true,
            defaultCalendarTab: typeof settings.defaultCalendarTab === 'string' ? settings.defaultCalendarTab : null,
            goalTags: Array.isArray(settings.goalTags) ? settings.goalTags.map(String) : [],
          },
        }
      : {}),
    integrations: serviceIntegrations(options.stores?.integrations),
    life: lifeFromScenario(options.stores),
    knowledge: knowledgeFromScenario(options.stores),
    planner: plannerFromScenario(options.stores),
    finance: financeFromScenario(options.stores),
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
