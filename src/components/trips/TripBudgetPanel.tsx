import { useState } from 'react';
import { TRIP_BUDGET } from '../../config/constants';
import {
  buildBudgetEntryDraft,
  buildBudgetEntryPayload,
  formatBudgetAmountInput,
  formatBudgetMoney,
  getTripBudgetCategoryDef,
  getTripBudgetStatusLabel,
  hasBudgetAmount,
  mapBudgetEntryToDraft,
  normalizeCurrencyCode,
  parseTripBudgetSettings,
  type BudgetEntryDraft,
  type BudgetLedgerEntry,
  type BudgetTotals,
} from '../../services/tripBudget';
import { formatDate } from '../../services/tripDisplay';
import { useTripContext } from '../../store/contexts/TripContext';
import type { Trip, TripBudgetCategory, TripBudgetEntry, TripBudgetEntryStatus } from '../../types/domain';
import TripMetricCard from './TripMetricCard';

export default function TripBudgetPanel({
  trip,
  entries,
  totals,
  todayStr,
  onEditBooking,
}: {
  trip: Trip;
  entries: BudgetLedgerEntry[];
  totals: BudgetTotals;
  todayStr: string;
  onEditBooking: (bookingId: string) => void;
}) {
  const { updateTrip, addTripBudgetEntry, updateTripBudgetEntry, removeTripBudgetEntry } = useTripContext();
  const currency = trip.budgetCurrency || TRIP_BUDGET.DEFAULT_CURRENCY;
  const total = trip.budgetTotal || 0;
  const { forecastTotal, paidTotal, remaining, uncostedBookingCount: uncostedCount, byCategory: categoryBreakdown } = totals;
  const defaultEntryDate = trip.startDate || todayStr;

  const [budgetCurrencyDraft, setBudgetCurrencyDraft] = useState<string>(currency);
  const [budgetTotalDraft, setBudgetTotalDraft] = useState(() => formatBudgetAmountInput(total));
  const [budgetEntryDraft, setBudgetEntryDraft] = useState<BudgetEntryDraft>(() => buildBudgetEntryDraft(defaultEntryDate));
  const [editingBudgetEntryId, setEditingBudgetEntryId] = useState<string | null>(null);
  const [budgetFeedback, setBudgetFeedback] = useState<string | null>(null);

  function resetBudgetEntryForm(): void {
    setEditingBudgetEntryId(null);
    setBudgetEntryDraft(buildBudgetEntryDraft(defaultEntryDate));
    setBudgetFeedback(null);
  }

  function updateEntryDraft(updates: Partial<BudgetEntryDraft>): void {
    setBudgetFeedback(null);
    setBudgetEntryDraft(prev => ({ ...prev, ...updates }));
  }

  function saveBudgetSettings(): void {
    const result = parseTripBudgetSettings(budgetCurrencyDraft, budgetTotalDraft);
    if (!result.ok) {
      setBudgetFeedback(result.error);
      return;
    }
    updateTrip(trip.id, result.value);
    setBudgetCurrencyDraft(result.value.budgetCurrency);
    setBudgetTotalDraft(formatBudgetAmountInput(result.value.budgetTotal));
    setBudgetFeedback(null);
  }

  function openBudgetEntryEdit(entry: TripBudgetEntry): void {
    setEditingBudgetEntryId(entry.id);
    setBudgetEntryDraft(mapBudgetEntryToDraft(entry));
    setBudgetFeedback(null);
  }

  function saveBudgetEntry(): void {
    const result = buildBudgetEntryPayload(budgetEntryDraft, trip.id, defaultEntryDate);
    if (!result.ok) {
      setBudgetFeedback(result.error);
      return;
    }
    if (editingBudgetEntryId) {
      updateTripBudgetEntry(editingBudgetEntryId, result.value);
    } else {
      addTripBudgetEntry(result.value);
    }
    resetBudgetEntryForm();
  }

  function toggleBudgetEntryStatus(entry: TripBudgetEntry): void {
    updateTripBudgetEntry(entry.id, {
      status: entry.status === 'paid' ? 'planned' : 'paid',
    });
  }

  return (
    <div style={{ display: 'grid', gap: 16 }}>
      <div className="card" style={{ padding: 18, display: 'flex', justifyContent: 'space-between', gap: 12, flexWrap: 'wrap', alignItems: 'center' }}>
        <div>
          <div style={{ fontSize: 16, fontWeight: 700 }}>Trip Budget</div>
          <div style={{ fontSize: 13, color: '#8b8fa3' }}>Bookings feed this view automatically, and manual items cover everything else like food, events, fees, and extras.</div>
        </div>
        <button className="btn btn-secondary" onClick={() => resetBudgetEntryForm()}>+ Budget Item</button>
      </div>

      <div className="projects-metrics-grid">
        <TripMetricCard label="Budget" value={total > 0 ? formatBudgetMoney(total, currency) : 'Not set'} note={`${currency} trip budget`} />
        <TripMetricCard label="Forecast" value={formatBudgetMoney(forecastTotal, currency)} note="Everything already priced across bookings and manual items." />
        <TripMetricCard label="Paid" value={formatBudgetMoney(paidTotal, currency)} note="Costs already paid or locked in." />
        <TripMetricCard label="Remaining" value={total > 0 ? formatBudgetMoney(remaining, currency) : 'Set a budget'} note={total > 0 ? 'What is left if your plan holds.' : 'Add a total budget to unlock the remaining view.'} />
        <TripMetricCard label="Needs Cost" value={String(uncostedCount)} note={uncostedCount === 0 ? 'Every booking has a linked cost or is intentionally free.' : 'Bookings that appear in Budget but still need a price.'} />
      </div>

      <div className="trip-bookings-grid">
        <div className="card" style={{ padding: 18, display: 'grid', gap: 16, alignContent: 'start' }}>
          <div style={{ display: 'grid', gap: 6 }}>
            <div style={{ fontSize: 16, fontWeight: 700 }}>Budget Settings</div>
            <div style={{ fontSize: 13, color: '#8b8fa3' }}>Keep everything in one home currency so your trip budget is easy to read at a glance.</div>
          </div>

          <div style={{ display: 'grid', gridTemplateColumns: '120px 1fr', gap: 12 }}>
            <div className="form-group">
              <label htmlFor="trip-budget-currency">Currency</label>
              <input
                id="trip-budget-currency"
                className="form-input"
                maxLength={3}
                value={budgetCurrencyDraft}
                onChange={event => {
                  setBudgetFeedback(null);
                  setBudgetCurrencyDraft(normalizeCurrencyCode(event.target.value));
                }}
              />
            </div>
            <div className="form-group">
              <label htmlFor="trip-budget-total">Total Budget</label>
              <input
                id="trip-budget-total"
                className="form-input"
                inputMode="decimal"
                placeholder="2500"
                value={budgetTotalDraft}
                onChange={event => {
                  setBudgetFeedback(null);
                  setBudgetTotalDraft(event.target.value);
                }}
              />
            </div>
          </div>

          <div className="modal-actions" style={{ justifyContent: 'flex-start' }}>
            <button className="btn btn-primary" onClick={saveBudgetSettings}>Save Budget</button>
          </div>

          <div style={{ height: 1, background: '#23283c' }} />

          <div style={{ display: 'grid', gap: 6 }}>
            <div style={{ fontSize: 16, fontWeight: 700 }}>{editingBudgetEntryId ? 'Edit Budget Item' : 'Quick Add Budget Item'}</div>
            <div style={{ fontSize: 13, color: '#8b8fa3' }}>Add the big costs first, then keep a running list of food, events, and extras as the trip comes together.</div>
          </div>

          <div className="form-group">
            <label htmlFor="trip-budget-title">Title</label>
            <input
              id="trip-budget-title"
              className="form-input"
              value={budgetEntryDraft.title}
              placeholder="Airport transfer, museum tickets, hotel deposit"
              onChange={event => updateEntryDraft({ title: event.target.value })}
            />
          </div>

          <div style={{ display: 'grid', gridTemplateColumns: '1fr 1fr', gap: 12 }}>
            <div className="form-group">
              <label htmlFor="trip-budget-category">Category</label>
              <select
                id="trip-budget-category"
                className="form-select"
                value={budgetEntryDraft.category}
                onChange={event => updateEntryDraft({ category: event.target.value as TripBudgetCategory })}
              >
                {TRIP_BUDGET.CATEGORIES.map(category => (
                  <option key={category.value} value={category.value}>{category.label}</option>
                ))}
              </select>
            </div>
            <div className="form-group">
              <label htmlFor="trip-budget-status">Status</label>
              <select
                id="trip-budget-status"
                className="form-select"
                value={budgetEntryDraft.status}
                onChange={event => updateEntryDraft({ status: event.target.value as TripBudgetEntryStatus })}
              >
                {TRIP_BUDGET.STATUSES.map(status => (
                  <option key={status.value} value={status.value}>{status.label}</option>
                ))}
              </select>
            </div>
          </div>

          <div style={{ display: 'grid', gridTemplateColumns: '1fr 1fr', gap: 12 }}>
            <div className="form-group">
              <label htmlFor="trip-budget-amount">Amount</label>
              <input
                id="trip-budget-amount"
                className="form-input"
                inputMode="decimal"
                placeholder="120.00"
                value={budgetEntryDraft.amount}
                onChange={event => updateEntryDraft({ amount: event.target.value })}
              />
            </div>
            <div className="form-group">
              <label htmlFor="trip-budget-date">Date</label>
              <input
                id="trip-budget-date"
                className="form-input"
                type="date"
                value={budgetEntryDraft.date}
                onChange={event => updateEntryDraft({ date: event.target.value })}
              />
            </div>
          </div>

          <div className="form-group">
            <label htmlFor="trip-budget-notes">Notes</label>
            <textarea
              id="trip-budget-notes"
              className="form-input"
              value={budgetEntryDraft.notes}
              onChange={event => updateEntryDraft({ notes: event.target.value })}
            />
          </div>

          {budgetFeedback && (
            <div className="info-box error" role="alert" aria-live="polite" style={{ marginBottom: 0 }}>
              {budgetFeedback}
            </div>
          )}

          <div className="modal-actions" style={{ justifyContent: 'flex-start' }}>
            {editingBudgetEntryId && (
              <button className="btn btn-secondary" onClick={() => resetBudgetEntryForm()}>Cancel Edit</button>
            )}
            <button className="btn btn-primary" onClick={saveBudgetEntry}>
              {editingBudgetEntryId ? 'Save Budget Item' : 'Add Budget Item'}
            </button>
          </div>
        </div>

        <div className="card" style={{ padding: 18, display: 'grid', gap: 12, alignContent: 'start' }}>
          <div style={{ fontSize: 16, fontWeight: 700 }}>Category Breakdown</div>
          <div style={{ fontSize: 13, color: '#8b8fa3' }}>Linked bookings and manual items roll up together here.</div>
          <div style={{ display: 'grid', gap: 10 }}>
            {categoryBreakdown.map(category => (
              <div key={category.value} style={{ padding: 14, borderRadius: 14, background: '#141926', border: '1px solid #23283c', display: 'grid', gap: 10 }}>
                <div style={{ display: 'flex', justifyContent: 'space-between', gap: 10, alignItems: 'center', flexWrap: 'wrap' }}>
                  <div style={{ display: 'flex', alignItems: 'center', gap: 10 }}>
                    <span style={{ fontSize: 20 }} aria-hidden="true">{category.icon}</span>
                    <div>
                      <div style={{ fontWeight: 700 }}>{category.label}</div>
                      <div style={{ fontSize: 12, color: '#8b8fa3' }}>
                        {category.count === 0
                          ? 'No items yet'
                          : `${category.count} item${category.count === 1 ? '' : 's'}${category.uncostedCount > 0 ? ` · ${category.uncostedCount} need${category.uncostedCount === 1 ? 's' : ''} cost` : ''}`}
                      </div>
                    </div>
                  </div>
                  <span className={`tag ${category.forecast > 0 ? 'tag-primary' : 'tag-disconnected'}`}>{formatBudgetMoney(category.forecast, currency)}</span>
                </div>
                <div style={{ display: 'grid', gridTemplateColumns: '1fr 1fr', gap: 8 }}>
                  <div style={{ padding: 10, borderRadius: 10, background: '#10141d' }}>
                    <div style={{ fontSize: 11, textTransform: 'uppercase', letterSpacing: 0.6, color: '#6b6f85', marginBottom: 4 }}>Forecast</div>
                    <div style={{ fontWeight: 600 }}>{formatBudgetMoney(category.forecast, currency)}</div>
                  </div>
                  <div style={{ padding: 10, borderRadius: 10, background: '#10141d' }}>
                    <div style={{ fontSize: 11, textTransform: 'uppercase', letterSpacing: 0.6, color: '#6b6f85', marginBottom: 4 }}>Paid</div>
                    <div style={{ fontWeight: 600 }}>{formatBudgetMoney(category.paid, currency)}</div>
                  </div>
                </div>
              </div>
            ))}
          </div>
        </div>
      </div>

      <div className="card" style={{ padding: 18, display: 'grid', gap: 12 }}>
        <div style={{ fontSize: 16, fontWeight: 700 }}>Budget Ledger</div>
        {entries.length === 0 ? (
          <div style={{ fontSize: 13, color: '#8b8fa3' }}>No linked booking costs or manual budget items yet.</div>
        ) : (
          entries.map(entry => {
            const category = getTripBudgetCategoryDef(entry.category);
            return (
              <div key={entry.id} style={{ padding: 14, borderRadius: 14, background: '#141926', border: '1px solid #23283c', display: 'grid', gap: 8 }}>
                <div style={{ display: 'flex', justifyContent: 'space-between', gap: 12, alignItems: 'flex-start', flexWrap: 'wrap' }}>
                  <div style={{ display: 'grid', gap: 6 }}>
                    <div style={{ display: 'flex', alignItems: 'center', gap: 8, flexWrap: 'wrap' }}>
                      <span style={{ fontSize: 18 }} aria-hidden="true">{category.icon}</span>
                      <div style={{ fontWeight: 700 }}>{entry.title}</div>
                      <span className="tag tag-disconnected">{category.label}</span>
                      <span className={`tag ${entry.source === 'booking' ? 'tag-connected' : 'tag-disconnected'}`}>{entry.source === 'booking' ? 'Booking' : 'Manual'}</span>
                      <span className={`tag ${hasBudgetAmount(entry.amount) ? (entry.status === 'paid' ? 'tag-connected' : 'tag-primary') : 'tag-disconnected'}`}>
                        {hasBudgetAmount(entry.amount) ? getTripBudgetStatusLabel(entry.status) : 'Needs cost'}
                      </span>
                    </div>
                    <div style={{ fontSize: 12, color: '#8b8fa3' }}>{formatDate(entry.date)}</div>
                    {entry.source === 'booking' && (
                      <div style={{ fontSize: 12, color: '#8b8fa3' }}>This row stays linked to the booking.</div>
                    )}
                    {entry.notes && <div style={{ fontSize: 12, color: '#9ea4c5' }}>{entry.notes}</div>}
                  </div>
                  <div style={{ fontSize: 18, fontWeight: 700, color: '#f5f7ff' }}>
                    {hasBudgetAmount(entry.amount) ? formatBudgetMoney(entry.amount, currency) : 'Needs cost'}
                  </div>
                </div>
                <div className="actions-row" style={{ margin: 0, flexWrap: 'wrap' }}>
                  {entry.source === 'booking' && entry.bookingId ? (
                    <button className="btn btn-secondary btn-sm" onClick={() => onEditBooking(entry.bookingId as string)}>Edit Booking</button>
                  ) : (
                    <>
                      <button className="btn btn-secondary btn-sm" onClick={() => openBudgetEntryEdit(entry.manualEntry as TripBudgetEntry)}>Edit</button>
                      <button className="btn btn-secondary btn-sm" onClick={() => toggleBudgetEntryStatus(entry.manualEntry as TripBudgetEntry)}>
                        {entry.status === 'paid' ? 'Mark Planned' : 'Mark Paid'}
                      </button>
                      <button className="btn btn-danger btn-sm" onClick={() => {
                        if (window.confirm(`Delete budget item "${entry.title}"?`)) {
                          removeTripBudgetEntry((entry.manualEntry as TripBudgetEntry).id);
                          if (editingBudgetEntryId === (entry.manualEntry as TripBudgetEntry).id) {
                            resetBudgetEntryForm();
                          }
                        }
                      }}>Delete</button>
                    </>
                  )}
                  {entry.source === 'booking' && (
                    <button className="btn btn-secondary btn-sm" onClick={() => resetBudgetEntryForm()}>
                      + Manual Item
                    </button>
                  )}
                </div>
              </div>
            );
          })
        )}
      </div>
    </div>
  );
}
