import { mkdirSync, readFileSync } from 'node:fs';
import path from 'node:path';
import type { Page } from '@playwright/test';
import { expect, test } from './support/helm-fixture';

const packageJson = JSON.parse(
  readFileSync(new URL('../package.json', import.meta.url), 'utf8'),
) as { version: string };

const screenshotRoot = path.join(
  'test-results',
  'mobile-ui',
  packageJson.version,
  process.env.HELM_E2E_RUN_ID || 'manual',
);

const viewportCatalog = {
  'phone-320': { width: 320, height: 568 },
  'phone-390': { width: 390, height: 844 },
  'tablet-768': { width: 768, height: 1024 },
  'desktop-1024': { width: 1024, height: 768 },
  'desktop-1366': { width: 1366, height: 768 },
  'desktop-1440': { width: 1440, height: 900 },
} as const;

type ViewportName = keyof typeof viewportCatalog;
interface VisualViewport {
  height: number;
  name: string;
  width: number;
}

const behaviorViewportNames: ViewportName[] = [
  'phone-320',
  'phone-390',
  'tablet-768',
  'desktop-1366',
];

const surfaces = [
  'Dashboard',
  'Chat',
  'Inventory',
  'Calendar',
  'Clock',
  'Trips',
  'Projects',
  'Secrets',
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

type SurfaceName = typeof surfaces[number];

const mobilePrimarySurfaces = new Set<SurfaceName>([
  'Dashboard',
  'Chat',
  'Calendar',
  'Tasks',
]);

test.describe('Responsive UI behavior', () => {
  test.describe.configure({ timeout: 120_000 });

  test('keeps every surface within supported viewport boundaries', async ({ page, scenario }) => {
    await scenario('empty');

    for (const viewportName of behaviorViewportNames) {
      const viewport = viewportCatalog[viewportName];
      await page.setViewportSize(viewport);
      await page.goto('/');
      await expect(page.locator('.app-layout')).toBeVisible();

      for (const surface of surfaces) {
        await navigateToSurface(page, surface, viewport.width <= 760);
        await expect(
          page.locator(`main[aria-label="${surface.toLowerCase()} surface"]`),
        ).toBeVisible();
        await expectNoAccidentalOverflow(page);
      }
    }
  });

  test('@smoke opens the Projects catalogue and detail view', async ({ page, scenario }) => {
    await scenario('projects');
    await page.setViewportSize(viewportCatalog['phone-390']);
    await page.goto('/');
    await expect(page.locator('.app-layout')).toBeVisible();
    await navigateToSurface(page, 'Projects', true);

    await expect(page.locator('.project-catalog-card')).toHaveCount(4);
    const orbitCard = page.locator('.project-catalog-card').filter({ hasText: 'Orbit Console' });
    await orbitCard.getByRole('button', { name: 'View details' }).click();
    await expect(page.getByRole('dialog', { name: 'Orbit Console' })).toBeVisible();
  });

  test('keeps project catalogue, details, and management layouts contained', async ({
    page,
    scenario,
  }) => {
    await scenario('projects');

    for (const viewportName of ['desktop-1440', 'desktop-1024', 'phone-390'] as const) {
      const viewport = viewportCatalog[viewportName];
      await page.setViewportSize(viewport);
      await page.goto('/');
      await expect(page.locator('.app-layout')).toBeVisible();
      await navigateToSurface(page, 'Projects', viewport.width <= 760);
      await expect(page.locator('.project-catalog-card')).toHaveCount(4);
      await expectNoAccidentalOverflow(page);

      const orbitCard = page.locator('.project-catalog-card').filter({ hasText: 'Orbit Console' });
      await orbitCard.getByRole('button', { name: 'View details' }).click();
      const details = page.getByRole('dialog', { name: 'Orbit Console' });
      await expect(details).toBeVisible();
      await expectAnimationsSettled(page, '.project-reference-drawer');
      await expectNoAccidentalOverflow(page);

      if (viewport.width >= 1_000) {
        await page.getByRole('button', { name: 'Manage project' }).click();
        await expect(page.getByRole('tab', { name: 'Board' })).toBeVisible();
        await expectNoAccidentalOverflow(page);
      }
    }
  });

  test('supports mobile navigation and modal interaction states', async ({ page, scenario }) => {
    await scenario('empty', { storage: calendarStorage() });
    await page.setViewportSize(viewportCatalog['phone-390']);
    await page.goto('/');
    await expect(page.locator('.app-layout')).toBeVisible();

    await page.getByRole('button', { name: 'Open more navigation' }).click();
    await expect(page.getByRole('button', { name: 'Close more navigation' })).toBeVisible();
    await page.getByRole('button', { name: 'Close more navigation' }).click();

    await page.getByRole('button', { name: 'Talk to Lina' }).click();
    await expect(page.getByRole('button', { name: 'Close Lina' })).toBeVisible();
    await page.keyboard.press('Escape');
    await expect(page.getByRole('button', { name: 'Talk to Lina' })).toBeVisible();

    await navigateToSurface(page, 'Chat', true);
    await page.getByRole('button', { name: 'New conversation' }).click();
    await expect(page.locator('input[placeholder*="Type a message"]')).toBeVisible();

    await navigateToSurface(page, 'Calendar', true);
    await page.getByRole('button', { name: 'Month', exact: true }).click();
    await expect(page.getByRole('button', { name: 'Month', exact: true })).toHaveClass(/active/);
    await page.getByRole('button', { name: 'Week', exact: true }).click();
    await expect(page.getByRole('button', { name: 'Week', exact: true })).toHaveClass(/active/);
    await page.getByRole('button', { name: /\+ Event/ }).click();
    await expect(page.locator('.modal')).toBeVisible();
    await page.locator('.modal').getByRole('button', { name: 'Cancel' }).click();

    await navigateToSurface(page, 'Tasks', true);
    await page.getByRole('button', { name: /\+ Add Task/ }).click();
    await expect(page.locator('.modal')).toBeVisible();
    await page.locator('.modal').getByRole('button', { name: 'Cancel' }).click();

    await navigateToSurface(page, 'Settings', true);
    await expectNoAccidentalOverflow(page);
  });
});

test.describe('Opt-in visual evidence', () => {
  test.describe.configure({ timeout: 300_000 });

  test('@visual captures requested surface snapshots', async ({ page, scenario }) => {
    test.skip(visualSurfaceFilter() === 'sync', 'The sync evidence has a dedicated visual scenario.');
    await scenario('inventory', {
      secrets: [
        {
          label: 'Sabah One production database password',
          kind: 'database',
          environment: 'production',
          projectCatalogKeys: ['catalog:helm'],
          value: 'visual-fixture-value',
          username: 'postgres',
        },
        {
          label: 'Deployment webhook',
          kind: 'webhook',
          environment: 'production',
          projectCatalogKeys: ['catalog:helm'],
          value: 'visual-fixture-webhook',
        },
      ],
    });

    for (const viewport of visualViewports()) {
      mkdirSync(path.join(screenshotRoot, viewport.name), { recursive: true });
      await page.setViewportSize(viewport);
      await page.goto('/');
      await expect(page.locator('.app-layout')).toBeVisible();

      for (const surface of visualSurfaces()) {
        await navigateToSurface(page, surface, viewport.width <= 760);
        await expect(
          page.locator(`main[aria-label="${surface.toLowerCase()} surface"]`),
        ).toBeVisible();
        await expectNoAccidentalOverflow(page);
        await page.screenshot({
          path: path.join(screenshotRoot, viewport.name, `${slug(surface)}.png`),
          fullPage: true,
        });
      }
    }
  });

  test('@visual captures Inventory low-stock, project filter, needs, and paste review states', async ({ page, scenario }) => {
    test.skip(
      Boolean(visualSurfaceFilter() && visualSurfaceFilter() !== 'inventory'),
      'A different visual surface was requested.',
    );
    await scenario('inventory', { surface: 'inventory' });
    await page.emulateMedia({ reducedMotion: 'reduce' });
    const inventoryRoot = path.join(screenshotRoot, 'inventory');
    mkdirSync(inventoryRoot, { recursive: true });

    for (const viewport of visualViewports()) {
      await page.setViewportSize(viewport);
      await page.goto('/');
      await expect(page.getByRole('heading', { name: 'Know what you have before you buy.' })).toBeVisible();
      await expect(page.locator('.inventory-low-badge', { hasText: 'Low stock' })).toBeVisible();
      await expectNoAccidentalOverflow(page);
      await page.screenshot({
        path: path.join(inventoryRoot, `${viewport.name}-owned-reduced-motion.png`),
        fullPage: true,
      });

      await page.getByRole('button', { name: '+ Add owned item' }).click();
      const itemDialog = page.getByRole('dialog', { name: 'Add owned item' });
      await itemDialog.getByRole('textbox', { name: 'Name' }).fill('Secretlab MAGNUS table');
      await itemDialog.getByRole('spinbutton', { name: 'Dimension width' }).fill('700');
      await itemDialog.getByRole('spinbutton', { name: 'Dimension height' }).fill('735');
      const dimensionFields = itemDialog.locator('.inventory-dimensions');
      await expect(dimensionFields).toBeVisible();
      await dimensionFields.scrollIntoViewIfNeeded();
      await expectNoAccidentalOverflow(page);
      await page.screenshot({
        path: path.join(inventoryRoot, `${viewport.name}-dimensions-editor.png`),
        fullPage: true,
      });
      await itemDialog.getByRole('button', { name: 'Close Add owned item' }).click();

      await page.getByLabel('Filter inventory project').selectOption('fixture:sensor-bench');
      const filteredItem = page.locator('.inventory-card').filter({ hasText: 'M3 heat-set inserts' });
      await expect(filteredItem).toBeVisible();
      await expect(page.getByRole('heading', { name: 'Digital calipers' })).toHaveCount(0);
      await filteredItem.scrollIntoViewIfNeeded();
      await page.screenshot({
        path: path.join(inventoryRoot, `${viewport.name}-project-filtered.png`),
        fullPage: true,
      });

      await page.getByRole('tab', { name: 'Needed' }).click();
      const neededItem = page.locator('.inventory-need-card').filter({ hasText: 'M3 heat-set inserts' });
      await expect(neededItem.getByText('50 pcs required', { exact: false })).toBeVisible();
      await neededItem.scrollIntoViewIfNeeded();
      await expectNoAccidentalOverflow(page);
      await page.screenshot({
        path: path.join(inventoryRoot, `${viewport.name}-needed.png`),
        fullPage: true,
      });

      await page.getByRole('button', { name: 'Paste and review' }).click();
      const dialog = page.getByRole('dialog', { name: 'Paste and review' });
      await dialog.getByPlaceholder(/digital calipers/i).fill('2x Digital calipers\n100 M4 socket-head screws');
      await dialog.getByRole('button', { name: 'Review candidates' }).click();
      await expect(dialog.getByText('Likely duplicate')).toBeVisible();
      await expectNoAccidentalOverflow(page);
      await page.screenshot({
        path: path.join(inventoryRoot, `${viewport.name}-paste-review.png`),
        fullPage: true,
      });
      await dialog.getByRole('button', { name: 'Close Paste and review' }).click();
    }
  });

  test('@visual captures requested Projects catalogue and detail states', async ({
    page,
    scenario,
  }) => {
    test.skip(
      Boolean(visualSurfaceFilter() && visualSurfaceFilter() !== 'projects'),
      'A different visual surface was requested.',
    );
    await scenario('projects');
    const projectsRoot = path.join(screenshotRoot, 'projects');
    mkdirSync(projectsRoot, { recursive: true });

    for (const viewport of visualViewports()) {
      await page.setViewportSize(viewport);
      await page.goto('/');
      await expect(page.locator('.app-layout')).toBeVisible();
      await navigateToSurface(page, 'Projects', viewport.width <= 760);
      await expect(page.locator('.project-catalog-card')).toHaveCount(4);
      await expectNoAccidentalOverflow(page);
      await page.screenshot({
        path: path.join(projectsRoot, `${viewport.name}-catalogue.png`),
        fullPage: true,
      });
      await page.getByRole('heading', { name: 'Pinned' }).evaluate(element => {
        element.scrollIntoView({ block: 'start' });
      });
      await page.screenshot({
        path: path.join(projectsRoot, `${viewport.name}-catalogue-sections.png`),
        fullPage: true,
      });
      const archivedDisclosure = page.getByRole('button', { name: 'Show archived' });
      await archivedDisclosure.click();
      await expect(page.locator('.project-catalog-section-archived .project-catalog-card')).toHaveCount(1);
      await page.locator('.project-catalog-section-archived').scrollIntoViewIfNeeded();
      await page.screenshot({
        path: path.join(projectsRoot, `${viewport.name}-archive-expanded.png`),
        fullPage: true,
      });

      const orbitCard = page.locator('.project-catalog-card').filter({ hasText: 'Orbit Console' });
      await orbitCard.getByRole('button', { name: 'View details' }).click();
      await expect(page.getByRole('dialog', { name: 'Orbit Console' })).toBeVisible();
      await expectAnimationsSettled(page, '.project-reference-drawer');
      await expectNoAccidentalOverflow(page);
      await page.screenshot({
        path: path.join(projectsRoot, `${viewport.name}-details.png`),
        fullPage: true,
      });

      if (viewport.width >= 1_000) {
        await page.getByRole('button', { name: 'Manage project' }).click();
        await expect(page.getByRole('tab', { name: 'Board' })).toBeVisible();
        await page.screenshot({
          path: path.join(projectsRoot, `${viewport.name}-manage.png`),
          fullPage: true,
        });
      }
    }
  });

  test('@visual captures seamless offline continuity', async ({ context, page, scenario }) => {
    test.skip(
      Boolean(visualSurfaceFilter() && !['secrets', 'sync'].includes(visualSurfaceFilter())),
      'A different visual surface was requested.',
    );
    await scenario('empty', {
      surface: 'secrets',
      secrets: [{
        label: 'Sabah One production database password',
        kind: 'database',
        environment: 'production',
        projectCatalogKeys: ['catalog:helm'],
        value: 'visual-fixture-value',
        username: 'postgres',
      }],
    });
    const syncRoot = path.join(screenshotRoot, 'sync');
    mkdirSync(syncRoot, { recursive: true });

    for (const viewport of visualViewports()) {
      await page.setViewportSize(viewport);
      await page.goto('/');
      await expect(page.getByRole('heading', { name: 'Secrets', exact: true })).toBeVisible();
      await context.setOffline(true);
      await expect(page.getByTestId('sync-status-banner')).toContainText('Offline');
      await expect(page.getByRole('heading', { name: 'Sabah One is reconnecting' })).toHaveCount(0);
      await expectNoAccidentalOverflow(page);
      await page.screenshot({
        path: path.join(syncRoot, `${viewport.name}-offline-read-only.png`),
        fullPage: true,
      });
      await context.setOffline(false);
      await expect(page.getByTestId('sync-status-banner')).toHaveCount(0);
    }
  });
});

async function navigateToSurface(
  page: Page,
  surface: SurfaceName,
  isMobile: boolean,
): Promise<void> {
  if (!isMobile || mobilePrimarySurfaces.has(surface)) {
    await page.getByRole('button', { name: `Navigate to ${surface}` }).click();
    return;
  }

  await page.getByRole('button', { name: 'Open more navigation' }).click();
  await page.getByRole('button', { name: surface, exact: true }).click();
}

async function expectNoAccidentalOverflow(page: Page): Promise<void> {
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
        if (
          style.display === 'none'
          || style.visibility === 'hidden'
          || Number(style.opacity) === 0
        ) {
          return false;
        }
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

async function expectAnimationsSettled(page: Page, selector: string): Promise<void> {
  await expect.poll(() => page.locator(selector).evaluate(element => (
    element.getAnimations({ subtree: true }).every(animation => (
      animation.playState === 'finished' || animation.playState === 'idle'
    ))
  ))).toBe(true);
}

function calendarStorage(): Record<string, unknown> {
  const today = new Date();
  const morningStart = new Date(today);
  morningStart.setHours(10, 15, 0, 0);
  const morningEnd = new Date(today);
  morningEnd.setHours(11, 15, 0, 0);
  const afternoonStart = new Date(today);
  afternoonStart.setHours(13, 0, 0, 0);
  const afternoonEnd = new Date(today);
  afternoonEnd.setHours(13, 20, 0, 0);

  return {
    'helm:calendarAccounts': [{
      id: 'acc-mobile',
      name: 'Personal',
      email: 'alisa@example.com',
      provider: 'local',
      isPrimary: true,
      connected: true,
      mocked: false,
    }],
    'helm:calendarSources': [{
      id: 'src-mobile',
      accountId: 'acc-mobile',
      name: 'Personal',
      color: '#4285f4',
      visible: true,
    }],
    'helm:calendarEvents': [
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
    ],
  };
}

function visualViewports(): VisualViewport[] {
  const requested = (process.env.HELM_E2E_VISUAL_VIEWPORTS || '390x844,1440x900')
    .split(',')
    .map(value => value.trim())
    .filter(Boolean);
  return requested.map(value => {
    if (value in viewportCatalog) {
      return { name: value, ...viewportCatalog[value as ViewportName] };
    }
    const match = value.match(/^([1-9]\d{2,3})x([1-9]\d{2,3})$/u);
    if (!match) throw new Error(`Unknown Sabah One visual viewport: ${value}`);
    return {
      name: value,
      width: Number(match[1]),
      height: Number(match[2]),
    };
  });
}

function visualSurfaceFilter(): string {
  return (process.env.HELM_E2E_VISUAL_SURFACE || '').trim().toLowerCase();
}

function visualSurfaces(): SurfaceName[] {
  const filter = visualSurfaceFilter();
  if (!filter) return [...surfaces];
  const match = surfaces.find(surface => surface.toLowerCase() === filter);
  if (!match) {
    throw new Error(`Unknown Sabah One visual surface: ${filter}`);
  }
  return [match];
}

function slug(value: string): string {
  return value.toLowerCase().replace(/[^a-z0-9]+/g, '-');
}
