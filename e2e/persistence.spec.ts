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
  const preferredWrite = waitForMutation(page, 'settings');
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

  const automaticWrite = waitForMutation(page, 'settings');
  await page.getByRole('button', { name: 'Use Automatic' }).click();
  await automaticWrite;
  await expect(page.getByLabel('IANA time zone')).toHaveValue('');
  await expect(page.getByText(/Automatic restored/)).toBeVisible();

  await page.reload();
  await expect(page.getByRole('heading', { name: 'Settings', exact: true })).toBeVisible();
  await expect(page.getByLabel('IANA time zone')).toHaveValue('');
  await expect(page.getByText('Automatic', { exact: true })).toBeVisible();
});
