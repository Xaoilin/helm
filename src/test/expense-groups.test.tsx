import { fireEvent, render, screen, within } from '@testing-library/react';
import { describe, expect, it, vi } from 'vitest';
import { ExpenseGroups } from '../components/finance/ExpenseGroups';
import { expenseGrouping } from '../services/expenseGroups';
import { FINANCE_REVIEW } from './finance-review-fixture';

describe('expense necessity groups', () => {
  it.each([
    ['Mortgage', 'non-discretionary'], ['Loan repayments', 'non-discretionary'], ['Household contribution', 'non-discretionary'],
    ['Household contributions', 'non-discretionary'], ['Renovation finance payments', 'non-discretionary'],
    ['Groceries', 'necessary'], ['Food and takeaways', 'necessary'], ['Fuel', 'necessary'],
    ['Netflix subscriptions', 'discretionary'], ['GitHub', 'discretionary'], ['Clothing', 'discretionary'],
    ['Software and cloud tools', 'discretionary'], ['Home and delivery memberships', 'discretionary'],
  ])('suggests %s as %s', (label, group) => {
    expect(expenseGrouping(label, FINANCE_REVIEW)).toMatchObject({ group, basis: 'Suggested' });
  });

  it('uses saved choices before suggestions and marks unknown categories for review', () => {
    const review = { ...FINANCE_REVIEW, expenseGroups: [{ label: ' FUEL ', group: 'discretionary' as const }] };
    expect(expenseGrouping('Fuel', review)).toEqual({ group: 'discretionary', basis: 'Your choice' });
    expect(expenseGrouping('Other outgoings', review)).toEqual({ group: 'necessary', basis: 'Needs your review' });
  });

  it('keeps refunds signed, totals unchanged by search and offers a keyboard-accessible move', async () => {
    const onMove = vi.fn().mockResolvedValue(undefined);
    render(<ExpenseGroups review={FINANCE_REVIEW} categories={[
      { label: 'Groceries', amountPence: 30_000 }, { label: 'Fuel', amountPence: -5_000 },
    ]} query="fuel" onMove={onMove} />);
    const necessary = screen.getByRole('region', { name: 'Discretionary but necessary', exact: true });
    expect(necessary).toHaveTextContent('£250.00');
    expect(necessary).toHaveTextContent('-£50.00');
    expect(necessary).toHaveTextContent('Refund / credit');
    expect(within(necessary).queryByRole('article', { name: 'Groceries expense' })).not.toBeInTheDocument();
    fireEvent.change(screen.getByLabelText('Group for Fuel'), { target: { value: 'discretionary' } });
    expect(onMove).toHaveBeenCalledWith('Fuel', 'discretionary');
    expect(await screen.findByText('Fuel moved to 100% discretionary. Saved for all months.')).toBeVisible();
  });
});
