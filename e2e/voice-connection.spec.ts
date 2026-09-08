import { expect, openApp, test } from './support/helm-fixture';

const reference = 'a0000000-0000-4000-8000-000000000001';
for (const width of [390, 1440]) {
  test(`voice connection stores only a reference and preserves migration input at ${width}px`, async ({ page, scenario }, testInfo) => {
    await scenario();
    const original = JSON.stringify({ elevenLabsApiKey: 'KAN305_LEGACY_MIGRATION_ONLY' });
    await page.addInitScript(value => {
      if (!localStorage.getItem('helm:device:deviceSettings')) localStorage.setItem('helm:device:deviceSettings', value);
    }, original);
    await page.route('**/rest/v1/rpc/list_helm_secrets', route => route.fulfill({
      contentType: 'application/json', body: JSON.stringify({ accountVersion: 1, secrets: [{ secretId: reference, label: 'Dedicated ElevenLabs test key', kind: 'api_key', archivedAt: null }] }),
    }));
    await page.setViewportSize({ width: 1440, height: 900 });
    await openApp(page);
    await page.getByRole('button', { name: 'Navigate to Settings', exact: true }).click();
    await page.setViewportSize({ width, height: 900 });
    const select = page.getByLabel('ElevenLabs secret reference', { exact: true });
    await select.scrollIntoViewIfNeeded();
    await expect(select).toBeEnabled();
    await select.selectOption(reference);
    await page.getByLabel('ElevenLabs public voice ID', { exact: true }).fill('publicVoice123');
    await expect.poll(() => page.evaluate(() => JSON.parse(localStorage.getItem('helm:device:deviceSettings:v2') || '{}').elevenLabsSecretId)).toBe(reference);
    expect(await page.evaluate(() => localStorage.getItem('helm:device:deviceSettings'))).toBe(original);
    const saved = await page.evaluate(() => localStorage.getItem('helm:device:deviceSettings:v2'));
    expect(saved).not.toContain('KAN305_LEGACY_MIGRATION_ONLY');
    expect(saved).not.toContain('elevenLabsApiKey');
    await expect(page.getByLabel('Deepgram API Key (for voice input)')).toHaveCount(0);
    await expect(page.getByText('Voice input uses browser speech recognition', { exact: false })).toBeVisible();
    expect(await page.evaluate(() => document.documentElement.scrollWidth <= window.innerWidth)).toBe(true);
    await page.screenshot({ path: testInfo.outputPath(`voice-connection-${width}.png`), fullPage: true });
    await select.focus();
    await page.keyboard.press('Home');
    await page.keyboard.press('Enter');
    await select.selectOption('');
    await expect.poll(() => page.evaluate(() => JSON.parse(localStorage.getItem('helm:device:deviceSettings:v2') || '{}').elevenLabsSecretId)).toBeUndefined();
    await expect(page.getByText('Using browser speech.', { exact: true })).toBeVisible();
    await page.reload();
    await expect(select).toHaveValue('');
    expect(await page.evaluate(() => localStorage.getItem('helm:device:deviceSettings'))).toBe(original);
  });
}
