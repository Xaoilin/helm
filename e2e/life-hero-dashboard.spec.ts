import type { Page } from '@playwright/test';
import { expect, openApp, test } from './support/helm-fixture';

const LIFE_HERO_SETTINGS = { lifeHeroEnabled: true };

function requestedViewports(): string[] {
  return (process.env.HELM_E2E_VISUAL_VIEWPORTS || '390x844,1440x900')
    .split(',')
    .map(value => value.trim())
    .filter(value => /^\d+x\d+$/u.test(value));
}

async function installSpeechHarness(page: Page, outcome: 'played' | 'failed' = 'played') {
  await page.addInitScript((speechOutcome) => {
    const speechWindow = window as typeof window & { __lifeHeroSpeechCalls: number };
    speechWindow.__lifeHeroSpeechCalls = 0;

    class MockUtterance {
      text: string;
      rate = 1;
      pitch = 1;
      lang = 'en-GB';
      voice: null = null;
      onstart: (() => void) | null = null;
      onend: (() => void) | null = null;
      onerror: ((event: { error: string }) => void) | null = null;

      constructor(text: string) {
        this.text = text;
      }
    }

    Object.defineProperty(window, 'SpeechSynthesisUtterance', {
      configurable: true,
      value: MockUtterance,
    });
    Object.defineProperty(window, 'speechSynthesis', {
      configurable: true,
      value: {
        cancel: () => {},
        getVoices: () => [],
        speak: (utterance: MockUtterance) => {
          speechWindow.__lifeHeroSpeechCalls += 1;
          window.setTimeout(() => {
            utterance.onstart?.();
            window.setTimeout(() => {
              if (speechOutcome === 'failed') utterance.onerror?.({ error: 'audio-busy' });
              else utterance.onend?.();
            }, 220);
          }, 40);
        },
      },
    });
  }, outcome);
}

test.describe('Life Hero dashboard companion', () => {
  test('completes the daily adventure on 390px mobile with keyboard controls', async ({ page, scenario }) => {
    await page.setViewportSize({ width: 390, height: 844 });
    await scenario({ settings: LIFE_HERO_SETTINGS });
    await openApp(page);
    const hero = page.getByRole('complementary', { name: 'Life Hero' });
    await hero.getByRole('button', { name: /Show Life Hero companion/ }).click();
    const adventure = hero.getByRole('region', { name: 'Daily adventure' });
    const permanentLevel = hero.locator('.life-hero-level-row > div').first().locator('strong');
    const levelBefore = await permanentLevel.textContent();
    await adventure.getByRole('button', { name: 'Start today’s adventure' }).click();
    await expect(adventure.getByText('Continue today’s path')).toBeVisible();
    await adventure.focus();
    await page.keyboard.press('1');
    await expect(adventure.getByText('Round 2 of 4')).toBeVisible();
    await adventure.getByRole('button', { name: /^1 /u }).click();
    await expect(adventure.getByText('Today’s path is complete')).toBeVisible();
    await expect(permanentLevel).toHaveText(levelBefore ?? '');
    expect(await page.evaluate(() => document.documentElement.scrollWidth <= window.innerWidth)).toBe(true);
  });

  test('shows the permanent progression model in an unobtrusive desktop companion', async ({ page, scenario }) => {
    await page.setViewportSize({ width: 1440, height: 900 });
    await scenario({ settings: LIFE_HERO_SETTINGS });
    await openApp(page);

    const hero = page.getByRole('complementary', { name: 'Life Hero' });
    await expect(hero).toBeVisible();
    await expect(hero.getByText('Overall level')).toBeVisible();
    await expect(hero.getByText('Best active momentum')).toBeVisible();
    await expect(hero.getByText('7 days', { exact: true })).toBeVisible();

    await hero.getByRole('button', { name: 'Open hero details' }).click();
    await expect(hero.locator('.life-hero-stat-list > li')).toHaveCount(7);
    await expect(hero.getByText('Ready to renew')).toBeVisible();
    await expect(hero.getByText('First step ready')).toBeVisible();
    await expect(hero.getByRole('switch')).toHaveCount(0);
    await expect(hero.getByText('No progress loss')).toBeVisible();

    expect(await page.evaluate(() => document.documentElement.scrollWidth <= window.innerWidth)).toBe(true);
    await hero.getByRole('button', { name: 'Hide Life Hero companion' }).click();
    await expect(page.getByRole('button', { name: /Show Life Hero companion, level 2/ })).toBeVisible();
  });

  test('uses a compact mobile disclosure after the primary dashboard content', async ({ page, scenario }) => {
    await page.setViewportSize({ width: 390, height: 844 });
    await scenario({ settings: LIFE_HERO_SETTINGS });
    await openApp(page);

    const showHero = page.getByRole('button', { name: /Show Life Hero companion, level 2/ });
    await expect(showHero).toBeVisible();
    const heroAfterPrayer = await page.locator('.nc-prayer-card').evaluate((prayer, selector) => {
      const hero = document.querySelector(selector);
      return Boolean(hero && (prayer.compareDocumentPosition(hero) & Node.DOCUMENT_POSITION_FOLLOWING));
    }, '.life-hero-companion');
    expect(heroAfterPrayer).toBe(true);

    await showHero.focus();
    await expect(showHero).toBeFocused();
    await page.keyboard.press('Enter');
    const hero = page.getByRole('complementary', { name: 'Life Hero' });
    await hero.scrollIntoViewIfNeeded();
    await expect(hero.getByRole('img', { name: 'Original Life Hero standing in a ready pose' })).toBeVisible();
    await expect(hero.getByRole('button', { name: 'Open hero details' })).toBeVisible();
    expect(await page.evaluate(() => document.documentElement.scrollWidth <= window.innerWidth)).toBe(true);
  });

  test('honours reduced motion with a static equivalent and no movement controls', async ({ page, scenario }) => {
    await page.setViewportSize({ width: 1024, height: 900 });
    await page.emulateMedia({ reducedMotion: 'reduce' });
    await scenario({ settings: LIFE_HERO_SETTINGS });
    await openApp(page);

    const hero = page.getByRole('complementary', { name: 'Life Hero' });
    const fallback = hero.getByRole('img', { name: 'Original Life Hero standing in a ready pose' });
    await expect(fallback).toBeVisible();
    await expect(fallback).toHaveAttribute('src', /life-hero-jacket-off/u);
    await expect(hero.locator('canvas')).toHaveCount(0);
    await hero.getByRole('button', { name: 'Open hero details' }).click();
    await expect(hero.getByRole('heading', { name: 'Movement' })).toHaveCount(0);
  });

  test('keeps motivational voice explicit, rate-limited, muteable, and text-complete', async ({ page, scenario }) => {
    await page.setViewportSize({ width: 1440, height: 900 });
    await installSpeechHarness(page);
    await scenario({ settings: LIFE_HERO_SETTINGS });
    await openApp(page);

    const hero = page.getByRole('complementary', { name: 'Life Hero' });
    const voice = hero.getByRole('region', { name: 'Hero voice' });
    await expect(voice.getByText(/Your progress is safe/)).toBeVisible();
    expect(await page.evaluate(() => (
      window as typeof window & { __lifeHeroSpeechCalls: number }
    ).__lifeHeroSpeechCalls)).toBe(0);

    const play = voice.locator('.life-hero-voice-actions > button').first();
    await expect(play).toHaveText('Hear encouragement');
    await play.click();
    await expect(voice).toHaveAttribute('data-voice-status', 'speaking');
    await expect(play).toBeDisabled();
    await expect(voice).toHaveAttribute('data-voice-status', 'idle');
    expect(await page.evaluate(() => (
      window as typeof window & { __lifeHeroSpeechCalls: number }
    ).__lifeHeroSpeechCalls)).toBe(1);
    await expect(voice.getByRole('button', { name: 'Ready shortly' })).toBeDisabled();

    await voice.getByRole('button', { name: 'Mute Life Hero voice' }).click();
    await expect(voice.getByRole('button', { name: 'Turn Life Hero voice on' }))
      .toHaveAttribute('aria-pressed', 'true');
    await expect(voice.getByRole('button', { name: 'Text only' })).toBeDisabled();
    await expect(voice.getByText('Muted. Encouragement remains available as text.')).toBeVisible();
  });

  test('renders an actionable text fallback when browser speech fails', async ({ page, scenario }) => {
    await page.setViewportSize({ width: 390, height: 844 });
    await installSpeechHarness(page, 'failed');
    await scenario({ settings: LIFE_HERO_SETTINGS });
    await openApp(page);

    await page.getByRole('button', { name: /Show Life Hero companion/ }).click();
    const voice = page.getByRole('region', { name: 'Hero voice' });
    await voice.getByRole('button', { name: 'Hear encouragement' }).click();
    await expect(voice.getByRole('alert')).toContainText('Use the encouragement above as text');
  });

  test('fails closed on an invalid snapshot without replacing Prayer', async ({ page, scenario }) => {
    await page.setViewportSize({ width: 1440, height: 900 });
    await scenario({
      settings: LIFE_HERO_SETTINGS,
      lifeHero: {
        snapshot: {
          rulesetVersion: 'life-hero-v1',
          totalXp: 500,
          overallLevel: 3,
          updatedAt: '2026-08-30T07:00:00.000Z',
          recomputedAt: '2026-08-30T07:00:00.000Z',
          stats: Array.from({ length: 7 }, () => ({
            stat: 'faith',
            totalXp: 'not-a-number',
            level: 2,
            lastEvidenceLocalDate: null,
            condition: 'steady',
            attentionAfterDays: 1,
          })),
          recentActivity: [],
        },
      },
    });
    await openApp(page);

    await expect(page.getByRole('heading', { name: 'Prayer', exact: true })).toBeVisible();
    const hero = page.getByRole('complementary', { name: 'Life Hero' });
    await expect(hero.getByRole('alert')).toContainText('Your stored progress is safe');
    await expect(hero.getByText('Overall level')).toHaveCount(0);
  });
});

test('captures the actual maximum-quality dashboard avatar at desktop and mobile widths @visual', async ({ page, scenario }) => {
  test.setTimeout(180_000);
  test.skip(
    process.env.HELM_E2E_VISUAL_SURFACE !== 'life-hero-dashboard',
    'Life Hero dashboard visual capture only.',
  );
  await page.addInitScript(() => {
    Object.defineProperty(navigator, 'webdriver', { configurable: true, value: false });
    Object.defineProperty(navigator, 'deviceMemory', { configurable: true, value: 8 });
    Object.defineProperty(navigator, 'hardwareConcurrency', { configurable: true, value: 8 });
  });
  await scenario({ settings: LIFE_HERO_SETTINGS });

  for (const viewport of requestedViewports()) {
    const [width, height] = viewport.split('x').map(Number);
    await page.setViewportSize({ width, height });
    await page.goto('/');
    if (width <= 900) {
      const collapsed = page.getByRole('button', { name: /Show Life Hero companion/ });
      await expect(collapsed).toBeVisible();
      await collapsed.click();
    }

    const hero = page.locator('aside.life-hero-companion:not(.is-collapsed)');
    await expect(hero).toBeVisible();
    await expect(hero).toHaveAttribute('data-avatar-status', 'ready', { timeout: 120_000 });
    await hero.getByRole('button', { name: 'Open hero details' }).click();
    await expect(hero.locator('canvas')).toHaveAttribute('data-garment', 'base-only');
    expect(await page.evaluate(() => document.documentElement.scrollWidth <= window.innerWidth)).toBe(true);
    await page.screenshot({ path: test.info().outputPath(`life-hero-dashboard-${viewport}.png`) });
  }

  await page.emulateMedia({ reducedMotion: 'reduce' });
  await page.setViewportSize({ width: 390, height: 844 });
  await page.goto('/');
  await page.getByRole('button', { name: /Show Life Hero companion/ }).click();
  const reducedHero = page.locator('aside.life-hero-companion:not(.is-collapsed)');
  const reducedFallback = reducedHero.getByRole('img', { name: 'Original Life Hero standing in a ready pose' });
  await expect(reducedFallback).toBeVisible();
  await expect(reducedFallback).toHaveAttribute('src', /life-hero-jacket-off/u);
  await expect.poll(() => reducedFallback.evaluate((image: HTMLImageElement) => (
    image.complete && image.naturalWidth > 0
  ))).toBe(true);
  await expect(reducedHero.locator('canvas')).toHaveCount(0);
  await page.screenshot({ path: test.info().outputPath('life-hero-dashboard-reduced-motion-390x844.png') });
});
