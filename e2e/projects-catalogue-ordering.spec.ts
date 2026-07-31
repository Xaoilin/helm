import { type Locator, type Page } from '@playwright/test';
import { expect, test } from './support/helm-fixture';

const TIMESTAMP = '2026-07-29T12:00:00.000Z';

const seededProjects = [
  {
    id: 'project-northstar',
    catalogKey: 'fixture:northstar',
    name: 'Northstar',
    kind: 'web_app',
    summary: 'A pinned project reference.',
    status: 'active',
    tags: ['app'],
    isPinned: true,
    sortOrder: 0,
    links: [],
    setupSteps: [],
    runRecipes: [],
    createdAt: TIMESTAMP,
    updatedAt: TIMESTAMP,
  },
  {
    id: 'project-atlas',
    catalogKey: 'fixture:atlas',
    name: 'Atlas',
    kind: 'desktop_app',
    summary: 'A desktop project with durable setup and launch references.',
    status: 'active',
    tags: ['app', 'reference'],
    isPinned: true,
    sortOrder: 1,
    links: [{
      id: 'atlas-docs',
      kind: 'documentation',
      label: 'Atlas handbook',
      url: 'https://example.com/atlas/docs',
    }],
    setupSteps: [{
      id: 'atlas-install',
      title: 'Install dependencies',
      description: 'Install the locked dependency set.',
      displayCode: 'npm ci',
    }],
    runRecipes: [{
      id: 'atlas-dev',
      label: 'Development server',
      displayCommand: 'npm run dev',
      executable: 'npm',
      args: ['run', 'dev'],
      prerequisites: ['Node.js', 'npm'],
      mode: 'service',
    }],
    createdAt: TIMESTAMP,
    updatedAt: TIMESTAMP,
  },
  {
    id: 'project-local-lens',
    catalogKey: 'fixture:local-lens',
    name: 'Local Lens',
    kind: 'cli',
    summary: 'A local-only project.',
    status: 'active',
    tags: ['local'],
    isPinned: false,
    sortOrder: 0,
    links: [],
    setupSteps: [],
    runRecipes: [],
    createdAt: TIMESTAMP,
    updatedAt: TIMESTAMP,
  },
  {
    id: 'project-signal-lab',
    catalogKey: 'fixture:signal-lab',
    name: 'Signal Lab',
    kind: 'hardware',
    summary: 'A hardware reference project.',
    status: 'blocked',
    tags: ['hardware'],
    isPinned: false,
    sortOrder: 1,
    links: [],
    setupSteps: [],
    runRecipes: [],
    createdAt: TIMESTAMP,
    updatedAt: TIMESTAMP,
  },
  {
    id: 'project-vault-notes',
    catalogKey: 'fixture:vault-notes',
    name: 'Vault Notes',
    kind: 'research',
    summary: 'An archived reference.',
    status: 'archived',
    statusBeforeArchive: 'completed',
    tags: ['reference'],
    isPinned: false,
    sortOrder: 0,
    links: [],
    setupSteps: [],
    runRecipes: [],
    createdAt: TIMESTAMP,
    updatedAt: TIMESTAMP,
  },
] as const;

test.describe('Projects catalogue organisation', () => {
  test.beforeEach(async ({ scenario }) => {
    await scenario('projects', { projects: [...seededProjects] });
  });

  test('pins, keyboard-reorders, persists, archives, and restores projects', async ({ page }) => {
    await page.setViewportSize({ width: 1440, height: 900 });
    await openProjects(page);

    const pinned = section(page, 'Pinned');
    const projects = section(page, 'Projects');
    const archived = section(page, 'Archived');

    await expectSectionOrder(page, ['Pinned', 'Projects', 'Archived']);
    await expectCardOrder(pinned, ['Northstar', 'Atlas']);
    await expectCardOrder(projects, ['Local Lens', 'Signal Lab']);

    await expect(archived.getByRole('button', { name: 'Show archived' })).toHaveAttribute('aria-expanded', 'false');
    await expect(archived.getByText('Vault Notes')).toHaveCount(0);
    await archived.getByRole('button', { name: 'Show archived' }).click();
    await expectCardOrder(archived, ['Vault Notes']);
    await archived.getByRole('button', { name: 'Hide archived' }).click();
    await expect(archived.getByText('Vault Notes')).toHaveCount(0);

    await projects.getByRole('button', { name: 'Pin Signal Lab' }).click();
    await expectCardOrder(pinned, ['Northstar', 'Atlas', 'Signal Lab']);
    await expectCardOrder(projects, ['Local Lens']);
    await expect(pinned.getByRole('button', { name: 'Unpin Signal Lab' })).toBeFocused();

    const atlasHandle = pinned.getByRole('button', { name: 'Reorder Atlas' });
    const catalogueLiveRegion = page.locator('.project-sr-only[role="status"]');
    await atlasHandle.focus();
    await page.keyboard.press('Space');
    await page.keyboard.press('ArrowLeft');
    await page.keyboard.press('Escape');
    await expectCardOrder(pinned, ['Northstar', 'Atlas', 'Signal Lab']);
    await expect(atlasHandle).toBeFocused();
    await expect(catalogueLiveRegion).toHaveText('Reordering Atlas cancelled.');

    await atlasHandle.focus();
    await page.keyboard.press('Space');
    await page.keyboard.press('ArrowLeft');
    await page.keyboard.press('Space');
    await expectCardOrder(pinned, ['Atlas', 'Northstar', 'Signal Lab']);
    await expect(atlasHandle).toBeFocused();
    await expect(catalogueLiveRegion).toHaveText('Atlas moved to position 1 of 3 in Pinned.');

    await expect.poll(() => storedSectionOrder(page, 'pinned')).toEqual([
      'project-atlas',
      'project-northstar',
      'project-signal-lab',
    ]);

    await page.reload();
    await waitForProjects(page);
    await expectCardOrder(section(page, 'Pinned'), ['Atlas', 'Northstar', 'Signal Lab']);

    await mouseDrag(
      page,
      section(page, 'Pinned').getByRole('button', { name: 'Reorder Signal Lab' }),
      section(page, 'Pinned').getByRole('button', { name: 'Reorder Northstar' }),
    );
    await expectCardOrder(section(page, 'Pinned'), ['Atlas', 'Signal Lab', 'Northstar']);
    await expect.poll(() => storedSectionOrder(page, 'pinned')).toEqual([
      'project-atlas',
      'project-signal-lab',
      'project-northstar',
    ]);

    const atlasCard = projectCard(section(page, 'Pinned'), 'Atlas');
    await atlasCard.getByRole('button', { name: 'More actions for Atlas' }).click();
    await page.getByRole('menuitem', { name: 'Archive project' }).click();

    await expectCardOrder(section(page, 'Pinned'), ['Signal Lab', 'Northstar']);
    await expectCardOrder(section(page, 'Archived'), ['Vault Notes', 'Atlas']);
    await expect(section(page, 'Archived').getByRole('button', { name: 'Unarchive Atlas' })).toBeVisible();

    const storedArchived = await storedProject(page, 'project-atlas');
    expect(storedArchived).toMatchObject({
      status: 'archived',
      statusBeforeArchive: 'active',
      isPinned: false,
      links: seededProjects[1].links,
      setupSteps: seededProjects[1].setupSteps,
      runRecipes: seededProjects[1].runRecipes,
    });

    await section(page, 'Archived').getByRole('button', { name: 'Unarchive Atlas' }).click();
    await expectCardOrder(section(page, 'Projects'), ['Local Lens', 'Atlas']);

    const restoredAtlas = await storedProject(page, 'project-atlas');
    expect(restoredAtlas).toMatchObject({
      status: 'active',
      isPinned: false,
      links: seededProjects[1].links,
      setupSteps: seededProjects[1].setupSteps,
      runRecipes: seededProjects[1].runRecipes,
    });
    expect(restoredAtlas).not.toHaveProperty('statusBeforeArchive');

    await projectCard(section(page, 'Projects'), 'Atlas').getByRole('button', { name: 'View details' }).click();
    const atlasDialog = page.getByRole('dialog', { name: 'Atlas' });
    await expect(atlasDialog).toBeVisible();
    await expect(atlasDialog.getByText('Atlas handbook')).toBeVisible();
    await expect(atlasDialog.getByText('Install dependencies')).toBeVisible();
    await expect(atlasDialog.getByText('npm ci')).toBeVisible();
    await expect(atlasDialog.getByText('npm run dev')).toBeVisible();
  });
});

test.describe('Projects catalogue at 390px', () => {
  test.use({
    viewport: { width: 390, height: 844 },
    hasTouch: true,
  });

  test.beforeEach(async ({ scenario }) => {
    await scenario('projects', { projects: [...seededProjects] });
  });

  test('keeps touch actions reachable without accidental horizontal overflow', async ({ page }) => {
    await openProjects(page, true);

    await expectSectionOrder(page, ['Pinned', 'Projects', 'Archived']);
    await expectNoHorizontalOverflow(page);

    const signalPin = section(page, 'Projects').getByRole('button', { name: 'Pin Signal Lab' });
    const reorderHandle = section(page, 'Projects').getByRole('button', { name: 'Reorder Signal Lab' });
    const pinBox = await signalPin.boundingBox();
    const handleBox = await reorderHandle.boundingBox();
    expect(pinBox?.height).toBeGreaterThanOrEqual(44);
    expect(handleBox?.width).toBeGreaterThanOrEqual(44);
    expect(handleBox?.height).toBeGreaterThanOrEqual(44);

    await touchDrag(
      page,
      reorderHandle,
      section(page, 'Projects').getByRole('button', { name: 'Reorder Local Lens' }),
    );
    await expect(page.locator('.project-sr-only[role="status"]'))
      .toHaveText('Signal Lab moved to position 1 of 2 in Projects.');
    await expectCardOrder(section(page, 'Projects'), ['Signal Lab', 'Local Lens']);
    await expect.poll(() => storedSectionOrder(page, 'projects')).toEqual([
      'project-signal-lab',
      'project-local-lens',
    ]);

    await signalPin.tap();
    await expect(section(page, 'Pinned').getByRole('button', { name: 'Unpin Signal Lab' })).toBeVisible();

    await section(page, 'Pinned').getByRole('button', { name: 'More actions for Signal Lab' }).tap();
    await page.getByRole('menuitem', { name: 'Archive project' }).tap();
    await expect(section(page, 'Archived').getByRole('button', { name: 'Unarchive Signal Lab' })).toBeVisible();
    await expectNoHorizontalOverflow(page);
  });
});

function section(page: Page, name: 'Pinned' | 'Projects' | 'Archived'): Locator {
  return page.getByRole('region', { name, exact: true });
}

function projectCard(region: Locator, name: string): Locator {
  return region.locator('[data-project-card-id]').filter({ hasText: name });
}

async function openProjects(page: Page, mobile = false): Promise<void> {
  await page.goto('/');
  await page.waitForSelector('.app-layout');

  if (mobile) {
    await page.getByRole('button', { name: 'Open more navigation' }).click();
    await page.getByRole('button', { name: 'Projects', exact: true }).click();
  } else {
    await page.getByRole('button', { name: 'Navigate to Projects' }).click();
  }

  await waitForProjects(page);
}

async function waitForProjects(page: Page): Promise<void> {
  await expect(page.locator('main[aria-label="projects surface"]')).toBeVisible();
  await expect(section(page, 'Projects')).toBeVisible();
}

async function expectCardOrder(region: Locator, expectedNames: string[]): Promise<void> {
  await expect.poll(async () => region.locator('[data-project-card-id] h3').allTextContents())
    .toEqual(expectedNames);
}

async function expectSectionOrder(
  page: Page,
  expectedNames: Array<'Pinned' | 'Projects' | 'Archived'>,
): Promise<void> {
  await expect.poll(async () => page.locator('.project-catalog-section').evaluateAll(elements => (
    elements.map(element => element.querySelector('h2')?.textContent?.trim() || '')
  ))).toEqual(expectedNames);
}

async function storedProject(page: Page, projectId: string): Promise<Record<string, unknown>> {
  const rows = await databaseRows(page);
  return rows.find(row => (
    row.collection === 'projects'
    && row.record_id === projectId
    && row.deleted_at === null
  ))?.payload || {};
}

async function storedSectionOrder(
  page: Page,
  targetSection: 'pinned' | 'projects' | 'archived',
): Promise<string[]> {
  const rows = await databaseRows(page);
  return rows
    .filter(row => row.collection === 'projects' && row.deleted_at === null)
    .filter(row => {
      if (targetSection === 'archived') return row.payload.status === 'archived';
      if (row.payload.status === 'archived') return false;
      return targetSection === 'pinned'
        ? row.payload.isPinned === true
        : row.payload.isPinned !== true;
    })
    .sort((left, right) => (
      (left.position ?? Number.MAX_SAFE_INTEGER) - (right.position ?? Number.MAX_SAFE_INTEGER)
      || left.record_id.localeCompare(right.record_id)
    ))
    .map(row => row.record_id);
}

interface DatabaseRow {
  collection: string;
  deleted_at: string | null;
  payload: Record<string, unknown>;
  position: number | null;
  record_id: string;
}

async function databaseRows(page: Page): Promise<DatabaseRow[]> {
  return page.evaluate(async () => {
    const response = await fetch('/__helm_e2e_db');
    if (!response.ok) throw new Error('Could not read the HELM database fixture.');
    return response.json() as Promise<DatabaseRow[]>;
  });
}

async function expectNoHorizontalOverflow(page: Page): Promise<void> {
  await expect.poll(() => page.evaluate(() => ({
    clientWidth: document.documentElement.clientWidth,
    scrollWidth: document.documentElement.scrollWidth,
  }))).toEqual({ clientWidth: 390, scrollWidth: 390 });
}

async function touchDrag(page: Page, source: Locator, target: Locator): Promise<void> {
  await source.scrollIntoViewIfNeeded();
  await expect(source).toBeInViewport();
  await expect(target).toBeInViewport();
  const sourceBox = await source.boundingBox();
  const targetBox = await target.boundingBox();
  expect(sourceBox).not.toBeNull();
  expect(targetBox).not.toBeNull();
  if (!sourceBox || !targetBox) return;

  const session = await page.context().newCDPSession(page);
  const start = {
    x: sourceBox.x + sourceBox.width / 2,
    y: sourceBox.y + sourceBox.height / 2,
  };
  const end = {
    x: targetBox.x + targetBox.width / 2,
    y: targetBox.y + targetBox.height / 2,
  };
  const touchPoint = (x: number, y: number) => ({
    x,
    y,
    id: 1,
    radiusX: 2,
    radiusY: 2,
    force: 1,
  });

  try {
    await session.send('Input.dispatchTouchEvent', {
      type: 'touchStart',
      touchPoints: [touchPoint(start.x, start.y)],
    });
    await page.waitForTimeout(300);

    const steps = 14;
    for (let step = 1; step <= steps; step += 1) {
      const progress = step / steps;
      await session.send('Input.dispatchTouchEvent', {
        type: 'touchMove',
        touchPoints: [touchPoint(
          start.x + (end.x - start.x) * progress,
          start.y + (end.y - start.y) * progress,
        )],
      });
      await page.waitForTimeout(20);
    }

    await session.send('Input.dispatchTouchEvent', {
      type: 'touchEnd',
      touchPoints: [],
    });
  } finally {
    await session.detach();
  }
}

async function mouseDrag(page: Page, source: Locator, target: Locator): Promise<void> {
  await source.scrollIntoViewIfNeeded();
  await expect(source).toBeInViewport();
  await expect(target).toBeInViewport();
  const sourceBox = await source.boundingBox();
  const targetBox = await target.boundingBox();
  expect(sourceBox).not.toBeNull();
  expect(targetBox).not.toBeNull();
  if (!sourceBox || !targetBox) return;

  await page.mouse.move(
    sourceBox.x + sourceBox.width / 2,
    sourceBox.y + sourceBox.height / 2,
  );
  await page.mouse.down();
  await page.mouse.move(
    targetBox.x + targetBox.width / 2,
    targetBox.y + targetBox.height / 2,
    { steps: 14 },
  );
  await page.mouse.up();
}
