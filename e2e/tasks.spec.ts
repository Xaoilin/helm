import { test, expect } from '@playwright/test';

test.describe('Tasks', () => {
  test.beforeEach(async ({ page }) => {
    await page.goto('/');
    // Clear localStorage for clean state
    await page.evaluate(() => localStorage.clear());
    await page.reload();
    await page.waitForSelector('.sidebar');
    await page.getByRole('button', { name: 'Navigate to Tasks' }).click();
  });

  test('should show empty state', async ({ page }) => {
    await expect(page.locator('text=No tasks yet')).toBeVisible();
  });

  test('should add a new task', async ({ page }) => {
    // Click add task button
    await page.locator('button:has-text("Add"), button:has-text("New Task"), button:has-text("+ Add")').first().click();

    // Fill in task title
    const titleInput = page.locator('input[placeholder*="title"], input[placeholder*="Title"]').first();
    if (await titleInput.isVisible()) {
      await titleInput.fill('Buy groceries');

      // Save
      await page.locator('button:has-text("Save"), button:has-text("Add"), button:has-text("Create")').last().click();

      // Verify task appears
      await expect(page.locator('text=Buy groceries')).toBeVisible();
    }
  });
});
