import { makeCalendarAccount, makeCalendarEvent, makeCalendarSource } from '../src/test/fixtures';
import { expect, openApp, test } from './support/helm-fixture';

for (const { width, height } of [{ width: 320, height: 568 }, { width: 390, height: 844 }]) {
  test(`portrait navigation and the full calendar week fit at ${width}px`, async ({ page, scenario }) => {
    await page.setViewportSize({ width, height });
    await scenario({
      now: '2026-09-08T10:00:00Z',
      settings: { defaultCalendarTab: 'week', prayerEnabled: true },
      stores: { calendarAccounts: [makeCalendarAccount()], calendarSources: [makeCalendarSource()] },
    });
    await openApp(page);
    const navigation = page.getByRole('navigation', { name: 'Mobile navigation' });
    const insets = await navigation.evaluate(bar => {
      const buttons = bar.querySelectorAll('button');
      const bounds = bar.getBoundingClientRect();
      return {
        left: buttons[0].getBoundingClientRect().left - bounds.left,
        right: bounds.right - buttons[buttons.length - 1].getBoundingClientRect().right,
      };
    });
    expect(Math.abs(insets.left - insets.right)).toBeLessThanOrEqual(1);
    const truncatedLabels = await navigation.locator('.mobile-nav-label').evaluateAll(labels =>
      labels.filter(label => label.scrollWidth > label.clientWidth + 1).map(label => label.textContent),
    );
    expect(truncatedLabels).toEqual([]);

    await navigation.getByRole('button', { name: 'Navigate to Calendar' }).click();
    const days = page.getByLabel('Week days');
    await expect(days.getByRole('button')).toHaveCount(7);
    const tabs = page.locator('.tabs').filter({ has: page.getByRole('button', { name: 'Accounts & Sources' }) });
    for (const group of [tabs, days]) {
      expect(await group.evaluate(element => element.scrollWidth - element.clientWidth)).toBeLessThanOrEqual(1);
      const fits = await group.getByRole('button').evaluateAll(buttons => buttons.every(button => {
        const bounds = button.getBoundingClientRect();
        return bounds.left >= 0 && bounds.right <= document.documentElement.clientWidth + 1;
      }));
      expect(fits).toBe(true);
    }
    const saturday = days.getByRole('button', { name: /^Sat/i });
    await saturday.click();
    await expect(saturday).toHaveClass(/active/);
    await tabs.getByRole('button', { name: 'Accounts & Sources' }).click();
    await expect(page.getByRole('heading', { name: 'Accounts', exact: true })).toBeVisible();
  });
}

test('a long meeting link fits Calendar event lists and opens intact in the editor', async ({ page, scenario }, testInfo) => {
  const title = 'Read the revised calibration report and send the signed drawing to the field engineering team before the afternoon handover';
  const location = 'https://example.test/meet/718ea241d9714ce7b60aa843cb3af48c155cb605bde34c6b8ad10993b489e305';
  const event = makeCalendarEvent({ title, location, description: title, start: '2026-11-22T14:00:00Z', end: '2026-11-22T15:00:00Z' });
  await scenario({
    now: '2026-11-22T13:00:00Z',
    initialSurface: 'calendar',
    settings: { defaultCalendarTab: 'week' },
    stores: { calendarAccounts: [makeCalendarAccount()], calendarSources: [makeCalendarSource()], calendarEvents: [event] },
  });
  await page.setViewportSize({ width: 320, height: 700 });
  await page.goto('/');
  const main = page.getByRole('main', { name: 'calendar surface' });
  for (const tab of ['Week', 'Month', 'Agenda']) {
    await main.getByRole('button', { name: tab, exact: true }).click();
    const row = main.locator(tab === 'Agenda' ? '.agenda-item' : '.calendar-mobile-event').filter({ hasText: title });
    await expect(row).toBeVisible();
    if (tab !== 'Month') await expect(row).toContainText(location);
    const widths = tab === 'Agenda' ? [320, 393, 430, 768, 1440] : [320, 393, 430];
    for (const width of widths) {
      await page.setViewportSize({ width, height: 700 });
      const geometry = await row.evaluate(element => {
        const area = element.parentElement!.getBoundingClientRect();
        const box = element.getBoundingClientRect();
        const walker = document.createTreeWalker(element, NodeFilter.SHOW_TEXT);
        const lines: DOMRect[] = [];
        while (walker.nextNode()) {
          const range = document.createRange();
          range.selectNodeContents(walker.currentNode);
          lines.push(...range.getClientRects());
        }
        return {
          insideViewport: box.left >= 0 && box.right <= document.documentElement.clientWidth + 1,
          insideList: box.left >= area.left - 1 && box.right <= area.right + 1,
          textFits: lines.every(line => line.left >= box.left - 1 && line.right <= box.right + 1),
        };
      });
      expect.soft(geometry, tab + ' at ' + width + 'px').toEqual({ insideViewport: true, insideList: true, textFits: true });
      if (tab === 'Agenda' && width === 320) {
        const range = main.locator('.calendar-date-range');
        const gap = await range.evaluate(element => {
          const labels = [...element.querySelectorAll('time')].map(time => time.getBoundingClientRect());
          const previous = element.previousElementSibling!.getBoundingClientRect();
          const next = element.nextElementSibling!.getBoundingClientRect();
          return Math.min(...labels.map(label => Math.min(label.left - previous.right, next.left - label.right)));
        });
        expect(gap).toBeGreaterThanOrEqual(6);
      }
      if (width === 320) {
        await row.scrollIntoViewIfNeeded();
        const rowTop = (await row.boundingBox())!.y;
        const heading = (await main.locator('.surface-header').boundingBox())!;
        await main.evaluate((scroller, offset) => scroller.scrollBy(0, offset), rowTop - heading.y - heading.height - 12);
        await page.screenshot({ path: testInfo.outputPath(tab + '-event-320.png') });
      }
    }
    await page.setViewportSize({ width: 320, height: 700 });
    await row.click();
    const editor = page.getByRole('dialog', { name: 'Edit Event' });
    await expect(editor.getByLabel('Title', { exact: true })).toHaveValue(title);
    await expect(editor.getByLabel('Description', { exact: true })).toHaveValue(event.description);
    await expect(editor.getByLabel('Location', { exact: true })).toHaveValue(location);
    expect(await editor.evaluate(dialog => dialog.scrollWidth - dialog.clientWidth)).toBeLessThanOrEqual(1);
    await editor.getByRole('button', { name: 'Cancel', exact: true }).click();
  }
});
