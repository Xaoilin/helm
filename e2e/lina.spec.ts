import { test, expect } from '@playwright/test';

test.describe('Lina Assistant', () => {
  test.beforeEach(async ({ page }) => {
    await page.goto('/');
    await page.waitForSelector('.sidebar');
  });

  test('should show L button on dashboard', async ({ page }) => {
    await expect(page.locator('button[aria-label="Talk to Lina"]')).toBeVisible();
  });

  test('should open panel when L button clicked', async ({ page }) => {
    await page.locator('button[aria-label="Talk to Lina"]').click();
    // Panel should appear with Lina header
    await expect(page.locator('text=Ask me anything').or(page.locator('text=اسألني أي شيء'))).toBeVisible();
  });

  test('should close panel when X clicked', async ({ page }) => {
    await page.locator('button[aria-label="Talk to Lina"]').click();
    await expect(page.locator('button[aria-label="Close Lina"]')).toBeVisible();
    await page.locator('button[aria-label="Close Lina"]').click();
    // Panel should be gone, L button should be back
    await expect(page.locator('button[aria-label="Talk to Lina"]')).toBeVisible();
  });

  test('should close panel on Escape', async ({ page }) => {
    await page.locator('button[aria-label="Talk to Lina"]').click();
    await page.keyboard.press('Escape');
    await expect(page.locator('button[aria-label="Talk to Lina"]')).toBeVisible();
  });

  test('should open panel with Ctrl+Shift+L', async ({ page }) => {
    await page.keyboard.press('Control+Shift+L');
    await expect(page.locator('text=Ask me anything').or(page.locator('text=اسألني أي شيء'))).toBeVisible();
  });

  test('should show quick command chips', async ({ page }) => {
    await page.locator('button[aria-label="Talk to Lina"]').click();
    await expect(page.locator('button:has-text("next meeting")')).toBeVisible();
    await expect(page.locator('button:has-text("tasks left")')).toBeVisible();
    await expect(page.locator('button:has-text("prayer times")')).toBeVisible();
  });

  test('should respond to quick command chip click', async ({ page }) => {
    await page.locator('button[aria-label="Talk to Lina"]').click();
    await page.locator('button:has-text("tasks left")').click();
    // Should show a response — either English or Arabic depending on lang setting
    await expect(page.locator('.va-lina')).toBeVisible({ timeout: 10000 });
  });

  test('should respond to text input', async ({ page }) => {
    await page.locator('button[aria-label="Talk to Lina"]').click();
    const input = page.locator('input[placeholder*="Type"]');
    await input.fill('open calendar');
    await input.press('Enter');
    // Should navigate to calendar
    await expect(page.locator('h1:has-text("Calendar")')).toBeVisible({ timeout: 5000 });
  });
});
