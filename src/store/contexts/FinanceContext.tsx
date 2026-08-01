import { createContext, useContext, useEffect, useState, useCallback, type ReactNode } from 'react';
import { v4 as uuid } from 'uuid';
import type { FinanceAccount, Transaction, FinanceBudget, SavingsGoal } from '../../types/domain';
import { loadStore, saveStore } from '../persistence';
import { useRemoteStoreRefresh } from './useRemoteStoreRefresh';

export interface FinanceContextValue {
  financeAccounts: FinanceAccount[];
  transactions: Transaction[];
  financeBudgets: FinanceBudget[];
  savingsGoals: SavingsGoal[];
  loaded: boolean;
  addFinanceAccount: (acc: Omit<FinanceAccount, 'id' | 'createdAt' | 'updatedAt'>) => string;
  updateFinanceAccount: (id: string, updates: Partial<FinanceAccount>) => void;
  removeFinanceAccount: (id: string) => void;
  addTransaction: (tx: Omit<Transaction, 'id' | 'createdAt' | 'updatedAt'>) => string;
  updateTransaction: (id: string, updates: Partial<Transaction>) => void;
  removeTransaction: (id: string) => void;
  addFinanceBudget: (budget: Omit<FinanceBudget, 'id' | 'createdAt' | 'updatedAt'>) => string;
  updateFinanceBudget: (id: string, updates: Partial<FinanceBudget>) => void;
  removeFinanceBudget: (id: string) => void;
  addSavingsGoal: (goal: Omit<SavingsGoal, 'id' | 'createdAt' | 'updatedAt'>) => string;
  updateSavingsGoal: (id: string, updates: Partial<SavingsGoal>) => void;
  removeSavingsGoal: (id: string) => void;
}

const FinanceCtx = createContext<FinanceContextValue | null>(null);

export function useFinanceContext(): FinanceContextValue {
  const ctx = useContext(FinanceCtx);
  if (!ctx) throw new Error('useFinanceContext must be used within FinanceProvider');
  return ctx;
}

export function FinanceProvider({ children }: { children: ReactNode }) {
  const [financeAccounts, setFinanceAccounts] = useState<FinanceAccount[]>([]);
  const [transactions, setTransactions] = useState<Transaction[]>([]);
  const [financeBudgets, setFinanceBudgets] = useState<FinanceBudget[]>([]);
  const [savingsGoals, setSavingsGoals] = useState<SavingsGoal[]>([]);
  const [loaded, setLoaded] = useState(false);

  useEffect(() => {
    (async () => {
      const [accounts, txs, budgets, goals] = await Promise.all([
        loadStore<FinanceAccount[]>('financeAccounts'),
        loadStore<Transaction[]>('transactions'),
        loadStore<FinanceBudget[]>('financeBudgets'),
        loadStore<SavingsGoal[]>('savingsGoals'),
      ]);
      setFinanceAccounts(accounts ?? []);
      setTransactions(txs ?? []);
      setFinanceBudgets(budgets ?? []);
      setSavingsGoals(goals ?? []);
      setLoaded(true);
    })();
  }, []);

  useRemoteStoreRefresh(['financeAccounts', 'transactions', 'financeBudgets', 'savingsGoals'], async () => {
    const [accounts, txs, budgets, goals] = await Promise.all([
      loadStore<FinanceAccount[]>('financeAccounts'),
      loadStore<Transaction[]>('transactions'),
      loadStore<FinanceBudget[]>('financeBudgets'),
      loadStore<SavingsGoal[]>('savingsGoals'),
    ]);
    setFinanceAccounts(accounts ?? []);
    setTransactions(txs ?? []);
    setFinanceBudgets(budgets ?? []);
    setSavingsGoals(goals ?? []);
  });

  useEffect(() => { if (loaded) saveStore('financeAccounts', financeAccounts); }, [financeAccounts, loaded]);
  useEffect(() => { if (loaded) saveStore('transactions', transactions); }, [transactions, loaded]);
  useEffect(() => { if (loaded) saveStore('financeBudgets', financeBudgets); }, [financeBudgets, loaded]);
  useEffect(() => { if (loaded) saveStore('savingsGoals', savingsGoals); }, [savingsGoals, loaded]);

  // ── Accounts ──
  const addFinanceAccount = useCallback((acc: Omit<FinanceAccount, 'id' | 'createdAt' | 'updatedAt'>): string => {
    const id = uuid();
    const now = new Date().toISOString();
    setFinanceAccounts(prev => [...prev, { ...acc, id, createdAt: now, updatedAt: now }]);
    return id;
  }, []);

  const updateFinanceAccount = useCallback((id: string, updates: Partial<FinanceAccount>) => {
    setFinanceAccounts(prev =>
      prev.map(a => a.id === id ? { ...a, ...updates, updatedAt: new Date().toISOString() } : a)
    );
  }, []);

  const removeFinanceAccount = useCallback((id: string) => {
    setFinanceAccounts(prev => prev.filter(a => a.id !== id));
    setTransactions(prev => prev.filter(t => t.accountId !== id && t.toAccountId !== id));
  }, []);

  // ── Transactions (with auto balance update) ──
  const addTransaction = useCallback((tx: Omit<Transaction, 'id' | 'createdAt' | 'updatedAt'>): string => {
    const id = uuid();
    const now = new Date().toISOString();
    const newTx = { ...tx, id, createdAt: now, updatedAt: now };
    setTransactions(prev => [newTx, ...prev]);
    // Auto-update account balance
    setFinanceAccounts(prev =>
      prev.map(a => {
        if (a.id === tx.accountId) {
          const delta = tx.type === 'income' ? tx.amount : tx.type === 'expense' ? -tx.amount : -tx.amount;
          return { ...a, balance: a.balance + delta, updatedAt: now };
        }
        if (tx.toAccountId && a.id === tx.toAccountId && tx.type === 'transfer') {
          return { ...a, balance: a.balance + tx.amount, updatedAt: now };
        }
        return a;
      })
    );
    return id;
  }, []);

  const updateTransaction = useCallback((id: string, updates: Partial<Transaction>) => {
    setTransactions(prev =>
      prev.map(t => t.id === id ? { ...t, ...updates, updatedAt: new Date().toISOString() } : t)
    );
  }, []);

  const removeTransaction = useCallback((id: string) => {
    setTransactions(prev => {
      const tx = prev.find(t => t.id === id);
      if (tx) {
        // Reverse the balance effect
        setFinanceAccounts(accs =>
          accs.map(a => {
            if (a.id === tx.accountId) {
              const delta = tx.type === 'income' ? -tx.amount : tx.type === 'expense' ? tx.amount : tx.amount;
              return { ...a, balance: a.balance + delta, updatedAt: new Date().toISOString() };
            }
            if (tx.toAccountId && a.id === tx.toAccountId && tx.type === 'transfer') {
              return { ...a, balance: a.balance - tx.amount, updatedAt: new Date().toISOString() };
            }
            return a;
          })
        );
      }
      return prev.filter(t => t.id !== id);
    });
  }, []);

  // ── Budgets ──
  const addFinanceBudget = useCallback((budget: Omit<FinanceBudget, 'id' | 'createdAt' | 'updatedAt'>): string => {
    const id = uuid();
    const now = new Date().toISOString();
    setFinanceBudgets(prev => [...prev, { ...budget, id, createdAt: now, updatedAt: now }]);
    return id;
  }, []);

  const updateFinanceBudget = useCallback((id: string, updates: Partial<FinanceBudget>) => {
    setFinanceBudgets(prev =>
      prev.map(b => b.id === id ? { ...b, ...updates, updatedAt: new Date().toISOString() } : b)
    );
  }, []);

  const removeFinanceBudget = useCallback((id: string) => {
    setFinanceBudgets(prev => prev.filter(b => b.id !== id));
  }, []);

  // ── Savings Goals ──
  const addSavingsGoal = useCallback((goal: Omit<SavingsGoal, 'id' | 'createdAt' | 'updatedAt'>): string => {
    const id = uuid();
    const now = new Date().toISOString();
    setSavingsGoals(prev => [...prev, { ...goal, id, createdAt: now, updatedAt: now }]);
    return id;
  }, []);

  const updateSavingsGoal = useCallback((id: string, updates: Partial<SavingsGoal>) => {
    setSavingsGoals(prev =>
      prev.map(g => g.id === id ? { ...g, ...updates, updatedAt: new Date().toISOString() } : g)
    );
  }, []);

  const removeSavingsGoal = useCallback((id: string) => {
    setSavingsGoals(prev => prev.filter(g => g.id !== id));
  }, []);

  const value: FinanceContextValue = {
    financeAccounts, transactions, financeBudgets, savingsGoals, loaded,
    addFinanceAccount, updateFinanceAccount, removeFinanceAccount,
    addTransaction, updateTransaction, removeTransaction,
    addFinanceBudget, updateFinanceBudget, removeFinanceBudget,
    addSavingsGoal, updateSavingsGoal, removeSavingsGoal,
  };

  return <FinanceCtx.Provider value={value}>{children}</FinanceCtx.Provider>;
}
