import { writeFile } from 'node:fs/promises';
import type { Page } from '@playwright/test';
import type { FinanceAccount } from '../src/types/domain';
import { FINANCE_REVIEW } from '../src/test/finance-review-fixture';
import { expect, openApp, test } from './support/helm-fixture';

const BANK: FinanceAccount = {
  id: 'example-manual-bank', name: 'Example manual account', type: 'current', balance: 500_000,
  currency: 'GBP', color: '#4f5bff', icon: '£', includeInNetWorth: true, sortOrder: 0,
  createdAt: FINANCE_REVIEW.createdAt, updatedAt: FINANCE_REVIEW.updatedAt,
};

async function assertNoOverflow(page: Page) {
  const dimensions = await page.evaluate(() => ({
    client: document.documentElement.clientWidth, scroll: document.documentElement.scrollWidth,
    containers: [...document.querySelectorAll('.main-content, .surface-body, .banking-review, .banking-card')]
      .filter(element => element.getClientRects().length > 0)
      .map(element => ({ name: element.className, client: element.clientWidth, scroll: element.scrollWidth })),
  }));
  expect(dimensions.scroll).toBe(dimensions.client);
  for (const container of dimensions.containers) expect(container.scroll, container.name).toBeLessThanOrEqual(container.client + 1);
  return dimensions;
}

test('shows the private banking budget, twelve month review and separate dated loan balances at responsive widths', async ({ page, scenario }, testInfo) => {
  await page.setViewportSize({ width: 1440, height: 900 });
  await page.emulateMedia({ reducedMotion: 'reduce' });
  await scenario({ now: FINANCE_REVIEW.updatedAt, stores: { financeReviews: [FINANCE_REVIEW], financeAccounts: [BANK] } });
  await openApp(page);
  await page.getByRole('button', { name: 'Navigate to Finance' }).click();
  await expect(page.getByRole('region', { name: 'Monthly available amount' })).toContainText('£1,750.00 / month');
  await expect(page.locator('.finance-net-worth')).toHaveText('£5,000.00');
  await expect(page.getByRole('button', { name: 'Stocks', exact: true })).toBeVisible();
  await expect(page.getByRole('button', { name: 'Options', exact: true })).toBeVisible();
  const evidence: unknown[] = [];

  for (const width of [320, 768, 1440]) {
    await page.setViewportSize({ width, height: 900 });
    await page.getByRole('button', { name: 'Overview', exact: true }).click();
    await expect(page.getByRole('region', { name: 'Monthly available amount' })).toContainText('Planned scenario');
    await expect(page.getByRole('region', { name: 'Monthly available amount' })).toContainText('£1,350.00 / month');
    const target = page.getByRole('region', { name: 'Target monthly budget calculation' });
    await expect(target).toContainText('Conditional target');
    await expect(target).toContainText('Available before discretionary spending£2,650.00');
    evidence.push({ view: 'overview', width, ...await assertNoOverflow(page) });
    await page.locator('.main-content').evaluate(element => element.scrollTo(0, 0));
    await page.screenshot({ path: testInfo.outputPath(`banking-overview-${width}.png`) });

    await page.getByRole('button', { name: 'Spending', exact: true }).click();
    const table = page.getByRole('table', { name: 'Monthly bank cash flow' });
    await expect(table.getByRole('row')).toHaveCount(13);
    await expect(page.getByRole('region', { name: 'High-value spending' })).toContainText('Illustrative cap: £500.00 / month');
    const categories = table.getByText('Categories', { exact: true }).first();
    await categories.focus();
    await categories.press('Enter');
    await expect(table.getByText('-£100.00', { exact: true }).first()).toBeVisible();
    evidence.push({ view: 'spending', width, ...await assertNoOverflow(page) });
    if (width === 320) {
      const scroller = page.locator('.main-content');
      await scroller.evaluate(element => { element.scrollTop = 0; });
      const anchor = page.getByRole('heading', { name: 'Spending review', exact: true });
      const before = await anchor.boundingBox();
      const size = await scroller.evaluate(element => ({ client: element.clientHeight, scroll: element.scrollHeight }));
      expect(size.scroll).toBeGreaterThan(size.client);
      await scroller.hover();
      await page.mouse.wheel(0, 450);
      await expect.poll(() => scroller.evaluate(element => element.scrollTop)).toBeGreaterThan(0);
      expect((await anchor.boundingBox())!.y).toBeLessThan(before!.y);
      await scroller.evaluate(element => { element.scrollTop = 0; });
      await scroller.focus();
      await page.keyboard.press('PageDown');
      await expect.poll(() => scroller.evaluate(element => element.scrollTop)).toBeGreaterThan(0);
      evidence.push({ view: 'vertical-scroll', ...size, keyboardOffset: await scroller.evaluate(element => element.scrollTop) });
      const tableScroller = page.getByRole('region', { name: 'Scrollable monthly cash flow' });
      await tableScroller.scrollIntoViewIfNeeded();
      await tableScroller.hover();
      await page.mouse.wheel(350, 0);
      await expect.poll(() => tableScroller.evaluate(element => element.scrollLeft)).toBeGreaterThan(0);
      evidence.push({ view: 'cashflow-table-scroll', ...await tableScroller.evaluate(element => ({ client: element.clientWidth, scroll: element.scrollWidth, offset: element.scrollLeft })) });
      await page.screenshot({ path: testInfo.outputPath('banking-cashflow-320.png') });
    }

    await page.getByRole('button', { name: 'Loans', exact: true }).click();
    const renovation = page.getByRole('article', { name: 'Example Renovation Lender loan' });
    await expect(renovation).toContainText('Reported balance£18,000.00');
    await expect(renovation).toContainText('Settlement quoteDated 20 Sept 2026£17,000.00');
    await expect(page.getByRole('article', { name: 'Example Shared Lender loan' })).toContainText('BalanceNot confirmed');
    await expect(page.getByRole('region', { name: 'Closed and repaid loans' })).toContainText('Repayments completed.');
    evidence.push({ view: 'loans', width, ...await assertNoOverflow(page) });
    await page.locator('.main-content').evaluate(element => element.scrollTo(0, 0));
    await page.screenshot({ path: testInfo.outputPath(`banking-loans-${width}.png`) });
  }
  await page.getByRole('button', { name: 'Overview', exact: true }).click();
  await expect(page.locator('.finance-net-worth')).toHaveText('£5,000.00');
  await page.setViewportSize({ width: 320, height: 900 });
  await page.locator('.banking-review').evaluate(section => {
    const elements = [section, ...section.querySelectorAll<HTMLElement>('*')];
    const sizes = elements.map(element => Number.parseFloat(getComputedStyle(element).fontSize));
    elements.forEach((element, index) => { (element as HTMLElement).style.fontSize = `${sizes[index] * 2}px`; });
  });
  evidence.push({ view: 'overview-200-percent-text', ...await assertNoOverflow(page) });
  const evidencePath = testInfo.outputPath('banking-layout-evidence.json');
  await writeFile(evidencePath, JSON.stringify(evidence, null, 2));
  await testInfo.attach('banking-layout-evidence', { path: evidencePath, contentType: 'application/json' });
});
