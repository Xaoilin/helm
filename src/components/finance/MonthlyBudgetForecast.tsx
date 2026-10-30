import { useEffect, useRef, useState } from 'react';
import { v4 as uuid } from 'uuid';
import type { BudgetForecast, BudgetForecastItem, ExpenseGroup, FinanceReview } from '../../types/domain';
import { EXPENSE_GROUPS } from '../../services/expenseGroups';
import { forecastBaseline, forecastFromMonth, MAX_FORECAST_ITEMS } from '../../services/budgetForecast';
import { formatGBP } from '../../services/financeHelpers';
import { useFinanceReview } from '../../store/contexts/useFinanceReview';
import { CategoryPayments } from './SpendingTransactions';
import './MonthlySpending.css';
import './ExpenseGroups.css';
import './MonthlyBudgetForecast.css';

interface DraftItem extends Omit<BudgetForecastItem, 'amountPence'> { amount: string }
const toDraft = (item: BudgetForecastItem): DraftItem => ({ ...item, amount: (item.amountPence / 100).toFixed(2) });
function amountPence(value: string): number | null {
  if (!/^\d+(?:\.\d{0,2})?$/u.test(value)) return null;
  const pence = Math.round(Number(value) * 100);
  return Number.isSafeInteger(pence) && pence <= 1_000_000_000_000 ? pence : null;
}
function monthLabel(value: string): string {
  return new Date(`${value}-01T12:00:00Z`).toLocaleDateString('en-GB', { month: 'long', year: 'numeric', timeZone: 'UTC' });
}

export function BudgetForecastEditor({ review, onSave, saving, writable }: {
  review: FinanceReview; onSave: (forecast: BudgetForecast) => Promise<void>; saving: boolean; writable: boolean;
}) {
  const initial = review.budgetForecast ?? forecastFromMonth(review, forecastBaseline(review));
  const [baseline, setBaseline] = useState(initial.baselineMonth);
  const [sourceMonth, setSourceMonth] = useState(initial.baselineMonth);
  const [items, setItems] = useState<DraftItem[]>(() => initial.items.map(toDraft));
  const [income, setIncome] = useState(((initial.incomePence ?? review.budget.incomePence) / 100).toFixed(2));
  const [incomeBasis, setIncomeBasis] = useState(initial.incomeBasis ?? review.budget.incomeBasis);
  const [confirmed, setConfirmed] = useState<string | null>(review.budgetForecast ? JSON.stringify(initial) : null);
  const [message, setMessage] = useState('');
  const [failure, setFailure] = useState('');
  const pendingFocus = useRef<string | null>(null);
  const names = useRef(new Map<string, HTMLInputElement>());
  useEffect(() => {
    if (pendingFocus.current) { names.current.get(pendingFocus.current)?.focus(); pendingFocus.current = null; }
  }, [items]);
  const valid = amountPence(income) !== null && items.every(item => item.label.trim() && amountPence(item.amount) !== null);
  const forecast: BudgetForecast = { baselineMonth: baseline, incomePence: amountPence(income) ?? 0, incomeBasis, items: items.map(item => ({
    id: item.id, label: item.label.trim(), amountPence: amountPence(item.amount) ?? 0, group: item.group,
  })) };
  const spending = forecast.items.reduce((sum, item) => sum + item.amountPence, 0);
  const remainder = forecast.incomePence! - spending;
  const incomeUsed = forecast.incomePence! > 0 ? spending / forecast.incomePence! * 100 : null;
  const dirty = JSON.stringify(forecast) !== confirmed;
  const persisted = review.budgetForecast ? JSON.stringify(review.budgetForecast) : null;
  const changedElsewhere = persisted !== confirmed;
  const disabled = saving || !writable;
  const update = (id: string, patch: Partial<DraftItem>) => {
    setMessage(''); setFailure('');
    setItems(current => current.map(item => item.id === id ? { ...item, ...patch } : item));
  };
  const save = async () => {
    if (!valid || disabled || changedElsewhere) return;
    setFailure(''); setMessage('');
    try {
      await onSave(forecast);
      setConfirmed(JSON.stringify(forecast));
      setMessage('Forecast saved to your account.');
    } catch (error) { setFailure(error instanceof Error ? error.message : 'Your forecast could not be saved. Try again.'); }
  };

  return <section className="monthly-spending budget-forecast" aria-label="Monthly budget forecast" aria-busy={saving}>
    <div className="spending-heading"><div><span className="spending-eyebrow">YOUR PLAN FOR A TYPICAL MONTH</span>
      <h3>Monthly budget forecast</h3><p>Start from {monthLabel(baseline)}, then change amounts, add items or remove spending you don’t expect.</p></div>
    </div>
    <div className="forecast-comparison" aria-label="Monthly income and budget comparison">
      <article className="spending-stat"><span>Monthly take-home salary</span><strong>{amountPence(income) !== null ? formatGBP(forecast.incomePence!) : 'Enter your salary'}</strong>
        <label>Monthly take-home salary (£)<input aria-label="Monthly take-home salary (£)" inputMode="decimal" value={income} disabled={disabled} aria-invalid={amountPence(income) === null}
          onChange={event => { setIncome(event.target.value); setIncomeBasis('Your monthly take-home salary estimate.'); setMessage(''); setFailure(''); }} /></label>
        <small>{incomeBasis} Excludes refunds, transfers and other one-off receipts.</small>
      </article>
      <article className="spending-stat"><span>Forecast monthly spending</span><strong>{valid ? formatGBP(spending) : 'Complete the amounts'}</strong>
        <small>{valid && incomeUsed !== null ? `${incomeUsed.toFixed(1)}% of your salary budgeted` : 'Set your salary to compare your plan.'}</small>
      </article>
      <article className={`spending-stat ${valid && remainder < 0 ? 'forecast-over-budget' : ''}`}><span>{remainder < 0 ? 'Over budget by' : 'Left after your budget'}</span><strong>{valid ? formatGBP(Math.abs(remainder)) : 'Complete the amounts'}</strong>
        <small>{valid && remainder < 0 ? 'Planned spending exceeds your take-home salary.' : 'Unallocated income for saving or a buffer.'}</small>
      </article>
    </div>
    <div className="forecast-toolbar">
      <label>Example month<select aria-label="Forecast example month" value={sourceMonth} disabled={disabled} onChange={event => setSourceMonth(event.target.value)}>
        {[...review.months].sort((a, b) => b.month.localeCompare(a.month)).map(month => <option value={month.month} key={month.month}>{monthLabel(month.month)}{month.month > review.coverage.completeThrough.slice(0, 7) ? ' · partial' : ''}</option>)}
      </select></label>
      <button className="btn btn-secondary" disabled={disabled || !review.months.some(month => month.month === sourceMonth)} onClick={() => {
        const example = forecastFromMonth(review, sourceMonth);
        setBaseline(sourceMonth); setItems(example.items.map(toDraft)); setMessage('Example loaded. Save when your plan is ready.'); setFailure('');
      }}>Replace draft from example</button>
      <button className="btn btn-secondary" disabled={disabled || items.length >= MAX_FORECAST_ITEMS} onClick={() => {
        const id = uuid(); pendingFocus.current = id;
        setItems(current => [...current, { id, label: '', amount: '', group: 'necessary' }]); setMessage('');
      }}>+ Add item</button>
      <button className="btn btn-primary" disabled={disabled || !valid || !dirty || changedElsewhere} onClick={() => void save()}>{saving ? 'Saving…' : 'Save forecast'}</button>
    </div>
    <p className="forecast-status" role="status">{saving ? 'Saving your forecast…' : message || (dirty ? 'Draft changes — save to keep them.' : 'Saved to your account.')}</p>
    {!valid && <p className="banking-muted">Enter a valid salary and give each item a name and an amount, with up to two decimal places.</p>}
    {failure && <p className="banking-error" role="alert">{failure} Your draft is still here.</p>}
    {changedElsewhere && <div className="banking-error" role="alert">
      <p>Your saved forecast changed elsewhere. Your draft is still here. Load the latest plan before saving.</p>
      <button className="btn btn-secondary" disabled={saving} onClick={() => {
        const latest = review.budgetForecast ?? forecastFromMonth(review, forecastBaseline(review));
        setItems(latest.items.map(toDraft)); setBaseline(latest.baselineMonth); setSourceMonth(latest.baselineMonth);
        setIncome(((latest.incomePence ?? review.budget.incomePence) / 100).toFixed(2)); setIncomeBasis(latest.incomeBasis ?? review.budget.incomeBasis);
        setConfirmed(persisted); setFailure(''); setMessage('Latest saved forecast loaded.');
      }}>Load latest saved forecast</button>
    </div>}
    <div className="expense-group-columns">
      {EXPENSE_GROUPS.map(group => {
        const grouped = items.filter(item => item.group === group.value);
        const complete = grouped.every(item => amountPence(item.amount) !== null);
        return <section className="expense-group-column" aria-label={`${group.label} budget`} key={group.value}>
          <header><h4>{group.label}</h4><strong>{complete ? formatGBP(grouped.reduce((sum, item) => sum + amountPence(item.amount)!, 0)) : 'Amount needed'}</strong><p>{group.description}</p></header>
          <div className="expense-group-items">{grouped.map(item => <article className="forecast-item" key={item.id}>
            <label>Item name<input aria-label={`Name for ${item.label || 'new item'}`} value={item.label} maxLength={4000} disabled={disabled}
              ref={node => { if (node) names.current.set(item.id, node); else names.current.delete(item.id); }}
              onChange={event => update(item.id, { label: event.target.value })} /></label>
            <label>Monthly amount (£)<input aria-label={`Monthly amount for ${item.label || 'new item'}`} inputMode="decimal" value={item.amount} disabled={disabled}
              aria-invalid={amountPence(item.amount) === null} onChange={event => update(item.id, { amount: event.target.value })} placeholder="0.00" /></label>
            <label>Group<select aria-label={`Budget group for ${item.label || 'new item'}`} value={item.group} disabled={disabled} onChange={event => {
              pendingFocus.current = item.id; update(item.id, { group: event.target.value as ExpenseGroup });
            }}>{EXPENSE_GROUPS.map(option => <option key={option.value} value={option.value}>{option.label}</option>)}</select></label>
            <CategoryPayments review={review} month={baseline} category={item.label} />
            <button className="btn btn-danger btn-sm" aria-label={`Remove ${item.label || 'new item'}`} disabled={disabled} onClick={() => {
              setItems(current => current.filter(candidate => candidate.id !== item.id)); setMessage('');
            }}>Remove</button>
          </article>)}{grouped.length === 0 && <p className="expense-group-empty">No items in this group.</p>}</div>
        </section>;
      })}
    </div>
    {items.length === 0 && <p>Your forecast is empty. Add an item or choose an example month.</p>}
    <p className="banking-muted">The starting example excludes known one-off payments, refund credits and marked completed repayments. Payment details show the historical example; your editable monthly amounts are your plan.</p>
  </section>;
}

export function MonthlyBudgetForecast() {
  const { review, loaded, error, refresh, saveForecast, saving, expensesWritable } = useFinanceReview();
  return <>
    {error && <div className="banking-error" role="alert">{error} <button className="btn btn-sm" onClick={() => void refresh()}>Retry loading forecast</button></div>}
    {!loaded ? <p role="status">Loading your budget forecast…</p> : !review && !error ? <p>Add a banking review to start a forecast from your spending.</p> : null}
    {review && <BudgetForecastEditor review={review} onSave={saveForecast} saving={saving} writable={expensesWritable} />}
  </>;
}
