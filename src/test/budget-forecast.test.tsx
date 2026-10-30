import { fireEvent, render, screen, waitFor } from '@testing-library/react';
import { describe, expect, it, vi } from 'vitest';
import { BudgetForecastEditor } from '../components/finance/MonthlyBudgetForecast';
import { forecastBaseline, forecastFromMonth } from '../services/budgetForecast';
import { BUDGET_REVIEW } from './budget-forecast-fixture';

describe('monthly budget forecast', () => {
  it('uses September as the complete baseline, current raw commitments once, and excludes refunds/completed debts', () => {
    const baseline = forecastBaseline(BUDGET_REVIEW);
    expect(baseline).toBe('2026-09');
    const forecast = forecastFromMonth(BUDGET_REVIEW, baseline);
    expect(forecast.items.map(item => item.label)).toEqual(['Groceries', 'Subscriptions', 'House bills', 'Private spending fund']);
    expect(forecast.items.find(item => item.label === 'House bills')).toMatchObject({ amountPence: 120_000, group: 'non-discretionary' });
    expect(forecast.items.reduce((sum, item) => sum + item.amountPence, 0)).toBe(176_500);
    expect(new Set(forecast.items.map(item => item.id)).size).toBe(forecast.items.length);
  });

  it('edits, adds and removes items before an explicit account save', async () => {
    const onSave = vi.fn().mockResolvedValue(undefined);
    render(<BudgetForecastEditor review={BUDGET_REVIEW} onSave={onSave} saving={false} writable />);
    fireEvent.change(screen.getByLabelText('Monthly amount for Groceries'), { target: { value: '250.50' } });
    fireEvent.click(screen.getByRole('button', { name: 'Remove Subscriptions' }));
    fireEvent.click(screen.getByRole('button', { name: '+ Add item' }));
    const name = screen.getByLabelText('Name for new item');
    expect(name).toHaveFocus();
    fireEvent.change(name, { target: { value: 'Emergency buffer' } });
    fireEvent.change(screen.getByLabelText('Monthly amount for Emergency buffer'), { target: { value: '75' } });
    expect(onSave).not.toHaveBeenCalled();
    fireEvent.click(screen.getByRole('button', { name: 'Save forecast' }));
    await waitFor(() => expect(onSave).toHaveBeenCalledOnce());
    const saved = onSave.mock.calls[0][0];
    expect(saved.baselineMonth).toBe('2026-09');
    expect(saved.items.find((item: { label: string }) => item.label === 'Emergency buffer')).toMatchObject({ amountPence: 7_500, group: 'necessary' });
    expect(saved.items.some((item: { label: string }) => item.label === 'Subscriptions')).toBe(false);
    expect(await screen.findByRole('status')).toHaveTextContent('Forecast saved to your account.');
  });

  it('keeps an unsaved draft after refusal and rejects invalid amounts', async () => {
    const onSave = vi.fn().mockRejectedValue(new Error('The review changed. Reload and try again.'));
    render(<BudgetForecastEditor review={BUDGET_REVIEW} onSave={onSave} saving={false} writable />);
    fireEvent.change(screen.getByLabelText('Monthly amount for Groceries'), { target: { value: '-1' } });
    expect(screen.getByRole('button', { name: 'Save forecast' })).toBeDisabled();
    fireEvent.change(screen.getByLabelText('Monthly amount for Groceries'), { target: { value: '99.99' } });
    fireEvent.click(screen.getByRole('button', { name: 'Save forecast' }));
    expect(await screen.findByRole('alert')).toHaveTextContent('Your draft is still here');
    expect(screen.getByLabelText('Monthly amount for Groceries')).toHaveValue('99.99');
  });

  it('keeps a deliberately empty saved plan empty', () => {
    render(<BudgetForecastEditor review={{ ...BUDGET_REVIEW, budgetForecast: { baselineMonth: '2026-09', items: [] } }}
      onSave={vi.fn()} saving={false} writable />);
    expect(screen.getByText('Your forecast is empty. Add an item or choose an example month.')).toBeVisible();
    expect(screen.queryByLabelText('Monthly amount for Groceries')).not.toBeInTheDocument();
  });
});
