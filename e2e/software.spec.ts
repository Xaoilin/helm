import { expect, openApp, test } from './support/helm-fixture';

for (const width of [320, 768, 1440]) {
  test(`Software navigation and native Mac launch at ${width}px`, async ({ page, context, scenario }, testInfo) => {
    await page.setViewportSize({ width, height: 900 });
    await scenario();
    await openApp(page);
    if (width <= 760) {
      await page.getByRole('button', { name: 'Open more navigation', exact: true }).click();
    }
    const navigation = width <= 760
      ? page.getByRole('dialog', { name: 'More navigation' })
      : page.getByRole('navigation', { name: 'Main navigation', exact: true });
    const software = navigation.getByRole('button', { name: width <= 760 ? 'Software' : 'Navigate to Software', exact: true });
    await software.focus();
    await page.keyboard.press('Enter');
    const surface = page.getByRole('main', { name: 'software surface', exact: true });
    await expect(surface.getByRole('heading', { name: 'Software', exact: true })).toBeVisible();
    const autoclicker = surface.getByRole('article', { name: 'Autoclicker', exact: true });
    await expect(autoclicker.getByText('Repository pending', { exact: true })).toHaveCount(0);
    const launch = autoclicker.getByRole('link', { name: 'Launch on Mac', exact: true });
    await expect(launch).toHaveAttribute('href', 'sabah-autoclicker://open');
    await expect(launch).not.toHaveAttribute('target', '_blank');
    await expect(autoclicker.getByRole('link', { name: 'Autoclicker on GitHub' })).toHaveAttribute('href', 'https://github.com/Xaoilin/autoclicker');
    await expect(autoclicker.getByRole('link', { name: 'Download Autoclicker' })).toHaveAttribute('href', 'https://github.com/Xaoilin/autoclicker/releases/latest/download/Sabah-Autoclicker-macOS.zip');
    // The OS dialog belongs to native live acceptance. Avoid opening local apps from CI.
    await launch.evaluate(element => element.addEventListener('click', event => event.preventDefault()));
    await launch.focus();
    await page.keyboard.press('Enter');
    await expect(autoclicker.getByRole('status')).toContainText('If nothing opens, download and install it first.');
    expect(await page.evaluate(() => document.documentElement.scrollWidth <= window.innerWidth)).toBe(true);
    await page.screenshot({ path: testInfo.outputPath(`software-${width}.png`) });

    await context.route('https://github.com/Xaoilin?tab=repositories', route => route.fulfill({
      contentType: 'text/html', body: '<title>GitHub repositories fixture</title>',
    }));
    const github = surface.getByRole('link', { name: 'GitHub repositories', exact: true });
    await expect(github).toHaveAttribute('rel', 'noopener noreferrer');
    await github.focus();
    const popupPromise = page.waitForEvent('popup');
    await page.keyboard.press('Enter');
    const popup = await popupPromise;
    await expect(popup).toHaveURL('https://github.com/Xaoilin?tab=repositories');
    await expect(surface).toBeVisible();
    await popup.close();
    await page.reload();
    await expect(surface.getByRole('heading', { name: 'Software', exact: true })).toBeVisible();
  });
}
