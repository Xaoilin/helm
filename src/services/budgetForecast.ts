import type { BudgetForecast, BudgetForecastItem, FinanceReview } from '../types/domain';
import { expenseGrouping, normalizeExpenseLabel } from './expenseGroups';
import { spendingTransactions } from './spendingTransactions';

export const MAX_FORECAST_ITEMS = 200;
const HOUSEHOLD = /\b(household contributions?|house bills)\b/iu;
const SPOUSE = /\b(support for wife|wife support|spouse support|spending fund)\b/iu;
const COMPLETED_REPAYMENT = /\b(completed|closed|repaid)\b.*\b(loans?|repayments?)\b/iu;

export function forecastBaseline(review: FinanceReview): string {
  return [...review.months].map(month => month.month)
    .filter(month => month <= review.coverage.completeThrough.slice(0, 7)).sort().at(-1)
    ?? [...review.months].map(month => month.month).sort().at(-1) ?? review.asOf.slice(0, 7);
}

/** Start from a dated example, replacing household/spouse transfers with confirmed current commitments. */
export function forecastFromMonth(review: FinanceReview, baselineMonth: string): BudgetForecast {
  const baseline = review.months.find(month => month.month === baselineMonth);
  const latestCategories = [...review.months].sort((a, b) => b.month.localeCompare(a.month))[0]?.categories ?? [];
  const commitment = (pattern: RegExp) => latestCategories.find(item => pattern.test(item.label))
    ?? review.budget.essentials.find(item => pattern.test(item.label));
  const household = commitment(HOUSEHOLD);
  const spouse = commitment(SPOUSE);
  const items = new Map<string, BudgetForecastItem>();
  const payments = spendingTransactions(review, baselineMonth);
  const add = (label: string, amountPence: number, fixed = false) => {
    const key = normalizeExpenseLabel(label);
    const existing = items.get(key);
    items.set(key, { id: existing?.id ?? `baseline-${items.size}`, label, amountPence: amountPence + (existing?.amountPence ?? 0),
      group: fixed ? 'non-discretionary' : expenseGrouping(label, review).group });
  };
  const categories = new Map<string, { label: string; amountPence: number }>();
  for (const category of baseline?.categories ?? []) {
    const key = normalizeExpenseLabel(category.label);
    const previous = categories.get(key);
    categories.set(key, { label: previous?.label ?? category.label, amountPence: category.amountPence + (previous?.amountPence ?? 0) });
  }
  for (const item of categories.values()) {
    const oneOffs = payments.filter(payment => normalizeExpenseLabel(payment.category) === normalizeExpenseLabel(item.label) && payment.recurrence === 'one-off')
      .reduce((sum, payment) => sum + payment.amountPence, 0);
    const recurringAmount = item.amountPence - oneOffs;
    if (recurringAmount <= 0 || COMPLETED_REPAYMENT.test(item.label) || /\bone[ -]off\b/iu.test(item.label)) continue;
    if (HOUSEHOLD.test(item.label) && household) continue;
    if (SPOUSE.test(item.label) && spouse) continue;
    add(item.label, recurringAmount);
  }
  if (household) add('House bills', household.amountPence, true);
  if (spouse) add(spouse.label, spouse.amountPence, true);
  return { baselineMonth, incomePence: review.budget.incomePence, incomeBasis: review.budget.incomeBasis, items: [...items.values()] };
}
