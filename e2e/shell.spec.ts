import { expect, openApp, test } from './support/helm-fixture';
import { getQuranMotivationForDate, QURAN_MOTIVATION_CARDS } from '../src/services/quranMotivation';
import { shiftIsoDate } from '../src/services/timeZone';

const FIXED_NOW = '2026-07-28T11:45:00.000Z';

for (const width of [390, 768, 1440]) {
  test(`Quran reading shows complete Arabic and English side by side at ${width}px`, async ({ page, scenario }, testInfo) => {
    const longest = QURAN_MOTIVATION_CARDS.reduce((left, right) => (
      left.translation.length > right.translation.length ? left : right
    ));
    const date = Array.from({ length: QURAN_MOTIVATION_CARDS.length }, (_, day) => (
      shiftIsoDate('2026-09-13', day)!
    )).find(candidate => getQuranMotivationForDate(candidate).id === longest.id)!;
    await page.setViewportSize({ width, height: 900 });
    await scenario({ now: `${date}T12:00:00Z` });
    await openApp(page);
    const card = page.getByRole('complementary', { name: 'Daily Quran reading' });
    await card.scrollIntoViewIfNeeded();
    await expect(card.getByRole('heading')).toHaveText(`Quran ${longest.reference}`);
    const arabic = card.locator('blockquote[lang="ar"]');
    const english = card.locator('blockquote[lang="en"]');
    await expect(arabic).toHaveText(longest.arabic);
    await expect(arabic).toHaveAttribute('dir', 'rtl');
    await expect(english).toHaveText(longest.translation);
    await expect(english).toHaveAttribute('dir', 'ltr');
    const arabicBounds = await arabic.boundingBox();
    const englishBounds = await english.boundingBox();
    expect(arabicBounds!.x).toBeGreaterThanOrEqual(englishBounds!.x + englishBounds!.width);
    expect(Math.abs(arabicBounds!.y - englishBounds!.y)).toBeLessThan(1);
    await expect(card.getByText('English translation: Marmaduke Pickthall', { exact: true })).toBeVisible();
    await expect(card.getByText('Reviewed meaning (paraphrase):', { exact: false })).toHaveCount(0);
    await expect(card.getByRole('link', { name: 'Arabic: Tanzil Project', exact: true }))
      .toHaveAttribute('href', 'https://tanzil.net');
    await expect(card.getByRole('link', { name: `Quran ${longest.reference} · Source`, exact: true }))
      .toHaveAttribute('href', longest.sourceUrl);
    expect(await card.evaluate(element => element.scrollWidth <= element.clientWidth)).toBe(true);
    expect(await page.evaluate(() => document.documentElement.scrollWidth <= window.innerWidth)).toBe(true);
    await card.screenshot({ path: testInfo.outputPath(`quran-long-${width}.png`) });
    const source = card.getByRole('link', { name: 'Translation source', exact: true });
    await expect(source).toHaveAttribute('href', 'https://www.gutenberg.org/ebooks/16955');
    await source.scrollIntoViewIfNeeded();
    await expect(source).toBeInViewport();
    await source.click({ trial: true });
    await page.screenshot({ path: testInfo.outputPath(`quran-sources-${width}.png`) });
  });
}

test('Quran reading stays stable on reload and changes with the prayer date', async ({ page, scenario }) => {
  await scenario({ now: '2026-09-30T22:59:00Z', prayer: { timezone: 'Europe/London' }, settings: { prayerEnabled: true } });
  await openApp(page);
  const card = page.getByRole('complementary', { name: 'Daily Quran reading' });
  const passage = card.locator('blockquote[lang="en"]');
  const arabic = card.locator('blockquote[lang="ar"]');
  await expect(passage).toHaveText(getQuranMotivationForDate('2026-09-30').translation);
  await expect(arabic).toHaveText(getQuranMotivationForDate('2026-09-30').arabic);
  await page.reload();
  await expect(passage).toHaveText(getQuranMotivationForDate('2026-09-30').translation);
  await expect(arabic).toHaveText(getQuranMotivationForDate('2026-09-30').arabic);
  await page.clock.fastForward(120_000);
  await expect(passage).toHaveText(getQuranMotivationForDate('2026-10-01').translation);
  await expect(arabic).toHaveText(getQuranMotivationForDate('2026-10-01').arabic);
});

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
  test('More contains keyboard focus, scrolls and returns focus on dismissal', async ({ page, scenario }, testInfo) => {
    await page.setViewportSize({ width: 390, height: 600 });
    await page.emulateMedia({ reducedMotion: 'reduce' });
    await scenario();
    await openApp(page);
    const trigger = page.getByRole('button', { name: 'Open more navigation', exact: true });
    await trigger.focus();
    await page.keyboard.press('Enter');
    const dialog = page.getByRole('dialog', { name: 'More navigation' });
    const close = dialog.getByRole('button', { name: 'Close more navigation' });
    await expect(close).toBeFocused();
    await page.keyboard.press('Shift+Tab');
    await expect(dialog.getByRole('button').last()).toBeFocused();
    await page.keyboard.press('Tab');
    await expect(close).toBeFocused();
    const size = await dialog.evaluate(element => ({ client: element.clientHeight, scroll: element.scrollHeight }));
    expect(size.scroll).toBeGreaterThan(size.client);
    await dialog.hover();
    await page.mouse.wheel(0, 700);
    await expect.poll(() => dialog.evaluate(element => element.scrollTop)).toBeGreaterThan(0);
    await page.keyboard.press('Escape');
    await expect(dialog).toBeHidden();
    await expect(trigger).toBeFocused();
    await page.keyboard.press('Space');
    await expect(close).toBeFocused();
    await page.screenshot({ path: testInfo.outputPath('more-390.png') });
    await close.click();
    await expect(trigger).toBeFocused();
    await page.keyboard.press('Enter');
    const clock = dialog.getByRole('button', { name: 'Clock', exact: true });
    await clock.focus();
    await page.keyboard.press('Enter');
    await expect(page.getByRole('main', { name: 'clock surface' })).toBeVisible();
    await expect(trigger).toBeFocused();
  });

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
