import { expect, installScenario, openApp, test } from './support/helm-fixture';
import { installFakeServices } from './support/fake-services';

test('display choices follow the same account in a fresh browser context', async ({ browser, page, scenario }) => {
  const control = await scenario({ now: '2026-11-05T12:00:00Z', settings: { prayerEnabled: true } });
  await openApp(page);
  const challenge = page.getByRole('region', { name: 'Prayer challenge' });
  await challenge.getByRole('button', { name: 'Day', exact: true }).click();
  await expect(challenge.getByRole('button', { name: 'Day', exact: true })).toHaveAttribute('aria-pressed', 'true');
  const learn = page.getByRole('region', { name: 'Learn', exact: true });
  await learn.getByRole('switch', { name: 'Add individual steps' }).click();
  await expect(learn.getByRole('switch')).toBeChecked();
  expect(control.services.viewPreferences).toMatchObject({ 'prayerChallenge.period': 'day', 'dashboard.learnIndividualSteps': 'true' });

  const device = await browser.newContext({ viewport: { width: 390, height: 900 } });
  try {
    const other = await device.newPage();
    await installScenario(other, { now: '2026-11-05T12:00:00Z', settings: { prayerEnabled: true } });
    await installFakeServices(other, control.services);
    await openApp(other);
    const otherChallenge = other.getByRole('region', { name: 'Prayer challenge' });
    await expect(otherChallenge.getByRole('button', { name: 'Day', exact: true })).toHaveAttribute('aria-pressed', 'true');
    await expect(other.getByRole('region', { name: 'Learn', exact: true }).getByRole('switch')).toBeChecked();
    await otherChallenge.getByRole('button', { name: 'Week', exact: true }).click();
    await expect(otherChallenge.getByRole('button', { name: 'Week', exact: true })).toHaveAttribute('aria-pressed', 'true');
    await page.evaluate(() => document.dispatchEvent(new Event('visibilitychange')));
    await expect(challenge.getByRole('button', { name: 'Week', exact: true })).toHaveAttribute('aria-pressed', 'true');
    expect(control.services.viewPreferences['dashboard.learnIndividualSteps']).toBe('true');
    await page.reload();
    await expect(challenge.getByRole('button', { name: 'Week', exact: true })).toHaveAttribute('aria-pressed', 'true');
  } finally { await device.close(); }
});

test('a failed display choice preserves the confirmed view and can be retried', async ({ page, scenario }, testInfo) => {
  await scenario({ now: '2026-11-05T12:00:00Z', settings: { prayerEnabled: true }, services: { viewPreferences: { 'prayerChallenge.period': 'week' } } });
  await page.route('**/api/profile/v1/view-preferences/prayerChallenge.period', route => route.fulfill({
    status: 400, json: { code: 'save_refused', message: 'Your display choice was not saved. Please retry.' },
  }));
  await openApp(page);
  const challenge = page.getByRole('region', { name: 'Prayer challenge' });
  const day = challenge.getByRole('button', { name: 'Day', exact: true });
  await day.focus(); await page.keyboard.press('Space');
  await expect(page.getByRole('alert')).toContainText('not saved');
  await expect(challenge.getByRole('button', { name: 'Week', exact: true })).toHaveAttribute('aria-pressed', 'true');
  await expect(day).toBeFocused();
  await page.screenshot({ path: testInfo.outputPath('preference-save-error.png') });
  await page.unroute('**/api/profile/v1/view-preferences/prayerChallenge.period');
  await page.getByRole('button', { name: 'Retry preferences', exact: true }).click();
  await expect(day).toHaveAttribute('aria-pressed', 'true');
  await expect(page.getByRole('alert')).toHaveCount(0);
});

test('calendar and Settings use one saved view, and task filters survive a revisit', async ({ page, scenario }) => {
  await scenario({ stores: { tasks: [{ id: 'a1000000-0000-4000-8000-000000000001', title: 'Preference fixture task' }] } }); await openApp(page);
  await page.getByRole('button', { name: 'Navigate to Calendar', exact: true }).click();
  await page.getByRole('button', { name: 'Month', exact: true }).click();
  await expect(page.getByRole('button', { name: 'Month', exact: true })).toHaveClass(/active/);
  await page.getByRole('button', { name: 'Navigate to Settings', exact: true }).click();
  await expect(page.getByLabel('Default calendar view')).toHaveValue('month');
  await page.getByLabel('Default calendar view').selectOption('agenda');
  await expect(page.getByLabel('Default calendar view')).toHaveValue('agenda');
  await page.getByRole('button', { name: 'Navigate to Calendar', exact: true }).click();
  await expect(page.getByRole('button', { name: 'Agenda', exact: true })).toHaveClass(/active/);
  await page.getByRole('button', { name: 'Navigate to Tasks', exact: true }).click();
  await page.getByRole('button', { name: 'All Tasks', exact: true }).click();
  await page.getByRole('combobox', { name: 'Priority', exact: true }).selectOption('high');
  await expect(page.getByRole('combobox', { name: 'Priority', exact: true })).toHaveValue('high');
  await page.reload();
  await expect(page.getByRole('button', { name: 'All Tasks', exact: true })).toHaveClass(/active/);
  await expect(page.getByRole('combobox', { name: 'Priority', exact: true })).toHaveValue('high');
});

test('rapid filter changes preserve each pending choice independently', async ({ page, scenario }) => {
  const control = await scenario({ initialSurface: 'tasks', services: { viewPreferences: { 'tasks.tab': 'all' } } });
  let release!: () => void;
  const held = new Promise<void>(resolve => { release = resolve; });
  await page.route('**/api/profile/v1/view-preferences/tasks.category', async route => {
    await held; await route.fallback();
  });
  await page.goto('/');
  await expect(page.getByRole('main', { name: 'tasks surface', exact: true })).toBeVisible();
  const category = page.getByRole('combobox', { name: 'Type', exact: true });
  const priority = page.getByRole('combobox', { name: 'Priority', exact: true });
  const status = page.getByRole('combobox', { name: 'Status', exact: true });
  await category.selectOption('daily');
  await priority.selectOption('high');
  await status.selectOption('active');
  release();
  await expect(category).toHaveValue('daily');
  await expect(priority).toHaveValue('high');
  await expect(status).toHaveValue('active');
  expect(control.services.viewPreferences).toMatchObject({ 'tasks.category': 'daily', 'tasks.priority': 'high', 'tasks.status': 'active' });
});

test('Sabah-specific tabs and static filters restore from the account across active surfaces', async ({ page, scenario }) => {
  const preferences = {
    'finance.tab': 'transactions', 'finance.filterType': 'transfer',
    'inventory.view': 'needed', 'inventory.category': 'tool',
    'knowledge.tab': 'search', 'knowledge.searchSourceFilter': 'scholarly',
    'employment.activeOnly': 'false', 'employment.showFilters': 'true', 'employment.status': 'offer',
    'employment.workType': 'contract', 'employment.remoteStatus': 'confirmed',
    'activity.rangeDays': '90', 'activity.kind': 'error', 'activity.surface': 'calendar', 'activity.outcome': 'failure',
    'projects.tab': 'board', 'trips.tab': 'budget', 'debug.tab': 'operations',
  };
  const control = await scenario({ initialSurface: 'finance', services: { viewPreferences: preferences }, stores: {
    projects: [{ id: 'pref-project', name: 'Preference project', catalogKey: 'custom:pref-project', summary: '',
      kind: 'web_app', status: 'active', tags: [], isPinned: false, links: [], setupSteps: [], runRecipes: [],
      createdAt: '2026-11-05T12:00:00Z', updatedAt: '2026-11-05T12:00:00Z' }],
    trips: [{ id: 'pref-trip', name: 'Preference trip', summary: '', notes: '', status: 'planning',
      startDate: '2026-11-05', endDate: '2026-11-07', budgetCurrency: 'GBP', budgetTotal: 0, createdAt: '2026-11-05T12:00:00Z', updatedAt: '2026-11-05T12:00:00Z' }],
  } });
  await page.goto('/');
  await expect(page.getByRole('button', { name: 'Transactions', exact: true })).toHaveClass(/active/);
  await expect(page.getByRole('button', { name: 'Transfer', exact: true })).toHaveClass(/btn-primary/);
  const navigate = async (name: string) => {
    await page.getByRole('button', { name: `Navigate to ${name}`, exact: true }).click();
  };
  await navigate('Inventory');
  await expect(page.getByRole('tab', { name: 'Needed', exact: true })).toHaveAttribute('aria-selected', 'true');
  await expect(page.getByRole('combobox', { name: 'Filter inventory category' })).toHaveValue('tool');
  await navigate('Knowledge');
  await expect(page.getByRole('button', { name: 'Search', exact: true })).toHaveClass(/active/);
  await expect(page.getByRole('button', { name: 'Scholarly', exact: true })).toHaveClass(/btn-primary/);
  await navigate('Employment');
  await expect(page.getByRole('button', { name: 'All applications', exact: true })).toHaveAttribute('aria-pressed', 'true');
  await expect(page.getByRole('combobox', { name: 'Filter Employment status' })).toHaveValue('offer');
  await expect(page.getByRole('combobox', { name: 'Filter Employment work type' })).toHaveValue('contract');
  await expect(page.getByRole('combobox', { name: 'Filter Employment remote proof' })).toHaveValue('confirmed');
  await navigate('Activity');
  await expect(page.getByRole('combobox', { name: 'Usage time window' })).toHaveValue('90');
  await expect(page.getByRole('combobox', { name: 'Usage event type' })).toHaveValue('error');
  await expect(page.getByRole('combobox', { name: 'Usage surface' })).toHaveValue('calendar');
  await expect(page.getByRole('combobox', { name: 'Usage outcome' })).toHaveValue('failure');
  await navigate('Projects');
  await page.getByRole('button', { name: 'View details', exact: true }).click();
  await page.getByRole('button', { name: 'Manage project', exact: true }).click();
  await expect(page.getByRole('tab', { name: 'Board', exact: true })).toHaveAttribute('aria-selected', 'true');
  await navigate('Trips');
  await expect(page.getByRole('button', { name: 'Budget', exact: true })).toHaveClass(/active/);
  await navigate('Debug');
  await expect(page.getByRole('region', { name: 'Operational diagnostics', exact: true })).toBeVisible();
  // Viewing saved choices must never write defaults or overwrite sibling choices.
  expect(control.services.viewPreferences).toMatchObject(preferences);
  expect(control.services.calls.filter(call => call.startsWith('PUT /api/profile/v1/view-preferences/'))).toEqual([]);
});
