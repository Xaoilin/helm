import { fireEvent, render, screen, within } from '@testing-library/react';
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';
import { MonthlySpending } from '../components/finance/MonthlySpending';
import { FINANCE_REVIEW } from './finance-review-fixture';

beforeEach(() => { vi.useFakeTimers(); vi.setSystemTime(new Date('2026-09-21T12:00:00Z')); });
afterEach(() => vi.useRealTimers());

describe('monthly spending explorer', () => {
  it('keeps missing current-month spending unknown and shows the prior month on demand', () => {
    render(<MonthlySpending review={FINANCE_REVIEW} />);
    expect(screen.getByRole('status')).toHaveTextContent('September 2026 has not been imported yet');
    expect(screen.queryByText('£0.00')).not.toBeInTheDocument();
    fireEvent.click(screen.getByRole('button', { name: 'Last month' }));
    expect(screen.getByText('Complete month')).toBeVisible();
    expect(screen.getByText('£4,100.00')).toBeVisible();
    expect(screen.getByText('-£100.00')).toBeVisible();
    fireEvent.change(screen.getByRole('searchbox', { name: 'Find a category' }), { target: { value: 'refund' } });
    const breakdown = screen.getByRole('region', { name: 'Spending by category' });
    expect(breakdown).toHaveTextContent('Refund / credit');
    expect(within(breakdown).queryByText('Retail purchases')).not.toBeInTheDocument();
    fireEvent.click(screen.getByRole('button', { name: 'This month' }));
    expect(screen.getByRole('status')).toHaveTextContent('missing spending is not £0');
  });

  it('labels partial months without comparing them with a whole month', () => {
    const review = { ...FINANCE_REVIEW, months: [...FINANCE_REVIEW.months, {
      ...FINANCE_REVIEW.months[0], month: '2026-09', outflowPence: 100_000, incomePence: 0, salaryPence: 0, netPence: -100_000,
      categories: [{ label: 'Example payments', amountPence: 100_000 }],
    }] };
    render(<MonthlySpending review={review} />);
    expect(screen.getByText('Partial month · totals so far')).toBeVisible();
    expect(screen.getByText('Do not compare this with a full month.')).toBeVisible();
    expect(screen.queryByText(/less than August/)).not.toBeInTheDocument();
  });

  it('uses January’s previous calendar month across the year boundary', () => {
    vi.setSystemTime(new Date('2026-01-15T12:00:00Z'));
    render(<MonthlySpending review={FINANCE_REVIEW} />);
    fireEvent.click(screen.getByRole('button', { name: 'Last month' }));
    expect(screen.getByRole('combobox', { name: 'Review month' })).toHaveValue('2025-12');
  });

  it('does not invent zero expense-group totals when an imported month lacks categories', () => {
    render(<MonthlySpending review={{ ...FINANCE_REVIEW, months: FINANCE_REVIEW.months.map(month => ({ ...month, categories: [] })) }} />);
    fireEvent.click(screen.getByRole('button', { name: 'Last month' }));
    expect(screen.getByText('No category breakdown was supplied for this month.')).toBeVisible();
    expect(screen.queryByRole('region', { name: 'Expense groups', exact: true })).not.toBeInTheDocument();
  });
});
