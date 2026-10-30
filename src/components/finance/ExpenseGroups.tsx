import { useEffect, useRef, useState } from 'react';
import type { ExpenseGroup, FinanceReview } from '../../types/domain';
import { EXPENSE_GROUPS, expenseGrouping } from '../../services/expenseGroups';
import { formatGBP } from '../../services/financeHelpers';
import { CategoryPayments } from './SpendingTransactions';
import './ExpenseGroups.css';

type Category = FinanceReview['months'][number]['categories'][number];
export interface ExpenseGroupControls {
  onMove?: (label: string, group: ExpenseGroup) => Promise<void>;
  saving?: boolean;
  disabled?: boolean;
}

export function ExpenseGroups({ review, categories, month, query = '', onMove, saving = false, disabled = false }: ExpenseGroupControls & {
  review: FinanceReview;
  categories: Category[];
  query?: string;
  month?: string;
}) {
  const [dragged, setDragged] = useState<string | null>(null);
  const [target, setTarget] = useState<ExpenseGroup | null>(null);
  const [message, setMessage] = useState('');
  const [failure, setFailure] = useState('');
  const pendingFocus = useRef<string | null>(null);
  const menus = useRef(new Map<string, HTMLSelectElement>());
  const moving = useRef(false);
  useEffect(() => {
    if (!saving && pendingFocus.current !== null) {
      menus.current.get(pendingFocus.current)?.focus();
      pendingFocus.current = null;
    }
  }, [review, saving]);
  const unavailable = disabled || saving || !onMove;
  const move = async (label: string, group: ExpenseGroup) => {
    if (unavailable || moving.current || expenseGrouping(label, review).group === group) return;
    moving.current = true;
    pendingFocus.current = label;
    setFailure('');
    setMessage('');
    try {
      await onMove(label, group);
      setMessage(`${label} moved to ${EXPENSE_GROUPS.find(item => item.value === group)!.label}. Saved for all months.`);
    } catch {
      setFailure('Your move was not saved. Check the service message above, then try again.');
    } finally {
      moving.current = false;
    }
  };

  return <section className="expense-groups" aria-label="Expense groups" aria-busy={saving}>
    <div className="expense-groups-intro"><h4>How necessary is it?</h4>
      <p>Drag a category to another column, or use its group menu. Your choices apply to every month.</p>
      <p className="banking-muted">Starting groups are suggestions. Mixed categories move together; unclear ones are marked for your review.</p>
    </div>
    <div className="expense-group-feedback" aria-live="polite">{saving ? 'Saving your choice…' : message}</div>
    {failure && <p className="banking-error" role="alert">{failure}</p>}
    <div className="expense-group-columns">
      {EXPENSE_GROUPS.map(group => {
        const items = categories.filter(item => expenseGrouping(item.label, review).group === group.value);
        const total = items.reduce((sum, item) => sum + item.amountPence, 0);
        const matching = items.filter(item => item.label.toLowerCase().includes(query.trim().toLowerCase()));
        return <section key={group.value} className={`expense-group-column ${target === group.value ? 'expense-group-target' : ''}`}
          aria-label={group.label}
          onDragOver={event => {
            if (!unavailable && dragged !== null) { event.preventDefault(); event.dataTransfer.dropEffect = 'move'; setTarget(group.value); }
          }}
          onDragLeave={event => { if (!event.currentTarget.contains(event.relatedTarget as Node | null)) setTarget(null); }}
          onDrop={event => {
            event.preventDefault();
            if (dragged !== null) void move(dragged, group.value);
            setDragged(null); setTarget(null);
          }}>
          <header><h5>{group.label}</h5><strong>{formatGBP(total)}</strong><p>{group.description}</p>
            <small>{items.length} {items.length === 1 ? 'category' : 'categories'} · net spending</small></header>
          <div className="expense-group-items">
            {matching.map((item, index) => <article className="expense-group-item" key={`${item.label}-${index}`}
              aria-label={`${item.label} expense`} draggable={!unavailable}
              onDragStart={event => {
                if (unavailable) { event.preventDefault(); return; }
                event.dataTransfer.effectAllowed = 'move';
                event.dataTransfer.setData('text/plain', item.label);
                setDragged(item.label);
              }}
              onDragEnd={() => { setDragged(null); setTarget(null); }}>
              <div className="expense-group-item-heading"><span>{!unavailable && <span aria-hidden="true" className="expense-drag-handle">⠿ </span>}{item.label}</span><strong>{formatGBP(item.amountPence)}</strong></div>
              <small>{item.amountPence < 0 ? 'Refund / credit · ' : ''}{expenseGrouping(item.label, review).basis}</small>
              {month && <CategoryPayments review={review} month={month} category={item.label} />}
              <label>Group for {item.label}<select aria-label={`Group for ${item.label}`} value={group.value} disabled={unavailable}
                ref={element => { if (element) menus.current.set(item.label, element); else menus.current.delete(item.label); }}
                onChange={event => void move(item.label, event.target.value as ExpenseGroup)}>
                {EXPENSE_GROUPS.map(option => <option key={option.value} value={option.value}>{option.label}</option>)}
              </select></label>
            </article>)}
            {matching.length === 0 && <p className="expense-group-empty">{items.length === 0 ? 'No categories here.' : 'No matching categories here.'}</p>}
          </div>
        </section>;
      })}
    </div>
  </section>;
}
