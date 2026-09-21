import type { FinanceReview } from '../../types/domain';
import { formatGBP } from '../../services/financeHelpers';
import { useFinanceReview } from '../../store/contexts/useFinanceReview';
import './BankingReview.css';

type View = 'overview' | 'spending' | 'loans';
type Loan = FinanceReview['loans'][number];

function date(value?: string) {
  if (!value) return 'Not confirmed';
  const parsed = new Date(`${value.slice(0, 10)}${value.length === 7 ? '-01' : ''}T12:00:00Z`);
  return Number.isNaN(parsed.getTime()) ? value : parsed.toLocaleDateString('en-GB', {
    ...(value.length === 7 ? {} : { day: 'numeric' as const }), month: 'short', year: 'numeric', timeZone: 'UTC',
  });
}

function Sources({ sources }: { sources: FinanceReview['sources'] }) {
  if (sources.length === 0) return null;
  return <ul className="banking-sources">{sources.map(source => <li key={source.id}>
    <a href={/^https?:\/\//u.test(source.url) ? source.url : undefined} target="_blank" rel="noopener noreferrer">{source.label}</a>
    <span>Reviewed {date(source.asOf)}</span>
  </li>)}</ul>;
}

function Budget({ review }: { review: FinanceReview }) {
  const { budget } = review;
  const essentials = budget.essentials.reduce((sum, item) => sum + item.amountPence, 0);
  const available = budget.incomePence - essentials - budget.workCostsPence;
  return <>
    <div className="banking-budget">
      <section className="banking-card banking-available" aria-label="Monthly available amount">
        <h3>Left after essentials & work costs</h3>
        <div className={`banking-amount ${available < 0 ? 'banking-negative' : ''}`}>{formatGBP(available)}<span> / month</span></div>
        <p>Before discretionary spending and irregular costs.</p>
        <p className="banking-muted">{budget.incomeBasis}</p>
        {budget.scenarios.map((scenario, index) => <div className="banking-scenario" key={`${scenario.label}-${index}`}>
          <span className="banking-badge">{scenario.status === 'planned' ? 'Planned scenario' : 'Confirmed scenario'}</span>
          <strong>{scenario.label}: {formatGBP(available - scenario.monthlyAdjustmentPence)} / month</strong>
          <p>{scenario.note}</p>
        </div>)}
      </section>
      <section className="banking-card" aria-label="Monthly budget calculation">
        <h3>Monthly calculation</h3>
        <dl className="banking-figures">
          <div><dt>Usual salary</dt><dd>{formatGBP(budget.incomePence)}</dd></div>
          <div><dt>Essential expenses</dt><dd>{formatGBP(essentials)}</dd></div>
          <div><dt>Work costs</dt><dd>{formatGBP(budget.workCostsPence)}</dd></div>
          <div className="banking-total"><dt>Available before discretionary spending</dt><dd>{formatGBP(available)}</dd></div>
        </dl>
        <details><summary>Essential expenses & assumptions</summary>
          <dl className="banking-figures banking-essential-list">{budget.essentials.map((item, index) => <div key={`${item.label}-${index}`}>
            <dt>{item.label}{item.note && <small>{item.note}</small>}</dt><dd>{formatGBP(item.amountPence)}</dd>
          </div>)}</dl>
          <p>{budget.workCostsNote}</p>
        </details>
      </section>
    </div>
    {review.notes.length > 0 && <details className="banking-notes"><summary>Budget notes & items to confirm</summary>
      <ul>{review.notes.map((note, index) => <li key={index}>{note}</li>)}</ul>
    </details>}
  </>;
}

function Spending({ review }: { review: FinanceReview }) {
  const months = [...review.months].sort((a, b) => b.month.localeCompare(a.month));
  return <>
    <Budget review={review} />
    <section className="banking-block" aria-label="High-value spending">
      <h3>High-value spending to review</h3>
      <div className="banking-grid">{review.opportunities.map((item, index) => <article className="banking-card" key={`${item.label}-${index}`}>
        <h4>{item.label}</h4><div className="banking-amount banking-amount-small">{formatGBP(item.monthlyPence)}<span> / month</span></div>
        <p>{item.note}</p>
        {item.suggestedCapPence !== undefined && <p className="banking-cap">Illustrative cap: {formatGBP(item.suggestedCapPence)} / month</p>}
      </article>)}</div>
      {review.opportunities.length === 0 && <p>No spending opportunities recorded yet.</p>}
    </section>
    <section className="banking-block" aria-label="Monthly cash flow">
      <h3>Monthly cash flow</h3>
      <p className="banking-muted">Money in includes receipts beyond salary. Cash flow is separate from the usual monthly budget above.</p>
      <div className="banking-table-wrap" tabIndex={0} role="region" aria-label="Scrollable monthly cash flow"><table aria-label="Monthly bank cash flow">
        <thead><tr><th>Month</th><th>Money in</th><th>Salary included</th><th>Money out</th><th>Net cash flow</th></tr></thead>
        <tbody>{months.map(month => <tr key={month.month}>
          <th scope="row">{date(month.month)}{month.month > review.coverage.completeThrough.slice(0, 7) && <small>Partial month</small>}</th>
          <td>{formatGBP(month.incomePence)}</td><td>{formatGBP(month.salaryPence)}</td>
          <td>{formatGBP(month.outflowPence)}{month.categories.length > 0 && <details><summary>Categories</summary><dl className="banking-categories">
            {month.categories.map((category, index) => <div key={`${category.label}-${index}`}><dt>{category.label}</dt><dd>{formatGBP(category.amountPence)}</dd></div>)}
          </dl></details>}</td>
          <td className={month.netPence < 0 ? 'banking-negative' : ''}>{formatGBP(month.netPence)}</td>
        </tr>)}</tbody>
      </table></div>
    </section>
    <section className="banking-block" aria-label="Bank balance snapshots">
      <h3>Bank balance snapshots</h3>
      <p className="banking-muted">Personal and household balances are shown separately. These snapshots do not add to the manually tracked account net worth.</p>
      <div className="banking-grid">{review.accounts.map(account => <article className="banking-card" key={account.id}>
        <h4>{account.label}</h4><span className="banking-badge">{account.ownership === 'household' ? 'Household' : 'Personal'}</span>
        <div className={`banking-amount banking-amount-small ${account.balancePence < 0 ? 'banking-negative' : ''}`}>{formatGBP(account.balancePence)}</div>
        <p className="banking-muted">As of {date(account.asOf)}</p>
      </article>)}</div>
    </section>
    <details className="banking-notes"><summary>Sources & verification</summary><Sources sources={review.sources} /></details>
  </>;
}

function LoanCard({ loan, sources }: { loan: Loan; sources: FinanceReview['sources'] }) {
  const balanceLabel = loan.balanceKind === 'settlement' ? 'Settlement quote'
    : loan.balanceKind === 'estimate' ? 'Estimated balance' : loan.balanceKind === 'statement' ? 'Reported balance' : 'Balance';
  const knownBalance = loan.balanceKind !== 'unknown' && loan.balancePence !== undefined;
  return <article className="banking-card banking-loan" aria-label={`${loan.lender} loan`}>
    <div className="banking-loan-heading"><h4>{loan.lender}</h4><span className="banking-badge">{loan.status === 'active' ? 'Active' : loan.status === 'repaid' ? 'Repaid' : 'Closed'}</span></div>
    <p>{loan.purpose}</p>
    <dl className="banking-figures">
      <div><dt>{balanceLabel}</dt><dd>{knownBalance ? formatGBP(loan.balancePence!) : 'Not confirmed'}</dd></div>
      {loan.balanceAsOf && <div><dt>{loan.balanceKind === 'settlement' ? 'Quote dated' : 'Balance dated'}</dt><dd>{date(loan.balanceAsOf)}</dd></div>}
      {loan.settlementPence !== undefined && <div><dt>Settlement quote<small>Dated {date(loan.settlementAsOf)}</small></dt><dd>{formatGBP(loan.settlementPence)}</dd></div>}
      <div><dt>{loan.status === 'active' ? 'Monthly payment' : 'Previous monthly payment'}</dt><dd>{loan.monthlyPaymentPence === undefined ? 'Not confirmed' : formatGBP(loan.monthlyPaymentPence)}</dd></div>
      {loan.userSharePence !== undefined && <div><dt>Your monthly share</dt><dd>{formatGBP(loan.userSharePence)}</dd></div>}
      {loan.nextPaymentDate && <div><dt>Next payment</dt><dd>{date(loan.nextPaymentDate)}</dd></div>}
      {loan.paymentsRemaining !== undefined && <div><dt>Payments remaining</dt><dd>{loan.paymentsRemaining}</dd></div>}
      {loan.originalPrincipalPence !== undefined && <div><dt>Original borrowing</dt><dd>{formatGBP(loan.originalPrincipalPence)}</dd></div>}
      <div><dt>APR</dt><dd>{loan.aprPercent === undefined ? 'Not confirmed' : `${loan.aprPercent}%`}</dd></div>
      {loan.startDate && <div><dt>Started</dt><dd>{date(loan.startDate)}</dd></div>}
      <div><dt>{loan.status === 'active' ? 'End date' : 'Closed / repaid date'}</dt><dd>{date(loan.endDate)}</dd></div>
    </dl>
    {loan.rateNote && <p>{loan.rateNote}</p>}
    {loan.notes && <p className="banking-prose">{loan.notes}</p>}
    <Sources sources={sources.filter(source => loan.sourceIds.includes(source.id))} />
  </article>;
}

function Loans({ review }: { review: FinanceReview }) {
  const active = review.loans.filter(loan => loan.status === 'active');
  const history = review.loans.filter(loan => loan.status !== 'active');
  return <>
    <p className="banking-muted">Dated loan records. Reported balances and settlement quotes are snapshots; missing amounts remain unconfirmed.</p>
    <section className="banking-block" aria-label="Active loans"><h3>Active loans</h3>
      <div className="banking-grid">{active.map(loan => <LoanCard key={loan.id} loan={loan} sources={review.sources} />)}</div>
      {active.length === 0 && <p>No active loans recorded.</p>}
    </section>
    {history.length > 0 && <section className="banking-block" aria-label="Closed and repaid loans"><h3>Closed & repaid</h3>
      <div className="banking-grid">{history.map(loan => <LoanCard key={loan.id} loan={loan} sources={review.sources} />)}</div>
    </section>}
  </>;
}

export function BankingReview({ view = 'overview' }: { view?: View }) {
  const { review, loaded, error, refresh } = useFinanceReview();
  return <section className="banking-review" aria-label="Banking review">
    <h2>{view === 'loans' ? 'Loans' : view === 'spending' ? 'Spending review' : 'Your monthly budget'}</h2>
    {error && <div className="banking-error" role="alert">{error} <button className="btn btn-sm" onClick={() => void refresh()}>Retry loading</button></div>}
    {!loaded ? <p role="status">Loading banking review…</p> : !review && !error ? <p>No banking review recorded yet.</p> : null}
    {review && <>
      <p className="banking-muted">Snapshot as of {date(review.asOf)} · Read-only bank connection · No automatic refresh</p>
      <p className="banking-coverage">{date(review.coverage.from)} – {date(review.coverage.to)} · {review.coverage.transactionCount.toLocaleString('en-GB')} transactions · {review.coverage.accountCount} accounts<br />{review.coverage.note}</p>
      {view === 'overview' ? <Budget review={review} /> : view === 'spending' ? <Spending review={review} /> : <Loans review={review} />}
    </>}
  </section>;
}
