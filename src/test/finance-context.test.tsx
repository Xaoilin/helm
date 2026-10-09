import { readFileSync } from 'node:fs';
import { join } from 'node:path';
import { act, render, screen, waitFor } from '@testing-library/react';
import { useEffect } from 'react';
import { beforeEach, describe, expect, it, vi } from 'vitest';
import { ledgerSchema, transactionChangeSchema } from '../services/backend/financeContracts';
import { FinanceProvider, useFinanceContext, type FinanceContextValue } from '../store/contexts/FinanceContext';

const api = vi.hoisted(() => ({
  getLedger: vi.fn(), saveAccount: vi.fn(), deleteAccount: vi.fn(), saveTransaction: vi.fn(), deleteTransaction: vi.fn(),
  saveBudget: vi.fn(), deleteBudget: vi.fn(), saveSavingsGoal: vi.fn(), deleteSavingsGoal: vi.fn(),
}));
vi.mock('../services/backend/financeServiceApi', () => ({ ...api, isFinanceServiceEnabled: () => true }));

function example<T>(name: string, schema: { parse: (value: unknown) => T }): T {
  const file = join(process.cwd(), 'contracts', 'finance-service', `${name}.json`);
  return schema.parse((JSON.parse(readFileSync(file, 'utf8')) as { body: unknown }).body);
}

const LEDGER = example('ledger', ledgerSchema);
const PAYMENT_SAVED = example('transaction-saved', transactionChangeSchema);

let context: FinanceContextValue;

function Probe() {
  const current = useFinanceContext();
  useEffect(() => { context = current; }, [current]);
  const balances = current.financeAccounts.map(account => account.balance).join(',');
  return <output>{`${current.loaded ? 'loaded' : 'loading'}|${balances}|${current.error ?? ''}`}</output>;
}

async function renderLoaded() {
  // Flush the async load and the probe's effect before reading its captured context.
  await act(async () => { render(<FinanceProvider><Probe /></FinanceProvider>); });
  await screen.findByText('loaded|110401,60000|');
}

beforeEach(() => {
  Object.values(api).forEach(mock => mock.mockReset());
  api.getLedger.mockResolvedValue(LEDGER);
});

describe('FinanceContext', () => {
  it('loads the ledger the service holds', async () => {
    await renderLoaded();
    expect(context.transactions.map(transaction => transaction.id)).toEqual(['food', 'move']);
    expect(context.financeBudgets).toHaveLength(1);
    expect(context.savingsGoals).toHaveLength(2);
  });

  it('shows a new transaction at once but takes balances only from the service', async () => {
    await renderLoaded();
    let resolveSave!: (value: typeof PAYMENT_SAVED) => void;
    api.saveTransaction.mockReturnValue(new Promise(resolve => { resolveSave = resolve; }));

    let id = '';
    act(() => {
      id = context.addTransaction({ type: 'income', amount: 250000, category: 'salary', accountId: 'current',
        description: 'Example payment', date: '2026-09-25' });
    });
    expect(context.transactions[0].id).toBe(id);
    expect(screen.getByText('loaded|110401,60000|')).toBeInTheDocument();
    expect(api.saveTransaction).toHaveBeenCalledWith(id, expect.objectContaining({ amount: 250000 }));

    await act(async () => { resolveSave({ ...PAYMENT_SAVED, transaction: { ...PAYMENT_SAVED.transaction, id } }); });
    expect(screen.getByText('loaded|360401,60000|')).toBeInTheDocument();
  });

  it('applies the balances the service returns when a transaction is removed', async () => {
    await renderLoaded();
    api.deleteTransaction.mockResolvedValue({
      id: 'move',
      accounts: [{ ...LEDGER.accounts[0], balance: 120401 }, { ...LEDGER.accounts[1], balance: 50000 }],
    });
    await act(async () => { context.removeTransaction('move'); });
    expect(context.transactions.map(transaction => transaction.id)).toEqual(['food']);
    expect(screen.getByText('loaded|120401,50000|')).toBeInTheDocument();
  });

  it('removes the transactions the service removed with an account and unlinks its goals', async () => {
    await renderLoaded();
    api.deleteAccount.mockResolvedValue({ id: 'savings', removedTransactionIds: ['move'] });
    await act(async () => { context.removeFinanceAccount('savings'); });
    expect(context.financeAccounts.map(account => account.id)).toEqual(['current']);
    expect(context.transactions.map(transaction => transaction.id)).toEqual(['food']);
    expect(context.savingsGoals.find(goal => goal.id === 'holiday')?.linkedAccountId).toBeUndefined();
  });

  it('shows why a refused save failed and reloads what the service holds', async () => {
    await renderLoaded();
    api.saveBudget.mockRejectedValue(new Error('A budget for this category already exists.'));
    await act(async () => { context.addFinanceBudget({ category: 'groceries', monthlyLimit: 1000 }); });
    await waitFor(() => expect(screen.getByRole('status', { hidden: true }).textContent ?? '')
      .toContain('A budget for this category already exists.'));
    await waitFor(() => expect(context.financeBudgets).toEqual(LEDGER.budgets));
    expect(api.getLedger).toHaveBeenCalledTimes(2);
  });
});
