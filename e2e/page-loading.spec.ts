import type { Page, Request, Route } from '@playwright/test';
import { writeFile } from 'node:fs/promises';
import { expect, test, waitForMutation } from './support/helm-fixture';
import type { HelmMutation } from '../src/store/databaseTypes';
import type { FinanceAccount, Project, ProjectPage, Surface, Trip } from '../src/types/domain';

const SNAPSHOT_ROUTE = '**/rest/v1/rpc/get_helm_account_snapshot*';
const PROJECT_SCOPE = ['projects', 'projectPages', 'workspaces'];
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
  test(`Projects loads its scope and reuses confirmed navigation data at ${width}px`, async ({ page, scenario }, testInfo) => {
    await scenario({ initialSurface: 'projects', stores });
    await page.setViewportSize({ width, height: 900 });
    await page.emulateMedia({ reducedMotion: 'reduce' });
    const reads = observeDataReads(page);
    await page.goto('/');
    await expectSurfaceData(page, 'projects');
    expect(reads.snapshots.length).toBeGreaterThan(0);
    expect(reads.snapshots.every(read => read.collections !== undefined)).toBe(true);
    const coldCollections = reads.snapshots.flatMap(read => read.collections ?? []);
    expect(coldCollections).toContain('projects');
    expect(coldCollections.filter(key => [...FINANCE_SCOPE, ...LIFE_LEGACY].includes(key))).toEqual([]);
    expect(reads.pages).toHaveLength(0);
    expect(reads.mutations.filter(operation => [...FINANCE_SCOPE, ...LIFE_LEGACY].includes(operation.collection))).toEqual([]);
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


test('two clients selectively refresh active data, defer inactive data, and catch up after missed Broadcast', async ({ page, browser, scenario }, testInfo) => {
  const clientA = await scenario({ now: timestamp, initialSurface: 'projects', stores });
  const clientBPage = await browser.newPage({ baseURL: testInfo.project.use.baseURL, viewport: { width: 1440, height: 900 } });
  try {
    const clientB = await clientA.addClient(clientBPage);
    const reads = observeDataReads(clientBPage);
    await page.goto('/');
    await clientBPage.goto('/');
    await expectSurfaceData(page, 'projects');
    await expectSurfaceData(clientBPage, 'projects');
    const projectCard = (name: string) => page.getByRole('listitem')
      .filter({ has: page.getByRole('heading', { name, exact: true }) });
    const renameProject = async (oldName: string, newName: string) => {
      await projectCard(oldName).getByRole('button', { name: 'View details' }).click();
      await page.getByRole('dialog', { name: oldName }).getByRole('button', { name: 'Edit project' }).click();
      const editor = page.getByRole('dialog', { name: 'Edit Project' });
      await editor.getByLabel('Name').fill(newName);
      const confirmed = waitForMutation(page, 'projects');
      await editor.getByRole('button', { name: 'Save Project' }).click();
      expect((await confirmed).ok()).toBe(true);
      await expect(page.getByRole('heading', { name: newName, exact: true })).toBeVisible();
    };
    const expectOnlyProjectReads = (start: number, collections = ['projects']) => {
      const added = reads.snapshots.slice(start);
      expect(added).toHaveLength(1);
      expect([...added[0].collections ?? []].sort()).toEqual(collections);
      expect(reads.pages).toHaveLength(0);
    };

    // Hold B's authoritative response to prove a Broadcast payload cannot publish data.
    const activeStart = reads.snapshots.length;
    let releaseSnapshot!: () => void;
    const snapshotHeld = new Promise<void>(resolve => { releaseSnapshot = resolve; });
    const holdProjects = async (route: Route) => {
      if (requestedCollections(route.request())?.includes('projects')) await snapshotHeld;
      await route.fallback();
    };
    await clientBPage.route(SNAPSHOT_ROUTE, holdProjects);
    await renameProject(project.name, 'Confirmed active client change');
    await expect.poll(() => reads.snapshots.length).toBe(activeStart + 1);
    await expect(clientBPage.getByRole('heading', { name: project.name, exact: true })).toBeVisible();
    await expect(clientBPage.getByRole('heading', { name: 'Confirmed active client change', exact: true })).toHaveCount(0);
    releaseSnapshot();
    await expect(clientBPage.getByRole('heading', { name: 'Confirmed active client change', exact: true })).toBeVisible();
    await clientBPage.unroute(SNAPSHOT_ROUTE, holdProjects);
    expectOnlyProjectReads(activeStart);
    await clientBPage.screenshot({ path: testInfo.outputPath('two-client-active-confirmed.png') });

    // The Projects cache remains visited but stops requiring network reads while Finance is active.
    await navigate(clientBPage, 'finance');
    await expectSurfaceData(clientBPage, 'finance');
    const inactiveStart = reads.snapshots.length;
    const broadcastsBeforeInactive = clientB.getDeliveredBroadcastCount();
    await renameProject('Confirmed active client change', 'Confirmed inactive client change');
    await expect.poll(() => clientB.getDeliveredBroadcastCount()).toBeGreaterThan(broadcastsBeforeInactive);
    await clientBPage.evaluate(() => new Promise<void>(resolve => requestAnimationFrame(() => requestAnimationFrame(() => resolve()))));
    expect(reads.snapshots).toHaveLength(inactiveStart);
    await expectSurfaceData(clientBPage, 'finance');
    await navigate(clientBPage, 'projects');
    await expect(clientBPage.getByRole('heading', { name: 'Confirmed inactive client change', exact: true })).toBeVisible();
    expectOnlyProjectReads(inactiveStart);

    // A missing event including a tombstone must be recovered by metadata on reconnect.
    const reconnectStart = reads.snapshots.length;
    const deltasBeforeReconnect = reads.deltas.length;
    clientB.setBroadcastDelivery(false);
    clientB.setRealtimeAvailable(false);
    await expect(clientBPage.getByTestId('sync-status-banner')).toContainText('Live updates delayed');
    await projectCard('Confirmed inactive client change').getByRole('button', { name: 'View details' }).click();
    await page.getByRole('dialog', { name: 'Confirmed inactive client change' }).getByRole('button', { name: 'Manage project' }).click();
    page.once('dialog', dialog => dialog.accept());
    const removed = waitForMutation(page, 'projects');
    await page.getByRole('button', { name: 'Remove', exact: true }).click();
    expect((await removed).ok()).toBe(true);
    await expect(page.getByRole('heading', { name: 'Confirmed inactive client change', exact: true })).toHaveCount(0);
    await expect(clientBPage.getByRole('heading', { name: 'Confirmed inactive client change', exact: true })).toBeVisible();
    clientB.setRealtimeAvailable(true);
    await clientBPage.clock.fastForward(31_000);
    await expect(clientBPage.getByTestId('sync-status-banner')).toHaveCount(0);
    await expect(clientBPage.getByRole('heading', { name: 'Confirmed inactive client change', exact: true })).toHaveCount(0);
    expect(reads.deltas.length).toBeGreaterThan(deltasBeforeReconnect);
    // Removing a project also removes its overview page; only those changed scopes are read.
    expectOnlyProjectReads(reconnectStart, ['projectPages', 'projects']);
    expect(reads.snapshots.every(read => read.collections !== undefined)).toBe(true);
    expect(reads.snapshots.flatMap(read => read.collections ?? []).filter(key => LIFE_LEGACY.includes(key))).toEqual([]);
    await clientBPage.screenshot({ path: testInfo.outputPath('two-client-reconnect-confirmed.png') });
    const evidencePath = testInfo.outputPath('two-client-selective-requests.json');
    await writeFile(evidencePath, JSON.stringify({
      environment: 'Two separate browser contexts with shared synthetic HTTPS state and private mocked WebSocket Broadcast; not live-account acceptance.',
      snapshots: reads.snapshots, deltaSinceVersions: reads.deltas, deliveredBroadcasts: clientB.getDeliveredBroadcastCount(),
    }, null, 2));
    await testInfo.attach('two-client-selective-requests', { path: evidencePath, contentType: 'application/json' });
  } finally {
    await clientBPage.close();
  }
});
