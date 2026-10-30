import { writeFile } from 'node:fs/promises';
import type { Page } from '@playwright/test';
import type { FinanceAccount } from '../src/types/domain';
import { FINANCE_REVIEW } from '../src/test/finance-review-fixture';
import { OVERPAYMENT_REVIEW } from '../src/test/loan-overpayment-fixture';
import { expect, openApp, test, waitForMutation } from './support/helm-fixture';

const BANK: FinanceAccount = {
  id: 'example-manual-bank', name: 'Example manual account', type: 'current', balance: 500_000,
  currency: 'GBP', color: '#4f5bff', icon: '£', includeInNetWorth: true, sortOrder: 0,
  createdAt: FINANCE_REVIEW.createdAt, updatedAt: FINANCE_REVIEW.updatedAt,
};

test('compares Selina and NatWest overpayments, shares and monthly schedules without saving scenarios', async ({ page, scenario }, testInfo) => {
  await page.setViewportSize({ width: 1440, height: 900 });
  await page.emulateMedia({ reducedMotion: 'reduce' });
  const control = await scenario({ now: OVERPAYMENT_REVIEW.updatedAt, stores: { financeReviews: [OVERPAYMENT_REVIEW] } });
  const savedReview = structuredClone(control.services.finance.review);
  await openApp(page);
  await page.getByRole('button', { name: 'Navigate to Finance' }).click();
  await page.getByRole('button', { name: 'Loans', exact: true }).click();
  const calculator = page.getByRole('region', { name: 'Loan overpayment calculator' });
  const totals = calculator.getByLabel('Selected loan totals');
  await expect(totals).toContainText('£30,000.00');
  const selina = calculator.getByRole('article', { name: 'Selina (example) overpayment calculator' });
  await selina.getByLabel('Extra payment (£/month)', { exact: true }).fill('100');
  await selina.getByRole('checkbox').check();
  await expect(totals).toContainText('£650.00 / month');
  await calculator.getByLabel('Show amounts as').selectOption('share');
  await expect(totals).toContainText('£15,000.00');
  await expect(totals).toContainText('£325.00 / month');
  await calculator.getByLabel('Loans', { exact: true }).selectOption('example-natwest');
  await expect(totals).toContainText('£10,000.00');
  await calculator.getByLabel('Loans', { exact: true }).selectOption('both');
  await calculator.getByLabel('Show amounts as').selectOption('joint');
  await calculator.getByLabel('First projected payment').fill('2026-10');
  await selina.getByLabel('Overpayment effect').selectOption('reduce-payment');
  await expect(selina.getByLabel('Selina (example) results')).toContainText('Month two regular payment');
  await selina.getByLabel('Overpayment effect').selectOption('shorten-term');
  const evidence: unknown[] = [];
  for (const width of [320, 768, 1440]) {
    await page.setViewportSize({ width, height: 900 });
    evidence.push({ view: 'calculator', width, ...await assertNoOverflow(page) });
    await calculator.getByRole('heading', { name: 'Loan overpayment calculator', exact: true }).scrollIntoViewIfNeeded();
    await page.screenshot({ path: testInfo.outputPath(`loan-calculator-${width}.png`) });
    await selina.getByLabel('Selina (example) results').scrollIntoViewIfNeeded();
    await page.screenshot({ path: testInfo.outputPath(`loan-results-${width}.png`) });
  }
  await page.setViewportSize({ width: 320, height: 900 });
  const summary = selina.getByText('Monthly interest, repayments & balances', { exact: true });
  await summary.focus();
  await summary.press('Enter');
  const schedule = selina.getByRole('region', { name: 'Selina (example) monthly schedule' });
  await expect(schedule.getByRole('row')).toHaveCount(13);
  await expect(schedule).toContainText('Oct 2026');
  await selina.getByLabel('Schedule year').selectOption('2');
  await expect(schedule).toContainText('Oct 2027');
  await schedule.scrollIntoViewIfNeeded();
  await schedule.focus();
  await page.keyboard.press('ArrowRight');
  await expect.poll(() => schedule.evaluate(element => element.scrollLeft)).toBeGreaterThan(0);
  await schedule.evaluate(element => { element.scrollLeft = 0; });
  await schedule.hover();
  await page.mouse.wheel(400, 0);
  await expect.poll(() => schedule.evaluate(element => element.scrollLeft)).toBeGreaterThan(0);
  evidence.push({ view: 'schedule-scroll', ...await schedule.evaluate(element => ({ client: element.clientWidth, scroll: element.scrollWidth, offset: element.scrollLeft })) });
  await page.screenshot({ path: testInfo.outputPath('loan-monthly-schedule-320.png') });
  await summary.press('Enter');
  const scroller = page.locator('.main-content');
  await scroller.evaluate(element => { element.scrollTop = 0; });
  await scroller.focus();
  await page.keyboard.press('PageDown');
  await expect.poll(() => scroller.evaluate(element => element.scrollTop)).toBeGreaterThan(0);
  await scroller.evaluate(element => { element.scrollTop = 0; });
  await scroller.hover();
  await page.mouse.wheel(0, 450);
  await expect.poll(() => scroller.evaluate(element => element.scrollTop)).toBeGreaterThan(0);
  await calculator.evaluate(section => {
    const elements = [section, ...section.querySelectorAll<HTMLElement>('*')];
    const sizes = elements.map(element => Number.parseFloat(getComputedStyle(element).fontSize));
    elements.forEach((element, index) => { (element as HTMLElement).style.fontSize = `${sizes[index] * 2}px`; });
  });
  evidence.push({ view: 'calculator-200-percent-text', ...await assertNoOverflow(page) });
  await calculator.scrollIntoViewIfNeeded();
  await page.screenshot({ path: testInfo.outputPath('loan-calculator-text-200.png') });
  expect(control.services.finance.review).toEqual(savedReview);
  await page.setViewportSize({ width: 1440, height: 900 });
  await page.reload();
  await page.getByRole('button', { name: 'Navigate to Finance' }).click();
  await page.getByRole('button', { name: 'Loans', exact: true }).click();
  await expect(page.getByRole('article', { name: 'Selina (example) overpayment calculator' }).getByLabel('Extra payment (£/month)', { exact: true })).toHaveValue('0');
  await writeFile(testInfo.outputPath('loan-calculator-evidence.json'), JSON.stringify(evidence, null, 2));
});

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
    await expect(page.getByRole('region', { name: 'Monthly spending explorer' })).toContainText('September 2026 has not been imported yet.');
    await page.getByRole('button', { name: 'Last month', exact: true }).click();
    await expect(page.getByRole('region', { name: 'Spending by category' })).toContainText('Retail purchases');
    await page.getByRole('searchbox', { name: 'Find a category' }).fill('refund');
    await expect(page.getByRole('region', { name: 'Spending by category' })).toContainText('-£100.00');
    await page.getByRole('searchbox', { name: 'Find a category' }).fill('');
    await page.locator('.main-content').evaluate(element => element.scrollTo(0, 0));
    await page.screenshot({ path: testInfo.outputPath(`monthly-spending-${width}.png`) });
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

test('logs a manual expense and shows the balance the finance service works out, through reload', async ({ page, scenario }) => {
  await page.setViewportSize({ width: 1440, height: 900 });
  const control = await scenario({ now: FINANCE_REVIEW.updatedAt, stores: { financeAccounts: [BANK] } });
  await openApp(page);
  await page.getByRole('button', { name: 'Navigate to Finance' }).click();
  await expect(page.locator('.finance-net-worth')).toHaveText('£5,000.00');
  await page.getByRole('button', { name: /^Transactions/ }).click();
  const write = waitForMutation(page, 'transactions');
  await page.locator('.finance-amount-input').fill('12.34');
  await page.locator('.finance-amount-input').press('Enter');
  const response = await write;
  expect(response.request().method()).toBe('PUT');
  const sent = response.request().postDataJSON() as Record<string, unknown>;
  expect(sent).toMatchObject({ type: 'expense', amount: 1234, accountId: BANK.id });
  expect(sent).not.toHaveProperty('balance');
  await expect(page.locator('.surface-header .subtitle')).toHaveText('Net worth: £4,987.66');
  expect(control.services.finance.accounts[0].balance).toBe(498_766);
  await page.reload();
  await expect(page.getByRole('heading', { name: 'Finance', exact: true })).toBeVisible();
  await expect(page.locator('.surface-header .subtitle')).toHaveText('Net worth: £4,987.66');
});
