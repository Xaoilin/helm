import { writeFile } from 'node:fs/promises';
import type { Locator, Page } from '@playwright/test';
import type { EquityPosition, FinanceAccount } from '../src/types/domain';
import { expect, openApp, test, waitForMutation } from './support/helm-fixture';

const NOW = '2026-09-21T12:00:00.000Z';
const POSITION: EquityPosition = {
  id: 'example-equity', company: 'Example Co', asOf: '2026-09-21', ownedShares: 120,
  stockPlan: {
    summary: 'Hold owned shares while deciding the long-term plan.', status: 'tentative',
    waitingFor: 'A separate decision about owned shares.', nextAction: 'Review the share plan.',
  },
  optionPlan: {
    summary: 'Hold options for an attractive eligible tender with cashless exercise-and-sale.', status: 'agreed',
    waitingFor: 'An eligible company tender; none is currently open.',
    nextAction: 'Confirm grant-specific exercise deadlines when leaving.', reviewMonth: '2027-09',
  },
  employmentNote: 'Departure has not been confirmed.',
  grants: [
    {
      id: 'EXAMPLE-A', grantDate: '2024-01-01', vested: 10, unvested: 25, strikeUsd: 10,
      originalExpiry: '2034-01-01', postEmploymentExpiry: '2028-06-30',
      nextVest: { date: '2026-11-15', alternateDate: '2026-11-14', quantity: 5, condition: 'If employment and grant terms allow.' },
    },
    { id: 'EXAMPLE-B', grantDate: '2025-01-01', vested: 5, unvested: 20, strikeUsd: 100, originalExpiry: '2035-01-01' },
  ],
  actions: [{ id: 'review', title: 'Reassess the options plan', timing: 'Act sooner if an eligible tender opens.', dueDate: '2027-09-01', done: false }],
  details: [{ id: 'tenders', title: 'Tender policy', body: 'Eligibility and sale limits must be confirmed for each tender.' }],
  sources: [{ id: 'example-source', label: 'Example holding statement', url: 'https://example.test/equity', asOf: '2026-09-21' }],
  scenario: { pricesUsd: [50, 150], withholdingRate: 0.5, usdToGbp: 0.8, asOf: '2026-09-21', notes: 'Synthetic illustrative assumptions, before fees.' },
  createdAt: NOW, updatedAt: NOW,
};
const BANK: FinanceAccount = {
  id: 'example-bank', name: 'Example bank account', type: 'current', balance: 500_000,
  currency: 'GBP', color: '#4f5bff', icon: '£', includeInNetWorth: true,
  sortOrder: 0, createdAt: NOW, updatedAt: NOW,
};

async function openFinance(page: Page) {
  await page.getByRole('button', { name: 'Navigate to Finance' }).click();
  await expect(page.getByRole('main', { name: 'finance surface' })).toBeVisible();
  await expect(page.getByRole('heading', { name: 'Example Co', exact: true })).toBeVisible();
}

async function assertNoOverflow(page: Page) {
  const dimensions = await page.evaluate(() => ({
    clientWidth: document.documentElement.clientWidth,
    scrollWidth: document.documentElement.scrollWidth,
    containers: [...document.querySelectorAll('.main-content, .surface-body, .equity-position, .equity-editor')]
      .filter(element => element.getClientRects().length > 0)
      .map(element => ({ className: element.className, clientWidth: element.clientWidth, scrollWidth: element.scrollWidth })),
  }));
  expect(dimensions.scrollWidth).toBe(dimensions.clientWidth);
  for (const container of dimensions.containers) {
    expect(container.scrollWidth, container.className).toBeLessThanOrEqual(container.clientWidth + 1);
  }
}

async function proveScroll(page: Page, scroller: Locator, anchor: Locator) {
  const size = await scroller.evaluate(element => ({ client: element.clientHeight, scroll: element.scrollHeight }));
  expect(size.scroll).toBeGreaterThan(size.client);
  await scroller.evaluate(element => { element.scrollTop = 0; });
  const before = await anchor.boundingBox();
  await scroller.hover();
  await page.mouse.wheel(0, 400);
  await expect.poll(() => scroller.evaluate(element => element.scrollTop)).toBeGreaterThan(0);
  const after = await anchor.boundingBox();
  expect(after!.y).toBeLessThan(before!.y);
  await scroller.evaluate(element => { element.scrollTop = 0; });
  await scroller.focus();
  await page.keyboard.press('PageDown');
  await expect.poll(() => scroller.evaluate(element => element.scrollTop)).toBeGreaterThan(0);
  return { ...size, beforeY: before!.y, afterY: after!.y, keyboardScrollTop: await scroller.evaluate(element => element.scrollTop) };
}

test('separates stocks, options, illustrative proceeds and existing cash balances', async ({ page, scenario }) => {
  await page.setViewportSize({ width: 1440, height: 900 });
  await scenario({ now: NOW, stores: { equityPositions: [POSITION], financeAccounts: [BANK] } });
  await openApp(page);
  await openFinance(page);

  const stocks = page.getByRole('region', { name: 'Example Co Stocks' });
  const options = page.getByRole('region', { name: 'Example Co Options' });
  await expect(stocks).toContainText('120 owned shares');
  await expect(stocks).toContainText('Tentative plan');
  await expect(options).toContainText('15 vested, unexercised');
  await expect(options).toContainText('45 unvested');
  await expect(options).toContainText('US$600.00 strike cost');
  await expect(options).toContainText(POSITION.optionPlan.summary);
  await expect(options).toContainText(POSITION.optionPlan.waitingFor);
  await expect(options).toContainText('Review Sept 2027');
  await expect(page.getByText('As of 21 Sept 2026', { exact: true })).toBeVisible();
  await expect(page.locator('.surface-header .subtitle')).toHaveText('Net worth: £5,000.00');
  await expect(page.locator('.finance-net-worth')).toHaveText('£5,000.00');
  await expect(page.getByText('Example bank account', { exact: false })).toBeVisible();
  await expect(page.getByRole('table', { name: 'Example Co option grants' })).not.toBeVisible();

  await page.getByRole('button', { name: 'Options', exact: true }).click();
  await expect(stocks).toHaveCount(0);
  await page.getByText('Grants, vesting & expiry', { exact: true }).click();
  const grants = page.getByRole('table', { name: 'Example Co option grants' });
  await expect(grants.getByRole('columnheader', { name: 'Original expiry', exact: true })).toBeVisible();
  await expect(grants.getByRole('columnheader', { name: 'Post-employment expiry', exact: true })).toBeVisible();
  const firstGrant = grants.getByRole('row').filter({ hasText: 'EXAMPLE-A' });
  await expect(firstGrant).toContainText('1 Jan 2034');
  await expect(firstGrant).toContainText('30 Jun 2028');
  await expect(grants.getByRole('row').filter({ hasText: 'EXAMPLE-B' })).toContainText('Not confirmed');
  await expect(page.getByText(/begin resolving by 30 Dec 2027/)).toBeVisible();
  await expect(page.getByText(/Alternate display: 14 Nov 2026; confirm the date/)).toBeVisible();
  await expect(options).toContainText('15 vested, unexercised');

  await page.getByText('Illustrative option proceeds', { exact: true }).click();
  const scenarios = page.getByRole('table', { name: 'Example Co option scenarios' });
  await expect(scenarios.locator('tbody tr').nth(0).getByRole('cell')).toHaveText(['US$50.00', '10', '£160']);
  await expect(scenarios.locator('tbody tr').nth(1).getByRole('cell')).toHaveText(['US$150.00', '15', '£660']);
  await expect(page.getByText(/Excludes owned shares and fees; these amounts are not cash balances/)).toBeVisible();
  await expect(page.locator('.surface-header .subtitle')).toHaveText('Net worth: £5,000.00');
  await page.getByRole('button', { name: /^Accounts/ }).click();
  await expect(page.getByText('Example bank account', { exact: false })).toBeVisible();
});

test('saves owned shares and an options plan through the semantic account API and reload', async ({ page, scenario }) => {
  await page.setViewportSize({ width: 1440, height: 900 });
  await scenario({ now: NOW, stores: { equityPositions: [POSITION], financeAccounts: [BANK] } });
  await openApp(page);
  await openFinance(page);
  await page.getByRole('button', { name: 'Edit Example Co' }).click();
  const dialog = page.getByRole('dialog', { name: 'Edit equity' });
  await dialog.getByLabel('Already-owned shares').fill('135');
  await dialog.getByText('Options plan', { exact: true }).click();
  const plan = 'Hold for an eligible tender and reassess after reviewing the grant terms.';
  await dialog.getByRole('textbox', { name: 'Current plan', exact: true }).filter({ visible: true }).fill(plan);
  const write = waitForMutation(page, 'equityPositions');
  await dialog.getByRole('button', { name: 'Save equity' }).click();
  const response = await write;
  expect(response.url()).toContain('/rpc/equity_update_position');
  expect(response.ok()).toBe(true);
  await expect(dialog).toHaveCount(0);
  await expect(page.getByRole('region', { name: 'Example Co Stocks' })).toContainText('135 owned shares');
  await page.reload();
  await expect(page.getByRole('heading', { name: 'Finance', exact: true })).toBeVisible();
  await expect(page.getByRole('region', { name: 'Example Co Stocks' })).toContainText('135 owned shares');
  await expect(page.getByRole('region', { name: 'Example Co Options' })).toContainText(plan);
  await expect(page.locator('.finance-net-worth')).toHaveText('£5,000.00');
});

test('keeps equity overview, grant details and editor contained at mobile, tablet and wide widths', async ({ page, scenario }, testInfo) => {
  await page.setViewportSize({ width: 1440, height: 900 });
  await page.emulateMedia({ reducedMotion: 'reduce' });
  await scenario({ now: NOW, stores: { equityPositions: [POSITION], financeAccounts: [BANK] } });
  await openApp(page);
  await openFinance(page);
  const scrollEvidence = [];
  for (const viewport of [{ width: 320, height: 700 }, { width: 768, height: 800 }, { width: 1440, height: 900 }]) {
    await page.setViewportSize(viewport);
    await page.getByRole('button', { name: 'Overview', exact: true }).click();
    await assertNoOverflow(page);
    await page.locator('.main-content').evaluate(element => element.scrollTo(0, 0));
    await page.screenshot({ path: testInfo.outputPath(`equity-overview-${viewport.width}.png`) });
    await page.getByRole('button', { name: 'Options', exact: true }).click();
    await page.getByText('Grants, vesting & expiry', { exact: true }).click();
    await expect(page.getByRole('table', { name: 'Example Co option grants' })).toBeVisible();
    await assertNoOverflow(page);
    if (viewport.width === 320) {
      scrollEvidence.push({ surface: 'options', ...await proveScroll(page, page.locator('.main-content'), page.getByRole('heading', { name: 'Example Co', exact: true })) });
      const tableScroller = page.getByRole('table', { name: 'Example Co option grants' }).locator('..');
      await tableScroller.hover();
      await page.mouse.wheel(400, 0);
      await expect.poll(() => tableScroller.evaluate(element => element.scrollLeft)).toBeGreaterThan(0);
      scrollEvidence.push({ surface: 'grant-table', ...await tableScroller.evaluate(element => ({ client: element.clientWidth, scroll: element.scrollWidth, scrollLeft: element.scrollLeft })) });
      await page.screenshot({ path: testInfo.outputPath('equity-grants-320.png') });
    }
    const opener = page.getByRole('button', { name: 'Edit Example Co' });
    await opener.click();
    const dialog = page.getByRole('dialog', { name: 'Edit equity' });
    await expect(dialog).toBeVisible();
    const company = dialog.getByLabel('Company', { exact: true });
    await expect(company).toBeFocused();
    await dialog.getByText('Employment and option grants (2)', { exact: true }).click();
    await assertNoOverflow(page);
    if (viewport.width === 320) {
      scrollEvidence.push({ surface: 'editor', ...await proveScroll(page, dialog, company) });
      const save = dialog.getByRole('button', { name: 'Save equity', exact: true });
      await save.focus();
      await expect(save).toBeInViewport();
      await save.press('Tab');
      await expect(company).toBeFocused();
      await expect(company).toBeInViewport();
      await page.screenshot({ path: testInfo.outputPath('equity-editor-320.png') });
      await company.fill('Example Co draft');
      const cancelled = page.waitForEvent('dialog').then(async prompt => {
        expect(prompt.message()).toContain('Discard unsaved changes');
        await prompt.dismiss();
      });
      await company.press('Escape');
      await cancelled;
      await expect(company).toHaveValue('Example Co draft');
      page.once('dialog', prompt => { void prompt.accept(); });
      await company.press('Escape');
    } else await dialog.getByRole('button', { name: 'Cancel', exact: true }).click();
    await expect(dialog).toHaveCount(0);
    await expect(opener).toBeFocused();
  }
  const scrollPath = testInfo.outputPath('equity-scroll-evidence.json');
  await writeFile(scrollPath, JSON.stringify(scrollEvidence, null, 2));
  await testInfo.attach('equity-scroll-evidence', { path: scrollPath, contentType: 'application/json' });
  await page.getByRole('button', { name: 'Overview', exact: true }).click();
  await page.locator('.equity-section').evaluate(section => {
    const elements = [section, ...section.querySelectorAll<HTMLElement>('*')];
    const sizes = elements.map(element => Number.parseFloat(getComputedStyle(element).fontSize));
    elements.forEach((element, index) => { (element as HTMLElement).style.fontSize = `${sizes[index] * 2}px`; });
  });
  await assertNoOverflow(page);
  await page.screenshot({ path: testInfo.outputPath('equity-overview-200pct-text.png') });
});
