import { useId, useState } from 'react';
import type { FinanceReview, LoanOverpaymentProfile, LoanOverpaymentProfileLoan } from '../../types/domain';
import type { LoanProfileChange } from '../../services/backend/financeServiceApi';
import { formatGBP, toMonthStr } from '../../services/financeHelpers';
import {
  compareLoan, loanStartingValues, moneyInputPence, paymentMonth, scenarioError, termLabel,
  type LoanProjection, type LoanScenario, type ReviewLoan,
} from '../../services/loanOverpayment';
import './LoanOverpaymentCalculator.css';
import { LoanProfilePanel } from './LoanProfilePanel';
import { LoanRepaymentVisuals } from './LoanRepaymentVisuals';
import { repaymentBreakdown, repaymentPercent } from '../../services/loanRepaymentBreakdown';

interface LoanFields {
  balance: string;
  rate: string;
  payment: string;
  extra: string;
  lumpSum: string;
  delay: string;
  share: string;
  matchExtra: boolean;
  repaymentMode: 'shorten-term' | 'reduce-payment';
}

interface LoanCalculation {
  loan: ReviewLoan;
  fields: LoanFields;
  input: LoanScenario;
  error: string | null;
  comparison: ReturnType<typeof compareLoan> | null;
}

const pounds = (value?: number) => value === undefined ? '' : (value / 100).toFixed(2);

function initialFields(loan: ReviewLoan): LoanFields {
  const starting = loanStartingValues(loan);
  const share = loan.userSharePence !== undefined && loan.monthlyPaymentPence
    ? loan.userSharePence / loan.monthlyPaymentPence * 100 : 50;
  return {
    balance: pounds(starting.balancePence), rate: starting.annualRatePercent?.toString() ?? '',
    payment: pounds(loan.monthlyPaymentPence), extra: '0', lumpSum: '0', delay: '0',
    share: String(Math.round(share * 100) / 100), matchExtra: false, repaymentMode: 'shorten-term',
  };
}

function profileFields(loan: LoanOverpaymentProfileLoan): LoanFields {
  return {
    balance: pounds(loan.balancePence), rate: String(loan.annualRatePercent), payment: pounds(loan.monthlyPaymentPence),
    extra: pounds(loan.monthlyExtraPence), lumpSum: pounds(loan.lumpSumPence), delay: String(loan.extraStartsAfterMonths),
    share: String(loan.sharePercent), matchExtra: loan.matchExtra, repaymentMode: loan.repaymentMode,
  };
}

function calculate(loan: ReviewLoan, fields: LoanFields): LoanCalculation {
  const multiplier = fields.matchExtra ? 2 : 1;
  const input: LoanScenario = {
    balancePence: moneyInputPence(fields.balance) ?? NaN,
    annualRatePercent: fields.rate.trim() === '' ? NaN : Number(fields.rate),
    monthlyPaymentPence: moneyInputPence(fields.payment) ?? NaN,
    monthlyExtraPence: (moneyInputPence(fields.extra) ?? NaN) * multiplier,
    lumpSumPence: moneyInputPence(fields.lumpSum) ?? NaN,
    extraStartsAfterMonths: fields.delay.trim() === '' ? NaN : Number(fields.delay),
    repaymentMode: fields.repaymentMode,
  };
  const share = fields.share.trim() === '' ? NaN : Number(fields.share);
  let error = scenarioError(input) ?? (!Number.isFinite(share) || share < 0 || share > 100 ? 'Enter your payment share from 0% to 100%.' : null);
  const comparison = error ? null : compareLoan(input);
  if (fields.repaymentMode === 'reduce-payment' && comparison?.normal.status !== 'repaid' && !error) {
    error = 'The regular payment must repay the loan before an estimated end date can be kept. Increase it or choose “Keep payment, pay off sooner”.';
  }
  return { loan, fields, input, error, comparison: error ? null : comparison };
}

function Input({ label, value, onChange, step = '0.01', max, suffix }: {
  label: string; value: string; onChange: (value: string) => void; step?: string; max?: number; suffix?: string;
}) {
  const id = useId();
  return <div className="loan-input"><label htmlFor={id}>{label}</label><div>
    <input id={id} className="form-input" type="number" min="0" max={max} step={step} value={value}
      onChange={event => onChange(event.target.value)} inputMode={step === '1' ? 'numeric' : 'decimal'} />
    {suffix && <span>{suffix}</span>}
  </div></div>;
}

function payoff(projection: LoanProjection, firstMonth: string): string {
  if (projection.status === 'not-amortising') return 'Payment does not cover interest';
  if (projection.status === 'limit-reached') return 'Beyond 100-year estimate';
  return projection.months.length === 0 ? 'Paid off now' : paymentMonth(firstMonth, projection.months.length - 1);
}

function BalanceChart({ normal, overpaid, opening }: { normal: LoanProjection; overpaid: LoanProjection; opening: number }) {
  if (normal.status !== 'repaid' || overpaid.status !== 'repaid' || opening === 0) return null;
  const length = Math.max(1, normal.months.length, overpaid.months.length);
  const points = (projection: LoanProjection, start: number) => [{ month: 0, balancePence: start }, ...projection.months]
    .map(row => `${20 + row.month / length * 560},${140 - row.balancePence / opening * 120}`).join(' ');
  return <figure className="loan-chart">
    <svg viewBox="0 0 600 166" role="img" aria-label="Projected loan balance with and without overpayments">
      <title>Projected loan balance with and without overpayments</title>
      <line x1="20" y1="140" x2="580" y2="140" stroke="#59627c" />
      <polyline points={points(normal, opening)} fill="none" stroke="#b2b9d4" strokeWidth="3" strokeDasharray="7 5" />
      <polyline points={points(overpaid, opening - overpaid.lumpSumPence)} fill="none" stroke="#76e4c3" strokeWidth="3" />
      <text x="20" y="162">Now</text><text x="580" y="162" textAnchor="end">{termLabel(length)}</text>
    </svg>
    <figcaption><span>┄ Normal payments</span><span>━ With overpayments</span></figcaption>
  </figure>;
}

function Schedule({ calculation, firstMonth, factor }: { calculation: LoanCalculation; firstMonth: string; factor: number }) {
  const [year, setYear] = useState('1');
  const id = useId();
  if (!calculation.comparison) return null;
  const { normal, overpaid } = calculation.comparison;
  const count = Math.max(normal.months.length, overpaid.months.length);
  const years = Math.max(1, Math.ceil(count / 12));
  const selectedYear = Math.min(Number(year), years);
  const from = (selectedYear - 1) * 12;
  const money = (amount: number) => formatGBP(Math.round(amount * factor));
  return <details className="loan-schedule"><summary>Monthly interest, repayments & balances</summary>
    <label htmlFor={id}>Schedule year</label>{' '}
    <select id={id} className="form-select" value={selectedYear} onChange={event => setYear(event.target.value)}>
      {Array.from({ length: years }, (_, index) => <option key={index} value={index + 1}>Year {index + 1}</option>)}
    </select>
    <div className="banking-table-wrap" tabIndex={0} role="region" aria-label={`${calculation.loan.lender} monthly schedule`}>
      <table><caption>Normal payments compared with your scenario</caption>
        <thead><tr><th>Month</th><th>Normal interest</th><th>Normal interest share</th><th>Scenario interest</th><th>Scenario interest share</th><th>Scenario regular payment</th><th>Scenario payment incl. extra</th><th>Capital repaid</th><th>Normal balance</th><th>Scenario balance</th></tr></thead>
        <tbody>{Array.from({ length: Math.min(12, count - from) }, (_, index) => {
          const offset = from + index;
          const before = normal.months[offset];
          const after = overpaid.months[offset];
          const value = (projection: LoanProjection, amount?: number) => amount !== undefined ? money(amount) : projection.status === 'repaid' ? money(0) : 'Unavailable';
          return <tr key={offset}><th scope="row">{paymentMonth(firstMonth, offset)}</th>
            <td>{value(normal, before?.interestPence)}</td><td>{repaymentPercent(repaymentBreakdown(normal, offset).interestPercent)}</td>
            <td>{value(overpaid, after?.interestPence)}</td><td>{repaymentPercent(repaymentBreakdown(overpaid, offset).interestPercent)}</td>
            <td>{value(overpaid, after?.regularPaymentPence)}</td><td>{value(overpaid, after?.paymentPence)}</td><td>{value(overpaid, after?.principalPence)}</td>
            <td>{value(normal, before?.balancePence)}</td><td>{value(overpaid, after?.balancePence)}</td></tr>;
        })}</tbody>
      </table>
    </div>
    <p className="banking-muted">The one-off payment is applied before month one and is separate from the monthly payments above. Payments stop at payoff; surplus is not transferred to the other loan.</p>
  </details>;
}

function LoanResults({ calculation, firstMonth, factor }: { calculation: LoanCalculation; firstMonth: string; factor: number }) {
  if (!calculation.comparison) return null;
  const { normal, overpaid } = calculation.comparison;
  const complete = normal.status === 'repaid' && overpaid.status === 'repaid';
  const money = (amount: number) => formatGBP(Math.round(amount * factor));
  const balanceAfterYear = (projection: LoanProjection) => projection.months[11]?.balancePence ?? (projection.status === 'repaid' ? 0 : undefined);
  const normalYearBalance = balanceAfterYear(normal);
  const extraYearBalance = balanceAfterYear(overpaid);
  return <div className="loan-results" aria-label={`${calculation.loan.lender} results`}>
    <div className="loan-result-head"><span>Estimate</span><strong>Normal payments</strong><strong>With overpayments</strong></div>
    <div><span>Paid off</span><strong>{payoff(normal, firstMonth)}</strong><strong>{payoff(overpaid, firstMonth)}</strong></div>
    <div><span>Time remaining</span><span>{normal.status === 'repaid' ? termLabel(normal.months.length) : 'Unavailable'}</span><span>{overpaid.status === 'repaid' ? termLabel(overpaid.months.length) : 'Unavailable'}</span></div>
    <div><span>Total interest</span><span>{normal.status === 'repaid' ? money(normal.interestPence) : 'Unavailable'}</span><span>{overpaid.status === 'repaid' ? money(overpaid.interestPence) : 'Unavailable'}</span></div>
    <div><span>Total repaid</span><span>{normal.status === 'repaid' ? money(normal.repaidPence) : 'Unavailable'}</span><span>{overpaid.status === 'repaid' ? money(overpaid.repaidPence) : 'Unavailable'}</span></div>
    <div><span>First month’s interest</span><span>{money(normal.months[0]?.interestPence ?? 0)}</span><span>{money(overpaid.months[0]?.interestPence ?? 0)}</span></div>
    <div><span>Month two regular payment</span><span>{money(normal.months[1]?.regularPaymentPence ?? 0)}</span><span>{money(overpaid.months[1]?.regularPaymentPence ?? 0)}</span></div>
    <div><span>Balance after 12 months</span><span>{normalYearBalance === undefined ? 'Unavailable' : money(normalYearBalance)}</span><span>{extraYearBalance === undefined ? 'Unavailable' : money(extraYearBalance)}</span></div>
    {complete && <p className="loan-saving" role="status">{normal.months.length - overpaid.months.length > 0 ? `${termLabel(normal.months.length - overpaid.months.length)} sooner · ` : ''}{money(normal.interestPence - overpaid.interestPence)} interest saved</p>}
    {overpaid.status !== 'repaid' && <p className="banking-error" role="status">{overpaid.status === 'not-amortising' ? 'This payment does not reduce the balance. Increase the monthly payment or adjust the rate.' : 'This loan is not repaid within the 100-year calculation limit.'}</p>}
    <BalanceChart normal={normal} overpaid={overpaid} opening={calculation.input.balancePence} />
    <LoanRepaymentVisuals normal={normal} overpaid={overpaid} firstMonth={firstMonth} factor={factor} openingBalancePence={calculation.input.balancePence} />
    <Schedule calculation={calculation} firstMonth={firstMonth} factor={factor} />
  </div>;
}

function LoanEditor({ calculation, review, update, firstMonth, shareView, profileBalanceDate, fromProfile }: {
  calculation: LoanCalculation; review: FinanceReview; update: (fields: Partial<LoanFields>) => void; firstMonth: string | null; shareView: boolean;
  profileBalanceDate?: string; fromProfile: boolean;
}) {
  const { loan, fields, error, input } = calculation;
  const starting = loanStartingValues(loan);
  const factor = shareView ? Number(fields.share) / 100 : 1;
  const sourceDates = review.sources.filter(source => loan.sourceIds.includes(source.id)).map(source => source.asOf).sort();
  const balanceDate = loan.balanceAsOf ?? (starting.balanceFromNote ? sourceDates.at(-1) : undefined);
  return <article className="banking-card loan-calculator-card" aria-label={`${loan.lender} overpayment calculator`}>
    <h4>{loan.lender}</h4>
    <p className="banking-muted">{fromProfile ? `Saved profile starting figures${profileBalanceDate ? ` · capital source dated ${profileBalanceDate}` : ' · capital source date unavailable'}.`
      : starting.balancePence === undefined ? 'Opening balance needs confirmation.' : `${starting.balanceFromNote ? 'Capital balance from saved loan note' : loan.balanceKind === 'estimate' ? 'Estimated opening balance' : 'Reported capital balance'}${balanceDate ? ` · source dated ${balanceDate}` : ''}.`} These are editable scenario assumptions, not today’s lender balance.</p>
    <div className="loan-inputs">
      <Input label="Opening balance (£)" value={fields.balance} onChange={balance => update({ balance })} />
      <Input label="Annual borrowing rate (%)" value={fields.rate} onChange={rate => update({ rate })} max={100} />
      <Input label="Regular joint payment (£/month)" value={fields.payment} onChange={payment => update({ payment })} />
      <Input label="Extra payment (£/month)" value={fields.extra} onChange={extra => update({ extra })} />
      <Input label="One-off joint overpayment (£)" value={fields.lumpSum} onChange={lumpSum => update({ lumpSum })} />
      <Input label="Start monthly extras after (months)" value={fields.delay} onChange={delay => update({ delay })} step="1" max={1199} />
      <Input label="Your payment share (%)" value={fields.share} onChange={share => update({ share })} max={100} />
      <label className="loan-mode">Overpayment effect<select className="form-select" aria-label="Overpayment effect" value={fields.repaymentMode} onChange={event => update({ repaymentMode: event.target.value as LoanFields['repaymentMode'] })}>
        <option value="shorten-term">Keep payment, pay off sooner</option><option value="reduce-payment">Reduce payment, keep estimated end date</option>
      </select></label>
    </div>
    <label className="loan-match"><input type="checkbox" checked={fields.matchExtra} onChange={event => update({ matchExtra: event.target.checked })} /> The other borrower matches the monthly extra I entered</label>
    <p className="banking-muted">{fields.matchExtra ? 'Two equal extra contributions.' : 'Extra is the total additional amount sent to the lender.'} {Number.isFinite(input.monthlyExtraPence) && <>Total extra: {formatGBP(input.monthlyExtraPence)} / month.</>} {loan.userSharePence === undefined && 'Your 50% starting share is an assumption; adjust it above.'}</p>
    {error ? <p className="banking-error" role="status">{error} Complete the opening balance, borrowing rate and regular payment to see the comparison.</p>
      : firstMonth && <LoanResults calculation={calculation} firstMonth={firstMonth} factor={factor} />}
    <details><summary>Saved loan terms & calculation assumptions</summary>
      <p>{loan.rateNote || 'No borrowing rate has been confirmed.'}</p>
      {starting.annualRatePercent !== undefined && !fromProfile && <p>The initial rate is read from the fixed rate in this saved note. It stays constant for the entire estimate, including after the fixed period. Edit it to try another rate.</p>}
      {starting.balanceFromNote && <p>The opening capital is taken from the explicitly named current-balance line in the saved redemption note. The redemption total includes other charges and is excluded.</p>}
      <p>Interest is estimated monthly at the annual borrowing rate divided by 12. Your lenders may calculate daily. Choose to keep the regular payment for an earlier payoff, or recalculate it after each overpayment over the remaining modelled term. The latter uses the normal-payment estimate’s end date, not a confirmed contractual term. Lender recalculation rules and timing can differ. This does not amend your contractual term or Direct Debit.</p>
      <p>Fees, early repayment charges, allowance usage and future rate changes are excluded. Confirm your own allowance and how overpayments are applied in the saved agreement or with the lender.</p>
      <p>{loan.notes}</p>
    </details>
  </article>;
}

export function LoanOverpaymentCalculator({ review, changeProfile, profilesWritable = false, savingProfile = false }: {
  review: FinanceReview; changeProfile?: (change: LoanProfileChange) => Promise<void>; profilesWritable?: boolean; savingProfile?: boolean;
}) {
  const [initialProfile] = useState(() => review.loanProfiles?.find(profile => profile.isDefault));
  const [edits, setEdits] = useState<Record<string, LoanFields>>(() => Object.fromEntries(initialProfile?.loans.map(loan => [loan.loanId, profileFields(loan)]) ?? []));
  const [selection, setSelection] = useState(initialProfile?.selectedLoanId ?? 'both');
  const [shareView, setShareView] = useState(initialProfile?.showShare ?? false);
  const [firstMonth, setFirstMonth] = useState(() => initialProfile?.firstPaymentMonth ?? toMonthStr(new Date()));
  const [profileBasis, setProfileBasis] = useState(initialProfile?.reviewAsOf ?? '');
  const [profileLoanIds, setProfileLoanIds] = useState(() => initialProfile?.loans.map(loan => loan.loanId) ?? []);
  const [savedBalanceDates, setSavedBalanceDates] = useState<Record<string, string | undefined>>(() => Object.fromEntries(initialProfile?.loans.map(loan => [loan.loanId, loan.balanceAsOf]) ?? []));
  const monthId = useId();
  const loans = review.loans.filter(loan => loan.status === 'active' && /\b(?:selina|natwest)\b/iu.test(loan.lender));
  const missingProfileLoans = profileLoanIds.filter(loanId => !loans.some(current => current.id === loanId));
  const calculations = loans.filter(loan => selection === 'both' || selection === loan.id)
    .map(loan => calculate(loan, edits[loan.id] ?? initialFields(loan)));
  const validMonth = /^(?:20|21)\d{2}-(?:0[1-9]|1[0-2])$/u.test(firstMonth);
  const complete = calculations.length > 0 && calculations.every(item => item.comparison !== null) && validMonth && missingProfileLoans.length === 0;
  const totals = (value: (item: LoanCalculation) => number) => calculations.reduce((sum, item) => sum + Math.round(value(item) * (shareView ? Number(item.fields.share) / 100 : 1)), 0);
  const totalMonthly = totals(item => item.input.monthlyPaymentPence);
  const extraMonthly = totals(item => item.input.monthlyExtraPence);
  const canCompare = complete && calculations.every(item => item.comparison?.normal.status === 'repaid' && item.comparison?.overpaid.status === 'repaid');
  const payoffMonth = canCompare ? Math.max(...calculations.map(item => item.comparison!.overpaid.months.length)) : 0;
  const normalPayoffMonth = canCompare ? Math.max(...calculations.map(item => item.comparison!.normal.months.length)) : 0;
  const loadProfile = (profile: LoanOverpaymentProfile) => {
    if (profile.loans.some(loan => !loans.some(current => current.id === loan.loanId))) throw new Error('A loan in this saved profile is no longer active or available. Review your current loan records before loading it.');
    setEdits(Object.fromEntries(profile.loans.map(loan => [loan.loanId, profileFields(loan)])));
    setSelection(profile.selectedLoanId ?? 'both'); setShareView(profile.showShare); setFirstMonth(profile.firstPaymentMonth);
    setProfileBasis(profile.reviewAsOf);
    setProfileLoanIds(profile.loans.map(loan => loan.loanId));
    setSavedBalanceDates(Object.fromEntries(profile.loans.map(loan => [loan.loanId, loan.balanceAsOf])));
  };
  const makeProfile = (id: string, name: string, isDefault: boolean): LoanOverpaymentProfile => {
    if (!validMonth) throw new Error('Choose a valid first payment month before saving.');
    const savedLoans = loans.map(loan => calculate(loan, edits[loan.id] ?? initialFields(loan)));
    if (savedLoans.some(item => item.error)) throw new Error('Complete valid inputs for both loans before saving a profile.');
    return {
      id, name, isDefault, firstPaymentMonth: firstMonth, selectedLoanId: selection === 'both' ? undefined : selection,
      showShare: shareView, reviewAsOf: profileBasis || review.asOf,
      loans: savedLoans.map(item => ({
        loanId: item.loan.id, balancePence: item.input.balancePence, annualRatePercent: item.input.annualRatePercent,
        monthlyPaymentPence: item.input.monthlyPaymentPence, monthlyExtraPence: moneyInputPence(item.fields.extra)!,
        lumpSumPence: item.input.lumpSumPence, extraStartsAfterMonths: item.input.extraStartsAfterMonths,
        sharePercent: Number(item.fields.share), matchExtra: item.fields.matchExtra, repaymentMode: item.fields.repaymentMode,
        balanceAsOf: savedBalanceDates[item.loan.id] ?? item.loan.balanceAsOf ?? review.sources.filter(source => item.loan.sourceIds.includes(source.id)).map(source => source.asOf).sort().at(-1),
      })),
    };
  };
  return <section className="loan-overpayment banking-block" aria-label="Loan overpayment calculator">
    <h3>Loan overpayment calculator</h3>
    <p className="banking-muted">Compare Selina and NatWest separately or together. Adjust the dated starting figures and see what an extra payment could change. Estimates hold your entered rates constant; future rate changes and fees are excluded.</p>
    {loans.length === 0 ? <p>No active Selina or NatWest loan is recorded. Add verified loan details through the Finance review before calculating.</p> : <>
      <LoanProfilePanel profiles={review.loanProfiles ?? []} writable={profilesWritable} saving={savingProfile} changeProfile={changeProfile} makeProfile={makeProfile} loadProfile={loadProfile} newProfile={() => setProfileLoanIds([])} />
      {profileBasis && <p className="banking-muted">Loaded profile assumptions from the review dated {profileBasis}. Saved balances and rates are editable scenario values; current lender terms may differ.</p>}
      {missingProfileLoans.length > 0 && <p className="banking-error" role="alert">A loan in your default profile is no longer active or available. Check the saved profile and current loan records before comparing.</p>}
      <fieldset className="loan-scenario-fields" disabled={savingProfile}>
      <div className="loan-toolbar">
        <label>Loans<select className="form-select" aria-label="Loans" value={selection} onChange={event => setSelection(event.target.value)}>
          <option value="both">Both loans</option>{loans.map(loan => <option key={loan.id} value={loan.id}>{loan.lender}</option>)}
        </select></label>
        <label>Show amounts as<select className="form-select" aria-label="Show amounts as" value={shareView ? 'share' : 'joint'} onChange={event => setShareView(event.target.value === 'share')}>
          <option value="joint">Full joint amount</option><option value="share">Your payment share</option>
        </select></label>
        <label htmlFor={monthId}>First projected payment<input id={monthId} className="form-input" type="month" min="2000-01" max="2199-12" value={firstMonth} onChange={event => setFirstMonth(event.target.value)} /></label>
      </div>
      <p className="banking-muted">Inputs are whole-loan amounts. The share view splits the results for budgeting; it does not change the loan, liability or payoff date. Balances are not automatically rolled forward from their source dates.</p>
      {!validMonth && <p role="status" className="banking-error">Choose a first payment month between January 2000 and December 2199.</p>}
      <div className="loan-overview" aria-label="Selected loan totals">
        <div><span>{shareView ? 'Your allocated balance' : 'Opening balance'}</span><strong>{complete ? formatGBP(totals(item => item.input.balancePence)) : 'Complete loan inputs'}</strong></div>
        <div><span>{shareView ? 'Your regular payment' : 'Regular joint payment'}</span><strong>{complete ? `${formatGBP(totalMonthly)} / month` : 'Unavailable'}</strong></div>
        <div><span>Monthly budget including extras</span><strong>{complete ? `${formatGBP(totalMonthly + extraMonthly)} / month` : 'Unavailable'}</strong><small>Before payment reductions or any loan pays off</small></div>
        <div><span>Estimated interest saved</span><strong>{canCompare ? formatGBP(totals(item => item.comparison!.normal.interestPence - item.comparison!.overpaid.interestPence)) : 'Unavailable'}</strong></div>
        <div><span>All selected loans paid off</span><strong>{canCompare ? payoffMonth === 0 ? 'Paid off now' : paymentMonth(firstMonth, payoffMonth - 1) : 'Unavailable'}</strong><small>{canCompare && (normalPayoffMonth > payoffMonth ? `${termLabel(normalPayoffMonth - payoffMonth)} sooner` : 'No change in duration')}</small></div>
      </div>
      <div className="loan-editors">{calculations.map(calculation => <LoanEditor key={calculation.loan.id} calculation={calculation} review={review}
        fromProfile={Object.hasOwn(savedBalanceDates, calculation.loan.id)} profileBalanceDate={savedBalanceDates[calculation.loan.id]}
        firstMonth={validMonth ? firstMonth : null} shareView={shareView}
        update={fields => setEdits(current => ({ ...current, [calculation.loan.id]: { ...(current[calculation.loan.id] ?? initialFields(calculation.loan)), ...fields } }))} />)}</div>
      </fieldset>
    </>}
  </section>;
}
