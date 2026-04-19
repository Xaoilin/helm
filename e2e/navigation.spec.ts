import { test, expect } from '@playwright/test';

test.describe('Navigation', () => {
  test.beforeEach(async ({ page }) => {
    await page.goto('/');
    await page.waitForSelector('.sidebar');
  });

  test('should load dashboard by default', async ({ page }) => {
    await expect(page.locator('text=Good morning').or(page.locator('text=Good afternoon').or(page.locator('text=Good evening')))).toBeVisible();
  });

  test('should navigate to key surfaces via sidebar', async ({ page }) => {
    // Test a subset of surfaces to keep test fast and stable
    await page.getByRole('button', { name: 'Navigate to Tasks' }).click();
    await expect(page.locator('h1:has-text("Tasks")')).toBeVisible();

    await page.getByRole('button', { name: 'Navigate to Settings' }).click();
    await expect(page.locator('h1:has-text("Settings")')).toBeVisible();

    await page.getByRole('button', { name: 'Navigate to Finance' }).click();
    await expect(page.locator('h1:has-text("Finance")')).toBeVisible();
  });

  test('should navigate back to dashboard', async ({ page }) => {
    await page.getByRole('button', { name: 'Navigate to Settings' }).click();
    await expect(page.locator('h1:has-text("Settings")')).toBeVisible();
    await page.getByRole('button', { name: 'Navigate to Dashboard' }).click();
    await expect(page.locator('text=Good morning').or(page.locator('text=Good afternoon').or(page.locator('text=Good evening')))).toBeVisible();
  });

  test('should restore the Trips surface after a browser reload', async ({ page }) => {
    await page.getByRole('button', { name: 'Navigate to Trips' }).click();
    await expect(page.locator('main[aria-label="trips surface"]')).toBeVisible();

    await page.reload();
    await page.waitForSelector('.sidebar');

    await expect(page.locator('main[aria-label="trips surface"]')).toBeVisible();
    await expect(page.getByRole('button', { name: 'Navigate to Trips' })).toHaveAttribute('aria-current', 'page');
  });

  test('should keep the current release visible in the sidebar', async ({ page }) => {
    await expect(page.locator('.sidebar-release')).toContainText('Current release');
    await expect(page.locator('.sidebar-release')).toContainText(/v\d+\.\d+\.\d+/);
  });

  test('should force one refresh when the release manifest reports a newer deployment', async ({ page }) => {
    const publishedVersion = '99.0.0';
    let releaseChecks = 0;

    await page.route('**/release.json*', async route => {
      releaseChecks += 1;
      await route.fulfill({
        contentType: 'application/json',
        body: JSON.stringify({ version: publishedVersion }),
      });
    });

    await page.goto('/');
    await page.waitForSelector('.sidebar');

    await expect.poll(() => releaseChecks >= 2).toBe(true);
    await expect.poll(async () => page.evaluate(
      (key) => sessionStorage.getItem(key),
      `helm:release-refresh:${publishedVersion}`,
    )).toBe('done');
  });
});
