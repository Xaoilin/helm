import { expect, openApp, test } from './support/helm-fixture';

const FIXED_NOW = '2026-07-28T11:45:00.000Z';

test.describe('assembled browser shell', () => {
  test('boots Night Compass with a current-day prayer schedule and next-prayer semantics', async ({ page, scenario }) => {
    await scenario({
      now: FIXED_NOW,
      settings: {
        prayerEnabled: true,
        prayerCity: 'Bedford',
        prayerCountry: 'United Kingdom',
      },
    });
    await openApp(page);

    await expect(page.getByRole('heading', { name: 'Night Compass' })).toBeVisible();
    await expect(page.getByRole('heading', { name: 'Prayer', exact: true })).toBeVisible();

    const nextPrayer = page.getByRole('button', { name: 'Complete Dhuhr Prayer' });
    await expect(nextPrayer).toContainText('13:00');
    await expect(nextPrayer).toHaveAttribute('aria-current', 'true');
  });

  test('navigates across the core account surfaces', async ({ page, scenario }) => {
    await scenario();
    await openApp(page);

    await page.getByRole('button', { name: 'Navigate to Tasks' }).click();
    await expect(page.getByRole('heading', { name: 'Tasks', exact: true })).toBeVisible();

    await page.getByRole('button', { name: 'Navigate to Calendar' }).click();
    await expect(page.getByRole('heading', { name: 'Calendar', exact: true })).toBeVisible();

    await page.getByRole('button', { name: 'Navigate to Clock' }).click();
    await expect(page.getByRole('heading', { name: 'Clock', exact: true })).toBeVisible();

    await page.getByRole('button', { name: 'Navigate to Settings' }).click();
    await expect(page.getByRole('heading', { name: 'Settings', exact: true })).toBeVisible();

    await page.getByRole('button', { name: 'Navigate to Dashboard' }).click();
    await expect(page.getByRole('heading', { name: 'Night Compass', exact: true })).toBeVisible();
  });
});
