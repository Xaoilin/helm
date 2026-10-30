import { describe, expect, it } from 'vitest';
import { compareLoan } from '../services/loanOverpayment';
import { repaymentBreakdown } from '../services/loanRepaymentBreakdown';

describe('capital and interest shares of repayments', () => {
  const comparison = compareLoan({ balancePence: 1_000_000, annualRatePercent: 12, monthlyPaymentPence: 20_000,
    monthlyExtraPence: 10_000, lumpSumPence: 0, extraStartsAfterMonths: 0 });
  it('uses the repayment including extras as the denominator, not the loan balance or annual rate', () => {
    expect(repaymentBreakdown(comparison.normal, 0)).toMatchObject({ capitalPence: 10_000, interestPence: 10_000, capitalPercent: 50, interestPercent: 50 });
    const extra = repaymentBreakdown(comparison.overpaid, 0);
    expect(extra.interestPence).toBe(10_000);
    expect(extra.interestPercent).toBeCloseTo(100 / 3);
    expect(extra.capitalPercent).toBeCloseTo(200 / 3);
  });
  it('tracks declining monthly accrued interest and repayment shares as capital falls', () => {
    const before = repaymentBreakdown(comparison.normal, 1);
    const after = repaymentBreakdown(comparison.overpaid, 1);
    expect(before.interestPence).toBe(9900);
    expect(before.interestPercent).toBe(49.5);
    expect(after.interestPence).toBe(9800);
    expect(after.interestPercent).toBeCloseTo(32.6666667);
  });
  it('treats paid-off and unprojected months distinctly and does not fabricate percentages', () => {
    expect(repaymentBreakdown(comparison.overpaid, comparison.overpaid.months.length)).toMatchObject({ status: 'paid-off', interestPercent: null });
    const negative = compareLoan({ balancePence: 1_000_000, annualRatePercent: 12, monthlyPaymentPence: 9_000,
      monthlyExtraPence: 0, lumpSumPence: 0, extraStartsAfterMonths: 0 });
    expect(repaymentBreakdown(negative.normal, 0).interestPercent).toBeGreaterThan(100);
    expect(repaymentBreakdown(negative.normal, 0).capitalPence).toBe(-1000);
    expect(repaymentBreakdown(negative.normal, 1)).toMatchObject({ status: 'unavailable', interestPercent: null });
  });
});
