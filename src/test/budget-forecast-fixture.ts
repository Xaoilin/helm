import type { FinanceReview } from '../types/domain';
import { FINANCE_REVIEW } from './finance-review-fixture';

/** Synthetic baseline and current commitments; no personal financial values. */
export const BUDGET_REVIEW: FinanceReview = {
  ...FINANCE_REVIEW, asOf: '2026-10-30', updatedAt: '2026-10-30T10:00:00Z',
  coverage: { ...FINANCE_REVIEW.coverage, to: '2026-10-30', completeThrough: '2026-09' },
  months: [...FINANCE_REVIEW.months, {
    month: '2026-09', incomePence: 500_000, salaryPence: 500_000, outflowPence: 165_700, netPence: 334_300,
    categories: [{ label: 'Household contribution', amountPence: 110_000 },
      { label: 'Support for wife', amountPence: 20_000 }, { label: 'Groceries', amountPence: 30_000 },
      { label: 'Subscriptions', amountPence: 1_500 }, { label: 'Completed loan repayment', amountPence: 5_000 },
      { label: 'Refunds', amountPence: -800 }],
  }, {
    month: '2026-10', incomePence: 0, salaryPence: 0, outflowPence: 145_000, netPence: -145_000,
    categories: [{ label: 'House bills', amountPence: 120_000 }, { label: 'Private spending fund', amountPence: 25_000 }],
  }],
  expenseGroups: [{ label: 'Private spending fund', group: 'non-discretionary' }],
};

export const DETAILED_BUDGET_REVIEW: FinanceReview = {
  ...BUDGET_REVIEW,
  transactions: [
    { id: 'cover', accountId: 'personal', month: '2026-09', date: '2026-09-27', merchant: 'Example Temporary Cover', description: 'EXAMPLE COVER', category: 'Subscriptions', amountPence: 1000,
      detail: 'Two-day cover for an example hybrid car, 27–29 September.', recurrence: 'one-off', sourceIds: ['statement'], origin: 'bank' },
    { id: 'support', accountId: 'personal', month: '2026-10', merchant: 'Private spending fund', description: 'Monthly personal transfer', category: 'Private spending fund', amountPence: 25_000,
      detail: 'Monthly private spending fund confirmed by you.', recurrence: 'recurring', origin: 'user' },
  ],
};
