import { expect, test } from '@playwright/test';

test.describe('Clock', () => {
  test.beforeEach(async ({ page }) => {
    await page.goto('/');
    await page.waitForSelector('.sidebar');
    await page.getByRole('button', { name: 'Navigate to Clock' }).click();
    await expect(page.locator('h1:has-text("Clock")')).toBeVisible();
  });

  test('should show the multi-clock workspace', async ({ page }) => {
    await expect(page.getByText('Multi-clock workspace')).toBeVisible();
    await expect(page.getByRole('heading', { name: 'Timers' })).toBeVisible();
    await expect(page.getByRole('heading', { name: 'Stopwatches' })).toBeVisible();
    await expect(page.getByRole('heading', { name: 'Timer 1' })).toBeVisible();
    await expect(page.getByRole('heading', { name: 'Stopwatch 1' })).toBeVisible();
    await expect(page.getByRole('button', { name: '+ Add Timer' })).toBeVisible();
    await expect(page.getByRole('button', { name: '+ Add Stopwatch' })).toBeVisible();
    await expect(page.getByLabel('Alarm sound for Timer 1')).toBeVisible();
    await expect(page.getByRole('button', { name: 'Preview sound for Timer 1' })).toBeVisible();
  });

  test('should create extra timers and stopwatches on demand', async ({ page }) => {
    await page.getByRole('button', { name: '+ Add Timer' }).click();
    await page.getByRole('button', { name: '+ Add Stopwatch' }).click();

    await expect(page.getByRole('heading', { name: 'Timer 2' })).toBeVisible();
    await expect(page.getByRole('heading', { name: 'Stopwatch 2' })).toBeVisible();

    await page.reload();
    await page.waitForSelector('.sidebar');
    await page.getByRole('button', { name: 'Navigate to Clock' }).click();

    await expect(page.getByRole('heading', { name: 'Timer 2' })).toBeVisible();
    await expect(page.getByRole('heading', { name: 'Stopwatch 2' })).toBeVisible();
  });

  test('should start the first stopwatch and use a timer preset', async ({ page }) => {
    await page.getByRole('button', { name: 'Start Stopwatch 1' }).click();
    await expect(page.getByRole('button', { name: 'Pause Stopwatch 1' })).toBeVisible();

    await page.getByRole('button', { name: 'Pause Stopwatch 1' }).click();
    await page.getByRole('button', { name: 'Reset Stopwatch 1' }).click();
    await expect(page.getByLabel('Elapsed for Stopwatch 1')).toContainText('00:00.00');

    await page.getByRole('button', { name: 'Set Timer 1 to 25 minutes' }).click();
    await expect(page.getByLabel('Remaining for Timer 1')).toContainText('25:00');
    await page.getByRole('button', { name: 'Start Timer 1' }).click();
    await expect(page.getByRole('button', { name: 'Pause Timer 1' })).toBeVisible();
  });

  test('should persist the selected alarm sound after reload', async ({ page }) => {
    await page.getByLabel('Alarm sound for Timer 1').selectOption('bell');
    await expect(page.getByLabel('Alarm sound for Timer 1')).toHaveValue('bell');
    await expect(page.getByText('Warm bell-style strikes.')).toBeVisible();

    await page.reload();
    await page.waitForSelector('.sidebar');
    await page.getByRole('button', { name: 'Navigate to Clock' }).click();

    await expect(page.getByLabel('Alarm sound for Timer 1')).toHaveValue('bell');
    await expect(page.getByText('Warm bell-style strikes.')).toBeVisible();
  });
});
