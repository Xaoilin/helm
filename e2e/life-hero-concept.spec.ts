import path from 'node:path';

import { expect, test } from '@playwright/test';

const CONCEPT_PATH = 'concepts/life-hero/index.html';
const EVIDENCE_DIRECTORY = path.resolve('docs/design/evidence');

test.describe('Life Hero modular concept', () => {
  test('toggles separate clothing and gear assets independently', async ({ page }) => {
    await page.setViewportSize({ width: 1440, height: 900 });
    await page.goto(CONCEPT_PATH);

    await expect(page.getByRole('heading', { name: 'One hero, separate layers' })).toBeVisible();
    await expect(page.getByText('This image is not a 3D model.')).toBeVisible();

    const body = page.locator('[data-layer="body-base"]');
    const clothing = page.locator('[data-layer="clothing-base"]');
    const jacket = page.locator('[data-layer="field-jacket"]');
    const harness = page.locator('[data-layer="harness"]');
    const cuff = page.locator('[data-layer="progress-cuff"]');
    const pack = page.locator('[data-layer="day-pack"]');
    const sash = page.locator('[data-layer="training-sash"]');

    await expect(body).toBeVisible();
    await expect(clothing).toBeVisible();
    await expect(jacket).toBeVisible();
    await expect(harness).toBeVisible();
    await expect(cuff).toBeVisible();
    await expect(pack).toBeHidden();
    await expect(sash).toBeHidden();

    await page.getByRole('button', { name: 'Harness' }).click();
    await expect(harness).toBeHidden();
    await expect(cuff).toBeVisible();

    await page.getByRole('button', { name: 'Day pack' }).focus();
    await page.keyboard.press('Enter');
    await page.getByRole('button', { name: 'Training sash' }).click();
    await expect(pack).toBeVisible();
    await expect(sash).toBeVisible();
    await expect(page.getByTestId('layer-status')).toContainText('Day pack, Training sash');
    await expect(body).toBeVisible();
    await expect(clothing).toBeVisible();

    const hasHorizontalOverflow = await page.evaluate(() => (
      document.documentElement.scrollWidth > document.documentElement.clientWidth
    ));
    expect(hasHorizontalOverflow).toBe(false);
  });

  test('selects every named motion and supports an explicit static mode', async ({ page }) => {
    await page.setViewportSize({ width: 1440, height: 900 });
    await page.goto(CONCEPT_PATH);

    const rig = page.getByTestId('avatar-rig');
    const stage = page.getByTestId('avatar-stage');
    await expect(rig).toHaveAttribute('data-motion', 'idle');

    const motions = [
      ['Motivate', 'celebrate'],
      ['Focus', 'focus'],
      ['Train', 'train'],
      ['Low momentum', 'tired'],
      ['Idle', 'idle'],
    ] as const;

    for (const [buttonName, motion] of motions) {
      await page.getByRole('button', { name: buttonName, exact: true }).click();
      await expect(rig).toHaveAttribute('data-motion', motion);
      await expect(page.locator('#motion-name')).toHaveText(buttonName);
    }

    await page.getByRole('button', { name: 'Static', exact: true }).click();
    await expect(stage).toHaveAttribute('data-motion-mode', 'static');
    await expect(page.getByTestId('motion-mode-status')).toContainText('Static fallback selected');
    await expect.poll(() => rig.evaluate(element => getComputedStyle(element).animationName)).toBe('none');
  });

  test('forces the static fallback for prefers-reduced-motion', async ({ page }) => {
    await page.emulateMedia({ reducedMotion: 'reduce' });
    await page.setViewportSize({ width: 390, height: 844 });
    await page.goto(CONCEPT_PATH);

    const rig = page.getByTestId('avatar-rig');
    await expect(page.getByTestId('avatar-stage')).toHaveAttribute('data-motion-mode', 'static');
    await expect(page.getByRole('button', { name: 'Motion on' })).toBeDisabled();
    await expect(page.getByRole('button', { name: 'Static', exact: true })).toHaveAttribute('aria-pressed', 'true');

    await page.getByRole('button', { name: 'Low momentum' }).click();
    await expect(rig).toHaveAttribute('data-motion', 'tired');
    await expect(page.getByTestId('motion-mode-status')).toHaveText(
      'Static fallback active — system reduced-motion preference.',
    );
    await expect.poll(() => rig.evaluate(element => getComputedStyle(element).animationName)).toBe('none');
    await expect(page.getByRole('img', { name: 'Approved original Life Hero art-direction portrait' })).toBeVisible();
  });

  test('keeps the modular controls usable at mobile width', async ({ page }) => {
    await page.setViewportSize({ width: 390, height: 844 });
    await page.goto(CONCEPT_PATH);

    const rig = page.getByTestId('avatar-rig');
    const heading = page.getByRole('heading', { name: 'One hero, separate layers' });
    const [headingBox, rigBox] = await Promise.all([heading.boundingBox(), rig.boundingBox()]);
    expect(headingBox).not.toBeNull();
    expect(rigBox).not.toBeNull();
    expect(rigBox!.y).toBeGreaterThan(headingBox!.y);

    await page.getByRole('button', { name: 'Day pack' }).click();
    await page.getByRole('button', { name: 'Focus', exact: true }).click();
    await expect(page.locator('[data-layer="day-pack"]')).toBeVisible();
    await expect(rig).toHaveAttribute('data-motion', 'focus');

    const beforeScroll = await page.evaluate(() => window.scrollY);
    await page.mouse.wheel(0, 620);
    await expect.poll(() => page.evaluate(() => window.scrollY)).toBeGreaterThan(beforeScroll);

    const hasHorizontalOverflow = await page.evaluate(() => (
      document.documentElement.scrollWidth > document.documentElement.clientWidth
    ));
    expect(hasHorizontalOverflow).toBe(false);
  });

  test('@visual captures KAN-257 desktop, mobile, and reduced-motion evidence', async ({ page }) => {
    test.skip(process.env.HELM_E2E_VISUAL_SURFACE !== 'life-hero', 'Life Hero visual capture only.');

    await page.emulateMedia({ reducedMotion: 'no-preference' });
    await page.setViewportSize({ width: 1440, height: 900 });
    await page.goto(CONCEPT_PATH);
    await page.getByRole('button', { name: 'Day pack' }).click();
    await page.getByRole('button', { name: 'Static', exact: true }).click();
    await page.evaluate(() => {
      (document.activeElement as HTMLElement | null)?.blur();
      window.scrollTo(0, 0);
    });
    await page.screenshot({ path: path.join(EVIDENCE_DIRECTORY, 'life-hero-desktop-1440x900.png'), fullPage: true });

    await page.setViewportSize({ width: 390, height: 844 });
    await page.goto(CONCEPT_PATH);
    await page.getByRole('button', { name: 'Harness' }).click();
    await page.getByRole('button', { name: 'Day pack' }).click();
    await page.getByRole('button', { name: 'Training sash' }).click();
    await page.getByRole('button', { name: 'Static', exact: true }).click();
    await page.evaluate(() => {
      (document.activeElement as HTMLElement | null)?.blur();
      window.scrollTo(0, 0);
    });
    await page.screenshot({ path: path.join(EVIDENCE_DIRECTORY, 'life-hero-mobile-390x844.png'), fullPage: true });

    const reducedPage = await page.context().newPage();
    await reducedPage.emulateMedia({ reducedMotion: 'reduce' });
    await reducedPage.setViewportSize({ width: 390, height: 844 });
    await reducedPage.goto(`${CONCEPT_PATH}?evidence=reduced`);
    await reducedPage.getByRole('button', { name: 'Low momentum' }).evaluate(button => {
      (button as HTMLButtonElement).click();
    });
    await reducedPage.evaluate(() => {
      (document.activeElement as HTMLElement | null)?.blur();
      window.scrollTo(0, 0);
    });
    await expect.poll(() => reducedPage.evaluate(() => window.scrollY)).toBe(0);
    await reducedPage.screenshot({ path: path.join(EVIDENCE_DIRECTORY, 'life-hero-reduced-motion-390x844.png'), fullPage: true });
    await reducedPage.close();
  });
});
