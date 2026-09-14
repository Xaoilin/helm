import type { Locator, Page } from '@playwright/test';
import { expect, openApp, test, waitForMutation } from './support/helm-fixture';

async function recordProgress(page: Page, button: Locator): Promise<void> {
  await expect(button).toBeEnabled();
  const mutation = waitForMutation(page, 'gamification');
  await button.click();
  await mutation;
}

for (const width of [390, 768, 1440]) {
  test(`daily goals complete the remaining target or add individual steps at ${width}px`, async ({ page, scenario }, testInfo) => {
    await page.setViewportSize({ width, height: 900 });
    await page.emulateMedia({ reducedMotion: 'reduce' });
    await scenario({ now: '2026-08-29T12:30:00.000Z' });
    await openApp(page);
    const learn = page.getByRole('region', { name: 'Learn', exact: true });
    const move = page.getByRole('region', { name: 'Move', exact: true });
    const learnMode = learn.getByRole('switch', { name: 'Add individual steps' });
    const moveMode = move.getByRole('switch', { name: 'Add individual steps' });
    const reading = learn.locator('[data-template-id="learn-reading"]');
    const course = learn.locator('[data-template-id="learn-course"]');
    const walk = move.locator('[data-template-id="move-walk"]');
    const grid = page.locator('.nc-momentum-grid');
    const capture = async (mode: string) => {
      for (const [name, panel] of [['learn', learn], ['move', move]] as const) {
        await panel.evaluate(element => element.scrollIntoView({ block: 'center' }));
        await panel.screenshot({ path: testInfo.outputPath(`daily-goals-${mode}-${name}-${width}.png`) });
      }
    };

    const scroller = page.locator(width <= 760 ? '.main-content' : '.nc-dashboard-body');
    const scrollMetrics = await scroller.evaluate(element => ({
      clientHeight: element.clientHeight, scrollHeight: element.scrollHeight, top: element.scrollTop,
    }));
    expect(scrollMetrics.scrollHeight).toBeGreaterThan(scrollMetrics.clientHeight);
    await scroller.hover();
    await page.mouse.wheel(0, 500);
    await expect.poll(() => scroller.evaluate(element => element.scrollTop)).toBeGreaterThan(scrollMetrics.top);

    await expect(learnMode).not.toBeChecked();
    await expect(moveMode).not.toBeChecked();
    await expect(reading.getByRole('button', { name: 'Add 2 pages' })).toBeEnabled();
    await expect(move.getByRole('button', { name: 'Add 5 minutes' })).toHaveCount(3);
    await capture('default');

    await learnMode.focus();
    const before = await learnMode.boundingBox();
    await learnMode.press('Space');
    await expect(learnMode).toBeChecked();
    await expect(learnMode).toBeFocused();
    const after = await learnMode.boundingBox();
    expect(Math.abs(after!.width - before!.width)).toBeLessThanOrEqual(1);
    expect(Math.abs(after!.height - before!.height)).toBeLessThanOrEqual(1);
    await expect(reading.getByRole('button', { name: 'Add 1 page' })).toBeEnabled();
    await expect(course.getByRole('button', { name: 'Add 1 minute' })).toBeEnabled();
    await expect(moveMode).not.toBeChecked();
    await moveMode.click();
    await expect(move.getByRole('button', { name: 'Add 1 minute' })).toHaveCount(3);
    await capture('individual');

    await recordProgress(page, course.getByRole('button', { name: 'Add 1 minute' }));
    await expect(course).toContainText('1 / 5 minutes');
    await learnMode.press('Enter');
    await expect(learnMode).not.toBeChecked();
    await recordProgress(page, course.getByRole('button', { name: 'Add 4 minutes' }));
    await expect(course).toContainText('Level 1 reached');
    await expect(course).toContainText('5 / 10 minutes');
    await recordProgress(page, reading.getByRole('button', { name: 'Add 2 pages' }));
    await expect(reading).toContainText('Level 1 reached');
    await expect(reading.getByRole('button', { name: 'Add 3 pages' })).toBeEnabled();

    await recordProgress(page, walk.getByRole('button', { name: 'Add 1 minute' }));
    await expect(walk).toContainText('1 / 5 minutes');
    await moveMode.click();
    await recordProgress(page, walk.getByRole('button', { name: 'Add 4 minutes' }));
    await expect(walk).toContainText('Level 1 reached');

    const bounds = await grid.boundingBox();
    expect(bounds!.x).toBeGreaterThanOrEqual(0);
    expect(bounds!.x + bounds!.width).toBeLessThanOrEqual(width);
    await page.reload();
    await expect(reading).toContainText('2 / 5 pages');
    await expect(course).toContainText('5 / 10 minutes');
    await expect(walk).toContainText('5 / 10 minutes');
    await expect(learnMode).not.toBeChecked();
    await expect(moveMode).not.toBeChecked();
  });
}
