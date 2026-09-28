/**
 * Manual finance (accounts, transactions, budgets and savings goals), owned by the finance service. Each
 * change is shown at once and saved as one record. Balances are the service's: a saved or removed
 * transaction answers with every account whose balance it changed, and those accounts replace the shown
 * ones. A refused save shows why and reloads what the service holds.
 */
import { createContext, useCallback, useContext, useMemo, useRef, useState, type ReactNode } from 'react';
import { v4 as uuid } from 'uuid';
import type { FinanceAccount, FinanceBudget, SavingsGoal, Transaction } from '../../types/domain';
import {
  deleteAccount,
  deleteBudget,
  deleteSavingsGoal,
  deleteTransaction,
  getLedger,
  isFinanceServiceEnabled,
  saveAccount,
  saveBudget,
  saveSavingsGoal,
  saveTransaction,
  type AccountInput,
  type BudgetInput,
  type SavingsGoalInput,
  type TransactionInput,
} from '../../services/backend/financeServiceApi';
import type { FinanceAccountDeleted, FinanceTransactionChange } from '../../services/backend/financeContracts';
import { LIVE_DOMAINS } from '../../services/backend/liveDomains';
import { useServiceLoad } from './useServiceLoad';

type Stamps = 'id' | 'createdAt' | 'updatedAt';

export interface FinanceContextValue {
  financeAccounts: FinanceAccount[];
  transactions: Transaction[];
  financeBudgets: FinanceBudget[];
  savingsGoals: SavingsGoal[];
  loaded: boolean;
  /** Why Finance may be out of date; null while it is current. */
  error: string | null;
  reload: () => Promise<void>;
  addFinanceAccount: (acc: Omit<FinanceAccount, Stamps>) => string;
  updateFinanceAccount: (id: string, updates: Partial<FinanceAccount>) => void;
  removeFinanceAccount: (id: string) => void;
  addTransaction: (tx: Omit<Transaction, Stamps>) => string;
  updateTransaction: (id: string, updates: Partial<Transaction>) => void;
  removeTransaction: (id: string) => void;
  addFinanceBudget: (budget: Omit<FinanceBudget, Stamps>) => string;
  updateFinanceBudget: (id: string, updates: Partial<FinanceBudget>) => void;
  removeFinanceBudget: (id: string) => void;
  addSavingsGoal: (goal: Omit<SavingsGoal, Stamps>) => string;
  updateSavingsGoal: (id: string, updates: Partial<SavingsGoal>) => void;
  removeSavingsGoal: (id: string) => void;
}

export const FinanceCtx = createContext<FinanceContextValue | null>(null);

export function useFinanceContext(): FinanceContextValue {
  const ctx = useContext(FinanceCtx);
  if (!ctx) throw new Error('useFinanceContext must be used within FinanceProvider');
  return ctx;
}

interface Ledger {
  accounts: FinanceAccount[];
  transactions: Transaction[];
  budgets: FinanceBudget[];
  goals: SavingsGoal[];
}

const EMPTY_LEDGER: Ledger = { accounts: [], transactions: [], budgets: [], goals: [] };

function replaceById<T extends { id: string }>(records: T[], saved: T): T[] {
  return records.some(record => record.id === saved.id)
    ? records.map(record => (record.id === saved.id ? saved : record))
    : [...records, saved];
}

function replaceAll<T extends { id: string }>(records: T[], saved: T[]): T[] {
  return saved.reduce((current, record) => replaceById(current, record), records);
}

function withoutId<T extends { id: string }>(records: T[], id: string): T[] {
  return records.filter(record => record.id !== id);
}

/** A record as shown before the service confirms it: keeps its first creation stamp. */
function pending<T extends { id: string; createdAt: string; updatedAt: string }>(records: T[], id: string,
  fields: Omit<T, Stamps>): T {
  const now = new Date().toISOString();
  const createdAt = records.find(record => record.id === id)?.createdAt ?? now;
  return { ...fields, id, createdAt, updatedAt: now } as T;
}

function accountInput({ name, type, balance, currency, color, icon, includeInNetWorth, sortOrder }: FinanceAccount):
AccountInput {
  return { name, type, balance, currency, color, icon, includeInNetWorth, sortOrder };
}

function transactionInput({ type, amount, category, accountId, toAccountId, description, date, tags }: Transaction):
TransactionInput {
  return { type, amount, category, accountId, toAccountId, description, date, tags };
}

function goalInput({ name, targetAmount, currentAmount, linkedAccountId, icon, deadline, completed }: SavingsGoal):
SavingsGoalInput {
  return { name, targetAmount, currentAmount, linkedAccountId, icon, deadline, completed };
}

function find<T extends { id: string }>(records: T[], id: string, what: string): T {
  const record = records.find(candidate => candidate.id === id);
  if (!record) throw new Error(`${what} not found.`);
  return record;
}

export function FinanceProvider({ children }: { children: ReactNode }) {
  const [ledger, setLedger] = useState<Ledger>(EMPTY_LEDGER);
  const ledgerRef = useRef<Ledger>(EMPTY_LEDGER);
  const publish = useCallback((change: (current: Ledger) => Partial<Ledger>) => {
    const next = { ...ledgerRef.current, ...change(ledgerRef.current) };
    ledgerRef.current = next;
    setLedger(next);
  }, []);

  const load = useCallback(async () => {
    const loadedLedger = await getLedger();
    publish(() => ({
      accounts: loadedLedger.accounts,
      transactions: loadedLedger.transactions,
      budgets: loadedLedger.budgets,
      goals: loadedLedger.savingsGoals,
    }));
  }, [publish]);
  const { loaded, error, reload, reportFailure } = useServiceLoad('Finance', isFinanceServiceEnabled(), load,
    LIVE_DOMAINS.finance);

  // ── Service confirmations ──

  const confirmAccount = useCallback((saved: FinanceAccount) => {
    publish(current => ({ accounts: replaceById(current.accounts, saved) }));
  }, [publish]);

  const confirmAccounts = useCallback((changed: FinanceAccount[]) => {
    publish(current => ({ accounts: replaceAll(current.accounts, changed) }));
  }, [publish]);

  const confirmTransaction = useCallback((change: FinanceTransactionChange) => {
    publish(current => ({
      transactions: replaceById(current.transactions, change.transaction),
      accounts: replaceAll(current.accounts, change.accounts),
    }));
  }, [publish]);

  const confirmAccountRemoval = useCallback((removed: FinanceAccountDeleted) => {
    const removedIds = new Set(removed.removedTransactionIds);
    publish(current => ({
      transactions: current.transactions.filter(transaction => !removedIds.has(transaction.id)),
      goals: current.goals.map(goal => (goal.linkedAccountId === removed.id ? { ...goal, linkedAccountId: undefined } : goal)),
    }));
  }, [publish]);

  const confirmBudget = useCallback((saved: FinanceBudget) => {
    publish(current => ({ budgets: replaceById(current.budgets, saved) }));
  }, [publish]);

  const confirmGoal = useCallback((saved: SavingsGoal) => {
    publish(current => ({ goals: replaceById(current.goals, saved) }));
  }, [publish]);

  // ── Accounts ──

  const showAccount = useCallback((id: string, fields: Omit<FinanceAccount, Stamps>) => {
    const shown = pending(ledgerRef.current.accounts, id, fields);
    publish(current => ({ accounts: replaceById(current.accounts, shown) }));
    return shown;
  }, [publish]);

  const addFinanceAccount = useCallback((acc: Omit<FinanceAccount, Stamps>): string => {
    const id = uuid();
    showAccount(id, acc);
    saveAccount(id, acc).then(confirmAccount, reportFailure);
    return id;
  }, [confirmAccount, reportFailure, showAccount]);

  const updateFinanceAccount = useCallback((id: string, updates: Partial<FinanceAccount>) => {
    const current = find(ledgerRef.current.accounts, id, 'Finance account');
    const shown = showAccount(id, { ...current, ...updates });
    saveAccount(id, accountInput(shown)).then(confirmAccount, reportFailure);
  }, [confirmAccount, reportFailure, showAccount]);

  const removeFinanceAccount = useCallback((id: string) => {
    publish(current => ({
      accounts: withoutId(current.accounts, id),
      transactions: current.transactions.filter(transaction => transaction.accountId !== id && transaction.toAccountId !== id),
    }));
    deleteAccount(id).then(confirmAccountRemoval, reportFailure);
  }, [confirmAccountRemoval, publish, reportFailure]);

  // ── Transactions (balances come back from the service) ──

  const showTransaction = useCallback((id: string, fields: Omit<Transaction, Stamps>) => {
    const shown = pending(ledgerRef.current.transactions, id, fields);
    publish(current => ({
      transactions: current.transactions.some(transaction => transaction.id === id)
        ? replaceById(current.transactions, shown)
        : [shown, ...current.transactions],
    }));
    return shown;
  }, [publish]);

  const addTransaction = useCallback((tx: Omit<Transaction, Stamps>): string => {
    const id = uuid();
    showTransaction(id, tx);
    saveTransaction(id, tx).then(confirmTransaction, reportFailure);
    return id;
  }, [confirmTransaction, reportFailure, showTransaction]);

  const updateTransaction = useCallback((id: string, updates: Partial<Transaction>) => {
    const current = find(ledgerRef.current.transactions, id, 'Transaction');
    const shown = showTransaction(id, { ...current, ...updates });
    saveTransaction(id, transactionInput(shown)).then(confirmTransaction, reportFailure);
  }, [confirmTransaction, reportFailure, showTransaction]);

  const removeTransaction = useCallback((id: string) => {
    publish(current => ({ transactions: withoutId(current.transactions, id) }));
    deleteTransaction(id).then(removed => confirmAccounts(removed.accounts), reportFailure);
  }, [confirmAccounts, publish, reportFailure]);

  // ── Budgets ──

  const showBudget = useCallback((id: string, fields: BudgetInput) => {
    const shown = pending(ledgerRef.current.budgets, id, fields);
    publish(current => ({ budgets: replaceById(current.budgets, shown) }));
    return shown;
  }, [publish]);

  const addFinanceBudget = useCallback((budget: BudgetInput): string => {
    const id = uuid();
    showBudget(id, budget);
    saveBudget(id, budget).then(confirmBudget, reportFailure);
    return id;
  }, [confirmBudget, reportFailure, showBudget]);

  const updateFinanceBudget = useCallback((id: string, updates: Partial<FinanceBudget>) => {
    const current = find(ledgerRef.current.budgets, id, 'Budget');
    const shown = showBudget(id, { ...current, ...updates });
    saveBudget(id, shown).then(confirmBudget, reportFailure);
  }, [confirmBudget, reportFailure, showBudget]);

  const removeFinanceBudget = useCallback((id: string) => {
    publish(current => ({ budgets: withoutId(current.budgets, id) }));
    deleteBudget(id).catch(reportFailure);
  }, [publish, reportFailure]);

  // ── Savings goals ──

  const showGoal = useCallback((id: string, fields: Omit<SavingsGoal, Stamps>) => {
    const shown = pending(ledgerRef.current.goals, id, fields);
    publish(current => ({ goals: replaceById(current.goals, shown) }));
    return shown;
  }, [publish]);

  const addSavingsGoal = useCallback((goal: Omit<SavingsGoal, Stamps>): string => {
    const id = uuid();
    const shown = showGoal(id, goal);
    saveSavingsGoal(id, goalInput(shown)).then(confirmGoal, reportFailure);
    return id;
  }, [confirmGoal, reportFailure, showGoal]);

  const updateSavingsGoal = useCallback((id: string, updates: Partial<SavingsGoal>) => {
    const current = find(ledgerRef.current.goals, id, 'Savings goal');
    const shown = showGoal(id, { ...current, ...updates });
    saveSavingsGoal(id, goalInput(shown)).then(confirmGoal, reportFailure);
  }, [confirmGoal, reportFailure, showGoal]);

  const removeSavingsGoal = useCallback((id: string) => {
    publish(current => ({ goals: withoutId(current.goals, id) }));
    deleteSavingsGoal(id).catch(reportFailure);
  }, [publish, reportFailure]);

  const value = useMemo<FinanceContextValue>(() => ({
    financeAccounts: ledger.accounts,
    transactions: ledger.transactions,
    financeBudgets: ledger.budgets,
    savingsGoals: ledger.goals,
    loaded,
    error,
    reload,
    addFinanceAccount, updateFinanceAccount, removeFinanceAccount,
    addTransaction, updateTransaction, removeTransaction,
    addFinanceBudget, updateFinanceBudget, removeFinanceBudget,
    addSavingsGoal, updateSavingsGoal, removeSavingsGoal,
  }), [ledger, loaded, error, reload,
    addFinanceAccount, updateFinanceAccount, removeFinanceAccount,
    addTransaction, updateTransaction, removeTransaction,
    addFinanceBudget, updateFinanceBudget, removeFinanceBudget,
    addSavingsGoal, updateSavingsGoal, removeSavingsGoal]);

  return <FinanceCtx.Provider value={value}>{children}</FinanceCtx.Provider>;
}
