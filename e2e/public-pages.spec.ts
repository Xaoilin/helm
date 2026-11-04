import { expect, test } from '@playwright/test';

for (const viewport of [{ width: 1440, height: 900 }, { width: 390, height: 844 }]) {
  test(`public product and privacy pages need no account at ${viewport.width}px`, async ({ page }, testInfo) => {
    await page.setViewportSize(viewport);
    const externalRequests: string[] = [];
    page.on('request', request => {
      if (new URL(request.url()).hostname !== '127.0.0.1') externalRequests.push(request.url());
    });

    await page.goto('about.html');
    await expect(page.getByRole('heading', { level: 1 })).toHaveText('Bring your day into focus.');
    await expect(page.getByRole('link', { name: 'Open Sabah One (HELM)', exact: true })).toHaveAttribute('href', './');
    await expect(page.locator('html')).toHaveJSProperty('scrollWidth', viewport.width);
    await page.screenshot({ path: testInfo.outputPath('about.png'), fullPage: true });

    await page.getByRole('navigation').getByRole('link', { name: 'Privacy', exact: true }).click();
    await expect(page.getByRole('heading', { level: 1 })).toHaveText('Privacy notice');
    await expect(page.getByRole('heading', { name: 'Retention and removing Google access' })).toBeVisible();
    await expect(page.getByRole('link', { name: 'alisab.london@gmail.com' })).toHaveAttribute('href', 'mailto:alisab.london@gmail.com');
    await expect(page.locator('html')).toHaveJSProperty('scrollWidth', viewport.width);
    await page.screenshot({ path: testInfo.outputPath('privacy.png'), fullPage: true });
    await page.getByRole('link', { name: 'About Sabah One (HELM)' }).click();
    await expect(page.getByRole('heading', { level: 1 })).toHaveText('Bring your day into focus.');
    expect(externalRequests).toEqual([]);
  });
}
