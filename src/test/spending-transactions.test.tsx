import { fireEvent, render, screen } from '@testing-library/react';
import { describe, expect, it } from 'vitest';
import { SpendingTransactions } from '../components/finance/SpendingTransactions';
import { spendingTransactions } from '../services/spendingTransactions';
import { DETAILED_BUDGET_REVIEW } from './budget-forecast-fixture';

describe('itemised personal spending', () => {
  it('shows merchant, purpose, bank date, source and one-off status; searches the purpose', () => {
    render(<SpendingTransactions review={DETAILED_BUDGET_REVIEW} month="2026-09" />);
    expect(screen.getByText('Example Temporary Cover')).toBeVisible();
    expect(screen.getByText('Two-day cover for an example hybrid car, 27–29 September.')).toBeVisible();
    expect(screen.getByText(/27 Sept 2026/u)).toBeVisible();
    expect(screen.getByText('One-off')).toBeVisible();
    expect(screen.getByRole('link', { name: 'Example lender statement' })).toHaveAttribute('href', 'https://example.test/loan-statement');
    fireEvent.change(screen.getByLabelText('Find a payment'), { target: { value: 'hybrid' } });
    expect(screen.getByText('Example Temporary Cover')).toBeVisible();
    fireEvent.change(screen.getByLabelText('Find a payment'), { target: { value: 'unrelated' } });
    expect(screen.getByRole('status')).toHaveTextContent('No payments match');
  });

  it('never exposes household account details, and distinguishes a user-confirmed transfer without a posting date', () => {
    const review = { ...DETAILED_BUDGET_REVIEW, transactions: [...DETAILED_BUDGET_REVIEW.transactions!, {
      ...DETAILED_BUDGET_REVIEW.transactions![0], id: 'forbidden', accountId: 'household', merchant: 'Hidden joint bill',
    }] };
    expect(spendingTransactions(review, '2026-09')).toHaveLength(1);
    render(<SpendingTransactions review={review} month="2026-10" />);
    expect(screen.queryByText('Hidden joint bill')).not.toBeInTheDocument();
    expect(screen.getByText(/payment date not supplied/u)).toBeVisible();
    expect(screen.getByText(/Confirmed by you/u)).toBeVisible();
  });
});
