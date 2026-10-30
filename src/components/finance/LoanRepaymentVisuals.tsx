import { useId, useState } from 'react';
import { formatGBP } from '../../services/financeHelpers';
import { paymentMonth, type LoanProjection } from '../../services/loanOverpayment';
import { repaymentBreakdown, repaymentPercent, type RepaymentBreakdown } from '../../services/loanRepaymentBreakdown';
import './LoanRepaymentVisuals.css';

interface Props {
  normal: LoanProjection;
  overpaid: LoanProjection;
  firstMonth: string;
  factor: number;
  openingBalancePence: number;
}

function PaymentSplit({ label, split, factor }: { label: string; split: RepaymentBreakdown; factor: number }) {
  const money = (value: number) => formatGBP(Math.round(value * factor));
  return <section className="loan-payment-split" aria-label={label}>
    <h5>{label}</h5>
    {split.status !== 'paying' ? <p>{split.status === 'paid-off' ? 'Paid off — no repayment or interest' : 'Projection unavailable for this month'}</p> : <>
      <p className="loan-payment-total">{money(split.paymentPence)} repayment</p>
      <div className="loan-split-bar" role="img" aria-label={`${repaymentPercent(split.capitalPercent)} capital, ${repaymentPercent(split.interestPercent)} interest`}>
        <span className="loan-capital-segment" style={{ width: `${Math.max(0, split.capitalPercent ?? 0)}%` }} />
        <span className="loan-interest-segment" style={{ width: `${Math.min(100, split.interestPercent ?? 0)}%` }} />
      </div>
      <dl>
        <div><dt><span className="loan-capital-dot" />Capital repaid</dt><dd>{money(split.capitalPence)} <span>({repaymentPercent(split.capitalPercent)})</span></dd></div>
        <div><dt><span className="loan-interest-dot" />Interest charged</dt><dd>{money(split.interestPence)} <span>({repaymentPercent(split.interestPercent)})</span></dd></div>
      </dl>
      {split.capitalPence < 0 && <p className="banking-negative">Interest exceeds the payment. The balance grows by {money(-split.capitalPence)}.</p>}
    </>}
  </section>;
}

function InterestChart({ normal, overpaid, mode, factor, selectedIndex }: Pick<Props, 'normal' | 'overpaid' | 'factor'> & {
  mode: 'amount' | 'ratio'; selectedIndex: number;
}) {
  const ratio = mode === 'ratio';
  const length = Math.max(1, normal.months.length, overpaid.months.length);
  const value = (projection: LoanProjection, index: number) => {
    const split = repaymentBreakdown(projection, index);
    if (split.status === 'unavailable' || ratio && split.status === 'paid-off') return null;
    return ratio ? split.interestPercent : split.interestPence * factor;
  };
  const values = [normal, overpaid].flatMap(projection => projection.months.map((_, index) => value(projection, index) ?? 0));
  const maximum = ratio ? Math.max(100, ...values) : Math.max(1, ...values);
  const x = (index: number) => 64 + index / Math.max(1, length - 1) * 516;
  const y = (amount: number) => 155 - amount / maximum * 120;
  const points = (projection: LoanProjection) => Array.from({ length }, (_, index) => {
    const amount = value(projection, index);
    return amount === null ? '' : `${x(index)},${y(amount)}`;
  }).filter(Boolean).join(' ');
  const title = ratio ? 'Interest share of each repayment (%)' : 'Monthly interest charged (£)';
  return <figure className="loan-interest-chart">
    <figcaption>{title}</figcaption>
    <div className="loan-interest-scale"><span>Top: {ratio ? `${Math.round(maximum)}%` : formatGBP(maximum)}</span><span>Bottom: {ratio ? '0%' : '£0'}</span></div>
    <svg viewBox="0 20 600 145" role="img" aria-label={title}>
      <title>{title}</title><desc>{ratio ? 'Interest divided by the actual monthly repayment, including overpayments. The line ends when repayments stop.' : 'Interest charged on each month’s opening balance. No interest is charged after payoff.'}</desc>
      <line x1="64" y1="155" x2="580" y2="155" stroke="#59627c" />
      <line x1="64" y1="35" x2="580" y2="35" stroke="#30364b" />
      <line x1={x(selectedIndex)} y1="30" x2={x(selectedIndex)} y2="155" stroke="#a8b6ff" strokeDasharray="3 4" />
      <polyline points={points(normal)} fill="none" stroke="#c1c7dc" strokeWidth="3" strokeDasharray="7 5" />
      <polyline points={points(overpaid)} fill="none" stroke="#76e4c3" strokeWidth="3" />
    </svg>
    <div className="loan-interest-scale"><span>Month 1</span><span>Month {length}</span></div>
    <div className="loan-interest-legend"><span>┄ Normal payments</span><span>━ With overpayments</span></div>
  </figure>;
}

export function LoanRepaymentVisuals({ normal, overpaid, firstMonth, factor, openingBalancePence }: Props) {
  const [month, setMonth] = useState(1);
  const sliderId = useId();
  const count = Math.max(1, normal.months.length, overpaid.months.length);
  const selected = Math.min(month, count);
  const index = selected - 1;
  const before = repaymentBreakdown(normal, index);
  const after = repaymentBreakdown(overpaid, index);
  const money = (amount: number) => formatGBP(Math.round(amount * factor));
  const opening = (projection: LoanProjection) => index === 0 ? openingBalancePence - projection.lumpSumPence
    : projection.months[index - 1]?.balancePence ?? (projection.status === 'repaid' ? 0 : null);
  const beforeBalance = opening(normal);
  const afterBalance = opening(overpaid);
  return <section className="loan-repayment-visuals" aria-label="Capital and interest comparison">
    <h4>Where your repayments go</h4>
    <p>Capital repaid reduces the loan balance. Interest is the cost charged on that balance. Percentages below show each part of the repayment, including any monthly extra.</p>
    <div className="loan-month-picker">
      <label htmlFor={sliderId}>Explore repayment month: {selected} of {count}</label>
      <input id={sliderId} type="range" min="1" max={count} value={selected} onChange={event => setMonth(Number(event.target.value))} />
      <output htmlFor={sliderId}>{paymentMonth(firstMonth, index)}</output>
    </div>
    <div className="loan-split-pair">
      <PaymentSplit label="Normal repayment split" split={before} factor={factor} />
      <PaymentSplit label="Overpayment repayment split" split={after} factor={factor} />
    </div>
    <div className="loan-accrual" aria-label="Monthly interest from the remaining balance" aria-live="polite">
      <strong>Interest charged on this month’s opening balance</strong>
      <dl>
        <div><dt>Normal payments</dt><dd>{beforeBalance === null || before.status === 'unavailable' ? 'Unavailable' : `${money(beforeBalance)} balance → ${money(before.interestPence)} interest`}</dd></div>
        <div><dt>With overpayments</dt><dd>{afterBalance === null || after.status === 'unavailable' ? 'Unavailable' : `${money(afterBalance)} balance → ${money(after.interestPence)} interest`}</dd></div>
      </dl>
      {before.status !== 'unavailable' && after.status !== 'unavailable' && <p>{money(before.interestPence - after.interestPence)} less interest this month{before.interestPence > 0 ? ` (${repaymentPercent((before.interestPence - after.interestPence) / before.interestPence * 100)} lower than normal)` : ''}.</p>}
    </div>
    <div className="loan-interest-charts">
      <InterestChart normal={normal} overpaid={overpaid} mode="amount" factor={factor} selectedIndex={index} />
      <InterestChart normal={normal} overpaid={overpaid} mode="ratio" factor={factor} selectedIndex={index} />
    </div>
    <p className="banking-muted">The percentage chart shows interest ÷ repayment, not the borrowing rate. After payoff there is no repayment ratio. One-off payments reduce capital before month one and are separate from these monthly splits. All amounts use the same monthly interest estimate as the schedule.</p>
  </section>;
}
