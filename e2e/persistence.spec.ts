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
