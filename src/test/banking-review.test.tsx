import { fireEvent, render, screen, within } from '@testing-library/react';
import { beforeEach, describe, expect, it, vi } from 'vitest';
import { BankingReview } from '../components/finance/BankingReview';
import { FINANCE_REVIEW } from './finance-review-fixture';

const mocks = vi.hoisted(() => ({ useFinanceReview: vi.fn() }));
vi.mock('../store/contexts/useFinanceReview', () => mocks);

beforeEach(() => {
  mocks.useFinanceReview.mockReturnValue({ review: FINANCE_REVIEW, loaded: true, error: null, refresh: vi.fn() });
});

describe('banking review', () => {
  it('deducts essentials and work costs once and separates planned household costs', () => {
    render(<BankingReview />);
    const available = screen.getByRole('region', { name: 'Monthly available amount' });
    expect(available).toHaveTextContent('£1,750.00 / month');
    expect(available).toHaveTextContent('Before discretionary spending and irregular costs');
    expect(available).toHaveTextContent('Planned scenario');
    expect(available).toHaveTextContent('Higher household contribution: £1,350.00 / month');
    fireEvent.click(screen.getByText('Essential expenses & assumptions'));
    expect(screen.getByText('Includes both mortgages and household bills.')).toBeVisible();
    expect(screen.getByText(/No automatic refresh/)).toBeVisible();
  });
  it('shows all months, category refunds and personal versus household snapshots', () => {
    render(<BankingReview view="spending" />);
    expect(within(screen.getByRole('table', { name: 'Monthly bank cash flow' })).getAllByRole('row')).toHaveLength(13);
    fireEvent.click(screen.getAllByText('Categories')[0]);
    expect(screen.getAllByText('-£100.00')[0]).toBeVisible();
    const balances = screen.getByRole('region', { name: 'Bank balance snapshots' });
    expect(balances).toHaveTextContent('Personal');
    expect(balances).toHaveTextContent('Household');
    expect(balances).toHaveTextContent('-£1,200.00');
    expect(screen.getByRole('region', { name: 'High-value spending' })).toHaveTextContent('Illustrative cap: £500.00 / month');
  });
  it('shows a separate conditional target without adding the planned increase or optional spending cuts twice', () => {
    render(<BankingReview />);
    const current = screen.getByRole('region', { name: 'Monthly available amount' });
    expect(current).toHaveTextContent('£1,750.00 / month');
    expect(current).not.toHaveTextContent('Renovation loans fully repaid');
    const target = screen.getByRole('region', { name: 'Target monthly budget calculation' });
    expect(target).toHaveTextContent('Conditional target');
    expect(target).toHaveTextContent('Current essentials & work costs£3,250.00');
    expect(target).toHaveTextContent('Net monthly cost reduction£900.00');
    expect(target).toHaveTextContent('Target essentials & work costs£2,350.00');
    expect(target).toHaveTextContent('Available before discretionary spending£2,650.00');
    expect(target).toHaveTextContent('Cutting optional spending helps you keep more of this amount.');
    fireEvent.click(within(target).getByText('What needs to change'));
    expect(within(target).getByText(/Requires full repayment/)).toBeVisible();
  });
  it('keeps settlement quotes separate from dated balances and unknown balances distinct from zero', () => {
    render(<BankingReview view="loans" />);
    const active = screen.getByRole('region', { name: 'Active loans' });
    const renovation = within(active).getByRole('article', { name: 'Example Renovation Lender loan' });
    expect(renovation).toHaveTextContent('Reported balance£18,000.00');
    expect(renovation).toHaveTextContent('Settlement quoteDated 20 Sept 2026£17,000.00');
    expect(renovation).toHaveTextContent('Next payment1 Oct 2026');
    expect(renovation).toHaveTextContent('Payments remaining45');
    expect(within(renovation).getByRole('link', { name: 'Example lender statement' })).toHaveAttribute('href', 'https://example.test/loan-statement');
    const unknown = within(active).getByRole('article', { name: 'Example Shared Lender loan' });
    expect(unknown).toHaveTextContent('BalanceNot confirmed');
    expect(unknown).not.toHaveTextContent('£0.00');
    expect(unknown).toHaveTextContent('Monthly payment£1,600.00');
    expect(unknown).toHaveTextContent('Your monthly share£800.00');
    const closed = screen.getByRole('region', { name: 'Closed and repaid loans' });
    expect(closed).toHaveTextContent('Closed; will not be reopened.');
    expect(closed).toHaveTextContent('Repayments completed.');
  });
  it('surfaces read failures with a working retry and no stale review', () => {
    const refresh = vi.fn();
    mocks.useFinanceReview.mockReturnValue({ review: null, loaded: true, error: 'Read unavailable', refresh });
    render(<BankingReview />);
    expect(screen.getByRole('alert')).toHaveTextContent('Read unavailable');
    expect(screen.queryByText('£1,750.00')).not.toBeInTheDocument();
    fireEvent.click(screen.getByRole('button', { name: 'Retry loading' }));
    expect(refresh).toHaveBeenCalledOnce();
  });
});
