import { expect, test } from '@playwright/test';

test.describe('Health fast food log', () => {
  test.beforeEach(async ({ page }) => {
    await page.goto('/');
    await page.waitForSelector('.sidebar');
    await page.getByRole('button', { name: 'Navigate to Health' }).click();
    await expect(page.locator('h1:has-text("Health")')).toBeVisible();
  });

  test('should save a fast food log entry from the quick-entry panel', async ({ page }) => {
    await page.getByPlaceholder("McDonald's, KFC, Burger King...").fill('McDonald\'s');
    await page.getByRole('button', { name: 'Yesterday' }).click();
    await page.getByRole('button', { name: /Bad/i }).click();
    await page.getByRole('button', { name: 'Nauseous' }).click();
    await page.getByPlaceholder('Example: nauseous for the entire day, felt heavy, not worth the convenience.')
      .fill('Nauseous for the entire day. Bad experience.');

    await page.getByRole('button', { name: 'Save fast food log' }).click();

    await expect(page.getByRole('heading', { name: 'McDonald\'s' })).toBeVisible();
    await expect(page.locator('.health-entry-card')).toContainText('Nauseous for the entire day. Bad experience.');
    await expect(page.locator('.health-entry-tag')).toContainText('Nauseous');
  });
});
