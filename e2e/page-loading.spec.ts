import type { Page, Request } from '@playwright/test';
import { writeFile } from 'node:fs/promises';
import { SERVICES_BASE_URL } from './support/fake-services';
import { expect, test } from './support/helm-fixture';
import type { HelmMutation } from '../src/store/databaseTypes';
import type { FinanceAccount, Project, ProjectPage, Surface, Trip } from '../src/types/domain';

/** Collections the knowledge service now owns; Supabase must never be asked for them. */
const PROJECT_SCOPE = ['projects', 'projectPages', 'workspaces', 'knowledgeTopics', 'knowledgeEntries', 'lifestyleItems'];
/** Collections the finance service now owns; Supabase must never be asked for them. */
const FINANCE_SCOPE = ['financeAccounts', 'transactions', 'financeBudgets', 'savingsGoals', 'financeReviews', 'equityPositions'];
/** Collections the life admin service now owns; Supabase must never be asked for them. */
const LIFE_LEGACY = ['trips', 'tripLegs', 'tripItineraryItems', 'tripBookings', 'tripBudgetEntries',
  'inventoryItems', 'inventoryNeeds', 'employment', 'healthFastFoodEntries'];
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
// Projects seed the knowledge service, Finance the finance service, Health and Trips the life service; none
// of them may be read from Supabase any more.
const stores = {
  projects: [project],
  projectPages: [overview],
  financeAccounts: [account],
  trips: [trip],
  healthFastFoodEntries: [{ id: 'scoped-health', venue: 'Synthetic scoped cafe', date: '2026-09-22',
    rating: 'mixed', symptoms: [], notes: 'A browser fixture entry.', createdAt: timestamp, updatedAt: timestamp }],
};

function requestedCollections(request: Request): string[] | undefined {
  if (!new URL(request.url()).pathname.endsWith('/get_helm_account_snapshot_for_collections')) return undefined;
  return (request.postDataJSON() as { p_collections: string[] }).p_collections;
}

function observeDataReads(page: Page) {
  const snapshots: Array<{ url: string; collections: string[] | undefined }> = [];
  const pages: URL[] = [];
  const mutations: HelmMutation[] = [];
  const deltas: number[] = [];
  page.on('request', request => {
    const url = new URL(request.url());
    if (url.pathname.includes('/get_helm_account_snapshot')) {
      snapshots.push({ url: url.pathname, collections: requestedCollections(request) });
    } else if (url.pathname.endsWith('/get_helm_changed_collections')) {
      deltas.push((request.postDataJSON() as { p_since_version: number }).p_since_version);
    } else if (url.pathname.endsWith('/helm_records')) {
      pages.push(url);
    } else if (url.pathname.endsWith('/apply_helm_mutations')) {
      mutations.push(...((request.postDataJSON() as { p_operations?: HelmMutation[] }).p_operations ?? []));
    }
  });
  return { snapshots, pages, mutations, deltas };
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

async function expectSurfaceData(page: Page, surface: 'projects' | 'finance') {
  if (surface === 'projects') {
    await expect(page.getByRole('heading', { name: project.name, exact: true })).toBeVisible();
  } else {
    await expect(financeData(page)).toHaveText('£5,000.00');
  }
}

for (const width of [390, 768, 1440]) {
  test(`Projects loads from the knowledge service and reuses confirmed navigation data at ${width}px`, async ({ page, scenario }, testInfo) => {
    const control = await scenario({ initialSurface: 'projects', stores });
    await page.setViewportSize({ width, height: 900 });
    await page.emulateMedia({ reducedMotion: 'reduce' });
    const reads = observeDataReads(page);
    // Finance loads with the app; its ledger is held back until the Finance page has shown it is loading.
    let releaseFinance!: () => void;
    const financeResponse = new Promise<void>(resolve => { releaseFinance = resolve; });
    await page.route(`${SERVICES_BASE_URL}/api/finance/v1/ledger`, async route => {
      await financeResponse;
      await route.fallback();
    });
    await page.goto('/');
    await expectSurfaceData(page, 'projects');
    expect(reads.snapshots.length).toBeGreaterThan(0);
    expect(reads.snapshots.every(read => read.collections !== undefined)).toBe(true);
    const coldCollections = reads.snapshots.flatMap(read => read.collections ?? []);
    expect(control.services.calls).toContain('GET /api/knowledge/v1/projects');
    expect(coldCollections.filter(key => [...PROJECT_SCOPE, ...FINANCE_SCOPE, ...LIFE_LEGACY].includes(key))).toEqual([]);
    expect(reads.pages).toHaveLength(0);
    expect(reads.mutations.filter(operation => [...PROJECT_SCOPE, ...FINANCE_SCOPE, ...LIFE_LEGACY].includes(operation.collection))).toEqual([]);
    await page.screenshot({ path: testInfo.outputPath(`projects-confirmed-${width}.png`) });

    await navigate(page, 'finance');
    await expect(page.getByRole('status').filter({ hasText: 'Loading page data' })).toBeVisible();
    await expect(financeData(page)).toHaveCount(0);
    await page.screenshot({ path: testInfo.outputPath(`finance-loading-${width}.png`) });
    releaseFinance();
    await expectSurfaceData(page, 'finance');
    await page.screenshot({ path: testInfo.outputPath(`finance-confirmed-${width}.png`) });
    expect(control.services.calls).toContain('GET /api/finance/v1/ledger');
    expect(reads.snapshots.flatMap(read => read.collections ?? []).filter(key => FINANCE_SCOPE.includes(key))).toEqual([]);
    const loadedReadCount = reads.snapshots.length;
    await navigate(page, 'projects');
    await expectSurfaceData(page, 'projects');
    await navigate(page, 'finance');
    await expectSurfaceData(page, 'finance');
    expect(reads.snapshots).toHaveLength(loadedReadCount);
    expect(await page.evaluate(() => document.documentElement.scrollWidth <= window.innerWidth)).toBe(true);
    await testInfo.attach('scoped-network-requests', { body: JSON.stringify(reads.snapshots), contentType: 'application/json' });
  });
}

test('Finance cold start reads the finance service and none of its old Supabase collections', async ({ page, scenario }) => {
  const control = await scenario({ initialSurface: 'finance', stores });
  const reads = observeDataReads(page);
  await page.goto('/');
  await expectSurfaceData(page, 'finance');
  expect(control.services.calls).toEqual(expect.arrayContaining([
    'GET /api/finance/v1/ledger', 'GET /api/finance/v1/review', 'GET /api/finance/v1/equity/positions',
  ]));
  expect(reads.snapshots.every(read => read.collections !== undefined)).toBe(true);
  const collections = reads.snapshots.flatMap(read => read.collections ?? []);
  expect(collections.filter(key => [...FINANCE_SCOPE, ...PROJECT_SCOPE, ...LIFE_LEGACY].includes(key))).toEqual([]);
  expect(reads.pages).toHaveLength(0);
  expect(reads.mutations.filter(operation => [...FINANCE_SCOPE, ...PROJECT_SCOPE, ...LIFE_LEGACY]
    .includes(operation.collection))).toEqual([]);
});

test('Health and Trips read from the life service and request none of their old Supabase collections', async ({ page, scenario }) => {
  const control = await scenario({ initialSurface: 'health', stores });
  const reads = observeDataReads(page);
  await page.goto('/');
  await expect(page.getByRole('heading', { name: 'Synthetic scoped cafe', exact: true })).toBeVisible();
  const readsBeforeTrips = reads.snapshots.length;
  await navigate(page, 'trips');
  await expect(page.getByRole('heading', { name: trip.name, exact: true })).toBeVisible();
  expect(control.services.calls).toEqual(expect.arrayContaining(['GET /api/life/v1/health/fast-food', 'GET /api/life/v1/trips']));
  // Trips needs only the shared scope, already confirmed, so it adds no Supabase read.
  expect(reads.snapshots).toHaveLength(readsBeforeTrips);
  expect(reads.snapshots.every(read => read.collections !== undefined)).toBe(true);
  expect(reads.snapshots.flatMap(read => read.collections ?? []).filter(key => LIFE_LEGACY.includes(key))).toEqual([]);
  expect(reads.pages).toHaveLength(0);
  expect(reads.mutations.filter(operation => LIFE_LEGACY.includes(operation.collection))).toEqual([]);
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
  const reads = observeDataReads(page);
  await page.goto('/');
  await expect(page.getByRole('main', { name: 'dashboard surface', exact: true })).toBeVisible();
  await navigate(page, 'activity');
  await expect(page.getByRole('heading', { name: 'Activity', exact: true })).toBeVisible();
  await expect(page.getByRole('heading', { name: 'Assistant actions', exact: true })).toHaveCount(0);
  const assistantCollections = ['conversations', 'assistantCorrections', 'assistantActivityLog'];
  expect(reads.snapshots.flatMap(read => read.collections ?? []).filter(key => assistantCollections.includes(key))).toEqual([]);
  expect(reads.pages.filter(url => assistantCollections.some(key => url.searchParams.get('collection') === `eq.${key}`))).toEqual([]);
});

