import { writeFile } from 'node:fs/promises';
import type { Page } from '@playwright/test';
import type { FinanceAccount } from '../src/types/domain';
import { FINANCE_REVIEW } from '../src/test/finance-review-fixture';
import { BUDGET_REVIEW, DETAILED_BUDGET_REVIEW } from '../src/test/budget-forecast-fixture';
import { forecastFromMonth } from '../src/services/budgetForecast';
import { OVERPAYMENT_REVIEW } from '../src/test/loan-overpayment-fixture';
import { expect, openApp, test, waitForMutation } from './support/helm-fixture';

const BANK: FinanceAccount = {
  id: 'example-manual-bank', name: 'Example manual account', type: 'current', balance: 500_000,
  currency: 'GBP', color: '#4f5bff', icon: '£', includeInNetWorth: true, sortOrder: 0,
  createdAt: FINANCE_REVIEW.createdAt, updatedAt: FINANCE_REVIEW.updatedAt,
};

test('saves default overpayment profiles across reload and compares capital and interest amounts and repayment shares', async ({ page, scenario }, testInfo) => {
  await page.setViewportSize({ width: 1440, height: 900 });
  await page.emulateMedia({ reducedMotion: 'reduce' });
  const control = await scenario({ now: OVERPAYMENT_REVIEW.updatedAt, stores: { financeReviews: [OVERPAYMENT_REVIEW] } });
  const originalLoans = structuredClone(control.services.finance.review!.loans);
  await openApp(page);
  await page.getByRole('button', { name: 'Navigate to Finance' }).click();
  await page.getByRole('button', { name: 'Loans', exact: true }).click();
  const selina = page.getByRole('article', { name: 'Selina (example) overpayment calculator' });
  await selina.getByLabel('Extra payment (£/month)', { exact: true }).fill('100');
  await page.getByLabel('First projected payment').fill('2026-10');
  const profiles = page.getByRole('region', { name: 'Saved overpayment profiles' });
  await profiles.getByLabel('Profile name').fill('Monthly capital plan');
  await profiles.getByLabel('Load this profile by default').check();
  const save = waitForMutation(page, 'financeReviews');
  await profiles.getByRole('button', { name: 'Save profile', exact: true }).click();
  const response = await save;
  const body = response.request().postDataJSON();
  expect(body).not.toHaveProperty('review');
  expect(body.loanProfileChange).toMatchObject({ operation: 'save', profile: { name: 'Monthly capital plan', isDefault: true } });
  await expect(profiles).toContainText('Saved “Monthly capital plan” to your account as your default.');
  expect(control.services.finance.review!.loans).toEqual(originalLoans);
  await page.reload();
  await page.getByRole('button', { name: 'Navigate to Finance' }).click();
  await page.getByRole('button', { name: 'Loans', exact: true }).click();
  await expect(selina.getByLabel('Extra payment (£/month)', { exact: true })).toHaveValue('100.00');
  await expect(page.getByLabel('First projected payment')).toHaveValue('2026-10');
  const before = selina.getByRole('region', { name: 'Normal repayment split' });
  const after = selina.getByRole('region', { name: 'Overpayment repayment split' });
  await expect(before).toContainText('Interest charged£100.00 (50%)');
  await expect(after).toContainText('Interest charged£100.00 (33.3%)');
  await selina.getByRole('slider').focus();
  await selina.getByRole('slider').press('ArrowRight');
  await expect(before).toContainText('Interest charged£99.00 (49.5%)');
  await expect(after).toContainText('Interest charged£98.00 (32.7%)');
  const accrual = selina.getByLabel('Monthly interest from the remaining balance');
  await expect(accrual).toContainText('£9,900.00 balance → £99.00 interest');
  await expect(accrual).toContainText('£9,800.00 balance → £98.00 interest');
  for (const width of [320, 768, 1440]) {
    await page.setViewportSize({ width, height: 900 });
    await assertNoOverflow(page);
    await selina.getByRole('heading', { name: 'Where your repayments go' }).scrollIntoViewIfNeeded();
    await page.screenshot({ path: testInfo.outputPath(`capital-interest-split-${width}.png`) });
    await selina.getByRole('figure').filter({ hasText: 'Monthly interest charged (£)' }).scrollIntoViewIfNeeded();
    await page.screenshot({ path: testInfo.outputPath(`interest-over-time-${width}.png`) });
  }
  await page.setViewportSize({ width: 1440, height: 900 });
  await profiles.getByRole('button', { name: 'New profile from these inputs' }).click();
  await profiles.getByLabel('Profile name').fill('Alternative plan');
  await profiles.getByLabel('Load this profile by default').check();
  await profiles.getByRole('button', { name: 'Save profile', exact: true }).click();
  await expect(profiles).toContainText('Saved “Alternative plan”');
  const stored = control.services.finance.review!.loanProfiles as { name: string; isDefault: boolean }[];
  expect(stored.filter(profile => profile.isDefault).map(profile => profile.name)).toEqual(['Alternative plan']);
  await profiles.getByLabel('Saved profile', { exact: true }).selectOption({ label: 'Monthly capital plan' });
  await profiles.getByRole('button', { name: 'Load profile', exact: true }).click();
  await expect(profiles.getByLabel('Profile name')).toHaveValue('Monthly capital plan');
  page.once('dialog', dialog => dialog.accept());
  await profiles.getByRole('button', { name: 'Delete profile', exact: true }).click();
  await expect(profiles).toContainText('Profile deleted.');
  expect((control.services.finance.review!.loanProfiles as unknown[]).length).toBe(1);
});

test('retains profile inputs after a version conflict and saves after reloading the confirmed review', async ({ page, scenario }) => {
  await page.setViewportSize({ width: 1440, height: 900 });
  const control = await scenario({ now: OVERPAYMENT_REVIEW.updatedAt, stores: { financeReviews: [OVERPAYMENT_REVIEW] } });
  await openApp(page);
  await page.getByRole('button', { name: 'Navigate to Finance' }).click();
  await page.getByRole('button', { name: 'Loans', exact: true }).click();
  const profiles = page.getByRole('region', { name: 'Saved overpayment profiles' });
  await profiles.getByLabel('Profile name').fill('Keep my edits');
  control.services.finance.review!.updatedAt = '2026-10-01T12:00:00.000Z';
  await profiles.getByRole('button', { name: 'Save profile', exact: true }).click();
  await expect(profiles.getByRole('alert')).toContainText('Your inputs are still here.');
  await expect(profiles.getByLabel('Profile name')).toHaveValue('Keep my edits');
  await expect(profiles.getByRole('button', { name: 'Save profile', exact: true })).toBeEnabled();
  await profiles.getByRole('button', { name: 'Save profile', exact: true }).click();
  await expect(profiles).toContainText('Saved “Keep my edits”');
});

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
    await expect(page.getByRole('region', { name: 'Bank balance snapshots' })).not.toContainText('Example household bank');
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


const EXPENSE_REVIEW = {
  ...FINANCE_REVIEW,
  months: FINANCE_REVIEW.months.map(month => ({ ...month, categories: [
    { label: 'Mortgage', amountPence: 200_000 }, { label: 'Groceries', amountPence: 40_000 },
    { label: 'Fuel', amountPence: 10_000 }, { label: 'Netflix subscriptions', amountPence: 2_000 },
    { label: 'Other outgoings', amountPence: 168_000 }, { label: 'Refunds', amountPence: -10_000 },
  ] })),
};

test('expense groups save menu and drag moves across months and reload, with responsive keyboard access', async ({ page, scenario }, testInfo) => {
  const control = await scenario({ now: EXPENSE_REVIEW.updatedAt, stores: { financeReviews: [EXPENSE_REVIEW] } });
  await page.setViewportSize({ width: 1440, height: 1000 });
  await page.emulateMedia({ reducedMotion: 'reduce' });
  await openApp(page);
  await page.getByRole('button', { name: 'Navigate to Finance' }).click();
  await page.getByRole('button', { name: 'Spending', exact: true }).click();
  await page.getByRole('button', { name: 'Last month', exact: true }).click();
  const board = page.getByRole('region', { name: 'Expense groups', exact: true });
  const fixed = board.getByRole('region', { name: 'Non-discretionary', exact: true });
  const necessary = board.getByRole('region', { name: 'Discretionary but necessary', exact: true });
  const optional = board.getByRole('region', { name: '100% discretionary', exact: true });
  await expect(fixed.getByRole('article', { name: 'Mortgage expense' })).toBeVisible();
  await expect(necessary.getByRole('article', { name: 'Fuel expense' })).toBeVisible();
  await expect(optional.getByRole('article', { name: 'Netflix subscriptions expense' })).toBeVisible();
  await board.scrollIntoViewIfNeeded();
  await page.screenshot({ path: testInfo.outputPath('expense-groups-desktop.png') });
  const write = page.waitForResponse(response => response.url().endsWith('/api/finance/v1/review') && response.request().method() === 'PUT');
  await board.getByLabel('Group for Fuel', { exact: true }).focus();
  await expect(board.getByLabel('Group for Fuel', { exact: true })).toBeFocused();
  await board.getByLabel('Group for Fuel', { exact: true }).selectOption('discretionary');
  const response = await write;
  expect(response.request().postDataJSON()).toMatchObject({ expectedUpdatedAt: EXPENSE_REVIEW.updatedAt,
    review: { expenseGroups: [{ label: 'Fuel', group: 'discretionary' }] } });
  await expect(optional.getByRole('article', { name: 'Fuel expense' })).toBeVisible();
  await expect(board.getByLabel('Group for Fuel', { exact: true })).toBeFocused();
  expect(control.services.finance.review?.expenseGroups).toEqual([{ label: 'Fuel', group: 'discretionary' }]);
  await optional.getByRole('article', { name: 'Netflix subscriptions expense' }).dragTo(necessary);
  await expect(necessary.getByRole('article', { name: 'Netflix subscriptions expense' })).toBeVisible();
  await page.getByRole('combobox', { name: 'Review month', exact: true }).selectOption('2026-07');
  await expect(optional.getByRole('article', { name: 'Fuel expense' })).toBeVisible();
  await page.reload();
  await page.getByRole('button', { name: 'Spending', exact: true }).click();
  await page.getByRole('button', { name: 'Last month', exact: true }).click();
  await expect(optional.getByRole('article', { name: 'Fuel expense' })).toBeVisible();
  await expect(necessary.getByRole('article', { name: 'Netflix subscriptions expense' })).toBeVisible();
  for (const width of [320, 768, 1440]) {
    await page.setViewportSize({ width, height: 1000 });
    await board.getByRole('heading', { name: 'How necessary is it?' }).scrollIntoViewIfNeeded();
    expect(await board.evaluate(element => element.scrollWidth <= element.clientWidth)).toBe(true);
    await expect(board.getByLabel('Group for Mortgage', { exact: true })).toBeVisible();
    await page.screenshot({ path: testInfo.outputPath(`expense-groups-${width}.png`) });
  }
  await page.setViewportSize({ width: 320, height: 800 });
  const scroller = page.locator('.main-content');
  await scroller.evaluate(element => { element.scrollTop = 0; });
  await scroller.focus();
  await page.keyboard.press('PageDown');
  await expect.poll(() => scroller.evaluate(element => element.scrollTop)).toBeGreaterThan(0);
  await board.getByLabel('Group for Fuel', { exact: true }).focus();
  await expect(board.getByLabel('Group for Fuel', { exact: true })).toBeInViewport();
  await page.screenshot({ path: testInfo.outputPath('expense-groups-mobile-move.png') });
});

test('a refused group save retains the confirmed placement and supports recovery', async ({ page, scenario }) => {
  await scenario({ now: EXPENSE_REVIEW.updatedAt, stores: { financeReviews: [EXPENSE_REVIEW] } });
  await openApp(page);
  await page.getByRole('button', { name: 'Navigate to Finance' }).click();
  await page.getByRole('button', { name: 'Spending', exact: true }).click();
  await page.getByRole('button', { name: 'Last month', exact: true }).click();
  const board = page.getByRole('region', { name: 'Expense groups', exact: true });
  await page.route('**/api/finance/v1/review', async route => {
    if (route.request().method() === 'PUT') await route.fulfill({ status: 409, contentType: 'application/json',
      body: JSON.stringify({ code: 'review_changed', message: 'The banking review changed; reload and try again.' }) });
    else await route.fallback();
  });
  await board.getByLabel('Group for Fuel', { exact: true }).selectOption('discretionary');
  await expect(page.getByRole('alert').filter({ hasText: 'Your last change was not saved' })).toBeVisible();
  await expect(board.getByRole('region', { name: 'Discretionary but necessary', exact: true }).getByRole('article', { name: 'Fuel expense' })).toBeVisible();
  await page.unroute('**/api/finance/v1/review');
  await page.getByRole('button', { name: 'Retry loading' }).click();
  await expect(board.getByLabel('Group for Fuel', { exact: true })).toBeEnabled();
  await board.getByLabel('Group for Fuel', { exact: true }).selectOption('discretionary');
  await expect(board.getByRole('region', { name: '100% discretionary', exact: true }).getByRole('article', { name: 'Fuel expense' })).toBeVisible();
});

test('plans a September-based monthly budget with editable amounts, additions and removals that survive reload', async ({ page, scenario }, testInfo) => {
  const control = await scenario({ now: BUDGET_REVIEW.updatedAt, stores: { financeReviews: [BUDGET_REVIEW] } });
  await page.setViewportSize({ width: 1440, height: 1000 });
  await page.emulateMedia({ reducedMotion: 'reduce' });
  await openApp(page);
  await page.getByRole('button', { name: 'Navigate to Finance' }).click();
  await page.getByRole('button', { name: 'Budgets & Goals', exact: true }).click();
  const editor = page.getByRole('region', { name: 'Monthly budget forecast', exact: true });
  await expect(editor.getByLabel('Forecast example month', { exact: true })).toHaveValue('2026-09');
  await expect(editor).toContainText('£1,765.00');
  await expect(editor).toContainText('£3,235.00');
  await expect(editor).toContainText('35.3% of your salary budgeted');
  await editor.getByLabel('Monthly take-home salary (£)', { exact: true }).fill('4500');
  await editor.getByLabel('Monthly amount for Groceries', { exact: true }).fill('250.50');
  await editor.getByRole('button', { name: 'Remove Subscriptions', exact: true }).click();
  await editor.getByRole('button', { name: '+ Add item', exact: true }).click();
  await expect(editor.getByLabel('Name for new item', { exact: true })).toBeFocused();
  await editor.getByLabel('Name for new item', { exact: true }).fill('Emergency buffer');
  await editor.getByLabel('Monthly amount for Emergency buffer', { exact: true }).fill('75');
  const response = page.waitForResponse(reply => reply.url().endsWith('/api/finance/v1/review') && reply.request().method() === 'PUT');
  await editor.getByRole('button', { name: 'Save forecast', exact: true }).click();
  await response;
  await expect(editor.getByRole('status')).toContainText('Forecast saved');
  expect(control.services.finance.review?.months).toEqual(BUDGET_REVIEW.months);
  const stored = control.services.finance.review?.budgetForecast as { baselineMonth: string; items: { label: string; amountPence: number }[] };
  expect(stored.baselineMonth).toBe('2026-09');
  expect(control.services.finance.review?.budgetForecast).toMatchObject({ incomePence: 450000 });
  expect(stored.items.find(item => item.label === 'Emergency buffer')?.amountPence).toBe(7500);
  expect(stored.items.some(item => item.label === 'Subscriptions')).toBe(false);
  await page.reload();
  await page.getByRole('button', { name: 'Budgets & Goals', exact: true }).click();
  await expect(editor.getByLabel('Monthly amount for Groceries', { exact: true })).toHaveValue('250.50');
  await expect(editor.getByLabel('Monthly amount for Emergency buffer', { exact: true })).toHaveValue('75.00');
  await expect(editor.getByLabel('Monthly take-home salary (£)', { exact: true })).toHaveValue('4500.00');
  await expect(editor.getByRole('button', { name: '+ Add item', exact: true })).toBeEnabled();
  for (const width of [320, 768, 1440]) {
    await page.setViewportSize({ width, height: 1000 });
    await editor.getByRole('heading', { name: 'Monthly budget forecast' }).scrollIntoViewIfNeeded();
    expect(await editor.evaluate(element => element.scrollWidth <= element.clientWidth)).toBe(true);
    await page.screenshot({ path: testInfo.outputPath(`budget-forecast-${width}.png`) });
  }
  await page.setViewportSize({ width: 320, height: 800 });
  await editor.getByLabel('Monthly amount for Emergency buffer', { exact: true }).focus();
  await expect(editor.getByLabel('Monthly amount for Emergency buffer', { exact: true })).toBeInViewport();
  const scroller = page.locator('.main-content');
  await scroller.evaluate(element => { element.scrollTop = 0; });
  await scroller.focus();
  await page.keyboard.press('PageDown');
  await expect.poll(() => scroller.evaluate(element => element.scrollTop)).toBeGreaterThan(0);
});

test('shows personal payment purpose and sources in Spending and its budget example without joint itemisation', async ({ page, scenario }, testInfo) => {
  await scenario({ now: DETAILED_BUDGET_REVIEW.updatedAt, stores: { financeReviews: [DETAILED_BUDGET_REVIEW] } });
  await openApp(page);
  await page.getByRole('button', { name: 'Navigate to Finance' }).click();
  await page.getByRole('button', { name: 'Spending', exact: true }).click();
  await page.getByRole('button', { name: 'Last month', exact: true }).click();
  const payments = page.getByRole('region', { name: 'Itemised transactions', exact: true });
  await expect(payments).toContainText('Example Temporary Cover');
  await expect(payments).toContainText('Two-day cover for an example hybrid car, 27–29 September.');
  await expect(payments).toContainText('One-off');
  await expect(payments.getByRole('link', { name: 'Example lender statement' })).toHaveAttribute('href', 'https://example.test/loan-statement');
  await payments.getByLabel('Find a payment').fill('hybrid');
  await expect(payments).toContainText('Example Temporary Cover');
  await page.getByRole('button', { name: 'Budgets & Goals', exact: true }).click();
  const editor = page.getByRole('region', { name: 'Monthly budget forecast', exact: true });
  await editor.getByText('1 payment · Example Temporary Cover', { exact: true }).click();
  await expect(editor).toContainText('Two-day cover for an example hybrid car, 27–29 September.');
  await editor.getByLabel('Monthly take-home salary (£)', { exact: true }).fill('1000');
  await expect(editor).toContainText('Over budget by');
  await expect(editor).toContainText('Planned spending exceeds your take-home salary.');
  for (const width of [320, 768, 1440]) {
    await page.setViewportSize({ width, height: 1000 });
    await editor.getByRole('heading', { name: 'Monthly budget forecast' }).scrollIntoViewIfNeeded();
    expect(await editor.evaluate(element => element.scrollWidth <= element.clientWidth)).toBe(true);
    await page.screenshot({ path: testInfo.outputPath(`income-and-payments-${width}.png`) });
  }
});

test('retains a budget draft after a refused save and permits an explicitly empty saved forecast', async ({ page, scenario }) => {
  await scenario({ now: BUDGET_REVIEW.updatedAt, stores: { financeReviews: [BUDGET_REVIEW] } });
  await openApp(page);
  await page.getByRole('button', { name: 'Navigate to Finance' }).click();
  await page.getByRole('button', { name: 'Budgets & Goals', exact: true }).click();
  const editor = page.getByRole('region', { name: 'Monthly budget forecast', exact: true });
  await editor.getByLabel('Monthly amount for Groceries', { exact: true }).fill('123.45');
  await page.route('**/api/finance/v1/review', async route => {
    if (route.request().method() === 'PUT') await route.fulfill({ status: 409, contentType: 'application/json', body: JSON.stringify({ code: 'review_changed', message: 'Review changed; reload before saving.' }) });
    else await route.fallback();
  });
  await editor.getByRole('button', { name: 'Save forecast', exact: true }).click();
  await expect(editor.getByRole('alert')).toContainText('Your draft is still here');
  await expect(editor.getByLabel('Monthly amount for Groceries', { exact: true })).toHaveValue('123.45');
  await page.unroute('**/api/finance/v1/review');
  await page.getByRole('button', { name: 'Retry loading forecast' }).click();
  for (let remaining = await editor.getByRole('button', { name: /^Remove / }).count(); remaining > 0; remaining--) {
    await editor.getByRole('button', { name: /^Remove / }).first().click();
  }
  await editor.getByRole('button', { name: 'Save forecast', exact: true }).click();
  await expect(editor.getByRole('status')).toContainText('Forecast saved');
  await page.reload();
  await page.getByRole('button', { name: 'Budgets & Goals', exact: true }).click();
  await expect(editor).toContainText('Your forecast is empty');
  await expect(editor.getByRole('button', { name: /^Remove / })).toHaveCount(0);
});

test('a live forecast change from another tab cannot be overwritten by an older local draft', async ({ page, scenario }) => {
  const initial = forecastFromMonth(BUDGET_REVIEW, '2026-09');
  const control = await scenario({ now: BUDGET_REVIEW.updatedAt, stores: { financeReviews: [{ ...BUDGET_REVIEW, budgetForecast: initial }] } });
  await openApp(page);
  await page.getByRole('button', { name: 'Navigate to Finance' }).click();
  await page.getByRole('button', { name: 'Budgets & Goals', exact: true }).click();
  const editor = page.getByRole('region', { name: 'Monthly budget forecast', exact: true });
  await editor.getByLabel('Monthly amount for Groceries', { exact: true }).fill('222');
  const latest = { ...initial, items: initial.items.map(item => item.label === 'House bills' ? { ...item, amountPence: 130_000 } : item) };
  control.services.finance.review!.budgetForecast = latest;
  control.services.finance.review!.updatedAt = '2026-10-30T10:01:00.000Z';
  control.services.liveEvents.push({ type: 'finance.updated', domain: 'finance', at: '2026-10-30T10:01:00.000Z', data: null });
  await expect(editor.getByRole('alert')).toContainText('Your saved forecast changed elsewhere');
  await expect(editor.getByRole('button', { name: 'Save forecast', exact: true })).toBeDisabled();
  await expect(editor.getByLabel('Monthly amount for Groceries', { exact: true })).toHaveValue('222');
  await editor.getByRole('button', { name: 'Load latest saved forecast', exact: true }).click();
  await expect(editor.getByLabel('Monthly amount for House bills', { exact: true })).toHaveValue('1300.00');
  await editor.getByLabel('Monthly amount for Groceries', { exact: true }).fill('222');
  await editor.getByRole('button', { name: 'Save forecast', exact: true }).click();
  await expect(editor.getByRole('status')).toContainText('Forecast saved');
  expect((control.services.finance.review!.budgetForecast as typeof latest).items.find(item => item.label === 'House bills')?.amountPence).toBe(130_000);
});
