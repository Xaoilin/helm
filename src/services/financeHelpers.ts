/**
 * Finance helper utilities — all money in pence (integer math).
 */

import type { Transaction, FinanceAccount, ExpenseCategory, TransactionCategory, FinanceAccountType } from '../types/domain';

// ── Currency formatting ──

export function formatGBP(pence: number): string {
  const pounds = pence / 100;
  const abs = Math.abs(pounds);
  const formatted = abs.toLocaleString('en-GB', { minimumFractionDigits: 2, maximumFractionDigits: 2 });
  return `${pence < 0 ? '-' : ''}\u00a3${formatted}`;
}

export function parseToPence(input: string): number {
  const num = parseFloat(input);
  if (isNaN(num)) return 0;
  return Math.round(num * 100);
}

// ── Date helpers ──

export function toMonthStr(d: Date): string {
  return `${d.getFullYear()}-${String(d.getMonth() + 1).padStart(2, '0')}`;
}

export function toLocalDateStr(d: Date): string {
  return `${d.getFullYear()}-${String(d.getMonth() + 1).padStart(2, '0')}-${String(d.getDate()).padStart(2, '0')}`;
}

// ── Calculations ──

export function calculateNetWorth(accounts: FinanceAccount[]): number {
  return accounts.filter(a => a.includeInNetWorth).reduce((sum, a) => sum + a.balance, 0);
}

export function monthlyTotals(transactions: Transaction[], month: string): { income: number; expenses: number; net: number } {
  let income = 0;
  let expenses = 0;
  for (const t of transactions) {
    if (!t.date.startsWith(month)) continue;
    if (t.type === 'income') income += t.amount;
    else if (t.type === 'expense') expenses += t.amount;
  }
  return { income, expenses, net: income - expenses };
}

export function categorySpend(transactions: Transaction[], category: ExpenseCategory, month: string): number {
  return transactions
    .filter(t => t.type === 'expense' && t.category === category && t.date.startsWith(month))
    .reduce((sum, t) => sum + t.amount, 0);
}

// ── Category config ──

export interface CategoryDef {
  value: string;
  label: string;
  icon: string;
}

export const EXPENSE_CATEGORIES: CategoryDef[] = [
  { value: 'rent-mortgage', label: 'Rent / Mortgage', icon: '\u{1F3E0}' },
  { value: 'groceries', label: 'Groceries', icon: '\u{1F6D2}' },
  { value: 'transport', label: 'Transport', icon: '\u{1F687}' },
  { value: 'bills-utilities', label: 'Bills & Utilities', icon: '\u26A1' },
  { value: 'eating-out', label: 'Eating Out', icon: '\u{1F37D}\uFE0F' },
  { value: 'subscriptions', label: 'Subscriptions', icon: '\u{1F504}' },
  { value: 'entertainment', label: 'Entertainment', icon: '\u{1F3AC}' },
  { value: 'clothing', label: 'Clothing', icon: '\u{1F455}' },
  { value: 'health', label: 'Health', icon: '\u{1F48A}' },
  { value: 'education', label: 'Education', icon: '\u{1F4DA}' },
  { value: 'gifts', label: 'Gifts', icon: '\u{1F381}' },
  { value: 'personal-care', label: 'Personal Care', icon: '\u2702\uFE0F' },
  { value: 'home', label: 'Home & Garden', icon: '\u{1F527}' },
  { value: 'insurance', label: 'Insurance', icon: '\u{1F6E1}\uFE0F' },
  { value: 'charity', label: 'Charity / Zakat', icon: '\u{1F49D}' },
  { value: 'other-expense', label: 'Other', icon: '\u{1F4DD}' },
];

export const INCOME_CATEGORIES: CategoryDef[] = [
  { value: 'salary', label: 'Salary', icon: '\u{1F4B0}' },
  { value: 'freelance', label: 'Freelance', icon: '\u{1F4BB}' },
  { value: 'dividends', label: 'Dividends', icon: '\u{1F4C8}' },
  { value: 'interest', label: 'Interest', icon: '\u{1F3E6}' },
  { value: 'refund', label: 'Refund', icon: '\u21A9\uFE0F' },
  { value: 'gift-received', label: 'Gift Received', icon: '\u{1F380}' },
  { value: 'other-income', label: 'Other Income', icon: '\u{1F4B5}' },
];

export const ALL_CATEGORIES = [...EXPENSE_CATEGORIES, ...INCOME_CATEGORIES];

export function getCategoryDef(category: TransactionCategory): CategoryDef {
  return ALL_CATEGORIES.find(c => c.value === category) || { value: category, label: category, icon: '\u{1F4DD}' };
}

export const ACCOUNT_TYPES: { value: FinanceAccountType; label: string; icon: string; isDebt: boolean }[] = [
  { value: 'current', label: 'Current Account', icon: '\u{1F3E6}', isDebt: false },
  { value: 'savings', label: 'Savings Account', icon: '\u{1F4B0}', isDebt: false },
  { value: 'credit-card', label: 'Credit Card', icon: '\u{1F4B3}', isDebt: true },
  { value: 'isa', label: 'ISA', icon: '\u{1F4C8}', isDebt: false },
  { value: 'pension', label: 'Pension', icon: '\u{1F3DB}\uFE0F', isDebt: false },
  { value: 'loan-mortgage', label: 'Loan / Mortgage', icon: '\u{1F3E0}', isDebt: true },
];

export const ACCOUNT_COLORS = ['#3b82f6', '#22c55e', '#f59e0b', '#a855f7', '#ec4899', '#14b8a6', '#f97316', '#ef4444'];
