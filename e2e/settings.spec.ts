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

  test('should let you choose a hosted OpenAI model preset', async ({ page }) => {
    const hostedModelSelect = page.getByLabel('Hosted OpenAI model');
    await hostedModelSelect.selectOption('gpt-5.4-mini');
    await expect(hostedModelSelect).toHaveValue('gpt-5.4-mini');
    await expect(page.getByText('GPT-5.4 mini', { exact: true })).toBeVisible();
    await expect(page.getByText(/Lower-cost hosted model with strong general performance/i)).toBeVisible();
    await hostedModelSelect.scrollIntoViewIfNeeded();
    await page.screenshot({
      path: 'test-results/manual-settings-model-picker-v024.png',
      fullPage: false,
    });
  });
});
