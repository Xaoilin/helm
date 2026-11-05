import { expect, openApp, test } from './support/helm-fixture';

for (const theme of ['dark', 'light']) {
  for (const width of [1440, 390, 320]) {
    test(`prayer competition periods, history and keyboard at ${theme} ${width}px`, async ({ page, scenario }, info) => {
      await page.setViewportSize({ width, height: 950 });
      await page.emulateMedia({ reducedMotion: 'reduce' });
      await scenario({ now: '2026-11-04T12:00:00Z', settings: { theme, prayerEnabled: true } });
      await page.route('https://services.helm.test/api/prayer/v1/competition?*', async route => {
        const query = new URL(route.request().url()).searchParams;
        const from = query.get('from');
        const to = query.get('to');
        const day = from === to;
        const summary = { from, to, asOf: '2026-11-04T12:00:00Z', onTime: day ? 2 : 12, late: day ? 0 : 1, missed: day ? 0 : 2 };
        await route.fulfill({ json: { status: 'ready', self: summary,
          partner: { ...summary, onTime: day ? 1 : 10, late: day ? 1 : 1, missed: day ? 0 : 4 } } });
      });
      await openApp(page);
      const card = page.getByRole('region', { name: 'Prayer challenge' });
      await card.scrollIntoViewIfNeeded();
      await expect(card).toContainText('Sabah is leading');
      await expect(card.getByText('87', { exact: false })).toBeVisible();
      await expect(card.getByRole('img', { name: 'Lina: 10 on time, 1 late, 4 missed' })).toBeVisible();
      await expect(card.getByRole('button', { name: 'Next month', exact: true })).toBeDisabled();
      await expect(card.getByRole('group', { name: 'Monthly record' })).toHaveAttribute('aria-busy', 'false');
      await page.screenshot({ path: info.outputPath(`comparison-${theme}-${width}.png`) });

      await card.getByRole('button', { name: 'Day', exact: true }).focus();
      await page.keyboard.press('Enter');
      await expect(card).toContainText('You’re level');
      await expect(card.getByRole('button', { name: 'Day', exact: true })).toHaveAttribute('aria-pressed', 'true');
      await card.getByRole('button', { name: 'Previous day', exact: true }).click();
      await expect(card).toContainText('3 Nov 2026');
      await card.getByRole('button', { name: 'Next day', exact: true }).click();
      await expect(card).toContainText('4 Nov 2026');
      await card.getByRole('button', { name: 'Week', exact: true }).click();
      await expect(card).toContainText('2 Nov – 8 Nov 2026');
      await card.getByRole('button', { name: 'Month', exact: true }).click();
      await expect(card).toContainText('November 2026');
      await card.getByRole('button', { name: 'Previous month', exact: true }).click();
      await expect(card).toContainText('October 2026');
      await card.getByRole('button', { name: 'Refresh comparison', exact: true }).click();
      await expect(card).toHaveAttribute('aria-busy', 'false');
      expect(await card.evaluate(node => node.scrollWidth <= node.clientWidth)).toBe(true);
      expect(await page.evaluate(() => document.documentElement.scrollWidth <= innerWidth)).toBe(true);
    });
  }
}

test('partner failures, no eligible prayers and unconnected challenges never show a false winner', async ({ page, scenario }) => {
  await scenario({ now: '2026-11-04T12:00:00Z', settings: { prayerEnabled: true } });
  let state: 'not_connected' | 'unavailable' | 'empty' | 'error' = 'not_connected';
  await page.route('https://services.helm.test/api/prayer/v1/competition?*', async route => {
    if (state === 'error') return route.fulfill({ status: 400, json: { code: 'test_error', message: 'Comparison test failure. Please refresh.' } });
    const query = new URL(route.request().url()).searchParams;
    const summary = { from: query.get('from'), to: query.get('to'), asOf: '2026-11-04T12:00:00Z', onTime: 0, late: 0, missed: 0 };
    await route.fulfill({ json: { status: state === 'empty' ? 'ready' : state, self: summary, partner: state === 'empty' ? summary : null } });
  });
  await openApp(page);
  const card = page.getByRole('region', { name: 'Prayer challenge' });
  await card.scrollIntoViewIfNeeded();
  await expect(card).toContainText('isn’t connected yet');
  state = 'unavailable';
  await card.getByRole('button', { name: 'Refresh comparison' }).click();
  await expect(card).toContainText('temporarily unavailable');
  state = 'empty';
  await card.getByRole('button', { name: 'Refresh comparison' }).click();
  await expect(card).toContainText('A fresh start, together');
  await expect(card.getByLabel('Leading', { exact: true })).toHaveCount(0);
  await expect(card).not.toContainText('0%');
  state = 'error';
  await card.getByRole('button', { name: 'Refresh comparison' }).click();
  await expect(card.getByRole('alert')).toContainText('Comparison test failure');
  await expect(card.getByLabel('Leading', { exact: true })).toHaveCount(0);
  await expect(card.getByRole('button', { name: 'Refresh comparison' })).toBeEnabled();
});

for (const theme of ['dark', 'light']) {
  for (const width of [1440, 320]) {
    test(`daily win record keeps progress separate at ${theme} ${width}px`, async ({ page, scenario }, info) => {
      await page.setViewportSize({ width, height: 950 });
      await scenario({ now: '2026-11-07T12:00:00Z', settings: { theme, prayerEnabled: true } });
      const calls: string[] = [];
      await page.route('https://services.helm.test/api/prayer/v1/competition?*', async route => {
        const query = new URL(route.request().url()).searchParams;
        const from = query.get('from')!;
        const to = query.get('to')!;
        calls.push(`${from}:${to}`);
        const summary = { from, to, asOf: '2026-11-07T12:00:00Z', onTime: 4, late: 0, missed: 1 };
        const day = Number(from.slice(-2));
        const selfWins = day === 1 || day === 7;
        const tied = day === 6;
        await route.fulfill({ json: { status: 'ready', self: { ...summary, onTime: selfWins ? 5 : 4, missed: selfWins ? 0 : 1 },
          partner: { ...summary, onTime: selfWins || tied ? 4 : 5, missed: selfWins || tied ? 1 : 0 } } });
      });
      await openApp(page);
      const card = page.getByRole('region', { name: 'Prayer challenge' });
      await card.getByRole('button', { name: 'Day', exact: true }).click();
      const record = card.getByRole('group', { name: 'Daily record' });
      await expect(record.getByLabel('Sabah 1, Lina 4', { exact: true })).toBeVisible();
      await expect(record).toContainText('1 tied');
      await expect(card).toContainText('Sabah is leading');
      await expect(card.getByRole('img', { name: 'Sabah: 5 on time, 0 late, 0 missed' })).toBeVisible();
      await card.scrollIntoViewIfNeeded();
      await page.screenshot({ path: info.outputPath(`record-${theme}-${width}.png`) });
      expect(await card.evaluate(node => node.scrollWidth <= node.clientWidth)).toBe(true);
      const firstDayReads = calls.filter(value => value === '2026-11-01:2026-11-01').length;
      await page.clock.fastForward(61_000);
      await expect(card).toHaveAttribute('aria-busy', 'false');
      expect(calls.filter(value => value === '2026-11-01:2026-11-01')).toHaveLength(firstDayReads);
      await card.getByRole('button', { name: 'Previous day', exact: true }).click();
      await expect(card).toContainText('6 Nov 2026');
      await expect(record.getByLabel('Sabah 1, Lina 4', { exact: true })).toBeVisible();
      expect(calls.every(value => value >= '2026-11-01')).toBe(true);
    });
  }
}

test('weekly and monthly records aggregate complete periods since November', async ({ page, scenario }, info) => {
  await page.setViewportSize({ width: 1280, height: 950 });
  await scenario({ now: '2026-12-15T12:00:00Z', settings: { prayerEnabled: true, theme: 'light' } });
  await page.route('https://services.helm.test/api/prayer/v1/competition?*', async route => {
    const query = new URL(route.request().url()).searchParams;
    const from = query.get('from')!;
    const to = query.get('to')!;
    const selfWins = from === '2026-11-01' || from === '2026-11-02';
    const tied = from === '2026-12-07';
    const summary = { from, to, asOf: '2026-12-15T12:00:00Z', onTime: 4, late: 0, missed: 1 };
    await route.fulfill({ json: { status: 'ready', self: { ...summary, onTime: selfWins ? 5 : 4, missed: selfWins ? 0 : 1 },
      partner: { ...summary, onTime: selfWins || tied ? 4 : 5, missed: selfWins || tied ? 1 : 0 } } });
  });
  await openApp(page);
  const card = page.getByRole('region', { name: 'Prayer challenge' });
  await expect(card.getByRole('group', { name: 'Monthly record' }).getByLabel('Sabah 1, Lina 0', { exact: true })).toBeVisible();
  await card.getByRole('button', { name: 'Week', exact: true }).click();
  const weekly = card.getByRole('group', { name: 'Weekly record' });
  await expect(weekly.getByLabel('Sabah 1, Lina 4', { exact: true })).toBeVisible();
  await expect(weekly).toContainText('1 tied');
  await card.scrollIntoViewIfNeeded();
  await page.screenshot({ path: info.outputPath('weekly-record.png') });
  await card.getByRole('button', { name: 'Month', exact: true }).click();
  await expect(card.getByRole('group', { name: 'Monthly record' }).getByLabel('Sabah 1, Lina 0', { exact: true })).toBeVisible();
  await page.screenshot({ path: info.outputPath('monthly-record.png') });
});

test('failed historical comparisons hide the whole record and can be refreshed', async ({ page, scenario }) => {
  await scenario({ now: '2026-11-07T12:00:00Z', settings: { prayerEnabled: true } });
  let unavailable = true;
  await page.route('https://services.helm.test/api/prayer/v1/competition?*', async route => {
    const query = new URL(route.request().url()).searchParams;
    const summary = { from: query.get('from'), to: query.get('to'), asOf: '2026-11-07T12:00:00Z', onTime: 5, late: 0, missed: 0 };
    const failed = unavailable && summary.from === '2026-11-02' && summary.to === summary.from;
    await route.fulfill({ json: { status: failed ? 'unavailable' : 'ready', self: summary, partner: failed ? null : summary } });
  });
  await openApp(page);
  const card = page.getByRole('region', { name: 'Prayer challenge' });
  await card.getByRole('button', { name: 'Day', exact: true }).click();
  const record = card.getByRole('group', { name: 'Daily record' });
  await expect(record).toContainText('Record unavailable');
  await expect(record.getByLabel('Sabah 0, Lina 0', { exact: true })).toHaveCount(0);
  unavailable = false;
  await card.getByRole('button', { name: 'Refresh comparison' }).click();
  await expect(record.getByLabel('Sabah 0, Lina 0', { exact: true })).toBeVisible();
  await expect(record).toContainText('6 tied');
});
