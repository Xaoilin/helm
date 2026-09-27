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
const TRANSFER_SAVED = example('transaction-saved', transactionChangeSchema);

let context: FinanceContextValue;

function Probe() {
  const current = useFinanceContext();
  useEffect(() => { context = current; }, [current]);
  const balances = current.financeAccounts.map(account => account.balance).join(',');
  return <output>{`${current.loaded ? 'loaded' : 'loading'}|${balances}|${current.error ?? ''}`}</output>;
}

async function renderLoaded() {
  render(<FinanceProvider><Probe /></FinanceProvider>);
  await screen.findByText('loaded|12345,50000|');
}

beforeEach(() => {
  Object.values(api).forEach(mock => mock.mockReset());
  api.getLedger.mockResolvedValue(LEDGER);
});

describe('FinanceContext', () => {
  it('loads the ledger the service holds', async () => {
    await renderLoaded();
    expect(context.transactions.map(transaction => transaction.id)).toEqual(['example-transfer', 'example-salary']);
    expect(context.financeBudgets).toHaveLength(1);
    expect(context.savingsGoals).toHaveLength(1);
  });

  it('shows a new transaction at once but takes balances only from the service', async () => {
    await renderLoaded();
    let resolveSave!: (value: typeof TRANSFER_SAVED) => void;
    api.saveTransaction.mockReturnValue(new Promise(resolve => { resolveSave = resolve; }));

    let id = '';
    act(() => {
      id = context.addTransaction({ type: 'transfer', amount: 12345, category: 'transfer', accountId: 'example-current',
        toAccountId: 'example-savings', description: 'Monthly saving', date: '2026-09-26' });
    });
    expect(context.transactions[0].id).toBe(id);
    expect(screen.getByText('loaded|12345,50000|')).toBeInTheDocument();
    expect(api.saveTransaction).toHaveBeenCalledWith(id, expect.objectContaining({ amount: 12345 }));

    await act(async () => { resolveSave({ ...TRANSFER_SAVED, transaction: { ...TRANSFER_SAVED.transaction, id } }); });
    expect(screen.getByText('loaded|0,62345|')).toBeInTheDocument();
  });

  it('applies the balances the service returns when a transaction is removed', async () => {
    await renderLoaded();
    api.deleteTransaction.mockResolvedValue({
      id: 'example-transfer',
      accounts: [{ ...LEDGER.accounts[0], balance: 24690 }, { ...LEDGER.accounts[1], balance: 37655 }],
    });
    await act(async () => { context.removeTransaction('example-transfer'); });
    expect(context.transactions.map(transaction => transaction.id)).toEqual(['example-salary']);
    expect(screen.getByText('loaded|24690,37655|')).toBeInTheDocument();
  });

  it('removes the transactions the service removed with an account and unlinks its goals', async () => {
    await renderLoaded();
    api.deleteAccount.mockResolvedValue({ id: 'example-savings', removedTransactionIds: ['example-transfer'] });
    await act(async () => { context.removeFinanceAccount('example-savings'); });
    expect(context.financeAccounts.map(account => account.id)).toEqual(['example-current']);
    expect(context.transactions.map(transaction => transaction.id)).toEqual(['example-salary']);
    expect(context.savingsGoals[0].linkedAccountId).toBeUndefined();
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
