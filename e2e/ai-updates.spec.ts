import { AI_UPDATES_URL } from '../src/config/aiUpdates';
import type { AiUpdatesSnapshot, AiUpdateStory } from '../src/types/domain';
import { expect, openApp, test } from './support/helm-fixture';

const now = '2026-11-17T20:00:00.000Z';
const launch: AiUpdateStory = {
  id: 'gpt-6-2',
  title: 'GPT-6.2 Astra and Sol launch in Codex',
  summary: 'The new models are available in Codex, ChatGPT Work, and the API. OpenAI reports lower Astra API pricing.',
  publishedAt: '2026-11-17T18:00:00.000Z',
  category: 'models',
  source: { label: 'OpenAI announcement', url: 'https://openai.com/index/introducing-gpt-6-2-astra-sol/' },
  discussions: [
    { label: 'r/codex discussion', url: 'https://www.reddit.com/r/codex/comments/1xyrc4m/gpt_astra_62_and_gpt_sol_62_released/' },
    { label: 'OpenAI on X', url: 'https://x.com/OpenAI/status/2122750124543926515' },
  ],
  featured: true,
};
const coding: AiUpdateStory = {
  ...launch,
  id: 'claude-code-release',
  title: 'Claude Code adds a new way to review agent changes before they are applied',
  summary: 'The release notes cover the new workflow and when to use it. Developers can review the changes alongside the existing release history and explore the downstream impact on longer running sessions.',
  category: 'coding',
  source: { label: 'Claude Code changelog', url: 'https://github.com/anthropics/claude-code/releases' },
  discussions: [{ label: 'Hacker News discussion', url: 'https://news.ycombinator.com/item?id=12345678' }],
  featured: false,
};
const edition: AiUpdatesSnapshot = {
  updatedAt: now,
  stories: [
    launch,
    coding,
    ...Array.from({ length: 10 }, (_, index): AiUpdateStory => ({
      ...coding,
      id: `research-${index}`,
      title: `AI research update ${index + 1}`,
      category: 'research',
    })),
  ],
};

for (const width of [320, 1440]) {
  test(`AI Updates highlights releases, filters stories and preserves the homepage at ${width}px`, async ({ page, scenario }, testInfo) => {
    await page.setViewportSize({ width, height: 900 });
    await scenario({ now });
    await page.route(AI_UPDATES_URL, route => {
      const headers = route.request().headers();
      expect(headers.authorization).toBeUndefined();
      expect(headers.referer).toBeUndefined();
      return route.fulfill({ headers: { 'Access-Control-Allow-Origin': '*' }, json: edition });
    });
    await page.context().route(launch.discussions[0].url, route => route.fulfill({ body: 'Discussion fixture' }));
    await openApp(page);
    const tabs = page.getByRole('tablist', { name: 'Homepage' });
    const home = tabs.getByRole('tab', { name: 'Night Compass' });
    const updates = tabs.getByRole('tab', { name: /AI Updates/u });
    await expect(updates).toHaveText(/AI Updates\s*New/u);
    await expect(home).toHaveAttribute('aria-selected', 'true');
    await page.screenshot({ path: testInfo.outputPath(`home-${width}.png`) });

    await home.press('ArrowRight');
    await expect(updates).toBeFocused();
    await expect(updates).toHaveAttribute('aria-selected', 'true');
    const panel = page.getByRole('tabpanel', { name: 'AI Updates', exact: true });
    await expect(panel.getByRole('article')).toHaveCount(10);
    await expect(panel.getByRole('article').first()).toContainText(launch.title);
    const discussion = panel.getByRole('link', { name: /r\/codex discussion/u });
    await expect(discussion).toHaveAttribute('target', '_blank');
    await expect(discussion).toHaveAttribute('rel', 'noopener noreferrer');
    await expect(panel.getByRole('link', { name: /OpenAI on X/u })).toHaveAttribute('href', launch.discussions[1].url);
    await page.screenshot({ path: testInfo.outputPath(`feed-${width}.png`) });

    const scroller = width <= 760 ? page.getByRole('main', { name: 'dashboard surface' }) : panel;
    await panel.press('PageDown');
    await expect.poll(() => scroller.evaluate(element => element.scrollTop)).toBeGreaterThan(0);
    await panel.getByRole('button', { name: 'Coding tools', exact: true }).click();
    await expect(panel.getByRole('article')).toHaveCount(1);
    await expect(panel.getByRole('heading', { name: coding.title })).toBeVisible();

    if (width === 320) {
      await page.locator('html').evaluate(element => { element.style.fontSize = '125%'; });
      await expect(panel.getByRole('heading', { name: coding.title })).toBeVisible();
      expect(await page.evaluate(() => document.documentElement.scrollWidth)).toBeLessThanOrEqual(width);
      await page.screenshot({ path: testInfo.outputPath('feed-320-large-text.png') });
    } else {
      await panel.getByRole('button', { name: 'All', exact: true }).click();
      const popupPromise = page.waitForEvent('popup');
      await discussion.click();
      const popup = await popupPromise;
      await expect(popup).toHaveURL(launch.discussions[0].url);
      await popup.close();
    }

    await updates.press('Home');
    await expect(home).toBeFocused();
    await expect(updates).toHaveText('AI Updates');
    await expect(page.getByRole('heading', { name: 'Night Compass', exact: true })).toBeVisible();
    await home.press('End');
    await expect(updates).toBeFocused();
    await expect(panel.getByRole('button', { name: 'Coding tools', exact: true }))
      .toHaveAttribute('aria-pressed', width === 320 ? 'true' : 'false');
  });
}

test('AI Updates rejects unsafe links, shows the saved edition, and can recover', async ({ page, scenario }, testInfo) => {
  await scenario({ now });
  await page.setViewportSize({ width: 320, height: 900 });
  let live = false;
  await page.route(AI_UPDATES_URL, route => route.fulfill({
    headers: { 'Access-Control-Allow-Origin': '*' },
    json: live ? edition : { ...edition, stories: [{ ...launch, source: { ...launch.source, url: 'http://example.test' } }] },
  }));
  await page.route('**/helm/ai-updates.json', route => route.fulfill({
    json: { ...edition, stories: [launch] },
  }));
  await openApp(page);
  await page.getByRole('tab', { name: /AI Updates/u }).click();
  await expect(page.getByText('Live refresh unavailable. Showing the saved edition.')).toBeVisible();
  await expect(page.getByRole('article')).toHaveCount(1);
  await page.locator('html').evaluate(element => { element.style.fontSize = '125%'; });
  const status = page.getByText('Live refresh unavailable. Showing the saved edition.');
  const retry = page.getByRole('button', { name: 'Retry', exact: true });
  const [statusBounds, retryBounds, storyBounds] = await Promise.all([
    status.boundingBox(), retry.boundingBox(), page.getByRole('article').boundingBox(),
  ]);
  expect(await retry.evaluate(button => {
    const label = document.createRange();
    label.selectNodeContents(button);
    return label.getClientRects().length;
  })).toBe(1);
  expect(statusBounds!.x + statusBounds!.width).toBeLessThanOrEqual(retryBounds!.x - 12);
  expect(storyBounds!.y - (retryBounds!.y + retryBounds!.height)).toBeGreaterThan(12);
  await page.screenshot({ path: testInfo.outputPath('feed-saved-edition.png') });
  live = true;
  await page.getByRole('button', { name: 'Retry', exact: true }).click();
  await expect(page.getByRole('article')).toHaveCount(10);
  await expect(page.getByText('Live refresh unavailable. Showing the saved edition.')).toHaveCount(0);
});
