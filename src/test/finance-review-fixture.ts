import type { FinanceReview } from '../types/domain';

/** Synthetic data only, shared by focused component and browser acceptance tests. */
export const FINANCE_REVIEW: FinanceReview = {
  id: 'current', asOf: '2026-09-21', currency: 'GBP',
  coverage: { from: '2025-09-01', to: '2026-09-21', completeThrough: '2026-08-31', transactionCount: 800, accountCount: 3, note: 'Personal cash flow excludes matched transfers between your own accounts.' },
  accounts: [
    { id: 'personal', label: 'Example personal bank', ownership: 'personal', balancePence: -120_000, asOf: '2026-09-21' },
    { id: 'household', label: 'Example household bank', ownership: 'household', balancePence: 45_000, asOf: '2026-09-21' },
  ],
  months: Array.from({ length: 12 }, (_, index) => ({
    month: index < 4 ? `2025-${String(9 + index).padStart(2, '0')}` : `2026-${String(index - 3).padStart(2, '0')}`,
    incomePence: 520_000, outflowPence: 410_000, netPence: 110_000, salaryPence: 500_000,
    categories: [{ label: 'Household contribution', amountPence: 200_000 }, { label: 'Retail purchases', amountPence: 80_000 }, { label: 'Refunds', amountPence: -10_000 }, { label: 'Other outgoings', amountPence: 140_000 }],
  })),
  budget: {
    incomePence: 500_000, incomeBasis: 'Average of the latest three complete months; excludes one-off receipts.',
    essentials: [{ label: 'Household contribution', amountPence: 200_000, note: 'Includes both mortgages and household bills.' }, { label: 'Other essentials', amountPence: 100_000, note: 'Includes the renovation loan payment.' }],
    workCostsPence: 25_000, workCostsNote: 'Tools used for work, including occasional annual payments.',
    scenarios: [
      { label: 'Higher household contribution', status: 'planned', monthlyAdjustmentPence: 40_000, note: 'Amount is not confirmed; includes the shared loan.' },
      { label: 'Renovation loans fully repaid', status: 'planned', monthlyAdjustmentPence: -90_000, note: 'Net reduction includes the higher household contribution.\nRequires full repayment; refinancing still has replacement payments.' },
    ],
  },
  opportunities: [{ label: 'Retail shopping', monthlyPence: 80_000, note: 'Some purchases may be essential; review larger orders.', suggestedCapPence: 50_000 }, { label: 'Dining and delivery', monthlyPence: 40_000, note: 'Average of the latest three complete months.' }],
  loans: [
    { id: 'renovation', lender: 'Example Renovation Lender', purpose: 'House renovation', status: 'active', monthlyPaymentPence: 40_000, balancePence: 1_800_000, balanceAsOf: '2026-09-20', balanceKind: 'statement', settlementPence: 1_700_000, settlementAsOf: '2026-09-20', nextPaymentDate: '2026-10-01', paymentsRemaining: 45, originalPrincipalPence: 2_500_000, startDate: '2024-06-01', endDate: '2030-06-01', aprPercent: 8.5, rateNote: 'Rate from the dated agreement.', notes: 'Payment is already included in other essentials.', sourceIds: ['statement'] },
    { id: 'shared', lender: 'Example Shared Lender', purpose: 'Shared house loan', status: 'active', monthlyPaymentPence: 160_000, userSharePence: 80_000, balanceKind: 'unknown', rateNote: 'Latest agreement still to confirm.', notes: 'Already included in household costs. Consolidation is a plan only.', sourceIds: [] },
    { id: 'old-card', lender: 'Example Closed Card', purpose: 'Former credit card', status: 'closed', balanceKind: 'unknown', rateNote: '', notes: 'Closed; will not be reopened.', sourceIds: [] },
    { id: 'repaid', lender: 'Example Personal Loan', purpose: 'Short-term loan', status: 'repaid', monthlyPaymentPence: 50_000, balanceKind: 'unknown', rateNote: '', notes: 'Repayments completed.', sourceIds: [] },
  ],
  notes: ['Irregular dental and home costs are not reserved in this monthly budget.', 'Planned household costs must be confirmed before treating them as ongoing.'],
  sources: [{ id: 'statement', label: 'Example lender statement', url: 'https://example.test/loan-statement', asOf: '2026-09-20' }],
  createdAt: '2026-09-21T12:00:00.000Z', updatedAt: '2026-09-21T12:00:00.000Z',
};
