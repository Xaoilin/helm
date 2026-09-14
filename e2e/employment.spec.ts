import { mkdir } from 'node:fs/promises';
import { resolve } from 'node:path';
import type { Page } from '@playwright/test';
import { createRepresentativeEmploymentState } from './support/employment-scenario';
import { expect, openApp, test, waitForMutation } from './support/helm-fixture';

const NOW = '2026-09-14T11:00:00.000Z';
const ACTIVE_APPLICATION_COUNT = 9;
const ALL_APPLICATION_COUNT = 11;

async function openEmployment(page: Page) {
  await page.getByRole('button', { name: 'Navigate to Employment' }).click();
  await expect(page.getByRole('main', { name: 'employment surface' })).toBeVisible();
  await expect(page.getByRole('heading', { name: 'Employment' })).toBeVisible();
}

async function assertNoPageOverflow(page: Page) {
  expect(await page.evaluate(() => ({
    clientWidth: document.documentElement.clientWidth,
    scrollWidth: document.documentElement.scrollWidth,
  }))).toEqual(expect.objectContaining({
    clientWidth: page.viewportSize()!.width,
    scrollWidth: page.viewportSize()!.width,
  }));
}

async function assertOverviewFitsViewport(page: Page) {
  await page.locator('.main-content').evaluate(element => element.scrollTo(0, 0));
  const table = page.getByRole('table', { name: 'Employment applications' });
  const box = await table.boundingBox();
  expect(box).not.toBeNull();
  expect(box!.x).toBeGreaterThanOrEqual(0);
  expect(box!.x + box!.width).toBeLessThanOrEqual(page.viewportSize()!.width + 1);
  expect(box!.y + box!.height).toBeLessThanOrEqual(page.viewportSize()!.height + 1);
}

async function assertOverviewControlsContained(page: Page) {
  const violations = await page.locator('tr.employment-application-row').evaluateAll(rows => rows.flatMap((row, index) => {
    const rowBox = row.getBoundingClientRect();
    const roleBox = row.querySelector('.employment-role-button')?.getBoundingClientRect();
    const controls = [...row.querySelectorAll('.employment-role-button, .employment-status, .employment-updated-summary')];
    const outside = controls
      .filter(control => {
        const box = control.getBoundingClientRect();
        return box.left < rowBox.left - 1 || box.right > rowBox.right + 1;
      })
      .map(control => `${index}:${control.className}`);
    const badgeBoxes = [...row.querySelectorAll('.employment-status, .employment-latest')]
      .map(element => element.getBoundingClientRect());
    if (roleBox && badgeBoxes.some(box => (
      Math.min(roleBox.right, box.right) > Math.max(roleBox.left, box.left)
      && Math.min(roleBox.bottom, box.bottom) > Math.max(roleBox.top, box.top)
    ))) outside.push(`${index}:role-marker-overlap`);
    return outside;
  }));
  expect(violations).toEqual([]);
}

test('groups the representative Employment pipeline and expands details inline', async ({ page, scenario }) => {
  await page.setViewportSize({ width: 1440, height: 900 });
  await scenario({
    now: NOW,
    settings: { appTimezone: 'Europe/London' },
    stores: { employment: createRepresentativeEmploymentState() },
  });
  await openApp(page);
  await openEmployment(page);

  const table = page.getByRole('table', { name: 'Employment applications' });
  await expect(table.locator('tbody.employment-company-group')).toHaveCount(6);
  await expect(table.locator('tr.employment-application-row')).toHaveCount(ACTIVE_APPLICATION_COUNT);
  await expect(page.getByRole('button', {
    name: 'Show details for MICRO1: Staff Platform Engineer — Cloud Evaluation Rubrics',
  })).toHaveCount(0);
  await expect(table.getByRole('columnheader', { name: 'Last updated' })).toBeVisible();
  await expect(table.getByTitle('Last recorded recruiting activity: 14 Sept 2026')).toHaveText('14 Sept 2026');
  await expect(table.getByTitle('No recorded recruiting activity date')).toHaveText('—');
  await expect(page.locator('.employment-inline-details')).toHaveCount(0);

  const mercorRole = 'Senior Backend Engineer — Distributed Payments Infrastructure';
  const mercor = page.getByRole('button', { name: new RegExp(`details for Mercor: ${mercorRole}$`, 'u') });
  const detailsId = await mercor.getAttribute('aria-controls');
  await mercor.focus();
  await mercor.press('Enter');
  await expect(mercor).toBeFocused();
  await expect(mercor).toHaveAttribute('aria-expanded', 'true');
  const details = page.locator(`#${detailsId}`);
  await expect(details.getByRole('heading', { name: 'Details & history' })).toBeVisible();
  await expect(details.getByRole('heading', { name: mercorRole })).toBeVisible();
  await expect(details.getByText('Compensation', { exact: true })).toBeVisible();
  await expect(details.getByRole('button', { name: 'Edit opportunity' })).toBeVisible();
  expect(await details.locator('xpath=ancestor::tr/preceding-sibling::tr[1]').getAttribute('class')).toContain('employment-application-row');

  await mercor.press('Enter');
  await expect(page.locator('.employment-inline-details')).toHaveCount(0);
  await expect(mercor).toHaveAttribute('aria-expanded', 'false');

  await page.getByRole('button', { name: 'All applications' }).click();
  await expect(table.locator('tr.employment-application-row')).toHaveCount(ALL_APPLICATION_COUNT);
  await expect(table.locator('tbody.employment-company-group')).toHaveCount(6);
  await expect(table.getByRole('button', { name: /^Show details for / })).toHaveCount(ALL_APPLICATION_COUNT);

  for (const viewport of [{ width: 1440, height: 900 }, { width: 1366, height: 768 }]) {
    await page.setViewportSize(viewport);
    await assertOverviewFitsViewport(page);
    await assertNoPageOverflow(page);
  }

  await page.getByRole('button', { name: 'Active applications' }).click();
  await expect(table.locator('tr.employment-application-row')).toHaveCount(ACTIVE_APPLICATION_COUNT);
});

test('adds, reloads, edits, and removes an Employment opportunity', async ({ page, scenario }) => {
  await page.setViewportSize({ width: 1440, height: 900 });
  await scenario({
    now: NOW,
    settings: { appTimezone: 'Europe/London' },
    stores: { employment: createRepresentativeEmploymentState() },
  });
  await openApp(page);
  await openEmployment(page);

  const addTrigger = page.getByRole('button', { name: '+ Add opportunity' });
  await addTrigger.click();
  const dialog = page.getByRole('dialog', { name: 'Add opportunity' });
  await expect(dialog.getByRole('textbox', { name: 'Company' })).toBeFocused();
  await dialog.getByRole('textbox', { name: 'Company' }).fill('Example Ltd');
  await dialog.getByRole('textbox', { name: 'Role', exact: true }).fill('Remote Platform Engineer');
  await dialog.getByLabel('Eligible region').selectOption('uk');
  await dialog.getByRole('textbox', { name: 'Fully remote evidence' }).fill('Advert confirms fully remote work in the UK.');
  await dialog.getByRole('textbox', { name: 'Next action', exact: true }).fill('Send application');
  const addWrite = waitForMutation(page, 'employment');
  await dialog.getByRole('button', { name: 'Save opportunity' }).click();
  await addWrite;

  const addedRole = page.getByRole('button', {
    name: 'Show details for Example Ltd: Remote Platform Engineer',
  });
  await expect(addedRole).toBeVisible();
  const addedDetailsId = await addedRole.getAttribute('aria-controls');
  await addedRole.click();
  await expect(page.locator(`#${addedDetailsId}`).getByRole('heading', { name: 'Remote Platform Engineer' })).toBeVisible();

  await page.reload();
  await expect(page.getByRole('heading', { name: 'Employment' })).toBeVisible();
  const reloadedRole = page.getByRole('button', { name: 'Show details for Example Ltd: Remote Platform Engineer' });
  const reloadedDetailsId = await reloadedRole.getAttribute('aria-controls');
  await reloadedRole.click();
  await page.locator(`#${reloadedDetailsId}`).getByRole('button', { name: 'Edit opportunity' }).click();
  await expect(page.getByRole('textbox', { name: 'Company' })).toBeFocused();
  await page.getByRole('button', { name: 'Remove record' }).click();
  const removeWrite = waitForMutation(page, 'employment');
  await page.getByRole('button', { name: 'Remove permanently' }).click();
  await removeWrite;
  await expect(page.getByRole('button', {
    name: 'Show details for Example Ltd: Remote Platform Engineer',
  })).toHaveCount(0);
});

test('keeps Employment keyboard-accessible, scrollable, and overflow-free at narrow widths', async ({ page, scenario }) => {
  await page.setViewportSize({ width: 390, height: 844 });
  await page.emulateMedia({ reducedMotion: 'reduce' });
  await scenario({
    now: NOW,
    settings: { appTimezone: 'Europe/London' },
    stores: { employment: createRepresentativeEmploymentState() },
  });
  await page.goto('/');
  await expect(page.getByRole('navigation', { name: 'Mobile navigation' })).toBeVisible();
  await page.getByRole('button', { name: 'Open more navigation' }).click();
  await page.getByRole('dialog', { name: 'More navigation' }).getByRole('button', { name: 'Employment' }).click();
  await expect(page.getByRole('heading', { name: 'Employment' })).toBeVisible();

  for (const viewport of [{ width: 390, height: 844 }, { width: 320, height: 700 }, { width: 768, height: 800 }]) {
    await page.setViewportSize(viewport);
    await assertNoPageOverflow(page);
    await assertOverviewControlsContained(page);
  }

  await page.setViewportSize({ width: 390, height: 844 });
  const role = page.getByRole('button', { name: /details for Mercor: Senior Backend Engineer — Distributed Payments Infrastructure$/u });
  const roleDetailsId = await role.getAttribute('aria-controls');
  await role.focus();
  await role.press('Enter');
  await expect(role).toBeFocused();
  await expect(role).toHaveAttribute('aria-expanded', 'true');
  await expect(page.locator(`#${roleDetailsId}`).getByRole('heading', { name: 'Details & history' })).toBeVisible();

  const addTrigger = page.getByRole('button', { name: '+ Add opportunity' });
  await addTrigger.focus();
  await addTrigger.press('Enter');
  const company = page.getByRole('dialog', { name: 'Add opportunity' }).getByRole('textbox', { name: 'Company' });
  await expect(company).toBeFocused();
  await company.press('Escape');
  await expect(addTrigger).toBeFocused();

  const scroller = page.locator('.main-content');
  const before = await scroller.evaluate(element => element.scrollTop);
  expect(await scroller.evaluate(element => element.scrollHeight - element.clientHeight)).toBeGreaterThan(0);
  await scroller.focus();
  await scroller.press('PageDown');
  await expect.poll(() => scroller.evaluate(element => element.scrollTop)).toBeGreaterThan(before);
  await assertNoPageOverflow(page);
});

test('captures Employment overview and mobile details evidence @visual', async ({ page, scenario }, testInfo) => {
  await scenario({
    now: NOW,
    settings: { appTimezone: 'Europe/London' },
    stores: { employment: createRepresentativeEmploymentState() },
  });
  await openApp(page);
  await openEmployment(page);
  await page.getByRole('button', { name: 'All applications' }).click();

  const requested = (process.env.HELM_E2E_VISUAL_VIEWPORTS || '320x700,390x844,768x800,1366x768,1440x900')
    .split(',')
    .map(value => value.trim())
    .filter(value => /^\d+x\d+$/u.test(value));
  const evidenceDirectory = resolve('docs/design/evidence');
  if (process.env.HELM_CAPTURE_EMPLOYMENT_EVIDENCE === '1') {
    await mkdir(evidenceDirectory, { recursive: true });
  }

  for (const viewport of requested) {
    const [width, height] = viewport.split('x').map(Number);
    await page.setViewportSize({ width, height });
    await expect(page.getByRole('table', { name: 'Employment applications' })).toBeVisible();
    await assertNoPageOverflow(page);
    const mobileRole = page.getByRole('button', { name: /details for Mercor: Senior Backend Engineer — Distributed Payments Infrastructure$/u });
    if (width <= 390) {
      await mobileRole.click();
      await expect(mobileRole).toHaveAttribute('aria-expanded', 'true');
    }
    const path = process.env.HELM_CAPTURE_EMPLOYMENT_EVIDENCE === '1'
      ? resolve(evidenceDirectory, `employment-${viewport}.png`)
      : testInfo.outputPath(`employment-${viewport}.png`);
    await page.screenshot({ path });
    if (width <= 390) await mobileRole.click();
  }
});
