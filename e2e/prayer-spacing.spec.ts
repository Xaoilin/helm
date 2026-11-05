import { expect, test } from './support/helm-fixture';

test('prayer timeline has room around its rail, cards and caption', async ({ page, scenario }) => {
  await scenario({
    now: '2026-08-29T16:00:00.000Z',
    settings: { prayerEnabled: true, prayerCity: 'Bedford', prayerCountry: 'United Kingdom' },
  });

  for (const width of [320, 390, 768, 1440, 2560]) {
    await page.setViewportSize({ width, height: 1000 });
    await page.emulateMedia({ reducedMotion: 'reduce' });
    await page.goto('/');
    const timeline = page.locator('.nc-prayer-timeline');
    await expect(timeline.locator('.nc-now-marker')).toBeVisible();
    await expect(page.locator('.nc-next-prayer small')).toContainText('On time until');

    const geometry = await page.locator('.nc-prayer-card').evaluate(card => {
      const bounds = (selector: string) => card.querySelector(selector)!.getBoundingClientRect();
      const rail = bounds('.nc-prayer-rail');
      const sequence = bounds('.nc-prayer-sequence');
      const items = [...card.querySelectorAll('.nc-prayer-item')].map(item => item.getBoundingClientRect());
      const marker = card.querySelector('.nc-now-marker') as HTMLElement;
      // Exercise the largest marker the existing progress animation can display.
      marker.style.transition = 'none';
      marker.style.setProperty('--nc-marker-size', '18px');
      return {
        headingGap: rail.top - bounds('.nc-next-prayer').bottom,
        markerGap: sequence.top - marker.getBoundingClientRect().bottom,
        captionGap: bounds('.nc-prayer-timeline-caption').top - sequence.bottom,
        cardGaps: items.slice(1).map((item, index) => item.left - items[index].right),
        topPadding: bounds('.nc-prayer-name').top - items[0].top,
        bottomPadding: items[0].bottom - bounds('.nc-prayer-state').bottom,
        overflow: document.documentElement.scrollWidth - document.documentElement.clientWidth,
      };
    });

    expect(geometry.headingGap, `heading gap at ${width}px`).toBeGreaterThanOrEqual(24);
    expect(geometry.markerGap, `marker clearance at ${width}px`).toBeGreaterThanOrEqual(8);
    expect(geometry.captionGap, `caption gap at ${width}px`).toBeGreaterThanOrEqual(12);
    expect(Math.round(Math.min(...geometry.cardGaps) * 1000) / 1000, `card gaps at ${width}px`).toBeGreaterThanOrEqual(width <= 760 ? 4 : 12);
    expect(geometry.topPadding).toBeGreaterThanOrEqual(12);
    expect(geometry.bottomPadding).toBeGreaterThanOrEqual(12);
    expect(geometry.overflow).toBeLessThanOrEqual(1);
    await page.locator('.nc-prayer-card').screenshot({ path: test.info().outputPath(`prayer-spacing-${width}.png`) });
  }
});
