import type { ExpenseGroup, FinanceReview } from '../types/domain';

export const EXPENSE_GROUPS: { value: ExpenseGroup; label: string; description: string }[] = [
  { value: 'non-discretionary', label: 'Non-discretionary', description: 'Fixed commitments: mortgage, loan repayments and essential bills.' },
  { value: 'necessary', label: 'Discretionary but necessary', description: 'You need these, but can change how much you spend: food, fuel and everyday needs.' },
  { value: 'discretionary', label: '100% discretionary', description: 'Optional spending: subscriptions, entertainment and clothes.' },
];

const FIXED_COMMITMENTS = /\b(mortgages?|rent|loans?|repayments?|debt|council tax|bills?|utilities|electricity|gas|water bills?|insurance|household contributions?|spouse support|support for wife|finance payments?|overdraft interest|overdraft charges|bank fees|mobile phones?|mobile services|phone services)\b/iu;
const EVERYDAY_NEEDS = /\b(food|groceries|grocery|supermarket|fuel|petrol|diesel|transport|takeout|takeaway|takeaways|dining|delivery|eating out|restaurant|restaurants|health|medical|pharmacy|personal care)\b/iu;
const OPTIONAL_SPENDING = /\b(subscriptions?|memberships?|netflix|github|software|cloud tools|entertainment|clothes|clothing|retail|shopping|hobby|hobbies|gaming|games|leisure|fitness|gym|media)\b/iu;

export function normalizeExpenseLabel(label: string): string {
  return label.trim().toLowerCase();
}

/** Suggestions affect presentation only; explicit account-owned choices always win. */
export function expenseGrouping(label: string, review: FinanceReview): { group: ExpenseGroup; basis: string } {
  const normalized = normalizeExpenseLabel(label);
  const saved = review.expenseGroups?.find(item => normalizeExpenseLabel(item.label) === normalized);
  if (saved) return { group: saved.group, basis: 'Your choice' };
  if (FIXED_COMMITMENTS.test(label)) return { group: 'non-discretionary', basis: 'Suggested' };
  if (OPTIONAL_SPENDING.test(label)) return { group: 'discretionary', basis: 'Suggested' };
  if (EVERYDAY_NEEDS.test(label)) return { group: 'necessary', basis: 'Suggested' };
  if (review.budget.essentials.some(item => normalizeExpenseLabel(item.label) === normalized)) {
    return { group: 'non-discretionary', basis: 'From your essential budget' };
  }
  // Broad or unfamiliar bank labels do not establish that spending is optional.
  return { group: 'necessary', basis: 'Needs your review' };
}
