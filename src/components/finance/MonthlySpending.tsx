import { useState } from 'react';
import type { FinanceReview } from '../../types/domain';
import { formatGBP, toMonthStr } from '../../services/financeHelpers';
import { ExpenseGroups, type ExpenseGroupControls } from './ExpenseGroups';
import './MonthlySpending.css';

function monthLabel(value: string) {
  return new Date(`${value}-01T12:00:00Z`).toLocaleDateString('en-GB', { month: 'long', year: 'numeric', timeZone: 'UTC' });
}

export function MonthlySpending({ review, ...groupControls }: { review: FinanceReview } & ExpenseGroupControls) {
  const today = new Date();
  const thisMonth = toMonthStr(today);
  const lastMonth = toMonthStr(new Date(today.getFullYear(), today.getMonth() - 1, 1));
  const [selected, setSelected] = useState(thisMonth);
  const [query, setQuery] = useState('');
  const latestImported = review.months.map(item => item.month).sort().at(-1);
  const months = [...new Set([thisMonth, lastMonth, ...review.months.map(item => item.month)])].sort().reverse();
  const month = review.months.find(item => item.month === selected);
  const partial = selected > review.coverage.completeThrough.slice(0, 7);
  const categories = [...(month?.categories ?? [])].sort((a, b) => b.amountPence - a.amountPence);
  const visible = categories.filter(item => item.label.toLocaleLowerCase('en-GB').includes(query.trim().toLocaleLowerCase('en-GB')));
  const essentials = review.budget.essentials.reduce((sum, item) => sum + item.amountPence, 0);
  const available = review.budget.incomePence - essentials - review.budget.workCostsPence;
  const previousMonth = toMonthStr(new Date(Number(selected.slice(0, 4)), Number(selected.slice(5, 7)) - 2, 1));
  const previous = review.months.find(item => item.month === previousMonth);
  const comparable = !partial && previous && previous.month <= review.coverage.completeThrough.slice(0, 7);
  const change = month && comparable ? month.outflowPence - previous.outflowPence : null;

  return <section className="monthly-spending" aria-label="Monthly spending explorer">
    <div className="spending-heading">
      <div><span className="spending-eyebrow">YOUR MONEY, AT A GLANCE</span><h3>Where your money went</h3></div>
      <label className="spending-month-label">Review month
        <select value={selected} onChange={event => { setSelected(event.target.value); setQuery(''); }}>
          {months.map(value => <option key={value} value={value}>{monthLabel(value)}</option>)}
        </select>
      </label>
    </div>
    <div className="spending-periods" role="group" aria-label="Quick month selection">
      <button aria-pressed={selected === thisMonth} onClick={() => { setSelected(thisMonth); setQuery(''); }}>This month</button>
      <button aria-pressed={selected === lastMonth} onClick={() => { setSelected(lastMonth); setQuery(''); }}>Last month</button>
      {latestImported && latestImported !== thisMonth && latestImported !== lastMonth && <button
        aria-pressed={selected === latestImported} onClick={() => { setSelected(latestImported); setQuery(''); }}>
        Latest imported month
      </button>}
    </div>
    <p className="spending-budget-line">Usual salary left after essentials & work costs <strong>{formatGBP(available)} / month</strong><span>Planning estimate, before optional and irregular spending.</span></p>
    {!month ? <div className="spending-missing" role="status">
      <strong>{monthLabel(selected)} has not been imported yet.</strong>
      <p>Your saved bank history is complete through {monthLabel(review.coverage.completeThrough.slice(0, 7))}. A fresh bank review is needed for this month; missing spending is not £0.</p>
      <p>Select an imported month to explore its categories.</p>
    </div> : <>
      <div className="spending-month-title"><h4>{monthLabel(selected)}</h4><span className="banking-badge">{partial ? 'Partial month · totals so far' : 'Complete month'}</span></div>
      <div className="spending-summary">
        <article className="spending-stat spending-stat-primary"><span>Money out</span><strong>{formatGBP(month.outflowPence)}</strong>
          <small>{change === null ? partial ? 'Do not compare this with a full month.' : 'No complete previous month to compare.' : `${formatGBP(Math.abs(change))} ${change > 0 ? 'more' : change < 0 ? 'less' : 'change'} than ${monthLabel(previous!.month)}`}</small>
        </article>
        <article className="spending-stat"><span>Money in</span><strong>{formatGBP(month.incomePence)}</strong><small>Includes {formatGBP(month.salaryPence)} salary; other receipts may be one-offs.</small></article>
        <article className="spending-stat"><span>Net cash flow</span><strong className={month.netPence < 0 ? 'banking-negative' : ''}>{formatGBP(month.netPence)}</strong><small>Money in minus money out. This is not recurring savings.</small></article>
      </div>
      <section className="spending-breakdown" aria-label="Spending by category">
        <div className="spending-heading"><div><h4>Your expenses</h4><p>Largest payments first in each group. Refunds stay visible.</p></div>
          <label className="spending-search">Find a category<input type="search" value={query} onChange={event => setQuery(event.target.value)} placeholder="e.g. subscriptions" /></label>
        </div>
        {categories.length > 0 && <ExpenseGroups review={review} categories={categories} query={query} {...groupControls} />}
        {visible.length === 0 && <p role="status">{categories.length === 0 ? 'No category breakdown was supplied for this month.' : 'No categories match your search.'}</p>}
        <p className="banking-muted">These are cash payments, including commitments and debt repayments. Household contributions are counted once; transfers between your own personal accounts are excluded.</p>
      </section>
    </>}
  </section>;
}
