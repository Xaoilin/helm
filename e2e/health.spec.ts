import { expect, test } from './support/helm-fixture';

test.describe('Health fast food log', () => {
  test.beforeEach(async ({ page, scenario }) => {
    await scenario('empty');
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

  test('keeps the severity cards wide enough to stay readable', async ({ page }) => {
    const dateField = page.locator('.health-field').filter({ hasText: 'When was it?' });
    const ratingField = page.locator('.health-rating-field');
    const mixedCard = page.getByRole('button', { name: /Mixed/i });

    const [dateBox, ratingBox, mixedCardBox] = await Promise.all([
      dateField.boundingBox(),
      ratingField.boundingBox(),
      mixedCard.boundingBox(),
    ]);

    expect(dateBox?.width ?? 0).toBeGreaterThan(0);
    expect(ratingBox?.width ?? 0).toBeGreaterThan((dateBox?.width ?? 0) * 1.75);
    expect(mixedCardBox?.width ?? 0).toBeGreaterThan(150);
  });
});
