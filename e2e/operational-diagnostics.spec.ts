import { readFile, writeFile } from 'node:fs/promises';
import { expect, openApp, test, waitForMutation } from './support/helm-fixture';

const TASK = { id: 'synthetic-private-task', title: 'KAN314_PRIVATE_TITLE', dueDate: '2026-09-22', description: 'Synthetic task', completed: false, priority: 'medium', category: 'task', createdAt: '2026-09-22T00:00:00.000Z', updatedAt: '2026-09-22T00:00:00.000Z' };

test('diagnostics classify a failure and its recovery while a failed sink leaves confirmed writes usable', async ({ page, scenario }, testInfo) => {
  await page.setViewportSize({ width: 1440, height: 900 });
  await page.emulateMedia({ reducedMotion: 'reduce' });
  await scenario({ now: TASK.createdAt, stores: { tasks: [TASK] } });
  // The deployed release manifest is unreachable at first, then answers again.
  let manifestAvailable = false;
  await page.route('**/release.json?*', async route => {
    if (manifestAvailable) await route.fallback();
    else await route.fulfill({ status: 503, body: 'unavailable' });
  });
  const failedCheck = page.waitForResponse(response => response.url().includes('/release.json?') && response.status() === 503);
  const sent: unknown[] = [];
  await page.route('**/api/profile/v1/operational-events', async route => {
    sent.push(route.request().postDataJSON());
    await route.fulfill({ status: 503, json: { code: 'collection_unavailable' } });
  });
  await openApp(page);
  await failedCheck;
  await page.clock.fastForward(10_000);
  await page.getByRole('button', { name: 'Navigate to Tasks' }).click();
  const write = waitForMutation(page, 'tasks');
  await page.getByRole('checkbox', { name: 'Mark "KAN314_PRIVATE_TITLE" as complete' }).click();
  expect((await write).ok()).toBe(true);
  await expect(page.getByRole('checkbox', { name: 'Mark "KAN314_PRIVATE_TITLE" as incomplete' })).toBeChecked();
  manifestAvailable = true;
  const recoveredCheck = page.waitForResponse(response => response.url().includes('/release.json?') && response.ok());
  await page.clock.fastForward(61_000);
  await recoveredCheck;
  await page.getByRole('button', { name: 'Navigate to Debug' }).click();
  const operations = page.getByRole('button', { name: 'Operations', exact: false });
  await operations.focus();
  await operations.press('Enter');
  const diagnostics = page.getByRole('region', { name: 'Operational diagnostics' });
  await expect(diagnostics).toContainText('release · manifest · recovered');
  await expect(diagnostics).toContainText('Diagnostic collection is unavailable');
  const evidence = [];
  for (const width of [390, 768, 1440]) {
    await page.setViewportSize({ width, height: 900 });
    await page.locator('.main-content').evaluate(element => { element.scrollTop = 0; });
    const exportButton = diagnostics.getByRole('button', { name: 'Export diagnostics' });
    await expect(exportButton).toBeVisible();
    const bounds = await exportButton.boundingBox();
    expect(bounds!.x).toBeGreaterThanOrEqual(0);
    expect(bounds!.x + bounds!.width).toBeLessThanOrEqual(width);
    expect(await page.evaluate(() => document.documentElement.scrollWidth <= innerWidth)).toBe(true);
    expect(await diagnostics.evaluate(element => element.scrollWidth <= element.clientWidth + 1)).toBe(true);
    await page.screenshot({ path: testInfo.outputPath(`operational-diagnostics-${width}.png`) });
    const scroller = page.locator('.main-content');
    if (width === 390) {
      const size = await scroller.evaluate(element => ({ client: element.clientHeight, scroll: element.scrollHeight }));
      expect(size.scroll).toBeGreaterThan(size.client);
      await scroller.hover();
      await page.mouse.wheel(0, 400);
      await expect.poll(() => scroller.evaluate(element => element.scrollTop)).toBeGreaterThan(0);
      const wheelOffset = await scroller.evaluate(element => element.scrollTop);
      await scroller.evaluate(element => { element.scrollTop = 0; });
      await scroller.focus();
      await page.keyboard.press('PageDown');
      await expect.poll(() => scroller.evaluate(element => element.scrollTop)).toBeGreaterThan(0);
      evidence.push({ width, ...size, wheelOffset, keyboardOffset: await scroller.evaluate(element => element.scrollTop) });
    } else evidence.push({ width, noHorizontalOverflow: true });
  }
  const exportButton = diagnostics.getByRole('button', { name: 'Export diagnostics' });
  await exportButton.focus();
  const downloadPromise = page.waitForEvent('download');
  await exportButton.press('Enter');
  const download = await downloadPromise;
  const contents = await readFile((await download.path())!, 'utf8');
  const exported = JSON.parse(contents);
  expect(exported.events.some((event: { outcome: string; recoveryMs: number }) => event.outcome === 'recovered' && event.recoveryMs > 0)).toBe(true);
  expect(contents).not.toMatch(/KAN314_PRIVATE_TITLE|e2e-access-token|e2e-refresh-token|synthetic-private-task|@/);
  expect(JSON.stringify(sent)).not.toMatch(/KAN314_PRIVATE_TITLE|e2e-access-token|e2e-refresh-token|synthetic-private-task|@/);
  await expect(diagnostics).toContainText('Diagnostics exported.');
  await writeFile(testInfo.outputPath('operational-browser-evidence.json'), JSON.stringify({ source: 'synthetic services with real browser client', measurements: evidence, export: exported, sinkRequests: sent.length }, null, 2));
});
