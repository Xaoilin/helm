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
