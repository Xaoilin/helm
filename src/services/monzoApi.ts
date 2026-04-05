/**
 * Monzo Bank API client.
 *
 * Personal access: get a token from https://developers.monzo.com/
 * Docs: https://docs.monzo.com/
 *
 * Tokens expire — user must re-authenticate via Monzo app.
 * After initial 5-min window, limited to last 90 days of transactions.
 */

import type { Transaction, TransactionCategory } from '../types/domain';
import { toLocalDateStr } from './financeHelpers';
import { API_TIMEOUT } from '../config/constants';
import { monzoBreaker } from './serviceBreakers';

const MONZO_API = 'https://api.monzo.com';

// ── Category mapping: Monzo → HELM ──

const CATEGORY_MAP: Record<string, TransactionCategory> = {
  groceries: 'groceries',
  eating_out: 'eating-out',
  transport: 'transport',
  entertainment: 'entertainment',
  bills: 'bills-utilities',
  shopping: 'clothing',
  personal_care: 'personal-care',
  holidays: 'entertainment',
  general: 'other-expense',
  expenses: 'other-expense',
  cash: 'other-expense',
  income: 'other-income',
  savings: 'other-expense',
  charity: 'charity',
  family: 'gifts',
};

function mapCategory(monzoCategory: string): TransactionCategory {
  return CATEGORY_MAP[monzoCategory] || 'other-expense';
}

// ── API types ──

interface MonzoAccount {
  id: string;
  description: string;
  created: string;
  type: string;
}

interface MonzoMerchant {
  name: string;
  category?: string;
}

interface MonzoTransaction {
  id: string;
  amount: number; // pence, negative = debit
  currency: string;
  created: string;
  description: string;
  category: string;
  merchant?: MonzoMerchant;
  notes?: string;
  is_load?: boolean;
  decline_reason?: string;
  settled?: string;
}

// ── API calls ──

async function monzoFetch<T>(endpoint: string, token: string): Promise<T> {
  return monzoBreaker.call(async () => {
    const resp = await fetch(`${MONZO_API}${endpoint}`, {
      signal: AbortSignal.timeout(API_TIMEOUT.MONZO),
      headers: { Authorization: `Bearer ${token}` },
    });
    if (!resp.ok) {
      const body = await resp.text();
      throw new Error(`Monzo API ${resp.status}: ${body}`);
    }
    return resp.json();
  });
}

/** Verify token is valid. */
export async function verifyToken(token: string): Promise<boolean> {
  try {
    const data = await monzoFetch<{ authenticated: boolean }>('/ping/whoami', token);
    return data.authenticated;
  } catch {
    return false;
  }
}

/** List all Monzo accounts (all types, excludes closed). */
export async function fetchMonzoAccounts(token: string): Promise<MonzoAccount[]> {
  // Fetch all account types
  const types = ['uk_retail', 'uk_retail_joint', 'uk_business', 'uk_monzo_flex'];
  const results = await Promise.all(
    types.map(t => monzoFetch<{ accounts: MonzoAccount[] }>(`/accounts?account_type=${t}`, token).catch(() => ({ accounts: [] })))
  );
  const all = results.flatMap(r => r.accounts || []);
  // Filter out closed accounts
  return all.filter(a => !(a as any).closed);
}

/** Fetch transactions for an account (last 90 days by default). */
export async function fetchMonzoTransactions(token: string, accountId: string, since?: string): Promise<MonzoTransaction[]> {
  const sinceDate = since || new Date(Date.now() - 90 * 86400000).toISOString();
  const params = `account_id=${accountId}&since=${sinceDate}&limit=100`;
  const data = await monzoFetch<{ transactions: MonzoTransaction[] }>(`/transactions?${params}&expand[]=merchant`, token);
  return (data.transactions || []).filter(tx => !tx.decline_reason);
}

/** Convert a Monzo transaction to HELM's Transaction format. */
export function mapMonzoTransaction(
  monzoTx: MonzoTransaction,
  helmAccountId: string,
): Omit<Transaction, 'id' | 'createdAt' | 'updatedAt'> {
  const isIncome = monzoTx.amount > 0;
  const amount = Math.abs(monzoTx.amount); // always positive in HELM
  const description = monzoTx.merchant?.name || monzoTx.description || '';
  const category = isIncome ? 'other-income' as TransactionCategory : mapCategory(monzoTx.category);
  const date = toLocalDateStr(new Date(monzoTx.created));

  return {
    type: isIncome ? 'income' : 'expense',
    amount,
    category,
    accountId: helmAccountId,
    description,
    date,
    tags: [`monzo:${monzoTx.id}`], // for deduplication
  };
}

/** Check if a transaction was already imported (by Monzo ID tag). */
export function isAlreadyImported(monzoTxId: string, existingTransactions: Transaction[]): boolean {
  const tag = `monzo:${monzoTxId}`;
  return existingTransactions.some(tx => tx.tags?.includes(tag));
}
