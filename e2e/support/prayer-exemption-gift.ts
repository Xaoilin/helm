import { expect, type Locator, type Page } from '@playwright/test';

export async function verifyPrayerGiftMotion(page: Page, player: Locator, screenshotPrefix: string) {
  const heading = player.getByRole('heading', { name: 'هدية من الله', exact: true });
  const art = player.locator('.prayer-challenge-gift-art');
  const illustration = art.locator('img');
  const sparkles = art.getByText('✨', { exact: true });
  const pause = player.getByRole('button', { name: 'إيقاف الحركة مؤقتًا', exact: true });
  const resume = player.getByRole('button', { name: 'استئناف الحركة', exact: true });
  await expect(heading).toBeVisible();
  await expect(player).toHaveAttribute('lang', 'ar');
  await expect(player).toHaveAttribute('dir', 'rtl');
  await expect(art).toHaveAttribute('aria-hidden', 'true');
  await expect(illustration).toHaveJSProperty('naturalWidth', 384);
  await expect(art.getByText('💕', { exact: true })).toBeVisible();
  await expect(sparkles).toBeVisible();

  const readFrame = (seek: number | null = null) => art.evaluate((stage, phase) => {
    const image = stage.querySelector('img')!;
    const star = stage.querySelector('.prayer-challenge-gift-sparkles')!;
    if (phase !== null) {
      for (const animation of stage.getAnimations({ subtree: true })) {
        const duration = animation.effect?.getTiming().duration;
        if (typeof duration === 'number') animation.currentTime = duration * phase;
      }
    }
    const halo = getComputedStyle(stage, '::before');
    const reflection = getComputedStyle(stage, '::after');
    const float = image.getAnimations()[0];
    return {
      lift: image.getBoundingClientRect().top - stage.getBoundingClientRect().top,
      glow: Number(halo.opacity),
      groundLight: Number(reflection.opacity),
      twinkle: getComputedStyle(star).transform,
      iteration: float?.effect?.getComputedTiming().currentIteration ?? null,
    };
  }, seek);

  await page.emulateMedia({ reducedMotion: 'reduce' });
  await expect(illustration).toHaveCSS('animation-name', 'none');
  await expect(pause).toBeHidden();
  const reduced = await readFrame();
  expect(reduced.glow).toBeGreaterThan(.5);

  await page.emulateMedia({ reducedMotion: 'no-preference' });
  await expect(illustration).toHaveCSS('animation-iteration-count', 'infinite');
  await expect(sparkles).toHaveCSS('animation-name', 'prayer-challenge-gift-twinkle');
  await pause.focus();
  await page.keyboard.press('Space');
  await expect(resume).toBeFocused();
  await expect(illustration).toHaveCSS('animation-play-state', 'paused');
  const frozen = await art.evaluate(async stage => {
    const animations = stage.getAnimations({ subtree: true });
    await Promise.all(animations.map(animation => animation.ready));
    const before = animations.map(animation => animation.currentTime);
    await new Promise<void>(done => requestAnimationFrame(() => requestAnimationFrame(() => done())));
    return { before, after: animations.map(animation => animation.currentTime) };
  });
  expect(frozen.before).toHaveLength(5);
  expect(frozen.after).toEqual(frozen.before);

  const headingBounds = await heading.boundingBox();
  const rest = await readFrame(0);
  expect(rest.glow).toBeCloseTo(reduced.glow);
  await page.screenshot({ path: `${screenshotPrefix}-rest.png` });
  const peak = await readFrame(.25);
  expect(rest.lift - peak.lift).toBeGreaterThan(4);
  expect(peak.glow - rest.glow).toBeGreaterThan(.2);
  expect(peak.groundLight - rest.groundLight).toBeGreaterThan(.2);
  expect(peak.twinkle).not.toBe(rest.twinkle);
  expect(await heading.boundingBox()).toEqual(headingBounds);
  await page.screenshot({ path: `${screenshotPrefix}-peak.png` });

  const settled = await readFrame(.85);
  expect(settled.lift).toBeCloseTo(rest.lift);
  expect(settled.glow).toBeCloseTo(rest.glow);
  const repeat = await readFrame(1.25);
  expect(repeat.iteration).toBe(1);
  expect(repeat.lift).toBeCloseTo(peak.lift);
  expect(repeat.glow).toBeCloseTo(peak.glow);
  expect(repeat.twinkle).toBe(peak.twinkle);

  await readFrame(.96);
  await page.keyboard.press('Enter');
  await expect(pause).toBeFocused();
  await expect(illustration).toHaveCSS('animation-play-state', 'running');
  await expect.poll(async () => (await readFrame()).iteration).toBe(1);

  await page.emulateMedia({ reducedMotion: 'reduce' });
  await expect(illustration).toHaveCSS('animation-name', 'none');
  await expect(pause).toBeHidden();
  expect((await readFrame()).glow).toBeCloseTo(rest.glow);
}
