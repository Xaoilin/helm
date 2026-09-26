/**
 * Trip budget rules: money parsing and formatting, budget categories, the
 * ledger that merges booking costs with manual items, and its totals.
 *
 * Amounts are stored in minor units (pence, cents). Inputs are the decimal
 * strings a person types, so parsing lives here rather than in components.
 */
import { TRIP_BUDGET } from '../config/constants';
import type {
  Trip,
  TripBooking,
  TripBudgetCategory,
  TripBudgetEntry,
  TripBudgetEntryInput,
  TripBudgetEntryStatus,
} from '../types/domain';
import { getBookingDisplayTitle } from './tripDisplay';
import type { BookingSeed } from './tripModel';

export interface BudgetEntryDraft {
  title: string;
  category: TripBudgetCategory;
  amount: string;
  status: TripBudgetEntryStatus;
  date: string;
  notes: string;
}

export interface BudgetCategorySummary {
  value: TripBudgetCategory;
  label: string;
  icon: string;
  forecast: number;
  paid: number;
  count: number;
  uncostedCount: number;
}

export interface BudgetLedgerEntry {
  id: string;
  tripId: string;
  title: string;
  category: TripBudgetCategory;
  amount: number | null;
  status: TripBudgetEntryStatus;
  date: string;
  notes: string;
  source: 'booking' | 'manual';
  createdAt: string;
  bookingId?: string;
  bookingKind?: TripBooking['kind'];
  manualEntry?: TripBudgetEntry;
}

export interface BudgetTotals {
  forecastTotal: number;
  paidTotal: number;
  remaining: number;
  uncostedBookingCount: number;
  byCategory: BudgetCategorySummary[];
}

export type BudgetResult<T> = { ok: true; value: T } | { ok: false; error: string };

export function normalizeCurrencyCode(value: string): string {
  return value.trim().toUpperCase().replace(/[^A-Z]/g, '').slice(0, 3);
}

export function resolveBudgetCurrency(value: string): string {
  return normalizeCurrencyCode(value) || TRIP_BUDGET.DEFAULT_CURRENCY;
}

export function formatBudgetMoney(amount: number, currency: string): string {
  const normalizedCurrency = resolveBudgetCurrency(currency);
  const majorUnits = amount / 100;
  try {
    return new Intl.NumberFormat(undefined, {
      style: 'currency',
      currency: normalizedCurrency,
    }).format(majorUnits);
  } catch {
    return `${normalizedCurrency} ${majorUnits.toFixed(2)}`;
  }
}

/** Parse a typed decimal amount into minor units. Returns null for blank, negative, or non-numeric input. */
export function parseBudgetAmountInput(value: string): number | null {
  const normalized = value.replace(/,/g, '').trim();
  if (!normalized) return null;
  const parsed = Number.parseFloat(normalized);
  if (!Number.isFinite(parsed) || parsed < 0) return null;
  return Math.round(parsed * 100);
}

export function formatBudgetAmountInput(amount: number): string {
  if (!amount) return '';
  return (amount / 100).toFixed(2);
}

export function hasBudgetAmount(amount?: number | null): amount is number {
  return typeof amount === 'number' && Number.isFinite(amount);
}

export function getTripBudgetCategoryDef(category: TripBudgetCategory): { value: TripBudgetCategory; label: string; icon: string } {
  return TRIP_BUDGET.CATEGORIES.find(item => item.value === category) || TRIP_BUDGET.CATEGORIES[TRIP_BUDGET.CATEGORIES.length - 1];
}

export function getTripBudgetStatusLabel(status: TripBudgetEntryStatus): string {
  return status === 'paid' ? 'Paid' : 'Planned';
}

export function getBookingBudgetCategory(kind: TripBooking['kind']): TripBudgetCategory {
  return kind === 'transport' ? 'transport' : 'rent';
}

export function getBookingBudgetDate(booking: TripBooking): string {
  return booking.budgetDate || (booking.kind === 'transport' ? booking.departAt.slice(0, 10) : booking.checkInDate);
}

/**
 * Budget fields on the trip itself (wizard and trip editor). A blank or
 * unreadable total becomes 0, matching the existing forgiving editor.
 */
export function resolveTripBudgetInput(currency: string, total: string): { budgetCurrency: string; budgetTotal: number } {
  return {
    budgetCurrency: resolveBudgetCurrency(currency),
    budgetTotal: parseBudgetAmountInput(total) || 0,
  };
}

/** Budget settings from the Budget tab, which rejects an unreadable total instead of zeroing it. */
export function parseTripBudgetSettings(currency: string, total: string): BudgetResult<{ budgetCurrency: string; budgetTotal: number }> {
  const budgetCurrency = resolveBudgetCurrency(currency);
  const totalAmount = total.trim() ? parseBudgetAmountInput(total) : 0;
  if (total.trim() && totalAmount === null) {
    return { ok: false, error: 'Enter a valid total budget amount.' };
  }
  return { ok: true, value: { budgetCurrency, budgetTotal: totalAmount || 0 } };
}

export function buildBudgetEntryDraft(seedDate: string): BudgetEntryDraft {
  return {
    title: '',
    category: 'transport',
    amount: '',
    status: 'planned',
    date: seedDate,
    notes: '',
  };
}

export function mapBudgetEntryToDraft(entry: TripBudgetEntry): BudgetEntryDraft {
  return {
    title: entry.title,
    category: entry.category,
    amount: formatBudgetAmountInput(entry.amount),
    status: entry.status,
    date: entry.date,
    notes: entry.notes,
  };
}

export function buildBudgetEntryPayload(draft: BudgetEntryDraft, tripId: string, fallbackDate: string): BudgetResult<TripBudgetEntryInput> {
  const amount = parseBudgetAmountInput(draft.amount);
  if (amount === null || amount <= 0) {
    return { ok: false, error: 'Enter a valid amount before saving this budget item.' };
  }
  return {
    ok: true,
    value: {
      tripId,
      title: draft.title.trim() || `${getTripBudgetCategoryDef(draft.category).label} item`,
      category: draft.category,
      amount,
      status: draft.status,
      date: draft.date || fallbackDate,
      notes: draft.notes,
    },
  };
}

function compareLedgerEntries(left: { date: string; createdAt: string }, right: { date: string; createdAt: string }): number {
  return right.date.localeCompare(left.date) || right.createdAt.localeCompare(left.createdAt);
}

/** Merge booking costs and manual items into one newest-first ledger. */
export function buildBudgetLedger({
  bookings,
  manualEntries,
  trip,
  seedFor,
  today,
}: {
  bookings: TripBooking[];
  manualEntries: TripBudgetEntry[];
  trip: Pick<Trip, 'startDate'> | null;
  seedFor: (booking: TripBooking) => BookingSeed;
  today: string;
}): BudgetLedgerEntry[] {
  const bookingEntries: BudgetLedgerEntry[] = bookings.map(booking => ({
    id: `booking-${booking.id}`,
    tripId: booking.tripId,
    title: getBookingDisplayTitle(booking, seedFor(booking)),
    category: getBookingBudgetCategory(booking.kind),
    amount: hasBudgetAmount(booking.budgetAmount) ? booking.budgetAmount : null,
    status: booking.budgetStatus || 'planned',
    date: getBookingBudgetDate(booking) || trip?.startDate || today,
    notes: booking.notes,
    source: 'booking',
    createdAt: booking.createdAt,
    bookingId: booking.id,
    bookingKind: booking.kind,
  }));

  const manualLedgerEntries: BudgetLedgerEntry[] = [...manualEntries]
    .sort(compareLedgerEntries)
    .map(entry => ({
      id: entry.id,
      tripId: entry.tripId,
      title: entry.title,
      category: entry.category,
      amount: entry.amount,
      status: entry.status,
      date: entry.date,
      notes: entry.notes,
      source: 'manual',
      createdAt: entry.createdAt,
      manualEntry: entry,
    }));

  return [...bookingEntries, ...manualLedgerEntries].sort(compareLedgerEntries);
}

function sumAmounts(entries: BudgetLedgerEntry[]): number {
  return entries.reduce((sum, entry) => sum + (entry.amount || 0), 0);
}

function sumPaid(entries: BudgetLedgerEntry[]): number {
  return sumAmounts(entries.filter(entry => hasBudgetAmount(entry.amount) && entry.status === 'paid'));
}

export function summarizeBudget(ledger: BudgetLedgerEntry[], bookings: TripBooking[], budgetTotal: number): BudgetTotals {
  const forecastTotal = sumAmounts(ledger);
  return {
    forecastTotal,
    paidTotal: sumPaid(ledger),
    remaining: budgetTotal - forecastTotal,
    uncostedBookingCount: bookings.filter(booking => !hasBudgetAmount(booking.budgetAmount)).length,
    byCategory: TRIP_BUDGET.CATEGORIES.map(category => {
      const entries = ledger.filter(entry => entry.category === category.value);
      return {
        ...category,
        forecast: sumAmounts(entries),
        paid: sumPaid(entries),
        count: entries.length,
        uncostedCount: entries.filter(entry => !hasBudgetAmount(entry.amount)).length,
      };
    }),
  };
}
