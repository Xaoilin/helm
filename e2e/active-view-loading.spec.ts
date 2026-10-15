import { writeFile } from 'node:fs/promises';
import { expect, installScenario, openApp, test } from './support/helm-fixture';
import { makeCalendarAccount, makeCalendarEvent, makeCalendarSource } from '../src/test/fixtures';

const now = '2026-09-08T10:00:00.000Z';
const stores = {
  calendarAccounts: [makeCalendarAccount()], calendarSources: [makeCalendarSource()],
  calendarEvents: [makeCalendarEvent({ title: 'Window fixture', start: '2026-09-08T11:00:00.000Z', end: '2026-09-08T12:00:00.000Z' })],
};

test('active-view request proof', async ({ page, scenario }, info) => {
  await scenario({ now, stores, settings: { defaultCalendarTab: 'week' } });
  const requests: { method: string; path: string; from: string | null; to: string | null }[] = [];
  page.on('request', request => {
    const url = new URL(request.url());
    if (url.pathname.startsWith('/api/') && !url.pathname.includes('/live/')) {
      requests.push({ method: request.method(), path: url.pathname, from: url.searchParams.get('from'), to: url.searchParams.get('to') });
    }
  });
  await openApp(page);
  await expect(page.getByRole('button', { name: 'Open tasks', exact: true })).toBeEnabled();
  const dashboard = [...requests];
  await page.getByRole('button', { name: 'Navigate to Calendar', exact: true }).click();
  await expect(page.getByRole('heading', { name: 'Calendar', exact: true })).toBeVisible();
  await expect(page.getByRole('button', { name: 'Open Window fixture', exact: true })).toBeVisible();
  await writeFile(info.outputPath('request-proof.json'), JSON.stringify({ dashboard, calendar: requests.filter(r => r.path.endsWith('/calendar')) }, null, 2));
  expect(dashboard.filter(r => /\/(calendar|life|knowledge|finance)\/|\/integrations/u.test(r.path))).toEqual([]);
  // Clock is a shell dependency: a timer must still alarm after a cold Dashboard reload.
  expect(dashboard.filter(r => r.path === '/api/planner/v1/clock')).toHaveLength(1);
  expect(requests.filter(r => r.path.endsWith('/calendar'))).toEqual([
    { method: 'GET', path: '/api/calendar/v1/calendar', from: '2026-09-06', to: '2026-09-12' },
  ]);
  await page.getByRole('button', { name: 'Navigate to Dashboard', exact: true }).click();
  await page.getByRole('button', { name: 'Navigate to Calendar', exact: true }).click();
  await expect(page.getByRole('button', { name: 'Open Window fixture', exact: true })).toBeVisible();
  await page.clock.runFor(300);
  expect(requests.filter(r => r.path.endsWith('/calendar'))).toHaveLength(1);
  await page.getByRole('button', { name: 'Next week', exact: true }).click();
  await expect.poll(() => requests.filter(r => r.path.endsWith('/calendar')).at(-1)?.from).toBe('2026-09-13');
  await page.getByRole('button', { name: 'Month', exact: true }).click();
  await expect.poll(() => requests.filter(r => r.path.endsWith('/calendar')).at(-1)?.to).toBe('2026-10-10');
  await page.getByRole('button', { name: 'Next month', exact: true }).click();
  await expect.poll(() => requests.filter(r => r.path.endsWith('/calendar')).at(-1)?.from).toBe('2026-09-27');
  await page.getByRole('button', { name: 'Agenda', exact: true }).click();
  await page.getByRole('button', { name: 'Next 30 days', exact: true }).click();
  await expect.poll(() => requests.filter(r => r.path.endsWith('/calendar')).at(-1)?.from).toBe('2026-10-31');
  await writeFile(info.outputPath('request-proof.json'), JSON.stringify({ dashboard, calendar: requests.filter(r => r.path.endsWith('/calendar')) }, null, 2));
});

test('two independent signed-in contexts converge after a saved Calendar change', async ({ browser, page, scenario }, info) => {
  const first = await scenario({ now, stores, settings: { defaultCalendarTab: 'week' } });
  const otherContext = await browser.newContext({ baseURL: info.project.use.baseURL, viewport: { width: 1440, height: 900 } });
  const other = await otherContext.newPage();
  try {
    const second = await installScenario(other, { now, stores, settings: { defaultCalendarTab: 'week' } });
    second.services.calendar = first.services.calendar;
    const pages = [page, other];
    const windows = pages.map(() => [] as { from: string | null; to: string | null }[]);
    pages.forEach((target, index) => target.on('request', request => {
      const url = new URL(request.url());
      if (request.method() === 'GET' && url.pathname === '/api/calendar/v1/calendar') {
        windows[index].push({ from: url.searchParams.get('from'), to: url.searchParams.get('to') });
      }
    }));
    await Promise.all(pages.map(async target => {
      await openApp(target);
      await target.getByRole('button', { name: 'Navigate to Calendar', exact: true }).click();
      await expect(target.getByRole('button', { name: 'Open Window fixture', exact: true })).toBeVisible();
    }));
    await page.getByRole('button', { name: 'Open Window fixture', exact: true }).click();
    const editor = page.getByRole('dialog', { name: 'Edit Event' });
    await editor.getByLabel('Title').fill('Changed on first device');
    await editor.getByRole('button', { name: 'Save', exact: true }).click();
    await expect(editor).toBeHidden();
    const before = [first, second].map(control => control.services.calls.filter(call => call === 'GET /api/calendar/v1/calendar').length);
    for (const control of [first, second]) control.services.liveEvents.push(
      { type: 'calendar.updated', domain: 'calendar', at: now, data: null },
      { type: 'calendar.updated', domain: 'calendar', at: now, data: null },
    );
    await Promise.all(pages.map(target => target.clock.fastForward(60_000)));
    await Promise.all(pages.map(async target => {
      await expect(target.getByRole('button', { name: 'Open Changed on first device', exact: true })).toBeVisible();
      await expect(target.getByRole('button', { name: 'Open Window fixture', exact: true })).toHaveCount(0);
    }));
    const after = [first, second].map(control => control.services.calls.filter(call => call === 'GET /api/calendar/v1/calendar').length);
    expect(after.map((count, i) => count - before[i])).toEqual([1, 1]);
    for (const reads of windows) expect(reads).toEqual([
      { from: '2026-09-06', to: '2026-09-12' }, { from: '2026-09-06', to: '2026-09-12' },
    ]);
    await writeFile(info.outputPath('two-context-proof.json'), JSON.stringify({ independentContexts: true, sameSyntheticAccount: true, before, after, windows, savedChangeConverged: true }, null, 2));
  } finally {
    await otherContext.close();
  }
});

for (const width of [390, 768, 1440]) {
  test(`Calendar loading, confirmed, empty and refusal states stay usable at ${width}px`, async ({ page, scenario }, info) => {
    await scenario({ now, stores, settings: { defaultCalendarTab: 'week', theme: width === 768 ? 'light' : 'dark' } });
    await page.emulateMedia({ reducedMotion: 'reduce' });
    await openApp(page);
    let release!: () => void;
    let hold = true;
    const pending = new Promise<void>(resolve => { release = resolve; });
    await page.route('**/api/calendar/v1/calendar?*', async route => {
      if (hold) await pending;
      await route.fallback();
    });
    await page.getByRole('button', { name: 'Navigate to Calendar', exact: true }).click();
    await page.setViewportSize({ width, height: 900 });
    const week = page.getByRole('button', { name: 'Week', exact: true });
    await expect(page.getByRole('status').filter({ hasText: 'Loading page data...' })).toBeVisible();
    const loadingAnchor = await week.boundingBox();
    await page.screenshot({ path: info.outputPath(`calendar-loading-${width}.png`) });
    hold = false;
    release();
    const event = page.getByRole('button', { name: width === 390 ? '12:00 PM Window fixture' : 'Open Window fixture', exact: true });
    await expect(event).toBeVisible();
    await expect(page.getByRole('button', { name: '+ Event', exact: true })).toBeEnabled();
    const confirmedAnchor = await week.boundingBox();
    expect(Math.abs(loadingAnchor!.y - confirmedAnchor!.y)).toBeLessThanOrEqual(1);
    await event.focus();
    await expect(event).toBeFocused();
    await page.keyboard.press('Enter');
    const editor = page.getByRole('dialog', { name: 'Edit Event' });
    await expect(editor).toBeVisible();
    await editor.getByRole('button', { name: 'Cancel', exact: true }).click();
    await page.screenshot({ path: info.outputPath(`calendar-confirmed-${width}.png`) });
    expect(await page.evaluate(() => document.documentElement.scrollWidth <= innerWidth)).toBe(true);
    await page.getByRole('button', { name: 'Next week', exact: true }).click();
    await expect(page.getByRole('status').filter({ hasText: 'Loading page data...' })).toHaveCount(0);
    await expect(event).toHaveCount(0);
    await page.screenshot({ path: info.outputPath(`calendar-empty-${width}.png`) });
    await page.route('**/api/calendar/v1/calendar?*', route => route.fulfill({ status: 403,
      json: { code: 'forbidden', message: 'Synthetic account access refused.' } }));
    await page.getByRole('button', { name: 'Previous week', exact: true }).click();
    await expect(page.getByRole('alert')).toContainText('Synthetic account access refused.');
    await expect(page.getByRole('button', { name: '+ Event', exact: true })).toBeDisabled();
    await expect(event).toHaveCount(0);
    await page.screenshot({ path: info.outputPath(`calendar-refused-${width}.png`) });
    await page.getByRole('button', { name: 'Retry', exact: true }).focus();
    await expect(page.getByRole('button', { name: 'Retry', exact: true })).toBeFocused();
    await writeFile(info.outputPath('layout-proof.json'), JSON.stringify({ width, loadingAnchor, confirmedAnchor,
      verticalMovement: Math.abs(loadingAnchor!.y - confirmedAnchor!.y), overflow: false, refusedDataCleared: true }, null, 2));
  });
}

test('inactive Calendar invalidation defers reads and automatic sync until a consumer returns', async ({ page, scenario }) => {
  const google = makeCalendarAccount({ provider: 'google', authStatus: 'connected', lastSyncTime: now });
  const control = await scenario({ now, stores: { ...stores, calendarAccounts: [google] }, settings: { defaultCalendarTab: 'week' } });
  await openApp(page);
  expect(control.services.calls.filter(call => call.includes('/api/calendar/'))).toEqual([]);
  await page.getByRole('button', { name: 'Navigate to Calendar', exact: true }).click();
  await expect(page.getByRole('button', { name: 'Open Window fixture', exact: true })).toBeVisible();
  await page.getByRole('button', { name: 'Navigate to Dashboard', exact: true }).click();
  const before = control.services.calls.filter(call => call.includes('/api/calendar/')).length;
  control.services.liveEvents.push({ type: 'calendar.updated', domain: 'calendar', at: now, data: null });
  await page.clock.fastForward(20 * 60_000);
  await expect.poll(() => control.services.liveEvents.length).toBe(0);
  await page.clock.runFor(300);
  expect(control.services.calls.filter(call => call.includes('/api/calendar/'))).toHaveLength(before);
  await page.getByRole('button', { name: 'Navigate to Calendar', exact: true }).click();
  await expect.poll(() => control.services.calls.filter(call => call === 'POST /api/calendar/v1/sync').length).toBe(1);
  await expect(page.getByRole('button', { name: 'Open Window fixture', exact: true })).toBeVisible();
});
