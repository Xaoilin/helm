import type { Page, Request, Route } from '@playwright/test';
import { writeFile } from 'node:fs/promises';
import { expect, test } from './support/helm-fixture';
import type { HelmMutation } from '../src/store/databaseTypes';
import type { AssistantActivityEntry, Surface, Trip } from '../src/types/domain';

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
  page.on('request', request => {
    const url = new URL(request.url());
    if (url.pathname.includes('/get_helm_account_snapshot')) {
      snapshots.push({ url: url.pathname, collections: requestedCollections(request) });
    } else if (url.pathname.endsWith('/helm_records')) {
      pages.push(url);
    } else if (url.pathname.endsWith('/apply_helm_mutations')) {
      mutations.push(...((request.postDataJSON() as { p_operations?: HelmMutation[] }).p_operations ?? []));
    }
  });
  return { snapshots, pages, mutations };
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

test('Activity fetches only one bounded page until more is requested', async ({ page, scenario }, testInfo) => {
  const activity: AssistantActivityEntry[] = Array.from({ length: 120 }, (_, index) => ({
    id: `activity-${String(index + 1).padStart(3, '0')}`, actor: 'system', domain: 'assistant',
    action: 'recorded', summary: `Synthetic action ${String(index + 1).padStart(3, '0')}`,
    details: [], entityRefs: [], status: 'applied', createdAt: timestamp,
  }));
  const control = await scenario({ initialSurface: 'activity', stores });
  // Real assistant prepends can leave many rows at position zero. Server time,
  // rather than those tied positions or IDs, must choose the newest page.
  control.applyRemoteMutations(activity.map(entry => ({
    op: 'create', collection: 'assistantActivityLog', recordId: entry.id,
    payload: { ...entry }, position: 0,
  })), timestamp);
  // A tombstone and unrelated records must not consume page capacity.
  control.applyRemoteMutations([{ op: 'delete', collection: 'assistantActivityLog', recordId: activity[9].id }]);
  const newest = { ...activity[0], id: 'zz-newest-action', summary: 'Synthetic newest action', createdAt: '2026-09-22T11:00:00.000Z' };
  control.applyRemoteMutations([{ op: 'create', collection: 'assistantActivityLog', recordId: newest.id,
    payload: newest, position: 0 }], newest.createdAt);
  const reads = observeDataReads(page);
  await page.setViewportSize({ width: 390, height: 900 });
  await page.goto('/');
  const entries = page.locator('.activity-entry');
  await expect(entries).toHaveCount(50);
  await expect(entries.first().getByRole('heading')).toHaveText(newest.summary);
  await expect(page.getByRole('heading', { name: 'Synthetic action 010', exact: true })).toHaveCount(0);
  await expect(page.getByRole('heading', { name: 'Synthetic action 052', exact: true })).toHaveCount(0);
  expect(reads.snapshots.flatMap(read => read.collections ?? [])).not.toContain('assistantActivityLog');
  expect(reads.pages).toHaveLength(1);
  const first = reads.pages[0].searchParams;
  expect(first.get('collection')).toBe('eq.assistantActivityLog');
  expect(first.get('user_id')).toBe('eq.11111111-1111-4111-8111-111111111111');
  expect(first.get('deleted_at')).toBe('is.null');
  expect(first.get('order')).toBe('created_at.desc,record_id.asc');
  expect(first.get('offset')).toBe('0');
  expect(first.get('limit')).toBe('51');
  const scroller = page.getByRole('main', { name: 'activity surface', exact: true });
  const heading = entries.first().getByRole('heading');
  const before = await heading.boundingBox();
  await scroller.hover();
  await page.mouse.wheel(0, 500);
  await expect.poll(() => scroller.evaluate(element => element.scrollTop)).toBeGreaterThan(0);
  const after = await heading.boundingBox();
  expect(after!.y).toBeLessThan(before!.y);
  const wheelScrollTop = await scroller.evaluate(element => element.scrollTop);
  await scroller.focus();
  await page.keyboard.press('PageDown');
  await expect.poll(() => scroller.evaluate(element => element.scrollTop)).toBeGreaterThan(wheelScrollTop);
  const keyboardScrollTop = await scroller.evaluate(element => element.scrollTop);
  const more = page.getByRole('button', { name: 'Load more activity', exact: true });
  await more.focus();
  await expect(more).toBeInViewport();
  await page.screenshot({ path: testInfo.outputPath('activity-first-page-390.png') });
  await page.keyboard.press('Enter');
  await expect(entries).toHaveCount(100);
  expect(reads.pages).toHaveLength(2);
  expect(reads.pages[1].searchParams.get('offset')).toBe('50');
  await more.click();
  await expect(entries).toHaveCount(120);
  await expect(more).toHaveCount(0);
  expect(reads.pages).toHaveLength(3);
  expect(reads.pages[2].searchParams.get('offset')).toBe('100');
  expect(await page.locator('.activity-entry h3').allTextContents()).toEqual([newest.summary, ...activity.filter((_, index) => index !== 9).map(entry => entry.summary)]);
  await writeFile(testInfo.outputPath('activity-page-evidence.json'), JSON.stringify({
    requests: reads.pages.map(url => url.pathname + url.search),
    viewport: { width: 390, height: 900 }, wheelScrollTop, keyboardScrollTop,
    beforeHeadingY: before!.y, afterHeadingY: after!.y,
    scroller: await scroller.evaluate(element => ({ clientHeight: element.clientHeight, scrollHeight: element.scrollHeight, scrollTop: element.scrollTop })),
  }, null, 2));
  for (const width of [768, 1440]) {
    await page.setViewportSize({ width, height: 900 });
    await page.getByRole('heading', { name: 'Activity', exact: true }).scrollIntoViewIfNeeded();
    await page.screenshot({ path: testInfo.outputPath(`activity-confirmed-${width}.png`) });
    expect(await page.evaluate(() => document.documentElement.scrollWidth <= window.innerWidth)).toBe(true);
  }
  await testInfo.attach('activity-page-requests', { body: JSON.stringify(reads.pages.map(url => url.pathname + url.search)), contentType: 'application/json' });
});
