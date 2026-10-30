import { useState } from 'react';
import type { FinanceReview, FinanceReviewTransaction } from '../../types/domain';
import { formatGBP } from '../../services/financeHelpers';
import { spendingTransactions, transactionMatches } from '../../services/spendingTransactions';
import './SpendingTransactions.css';

function Payment({ item, review }: { item: FinanceReviewTransaction; review: FinanceReview }) {
  const account = review.accounts.find(account => account.id === item.accountId);
  const date = item.date ? new Date(`${item.date}T12:00:00Z`).toLocaleDateString('en-GB', { day: 'numeric', month: 'short', year: 'numeric', timeZone: 'UTC' }) : `${item.month} · payment date not supplied`;
  const sources = review.sources.filter(source => item.sourceIds?.includes(source.id));
  return <li className="spending-payment">
    <div className="spending-payment-title"><strong>{item.merchant}</strong><strong>{formatGBP(item.amountPence)}</strong></div>
    <p>{item.detail || 'Purpose not confirmed beyond the bank description.'}</p>
    <small>{date} · {account?.label} · {item.origin === 'user' ? 'Confirmed by you' : 'Booked bank payment'}{item.amountPence < 0 ? ' · Refund / credit' : ''}</small>
    <span className="banking-badge">{item.recurrence === 'one-off' ? 'One-off' : item.recurrence === 'recurring' ? 'Recurring' : 'Recurrence unconfirmed'}</span>
    <small>Bank description: {item.description || 'Not supplied'}</small>
    {sources.length > 0 && <div className="spending-payment-sources">{sources.map(source => <a key={source.id} href={source.url} target="_blank" rel="noreferrer">{source.label}</a>)}</div>}
  </li>;
}

export function CategoryPayments({ review, month, category }: { review: FinanceReview; month: string; category: string }) {
  const items = spendingTransactions(review, month, category);
  if (!items.length) return null;
  const merchants = [...new Set(items.map(item => item.merchant))];
  return <details className="category-payments"><summary>{items.length} {items.length === 1 ? 'payment' : 'payments'} · {merchants.slice(0, 3).join(', ')}{merchants.length > 3 ? ` +${merchants.length - 3} more` : ''}</summary>
    <ul>{items.map(item => <Payment key={item.id} item={item} review={review} />)}</ul>
  </details>;
}

export function SpendingTransactions({ review, month }: { review: FinanceReview; month: string }) {
  const [query, setQuery] = useState('');
  const items = spendingTransactions(review, month);
  const visible = items.filter(item => transactionMatches(item, query));
  const total = items.reduce((sum, item) => sum + item.amountPence, 0);
  const expected = review.months.find(item => item.month === month)?.outflowPence;
  return <section className="spending-transactions" aria-label="Itemised transactions">
    <div className="spending-heading"><div><h4>Itemised transactions</h4><p>What you paid for, when, and the evidence behind it.</p></div>
      <label>Find a payment<input type="search" value={query} onChange={event => setQuery(event.target.value)} placeholder="Merchant, purpose or date" /></label>
    </div>
    {items.length === 0 ? <p>Payment details haven’t been imported for this month. The categories above are saved totals.</p> : <>
      <p>{items.length} payments · {formatGBP(total)} net spending{expected !== total ? ` · Details cover part of the saved ${formatGBP(expected ?? 0)} total.` : ' · Matches the monthly spending total.'}</p>
      <ul>{visible.map(item => <Payment key={item.id} item={item} review={review} />)}</ul>
      {visible.length === 0 && <p role="status">No payments match your search.</p>}
    </>}
  </section>;
}
