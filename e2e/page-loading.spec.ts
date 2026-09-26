import type { Page, Request, Route } from '@playwright/test';
import { writeFile } from 'node:fs/promises';
import { expect, test, waitForMutation } from './support/helm-fixture';
import type { HelmMutation } from '../src/store/databaseTypes';
import type { Surface, Trip } from '../src/types/domain';

const SNAPSHOT_ROUTE = '**/rest/v1/rpc/get_helm_account_snapshot*';
const UNRELATED = ['financeAccounts', 'transactions', 'financeBudgets', 'savingsGoals',
  'financeReviews', 'equityPositions', 'inventoryItems', 'inventoryNeeds', 'projects', 'projectPages'];
const timestamp = '2026-09-22T10:00:00.000Z';
const trip: Trip = {
  id: 'scoped-trip', name: 'Synthetic scoped trip', summary: 'A browser fixture trip.', notes: '',
  status: 'planning', startDate: '2026-10-01', endDate: '2026-10-03',
  budgetCurrency: 'GBP', budgetTotal: 0,
  createdAt: timestamp, updatedAt: timestamp,
};
const stores = {
  trips: [trip],
  healthFastFoodEntries: [{ id: 'scoped-health', venue: 'Synthetic scoped cafe', date: '2026-09-22',
    rating: 'mixed', symptoms: [], notes: 'A browser fixture entry.', createdAt: timestamp, updatedAt: timestamp }],
  // Deliberately non-empty inactive domains make an over-broad response observable.
  projects: [{ id: 'inactive-project', name: 'Inactive project' }],
  inventoryItems: [{ id: 'inactive-inventory', name: 'Inactive inventory' }],
  financeAccounts: [{ id: 'inactive-finance', name: 'Inactive finance' }],
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

async function expectSurfaceData(page: Page, surface: 'health' | 'trips') {
  await expect(page.getByRole('heading', {
    name: surface === 'health' ? 'Synthetic scoped cafe' : trip.name, exact: true,
  })).toBeVisible();
}

for (const width of [390, 768, 1440]) {
  test(`Health loads its scope and reuses confirmed navigation data at ${width}px`, async ({ page, scenario }, testInfo) => {
    await scenario({ initialSurface: 'health', stores });
    await page.setViewportSize({ width, height: 900 });
    await page.emulateMedia({ reducedMotion: 'reduce' });
    const reads = observeDataReads(page);
    await page.goto('/');
    await expectSurfaceData(page, 'health');
    expect(reads.snapshots.length).toBeGreaterThan(0);
    expect(reads.snapshots.every(read => read.collections !== undefined)).toBe(true);
    const coldCollections = reads.snapshots.flatMap(read => read.collections ?? []);
    expect(coldCollections).toContain('healthFastFoodEntries');
    expect(coldCollections.filter(key => [...UNRELATED, 'trips', 'tripBookings'].includes(key))).toEqual([]);
    expect(reads.pages).toHaveLength(0);
    expect(reads.mutations.filter(operation => [...UNRELATED, 'trips'].includes(operation.collection))).toEqual([]);
    await page.screenshot({ path: testInfo.outputPath(`health-confirmed-${width}.png`) });

    let releaseTrip!: () => void;
    const tripResponse = new Promise<void>(resolve => { releaseTrip = resolve; });
    await page.route(SNAPSHOT_ROUTE, async route => {
      if (requestedCollections(route.request())?.includes('trips')) await tripResponse;
      await route.fallback();
    });
    await navigate(page, 'trips');
    await expect(page.getByRole('status').filter({ hasText: 'Loading page data' })).toBeVisible();
    await expect(page.getByRole('button', { name: /Plan Trip/ })).toHaveCount(0);
    await page.screenshot({ path: testInfo.outputPath(`trips-loading-${width}.png`) });
    releaseTrip();
    await expectSurfaceData(page, 'trips');
    await page.screenshot({ path: testInfo.outputPath(`trips-confirmed-${width}.png`) });
    expect(reads.snapshots.some(read => read.collections?.includes('trips'))).toBe(true);
    const loadedReadCount = reads.snapshots.length;
    await navigate(page, 'health');
    await expectSurfaceData(page, 'health');
    await navigate(page, 'trips');
    await expectSurfaceData(page, 'trips');
    expect(reads.snapshots).toHaveLength(loadedReadCount);
    expect(await page.evaluate(() => document.documentElement.scrollWidth <= window.innerWidth)).toBe(true);
    await testInfo.attach('scoped-network-requests', { body: JSON.stringify(reads.snapshots), contentType: 'application/json' });
  });
}

test('Trips cold start excludes unrelated account domains', async ({ page, scenario }) => {
  await scenario({ initialSurface: 'trips', stores });
  const reads = observeDataReads(page);
  await page.goto('/');
  await expectSurfaceData(page, 'trips');
  expect(reads.snapshots.length).toBeGreaterThan(0);
  expect(reads.snapshots.every(read => read.collections !== undefined)).toBe(true);
  const collections = reads.snapshots.flatMap(read => read.collections ?? []);
  expect(collections).toContain('trips');
  expect(collections.filter(key => [...UNRELATED, 'healthFastFoodEntries'].includes(key))).toEqual([]);
  expect(reads.pages).toHaveLength(0);
  expect(reads.mutations.filter(operation => [...UNRELATED, 'healthFastFoodEntries'].includes(operation.collection))).toEqual([]);
});

test('failed page loads cannot replace unloaded records and an explicit retry recovers', async ({ page, scenario }, testInfo) => {
  await scenario({ initialSurface: 'health', stores });
  await page.setViewportSize({ width: 390, height: 900 });
  await page.emulateMedia({ reducedMotion: 'reduce' });
  const reads = observeDataReads(page);
  await page.goto('/');
  await expectSurfaceData(page, 'health');
  const failTrip = async (route: Route) => {
    if (requestedCollections(route.request())?.includes('trips')
      && !await page.evaluate(() => Reflect.get(window, '__scopedRetryClicked') === true)) {
      await route.fulfill({ status: 503, json: { message: 'Synthetic trip scope unavailable.' } });
    } else await route.fallback();
  };
  await page.route(SNAPSHOT_ROUTE, failTrip);
  await navigate(page, 'trips');
  const error = page.getByRole('alert').filter({ hasText: 'This page could not load' });
  await expect(error).toBeVisible();
  await expect(page.getByRole('button', { name: /Plan Trip/ })).toHaveCount(0);
  expect(reads.mutations.filter(operation => ['trips', 'tripLegs', 'tripBookings', 'tripItineraryItems', 'tripBudgetEntries'].includes(operation.collection))).toEqual([]);
  await page.screenshot({ path: testInfo.outputPath('trips-failed-390.png') });
  const retry = page.getByRole('button', { name: 'Retry connection', exact: true });
  // Keep every scheduled retry failing until a real click reaches the banner.
  await retry.evaluate(element => element.addEventListener('click', () => {
    Reflect.set(window, '__scopedRetryClicked', true);
  }, { capture: true, once: true }));
  await retry.press('Enter');
  expect(await page.evaluate(() => Reflect.get(window, '__scopedRetryClicked'))).toBe(true);
  await expectSurfaceData(page, 'trips');
  await navigate(page, 'health');
  await writeFile(testInfo.outputPath('scope-recovery-requests.json'), JSON.stringify(reads, null, 2));
  await expectSurfaceData(page, 'health');
  expect(reads.mutations.filter(operation => ['trips', 'healthFastFoodEntries'].includes(operation.collection))).toEqual([]);
  await page.screenshot({ path: testInfo.outputPath('health-after-recovery-390.png') });
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
  const clientA = await scenario({ now: timestamp, initialSurface: 'health', stores });
  const clientBPage = await browser.newPage({ baseURL: testInfo.project.use.baseURL, viewport: { width: 1440, height: 900 } });
  try {
    const clientB = await clientA.addClient(clientBPage);
    const reads = observeDataReads(clientBPage);
    await page.goto('/');
    await clientBPage.goto('/');
    await expectSurfaceData(page, 'health');
    await expectSurfaceData(clientBPage, 'health');
    const editHealth = async (oldName: string, newName: string) => {
      await page.getByRole('article').filter({ has: page.getByRole('heading', { name: oldName, exact: true }) })
        .getByRole('button', { name: 'Edit', exact: true }).click();
      await page.getByRole('textbox', { name: 'Where did you eat?' }).fill(newName);
      const confirmed = waitForMutation(page, 'healthFastFoodEntries');
      await page.getByRole('button', { name: 'Update log', exact: true }).click();
      expect((await confirmed).ok()).toBe(true);
      await expect(page.getByRole('heading', { name: newName, exact: true })).toBeVisible();
    };
    const expectOnlyHealthReads = (start: number) => {
      const added = reads.snapshots.slice(start);
      expect(added).toHaveLength(1);
      expect(added[0].collections).toEqual(['healthFastFoodEntries']);
      expect(reads.pages).toHaveLength(0);
    };

    // Hold B's authoritative response to prove a Broadcast payload cannot publish data.
    const activeStart = reads.snapshots.length;
    let releaseSnapshot!: () => void;
    const snapshotHeld = new Promise<void>(resolve => { releaseSnapshot = resolve; });
    const holdHealth = async (route: Route) => {
      if (requestedCollections(route.request())?.includes('healthFastFoodEntries')) await snapshotHeld;
      await route.fallback();
    };
    await clientBPage.route(SNAPSHOT_ROUTE, holdHealth);
    await editHealth('Synthetic scoped cafe', 'Confirmed active client change');
    await expect.poll(() => reads.snapshots.length).toBe(activeStart + 1);
    await expect(clientBPage.getByRole('heading', { name: 'Synthetic scoped cafe', exact: true })).toBeVisible();
    await expect(clientBPage.getByRole('heading', { name: 'Confirmed active client change', exact: true })).toHaveCount(0);
    releaseSnapshot();
    await expect(clientBPage.getByRole('heading', { name: 'Confirmed active client change', exact: true })).toBeVisible();
    await clientBPage.unroute(SNAPSHOT_ROUTE, holdHealth);
    expectOnlyHealthReads(activeStart);
    await clientBPage.screenshot({ path: testInfo.outputPath('two-client-active-confirmed.png') });

    // The Health cache remains visited but stops requiring network reads while Trips is active.
    await navigate(clientBPage, 'trips');
    await expectSurfaceData(clientBPage, 'trips');
    const inactiveStart = reads.snapshots.length;
    const broadcastsBeforeInactive = clientB.getDeliveredBroadcastCount();
    await editHealth('Confirmed active client change', 'Confirmed inactive client change');
    await expect.poll(() => clientB.getDeliveredBroadcastCount()).toBeGreaterThan(broadcastsBeforeInactive);
    await clientBPage.evaluate(() => new Promise<void>(resolve => requestAnimationFrame(() => requestAnimationFrame(() => resolve()))));
    expect(reads.snapshots).toHaveLength(inactiveStart);
    await expectSurfaceData(clientBPage, 'trips');
    await navigate(clientBPage, 'health');
    await expect(clientBPage.getByRole('heading', { name: 'Confirmed inactive client change', exact: true })).toBeVisible();
    expectOnlyHealthReads(inactiveStart);

    // A missing event including a tombstone must be recovered by metadata on reconnect.
    const reconnectStart = reads.snapshots.length;
    const deltasBeforeReconnect = reads.deltas.length;
    clientB.setBroadcastDelivery(false);
    clientB.setRealtimeAvailable(false);
    await expect(clientBPage.getByTestId('sync-status-banner')).toContainText('Live updates delayed');
    page.once('dialog', dialog => dialog.accept());
    const removed = waitForMutation(page, 'healthFastFoodEntries');
    await page.getByRole('article').filter({ has: page.getByRole('heading', { name: 'Confirmed inactive client change', exact: true }) })
      .getByRole('button', { name: 'Remove', exact: true }).click();
    expect((await removed).ok()).toBe(true);
    await expect(page.getByRole('heading', { name: 'Confirmed inactive client change', exact: true })).toHaveCount(0);
    await expect(clientBPage.getByRole('heading', { name: 'Confirmed inactive client change', exact: true })).toBeVisible();
    clientB.setRealtimeAvailable(true);
    await clientBPage.clock.fastForward(31_000);
    await expect(clientBPage.getByTestId('sync-status-banner')).toHaveCount(0);
    await expect(clientBPage.getByRole('heading', { name: 'Confirmed inactive client change', exact: true })).toHaveCount(0);
    expect(reads.deltas.length).toBeGreaterThan(deltasBeforeReconnect);
    expectOnlyHealthReads(reconnectStart);
    expect(reads.snapshots.every(read => read.collections !== undefined)).toBe(true);
    expect(reads.snapshots.flatMap(read => read.collections ?? []).filter(key => UNRELATED.includes(key))).toEqual([]);
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
