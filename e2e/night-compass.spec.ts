import { mkdirSync, readFileSync } from 'node:fs';
import path from 'node:path';
import { DEFAULT_PROFILE } from '../src/services/gamification';
import {
  createDefaultDailyMomentumState,
  getDailyMomentumPillarState,
  recordDailyMomentumProgress,
} from '../src/services/dailyMomentum';
import { expect, test } from './support/helm-fixture';

const packageJson = JSON.parse(
  readFileSync(new URL('../package.json', import.meta.url), 'utf8'),
) as { version: string };

const evidenceRoot = path.join(
  'test-results',
  'night-compass',
  packageJson.version,
  process.env.HELM_E2E_RUN_ID || 'manual',
);

const acceptanceViewports = [
  { name: '1440x900', width: 1440, height: 900 },
  { name: '1024x768', width: 1024, height: 768 },
  { name: '390x844', width: 390, height: 844 },
] as const;

function dailyMomentumProfile() {
  let state = createDefaultDailyMomentumState();
  state = recordDailyMomentumProgress(state, {
    date: '2026-07-28',
    pillar: 'learn',
    templateId: 'learn-reading',
    stepId: 'pages',
    amount: 2,
    updatedAt: '2026-07-28T08:00:00.000Z',
  });
  state = recordDailyMomentumProgress(state, {
    date: '2026-07-28',
    pillar: 'move',
    templateId: 'move-active-minutes',
    stepId: 'active-minutes',
    amount: 10,
    updatedAt: '2026-07-28T08:05:00.000Z',
  });
  return {
    ...DEFAULT_PROFILE,
    dailyMomentumLearn: getDailyMomentumPillarState(state, 'learn'),
    dailyMomentumMove: getDailyMomentumPillarState(state, 'move'),
  };
}

function prayerTracking() {
  return {
    schemaVersion: 1,
    trackingStartedAt: '2026-07-27T00:00:00.000Z',
    reminderReceipts: {},
    records: {
      '2026-07-28::Fajr': {
        date: '2026-07-28', prayerName: 'Fajr', status: 'on_time', recordedAt: '2026-07-28T05:10:00.000Z',
      },
      '2026-07-28::Dhuhr': {
        date: '2026-07-28', prayerName: 'Dhuhr', status: 'late', recordedAt: '2026-07-28T18:00:00.000Z',
      },
      '2026-07-28::Asr': {
        date: '2026-07-28', prayerName: 'Asr', status: 'missed', recordedAt: '2026-07-28T20:00:00.000Z',
      },
      '2026-07-28::Maghrib': {
        date: '2026-07-28', prayerName: 'Maghrib', status: 'unclassified', recordedAt: '2026-07-28T20:20:00.000Z',
      },
    },
  };
}

function longTask() {
  return {
    id: 'task-night-compass-long-title',
    title: 'Prepare the extraordinarily detailed launch readiness review without allowing this task title to widen the dashboard',
    description: '',
    completed: false,
    priority: 'high',
    category: 'task',
    dueDate: '2026-07-28',
    createdAt: '2026-07-28T08:00:00.000Z',
    updatedAt: '2026-07-28T08:00:00.000Z',
  };
}

test.describe('Night Compass acceptance', () => {
  test.describe.configure({ timeout: 180_000 });

  test('@visual captures the exact prayer-first candidate at all accepted viewports', async ({ page, scenario }) => {
    test.skip(
      Boolean(process.env.HELM_E2E_VISUAL_SURFACE && process.env.HELM_E2E_VISUAL_SURFACE !== 'dashboard'),
      'A different visual surface was requested.',
    );
    await scenario('prayer', {
      surface: 'dashboard',
      now: '2026-07-28T19:30:00.000Z',
      tasks: [longTask()],
      storage: {
        'helm:gamification': dailyMomentumProfile(),
        'helm:prayerTracking': prayerTracking(),
      },
    });
    await page.emulateMedia({ reducedMotion: 'reduce' });
    mkdirSync(evidenceRoot, { recursive: true });

    for (const viewport of acceptanceViewports) {
      await page.setViewportSize(viewport);
      await page.goto('/');
      const dashboard = page.getByRole('region', { name: 'Night Compass daily dashboard' });
      await expect(dashboard).toBeVisible();
      await expect(page.locator('.nc-prayer-item')).toHaveCount(5);
      await expect(page.getByText(longTask().title)).toHaveCount(1);
      const motivation = page.getByRole('complementary', { name: 'Quran-first encouragement' });
      await expect(motivation).toBeVisible();
      await expect(motivation.getByText('Reviewed meaning (paraphrase):')).toBeVisible();
      await expect(motivation.getByRole('link', { name: /Quran .* Source/u })).toHaveAttribute('href', /^https:\/\/quran\.com\//u);

      const metrics = await page.evaluate(() => {
        const rect = (selector: string) => {
          const value = document.querySelector(selector)?.getBoundingClientRect();
          return value ? { x: value.x, y: value.y, width: value.width, height: value.height } : null;
        };
        const prayer = rect('.nc-prayer-card');
        const learn = rect('.nc-learn');
        const move = rect('.nc-move');
        const motivation = rect('.nc-quran-motivation');
        const tasks = rect('.nc-tasks-card');
        return {
          viewport: { width: innerWidth, height: innerHeight },
          document: {
            clientWidth: document.documentElement.clientWidth,
            scrollWidth: document.documentElement.scrollWidth,
          },
          prayer,
          learn,
          move,
          motivation,
          tasks,
          meaningfulRunningAnimations: document.querySelector('.nc-dashboard')?.getAnimations({ subtree: true })
            .filter(animation => {
              const duration = Number(animation.effect?.getComputedTiming().duration ?? 0);
              return animation.playState === 'running' && duration > 1;
            }).length ?? 0,
        };
      });
      expect(metrics.document.scrollWidth).toBeLessThanOrEqual(metrics.document.clientWidth + 1);
      expect(metrics.prayer?.y).toBeLessThan(metrics.learn?.y ?? Number.POSITIVE_INFINITY);
      expect(metrics.prayer?.height).toBeGreaterThan(metrics.learn?.height ?? 0);
      expect(metrics.prayer?.y).toBeLessThan(metrics.motivation?.y ?? Number.POSITIVE_INFINITY);
      expect(metrics.motivation?.y).toBeLessThan(metrics.learn?.y ?? Number.POSITIVE_INFINITY);
      expect(metrics.meaningfulRunningAnimations).toBe(0);
      if (viewport.width === 1440) {
        expect((metrics.prayer?.height ?? 0) / (viewport.height - (metrics.prayer?.y ?? 0)))
          .toBeGreaterThanOrEqual(0.55);
      }
      if (viewport.width === 1024) {
        expect(metrics.prayer?.x).toBe(240);
      }
      if (viewport.width === 390) {
        expect(metrics.learn?.y).toBeLessThan(metrics.move?.y ?? Number.POSITIVE_INFINITY);
        expect(metrics.move?.y).toBeLessThan(metrics.tasks?.y ?? Number.POSITIVE_INFINITY);
      } else {
        expect(metrics.learn?.width).toBeGreaterThanOrEqual(280);
        expect(metrics.move?.width).toBeGreaterThanOrEqual(280);
      }
      console.log('[night-compass-layout]', JSON.stringify(metrics));

      await page.screenshot({
        path: path.join(evidenceRoot, `${viewport.name}-dashboard-viewport.png`),
        fullPage: false,
      });
      await dashboard.screenshot({
        path: path.join(evidenceRoot, `${viewport.name}-dashboard-full.png`),
      });
    }
  });

  test('@visual keeps the permission fallback actionable without hiding any pillar', async ({ page, scenario }) => {
    test.skip(
      Boolean(process.env.HELM_E2E_VISUAL_SURFACE && process.env.HELM_E2E_VISUAL_SURFACE !== 'dashboard'),
      'A different visual surface was requested.',
    );
    await scenario('prayer', {
      surface: 'dashboard',
      now: '2026-07-28T15:31:00.000Z',
    });
    await page.emulateMedia({ reducedMotion: 'reduce' });
    mkdirSync(evidenceRoot, { recursive: true });

    for (const viewport of [acceptanceViewports[0], acceptanceViewports[2]]) {
      await page.setViewportSize(viewport);
      await page.goto('/');
      const reminder = page.getByRole('alert').filter({ hasText: 'Native notifications are unavailable' });
      await expect(reminder).toBeVisible();
      await expect(reminder.getByRole('button', { name: 'Repair notifications' })).toBeVisible();
      await expect(reminder.getByRole('button', { name: 'Snooze once' })).toBeVisible();
      await expect(page.getByRole('heading', { name: 'Prayer', exact: true })).toBeVisible();
      await expect(page.getByRole('heading', { name: 'Learn', exact: true })).toBeVisible();
      await expect(page.getByRole('heading', { name: 'Move', exact: true })).toBeVisible();
      const width = await page.evaluate(() => ({
        client: document.documentElement.clientWidth,
        scroll: document.documentElement.scrollWidth,
      }));
      expect(width.scroll).toBeLessThanOrEqual(width.client + 1);
      await reminder.screenshot({
        path: path.join(evidenceRoot, `${viewport.name}-permission-fallback.png`),
      });
    }
  });

  test('@visual keeps schedule failure actionable and the dashboard intact', async ({ page, scenario }) => {
    test.skip(
      Boolean(process.env.HELM_E2E_VISUAL_SURFACE && process.env.HELM_E2E_VISUAL_SURFACE !== 'dashboard'),
      'A different visual surface was requested.',
    );
    await scenario('prayer', {
      surface: 'dashboard',
      now: '2026-07-28T15:31:00.000Z',
      prayerTimes: { failureStatus: 503 },
    });
    await page.setViewportSize(acceptanceViewports[2]);
    await page.goto('/');

    const failure = page.getByText('Prayer schedule unavailable');
    await expect(failure).toBeVisible({ timeout: 30_000 });
    await expect(page.getByRole('button', { name: 'Retry schedule' })).toBeVisible();
    await expect(page.getByRole('heading', { name: 'Prayer', exact: true })).toBeVisible();
    await expect(page.getByRole('heading', { name: 'Learn', exact: true })).toBeVisible();
    await expect(page.getByRole('heading', { name: 'Move', exact: true })).toBeVisible();
    const width = await page.evaluate(() => ({
      client: document.documentElement.clientWidth,
      scroll: document.documentElement.scrollWidth,
    }));
    expect(width.scroll).toBeLessThanOrEqual(width.client + 1);
    await page.screenshot({
      path: path.join(evidenceRoot, '390x844-schedule-failure.png'),
      fullPage: false,
    });
  });

  test('@visual pauses mismatched-timezone reminders without hiding dashboard pillars', async ({ page, scenario }) => {
    test.skip(
      Boolean(process.env.HELM_E2E_VISUAL_SURFACE && process.env.HELM_E2E_VISUAL_SURFACE !== 'dashboard'),
      'A different visual surface was requested.',
    );
    await scenario('prayer', {
      surface: 'dashboard',
      now: '2026-07-28T15:31:00.000Z',
      prayerTimes: { timezone: 'America/New_York' },
    });
    await page.setViewportSize(acceptanceViewports[2]);
    await page.goto('/');

    await expect(page.getByText('Schedule timezone does not match this desktop')).toBeVisible();
    await expect(page.getByRole('button', { name: 'Repair prayer settings' })).toBeVisible();
    await expect(page.getByRole('heading', { name: 'Prayer', exact: true })).toBeVisible();
    await expect(page.getByRole('heading', { name: 'Learn', exact: true })).toBeVisible();
    await expect(page.getByRole('heading', { name: 'Move', exact: true })).toBeVisible();
    const width = await page.evaluate(() => ({
      client: document.documentElement.clientWidth,
      scroll: document.documentElement.scrollWidth,
    }));
    expect(width.scroll).toBeLessThanOrEqual(width.client + 1);
    await page.screenshot({
      path: path.join(evidenceRoot, '390x844-timezone-mismatch.png'),
      fullPage: false,
    });
  });

  test('proves keyboard behavior, reduced-motion meaning, contrast, and the owning mobile scroller', async ({ page, scenario }) => {
    await scenario('prayer', {
      surface: 'dashboard',
      now: '2026-07-28T11:59:00.000Z',
      tasks: [longTask()],
      storage: { 'helm:gamification': dailyMomentumProfile() },
    });
    await page.setViewportSize({ width: 390, height: 844 });
    await page.emulateMedia({ reducedMotion: 'reduce' });
    await page.goto('/');
    await expect(page.getByRole('heading', { name: 'Night Compass' })).toBeVisible();

    const firstPrayer = page.getByRole('button', { name: 'Complete Fajr Prayer' });
    await firstPrayer.focus();
    await page.keyboard.press('Tab');
    await page.keyboard.press('Shift+Tab');
    await expect(firstPrayer).toBeFocused();
    await expect(firstPrayer).toHaveCSS('outline-width', '2px');
    await page.keyboard.press('Enter');
    await expect(page.getByRole('dialog', { name: 'How was Fajr prayed?' })).toBeVisible();
    await page.keyboard.press('Escape');
    await expect(firstPrayer).toBeFocused();

    const contrast = await page.evaluate(() => {
      const parse = (value: string) => value.match(/[\d.]+/gu)?.slice(0, 3).map(Number) ?? [0, 0, 0];
      const luminance = (rgb: number[]) => {
        const values = rgb.map(channel => {
          const normalized = channel / 255;
          return normalized <= 0.03928 ? normalized / 12.92 : ((normalized + 0.055) / 1.055) ** 2.4;
        });
        return 0.2126 * values[0] + 0.7152 * values[1] + 0.0722 * values[2];
      };
      const ratio = (foreground: string, background: string) => {
        const lighter = Math.max(luminance(parse(foreground)), luminance(parse(background)));
        const darker = Math.min(luminance(parse(foreground)), luminance(parse(background)));
        return (lighter + 0.05) / (darker + 0.05);
      };
      const card = getComputedStyle(document.querySelector('.nc-prayer-card')!);
      const metadata = getComputedStyle(document.querySelector('.nc-prayer-location')!);
      const taskCard = getComputedStyle(document.querySelector('.nc-tasks-card')!);
      const taskText = getComputedStyle(document.querySelector('.nc-task-preview')!);
      return {
        prayerMetadata: ratio(metadata.color, card.backgroundColor),
        taskPreview: ratio(taskText.color, taskCard.backgroundColor),
      };
    });
    expect(contrast.prayerMetadata).toBeGreaterThanOrEqual(4.5);
    expect(contrast.taskPreview).toBeGreaterThanOrEqual(4.5);

    const before = await page.evaluate(() => {
      const scroller = document.querySelector('.main-content')!;
      const anchor = document.querySelector('.nc-tasks-card')!.getBoundingClientRect();
      return {
        clientHeight: scroller.clientHeight,
        scrollHeight: scroller.scrollHeight,
        scrollTop: scroller.scrollTop,
        anchorY: anchor.y,
      };
    });
    await page.mouse.wheel(0, 620);
    await expect.poll(() => page.locator('.main-content').evaluate(element => element.scrollTop)).toBeGreaterThan(0);
    await page.keyboard.press('PageDown');
    const after = await page.evaluate(() => {
      const scroller = document.querySelector('.main-content')!;
      const anchor = document.querySelector('.nc-tasks-card')!.getBoundingClientRect();
      return {
        clientHeight: scroller.clientHeight,
        scrollHeight: scroller.scrollHeight,
        scrollTop: scroller.scrollTop,
        anchorY: anchor.y,
      };
    });
    expect(before.scrollHeight).toBeGreaterThan(before.clientHeight);
    expect(after.scrollTop).toBeGreaterThan(before.scrollTop);
    expect(after.anchorY).toBeLessThan(before.anchorY);
    console.log('[night-compass-scroll]', JSON.stringify({ before, after, contrast }));
  });

  test('keeps names, states, and actions reachable at a 200% equivalent layout viewport', async ({ page, scenario }) => {
    await scenario('prayer', {
      surface: 'dashboard',
      now: '2026-07-28T19:30:00.000Z',
      tasks: [longTask()],
      storage: {
        'helm:gamification': dailyMomentumProfile(),
        'helm:prayerTracking': prayerTracking(),
      },
    });
    await page.setViewportSize({ width: 720, height: 450 });
    await page.goto('/');

    const prayerItems = page.locator('.nc-prayer-item');
    await expect(prayerItems).toHaveCount(5);
    for (const name of ['Fajr', 'Dhuhr', 'Asr', 'Maghrib', 'Isha']) {
      await expect(page.locator('.nc-prayer-name', { hasText: name })).toBeVisible();
    }
    await page.getByRole('button', { name: 'Open tasks' }).scrollIntoViewIfNeeded();
    await expect(page.getByRole('button', { name: 'Open tasks' })).toBeVisible();

    const zoomMetrics = await page.evaluate(() => ({
      clientWidth: document.documentElement.clientWidth,
      scrollWidth: document.documentElement.scrollWidth,
      prayerStates: [...document.querySelectorAll('.nc-prayer-state')].map(element => {
        const rect = element.getBoundingClientRect();
        return { width: rect.width, height: rect.height, text: element.textContent };
      }),
    }));
    expect(zoomMetrics.scrollWidth).toBeLessThanOrEqual(zoomMetrics.clientWidth + 1);
    expect(zoomMetrics.prayerStates.every(state => state.width > 0 && state.height > 0 && state.text)).toBe(true);
  });
});
