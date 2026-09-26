import { describe, expect, it } from 'vitest';
import {
  buildBudgetEntryDraft,
  buildBudgetEntryPayload,
  buildBudgetLedger,
  formatBudgetAmountInput,
  formatBudgetMoney,
  normalizeCurrencyCode,
  parseBudgetAmountInput,
  parseTripBudgetSettings,
  summarizeBudget,
} from '../services/tripBudget';
import { makeBudgetEntry, makeStayBooking, makeTransportBooking, makeTrip } from './tripFixtures';

describe('budget amounts', () => {
  it('parses typed decimals into minor units', () => {
    expect(parseBudgetAmountInput('120')).toBe(12000);
    expect(parseBudgetAmountInput(' 1,250.555 ')).toBe(125056);
    expect(parseBudgetAmountInput('0')).toBe(0);
  });

  it('rejects blank, negative, and non-numeric input', () => {
    expect(parseBudgetAmountInput('')).toBeNull();
    expect(parseBudgetAmountInput('-1')).toBeNull();
    expect(parseBudgetAmountInput('abc')).toBeNull();
  });

  it('formats minor units back for inputs and display', () => {
    expect(formatBudgetAmountInput(0)).toBe('');
    expect(formatBudgetAmountInput(4550)).toBe('45.50');
    expect(formatBudgetMoney(4550, 'eur')).toContain('45.50');
  });

  it('keeps only three letters of a currency code', () => {
    expect(normalizeCurrencyCode(' us-d1x ')).toBe('USD');
  });
});

describe('budget settings and entries', () => {
  it('accepts a blank total as zero and defaults the currency', () => {
    expect(parseTripBudgetSettings('', '')).toEqual({ ok: true, value: { budgetCurrency: 'GBP', budgetTotal: 0 } });
  });

  it('rejects an unreadable total instead of zeroing it', () => {
    expect(parseTripBudgetSettings('EUR', 'lots')).toEqual({ ok: false, error: 'Enter a valid total budget amount.' });
  });

  it('builds a manual entry with a category title and fallback date', () => {
    const draft = { ...buildBudgetEntryDraft(''), category: 'food' as const, amount: '12.5' };
    expect(buildBudgetEntryPayload(draft, 'trip-1', '2026-10-01')).toEqual({
      ok: true,
      value: { tripId: 'trip-1', title: 'Food item', category: 'food', amount: 1250, status: 'planned', date: '2026-10-01', notes: '' },
    });
  });

  it('rejects a zero or missing manual amount', () => {
    const draft = buildBudgetEntryDraft('2026-10-01');
    expect(buildBudgetEntryPayload({ ...draft, amount: '0' }, 'trip-1', '2026-10-01')).toMatchObject({ ok: false });
    expect(buildBudgetEntryPayload(draft, 'trip-1', '2026-10-01')).toEqual({ ok: false, error: 'Enter a valid amount before saving this budget item.' });
  });
});

describe('budget ledger', () => {
  const trip = makeTrip({ budgetTotal: 100000 });
  const priced = makeTransportBooking({ budgetAmount: 30000, budgetStatus: 'paid' });
  const unpriced = makeStayBooking({ budgetAmount: undefined });
  const manual = makeBudgetEntry({ amount: 2500 });

  const ledger = buildBudgetLedger({
    bookings: [priced, unpriced],
    manualEntries: [manual],
    trip,
    seedFor: () => ({}),
    today: '2026-09-26',
  });

  it('merges booking costs and manual items newest first', () => {
    expect(ledger.map(entry => [entry.id, entry.date, entry.source])).toEqual([
      ['booking-booking-transport', '2026-10-04', 'booking'],
      ['budget-1', '2026-10-02', 'manual'],
      ['booking-booking-stay', '2026-10-01', 'booking'],
    ]);
    expect(ledger[0]).toMatchObject({ title: 'Train to Lisbon', category: 'transport', amount: 30000, status: 'paid' });
    expect(ledger[2]).toMatchObject({ title: 'Hotel Sol', category: 'rent', amount: null });
  });

  it('totals forecast, paid, remaining, and uncosted bookings', () => {
    const totals = summarizeBudget(ledger, [priced, unpriced], trip.budgetTotal || 0);
    expect(totals).toMatchObject({ forecastTotal: 32500, paidTotal: 30000, remaining: 67500, uncostedBookingCount: 1 });
    expect(totals.byCategory.find(category => category.value === 'rent')).toMatchObject({ forecast: 0, count: 1, uncostedCount: 1 });
    expect(totals.byCategory.find(category => category.value === 'events')).toMatchObject({ forecast: 2500, paid: 0, count: 1 });
  });
});
