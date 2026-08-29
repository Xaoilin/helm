import { mkdir } from 'node:fs/promises';
import { resolve } from 'node:path';
import { createDefaultEmploymentTrackerState } from '../src/services/employmentTracker';
import { expect, openApp, test, waitForMutation } from './support/helm-fixture';

const NOW = '2026-08-29T11:00:00.000Z';

async function openEmployment(page: Parameters<typeof openApp>[0]) {
  await page.getByRole('button', { name: 'Navigate to Employment' }).click();
  await expect(page.getByRole('main', { name: 'employment surface' })).toBeVisible();
  await expect(page.getByRole('heading', { name: 'Keep every opportunity moving.' })).toBeVisible();
}

test('seeds, filters, adds, reloads, and removes Employment opportunities', async ({ page, scenario }) => {
  await page.setViewportSize({ width: 1440, height: 900 });
  await scenario({ now: NOW, settings: { appTimezone: 'Europe/London' } });
  await openApp(page);
  await openEmployment(page);

  await expect(page.locator('.employment-card')).toHaveCount(3);
  await expect(page.getByRole('heading', { name: 'Staff AI Engineer, 2nd Horizon, UK Remote' })).toBeVisible();
  await expect(page.getByText('The advert also mentions in-person onboarding. Confirm the onboarding expectation before progressing.')).toBeVisible();
  await expect(page.getByText(/Prayer, Learn, and Move remain Sabah One’s daily foundation\./)).toBeVisible();

  await page.getByPlaceholder('Search company, role, note, compensation…').fill('no match');
  await expect(page.getByRole('heading', { name: 'No opportunities match' })).toBeVisible();
  await page.getByRole('button', { name: 'Clear filters' }).click();

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
  await expect(page.getByRole('heading', { name: 'Remote Platform Engineer' })).toBeVisible();

  await page.reload();
  await expect(page.getByRole('heading', { name: 'Keep every opportunity moving.' })).toBeVisible();
  const addedCard = page.locator('.employment-card').filter({ hasText: 'Example Ltd' });
  await expect(addedCard).toBeVisible();
  await addedCard.getByRole('button', { name: 'Edit opportunity' }).click();
  await page.getByRole('button', { name: 'Remove record' }).click();
  const removeWrite = waitForMutation(page, 'employment');
  await page.getByRole('button', { name: 'Remove permanently' }).click();
  await removeWrite;
  await expect(page.getByRole('heading', { name: 'Remote Platform Engineer' })).toHaveCount(0);
});

test('keeps Employment keyboard-accessible and overflow-free at 390px', async ({ page, scenario }) => {
  await page.setViewportSize({ width: 390, height: 844 });
  await page.emulateMedia({ reducedMotion: 'reduce' });
  await scenario({
    now: NOW,
    settings: { appTimezone: 'Europe/London' },
    stores: { employment: createDefaultEmploymentTrackerState() },
  });
  await page.goto('/');
  await expect(page.getByRole('navigation', { name: 'Mobile navigation' })).toBeVisible();
  await expect(page.getByRole('main', { name: 'dashboard surface' })).toBeVisible();
  await page.getByRole('button', { name: 'Open more navigation' }).click();
  await page.getByRole('dialog', { name: 'More navigation' }).getByRole('button', { name: 'Employment' }).click();

  await expect(page.getByRole('heading', { name: 'Keep every opportunity moving.' })).toBeVisible();
  expect(await page.evaluate(() => document.documentElement.scrollWidth <= document.documentElement.clientWidth)).toBe(true);

  const trigger = page.getByRole('button', { name: '+ Add opportunity' });
  await trigger.focus();
  await expect(trigger).toBeFocused();
  await trigger.press('Enter');
  const company = page.getByRole('dialog', { name: 'Add opportunity' }).getByRole('textbox', { name: 'Company' });
  await expect(company).toBeFocused();
  await company.press('Escape');
  await expect(trigger).toBeFocused();

  const scroller = page.locator('.main-content');
  const before = await scroller.evaluate(element => element.scrollTop);
  const scrollRange = await scroller.evaluate(element => element.scrollHeight - element.clientHeight);
  expect(scrollRange).toBeGreaterThan(0);
  await scroller.focus();
  await scroller.press('PageDown');
  await expect.poll(() => scroller.evaluate(element => element.scrollTop)).toBeGreaterThan(before);
  expect(await page.evaluate(() => document.documentElement.scrollWidth <= document.documentElement.clientWidth)).toBe(true);
});

test('captures Employment rendered evidence @visual', async ({ page, scenario }, testInfo) => {
  await scenario({
    now: NOW,
    settings: { appTimezone: 'Europe/London' },
    stores: { employment: createDefaultEmploymentTrackerState() },
  });
  await openApp(page);
  await openEmployment(page);

  const requested = (process.env.HELM_E2E_VISUAL_VIEWPORTS || '390x844,1440x900')
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
    await expect(page.getByRole('heading', { name: 'Keep every opportunity moving.' })).toBeVisible();
    const path = process.env.HELM_CAPTURE_EMPLOYMENT_EVIDENCE === '1'
      ? resolve(evidenceDirectory, `employment-${viewport}.png`)
      : testInfo.outputPath(`employment-${viewport}.png`);
    await page.screenshot({ path });
  }
});
