import type { FinanceReview } from '../types/domain';

export type ReviewLoan = FinanceReview['loans'][number];

export const LOAN_PROJECTION_LIMIT_MONTHS = 1_200;
export const LOAN_MONEY_LIMIT_PENCE = 1_000_000_000_000;

export interface LoanScenario {
  balancePence: number;
  annualRatePercent: number;
  monthlyPaymentPence: number;
  monthlyExtraPence: number;
  lumpSumPence: number;
  extraStartsAfterMonths: number;
  repaymentMode?: 'shorten-term' | 'reduce-payment';
}

export interface LoanMonth {
  month: number;
  interestPence: number;
  paymentPence: number;
  regularPaymentPence: number;
  principalPence: number;
  balancePence: number;
}

export interface LoanProjection {
  status: 'repaid' | 'not-amortising' | 'limit-reached';
  months: LoanMonth[];
  interestPence: number;
  repaidPence: number;
  lumpSumPence: number;
}

export interface LoanStartingValues {
  balancePence?: number;
  balanceFromNote: boolean;
  annualRatePercent?: number;
}

/**
 * Older reviews have no structured borrowing-rate field. Only use an explicitly labelled,
 * unambiguous fixed borrowing rate; APR/APRC, base rates and historical illustrations are not rates
 * for this calculation. An explicitly named capital line can seed a scenario, never a settlement
 * total. Both are shown as dated note-derived assumptions and remain editable, never written back.
 */
export function loanStartingValues(loan: ReviewLoan): LoanStartingValues {
  const rates = [...loan.rateNote.matchAll(/\b(\d+(?:\.\d+)?)%\s*(?:p\.a\.\s*)?fixed\b/giu)]
    .filter(match => !/historical|illustration|APRC?/iu.test(loan.rateNote.slice(0, match.index)))
    .map(match => Number(match[1]));
  const uniqueRates = [...new Set(rates)];
  const capitalLines = [...loan.notes.matchAll(/current-balance line £([\d,]+\.\d{2})\b/giu)];
  const noteBalance = capitalLines.length === 1 ? moneyInputPence(capitalLines[0][1].replaceAll(',', '')) : undefined;
  const hasCapitalBalance = (loan.balanceKind === 'statement' || loan.balanceKind === 'estimate')
    && loan.balancePence !== undefined;
  return {
    balancePence: hasCapitalBalance ? loan.balancePence : noteBalance,
    balanceFromNote: !hasCapitalBalance && noteBalance !== undefined,
    annualRatePercent: uniqueRates.length === 1 ? uniqueRates[0] : undefined,
  };
}

export function moneyInputPence(value: string): number | undefined {
  if (!/^\d+(?:\.\d{1,2})?$/u.test(value.trim())) return undefined;
  const amount = Math.round(Number(value) * 100);
  return Number.isSafeInteger(amount) && amount <= LOAN_MONEY_LIMIT_PENCE ? amount : undefined;
}

export function scenarioError(input: LoanScenario): string | null {
  const money = [input.balancePence, input.monthlyPaymentPence, input.monthlyExtraPence, input.lumpSumPence];
  if (money.some(value => !Number.isSafeInteger(value) || value < 0 || value > LOAN_MONEY_LIMIT_PENCE)) {
    return 'Enter valid non-negative amounts, with no more than two decimal places.';
  }
  if (!Number.isFinite(input.annualRatePercent) || input.annualRatePercent < 0 || input.annualRatePercent > 100) {
    return 'Enter an annual borrowing rate between 0% and 100%.';
  }
  if (input.balancePence > 0 && input.monthlyPaymentPence <= 0) return 'Enter a monthly repayment greater than zero.';
  if (!Number.isInteger(input.extraStartsAfterMonths) || input.extraStartsAfterMonths < 0
    || input.extraStartsAfterMonths >= LOAN_PROJECTION_LIMIT_MONTHS) return 'Enter a delay from 0 to 1,199 whole months.';
  return null;
}

/** Monthly estimate: nominal annual rate / 12, interest rounded to pence, then payment at month end. */
export function projectLoan(input: LoanScenario, targetMonths?: number): LoanProjection {
  const error = scenarioError(input);
  if (error) throw new Error(error);
  const lumpSumPence = Math.min(input.lumpSumPence, input.balancePence);
  let balance = input.balancePence - lumpSumPence;
  let regularPayment = input.monthlyPaymentPence;
  let recalculatePayment = lumpSumPence > 0;
  const result: LoanProjection = { status: 'repaid', months: [], interestPence: 0, repaidPence: lumpSumPence, lumpSumPence };
  for (let month = 1; balance > 0 && month <= LOAN_PROJECTION_LIMIT_MONTHS; month += 1) {
    if (targetMonths && recalculatePayment) {
      regularPayment = paymentForTerm(balance, input.annualRatePercent, Math.max(1, targetMonths - month + 1));
    }
    const interestPence = Math.round(balance * input.annualRatePercent / 1_200);
    if (!Number.isSafeInteger(balance + interestPence)) {
      result.status = 'limit-reached';
      return result;
    }
    const extra = month > input.extraStartsAfterMonths ? input.monthlyExtraPence : 0;
    const paymentPence = Math.min(balance + interestPence, regularPayment + extra);
    const principalPence = paymentPence - interestPence;
    balance -= principalPence;
    result.months.push({ month, interestPence, paymentPence, regularPaymentPence: Math.min(regularPayment, paymentPence), principalPence, balancePence: balance });
    result.interestPence += interestPence;
    result.repaidPence += paymentPence;
    recalculatePayment = extra > 0;
    if (principalPence <= 0 && month > input.extraStartsAfterMonths) {
      result.status = 'not-amortising';
      return result;
    }
  }
  if (balance > 0) result.status = 'limit-reached';
  return result;
}

export function compareLoan(input: LoanScenario) {
  const normal = projectLoan({ ...input, monthlyExtraPence: 0, lumpSumPence: 0, extraStartsAfterMonths: 0 });
  const targetMonths = input.repaymentMode === 'reduce-payment' && normal.status === 'repaid' ? normal.months.length : undefined;
  return {
    normal,
    overpaid: projectLoan(input, targetMonths),
  };
}

function paymentForTerm(balance: number, annualRate: number, months: number): number {
  const rate = annualRate / 1_200;
  if (rate === 0) return Math.ceil(balance / months);
  return Math.ceil(balance * rate / (1 - (1 + rate) ** -months));
}

export function termLabel(months: number): string {
  if (months === 0) return 'Paid off now';
  const years = Math.floor(months / 12);
  const remaining = months % 12;
  return [years ? `${years} ${years === 1 ? 'year' : 'years'}` : '', remaining ? `${remaining} ${remaining === 1 ? 'month' : 'months'}` : ''].filter(Boolean).join(' ');
}

/** Month-only arithmetic avoids UTC/local date shifts and end-of-month rollover. */
export function paymentMonth(firstMonth: string, offset: number): string {
  const [year, month] = firstMonth.split('-').map(Number);
  const index = year * 12 + month - 1 + offset;
  return new Date(Date.UTC(Math.floor(index / 12), index % 12, 1)).toLocaleDateString('en-GB', { month: 'short', year: 'numeric', timeZone: 'UTC' });
}
