import { createHash } from 'node:crypto';
import { readFile } from 'node:fs/promises';
import path from 'node:path';

import { expect, test } from '@playwright/test';

import { inspectLifeHeroGlb, REQUIRED_LIFE_HERO_CLIPS } from '../scripts/inspect-life-hero-glb.mjs';
import { readGlb } from '../scripts/lib/glb.mjs';

const CONCEPT_PATH = 'concepts/life-hero/index.html';
const EVIDENCE_DIRECTORY = path.resolve('docs/design/evidence');
const MODEL_PATH = path.resolve('public/concepts/life-hero/assets/life-hero-modular.glb');
const FALLBACK_PATH = path.resolve('public/concepts/life-hero/assets/life-hero-modular-fallback.glb');

async function fileSha256(filePath: string) {
  return createHash('sha256').update(await readFile(filePath)).digest('hex');
}

async function waitForModel(page: import('@playwright/test').Page) {
  page.setDefaultTimeout(120_000);
  await expect(page.getByTestId('avatar-stage')).toHaveAttribute('data-model-state', 'ready', {
    timeout: 60_000,
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

async function forcePrimaryQuality(page: import('@playwright/test').Page) {
  await page.addInitScript(() => {
    Object.defineProperty(navigator, 'deviceMemory', { configurable: true, value: 8 });
    Object.defineProperty(navigator, 'hardwareConcurrency', { configurable: true, value: 8 });
  });
}

test.describe('Life Hero maximum-quality GLB proof', () => {
  test.describe.configure({ timeout: 120_000 });

  test('exports maximum-quality body and separate jacket on one skin with four exact clips', async () => {
    const inspection = await inspectLifeHeroGlb(MODEL_PATH);

    expect(inspection.valid, inspection.errors.join('\n')).toBe(true);
    expect(inspection.summary.meshNodes).toEqual(expect.arrayContaining([
      expect.objectContaining({ name: 'LifeHero_BaseBody', mesh: 0, skin: 0 }),
      expect.objectContaining({ name: 'LifeHero_Jacket', mesh: 1, skin: 0 }),
    ]));
    expect(inspection.summary.skins).toEqual([expect.objectContaining({ index: 0, joints: 24 })]);
    expect(inspection.summary.animations.map(animation => animation.name)).toEqual(REQUIRED_LIFE_HERO_CLIPS);
    expect(inspection.baseGeometry).toEqual({ vertices: 332_478, triangles: 597_811 });
    expect(inspection.jacketGeometry).toEqual({ vertices: 105_602, triangles: 200_503 });
    expect(inspection.jacketWeightCopiesVerified).toBe(true);
    expect(inspection.immutableVerified).toBe(true);
    expect(inspection.material).toMatchObject({
      base: 'LifeHero_MaxQuality_PBR',
      jacket: 'LifeHero_Jacket_Graphite_Concept',
      baseOpaque: true,
      baseEmissive: false,
    });
    expect(inspection.textureDeduplication).toMatchObject({
      algorithm: 'pixel-identical-embedded-image-dedup-v1',
      retainedResolution: '8192x8192',
      retainedBytes: 40_334_317,
      removedBytes: 40_334_251,
    });
  });

  test('retains exact native source receipt and the constrained-device fallback', async () => {
    const candidate = await readGlb(MODEL_PATH);
    const extras = candidate.json.asset.extras;
    expect(extras.sourceMergedAnimationsSha256)
      .toBe('9b850b4c61287c240d34bdb70da496255c68cd91cdf82f3152767677c664cd91');
    expect(extras.immutableAccessors).toEqual({
      positionSha256: 'b02f27db08da2c579555bd0c70281dab9ffb686f09e2e09cf30e61dc361cfc9b',
      normalSha256: 'b507c227f2eabbb33f956fff65ef10152ec390127f9879e159f976b7e8ff000b',
      jointsSha256: '6c1bb6ac3020d342085cb52025b6c1ae94d0e14449b4874cea29e7f519ecd671',
      weightsSha256: 'a7f139021dfc2d669a25fd5adfd2c3879ac15d2431980842237d94cdb2080295',
      inverseBindMatricesSha256: 'cd44f33b70aa6de0be661a7e2482a8685867f12ee86633d4c3e41afb80972a4e',
      indicesSha256: 'bf1cfae3d4f08fc5167de5eebe43d60b01a180c6241efdf827db6f496732c760',
    });
    const fallback = await inspectLifeHeroGlb(FALLBACK_PATH);
    expect(fallback.valid).toBe(true);
    expect(fallback.qualityTier).toBe('legacy-fallback');
    expect(fallback.summary.skins).toEqual([expect.objectContaining({ joints: 24 })]);
    expect(fallback.summary.animations.map(animation => animation.name)).toEqual(REQUIRED_LIFE_HERO_CLIPS);
    expect(await fileSha256(FALLBACK_PATH)).toBe('3f507f356a5aa59ad2cff06be2bcfb4d9cec5a43fbd25721127e2407d6e7542e');
  });

  test('renders the actual maximum-quality GLB and toggles the jacket without replacing the body', async ({ page }) => {
    test.setTimeout(240_000);
    await forcePrimaryQuality(page);
    await page.setViewportSize({ width: 1440, height: 900 });
    await page.goto(CONCEPT_PATH);
    await waitForModel(page);

    await expect(page.getByRole('heading', { name: 'A real hero, a separate jacket' })).toBeVisible();
    await expect(page.getByText('This image is not a 3D model.')).toBeVisible();
    await expect.poll(() => readViewerState(page), { timeout: 30_000 }).toMatchObject({
      activeClip: 'Idle_02',
      jacketVisible: true,
      loaded: true,
      qualityTier: 'max-quality-primary',
      materialRegions: ['LifeHero_MaxQuality_PBR'],
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
      await page.getByRole('button', { name: buttonName, exact: true }).click({ force: true });
      await expect.poll(() => readViewerState(page)).toMatchObject({ view });
    }
  });

  test('selects every concept motion through the preserved embedded clips', async ({ page }) => {
    await page.setViewportSize({ width: 1440, height: 900 });
    await page.goto(CONCEPT_PATH);
    await waitForModel(page);
    for (const [buttonName, clip] of [
      ['Motivate', 'Motivational_Cheer'],
      ['Focus', 'Walking'],
      ['Train', 'Running'],
      ['Low momentum', 'Idle_02'],
      ['Idle', 'Idle_02'],
    ] as const) {
      await page.getByRole('button', { name: buttonName, exact: true }).click({ force: true });
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

  test('automatically selects the retained fallback on constrained hardware', async ({ page }) => {
    await page.addInitScript(() => {
      Object.defineProperty(navigator, 'deviceMemory', { configurable: true, value: 2 });
      Object.defineProperty(navigator, 'hardwareConcurrency', { configurable: true, value: 2 });
    });
    await page.setViewportSize({ width: 390, height: 844 });
    await page.goto(CONCEPT_PATH);
    await waitForModel(page);
    await expect.poll(() => readViewerState(page)).toMatchObject({ qualityTier: 'constrained-fallback', loaded: true });
    await expect(page.getByTestId('viewer-status')).toContainText('Constrained-device');
  });

  test('keeps actual model controls usable at mobile width', async ({ page }) => {
    await page.setViewportSize({ width: 390, height: 844 });
    await page.goto(CONCEPT_PATH);
    await waitForModel(page);
    await page.getByRole('button', { name: 'Graphite jacket · GLB', exact: true }).click();
    await page.getByRole('button', { name: 'Focus', exact: true }).click();
    await expect(page.getByTestId('avatar-stage')).toHaveAttribute('data-active-clip', 'Walking');
    await expect.poll(() => readViewerState(page)).toMatchObject({ jacketVisible: false, activeClip: 'Walking' });
    const hasHorizontalOverflow = await page.evaluate(() => document.documentElement.scrollWidth > document.documentElement.clientWidth);
    expect(hasHorizontalOverflow).toBe(false);
    const scrollBefore = await page.evaluate(() => window.scrollY);
    await page.mouse.wheel(0, 620);
    await expect.poll(() => page.evaluate(() => window.scrollY)).toBeGreaterThan(scrollBefore);
  });

  test('@visual captures KAN-257 maximum-quality desktop, anatomy, jacket, motion, mobile, and fallback evidence', async ({ page }) => {
    test.setTimeout(120_000);
    test.skip(process.env.HELM_E2E_VISUAL_SURFACE !== 'life-hero', 'Life Hero visual capture only.');
    await page.emulateMedia({ reducedMotion: 'no-preference' });
    await page.setViewportSize({ width: 1440, height: 900 });
    await page.goto(CONCEPT_PATH);
    await waitForModel(page);
    await page.evaluate(() => {
      const viewer = (window as typeof window & { lifeHeroViewer: { setSampleTime: (seconds: number) => boolean } }).lifeHeroViewer;
      viewer.setSampleTime(0.7);
      (document.activeElement as HTMLElement | null)?.blur();
      window.scrollTo(0, 0);
    });
    await page.screenshot({ path: path.join(EVIDENCE_DIRECTORY, 'life-hero-desktop-1440x900.png') });
    await page.getByTestId('avatar-stage').screenshot({ path: path.join(EVIDENCE_DIRECTORY, 'life-hero-idle-jacket-frame.png') });
    await page.getByTestId('avatar-stage').screenshot({ path: path.join(EVIDENCE_DIRECTORY, 'life-hero-jacket-on.png') });
    await page.getByRole('button', { name: 'Graphite jacket · GLB', exact: true }).click();
    await page.getByTestId('avatar-stage').screenshot({ path: path.join(EVIDENCE_DIRECTORY, 'life-hero-jacket-off.png') });
    await page.getByTestId('avatar-stage').screenshot({ path: path.join(EVIDENCE_DIRECTORY, 'life-hero-full-body.png') });
    for (const [buttonName, fileName] of [['Face front', 'life-hero-face-front.png'], ['Face ¾', 'life-hero-face-three-quarter.png']] as const) {
      await page.getByRole('button', { name: buttonName, exact: true }).click({ force: true });
      await page.getByTestId('avatar-stage').screenshot({ path: path.join(EVIDENCE_DIRECTORY, fileName) });
    }
    await page.getByRole('button', { name: 'Motivate', exact: true }).click();
    await page.evaluate(() => {
      const viewer = (window as typeof window & { lifeHeroViewer: { setSampleTime: (seconds: number) => boolean } }).lifeHeroViewer;
      viewer.setSampleTime(6);
    });
    await page.getByRole('button', { name: 'Left hand', exact: true }).click();
    await page.getByTestId('avatar-stage').screenshot({ path: path.join(EVIDENCE_DIRECTORY, 'life-hero-left-hand.png') });
    await page.evaluate(() => {
      const viewer = (window as typeof window & { lifeHeroViewer: { setSampleTime: (seconds: number) => boolean } }).lifeHeroViewer;
      viewer.setSampleTime(4.5);
    });
    await page.getByRole('button', { name: 'Right hand', exact: true }).click();
    await page.getByTestId('avatar-stage').screenshot({ path: path.join(EVIDENCE_DIRECTORY, 'life-hero-right-hand.png') });
    await page.getByRole('button', { name: 'Full body', exact: true }).click();
    await page.getByRole('button', { name: 'Graphite jacket · GLB', exact: true }).click();
    await page.getByTestId('avatar-stage').screenshot({ path: path.join(EVIDENCE_DIRECTORY, 'life-hero-cheer-jacket-frame.png') });
    await page.setViewportSize({ width: 390, height: 844 });
    await page.goto(CONCEPT_PATH);
    await waitForModel(page);
    await page.evaluate(() => {
      const viewer = (window as typeof window & { lifeHeroViewer: { setSampleTime: (seconds: number) => boolean } }).lifeHeroViewer;
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
