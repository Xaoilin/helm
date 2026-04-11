import { expect, test } from '@playwright/test';

test.describe('Clock', () => {
  test.beforeEach(async ({ page }) => {
    await page.goto('/');
    await page.waitForSelector('.sidebar');
    await page.getByRole('button', { name: 'Navigate to Clock' }).click();
    await expect(page.locator('h1:has-text("Clock")')).toBeVisible();
  });

  test('should show stopwatch and timer tools', async ({ page }) => {
    await expect(page.getByRole('heading', { name: 'Stopwatch' })).toBeVisible();
    await expect(page.getByRole('heading', { name: 'Timer' })).toBeVisible();
    await expect(page.getByRole('button', { name: 'Start Stopwatch' })).toBeVisible();
    await expect(page.getByRole('button', { name: 'Start Timer' })).toBeVisible();
    await expect(page.getByLabel('Alarm sound')).toBeVisible();
    await expect(page.getByRole('button', { name: 'Preview Sound' })).toBeVisible();
  });

  test('should start the stopwatch and use a timer preset', async ({ page }) => {
    await page.getByRole('button', { name: 'Start Stopwatch' }).click();
    await expect(page.getByRole('button', { name: 'Pause Stopwatch' })).toBeVisible();

    await page.getByRole('button', { name: 'Pause Stopwatch' }).click();
    await page.getByRole('button', { name: 'Reset Stopwatch' }).click();
    await expect(page.getByLabel('Stopwatch elapsed')).toContainText('00:00.00');

    await page.getByRole('button', { name: '25 min' }).click();
    await expect(page.getByLabel('Timer remaining')).toContainText('25:00');
    await page.getByRole('button', { name: 'Start Timer' }).click();
    await expect(page.getByRole('button', { name: 'Pause Timer' })).toBeVisible();
  });

  test('should persist the selected alarm sound after reload', async ({ page }) => {
    await page.getByLabel('Alarm sound').selectOption('bell');
    await expect(page.getByLabel('Alarm sound')).toHaveValue('bell');
    await expect(page.getByText('Warm bell-style strikes.')).toBeVisible();

    await page.reload();
    await page.waitForSelector('.sidebar');
    await page.getByRole('button', { name: 'Navigate to Clock' }).click();

    await expect(page.getByLabel('Alarm sound')).toHaveValue('bell');
    await expect(page.getByText('Warm bell-style strikes.')).toBeVisible();
  });
});
