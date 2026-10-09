import type { Page } from '@playwright/test';
import { writeFile } from 'node:fs/promises';
import { SERVICES_BASE_URL } from './support/fake-services';
import { expect, test } from './support/helm-fixture';
import type { FinanceAccount, Project, ProjectPage, Surface, Trip } from '../src/types/domain';

const timestamp = '2026-09-22T10:00:00.000Z';
const project: Project = {
  id: 'scoped-project', catalogKey: 'custom:scoped-project', name: 'Synthetic scoped project',
  summary: 'A browser fixture project.', kind: 'web_app', status: 'active', tags: [], isPinned: false,
  links: [], setupSteps: [], runRecipes: [], createdAt: timestamp, updatedAt: timestamp,
  preview: { accentColor: '#7c6cff', backgroundColor: '#171827', icon: 'folder' },
};
// The project's preview and overview page are seeded so loading Projects writes nothing.
const overview: ProjectPage = {
  id: 'scoped-project-overview', projectId: project.id, title: 'Overview', content: 'A browser fixture overview.',
  isOverview: true, createdAt: timestamp, updatedAt: timestamp,
};
const account: FinanceAccount = {
  id: 'scoped-account', name: 'Synthetic scoped account', type: 'current', balance: 500_000,
  currency: 'GBP', color: '#4f5bff', icon: '£', includeInNetWorth: true, sortOrder: 0,
  createdAt: timestamp, updatedAt: timestamp,
};
const trip: Trip = {
  id: 'scoped-trip', name: 'Synthetic scoped trip', summary: 'A browser fixture trip.', notes: '',
  status: 'planning', startDate: '2026-10-01', endDate: '2026-10-03',
  budgetCurrency: 'GBP', budgetTotal: 0,
  createdAt: timestamp, updatedAt: timestamp,
};
// Projects seed the knowledge service, Finance the finance service, Health and Trips the life service.
const stores = {
  projects: [project],
  projectPages: [overview],
  financeAccounts: [account],
  trips: [trip],
  healthFastFoodEntries: [{ id: 'scoped-health', venue: 'Synthetic scoped cafe', date: '2026-09-22',
    rating: 'mixed', symptoms: [], notes: 'A browser fixture entry.', createdAt: timestamp, updatedAt: timestamp }],
};

/** Every Supabase call to the retired generic record store (snapshots, record pages, mutations). */
function observeRecordStoreCalls(page: Page): string[] {
  const calls: string[] = [];
  page.on('request', request => {
    const { pathname } = new URL(request.url());
    if (/\/rest\/v1\/(helm_records|helm_account_state|rpc\/(get_helm_|apply_helm_))/u.test(pathname)) calls.push(pathname);
  });
  return calls;
}

async function navigate(page: Page, surface: Surface) {
  const label = surface[0].toUpperCase() + surface.slice(1);
  if ((page.viewportSize()?.width ?? 1440) <= 760) {
    await page.getByRole('button', { name: 'Open more navigation', exact: true }).click();
    await page.getByRole('dialog', { name: 'More navigation', exact: true }).getByRole('button', { name: label, exact: true }).click();
  } else {
    await page.getByRole('button', { name: `Navigate to ${label}`, exact: true }).click();
  }
  await expect(page.getByRole('main', { name: `${surface} surface`, exact: true })).toBeVisible();
}

function financeData(page: Page) {
  return page.locator('.finance-net-worth');
}

for (const width of [390, 1440]) {
  test(`Dashboard is usable before unrelated Calendar, Knowledge and Clock requests finish at ${width}px`, async ({ page, scenario }, testInfo) => {
    await scenario();
    await page.setViewportSize({ width, height: 900 });
    await page.emulateMedia({ reducedMotion: 'reduce' });
    let release!: () => void;
    const pending = new Promise<void>(resolve => { release = resolve; });
    for (const endpoint of ['calendar/v1/calendar*', 'knowledge/v1/knowledge', 'planner/v1/clock']) {
      await page.route(`${SERVICES_BASE_URL}/api/${endpoint}`, async route => {
        await pending;
        await route.fallback();
      });
    }
    try {
      await page.goto('/');
      await expect(page.getByRole('heading', { name: 'Night Compass', exact: true })).toBeVisible();
      await expect(page.getByRole('heading', { name: 'Learn', exact: true })).toBeVisible();
      await expect(page.getByRole('button', { name: 'Open tasks', exact: true })).toBeEnabled();
      await page.screenshot({ path: testInfo.outputPath(`dashboard-before-unrelated-data-${width}.png`) });
      expect(await page.evaluate(() => document.documentElement.scrollWidth <= window.innerWidth)).toBe(true);
      await page.getByRole('button', { name: 'Navigate to Calendar', exact: true }).click();
      await expect(page.getByRole('status').filter({ hasText: 'Loading page data' })).toBeVisible();
      release();
      await expect(page.getByRole('heading', { name: 'Calendar', exact: true })).toBeVisible();
    } finally {
      release();
    }
  });
}

async function expectSurfaceData(page: Page, surface: 'projects' | 'finance') {
  if (surface === 'projects') {
    await expect(page.getByRole('heading', { name: project.name, exact: true })).toBeVisible();
  } else {
    await expect(financeData(page)).toHaveText('£5,000.00');
  }
}

for (const width of [390, 768, 1440]) {
  test(`Dashboard sections appear independently without a full-page wait at ${width}px`, async ({ page, scenario }, testInfo) => {
    const control = await scenario({ settings: { prayerEnabled: true } });
    await page.setViewportSize({ width, height: 900 });
    await page.emulateMedia({ reducedMotion: 'reduce' });
    const release: Record<string, () => void> = {};
    for (const resource of ['tasks', 'momentum', 'gamification']) {
      const pending = new Promise<void>(resolve => { release[resource] = resolve; });
      await page.route(`${SERVICES_BASE_URL}/api/planner/v1/${resource}`, async route => {
        await pending;
        await route.fallback();
      });
    }
    try {
      await page.goto('/');
      const heading = page.getByRole('heading', { name: 'Night Compass', exact: true });
      await expect(heading).toBeVisible();
      await expect(page.getByRole('complementary', { name: 'Daily Quran reading' })).toBeVisible();
      await expect(page.getByText('Loading page data...')).toHaveCount(0);
      await expect(page.getByRole('status', { name: 'Loading Learn', exact: true })).toBeVisible();
      await expect(page.getByRole('status', { name: 'Loading Move', exact: true })).toBeVisible();
      await expect(page.getByText('Loading tasks…', { exact: true })).toBeVisible();
      await expect(page.locator('.nc-momentum-grid button')).toHaveCount(0);
      await expect(page.getByText('No tasks due today')).toHaveCount(0);
      await expect(page.getByRole('button', { name: 'Open tasks', exact: true })).toBeEnabled();
      // The prayer read needs the confirmed location, not the pending Tasks response.
      await expect(page.getByRole('status', { name: 'Prayer data sync', exact: true })).toHaveText('Prayer data: Synced');
      await expect(page.getByRole('status', { name: 'Loading Prayer', exact: true })).toHaveCount(0);
      const prayers = page.getByRole('button', { name: /Complete .* Prayer/u });
      await expect(prayers).toHaveCount(5);
      expect(await prayers.evaluateAll(buttons => buttons.every(button => button.hasAttribute('disabled')))).toBe(true);
      expect(control.services.calls.filter(call => /^(POST|PUT|PATCH|DELETE) \/api\/planner\//u.test(call))).toEqual([]);
      const before = await heading.boundingBox();
      await page.screenshot({ path: testInfo.outputPath(`dashboard-sections-pending-${width}.png`) });

      release.tasks();
      await expect(page.getByText('No tasks due today')).toBeVisible();
      // Tasks are ready while the Learn/Move and Progress reads remain indefinitely held.
      await expect(page.getByRole('status', { name: 'Loading Learn', exact: true })).toBeVisible();
      release.momentum();
      await expect(page.getByRole('button', { name: 'Add 2 pages', exact: true })).toBeEnabled();
      await expect(page.getByRole('status', { name: 'Loading Learn', exact: true })).toHaveCount(0);
      const after = await heading.boundingBox();
      expect(before).not.toBeNull();
      expect(after).not.toBeNull();
      expect(Math.abs(after!.x - before!.x)).toBeLessThanOrEqual(1);
      expect(Math.abs(after!.y - before!.y)).toBeLessThanOrEqual(1);
      expect(await page.evaluate(() => document.documentElement.scrollWidth <= window.innerWidth)).toBe(true);
      await page.screenshot({ path: testInfo.outputPath(`dashboard-sections-ready-${width}.png`) });
      const main = page.getByRole('main', { name: 'dashboard surface', exact: true });
      const scroller = width <= 760 ? main : page.getByLabel('Dashboard content', { exact: true });
      const dimensions = await scroller.evaluate(element => ({ client: element.clientHeight, scroll: element.scrollHeight }));
      expect(dimensions.scroll).toBeGreaterThan(dimensions.client);
      await scroller.press('PageDown');
      await expect.poll(() => scroller.evaluate(element => element.scrollTop)).toBeGreaterThan(0);
      release.gamification();
    } finally {
      Object.values(release).forEach(finish => finish());
    }
  });
}

for (const width of [390, 768, 1440]) {
  test(`Projects loads from the knowledge service and reuses confirmed navigation data at ${width}px`, async ({ page, scenario }, testInfo) => {
    const control = await scenario({ initialSurface: 'projects', stores });
    await page.setViewportSize({ width, height: 900 });
    await page.emulateMedia({ reducedMotion: 'reduce' });
    const recordStoreCalls = observeRecordStoreCalls(page);
    // Finance loads with the app; its ledger is held back until the Finance page has shown it is loading.
    let releaseFinance!: () => void;
    const financeResponse = new Promise<void>(resolve => { releaseFinance = resolve; });
    await page.route(`${SERVICES_BASE_URL}/api/finance/v1/ledger`, async route => {
      await financeResponse;
      await route.fallback();
    });
    await page.goto('/');
    await expectSurfaceData(page, 'projects');
    expect(control.services.calls).toContain('GET /api/knowledge/v1/projects');
    await page.screenshot({ path: testInfo.outputPath(`projects-confirmed-${width}.png`) });

    await navigate(page, 'finance');
    await expect(page.getByRole('status').filter({ hasText: 'Loading page data' })).toBeVisible();
    await expect(financeData(page)).toHaveCount(0);
    await page.screenshot({ path: testInfo.outputPath(`finance-loading-${width}.png`) });
    releaseFinance();
    await expectSurfaceData(page, 'finance');
    await page.screenshot({ path: testInfo.outputPath(`finance-confirmed-${width}.png`) });
    const ledgerReads = () => control.services.calls.filter(call => call === 'GET /api/finance/v1/ledger').length;
    const loadedLedgerReads = ledgerReads();
    await navigate(page, 'projects');
    await expectSurfaceData(page, 'projects');
    await navigate(page, 'finance');
    await expectSurfaceData(page, 'finance');
    // Confirmed data stays in memory across navigation: revisiting Finance does not reload its ledger.
    expect(ledgerReads()).toBe(loadedLedgerReads);
    expect(recordStoreCalls).toEqual([]);
    expect(await page.evaluate(() => document.documentElement.scrollWidth <= window.innerWidth)).toBe(true);
    await testInfo.attach('service-requests', { body: JSON.stringify(control.services.calls), contentType: 'application/json' });
  });
}

test('Finance cold start reads the finance service and nothing from the retired record store', async ({ page, scenario }) => {
  const control = await scenario({ initialSurface: 'finance', stores });
  const recordStoreCalls = observeRecordStoreCalls(page);
  await page.goto('/');
  await expectSurfaceData(page, 'finance');
  // Ledger visibility does not imply the independently loaded review and equity requests have arrived.
  await expect.poll(() => control.services.calls).toEqual(expect.arrayContaining([
    'GET /api/finance/v1/ledger', 'GET /api/finance/v1/review', 'GET /api/finance/v1/equity/positions',
  ]));
  expect(recordStoreCalls).toEqual([]);
});

test('Health and Trips read from the life service and nothing from the retired record store', async ({ page, scenario }) => {
  const control = await scenario({ initialSurface: 'health', stores });
  const recordStoreCalls = observeRecordStoreCalls(page);
  await page.goto('/');
  await expect(page.getByRole('heading', { name: 'Synthetic scoped cafe', exact: true })).toBeVisible();
  await navigate(page, 'trips');
  await expect(page.getByRole('heading', { name: trip.name, exact: true })).toBeVisible();
  expect(control.services.calls).toEqual(expect.arrayContaining(['GET /api/life/v1/health/fast-food', 'GET /api/life/v1/trips']));
  expect(recordStoreCalls).toEqual([]);
});

test('a failed Finance load shows why, saves nothing and an explicit retry recovers', async ({ page, scenario }, testInfo) => {
  const control = await scenario({ initialSurface: 'projects', stores });
  await page.setViewportSize({ width: 390, height: 900 });
  await page.emulateMedia({ reducedMotion: 'reduce' });
  // Keep every automatic reload failing until a real click on Retry.
  await page.route(`${SERVICES_BASE_URL}/api/finance/v1/ledger`, async route => {
    if (await page.evaluate(() => Reflect.get(window, '__financeRetryClicked') === true)) return route.fallback();
    return route.fulfill({ status: 500, json: { code: 'internal_error', message: 'Synthetic finance ledger unavailable.' } });
  });
  await page.goto('/');
  await expectSurfaceData(page, 'projects');
  await navigate(page, 'finance');
  const error = page.getByRole('alert').filter({ hasText: 'Finance could not be refreshed' });
  await expect(error).toContainText('Synthetic finance ledger unavailable.');
  await expect(page.getByText(account.name)).toHaveCount(0);
  await page.screenshot({ path: testInfo.outputPath('finance-failed-390.png') });
  const retry = error.getByRole('button', { name: 'Retry', exact: true });
  await retry.evaluate(element => element.addEventListener('click', () => {
    Reflect.set(window, '__financeRetryClicked', true);
  }, { capture: true, once: true }));
  await retry.press('Enter');
  await expectSurfaceData(page, 'finance');
  await expect(error).toHaveCount(0);
  expect(control.services.calls.filter(call => /^(PUT|DELETE) \/api\/finance\//u.test(call))).toEqual([]);
  await writeFile(testInfo.outputPath('finance-recovery-calls.json'), JSON.stringify(control.services.calls, null, 2));
  await navigate(page, 'projects');
  await expectSurfaceData(page, 'projects');
});

test('Activity and a stored chat surface from the removed assistant read no assistant records', async ({ page, scenario }) => {
  await scenario({ initialSurface: 'chat' as never, stores });
  const recordStoreCalls = observeRecordStoreCalls(page);
  await page.goto('/');
  await expect(page.getByRole('main', { name: 'dashboard surface', exact: true })).toBeVisible();
  await navigate(page, 'activity');
  await expect(page.getByRole('heading', { name: 'Activity', exact: true })).toBeVisible();
  await expect(page.getByRole('heading', { name: 'Assistant actions', exact: true })).toHaveCount(0);
  expect(recordStoreCalls).toEqual([]);
});

