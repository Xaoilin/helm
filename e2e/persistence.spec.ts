import type { Page } from '@playwright/test';
import { writeFile } from 'node:fs/promises';
import type { EquityPosition } from '../src/types/domain';
import { FINANCE_REVIEW } from '../src/test/finance-review-fixture';
import { expect, openApp, test, waitForMutation } from './support/helm-fixture';

const TASK = {
  id: 'task-review-notes',
  title: 'Review notes',
  description: 'Close the loop on today’s notes.',
  completed: false,
  priority: 'medium',
  category: 'task',
  dueDate: '2026-08-29',
  createdAt: '2026-08-29T08:00:00.000Z',
  updatedAt: '2026-08-29T08:00:00.000Z',
};

const EQUITY: EquityPosition = {
  id: 'synthetic-equity', company: 'Example Co', asOf: '2026-09-21', ownedShares: 120,
  stockPlan: { summary: 'Review owned shares.', status: 'tentative', waitingFor: 'A decision.', nextAction: 'Review the plan.' },
  optionPlan: { summary: 'Review options.', status: 'undecided', waitingFor: 'Grant terms.', nextAction: 'Read the terms.' },
  employmentNote: 'Synthetic test position.', grants: [], actions: [], details: [], sources: [],
  scenario: { pricesUsd: [50], withholdingRate: 0.5, usdToGbp: 0.8, asOf: '2026-09-21', notes: 'Synthetic assumptions.' },
  createdAt: FINANCE_REVIEW.createdAt, updatedAt: FINANCE_REVIEW.updatedAt,
};

test('keeps saved Finance data, drafts and confirmed writes usable without Realtime and reconciles missed changes', async ({ page, scenario }, testInfo) => {
  await page.setViewportSize({ width: 1440, height: 900 });
  await page.emulateMedia({ reducedMotion: 'reduce' });
  const control = await scenario({
    now: FINANCE_REVIEW.updatedAt,
    stores: { tasks: [TASK], financeReviews: [FINANCE_REVIEW], equityPositions: [EQUITY] },
  });
  await openApp(page);
  await page.getByRole('button', { name: 'Navigate to Finance' }).click();
  const budget = page.getByRole('region', { name: 'Monthly available amount' });
  const stocks = page.getByRole('region', { name: 'Example Co Stocks' });
  await expect(budget).toContainText('£1,750.00 / month');
  await expect(stocks).toContainText('120 owned shares');
  await page.getByRole('button', { name: 'Edit Example Co' }).click();
  const editor = page.getByRole('dialog', { name: 'Edit equity' });
  await editor.getByLabel('Company', { exact: true }).fill('Unsaved example draft');

  control.setRealtimeAvailable(false);
  const banner = page.getByTestId('sync-status-banner');
  await expect(banner).toContainText('Live updates delayed');
  await expect(banner).toContainText('Your saved data remains available. Checking for changes automatically.');
  await expect(editor.getByLabel('Company', { exact: true })).toHaveValue('Unsaved example draft');
  await expect(editor.getByRole('button', { name: 'Save equity' })).toBeEnabled();
  page.once('dialog', prompt => { void prompt.accept(); });
  await editor.getByRole('button', { name: 'Cancel', exact: true }).click();
  await expect(editor).toHaveCount(0);
  await expect(budget).toContainText('£1,750.00 / month');
  await expect(stocks).toContainText('120 owned shares');

  const evidence = [];
  for (const width of [390, 768, 1440]) {
    await page.setViewportSize({ width, height: 900 });
    await page.locator('.main-content').evaluate(element => element.scrollTo(0, 0));
    await expect(banner).toBeVisible();
    const bannerBox = await banner.boundingBox();
    const headingBox = await page.getByRole('heading', { name: 'Finance', exact: true }).boundingBox();
    const headingOverlap = Math.max(0, Math.min(bannerBox!.x + bannerBox!.width, headingBox!.x + headingBox!.width) - Math.max(bannerBox!.x, headingBox!.x))
      * Math.max(0, Math.min(bannerBox!.y + bannerBox!.height, headingBox!.y + headingBox!.height) - Math.max(bannerBox!.y, headingBox!.y));
    expect(headingOverlap, `Status banner must not obscure the Finance heading at ${width}px`).toBe(0);
    const dimensions = await page.evaluate(() => ({
      client: document.documentElement.clientWidth, scroll: document.documentElement.scrollWidth,
      containers: [...document.querySelectorAll('.sync-status-banner, .main-content, .banking-review, .equity-position')]
        .filter(element => element.getClientRects().length > 0)
        .map(element => ({ name: element.className, client: element.clientWidth, scroll: element.scrollWidth })),
    }));
    expect(dimensions.scroll).toBe(dimensions.client);
    for (const container of dimensions.containers) expect(container.scroll, container.name).toBeLessThanOrEqual(container.client + 1);
    await page.screenshot({ path: testInfo.outputPath(`synthetic-realtime-delayed-finance-${width}.png`) });
    let scrolling;
    if (width === 390) {
      const scroller = page.locator('.main-content');
      const size = await scroller.evaluate(element => ({ client: element.clientHeight, scroll: element.scrollHeight }));
      expect(size.scroll).toBeGreaterThan(size.client);
      const before = await budget.boundingBox();
      await scroller.hover();
      await page.mouse.wheel(0, 400);
      await expect.poll(() => scroller.evaluate(element => element.scrollTop)).toBeGreaterThan(0);
      const after = await budget.boundingBox();
      expect(after!.y).toBeLessThan(before!.y);
      await scroller.evaluate(element => { element.scrollTop = 0; });
      await scroller.focus();
      await page.keyboard.press('PageDown');
      await expect.poll(() => scroller.evaluate(element => element.scrollTop)).toBeGreaterThan(0);
      scrolling = { ...size, beforeY: before!.y, afterY: after!.y, keyboardOffset: await scroller.evaluate(element => element.scrollTop) };
      await scroller.evaluate(element => { element.scrollTop = 0; });
    }
    const stocksTab = page.getByRole('button', { name: 'Stocks', exact: true });
    await stocksTab.focus();
    await stocksTab.press('Enter');
    await expect(stocks).toContainText('120 owned shares');
    await page.locator('.main-content').evaluate(element => element.scrollTo(0, 0));
    await page.screenshot({ path: testInfo.outputPath(`synthetic-realtime-delayed-equity-${width}.png`) });
    await page.getByRole('button', { name: 'Overview', exact: true }).click();
    evidence.push({ width, headingOverlap, ...dimensions, scrolling });
  }

  let taskMutationCount = 0;
  page.on('request', request => {
    if (request.url().includes('/rpc/apply_helm_mutations')
      && request.postDataJSON().p_operations?.some((operation: { collection: string }) => operation.collection === 'tasks')) {
      taskMutationCount += 1;
    }
  });
  await page.getByRole('button', { name: 'Navigate to Tasks' }).click();
  const taskWrite = waitForMutation(page, 'tasks');
  await page.getByRole('checkbox', { name: 'Mark "Review notes" as complete' }).click();
  expect((await taskWrite).ok()).toBe(true);
  await expect(page.getByRole('checkbox', { name: 'Mark "Review notes" as incomplete' })).toBeChecked();
  expect(taskMutationCount).toBe(1);

  control.applyRemoteMutations([{ op: 'patch', collection: 'tasks', recordId: TASK.id, set: { title: 'Remote update without Broadcast' } }]);
  await page.clock.fastForward(10 * 60_000);
  await expect(page.getByRole('checkbox', { name: 'Mark "Remote update without Broadcast" as incomplete' })).toBeChecked();
  await expect(banner).toContainText('Live updates delayed');
  expect(taskMutationCount).toBe(1);

  control.applyRemoteMutations([{ op: 'patch', collection: 'tasks', recordId: TASK.id, set: { title: 'Remote update on foreground' } }]);
  await page.evaluate(() => document.dispatchEvent(new Event('visibilitychange')));
  await expect(page.getByRole('checkbox', { name: 'Mark "Remote update on foreground" as incomplete' })).toBeChecked();
  expect(taskMutationCount).toBe(1);
  const evidencePath = testInfo.outputPath('synthetic-availability-evidence.json');
  await writeFile(evidencePath, JSON.stringify({
    environment: 'Synthetic Playwright account and mocked HTTPS/WebSocket services; not live-account acceptance.',
    taskMutationCount, missedChangesReconciledBy: ['ten-minute version safety check', 'foreground visibility event'], dimensions: evidence,
  }, null, 2));
  await testInfo.attach('synthetic-availability-evidence', { path: evidencePath, contentType: 'application/json' });
});

test('keeps navigation usable during a stalled Employment seed and isolates its rejection from task writes', async ({ page, scenario }) => {
  await scenario({ now: FINANCE_REVIEW.updatedAt, stores: { tasks: [TASK] } });
  let rejectSeed = true;
  let releaseSeed = () => {};
  const seedReleased = new Promise<void>(resolve => { releaseSeed = resolve; });
  await page.route('**/rest/v1/rpc/apply_helm_mutations*', async route => {
    const operations = route.request().postDataJSON().p_operations as Array<{ collection: string }>;
    if (!rejectSeed || !operations.some(operation => operation.collection === 'employment')) {
      await route.fallback();
      return;
    }
    await seedReleased;
    await route.fulfill({ status: 400, json: { message: 'Employment seed fixture rejected.' } });
  });
  const seedRequest = page.waitForRequest(request => request.url().includes('/rpc/apply_helm_mutations')
    && request.postDataJSON().p_operations?.some((operation: { collection: string }) => operation.collection === 'employment'));
  await openApp(page);
  await page.getByRole('button', { name: 'Navigate to Employment' }).click();
  await seedRequest;
  await page.getByRole('button', { name: 'Navigate to Tasks' }).click();
  await expect(page.getByRole('checkbox', { name: 'Mark "Review notes" as complete' })).toBeVisible();
  await page.getByRole('button', { name: 'Navigate to Employment' }).click();
  await expect(page.getByText('Loading your applications…')).toBeVisible();
  const seedResponse = waitForMutation(page, 'employment');
  releaseSeed();
  expect((await seedResponse).status()).toBe(400);
  await expect(page.getByRole('alert')).toContainText('Employment data needs attention:');
  await page.getByRole('button', { name: 'Navigate to Tasks' }).click();
  const taskWrite = waitForMutation(page, 'tasks');
  await page.getByRole('checkbox', { name: 'Mark "Review notes" as complete' }).click();
  expect((await taskWrite).ok()).toBe(true);
  await expect(page.getByRole('checkbox', { name: 'Mark "Review notes" as incomplete' })).toBeChecked();
  await expect(page.getByTestId('sync-status-banner')).toHaveCount(0);

  rejectSeed = false;
  await page.getByRole('button', { name: 'Navigate to Employment' }).click();
  const seedRetry = waitForMutation(page, 'employment');
  await page.getByRole('button', { name: 'Retry loading', exact: true }).click();
  expect((await seedRetry).ok()).toBe(true);
  await expect(page.getByRole('alert')).toHaveCount(0);
  await expect(page.getByText('Loading your applications…')).toHaveCount(0);
});

test('persists one shared task mutation through reload', async ({ page, scenario }) => {
  await scenario({
    now: '2026-08-29T11:00:00.000Z',
    stores: { tasks: [TASK] },
  });
  await openApp(page);
  await page.getByRole('button', { name: 'Navigate to Tasks' }).click();

  const checkbox = page.getByRole('checkbox', { name: 'Mark "Review notes" as complete' });
  await expect(checkbox).toBeVisible();

  const taskWrite = waitForMutation(page, 'tasks');
  await checkbox.click();
  await expect(page.getByRole('checkbox', { name: 'Mark "Review notes" as incomplete' })).toBeChecked();
  await taskWrite;

  await page.reload();
  await expect(page.getByRole('navigation', { name: 'Main navigation' })).toBeVisible();
  await expect(page.getByRole('heading', { name: 'Tasks', exact: true })).toBeVisible();
  await expect(page.getByRole('checkbox', { name: 'Mark "Review notes" as incomplete' })).toBeChecked();
});

test('persists an account setting through reload', async ({ page, scenario }) => {
  await scenario({ now: '2026-08-29T11:00:00.000Z' });
  await openApp(page);
  await page.getByRole('button', { name: 'Navigate to Settings' }).click();

  const theme = page.getByLabel('Theme');
  await expect(theme).toHaveValue('dark');

  const settingsWrite = waitForMutation(page, 'settings');
  await theme.selectOption('light');
  await settingsWrite;
  await expect(page.getByText('Light theme is not yet available.')).toBeVisible();

  await page.reload();
  await expect(page.getByRole('navigation', { name: 'Main navigation' })).toBeVisible();
  await expect(page.getByRole('heading', { name: 'Settings', exact: true })).toBeVisible();
  await expect(page.getByLabel('Theme')).toHaveValue('light');
  await expect(page.getByText('Light theme is not yet available.')).toBeVisible();
});

function waitForProfileSave(page: Page, timeZone: string | null) {
  return page.waitForRequest(request => request.method() === 'PUT'
    && request.url().endsWith('/api/profile/v1/settings')
    && (request.postDataJSON() as { timeZone: string | null }).timeZone === timeZone);
}

test('validates, persists, reloads, and resets the account app time zone', async ({ page, scenario }) => {
  await scenario({
    now: '2026-08-29T11:00:00.000Z',
    prayer: { timezone: 'Europe/London' },
    settings: { prayerEnabled: true },
  });
  await openApp(page);
  await page.getByRole('button', { name: 'Navigate to Settings' }).click();

  const timeZone = page.getByLabel('IANA time zone');
  await timeZone.fill('Not/AZone');
  await page.getByRole('button', { name: 'Save time zone' }).click();
  await expect(page.locator('#settings-app-time-zone-status')).toContainText(
    'Enter a valid IANA time zone',
  );

  await timeZone.fill('America/New_York');
  // The display time zone is owned by the profile service.
  const preferredWrite = waitForProfileSave(page, 'America/New_York');
  await page.getByRole('button', { name: 'Save time zone' }).click();
  await preferredWrite;
  await expect(page.getByText('Saved America/New_York to your account.')).toBeVisible();
  await expect(page.getByText('Effective zone: America/New_York')).toBeVisible();
  await expect(page.getByText(
    'Prayer times remain on Europe/London; app time uses America/New_York.',
  )).toBeVisible();

  await page.reload();
  await expect(page.getByRole('heading', { name: 'Settings', exact: true })).toBeVisible();
  await expect(page.getByLabel('IANA time zone')).toHaveValue('America/New_York');
  await expect(page.getByText('Effective zone: America/New_York')).toBeVisible();

  await page.getByRole('button', { name: 'Navigate to Dashboard' }).click();
  await expect(page.getByText(
    'Prayer schedule: Europe/London · App time: America/New_York',
  )).toBeVisible();
  await page.getByRole('button', { name: 'Navigate to Settings' }).click();

  const automaticWrite = waitForProfileSave(page, null);
  await page.getByRole('button', { name: 'Use Automatic' }).click();
  await automaticWrite;
  await expect(page.getByLabel('IANA time zone')).toHaveValue('');
  await expect(page.getByText(/Automatic restored/)).toBeVisible();

  await page.reload();
  await expect(page.getByRole('heading', { name: 'Settings', exact: true })).toBeVisible();
  await expect(page.getByLabel('IANA time zone')).toHaveValue('');
  await expect(page.getByText('Automatic', { exact: true })).toBeVisible();
});
