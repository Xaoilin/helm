import { describe, expect, it } from 'vitest';
import { compareLoan, loanStartingValues, moneyInputPence, paymentMonth, projectLoan, scenarioError, type LoanScenario } from '../services/loanOverpayment';
import { OVERPAYMENT_REVIEW } from './loan-overpayment-fixture';

const scenario: LoanScenario = {
  balancePence: 1_000_000, annualRatePercent: 12, monthlyPaymentPence: 20_000,
  monthlyExtraPence: 10_000, lumpSumPence: 0, extraStartsAfterMonths: 0,
};

describe('loan overpayment calculations', () => {
  it('charges interest on the opening balance, then reduces principal and caps the final payment', () => {
    const { normal, overpaid } = compareLoan(scenario);
    expect(normal.months[0]).toEqual({ month: 1, interestPence: 10_000, paymentPence: 20_000, regularPaymentPence: 20_000, principalPence: 10_000, balancePence: 990_000 });
    expect(overpaid.months[0]).toEqual({ month: 1, interestPence: 10_000, paymentPence: 30_000, regularPaymentPence: 20_000, principalPence: 20_000, balancePence: 980_000 });
    expect(overpaid.months[1].interestPence).toBe(9_800);
    // Independent closed-form amortisation count for a 1% monthly rate.
    expect(normal.months).toHaveLength(Math.ceil(-Math.log(1 - 1_000_000 * 0.01 / 20_000) / Math.log(1.01)));
    expect(overpaid.months.length).toBeLessThan(normal.months.length);
    expect(overpaid.interestPence).toBeLessThan(normal.interestPence);
    for (const projection of [normal, overpaid]) {
      expect(projection.status).toBe('repaid');
      expect(projection.months.at(-1)!.balancePence).toBe(0);
      expect(projection.months.at(-1)!.paymentPence).toBeLessThan(30_000);
      expect(projection.repaidPence).toBe(scenario.balancePence + projection.interestPence);
      expect(projection.months.reduce((sum, row) => sum + row.principalPence, 0)).toBe(scenario.balancePence);
    }
  });

  it('applies an opening lump sum before interest and honours delayed monthly extras', () => {
    const projected = projectLoan({ ...scenario, lumpSumPence: 100_000, extraStartsAfterMonths: 2 });
    expect(projected.months[0].interestPence).toBe(9_000);
    expect(projected.months.slice(0, 3).map(row => row.paymentPence)).toEqual([20_000, 20_000, 30_000]);
    expect(projected.repaidPence).toBe(scenario.balancePence + projected.interestPence);
    expect(projectLoan({ ...scenario, lumpSumPence: 2_000_000 })).toMatchObject({ months: [], lumpSumPence: 1_000_000, repaidPence: 1_000_000, interestPence: 0 });
  });

  it('handles zero interest, a zero balance and unchanged scenarios', () => {
    const result = compareLoan({ ...scenario, balancePence: 100_000, monthlyPaymentPence: 10_000, annualRatePercent: 0 });
    expect(result.normal.months).toHaveLength(10);
    expect(result.overpaid.months).toHaveLength(5);
    expect(result.overpaid.interestPence).toBe(0);
    expect(projectLoan({ ...scenario, balancePence: 0 }).months).toEqual([]);
    const unchanged = compareLoan({ ...scenario, monthlyExtraPence: 0 });
    expect(unchanged.normal).toEqual(unchanged.overpaid);
  });

  it('can reduce regular payments over the modelled remaining term instead of keeping payments constant', () => {
    const reduced = compareLoan({ ...scenario, lumpSumPence: 100_000, repaymentMode: 'reduce-payment' });
    const shortened = compareLoan({ ...scenario, lumpSumPence: 100_000 });
    expect(reduced.overpaid.months[0].regularPaymentPence).toBeLessThan(scenario.monthlyPaymentPence);
    expect(reduced.overpaid.months[1].regularPaymentPence).toBeLessThan(reduced.overpaid.months[0].regularPaymentPence);
    expect(reduced.overpaid.months.length).toBeGreaterThan(shortened.overpaid.months.length);
    expect(reduced.overpaid.months.length).toBeLessThanOrEqual(reduced.normal.months.length);
    expect(reduced.overpaid.status).toBe('repaid');
    expect(reduced.overpaid.repaidPence).toBe(scenario.balancePence + reduced.overpaid.interestPence);
  });

  it('does not invent a payoff or saving when payments cannot amortise, and bounds the horizon', () => {
    const result = compareLoan({ ...scenario, monthlyPaymentPence: 9_000 });
    expect(result.normal.status).toBe('not-amortising');
    expect(result.overpaid.status).toBe('repaid');
    const delayed = projectLoan({ ...scenario, monthlyPaymentPence: 9_000, extraStartsAfterMonths: 3 });
    expect(delayed.status).toBe('repaid');
    expect(delayed.months[2].balancePence).toBeGreaterThan(scenario.balancePence);
    expect(projectLoan({ ...scenario, annualRatePercent: 0, monthlyPaymentPence: 1, monthlyExtraPence: 0 }).status).toBe('limit-reached');
  });

  it('rejects missing, negative, non-finite, oversized or fractional-penny inputs', () => {
    for (const value of ['', '-1', '1.001', 'NaN', 'Infinity', '1e7', '10000000001']) expect(moneyInputPence(value)).toBeUndefined();
    expect(moneyInputPence('12.34')).toBe(1234);
    expect(moneyInputPence('0')).toBe(0);
    for (const patch of [{ balancePence: NaN }, { monthlyExtraPence: -1 }, { annualRatePercent: Infinity }, { monthlyPaymentPence: 0 }, { extraStartsAfterMonths: 1.5 }]) {
      expect(scenarioError({ ...scenario, ...patch })).not.toBeNull();
      expect(() => projectLoan({ ...scenario, ...patch })).toThrow();
    }
  });

  it('seeds only named capital and unambiguous fixed borrowing rates, never APR or settlement totals', () => {
    const loan = OVERPAYMENT_REVIEW.loans[0];
    expect(loanStartingValues(loan)).toEqual({ balancePence: 1_000_000, balanceFromNote: true, annualRatePercent: 12 });
    expect(loanStartingValues({ ...loan, notes: 'Settlement quote £11,200.00', rateNote: 'APR 14%, APRC 15%' })).toEqual({ balancePence: undefined, balanceFromNote: false, annualRatePercent: undefined });
    expect(loanStartingValues({ ...loan, rateNote: 'Historical illustration: 8% fixed.' }).annualRatePercent).toBeUndefined();
    expect(loanStartingValues({ ...loan, rateNote: '4% fixed; alternative 5% fixed.' }).annualRatePercent).toBeUndefined();
    expect(loanStartingValues({ ...loan, balancePence: 800_000, balanceKind: 'statement' }).balancePence).toBe(800_000);
    expect(loanStartingValues({ ...loan, balancePence: 1_120_000, balanceKind: 'settlement', notes: '' }).balancePence).toBeUndefined();
  });

  it('advances month labels across year boundaries without end-of-month or timezone drift', () => {
    expect(paymentMonth('2026-12', 1)).toBe('Jan 2027');
    expect(paymentMonth('2028-02', 1)).toBe('Mar 2028');
  });
});
