import { expect, openApp, test } from './support/helm-fixture';

function requestedViewports(): string[] {
  return (process.env.HELM_E2E_VISUAL_VIEWPORTS || '390x844,1440x900')
    .split(',')
    .map(value => value.trim())
    .filter(value => /^\d+x\d+$/u.test(value));
}

test.describe('Life Hero dashboard companion', () => {
  test('shows the permanent progression model in an unobtrusive desktop companion', async ({ page, scenario }) => {
    await page.setViewportSize({ width: 1440, height: 900 });
    await scenario();
    await openApp(page);

    const hero = page.getByRole('complementary', { name: 'Life Hero' });
    await expect(hero).toBeVisible();
    await expect(hero.getByText('Overall level')).toBeVisible();
    await expect(hero.getByText('Best active momentum')).toBeVisible();
    await expect(hero.getByText('7 days')).toBeVisible();

    await hero.getByRole('button', { name: 'Open hero details' }).click();
    await expect(hero.locator('.life-hero-stat-list > li')).toHaveCount(7);
    await expect(hero.getByText('Ready to renew')).toBeVisible();
    await expect(hero.getByText('First step ready')).toBeVisible();
    await expect(hero.getByRole('switch', { name: /Training jacket/ })).toBeDisabled();
    await expect(hero.getByText('No progress loss')).toBeVisible();

    expect(await page.evaluate(() => document.documentElement.scrollWidth <= window.innerWidth)).toBe(true);
    await hero.getByRole('button', { name: 'Hide Life Hero companion' }).click();
    await expect(page.getByRole('button', { name: /Show Life Hero companion, level 2/ })).toBeVisible();
  });

  test('uses a compact mobile disclosure after the primary dashboard content', async ({ page, scenario }) => {
    await page.setViewportSize({ width: 390, height: 844 });
    await scenario();
    await openApp(page);

    const showHero = page.getByRole('button', { name: /Show Life Hero companion, level 2/ });
    await expect(showHero).toBeVisible();
    const heroAfterPrayer = await page.locator('.nc-prayer-card').evaluate((prayer, selector) => {
      const hero = document.querySelector(selector);
      return Boolean(hero && (prayer.compareDocumentPosition(hero) & Node.DOCUMENT_POSITION_FOLLOWING));
    }, '.life-hero-companion');
    expect(heroAfterPrayer).toBe(true);

    await showHero.focus();
    await expect(showHero).toBeFocused();
    await page.keyboard.press('Enter');
    const hero = page.getByRole('complementary', { name: 'Life Hero' });
    await hero.scrollIntoViewIfNeeded();
    await expect(hero.getByRole('img', { name: 'Original Life Hero standing in a ready pose' })).toBeVisible();
    await expect(hero.getByRole('button', { name: 'Open hero details' })).toBeVisible();
    expect(await page.evaluate(() => document.documentElement.scrollWidth <= window.innerWidth)).toBe(true);
  });

  test('honours reduced motion with a static equivalent and no movement controls', async ({ page, scenario }) => {
    await page.setViewportSize({ width: 1024, height: 900 });
    await page.emulateMedia({ reducedMotion: 'reduce' });
    await scenario();
    await openApp(page);

    const hero = page.getByRole('complementary', { name: 'Life Hero' });
    await expect(hero.getByRole('img', { name: 'Original Life Hero standing in a ready pose' })).toBeVisible();
    await expect(hero.locator('canvas')).toHaveCount(0);
    await hero.getByRole('button', { name: 'Open hero details' }).click();
    await expect(hero.getByRole('heading', { name: 'Movement' })).toHaveCount(0);
  });

  test('fails closed on an invalid snapshot without replacing Prayer', async ({ page, scenario }) => {
    await page.setViewportSize({ width: 1440, height: 900 });
    await scenario({
      lifeHero: {
        snapshot: {
          rulesetVersion: 'life-hero-v1',
          totalXp: 500,
          overallLevel: 3,
          updatedAt: '2026-08-30T07:00:00.000Z',
          recomputedAt: '2026-08-30T07:00:00.000Z',
          stats: Array.from({ length: 7 }, () => ({
            stat: 'faith',
            totalXp: 'not-a-number',
            level: 2,
            lastEvidenceLocalDate: null,
            condition: 'steady',
            attentionAfterDays: 1,
          })),
          recentActivity: [],
        },
      },
    });
    await openApp(page);

    await expect(page.getByRole('heading', { name: 'Prayer', exact: true })).toBeVisible();
    const hero = page.getByRole('complementary', { name: 'Life Hero' });
    await expect(hero.getByRole('alert')).toContainText('Your stored progress is safe');
    await expect(hero.getByText('Overall level')).toHaveCount(0);
  });
});

test('captures the actual maximum-quality dashboard avatar at desktop and mobile widths @visual', async ({ page, scenario }) => {
  test.setTimeout(180_000);
  test.skip(
    process.env.HELM_E2E_VISUAL_SURFACE !== 'life-hero-dashboard',
    'Life Hero dashboard visual capture only.',
  );
  await page.addInitScript(() => {
    Object.defineProperty(navigator, 'webdriver', { configurable: true, value: false });
    Object.defineProperty(navigator, 'deviceMemory', { configurable: true, value: 8 });
    Object.defineProperty(navigator, 'hardwareConcurrency', { configurable: true, value: 8 });
  });
  await scenario();

  for (const viewport of requestedViewports()) {
    const [width, height] = viewport.split('x').map(Number);
    await page.setViewportSize({ width, height });
    await page.goto('/');
    if (width <= 900) {
      const collapsed = page.getByRole('button', { name: /Show Life Hero companion/ });
      await expect(collapsed).toBeVisible();
      await collapsed.click();
    }

    const hero = page.locator('aside.life-hero-companion:not(.is-collapsed)');
    await expect(hero).toBeVisible();
    await expect(hero).toHaveAttribute('data-avatar-status', 'ready', { timeout: 120_000 });
    await hero.getByRole('button', { name: 'Open hero details' }).click();
    await expect(hero.getByRole('switch', { name: /Training jacket/ })).toBeEnabled();
    expect(await page.evaluate(() => document.documentElement.scrollWidth <= window.innerWidth)).toBe(true);
    await page.screenshot({ path: test.info().outputPath(`life-hero-dashboard-${viewport}.png`) });
  }
});
