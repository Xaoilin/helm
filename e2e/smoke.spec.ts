import { expect, openApp, test, waitForMutation } from './support/helm-fixture';

const NOW = '2026-07-28T11:45:00.000Z';
const TODAY_TASK = {
  id: 'task-plan-focused-work',
  title: 'Plan focused work',
  description: 'Choose one clear outcome for the afternoon.',
  completed: false,
  priority: 'high',
  category: 'task',
  dueDate: '2026-07-28',
  createdAt: '2026-07-28T08:00:00.000Z',
  updatedAt: '2026-07-28T08:00:00.000Z',
};

test('takes a signed-in user from Night Compass through a persisted task and setting change @smoke', async ({ page, scenario }) => {
  await scenario({
    now: NOW,
    settings: {
      prayerEnabled: true,
      prayerCity: 'Bedford',
      prayerCountry: 'United Kingdom',
    },
    stores: { tasks: [TODAY_TASK] },
  });

  await openApp(page);
  await expect(page.getByRole('heading', { name: 'Night Compass' })).toBeVisible();
  await expect(page.getByRole('button', { name: 'Complete Dhuhr Prayer' })).toContainText('13:00');
  await expect(page.getByLabel('Life Hero companion')).toHaveCount(0);

  await page.getByRole('button', { name: 'Open tasks' }).click();
  await expect(page.getByRole('heading', { name: 'Tasks', exact: true })).toBeVisible();

  const taskCheckbox = page.getByRole('checkbox', { name: 'Mark "Plan focused work" as complete' });
  await expect(taskCheckbox).toBeVisible();
  const taskWrite = waitForMutation(page, 'tasks');
  await taskCheckbox.click();
  await taskWrite;
  await page.getByRole('button', { name: /^Today/ }).click();
  await expect(page.getByRole('checkbox', { name: 'Mark "Plan focused work" as incomplete' })).toBeChecked();

  await page.getByRole('button', { name: 'Navigate to Settings' }).click();
  await expect(page.getByRole('heading', { name: 'Settings', exact: true })).toBeVisible();
  const lifeHeroToggle = page.getByRole('checkbox', { name: 'Toggle Life Hero character companion' });
  await expect(lifeHeroToggle).not.toBeChecked();
  const lifeHeroSettingsWrite = waitForMutation(page, 'settings');
  await lifeHeroToggle.locator('..').click();
  await lifeHeroSettingsWrite;
  const settingsWrite = waitForMutation(page, 'settings');
  await page.getByLabel('Theme').selectOption('light');
  await settingsWrite;
  await expect(page.getByText('Light theme is not yet available.')).toBeVisible();

  await page.reload();
  await expect(page.getByRole('heading', { name: 'Settings', exact: true })).toBeVisible();
  await expect(page.getByRole('checkbox', { name: 'Toggle Life Hero character companion' })).toBeChecked();
  await expect(page.getByLabel('Theme')).toHaveValue('light');

  await page.getByRole('button', { name: 'Navigate to Tasks' }).click();
  await expect(page.getByRole('checkbox', { name: 'Mark "Plan focused work" as incomplete' })).toBeChecked();
  await page.getByRole('button', { name: 'Navigate to Dashboard' }).click();
  await expect(page.getByRole('heading', { name: 'Night Compass', exact: true })).toBeVisible();
  await expect(page.getByRole('button', { name: 'Complete Dhuhr Prayer' })).toContainText('13:00');
  await expect(page.getByLabel('Life Hero companion')).toBeVisible();
});

test('retires only dashboard recommendation caches before sign-in @smoke', async ({ page, scenario }) => {
  await scenario({ authenticated: false });
  await page.goto('/');
  await page.evaluate(() => {
    localStorage.setItem('helm:dashboardFocusCache:v1', 'retired recommendation');
    localStorage.setItem('helm:dashboardFocusHostedReview:v1', 'retired review');
    localStorage.setItem('helm:dashboardFocusCache:v2', 'unrelated version');
    localStorage.setItem('helm:dashboardFocusFeedback', 'historical feedback');
    localStorage.setItem('helm:device:deviceSettings:v2', '{"wakeWordEnabled":false}');
    sessionStorage.setItem('unrelated-session', 'keep');
  });
  await page.reload();
  await expect(page.getByRole('heading', { name: 'Sign in to continue' })).toBeVisible();
  expect(await page.evaluate(() => ({
    cache: localStorage.getItem('helm:dashboardFocusCache:v1'),
    review: localStorage.getItem('helm:dashboardFocusHostedReview:v1'),
    otherVersion: localStorage.getItem('helm:dashboardFocusCache:v2'),
    feedback: localStorage.getItem('helm:dashboardFocusFeedback'),
    device: localStorage.getItem('helm:device:deviceSettings:v2'),
    session: sessionStorage.getItem('unrelated-session'),
  }))).toEqual({
    cache: null,
    review: null,
    otherVersion: 'unrelated version',
    feedback: 'historical feedback',
    device: '{"wakeWordEnabled":false}',
    session: 'keep',
  });
});

test('keeps Dashboard Tasks and Prayer active without focus AI or cache writes @smoke', async ({ page, scenario }) => {
  await scenario({
    now: '2026-07-28T12:05:00.000Z',
    settings: { assistantEnabled: true, assistantProvider: 'hosted', prayerEnabled: true },
    stores: { tasks: [TODAY_TASK] },
  });
  const focusRequests: unknown[] = [];
  // Even enabled AI is entirely synthetic: no request can reach an AI provider.
  await page.route('**/functions/v1/assistant-openai*', async route => {
    const body = route.request().postDataJSON();
    if (JSON.stringify(body.messages ?? []).includes('Sabah One dashboard focus')) focusRequests.push(body);
    await route.fulfill({
      contentType: 'application/json',
      body: JSON.stringify({ ok: true, mode: 'enabled', model: 'fixture', text: '{}' }),
    });
  });
  await openApp(page);
  await expect(page.getByRole('heading', { name: 'Night Compass' })).toBeVisible();
  await page.clock.fastForward(120_000);
  await page.getByRole('button', { name: 'Open tasks' }).click();
  const taskWrite = waitForMutation(page, 'tasks');
  await page.getByRole('checkbox', { name: 'Mark "Plan focused work" as complete' }).click();
  await taskWrite;
  await page.getByRole('button', { name: 'Navigate to Dashboard' }).click();
  const prayerWrite = waitForMutation(page, 'prayerTracking');
  await page.getByRole('button', { name: 'Complete Dhuhr Prayer — Current prayer' }).click();
  await page.getByRole('dialog').getByRole('button', { name: /^On time/ }).click();
  await prayerWrite;
  await expect(page.getByRole('button', { name: 'Dhuhr Prayer — confirmed, Prayed on time' })).toBeDisabled();
  await page.clock.fastForward(120_000);
  expect(focusRequests).toEqual([]);
  expect(await page.evaluate(() => [
    localStorage.getItem('helm:dashboardFocusCache:v1'),
    localStorage.getItem('helm:dashboardFocusHostedReview:v1'),
  ])).toEqual([null, null]);
  for (const width of [390, 1440]) {
    await page.setViewportSize({ width, height: 900 });
    await expect(page.getByRole('region', { name: 'Night Compass daily dashboard' })).toBeVisible();
    await expect(page.getByRole('button', { name: 'Dhuhr Prayer — confirmed, Prayed on time' })).toBeDisabled();
    expect(await page.evaluate(() => document.documentElement.scrollWidth <= window.innerWidth)).toBe(true);
    await page.screenshot({ path: test.info().outputPath(`dashboard-retired-runtime-${width}.png`) });
  }
});
