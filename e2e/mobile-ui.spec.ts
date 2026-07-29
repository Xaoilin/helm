import { test, expect, type Page } from '@playwright/test';
import { mkdirSync, readFileSync } from 'node:fs';
import path from 'node:path';

const packageJson = JSON.parse(
  readFileSync(new URL('../package.json', import.meta.url), 'utf8'),
) as { version: string };

const screenshotRoot = path.join('test-results', 'mobile-ui', packageJson.version);

const viewports = [
  { name: 'phone-320', width: 320, height: 568 },
  { name: 'phone-390', width: 390, height: 844 },
  { name: 'tablet-768', width: 768, height: 1024 },
  { name: 'desktop-1366', width: 1366, height: 768 },
] as const;

const surfaces = [
  'Dashboard',
  'Chat',
  'Inbox',
  'Calendar',
  'Clock',
  'Trips',
  'Projects',
  'Tasks',
  'Finance',
  'Health',
  'Knowledge',
  'Profile',
  'Integrations',
  'Activity',
  'Settings',
  'Debug',
] as const;

const mobilePrimarySurfaces = new Set(['Dashboard', 'Chat', 'Calendar', 'Tasks']);

test.describe('Mobile-first UI coverage', () => {
  test.describe.configure({ timeout: 300_000 });

  test('renders surfaces and captures mobile interaction states', async ({ page }) => {
    for (const viewport of viewports) {
      mkdirSync(path.join(screenshotRoot, viewport.name), { recursive: true });
      await page.setViewportSize({ width: viewport.width, height: viewport.height });
      await page.goto('/');
      await page.waitForSelector('.app-layout');

      for (const surface of surfaces) {
        await navigateToSurface(page, surface, viewport.width <= 760);
        await page.waitForTimeout(150);
        await expect(page.locator(`main[aria-label="${surface.toLowerCase()} surface"]`)).toBeVisible();
        await expectNoAccidentalOverflow(page);
        await page.screenshot({
          path: path.join(screenshotRoot, viewport.name, `${slug(surface)}.png`),
          fullPage: true,
        });
      }
    }

    mkdirSync(path.join(screenshotRoot, 'interactions'), { recursive: true });
    await seedCalendar(page);
    await page.setViewportSize({ width: 390, height: 844 });
    await page.goto('/');
    await page.waitForSelector('.app-layout');

    await page.getByRole('button', { name: 'Open more navigation' }).click();
    await page.screenshot({ path: path.join(screenshotRoot, 'interactions', 'more-sheet.png'), fullPage: true });
    await page.getByRole('button', { name: 'Close more navigation' }).click();

    await page.getByRole('button', { name: 'Talk to Lina' }).click();
    await page.screenshot({ path: path.join(screenshotRoot, 'interactions', 'lina-open.png'), fullPage: true });
    await page.keyboard.press('Escape');

    await navigateToSurface(page, 'Chat', true);
    await page.getByRole('button', { name: 'New conversation' }).click();
    await page.screenshot({ path: path.join(screenshotRoot, 'interactions', 'chat-detail.png'), fullPage: true });

    await navigateToSurface(page, 'Calendar', true);
    await page.getByRole('button', { name: 'Month' }).click();
    await page.screenshot({ path: path.join(screenshotRoot, 'interactions', 'calendar-month.png'), fullPage: true });
    await page.getByRole('button', { name: 'Week' }).click();
    await page.screenshot({ path: path.join(screenshotRoot, 'interactions', 'calendar-week.png'), fullPage: true });
    await page.getByRole('button', { name: /\+ Event/ }).click();
    await page.screenshot({ path: path.join(screenshotRoot, 'interactions', 'calendar-add-event.png'), fullPage: true });
    await page.locator('.modal').getByRole('button', { name: 'Cancel' }).click();

    await navigateToSurface(page, 'Tasks', true);
    await page.getByRole('button', { name: /\+ Add Task/ }).click();
    await page.screenshot({ path: path.join(screenshotRoot, 'interactions', 'tasks-add-task.png'), fullPage: true });
    await page.locator('.modal').getByRole('button', { name: 'Cancel' }).click();

    await navigateToSurface(page, 'Settings', true);
    await page.screenshot({ path: path.join(screenshotRoot, 'interactions', 'settings.png'), fullPage: true });
    await expectNoAccidentalOverflow(page);
  });

  test('captures the Projects catalogue, drawer, sheet, and management states', async ({ page }) => {
    const projectsRoot = path.join(screenshotRoot, 'projects');
    mkdirSync(projectsRoot, { recursive: true });
    await seedProjects(page);

    for (const viewport of [
      { name: 'desktop-1440', width: 1440, height: 900 },
      { name: 'desktop-1024', width: 1024, height: 768 },
      { name: 'phone-390', width: 390, height: 844 },
    ]) {
      await page.setViewportSize({ width: viewport.width, height: viewport.height });
      await page.goto('/');
      await page.waitForSelector('.app-layout');
      await navigateToSurface(page, 'Projects', viewport.width <= 760);
      await expect(page.locator('.project-catalog-card')).toHaveCount(4);
      await expectNoAccidentalOverflow(page);
      await page.screenshot({
        path: path.join(projectsRoot, `${viewport.name}-catalogue.png`),
        fullPage: true,
      });

      const orbitCard = page.locator('.project-catalog-card').filter({ hasText: 'Orbit Console' });
      await orbitCard.getByRole('button', { name: 'View details' }).click();
      await expect(page.getByRole('dialog', { name: 'Orbit Console' })).toBeVisible();
      await page.waitForTimeout(250);
      await expectNoAccidentalOverflow(page);
      await page.screenshot({
        path: path.join(projectsRoot, `${viewport.name}-details.png`),
        fullPage: true,
      });

      if (viewport.width === 1440) {
        await page.getByRole('button', { name: 'Manage project' }).click();
        await expect(page.getByRole('tab', { name: 'Board' })).toBeVisible();
        await page.screenshot({
          path: path.join(projectsRoot, `${viewport.name}-manage.png`),
          fullPage: true,
        });
      }
    }
  });
});

async function navigateToSurface(page: Page, surface: typeof surfaces[number], isMobile: boolean) {
  if (!isMobile || mobilePrimarySurfaces.has(surface)) {
    await page.getByRole('button', { name: `Navigate to ${surface}` }).click();
    return;
  }

  await page.getByRole('button', { name: 'Open more navigation' }).click();
  await page.getByRole('button', { name: surface }).click();
}

async function expectNoAccidentalOverflow(page: Page) {
  const result = await page.evaluate(() => {
    const intentionalScrollContainers = [
      '.tabs',
      '.calendar-mobile-day-strip',
      '.dash-achievements-row',
      '.account-legend',
      '.health-quick-dates',
      '.finance-type-toggle',
      '.clock-toolbar-metrics',
      '.clock-toolbar-actions',
      '.projects-catalog-stats',
      '.projects-filter-chips',
    ];

    const isIntentional = (element: Element) =>
      intentionalScrollContainers.some(selector => element.closest(selector));

    const issues = Array.from(document.querySelectorAll('body *'))
      .filter(element => {
        const rect = element.getBoundingClientRect();
        const style = window.getComputedStyle(element);
        if (style.display === 'none' || style.visibility === 'hidden' || Number(style.opacity) === 0) return false;
        if (rect.width < 1 || rect.height < 1) return false;
        if (isIntentional(element)) return false;
        return rect.left < -1 || rect.right > window.innerWidth + 1;
      })
      .slice(0, 8)
      .map(element => {
        const rect = element.getBoundingClientRect();
        return {
          tag: element.tagName.toLowerCase(),
          className: typeof element.className === 'string' ? element.className : '',
          text: (element.textContent || '').replace(/\s+/g, ' ').trim().slice(0, 80),
          left: Math.round(rect.left),
          right: Math.round(rect.right),
          width: Math.round(rect.width),
        };
      });

    return {
      documentWidth: document.documentElement.scrollWidth,
      viewportWidth: document.documentElement.clientWidth,
      issues,
    };
  });

  expect(result.documentWidth).toBeLessThanOrEqual(result.viewportWidth + 1);
  expect(result.issues).toEqual([]);
}

async function seedCalendar(page: Page) {
  await page.addInitScript(() => {
    const today = new Date();
    const morningStart = new Date(today);
    morningStart.setHours(10, 15, 0, 0);
    const morningEnd = new Date(today);
    morningEnd.setHours(11, 15, 0, 0);
    const afternoonStart = new Date(today);
    afternoonStart.setHours(13, 0, 0, 0);
    const afternoonEnd = new Date(today);
    afternoonEnd.setHours(13, 20, 0, 0);

    localStorage.setItem('helm:calendarAccounts', JSON.stringify([{
      id: 'acc-mobile',
      name: 'Personal',
      email: 'alisa@example.com',
      provider: 'local',
      isPrimary: true,
      connected: true,
      mocked: false,
    }]));
    localStorage.setItem('helm:calendarSources', JSON.stringify([{
      id: 'src-mobile',
      accountId: 'acc-mobile',
      name: 'Personal',
      color: '#4285f4',
      visible: true,
    }]));
    localStorage.setItem('helm:calendarEvents', JSON.stringify([
      {
        id: 'evt-mobile-morning',
        sourceId: 'src-mobile',
        title: 'Morning planning',
        description: '',
        start: morningStart.toISOString(),
        end: morningEnd.toISOString(),
        allDay: false,
        createdAt: today.toISOString(),
        updatedAt: today.toISOString(),
      },
      {
        id: 'evt-mobile-afternoon',
        sourceId: 'src-mobile',
        title: 'Afternoon check-in',
        description: '',
        start: afternoonStart.toISOString(),
        end: afternoonEnd.toISOString(),
        allDay: false,
        createdAt: today.toISOString(),
        updatedAt: today.toISOString(),
      },
    ]));
  });
}

async function seedProjects(page: Page) {
  await page.addInitScript(() => {
    const timestamp = '2026-07-29T12:00:00.000Z';
    localStorage.setItem('helm:projects', JSON.stringify([
      {
        id: 'project-orbit-console',
        catalogKey: 'fixture:orbit-console',
        name: 'Orbit Console',
        kind: 'desktop_app',
        summary: 'A desktop command centre and project reference example.',
        status: 'active',
        tags: ['app', 'productivity', 'tauri'],
        isPinned: true,
        links: [
          { id: 'orbit-live', kind: 'deployment', label: 'Live Orbit Console', url: 'https://example.com/orbit/' },
          { id: 'orbit-repo', kind: 'repository', label: 'GitHub repository', url: 'https://github.com/example/orbit-console' },
        ],
        setupSteps: [
          { id: 'orbit-install', title: 'Install dependencies', description: 'Requires Node.js and npm.', displayCode: 'npm install' },
        ],
        runRecipes: [
          {
            id: 'orbit-dev',
            label: 'Development server',
            displayCommand: 'npm run dev',
            executable: 'npm',
            args: ['run', 'dev'],
            prerequisites: ['Node.js', 'npm'],
            mode: 'service',
          },
        ],
        preview: { icon: 'OC', accentColor: '#8b7cff', backgroundColor: '#17172a' },
        verifiedAt: timestamp,
        createdAt: timestamp,
        updatedAt: timestamp,
      },
      {
        id: 'project-canvas-studio',
        catalogKey: 'fixture:canvas-studio',
        name: 'Canvas Studio',
        kind: 'web_app',
        summary: 'A collaborative visual whiteboard with a WebGL canvas.',
        status: 'active',
        tags: ['app', 'whiteboard'],
        isPinned: true,
        links: [
          { id: 'canvas-live', kind: 'deployment', label: 'Live Canvas Studio', url: 'https://example.com/canvas/' },
        ],
        setupSteps: [],
        runRecipes: [],
        preview: { icon: 'CS', accentColor: '#4f9cff', backgroundColor: '#112033' },
        verifiedAt: timestamp,
        createdAt: timestamp,
        updatedAt: timestamp,
      },
      {
        id: 'project-caption-local',
        catalogKey: 'fixture:caption-local',
        name: 'Caption Local',
        kind: 'web_app',
        summary: 'A private local media transcription utility.',
        status: 'active',
        tags: ['app', 'local-first'],
        isPinned: false,
        links: [],
        setupSteps: [],
        runRecipes: [
          {
            id: 'caption-ui',
            label: 'Local transcription UI',
            displayCommand: 'caption-local --host 127.0.0.1 --port 7860',
            executable: 'caption-local',
            args: ['--host', '127.0.0.1', '--port', '7860'],
            prerequisites: ['Python 3.10+', 'ffmpeg'],
            localUrl: 'http://127.0.0.1:7860/',
            mode: 'service',
          },
        ],
        preview: { icon: 'CL', accentColor: '#ef4444', backgroundColor: '#2a1218' },
        verifiedAt: timestamp,
        createdAt: timestamp,
        updatedAt: timestamp,
      },
      {
        id: 'project-sensor-bench',
        catalogKey: 'fixture:sensor-bench',
        name: 'Sensor Bench',
        kind: 'hardware',
        summary: 'An electronics, firmware, and enclosure reference workspace.',
        status: 'active',
        tags: ['hardware', 'electronics'],
        isPinned: false,
        links: [],
        setupSteps: [],
        runRecipes: [],
        preview: { icon: 'SB', accentColor: '#f472b6', backgroundColor: '#2b1624' },
        verifiedAt: timestamp,
        createdAt: timestamp,
        updatedAt: timestamp,
      },
    ]));
  });
}

function slug(value: string): string {
  return value.toLowerCase().replace(/[^a-z0-9]+/g, '-');
}
