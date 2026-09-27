import type { Page, Request, Route } from '@playwright/test';
import { writeFile } from 'node:fs/promises';
import { expect, test } from './support/helm-fixture';
import type { HelmMutation } from '../src/store/databaseTypes';
import type { FinanceAccount, Project, ProjectPage, Surface, Trip } from '../src/types/domain';

const SNAPSHOT_ROUTE = '**/rest/v1/rpc/get_helm_account_snapshot*';
/** Collections the knowledge service now owns; Supabase must never be asked for them. */
const PROJECT_SCOPE = ['projects', 'projectPages', 'workspaces', 'knowledgeTopics', 'knowledgeEntries', 'lifestyleItems'];
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
// Projects and Finance are the Supabase page scopes; each is the non-empty inactive domain while the
// other is active, so an over-broad response is observable. Health and Trips seed the life service.
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

    let releaseFinance!: () => void;
    const financeResponse = new Promise<void>(resolve => { releaseFinance = resolve; });
    await page.route(SNAPSHOT_ROUTE, async route => {
      if (requestedCollections(route.request())?.includes('financeAccounts')) await financeResponse;
      await route.fallback();
    });
    await navigate(page, 'finance');
    await expect(page.getByRole('status').filter({ hasText: 'Loading page data' })).toBeVisible();
    await expect(financeData(page)).toHaveCount(0);
    await page.screenshot({ path: testInfo.outputPath(`finance-loading-${width}.png`) });
    releaseFinance();
    await expectSurfaceData(page, 'finance');
    await page.screenshot({ path: testInfo.outputPath(`finance-confirmed-${width}.png`) });
    expect(reads.snapshots.some(read => read.collections?.includes('financeAccounts'))).toBe(true);
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

test('Finance cold start excludes unrelated account domains', async ({ page, scenario }) => {
  await scenario({ initialSurface: 'finance', stores });
  const reads = observeDataReads(page);
  await page.goto('/');
  await expectSurfaceData(page, 'finance');
  expect(reads.snapshots.length).toBeGreaterThan(0);
  expect(reads.snapshots.every(read => read.collections !== undefined)).toBe(true);
  const collections = reads.snapshots.flatMap(read => read.collections ?? []);
  expect(collections).toContain('financeAccounts');
  expect(collections.filter(key => [...PROJECT_SCOPE, ...LIFE_LEGACY].includes(key))).toEqual([]);
  expect(reads.pages).toHaveLength(0);
  expect(reads.mutations.filter(operation => [...PROJECT_SCOPE, ...LIFE_LEGACY].includes(operation.collection))).toEqual([]);
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

test('failed page loads cannot replace unloaded records and an explicit retry recovers', async ({ page, scenario }, testInfo) => {
  await scenario({ initialSurface: 'projects', stores });
  await page.setViewportSize({ width: 390, height: 900 });
  await page.emulateMedia({ reducedMotion: 'reduce' });
  const reads = observeDataReads(page);
  await page.goto('/');
  await expectSurfaceData(page, 'projects');
  const failFinance = async (route: Route) => {
    if (requestedCollections(route.request())?.includes('financeAccounts')
      && !await page.evaluate(() => Reflect.get(window, '__scopedRetryClicked') === true)) {
      await route.fulfill({ status: 503, json: { message: 'Synthetic finance scope unavailable.' } });
    } else await route.fallback();
  };
  await page.route(SNAPSHOT_ROUTE, failFinance);
  await navigate(page, 'finance');
  const error = page.getByRole('alert').filter({ hasText: 'This page could not load' });
  await expect(error).toBeVisible();
  await expect(financeData(page)).toHaveCount(0);
  expect(reads.mutations.filter(operation => FINANCE_SCOPE.includes(operation.collection))).toEqual([]);
  await page.screenshot({ path: testInfo.outputPath('finance-failed-390.png') });
  const retry = page.getByRole('button', { name: 'Retry connection', exact: true });
  // Keep every scheduled retry failing until a real click reaches the banner.
  await retry.evaluate(element => element.addEventListener('click', () => {
    Reflect.set(window, '__scopedRetryClicked', true);
  }, { capture: true, once: true }));
  await retry.press('Enter');
  expect(await page.evaluate(() => Reflect.get(window, '__scopedRetryClicked'))).toBe(true);
  await expectSurfaceData(page, 'finance');
  await navigate(page, 'projects');
  await writeFile(testInfo.outputPath('scope-recovery-requests.json'), JSON.stringify(reads, null, 2));
  await expectSurfaceData(page, 'projects');
  expect(reads.mutations.filter(operation => [...FINANCE_SCOPE, ...PROJECT_SCOPE].includes(operation.collection))).toEqual([]);
  await page.screenshot({ path: testInfo.outputPath('projects-after-recovery-390.png') });
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

