import { readFileSync } from 'node:fs';
import { competitionSchema } from '../src/services/backend/competitionContracts';
import { expect, openApp, test } from './support/helm-fixture';
import { verifyPrayerGiftMotion } from './support/prayer-exemption-gift';

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

test('paused days keep Sabah’s prayer progress beside Lina’s softly looping gift', async ({ page, scenario }, info) => {
  await page.setViewportSize({ width: 1440, height: 1080 });
  await page.emulateMedia({ reducedMotion: 'reduce' });
  await scenario({ now: '2026-11-07T12:00:00Z', settings: { prayerEnabled: true } });
  const fixture = JSON.parse(readFileSync(new URL('../contracts/prayer-service/competition-paused-prayer-progress.json', import.meta.url), 'utf8'));
  const { pausedPrayerProgress } = competitionSchema.parse(fixture.body);
  if (!pausedPrayerProgress) throw new Error('The paused fixture must contain Sabah’s prayer progress.');
  let todayProgress: typeof pausedPrayerProgress | undefined = pausedPrayerProgress;
  await page.route('**/api/prayer/v1/competition?*', async route => {
    const query = new URL(route.request().url()).searchParams;
    const from = query.get('from')!;
    const to = query.get('to')!;
    const excluded = ['2026-11-06', '2026-11-07'].filter(date => date >= from && date <= to).length;
    const paused = from === to && excluded === 1;
    const summary = { from, to, asOf: '2026-11-07T12:00:00Z', onTime: paused ? 0 : 1, late: 0, missed: 0,
      pending: 0, allPrayed: !paused, pointsEarned: paused ? 0 : 12, pointsAvailable: paused ? 0 : 12 };
    await route.fulfill({ json: { status: 'ready', self: summary,
      partner: { ...summary, pointsEarned: paused ? 0 : 8 }, periodDaysExcluded: excluded || undefined,
      pausedPrayerProgress: paused ? from === '2026-11-07' ? todayProgress : { onTime: 4, late: 1, missed: 0 } : undefined,
    } });
  });
  await openApp(page);
  const card = page.getByRole('region', { name: 'Prayer challenge' });
  const sabahPlayer = card.locator('.prayer-challenge-player.is-sabah');
  const linaPlayer = card.locator('.prayer-challenge-player.is-lina');
  const sabah = sabahPlayer.locator('.prayer-challenge-score');
  const lina = linaPlayer.locator('.prayer-challenge-score');
  const gift = linaPlayer.getByRole('heading', { name: 'هدية من الله', exact: true });
  const mixed = card.getByText('2 days not counted because of Lina’s period', { exact: true });
  const pause = card.getByText('Not counted because of Lina’s period', { exact: true });
  const record = card.getByRole('group', { name: 'Daily record' });
  await expect(mixed).toBeVisible();
  await expect(sabah).toHaveText('12 pts');
  await expect(lina).toHaveText('8 pts');
  await card.evaluate(node => node.scrollIntoView({ block: 'center', behavior: 'instant' }));
  await page.screenshot({ path: info.outputPath('period-excluded-month-1440.png') });
  await card.getByRole('button', { name: 'Week', exact: true }).click();
  await expect(mixed).toBeVisible();
  await expect(sabah).toHaveText('12 pts');

  await card.getByRole('button', { name: 'Day', exact: true }).click();
  await expect(pause).toBeVisible();
  await expect(sabah).toHaveText('3/5');
  await expect(lina).toHaveCount(0);
  await expect(gift).toBeVisible();
  await expect(linaPlayer).toContainText('الصلاة غير واجبة عليكِ في هذه الأيام. ارتاحي يا لينا، واطمئنّي.');
  await expect(sabahPlayer).toContainText('Prayed');
  await expect(card.getByRole('img', { name: 'Sabah: 2 on time, 1 late, 1 missed, 1 pending', exact: true })).toBeVisible();
  await expect(card.locator('.prayer-challenge-point-unit')).toHaveCount(0);
  await expect(card).not.toContainText('points available');
  await expect(card).not.toContainText('is leading');
  await expect(card.getByLabel('Leading', { exact: true })).toHaveCount(0);
  await expect(record.getByLabel('Sabah 5, Lina 0', { exact: true })).toBeVisible();
  await expect(record).toContainText('0 without scores');
  await expect(record).toContainText('1 day not counted because of Lina’s period');
  await expect(card.getByRole('button', { name: 'Refresh comparison' })).toBeEnabled();
  await card.evaluate(node => node.scrollIntoView({ block: 'center', behavior: 'instant' }));
  await page.screenshot({ path: info.outputPath('period-paused-day-1440-reduced.png') });
  await verifyPrayerGiftMotion(page, linaPlayer, info.outputPath('period-paused-day-1440'));

  todayProgress = undefined;
  const refresh = card.getByRole('button', { name: 'Refresh comparison' });
  await refresh.focus();
  await page.keyboard.press('Enter');
  await expect(sabah).toHaveText('—');
  await expect(card).toContainText('Prayer totals unavailable');
  await expect(pause).toBeVisible();
  await expect(gift).toBeVisible();
  await expect(record.getByLabel('Sabah 5, Lina 0', { exact: true })).toBeVisible();

  todayProgress = pausedPrayerProgress;
  await refresh.click();
  await expect(sabah).toHaveText('3/5');
  await expect(card).not.toContainText('Prayer totals unavailable');
  await page.setViewportSize({ width: 320, height: 950 });
  await card.evaluate(node => node.scrollIntoView({ block: 'center', behavior: 'instant' }));
  expect(await card.evaluate(node => node.scrollWidth <= node.clientWidth)).toBe(true);
  await page.screenshot({ path: info.outputPath('period-paused-day-320.png') });
  await card.evaluate(node => {
    const elements = [node, ...node.querySelectorAll('*')].filter(element => element instanceof HTMLElement);
    const fontSizes = elements.map(element => parseFloat(getComputedStyle(element).fontSize));
    elements.forEach((element, index) => { element.style.fontSize = `${fontSizes[index] * 1.25}px`; });
  });
  expect(await card.evaluate(node => node.scrollWidth <= node.clientWidth)).toBe(true);
  await page.setViewportSize({ width: 320, height: 1_100 });
  await card.evaluate(node => node.scrollIntoView({ block: 'center', behavior: 'instant' }));
  const sabahBounds = await sabahPlayer.boundingBox();
  const linaBounds = await linaPlayer.boundingBox();
  expect(linaBounds!.y - (sabahBounds!.y + sabahBounds!.height)).toBeGreaterThanOrEqual(10);
  expect(linaBounds!.width).toBeCloseTo(sabahBounds!.width);
  await page.screenshot({ path: info.outputPath('period-paused-day-320-large-text-reduced.png') });
  await verifyPrayerGiftMotion(page, linaPlayer, info.outputPath('period-paused-day-320-large-text'));
  await refresh.click({ trial: true });

  await card.getByRole('button', { name: 'Previous day', exact: true }).click();
  await expect(card).toContainText('6 Nov 2026');
  await expect(pause).toBeVisible();
  await expect(sabah).toHaveText('5/5');
  await expect(gift).toBeVisible();
  await card.getByRole('button', { name: 'Previous day', exact: true }).click();
  await expect(card).toContainText('5 Nov 2026');
  await expect(pause).toHaveCount(0);
  await expect(gift).toHaveCount(0);
  await expect(sabah).toHaveText('12 pts');
});


test('earned points lead and both prayer windows join the total at Dhuhr', async ({ page, scenario }, info) => {
  await page.setViewportSize({ width: 1440, height: 950 });
  await page.emulateMedia({ reducedMotion: 'reduce' });
  await scenario({ now: '2026-11-18T11:59:30Z', settings: { prayerEnabled: true }, prayer: { timings: { Dhuhr: '12:00' } } });
  await page.clock.pauseAt(new Date('2026-11-18T11:59:53Z'));
  const fixture = JSON.parse(readFileSync(new URL('../contracts/prayer-service/competition-unlocked.json', import.meta.url), 'utf8'));
  const { self, partner } = competitionSchema.parse(fixture.body);
  if (!partner) throw new Error('The unlocked competition fixture must contain both participants.');
  let atDhuhr = false;
  let dayReads = 0;
  await page.route('**/api/prayer/v1/competition?*', async route => {
    const query = new URL(route.request().url()).searchParams;
    const from = query.get('from');
    const to = query.get('to');
    if (from === self.from && to === self.to) dayReads++;
    if (from === '2026-10-01' && to === '2026-10-31') {
      await route.fulfill({ json: { status: 'ready',
        self: { ...self, from, to, onTime: 155, missed: 0, pointsEarned: 1860, pointsAvailable: 1860 },
        partner: { ...partner, from, to, pending: 0 },
      } });
      return;
    }
    await route.fulfill({ json: { status: 'ready', self: { ...self, from, to },
      partner: { ...partner, from, to, pending: atDhuhr ? partner.pending : 0 } } });
  });
  await openApp(page);
  const card = page.getByRole('region', { name: 'Prayer challenge' });
  await card.getByRole('button', { name: 'Day', exact: true }).click();
  const sabah = card.locator('.prayer-challenge-player.is-sabah');
  const lina = card.locator('.prayer-challenge-player.is-lina');
  await expect(sabah.locator('.prayer-challenge-score')).toHaveText('20 pts');
  await expect(sabah.getByLabel('Leading', { exact: true })).toBeVisible();
  await expect(lina.locator('.prayer-challenge-score')).toHaveText('12 pts');
  await expect(lina).toContainText('1 of 1 prayed');
  await expect(card).toContainText('Sabah is leading');
  const currentReads = dayReads;
  await lina.evaluate(node => { (node as HTMLElement).dataset.retained = 'true'; });

  await page.clock.runFor(6_999);
  await expect(lina).toContainText('1 of 1 prayed');
  expect(dayReads).toBe(currentReads);

  atDhuhr = true;
  await page.clock.runFor(1);
  await expect(lina).toContainText('1 of 3 prayed');
  await expect(lina).toContainText('36 points available');
  await expect(lina.locator('.prayer-challenge-score')).toHaveText('12 pts');
  await expect(lina.getByRole('img', { name: 'Lina: 1 on time, 0 late, 0 missed, 2 pending' })).toBeVisible();
  await expect(card).toContainText('Sabah is leading');
  await expect(lina).toHaveAttribute('data-retained', 'true');
  await card.scrollIntoViewIfNeeded();
  await page.screenshot({ path: info.outputPath('unlocked-1440.png') });

  await page.setViewportSize({ width: 320, height: 1_020 });
  await card.evaluate(node => node.scrollIntoView({ block: 'center', behavior: 'instant' }));
  expect(await card.evaluate(node => node.scrollWidth <= node.clientWidth)).toBe(true);
  await page.screenshot({ path: info.outputPath('unlocked-320.png') });

  await card.getByRole('button', { name: 'Month', exact: true }).click();
  await card.getByRole('button', { name: 'Previous month', exact: true }).click();
  await expect(sabah.locator('.prayer-challenge-score')).toHaveText('1860 pts');
  await card.evaluate(node => node.scrollIntoView({ block: 'center', behavior: 'instant' }));
  await page.screenshot({ path: info.outputPath('largest-score-320.png') });

  await card.evaluate(node => {
    const elements = [node, ...node.querySelectorAll('*')].filter(element => element instanceof HTMLElement);
    const fontSizes = elements.map(element => parseFloat(getComputedStyle(element).fontSize));
    elements.forEach((element, index) => { element.style.fontSize = `${fontSizes[index] * 1.25}px`; });
  });
  const score = sabah.locator('.prayer-challenge-score');
  expect(await score.evaluate(node => node.scrollWidth <= node.clientWidth)).toBe(true);
  await page.setViewportSize({ width: 320, height: 1_125 });
  await card.evaluate(node => node.scrollIntoView({ block: 'center', behavior: 'instant' }));
  await page.screenshot({ path: info.outputPath('largest-score-320-large-text.png') });
});
