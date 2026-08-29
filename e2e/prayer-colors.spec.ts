import { expect, test } from './support/helm-fixture';

const EXPECTED_PRAYER_COLORS = [
  ['Fajr', 'rgb(242, 184, 102)'],
  ['Dhuhr', 'rgb(241, 210, 118)'],
  ['Asr', 'rgb(242, 154, 96)'],
  ['Maghrib', 'rgb(200, 184, 255)'],
  ['Isha', 'rgb(142, 157, 245)'],
] as const;

function requestedViewports(): string[] {
  return (process.env.HELM_E2E_VISUAL_VIEWPORTS || '390x844,1440x900')
    .split(',')
    .map(value => value.trim())
    .filter(value => /^\d+x\d+$/u.test(value));
}

test('renders distinct prayer identity colors without changing next-prayer semantics @visual', async ({ page, scenario }) => {
  test.skip(
    Boolean(process.env.HELM_E2E_VISUAL_SURFACE && process.env.HELM_E2E_VISUAL_SURFACE !== 'dashboard'),
    'A different visual surface was requested.',
  );

  await scenario({
    now: '2026-08-29T11:00:00.000Z',
    settings: {
      prayerEnabled: true,
      prayerCity: 'Bedford',
      prayerCountry: 'United Kingdom',
    },
  });

  for (const viewport of requestedViewports()) {
    const [width, height] = viewport.split('x').map(Number);
    await page.setViewportSize({ width, height });
    await page.goto('/');

    const dashboard = page.getByRole('region', { name: 'Night Compass daily dashboard' });
    await expect(dashboard).toBeVisible();
    await expect(dashboard.locator('.nc-prayer-symbol')).toHaveCount(5);
    await expect(dashboard.locator('.nc-prayer-symbol[aria-hidden="true"]')).toHaveCount(5);
    const nextPrayer = dashboard.getByRole('button', { name: 'Complete Dhuhr Prayer' });
    await expect(nextPrayer).toHaveAttribute('aria-current', 'true');
    await expect(nextPrayer).toHaveClass(/temporal-next/u);
    await expect(nextPrayer).toContainText('Next');

    const colors = await dashboard.locator('.nc-prayer-symbol').evaluateAll(elements => elements.map(element => ({
      name: element.getAttribute('data-prayer'),
      color: getComputedStyle(element).color,
    })));
    expect(colors).toEqual(EXPECTED_PRAYER_COLORS.map(([name, color]) => ({ name, color })));
    expect(new Set(colors.map(({ color }) => color)).size).toBe(5);

    const layoutWidth = await page.evaluate(() => ({
      client: document.documentElement.clientWidth,
      scroll: document.documentElement.scrollWidth,
    }));
    expect(layoutWidth.scroll).toBeLessThanOrEqual(layoutWidth.client + 1);

    await page.screenshot({ path: test.info().outputPath(`prayer-colors-${viewport}.png`) });
  }
});
