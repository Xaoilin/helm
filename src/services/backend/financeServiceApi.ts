/**
 * Typed calls to the finance service (`/api/finance/v1`), the system of record for manual accounts,
 * transactions, budgets and savings goals, the banking review and equity positions. Record IDs are chosen
 * here, so a retried create never makes a second record; every write names one record and carries an
 * Idempotency-Key (a new one per action, or the caller's own when it retries the same action). Balance
 * effects of transactions are worked out by the service; the app shows the accounts it returns.
 */
import type { z } from 'zod';
import { FINANCE_BACKEND_URL } from '../../config';
import type {
  EquityPosition,
  EquityPositionDraft,
  FinanceAccount,
  FinanceBudget,
  FinanceReview,
  FinanceReviewDraft,
  SavingsGoal,
  Transaction,
} from '../../types/domain';
import { newWriteKey } from './idempotencyKeys';
import {
  accountDeletedSchema,
  accountSchema,
  budgetSchema,
  deletedSchema,
  equityPositionSchema,
  equityPositionsSchema,
  ledgerSchema,
  reviewEnvelopeSchema,
  reviewSavedSchema,
  savingsGoalSchema,
  transactionChangeSchema,
  transactionDeletedSchema,
  type EquityPositionPage,
  type FinanceAccountDeleted,
  type FinanceLedger,
  type FinanceTransactionChange,
  type FinanceTransactionDeleted,
} from './financeContracts';
import { callService } from './serviceClient';

const BASE = '/api/finance/v1';

/** The service's largest equity page. */
export const EQUITY_PAGE_LIMIT = 100;

export function isFinanceServiceEnabled(): boolean {
  return Boolean(FINANCE_BACKEND_URL.trim());
}

function path(...segments: string[]): string {
  return `${BASE}/${segments.map(segment => encodeURIComponent(segment)).join('/')}`;
}

function read<T>(to: string, schema: z.ZodType<T>): Promise<T> {
  return callService(FINANCE_BACKEND_URL, 'GET', to, schema);
}

function write<T>(method: 'PUT' | 'DELETE', to: string, schema: z.ZodType<T>, body?: unknown,
  idempotencyKey: string = newWriteKey()): Promise<T> {
  return callService<T>(FINANCE_BACKEND_URL, method, to, schema, body, { idempotencyKey });
}

/** Optional values the app keeps as `undefined` are sent as JSON null (absent). */
function withoutUndefined<T extends object>(value: T): T {
  return JSON.parse(JSON.stringify(value)) as T;
}

// ── Ledger ──

export type AccountInput = Omit<FinanceAccount, 'id' | 'createdAt' | 'updatedAt'>;
export type TransactionInput = Omit<Transaction, 'id' | 'createdAt' | 'updatedAt'>;
export type BudgetInput = Omit<FinanceBudget, 'id' | 'createdAt' | 'updatedAt'>;
/** `completedAt` is stamped by the service when `completed` turns true. */
export type SavingsGoalInput = Omit<SavingsGoal, 'id' | 'completedAt' | 'createdAt' | 'updatedAt'>;

export function getLedger(): Promise<FinanceLedger> {
  return read(`${BASE}/ledger`, ledgerSchema);
}

export function saveAccount(id: string, account: AccountInput): Promise<FinanceAccount> {
  return write('PUT', path('accounts', id), accountSchema, {
    name: account.name,
    type: account.type,
    balance: account.balance,
    currency: account.currency,
    color: account.color,
    icon: account.icon,
    includeInNetWorth: account.includeInNetWorth,
    sortOrder: account.sortOrder,
  });
}

/** Removes the account and its transactions (transfers into it too). */
export function deleteAccount(id: string): Promise<FinanceAccountDeleted> {
  return write('DELETE', path('accounts', id), accountDeletedSchema);
}

/** Creates or replaces a transaction; the service applies (or re-applies) its balance effect. */
export function saveTransaction(id: string, transaction: TransactionInput): Promise<FinanceTransactionChange> {
  return write('PUT', path('transactions', id), transactionChangeSchema, withoutUndefined({
    type: transaction.type,
    amount: transaction.amount,
    category: transaction.category,
    accountId: transaction.accountId,
    toAccountId: transaction.toAccountId,
    description: transaction.description,
    date: transaction.date,
    tags: transaction.tags,
  }));
}

/** Removes a transaction; the service reverses its balance effect. */
export function deleteTransaction(id: string): Promise<FinanceTransactionDeleted> {
  return write('DELETE', path('transactions', id), transactionDeletedSchema);
}

export function saveBudget(id: string, budget: BudgetInput): Promise<FinanceBudget> {
  return write('PUT', path('budgets', id), budgetSchema, { category: budget.category, monthlyLimit: budget.monthlyLimit });
}

export async function deleteBudget(id: string): Promise<void> {
  await write('DELETE', path('budgets', id), deletedSchema);
}

export function saveSavingsGoal(id: string, goal: SavingsGoalInput): Promise<SavingsGoal> {
  return write('PUT', path('savings-goals', id), savingsGoalSchema, withoutUndefined({
    name: goal.name,
    targetAmount: goal.targetAmount,
    currentAmount: goal.currentAmount,
    linkedAccountId: goal.linkedAccountId,
    icon: goal.icon,
    deadline: goal.deadline,
    completed: goal.completed,
  }));
}

export async function deleteSavingsGoal(id: string): Promise<void> {
  await write('DELETE', path('savings-goals', id), deletedSchema);
}

// ── Banking review ──

export async function getReview(): Promise<FinanceReview | null> {
  return (await read(`${BASE}/review`, reviewEnvelopeSchema)).review;
}

/**
 * Replaces the whole review. `expectedUpdatedAt` is the stored review's `updatedAt` (null for the first
 * save); a review saved elsewhere since is refused with 409 `review_changed`.
 */
export async function saveReview(review: FinanceReviewDraft, expectedUpdatedAt: string | null,
  idempotencyKey?: string): Promise<FinanceReview> {
  return (await write('PUT', `${BASE}/review`, reviewSavedSchema, { review, expectedUpdatedAt }, idempotencyKey)).review;
}

// ── Equity ──

export interface EquityQuery {
  query?: string;
  limit?: number;
  offset?: number;
}

export function listEquityPositions({ query = '', limit = 50, offset = 0 }: EquityQuery = {}): Promise<EquityPositionPage> {
  const search = new URLSearchParams({ query, limit: String(limit), offset: String(offset) });
  return read(`${BASE}/equity/positions?${search}`, equityPositionsSchema);
}

/** Every position, read a page at a time. */
export async function getAllEquityPositions(): Promise<EquityPosition[]> {
  const positions: EquityPosition[] = [];
  for (;;) {
    const page = await listEquityPositions({ limit: EQUITY_PAGE_LIMIT, offset: positions.length });
    positions.push(...page.positions);
    if (page.positions.length === 0 || positions.length >= page.total) return positions;
  }
}

export function getEquityPosition(id: string): Promise<EquityPosition> {
  return read(path('equity', 'positions', id), equityPositionSchema);
}

/**
 * Creates (`expectedUpdatedAt` null) or replaces a position. A stale replace is refused with 409
 * `position_changed`; creating one that exists with 409 `position_exists`.
 */
export function saveEquityPosition(id: string, position: EquityPositionDraft, expectedUpdatedAt: string | null,
  idempotencyKey?: string): Promise<EquityPosition> {
  return write('PUT', path('equity', 'positions', id), equityPositionSchema, { position, expectedUpdatedAt },
    idempotencyKey);
}

export async function deleteEquityPosition(id: string, expectedUpdatedAt: string, idempotencyKey?: string): Promise<void> {
  const search = new URLSearchParams({ expectedUpdatedAt });
  await write('DELETE', `${path('equity', 'positions', id)}?${search}`, deletedSchema, undefined, idempotencyKey);
}
