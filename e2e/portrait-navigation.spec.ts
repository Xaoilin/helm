import { makeCalendarAccount, makeCalendarSource } from '../src/test/fixtures';
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
