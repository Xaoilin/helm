import { expect, openApp, test } from './support/helm-fixture';

for (const theme of ['dark', 'light']) {
  for (const width of [1440, 320]) {
    test(`three timing choices save without typing at ${theme} ${width}px`, async ({ page, scenario }, info) => {
      await page.setViewportSize({ width, height: 950 });
      await page.emulateMedia({ reducedMotion: 'reduce' });
      const control = await scenario({ now: '2026-11-05T18:00:00Z', settings: { theme, prayerEnabled: true } });
      await openApp(page);
      await expect(page.getByRole('status', { name: 'Prayer data sync' })).toHaveText('Prayer data: Synced');
      await expect(page.getByRole('region', { name: 'Prayer challenge' })).toContainText('12 points only within 15 minutes of the adhan.');
      for (const [name, timing, label] of [
        ['Fajr', 'prompt', 'Prayed promptly'],
        ['Dhuhr', 'within_window', 'Prayed within the time window'],
        ['Asr', 'outside_window', 'Prayed outside the time window'],
      ] as const) {
        await page.getByRole('button', { name: new RegExp(`Complete ${name} Prayer`) }).click();
        const dialog = page.getByRole('dialog', { name: `When did you pray ${name}?` });
        await expect(dialog.getByRole('button')).toHaveCount(4);
        if (name === 'Fajr') {
          await expect(dialog.locator('.prayer-choice-points')).toHaveText(['12points', '8points', '2points']);
          await expect(dialog).toContainText('Within 15 minutes of the adhan');
          await page.screenshot({ path: info.outputPath(`timing-${theme}-${width}.png`) });
          expect(await dialog.evaluate(node => node.scrollWidth <= node.clientWidth)).toBe(true);
        }
        await dialog.getByRole('button', { name: new RegExp(`^${label}`) }).click();
        await expect.poll(() => control.services.outcomes.get(`2026-11-05::${name}`)?.timing).toBe(timing);
      }
      await page.reload();
      await expect(page.getByRole('status', { name: 'Prayer data sync' })).toHaveText('Prayer data: Synced');
      await page.getByRole('list', { name: 'Five daily prayers' }).scrollIntoViewIfNeeded();
      await page.screenshot({ path: info.outputPath(`timing-saved-${theme}-${width}.png`) });
      await page.getByRole('button', { name: 'Correct history', exact: true }).click();
      const fajr = page.getByRole('combobox', { name: 'Fajr outcome on Today' });
      await expect(fajr).toHaveValue('prompt');
      await fajr.selectOption('within_window');
      await expect.poll(() => control.services.outcomes.get('2026-11-05::Fajr')?.timing).toBe('within_window');
    });
  }
}

test('weighted competition shows points separately from complete prayers', async ({ page, scenario }, info) => {
  await page.setViewportSize({ width: 1440, height: 950 });
  await scenario({ now: '2026-11-05T18:00:00Z', settings: { prayerEnabled: true, theme: 'dark' } });
  await page.route('**/api/prayer/v1/competition?*', async route => {
    const query = new URL(route.request().url()).searchParams;
    const summary = { from: query.get('from'), to: query.get('to'), asOf: '2026-11-05T18:00:00Z', onTime: 1, late: 0, missed: 0, pointsEarned: 12, pointsAvailable: 12 };
    await route.fulfill({ json: { status: 'ready', self: summary, partner: { ...summary, pointsEarned: 8 } } });
  });
  await openApp(page);
  const card = page.getByRole('region', { name: 'Prayer challenge' });
  await expect(card).toContainText('Sabah is leading');
  await expect(card).toContainText('12 points only within 15 minutes of the adhan.');
  await expect(card.getByText('12 of 12 points', { exact: true })).toBeVisible();
  await expect(card.getByText('8 of 12 points', { exact: true })).toBeVisible();
  await expect(card.getByText('100% complete · 1 of 1 prayed', { exact: true })).toHaveCount(2);
  await card.scrollIntoViewIfNeeded();
  await page.screenshot({ path: info.outputPath('weighted-competition.png') });
});


test('the daily win record updates immediately after both fifth prayers are confirmed', async ({ page, scenario }) => {
  const control = await scenario({ now: '2026-11-05T22:30:00Z', settings: { prayerEnabled: true } });
  for (const prayer of ['Fajr', 'Dhuhr', 'Asr', 'Maghrib'] as const) {
    control.services.outcomes.set(`2026-11-05::${prayer}`, {
      id: crypto.randomUUID(), date: '2026-11-05', prayer, status: 'on_time', timing: 'within_window',
      recordedAt: '2026-11-05T21:00:00Z', source: 'dashboard', taskId: null, rewarded: true, deadlineAt: null,
    });
  }
  await page.route('**/api/prayer/v1/competition?*', async route => {
    const query = new URL(route.request().url()).searchParams;
    const today = query.get('from') === '2026-11-05' && query.get('to') === '2026-11-05';
    const records = today ? [...control.services.outcomes.values()].filter(value => value.date === '2026-11-05') : [];
    const points = records.reduce((total, value) => total + (value.timing === 'prompt' ? 12 : 8), 0);
    const self = { from: query.get('from'), to: query.get('to'), asOf: '2026-11-05T22:30:00Z',
      onTime: records.length, late: 0, missed: 0, pointsEarned: points, pointsAvailable: records.length * 12, allPrayed: today && records.length === 5 };
    const partner = today ? { ...self, onTime: 5, pointsEarned: 40, pointsAvailable: 60, allPrayed: true } : self;
    await route.fulfill({ json: { status: 'ready', self, partner } });
  });
  await openApp(page);
  const card = page.getByRole('region', { name: 'Prayer challenge' });
  await card.getByRole('button', { name: 'Day', exact: true }).click();
  const record = card.getByRole('group', { name: 'Daily record' });
  await expect(record.getByLabel('Sabah 0, Lina 0', { exact: true })).toBeVisible();
  await page.getByRole('button', { name: /Complete Isha Prayer/ }).click();
  await page.getByRole('dialog').getByRole('button', { name: /^Prayed promptly/ }).click();
  await expect(record.getByLabel('Sabah 1, Lina 0', { exact: true })).toBeVisible();
});

test('refresh keeps confirmed values and card elements mounted until new values arrive', async ({ page, scenario }, info) => {
  await page.setViewportSize({ width: 390, height: 950 });
  await scenario({ now: '2026-11-05T18:00:00Z', settings: { prayerEnabled: true, theme: 'dark' } });
  let hold: Promise<void> | null = null;
  let release!: () => void;
  let points = 12;
  let fail = false;
  await page.route('**/api/prayer/v1/competition?*', async route => {
    if (hold) await hold;
    if (fail) return route.fulfill({ status: 400, json: { code: 'refresh_failed', message: 'Refresh failed. Try again.' } });
    const q = new URL(route.request().url()).searchParams;
    const summary = { from: q.get('from'), to: q.get('to'), asOf: '2026-11-05T18:00:00Z', onTime: 1, late: 0, missed: 0,
      pointsEarned: points, pointsAvailable: 12, allPrayed: false };
    await route.fulfill({ json: { status: 'ready', self: summary, partner: { ...summary, pointsEarned: 8 } } });
  });
  await openApp(page);
  const card = page.getByRole('region', { name: 'Prayer challenge' });
  await expect(card).toContainText('12 of 12 points');
  const record = card.getByRole('group', { name: 'Monthly record' });
  await expect(record).toHaveAttribute('aria-busy', 'false');
  await card.scrollIntoViewIfNeeded();
  await card.getByRole('button', { name: 'Refresh comparison' }).scrollIntoViewIfNeeded();
  const anchors = card.locator('.prayer-challenge-heading, .prayer-challenge-players, .prayer-challenge-avatar, .prayer-challenge-record');
  const before = await anchors.evaluateAll(nodes => nodes.map((node, i) => {
    (node as HTMLElement).dataset.retained = String(i);
    const rect = node.getBoundingClientRect();
    const card = node.closest('.prayer-challenge')!.getBoundingClientRect();
    return { x: rect.x - card.x, y: rect.y - card.y, width: rect.width, height: rect.height };
  }));
  hold = new Promise(resolve => { release = resolve; });
  await card.getByRole('button', { name: 'Refresh comparison' }).click();
  await expect(card).toContainText('12 of 12 points');
  await expect(card).not.toContainText('Loading your comparison');
  await expect(record).not.toContainText('Loading record');
  await page.screenshot({ path: info.outputPath('refresh-held.png') });
  const during = await anchors.evaluateAll(nodes => nodes.map((node, i) => {
    if ((node as HTMLElement).dataset.retained !== String(i)) throw new Error('Card element was replaced during refresh');
    const rect = node.getBoundingClientRect();
    const card = node.closest('.prayer-challenge')!.getBoundingClientRect();
    return { x: rect.x - card.x, y: rect.y - card.y, width: rect.width, height: rect.height };
  }));
  expect(during).toEqual(before);
  points = 8;
  hold = null;
  release();
  await expect(card.getByText('8 of 12 points', { exact: true })).toHaveCount(2);
  expect(await anchors.evaluateAll(nodes => nodes.every((node, i) => (node as HTMLElement).dataset.retained === String(i)))).toBe(true);
  fail = true;
  await card.getByRole('button', { name: 'Refresh comparison' }).click();
  await expect(card.getByRole('alert')).toContainText('Refresh failed');
  await expect(card.getByText('8 of 12 points', { exact: true })).toHaveCount(2);
});
