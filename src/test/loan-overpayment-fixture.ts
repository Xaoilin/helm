import type { FinanceReview } from '../types/domain';
import { FINANCE_REVIEW } from './finance-review-fixture';

/** Entirely synthetic loan amounts and terms; provider names only select the requested calculators. */
export const OVERPAYMENT_REVIEW: FinanceReview = {
  ...FINANCE_REVIEW,
  loans: [
    {
      id: 'example-selina', lender: 'Selina (example)', purpose: 'Synthetic secured loan', status: 'active',
      balanceKind: 'unknown', monthlyPaymentPence: 20_000, userSharePence: 10_000,
      settlementPence: 1_120_000, settlementAsOf: '2026-09-20',
      rateNote: 'Signed offer: 12% p.a. fixed for two years. APRC 14%. Future rates are unknown.',
      notes: 'Dated statement: current-balance line £10,000.00; settlement includes fees.', sourceIds: ['statement'],
    },
    {
      id: 'example-natwest', lender: 'NatWest (example)', purpose: 'Synthetic joint mortgage', status: 'active',
      balancePence: 2_000_000, balanceKind: 'statement', balanceAsOf: '2026-09-20', monthlyPaymentPence: 25_000,
      rateNote: '6% fixed for the initial period. Original illustration APRC 7.5%.',
      notes: 'Payments may be recalculated by the lender.', sourceIds: ['statement'],
    },
  ],
};
