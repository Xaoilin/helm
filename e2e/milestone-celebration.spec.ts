import type { Page } from '@playwright/test';
import { expect, openApp, test, waitForMutation } from './support/helm-fixture';

function requestedViewports(): string[] {
  return (process.env.HELM_E2E_VISUAL_VIEWPORTS || '390x844,1440x900')
    .split(',')
    .map(value => value.trim())
    .filter(value => /^\d+x\d+$/u.test(value));
}

async function addReadingPage(page: Page): Promise<void> {
  const reading = page.locator('[data-template-id="learn-reading"]');
  const addPage = reading.getByRole('button', { name: 'Add 1 pages' });
  await expect(addPage).toBeEnabled();
  const mutation = waitForMutation(page, 'gamification');
  await addPage.click();
  await mutation;
}

for (const viewport of requestedViewports()) {
  test(`renders a restrained Reading L1 receipt at ${viewport} @visual`, async ({ page, scenario }, testInfo) => {
    test.skip(
      Boolean(process.env.HELM_E2E_VISUAL_SURFACE && process.env.HELM_E2E_VISUAL_SURFACE !== 'milestone'),
      'A different visual surface was requested.',
    );

    const [width, height] = viewport.split('x').map(Number);
    await page.setViewportSize({ width, height });
    if (width <= 390) await page.emulateMedia({ reducedMotion: 'reduce' });
    await scenario({
      now: '2026-08-29T12:30:00.000Z',
      settings: { prayerEnabled: true, lifeHeroEnabled: false },
    });
    await openApp(page);

    await addReadingPage(page);
    await expect(page.locator('[data-template-id="learn-reading"]')).toContainText('1 / 2 pages');
    await expect(page.getByRole('status').filter({ hasText: 'Reading · Level 1' })).toHaveCount(0);

    await addReadingPage(page);
    const celebration = page.getByRole('status').filter({ hasText: 'Reading · Level 1' });
    await expect(celebration).toBeVisible();
    await expect(celebration).toContainText("Today's target is complete.");
    await expect(celebration).toHaveCSS('pointer-events', 'none');
    await expect(celebration.getByLabel('Level 1 of 5')).toBeVisible();

    const geometry = await celebration.locator('.milestone-celebration-card').evaluate(element => {
      const rect = element.getBoundingClientRect();
      return { top: rect.top, right: rect.right, bottom: rect.bottom, left: rect.left };
    });
    expect(geometry.left).toBeGreaterThanOrEqual(0);
    expect(geometry.top).toBeGreaterThanOrEqual(0);
    expect(geometry.right).toBeLessThanOrEqual(width);
    expect(geometry.bottom).toBeLessThanOrEqual(height);

    if (width <= 390) {
      await expect(celebration).toHaveCSS('animation-name', 'none');
      await expect(celebration.locator('.milestone-celebration-mark > i').first()).toHaveCSS('display', 'none');
    } else {
      await page.waitForTimeout(450);
    }

    await page.screenshot({ path: testInfo.outputPath(`reading-level-one-${viewport}.png`) });
  });
}

test('renders a dignified prayer completion receipt @visual', async ({ page, scenario }, testInfo) => {
  test.skip(
    Boolean(process.env.HELM_E2E_VISUAL_SURFACE && process.env.HELM_E2E_VISUAL_SURFACE !== 'milestone'),
    'A different visual surface was requested.',
  );

  await page.setViewportSize({ width: 1440, height: 900 });
  await scenario({
    now: '2026-08-29T12:30:00.000Z',
    settings: { prayerEnabled: true, lifeHeroEnabled: false },
  });
  await openApp(page);

  await page.getByRole('button', { name: /Complete Dhuhr Prayer — Current prayer/u }).click();
  await expect(page.getByRole('dialog', { name: 'How was Dhuhr prayed?' })).toBeVisible();
  await page.getByRole('button', { name: /On time/u }).click();

  const celebration = page.getByRole('status').filter({ hasText: 'Dhuhr complete' });
  await expect(celebration).toBeVisible();
  await expect(celebration).toContainText('Prayer kept on time');
  await expect(celebration).toHaveCSS('pointer-events', 'none');
  await page.waitForTimeout(450);
  await page.screenshot({ path: testInfo.outputPath('prayer-completion-1440x900.png') });
});
