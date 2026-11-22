import { expect, openApp, test } from './support/helm-fixture';
import { makeTask } from '../src/test/fixtures';

test('restored prayer history fits the dashboard and keeps every correction reachable', async ({ page, scenario }, testInfo) => {
  const date = '2026-11-22';
  const now = date + 'T21:20:00Z';
  const control = await scenario({
    now,
    settings: { prayerEnabled: true },
    prayer: { timings: { Maghrib: '16:10', Isha: '18:00' } },
    services: { viewPreferences: { 'dashboard.showPrayerLog': 'true' } },
    stores: { tasks: [makeTask({ title: 'Follow up https://example.test/' + 'long-reference-'.repeat(12), dueDate: date })] },
  });
  control.services.tracking = {
    trackingStartedAt: '2026-11-01T00:00:00Z', activationDate: null, activationPrayers: [], importedAt: null,
  };
  control.services.outcomes.set(date + '::Fajr', {
    id: '0a1b2c3d-4e5f-4a6b-8c7d-9e0f1a2b3c4d', date, prayer: 'Fajr', status: 'on_time',
    recordedAt: date + 'T05:00:00Z', source: 'dashboard', taskId: null, rewarded: true, deadlineAt: null,
  });
  await page.route('**/api/prayer/v1/competition?*', route => {
    const query = new URL(route.request().url()).searchParams;
    const summary = { from: query.get('from'), to: query.get('to'), asOf: now, onTime: 12, late: 2, missed: 3 };
    return route.fulfill({ json: { status: 'ready', self: summary, partner: { ...summary, onTime: 10, missed: 5 } } });
  });
  await page.setViewportSize({ width: 393, height: 852 });
  await openApp(page);

  const dashboard = page.getByRole('region', { name: 'Night Compass daily dashboard' });
  const table = dashboard.getByRole('table', { name: 'Prayer correction history' });
  const challenge = dashboard.getByRole('region', { name: 'Prayer challenge' });
  await expect(table.getByRole('combobox')).toHaveCount(35);
  await expect(challenge).toContainText('Sabah is leading');

  for (const width of [393, 320, 360, 390, 430, 768, 1440]) {
    await page.setViewportSize({ width, height: width <= 430 ? 852 : 900 });
    const outside = await dashboard.evaluate(grid => {
      const area = grid.getBoundingClientRect();
      const elements = [
        ...grid.children,
        ...grid.querySelectorAll('.nc-prayer-location, .nc-next-prayer time, .nc-prayer-item, .prayer-challenge-player, .nc-momentum-card, .prayer-history-status'),
      ];
      return elements.filter(element => {
        const box = element.getBoundingClientRect();
        return box.left < area.left - 1 || box.right > area.right + 1;
      }).map(element => element.className);
    });
    expect(outside, 'Dashboard content at ' + width + 'px').toEqual([]);
    const editorOverflow = await table.evaluate(element => {
      const container = element.parentElement!;
      return container.scrollWidth - container.clientWidth;
    });
    expect(editorOverflow, 'History editor at ' + width + 'px').toBeLessThanOrEqual(1);
    if (width === 393) await page.screenshot({ path: testInfo.outputPath('dashboard-393.png') });
    if (width === 1440) {
      const times = await table.locator('tbody tr').last().getByRole('combobox').evaluateAll(selects =>
        selects.map(select => Math.round(select.getBoundingClientRect().top)),
      );
      expect(new Set(times).size).toBe(1);
      await table.screenshot({ path: testInfo.outputPath('history-desktop.png') });
    }
  }

  await page.setViewportSize({ width: 320, height: 700 });
  const lastCorrection = table.getByRole('combobox', { name: 'Isha outcome on Today' });
  await lastCorrection.scrollIntoViewIfNeeded();
  await expect(lastCorrection).toBeInViewport();
  expect(await page.getByRole('main').evaluate(element => element.scrollTop)).toBeGreaterThan(0);
  expect(await table.evaluate(element => element.parentElement!.scrollLeft)).toBe(0);
  await expect(table.locator('tbody tr').last().getByText('Isha', { exact: true })).toBeVisible();
  const finalDay = table.locator('tbody tr').last();
  const rowTop = (await finalDay.boundingBox())!.y;
  const header = (await page.locator('.surface-header').boundingBox())!;
  await page.getByRole('main').evaluate((scroller, offset) => scroller.scrollBy(0, offset), rowTop - header.y - header.height - 12);
  await page.screenshot({ path: testInfo.outputPath('corrections-320.png') });
  await dashboard.getByRole('button', { name: 'Close history' }).click();
  await expect(table).toHaveCount(0);
  await dashboard.getByRole('button', { name: 'Correct history' }).click();
  await expect(lastCorrection).toBeVisible();
  await expect.poll(() => control.services.viewPreferences['dashboard.showPrayerLog']).toBe('true');
});
