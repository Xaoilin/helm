import path from 'node:path';

import { expect, test } from '@playwright/test';

import { inspectLifeHeroGlb, REQUIRED_LIFE_HERO_CLIPS } from '../scripts/inspect-life-hero-glb.mjs';

const CONCEPT_PATH = 'concepts/life-hero/index.html';
const EVIDENCE_DIRECTORY = path.resolve('docs/design/evidence');
const MODEL_PATH = path.resolve('public/concepts/life-hero/assets/life-hero-modular.glb');

async function waitForModel(page: import('@playwright/test').Page) {
  await expect(page.getByTestId('avatar-stage')).toHaveAttribute('data-model-state', 'ready', {
    timeout: 30_000,
  });
}

async function readViewerState(page: import('@playwright/test').Page) {
  return page.evaluate(() => {
    const viewer = (window as typeof window & {
      lifeHeroViewer?: { getState: () => Record<string, unknown> };
    }).lifeHeroViewer;
    return viewer?.getState() ?? null;
  });
}

test.describe('Life Hero modular GLB proof', () => {
  test('exports separate base and jacket meshes on one skin with four exact clips', async () => {
    const inspection = await inspectLifeHeroGlb(MODEL_PATH);

    expect(inspection.valid, inspection.errors.join('\n')).toBe(true);
    expect(inspection.summary.meshNodes).toEqual(expect.arrayContaining([
      expect.objectContaining({ name: 'LifeHero_BaseBody', mesh: 0, skin: 0 }),
      expect.objectContaining({ name: 'LifeHero_Jacket', mesh: 1, skin: 0 }),
    ]));
    expect(inspection.summary.skins).toEqual([
      expect.objectContaining({ index: 0, joints: 24 }),
    ]);
    expect(inspection.summary.animations.map(animation => animation.name)).toEqual(REQUIRED_LIFE_HERO_CLIPS);
    expect(inspection.meshGeometry).toEqual([
      expect.objectContaining({ name: 'LifeHero_BaseBody', vertices: 105_568, triangles: 174_754 }),
      expect.objectContaining({ name: 'LifeHero_Jacket', vertices: 31_604, triangles: 56_420 }),
    ]);
    expect(inspection.jacketWeightCopiesVerified).toBe(true);
  });

  test('renders the actual GLB and toggles the jacket without replacing the body', async ({ page }) => {
    await page.setViewportSize({ width: 1440, height: 900 });
    await page.goto(CONCEPT_PATH);
    await waitForModel(page);

    await expect(page.getByRole('heading', { name: 'A real hero, a separate jacket' })).toBeVisible();
    await expect(page.getByText('This image is not a 3D model.')).toBeVisible();
    await expect(page.getByTestId('life-hero-canvas')).toBeVisible();
    await expect.poll(() => readViewerState(page)).toMatchObject({
      activeClip: 'Idle_02',
      jacketVisible: true,
      loaded: true,
      static: false,
    });

    const jacketButton = page.getByRole('button', { name: 'Graphite jacket · GLB', exact: true });
    const stageBeforeToggle = await page.getByTestId('avatar-stage').boundingBox();
    await jacketButton.focus();
    await page.keyboard.press('Enter');
    await expect(page.getByTestId('avatar-stage')).toHaveAttribute('data-jacket-visible', 'false');
    await expect(page.getByTestId('jacket-status')).toContainText('complete neutral body remains');
    await expect.poll(() => readViewerState(page)).toMatchObject({ jacketVisible: false, loaded: true });
    const stageAfterToggle = await page.getByTestId('avatar-stage').boundingBox();
    expect(stageBeforeToggle).not.toBeNull();
    expect(stageAfterToggle).not.toBeNull();
    expect(Math.abs(stageAfterToggle!.x - stageBeforeToggle!.x)).toBeLessThanOrEqual(1);
    expect(Math.abs(stageAfterToggle!.y - stageBeforeToggle!.y)).toBeLessThanOrEqual(1);
    expect(Math.abs(stageAfterToggle!.width - stageBeforeToggle!.width)).toBeLessThanOrEqual(1);
    expect(Math.abs(stageAfterToggle!.height - stageBeforeToggle!.height)).toBeLessThanOrEqual(1);

    await page.keyboard.press('Enter');
    await expect.poll(() => readViewerState(page)).toMatchObject({ jacketVisible: true, loaded: true });

    for (const [buttonName, view] of [
      ['Face front', 'face-front'],
      ['Face ¾', 'face-three-quarter'],
      ['Left hand', 'left-hand'],
      ['Right hand', 'right-hand'],
      ['Full body', 'full'],
    ] as const) {
      await page.getByRole('button', { name: buttonName, exact: true }).click();
      await expect.poll(() => readViewerState(page)).toMatchObject({ view });
    }
  });

  test('selects every concept motion through the preserved embedded clips', async ({ page }) => {
    await page.setViewportSize({ width: 1440, height: 900 });
    await page.goto(CONCEPT_PATH);
    await waitForModel(page);

    const motions = [
      ['Motivate', 'Motivational_Cheer'],
      ['Focus', 'Walking'],
      ['Train', 'Running'],
      ['Low momentum', 'Idle_02'],
      ['Idle', 'Idle_02'],
    ] as const;

    for (const [buttonName, clip] of motions) {
      await page.getByRole('button', { name: buttonName, exact: true }).click();
      await expect(page.getByTestId('avatar-stage')).toHaveAttribute('data-active-clip', clip);
      await expect.poll(() => readViewerState(page)).toMatchObject({ activeClip: clip });
    }
  });

  test('uses layered static fallbacks for explicit and reduced-motion modes', async ({ page }) => {
    await page.emulateMedia({ reducedMotion: 'reduce' });
    await page.setViewportSize({ width: 390, height: 844 });
    await page.goto(CONCEPT_PATH);

    const stage = page.getByTestId('avatar-stage');
    await expect(stage).toHaveAttribute('data-motion-mode', 'static');
    await expect(stage).toHaveAttribute('data-model-state', 'fallback');
    await expect(page.getByRole('button', { name: '3D motion on' })).toBeDisabled();
    await expect(page.getByTestId('static-fallback')).toBeVisible();
    await expect(page.getByTestId('life-hero-canvas')).toBeHidden();
    await expect(page.getByTestId('motion-mode-status')).toContainText('system reduced-motion preference');

    await page.getByRole('button', { name: 'Pack · SVG' }).click();
    await page.getByRole('button', { name: 'Sash · SVG' }).click();
    await expect(page.locator('[data-testid="static-fallback"] [data-source-layer="day-pack"]')).toBeVisible();
    await expect(page.locator('[data-testid="static-fallback"] [data-source-layer="training-sash"]')).toBeVisible();
    await expect(page.getByTestId('layer-status')).toContainText('Pack, Sash');
  });

  test('keeps actual model controls usable at mobile width', async ({ page }) => {
    await page.setViewportSize({ width: 390, height: 844 });
    await page.goto(CONCEPT_PATH);
    await waitForModel(page);

    await page.getByRole('button', { name: 'Graphite jacket · GLB', exact: true }).click();
    await page.getByRole('button', { name: 'Focus', exact: true }).click();
    await expect(page.getByTestId('avatar-stage')).toHaveAttribute('data-active-clip', 'Walking');
    await expect.poll(() => readViewerState(page)).toMatchObject({ jacketVisible: false, activeClip: 'Walking' });

    const hasHorizontalOverflow = await page.evaluate(() => (
      document.documentElement.scrollWidth > document.documentElement.clientWidth
    ));
    expect(hasHorizontalOverflow).toBe(false);

    const scrollBefore = await page.evaluate(() => window.scrollY);
    await page.mouse.wheel(0, 620);
    await expect.poll(() => page.evaluate(() => window.scrollY)).toBeGreaterThan(scrollBefore);
  });

  test('@visual captures KAN-257 anatomy, jacket, motion, mobile, and fallback evidence', async ({ page }) => {
    test.skip(process.env.HELM_E2E_VISUAL_SURFACE !== 'life-hero', 'Life Hero visual capture only.');

    await page.emulateMedia({ reducedMotion: 'no-preference' });
    await page.setViewportSize({ width: 1440, height: 900 });
    await page.goto(CONCEPT_PATH);
    await waitForModel(page);
    await page.evaluate(() => {
      const viewer = (window as typeof window & {
        lifeHeroViewer: { setSampleTime: (seconds: number) => boolean };
      }).lifeHeroViewer;
      viewer.setSampleTime(0.7);
      (document.activeElement as HTMLElement | null)?.blur();
      window.scrollTo(0, 0);
    });
    await page.screenshot({ path: path.join(EVIDENCE_DIRECTORY, 'life-hero-desktop-1440x900.png') });
    await page.getByTestId('avatar-stage').screenshot({
      path: path.join(EVIDENCE_DIRECTORY, 'life-hero-idle-jacket-frame.png'),
    });
    await page.getByTestId('avatar-stage').screenshot({
      path: path.join(EVIDENCE_DIRECTORY, 'life-hero-jacket-on.png'),
    });

    await page.getByRole('button', { name: 'Graphite jacket · GLB', exact: true }).click();
    await page.getByTestId('avatar-stage').screenshot({
      path: path.join(EVIDENCE_DIRECTORY, 'life-hero-jacket-off.png'),
    });
    await page.getByTestId('avatar-stage').screenshot({
      path: path.join(EVIDENCE_DIRECTORY, 'life-hero-full-body.png'),
    });

    for (const [buttonName, fileName] of [
      ['Face front', 'life-hero-face-front.png'],
      ['Face ¾', 'life-hero-face-three-quarter.png'],
    ] as const) {
      await page.getByRole('button', { name: buttonName, exact: true }).click();
      await page.getByTestId('avatar-stage').screenshot({
        path: path.join(EVIDENCE_DIRECTORY, fileName),
      });
    }

    await page.getByRole('button', { name: 'Motivate', exact: true }).click();
    await page.evaluate(() => {
      const viewer = (window as typeof window & {
        lifeHeroViewer: { setSampleTime: (seconds: number) => boolean };
      }).lifeHeroViewer;
      viewer.setSampleTime(6);
    });
    await page.getByRole('button', { name: 'Left hand', exact: true }).click();
    await page.getByTestId('avatar-stage').screenshot({
      path: path.join(EVIDENCE_DIRECTORY, 'life-hero-left-hand.png'),
    });

    await page.evaluate(() => {
      const viewer = (window as typeof window & {
        lifeHeroViewer: { setSampleTime: (seconds: number) => boolean };
      }).lifeHeroViewer;
      viewer.setSampleTime(4.5);
    });
    await page.getByRole('button', { name: 'Right hand', exact: true }).click();
    await page.getByTestId('avatar-stage').screenshot({
      path: path.join(EVIDENCE_DIRECTORY, 'life-hero-right-hand.png'),
    });

    await page.getByRole('button', { name: 'Full body', exact: true }).click();
    await page.getByRole('button', { name: 'Graphite jacket · GLB', exact: true }).click();
    await page.getByTestId('avatar-stage').screenshot({
      path: path.join(EVIDENCE_DIRECTORY, 'life-hero-cheer-jacket-frame.png'),
    });

    await page.setViewportSize({ width: 390, height: 844 });
    await page.goto(CONCEPT_PATH);
    await waitForModel(page);
    await page.evaluate(() => {
      const viewer = (window as typeof window & {
        lifeHeroViewer: { setSampleTime: (seconds: number) => boolean };
      }).lifeHeroViewer;
      viewer.setSampleTime(0.7);
      (document.activeElement as HTMLElement | null)?.blur();
      window.scrollTo(0, 0);
    });
    await page.screenshot({ path: path.join(EVIDENCE_DIRECTORY, 'life-hero-mobile-390x844.png') });

    const reducedPage = await page.context().newPage();
    await reducedPage.emulateMedia({ reducedMotion: 'reduce' });
    await reducedPage.setViewportSize({ width: 390, height: 844 });
    await reducedPage.goto(`${CONCEPT_PATH}?evidence=reduced`);
    await reducedPage.getByRole('button', { name: 'Low momentum' }).click();
    await reducedPage.evaluate(() => {
      (document.activeElement as HTMLElement | null)?.blur();
      window.scrollTo(0, 0);
    });
    await reducedPage.screenshot({ path: path.join(EVIDENCE_DIRECTORY, 'life-hero-reduced-motion-390x844.png') });
    await reducedPage.close();
  });
});
