import { expect, test } from '@playwright/test';

const CONCEPT_PATH = 'concepts/life-hero/index.html';

test.describe('Life Hero approval concept', () => {
  test('renders the original human baseline and explicit concept boundaries at desktop', async ({ page }) => {
    await page.setViewportSize({ width: 1440, height: 900 });
    await page.goto(CONCEPT_PATH);

    await expect(page.getByRole('heading', { name: 'Original human baseline' })).toBeVisible();
    await expect(page.getByRole('status')).toHaveText('Awaiting explicit concept approval');

    const portrait = page.getByRole('img', { name: /Full-body original human Life Hero/ });
    await expect(portrait).toBeVisible();
    await expect.poll(() => portrait.evaluate(image => (
      image instanceof HTMLImageElement && image.complete && image.naturalWidth === 930
    ))).toBe(true);

    await expect(page.getByText('Warm, concise, no music')).toBeVisible();
    await expect(page.getByText('No gambling, loot boxes, chance rewards, or haram mechanics.')).toBeVisible();
    await expect(page.getByText('Broad energy, no copying')).toBeVisible();
    await expect(page.getByText('No user approval is recorded by this artifact.')).toBeVisible();

    const hasHorizontalOverflow = await page.evaluate(() => (
      document.documentElement.scrollWidth > document.documentElement.clientWidth
    ));
    expect(hasHorizontalOverflow).toBe(false);
  });

  test('keeps the hero visible and reading order intact at mobile width', async ({ page }) => {
    await page.setViewportSize({ width: 390, height: 844 });
    await page.goto(CONCEPT_PATH);

    const heading = page.getByRole('heading', { name: 'Original human baseline' });
    const portrait = page.getByRole('img', { name: /Full-body original human Life Hero/ });
    await expect(heading).toBeVisible();
    await expect(portrait).toBeVisible();

    const [headingBox, portraitBox] = await Promise.all([
      heading.boundingBox(),
      portrait.boundingBox(),
    ]);
    expect(headingBox).not.toBeNull();
    expect(portraitBox).not.toBeNull();
    expect(portraitBox!.y).toBeGreaterThan(headingBox!.y);
    expect(portraitBox!.y).toBeLessThan(844);
    expect(portraitBox!.x).toBeGreaterThanOrEqual(0);
    expect(portraitBox!.x + portraitBox!.width).toBeLessThanOrEqual(390);

    const hasHorizontalOverflow = await page.evaluate(() => (
      document.documentElement.scrollWidth > document.documentElement.clientWidth
    ));
    expect(hasHorizontalOverflow).toBe(false);
  });
});
