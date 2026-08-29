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

test('visually distinguishes prayed, missed, current, next, and upcoming prayers @visual', async ({ page, scenario }) => {
  test.skip(
    Boolean(process.env.HELM_E2E_VISUAL_SURFACE && process.env.HELM_E2E_VISUAL_SURFACE !== 'dashboard'),
    'A different visual surface was requested.',
  );

  await scenario({
    now: '2026-08-29T16:00:00.000Z',
    settings: {
      prayerEnabled: true,
      prayerCity: 'Bedford',
      prayerCountry: 'United Kingdom',
    },
    stores: {
      prayerTracking: {
        schemaVersion: 1,
        trackingStartedAt: '2026-08-29T00:00:00.000Z',
        records: {
          '2026-08-29::Fajr': {
            date: '2026-08-29',
            prayerName: 'Fajr',
            status: 'on_time',
            recordedAt: '2026-08-29T04:30:00.000Z',
            source: 'dashboard',
          },
          '2026-08-29::Dhuhr': {
            date: '2026-08-29',
            prayerName: 'Dhuhr',
            status: 'missed',
            recordedAt: '2026-08-29T15:30:00.000Z',
            source: 'system',
          },
        },
        reminderReceipts: {},
        boundedReminderReceipts: {},
      },
    },
  });

  for (const viewport of requestedViewports()) {
    const [width, height] = viewport.split('x').map(Number);
    await page.setViewportSize({ width, height });
    await page.emulateMedia({ reducedMotion: 'reduce' });
    await page.goto('/');

    const dashboard = page.getByRole('region', { name: 'Night Compass daily dashboard' });
    await expect(dashboard).toBeVisible();
    const statuses = dashboard.locator('.nc-prayer-item');
    await expect(statuses).toHaveCount(5);

    const expectedStates = [
      ['Fajr', 'on_time', '✓', 'Prayed', 'rgb(113, 231, 183)'],
      ['Dhuhr', 'missed', '×', 'Missed', 'rgb(255, 170, 170)'],
      ['Asr', 'current', '●', 'Now', 'rgb(124, 236, 192)'],
      ['Maghrib', 'next', '→', 'Next', 'rgb(181, 194, 255)'],
      ['Isha', 'upcoming', '○', 'Upcoming', 'rgb(189, 201, 220)'],
    ] as const;

    for (const [name, state, icon, label, color] of expectedStates) {
      const prayer = dashboard.locator(`.nc-prayer-item:has(.nc-prayer-symbol[data-prayer="${name}"])`);
      await expect(prayer).toHaveAttribute('data-prayer-status', state);
      await expect(prayer.locator('.nc-prayer-state-icon')).toHaveText(icon);
      await expect(prayer.locator('.nc-prayer-state')).toContainText(label);
      await expect(prayer.locator('.nc-prayer-state')).toHaveCSS('color', color);
    }

    await expect(dashboard.getByRole('button', { name: 'Fajr Prayer — confirmed, Prayed on time' })).toBeDisabled();
    await expect(dashboard.getByRole('button', { name: 'Complete Dhuhr Prayer — Missed, not confirmed' })).toBeEnabled();
    await expect(dashboard.getByRole('button', { name: 'Complete Asr Prayer — Current prayer' })).toHaveAttribute('aria-current', 'true');

    const cardGeometry = await statuses.evaluateAll(elements => elements.map(element => {
      const rect = element.getBoundingClientRect();
      return { height: rect.height, top: rect.top };
    }));
    expect(new Set(cardGeometry.map(({ height: cardHeight }) => cardHeight)).size).toBe(1);
    expect(new Set(cardGeometry.map(({ top }) => top)).size).toBe(1);

    const distinctStatusColors = await statuses.locator('.nc-prayer-state').evaluateAll(elements =>
      elements.map(element => getComputedStyle(element).color)
    );
    expect(new Set(distinctStatusColors).size).toBeGreaterThanOrEqual(4);

    const statusOverflow = await statuses.locator('.nc-prayer-state').evaluateAll(elements =>
      elements.map(element => element.scrollWidth - element.clientWidth)
    );
    expect(Math.max(...statusOverflow)).toBeLessThanOrEqual(1);

    const layoutWidth = await page.evaluate(() => ({
      client: document.documentElement.clientWidth,
      scroll: document.documentElement.scrollWidth,
    }));
    expect(layoutWidth.scroll).toBeLessThanOrEqual(layoutWidth.client + 1);

    const currentPrayer = dashboard.getByRole('button', { name: 'Complete Asr Prayer — Current prayer' });
    await currentPrayer.focus();
    await expect(currentPrayer).toBeFocused();
    const focusOutline = await currentPrayer.evaluate(element => getComputedStyle(element).outlineWidth);
    expect(focusOutline).toBe('2px');
    await currentPrayer.blur();

    await page.screenshot({ path: test.info().outputPath(`prayer-statuses-${viewport}.png`) });
  }
});
