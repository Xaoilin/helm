import { expect, test } from './support/helm-fixture';

test.describe('account boot boundary', () => {
  test('keeps signed-out visitors behind the account gate', async ({ page, scenario }) => {
    await scenario({ authenticated: false });
    const releaseCheck = page.waitForRequest('**/release.json?*');
    await page.goto('/');
    await releaseCheck;

    await expect(page.getByRole('heading', { name: 'Sign in to continue' })).toBeVisible();
    await expect(page.getByText('Offline and anonymous data changes are not supported.')).toBeVisible();
    await expect(page.getByRole('button', { name: 'Continue with Google' })).toBeVisible();
    await expect(page.getByRole('navigation', { name: 'Main navigation' })).toHaveCount(0);
  });

  test('keeps account data closed when the database snapshot is unavailable', async ({ page, scenario }) => {
    await scenario({ snapshotStatus: 503 });
    await page.goto('/');

    await expect(page.getByRole('heading', { name: 'Connecting to Sabah One' })).toBeVisible();
    await expect(page.getByText('Your account could not be loaded. Automatic retries are limited. Use Retry connection to try again.')).toBeVisible();
    await expect(page.getByRole('button', { name: 'Retry connection' })).toBeVisible();
    await expect(page.getByRole('button', { name: 'Sign out' })).toBeVisible();
    await expect(page.getByRole('navigation', { name: 'Main navigation' })).toHaveCount(0);
  });

  for (const width of [390, 1440]) {
    test(`retries an initial failed load after automatic recovery ends at ${width}px`, async ({ page, scenario }, testInfo) => {
      await scenario({ now: '2026-09-23T12:00:00.000Z' });
      await page.setViewportSize({ width, height: 900 });
      let unavailable = true;
      let snapshotAttempts = 0;
      await page.route('**/rest/v1/rpc/get_helm_account_snapshot*', async route => {
        snapshotAttempts += 1;
        if (unavailable) {
          await route.fulfill({ status: 503, json: { message: 'Snapshot fixture unavailable.' } });
        } else {
          await route.fallback();
        }
      });
      const releaseCheck = page.waitForRequest('**/release.json?*');
      await page.goto('/');
      await releaseCheck;
      await expect(page.getByRole('button', { name: 'Retry connection' })).toBeVisible();
      await expect.poll(() => snapshotAttempts).toBe(1);

      for (let attempt = 2; attempt <= 6; attempt += 1) {
        await page.clock.fastForward(40_000);
        await expect.poll(() => snapshotAttempts).toBe(attempt);
      }
      await page.clock.fastForward(10 * 60_000);
      expect(snapshotAttempts).toBe(6);
      await expect(page.getByRole('navigation')).toHaveCount(0);
      await expect(page.getByRole('alert')).toContainText('Snapshot fixture unavailable.');
      await expect(page.getByText(/will retry automatically/)).toHaveCount(0);
      expect(await page.evaluate(() => document.documentElement.scrollWidth <= window.innerWidth)).toBe(true);
      await page.screenshot({ path: testInfo.outputPath(`initial-account-retry-${width}.png`) });

      unavailable = false;
      await page.getByRole('button', { name: 'Retry connection', exact: true }).click();
      await expect(page.getByRole('main', { name: 'dashboard surface' })).toBeVisible();
      expect(snapshotAttempts).toBe(7);
      await expect(page.getByRole('heading', { name: 'Connecting to Sabah One' })).toHaveCount(0);
    });
  }
});
