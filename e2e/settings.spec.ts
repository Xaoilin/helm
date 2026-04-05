import { test, expect } from '@playwright/test';

test.describe('Settings', () => {
  test.beforeEach(async ({ page }) => {
    await page.goto('/');
    await page.waitForSelector('.sidebar');
    await page.getByRole('button', { name: 'Navigate to Settings' }).click();
  });

  test('should show settings page header', async ({ page }) => {
    await expect(page.locator('h1:has-text("Settings")')).toBeVisible();
  });

  test('should contain key settings sections', async ({ page }) => {
    // Check page content includes these text strings (even if not visible in viewport)
    const content = await page.textContent('body');
    expect(content).toContain('Data Sync');
    expect(content).toContain('Calendar');
    expect(content).toContain('Voice Assistant');
  });
});
