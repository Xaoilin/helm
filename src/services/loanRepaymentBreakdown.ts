import type { LoanProjection } from './loanOverpayment';

export interface RepaymentBreakdown {
  status: 'paying' | 'paid-off' | 'unavailable';
  paymentPence: number;
  capitalPence: number;
  interestPence: number;
  capitalPercent: number | null;
  interestPercent: number | null;
}

/** Ratios use the actual payment INCLUDING extras. No repayment after payoff means no ratio. */
export function repaymentBreakdown(projection: LoanProjection, monthIndex: number): RepaymentBreakdown {
  const row = projection.months[monthIndex];
  if (!row) return {
    status: projection.status === 'repaid' ? 'paid-off' : 'unavailable',
    paymentPence: 0, capitalPence: 0, interestPence: 0, capitalPercent: null, interestPercent: null,
  };
  const interestPercent = row.paymentPence > 0 ? row.interestPence / row.paymentPence * 100 : null;
  return {
    status: 'paying', paymentPence: row.paymentPence, capitalPence: row.principalPence,
    interestPence: row.interestPence, interestPercent,
    capitalPercent: interestPercent === null ? null : 100 - interestPercent,
  };
}

export function repaymentPercent(value: number | null): string {
  return value === null ? 'No repayment' : `${value.toLocaleString('en-GB', { maximumFractionDigits: 1 })}%`;
}
