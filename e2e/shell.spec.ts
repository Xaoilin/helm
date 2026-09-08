import { expect, openApp, test } from './support/helm-fixture';

const FIXED_NOW = '2026-07-28T11:45:00.000Z';

for (const width of [1440, 390]) {
  test(`paused hosted AI stays clear across Settings, Debug and Chat at ${width}px`, async ({ page, scenario }, testInfo) => {
    await scenario();
    let aiWorkRequests = 0;
    await page.route('**/functions/v1/assistant-openai*', async route => {
      const billing = route.request().url().endsWith('assistant-openai-billing');
      const action = route.request().postDataJSON()?.action;
      if (!billing && action !== 'health') aiWorkRequests++;
      await route.fulfill({ status: billing ? 403 : action === 'health' ? 200 : 503, contentType: 'application/json', body: JSON.stringify(
        billing ? { code: 'operator_required', error: 'Project billing is available only to an authorized operator.' } :
          { ok: action === 'health', mode: 'paused', model: 'gpt-5.4', code: 'hosted_ai_paused', message: 'Hosted AI is paused. Use the app controls directly.', error: 'Hosted AI is paused. Use the app controls directly.' },
      ) });
    });
    await page.setViewportSize({ width: 1440, height: 900 });
    await openApp(page);
    for (const surface of ['Settings', 'Debug', 'Chat']) {
      await page.setViewportSize({ width: 1440, height: 900 });
      await page.getByRole('button', { name: `Navigate to ${surface}`, exact: true }).click();
      if (surface === 'Debug') await page.getByRole('button', { name: 'AI Assistant' }).click();
      await page.setViewportSize({ width, height: 900 });
      const status = page.getByText('Hosted AI paused', { exact: surface !== 'Chat' }).first();
      await status.scrollIntoViewIfNeeded();
      await expect(status).toBeVisible();
      if (surface === 'Debug') await expect(page.getByRole('button', { name: 'Run Hosted Smoke Test', exact: true })).toBeDisabled();
      if (surface === 'Chat') {
        await page.getByRole('button', { name: 'New conversation', exact: true }).last().click();
        await expect(page.getByPlaceholder('Hosted AI is paused')).toBeDisabled();
        await expect(page.getByRole('button', { name: 'Send', exact: true })).toBeDisabled();
        await expect(page.getByRole('button', { name: 'Help me plan my week', exact: true })).toBeDisabled();
        await expect(page.getByText('Lina is thinking...', { exact: false })).toHaveCount(0);
      }
      expect(await page.evaluate(() => document.documentElement.scrollWidth <= window.innerWidth)).toBe(true);
      await page.screenshot({ path: testInfo.outputPath(`${surface.toLowerCase()}-${width}.png`) });
    }
    expect(aiWorkRequests).toBe(0);
  });
}

test.describe('assembled browser shell', () => {
  test('boots Night Compass with a current-day prayer schedule and next-prayer semantics', async ({ page, scenario }) => {
    await scenario({
      now: FIXED_NOW,
      settings: {
        prayerEnabled: true,
        prayerCity: 'Bedford',
        prayerCountry: 'United Kingdom',
      },
    });
    await openApp(page);

    await expect(page.getByRole('heading', { name: 'Night Compass' })).toBeVisible();
    await expect(page.getByRole('heading', { name: 'Prayer', exact: true })).toBeVisible();

    const nextPrayer = page.getByRole('button', { name: 'Complete Dhuhr Prayer' });
    await expect(nextPrayer).toContainText('13:00');
    await expect(nextPrayer).toHaveAttribute('aria-current', 'true');
  });

  test('navigates across the core account surfaces', async ({ page, scenario }) => {
    await scenario();
    await openApp(page);

    await page.getByRole('button', { name: 'Navigate to Tasks' }).click();
    await expect(page.getByRole('heading', { name: 'Tasks', exact: true })).toBeVisible();

    await page.getByRole('button', { name: 'Navigate to Calendar' }).click();
    await expect(page.getByRole('heading', { name: 'Calendar', exact: true })).toBeVisible();

    await page.getByRole('button', { name: 'Navigate to Clock' }).click();
    await expect(page.getByRole('heading', { name: 'Clock', exact: true })).toBeVisible();

    await page.getByRole('button', { name: 'Navigate to Settings' }).click();
    await expect(page.getByRole('heading', { name: 'Settings', exact: true })).toBeVisible();

    await page.getByRole('button', { name: 'Navigate to Dashboard' }).click();
    await expect(page.getByRole('heading', { name: 'Night Compass', exact: true })).toBeVisible();
  });
});
