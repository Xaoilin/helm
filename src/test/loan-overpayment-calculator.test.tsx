import { fireEvent, render, screen, within } from '@testing-library/react';
import { describe, expect, it, vi } from 'vitest';
import { LoanOverpaymentCalculator } from '../components/finance/LoanOverpaymentCalculator';
import { OVERPAYMENT_PROFILE, OVERPAYMENT_REVIEW } from './loan-overpayment-fixture';

describe('loan overpayment calculator', () => {
  it('loads the saved default and displays monthly interest amounts and repayment ratios over time', () => {
    render(<LoanOverpaymentCalculator review={{ ...OVERPAYMENT_REVIEW, loanProfiles: [OVERPAYMENT_PROFILE] }} />);
    expect(screen.getByLabelText('Saved profile')).toHaveValue(OVERPAYMENT_PROFILE.id);
    const selina = screen.getByRole('article', { name: 'Selina (example) overpayment calculator' });
    expect(within(selina).getByLabelText('Extra payment (£/month)')).toHaveValue(100);
    expect(within(selina).getByRole('region', { name: 'Normal repayment split' })).toHaveTextContent('Interest charged£100.00 (50%)');
    expect(within(selina).getByRole('region', { name: 'Overpayment repayment split' })).toHaveTextContent('Interest charged£100.00 (33.3%)');
    expect(within(selina).getByRole('region', { name: 'Overpayment repayment split' })).toHaveTextContent('Capital repaid£200.00 (66.7%)');
    fireEvent.change(within(selina).getByRole('slider'), { target: { value: '2' } });
    expect(within(selina).getByRole('region', { name: 'Normal repayment split' })).toHaveTextContent('Interest charged£99.00 (49.5%)');
    expect(within(selina).getByRole('region', { name: 'Overpayment repayment split' })).toHaveTextContent('Interest charged£98.00 (32.7%)');
    const accrual = within(selina).getByLabelText('Monthly interest from the remaining balance');
    expect(accrual).toHaveTextContent('£9,900.00 balance → £99.00 interest');
    expect(accrual).toHaveTextContent('£9,800.00 balance → £98.00 interest');
    expect(within(selina).getByRole('img', { name: 'Monthly interest charged (£)' })).toBeInTheDocument();
    expect(within(selina).getByRole('img', { name: 'Interest share of each repayment (%)' })).toBeInTheDocument();
  });

  it('sends a named profile only when explicitly saved and keeps entered extras separate from matching', async () => {
    const changeProfile = vi.fn().mockResolvedValue(undefined);
    render(<LoanOverpaymentCalculator review={OVERPAYMENT_REVIEW} profilesWritable changeProfile={changeProfile} />);
    const selina = screen.getByRole('article', { name: 'Selina (example) overpayment calculator' });
    fireEvent.change(within(selina).getByLabelText('Extra payment (£/month)'), { target: { value: '100' } });
    fireEvent.click(within(selina).getByRole('checkbox'));
    expect(changeProfile).not.toHaveBeenCalled();
    fireEvent.change(screen.getByLabelText('Profile name'), { target: { value: 'My monthly plan' } });
    fireEvent.click(screen.getByLabelText('Load this profile by default'));
    fireEvent.click(screen.getByRole('button', { name: 'Save profile', exact: true }));
    expect(changeProfile).toHaveBeenCalledWith({ operation: 'save', profile: expect.objectContaining({ name: 'My monthly plan', isDefault: true,
      loans: expect.arrayContaining([expect.objectContaining({ loanId: 'example-selina', monthlyExtraPence: 10_000, matchExtra: true })]) }) });
    expect(await screen.findByText(/Saved “My monthly plan”/)).toBeVisible();
  });
  it('compares both dated loans, individual loans and a share without changing the loan calculation', () => {
    render(<LoanOverpaymentCalculator review={OVERPAYMENT_REVIEW} />);
    const totals = screen.getByLabelText('Selected loan totals');
    expect(totals).toHaveTextContent('£30,000.00');
    expect(totals).toHaveTextContent('£450.00 / month');
    const selina = screen.getByRole('article', { name: 'Selina (example) overpayment calculator' });
    expect(within(selina).getByLabelText('Annual borrowing rate (%)')).toHaveValue(12);
    fireEvent.change(within(selina).getByLabelText('Extra payment (£/month)'), { target: { value: '100' } });
    expect(totals).toHaveTextContent('£550.00 / month');
    const results = within(selina).getByLabelText('Selina (example) results');
    const originalPayoff = results.textContent;
    fireEvent.change(screen.getByLabelText('Show amounts as'), { target: { value: 'share' } });
    expect(totals).toHaveTextContent('£15,000.00');
    expect(totals).toHaveTextContent('£225.00 / month');
    expect(totals).toHaveTextContent('£275.00 / month');
    expect(within(selina).getByLabelText('Opening balance (£)')).toHaveValue(10_000);
    expect(results).toHaveTextContent('£50.00');
    expect(results.textContent).not.toBe(originalPayoff);
    fireEvent.click(within(selina).getByRole('checkbox'));
    expect(totals).toHaveTextContent('£325.00 / month');
    fireEvent.change(screen.getByLabelText('Loans'), { target: { value: 'example-natwest' } });
    expect(totals).toHaveTextContent('£10,000.00');
    expect(screen.queryByRole('article', { name: /Selina/ })).not.toBeInTheDocument();
  });

  it('requires missing values, keeps settlement separate, and reveals a monthly schedule', () => {
    const review = { ...OVERPAYMENT_REVIEW, loans: [{ ...OVERPAYMENT_REVIEW.loans[0], notes: '', rateNote: '' }] };
    render(<LoanOverpaymentCalculator review={review} />);
    expect(screen.getByLabelText('Opening balance (£)')).toHaveValue(null);
    expect(screen.getByLabelText('Annual borrowing rate (%)')).toHaveValue(null);
    expect(screen.queryByLabelText('Selina (example) results')).not.toBeInTheDocument();
    fireEvent.change(screen.getByLabelText('Opening balance (£)'), { target: { value: '10000' } });
    fireEvent.change(screen.getByLabelText('Annual borrowing rate (%)'), { target: { value: '0' } });
    fireEvent.change(screen.getByLabelText('First projected payment'), { target: { value: '2026-12' } });
    fireEvent.click(screen.getByText('Monthly interest, repayments & balances'));
    const table = screen.getByRole('table');
    expect(table).toHaveTextContent('Dec 2026');
    expect(table).toHaveTextContent('£200.00');
    expect(table).toHaveTextContent('£9,800.00');
    expect(table).not.toHaveTextContent('£11,200.00');
    fireEvent.change(screen.getByLabelText('Schedule year'), { target: { value: '2' } });
    expect(table).toHaveTextContent('Dec 2027');
    fireEvent.change(screen.getByLabelText('Regular joint payment (£/month)'), { target: { value: '1.001' } });
    expect(screen.getByLabelText('Selected loan totals')).toHaveTextContent('Complete loan inputs');
  });

  it('clears results for an invalid month and explains an unavailable loan review', () => {
    const { rerender } = render(<LoanOverpaymentCalculator review={OVERPAYMENT_REVIEW} />);
    fireEvent.change(screen.getByLabelText('First projected payment'), { target: { value: '' } });
    expect(screen.queryByLabelText('Selina (example) results')).not.toBeInTheDocument();
    expect(screen.getByText(/Choose a first payment month/)).toBeVisible();
    rerender(<LoanOverpaymentCalculator review={{ ...OVERPAYMENT_REVIEW, loans: [] }} />);
    expect(screen.getByText(/No active Selina or NatWest loan is recorded/)).toBeVisible();
  });
});
