/**
 * A stateful stand-in for the finance service (manual accounts, transactions, budgets and savings goals; the
 * banking review; equity positions). It keeps records in the service's JSON shapes and answers through the
 * app's contract schemas, so it cannot drift from contracts/finance-service. Like the real service it owns
 * transaction balance effects and the review and equity revision checks; the shared write path in
 * fake-services.ts applies the Idempotency-Key rules.
 */
import type { Route } from '@playwright/test';
import type { z } from 'zod';
import type {
  EquityPosition,
  FinanceAccount,
  FinanceBudget,
  FinanceReview,
  SavingsGoal,
  Transaction,
} from '../../src/types/domain';
import { apiErrorSchema } from '../../src/services/backend/contracts';
import {
  accountDeletedSchema,
  accountSchema,
  budgetSchema,
  deletedSchema,
  equityPositionSchema,
  equityPositionsSchema,
  ledgerSchema,
  reviewEnvelopeSchema,
  savingsGoalSchema,
  transactionChangeSchema,
  transactionDeletedSchema,
} from '../../src/services/backend/financeContracts';

type Json = Record<string, unknown>;

export interface FakeFinanceSeed {
  accounts?: FinanceAccount[];
  transactions?: Transaction[];
  budgets?: FinanceBudget[];
  savingsGoals?: SavingsGoal[];
  review?: FinanceReview | null;
  equityPositions?: EquityPosition[];
}

export interface FakeFinance {
  accounts: Json[];
  transactions: Json[];
  budgets: Json[];
  goals: Json[];
  review: Json | null;
  positions: Json[];
}

const BASE = '/api/finance/v1';

/** Absent optional values are JSON null, as the service writes them. */
function withNulls(record: object, fields: string[]): Json {
  return { ...Object.fromEntries(fields.map(field => [field, null])),
    ...Object.fromEntries(Object.entries(record).filter(([, value]) => value !== undefined)) };
}

const serviceTransaction = (transaction: object) => ({ tags: [], ...withNulls(transaction, ['toAccountId']) });
const serviceGoal = (goal: object) => withNulls(goal, ['linkedAccountId', 'deadline', 'completedAt']);

export function createFakeFinance(seed: FakeFinanceSeed = {}): FakeFinance {
  return {
    accounts: (seed.accounts ?? []).map(account => ({ ...account })),
    transactions: (seed.transactions ?? []).map(serviceTransaction),
    budgets: (seed.budgets ?? []).map(budget => ({ ...budget })),
    goals: (seed.savingsGoals ?? []).map(serviceGoal),
    review: seed.review ? { ...seed.review } : null,
    positions: (seed.equityPositions ?? []).map(position => ({ ...position })),
  };
}

async function reply(route: Route, status: number, body: unknown, schema?: z.ZodType): Promise<void> {
  if (schema) schema.parse(body);
  await route.fulfill({ status, contentType: 'application/json', body: JSON.stringify(body) });
}

function refuse(route: Route, status: number, code: string, message: string): Promise<void> {
  return reply(route, status, { code, message }, apiErrorSchema);
}

function upsert(records: Json[], record: Json): void {
  const index = records.findIndex(candidate => candidate.id === record.id);
  if (index >= 0) records[index] = record;
  else records.push(record);
}

/** The balance change a transaction makes, by account ID; `sign` -1 reverts it. */
function applyEffect(finance: FakeFinance, transaction: Json, sign: 1 | -1, now: string, changed: Set<string>): void {
  const amount = Number(transaction.amount) * sign;
  const move = (accountId: unknown, delta: number) => {
    const account = finance.accounts.find(candidate => candidate.id === accountId);
    if (!account) return;
    account.balance = Number(account.balance) + delta;
    account.updatedAt = now;
    changed.add(String(account.id));
  };
  if (transaction.type === 'income') move(transaction.accountId, amount);
  else move(transaction.accountId, -amount);
  if (transaction.type === 'transfer') move(transaction.toAccountId, amount);
}

function changedAccounts(finance: FakeFinance, ids: Set<string>): Json[] {
  return finance.accounts.filter(account => ids.has(String(account.id)));
}

function sortedLedger(finance: FakeFinance) {
  return {
    accounts: [...finance.accounts].sort((left, right) => Number(left.sortOrder) - Number(right.sortOrder)
      || String(left.createdAt).localeCompare(String(right.createdAt))),
    transactions: [...finance.transactions].sort((left, right) => String(right.date).localeCompare(String(left.date))
      || String(right.createdAt).localeCompare(String(left.createdAt))),
    budgets: finance.budgets,
    savingsGoals: finance.goals,
  };
}

export function handleFinance(
  route: Route, finance: FakeFinance, method: string, path: string, url: URL, body: Json | null, now: Date,
): Promise<void> {
  const stamp = now.toISOString();
  const [, resource, id] = path.slice(BASE.length).split('/').map(decodeURIComponent);
  if (method === 'GET' && resource === 'ledger') return reply(route, 200, sortedLedger(finance), ledgerSchema);
  if (resource === 'accounts') return handleAccount(route, finance, method, id, body, stamp);
  if (resource === 'transactions') return handleTransaction(route, finance, method, id, body, stamp);
  if (resource === 'budgets') return handleBudget(route, finance, method, id, body, stamp);
  if (resource === 'savings-goals') return handleGoal(route, finance, method, id, body, stamp);
  if (resource === 'review') return handleReview(route, finance, method, body, stamp);
  if (resource === 'equity') return handleEquity(route, finance, method, path, url, body, stamp);
  return refuse(route, 404, 'not_found', `No fake for ${method} ${path}.`);
}

function handleAccount(route: Route, finance: FakeFinance, method: string, id: string, body: Json | null,
  stamp: string): Promise<void> {
  if (method === 'PUT') {
    const existing = finance.accounts.find(account => account.id === id);
    const account = { ...body, id, createdAt: existing?.createdAt ?? stamp, updatedAt: stamp };
    upsert(finance.accounts, account);
    return reply(route, 200, account, accountSchema);
  }
  const removed = finance.transactions.filter(transaction => transaction.accountId === id || transaction.toAccountId === id);
  finance.accounts = finance.accounts.filter(account => account.id !== id);
  finance.transactions = finance.transactions.filter(transaction => !removed.includes(transaction));
  finance.goals.forEach(goal => { if (goal.linkedAccountId === id) goal.linkedAccountId = null; });
  return reply(route, 200, { id, removedTransactionIds: removed.map(transaction => transaction.id) }, accountDeletedSchema);
}

function handleTransaction(route: Route, finance: FakeFinance, method: string, id: string, body: Json | null,
  stamp: string): Promise<void> {
  const existing = finance.transactions.find(transaction => transaction.id === id);
  const changed = new Set<string>();
  if (existing) applyEffect(finance, existing, -1, stamp, changed);
  if (method === 'DELETE') {
    finance.transactions = finance.transactions.filter(transaction => transaction.id !== id);
    return reply(route, 200, { id, accounts: changedAccounts(finance, changed) }, transactionDeletedSchema);
  }
  const transaction = serviceTransaction({ ...body, id, createdAt: existing?.createdAt ?? stamp, updatedAt: stamp });
  applyEffect(finance, transaction, 1, stamp, changed);
  upsert(finance.transactions, transaction);
  return reply(route, 200, { transaction, accounts: changedAccounts(finance, changed) }, transactionChangeSchema);
}

function handleBudget(route: Route, finance: FakeFinance, method: string, id: string, body: Json | null,
  stamp: string): Promise<void> {
  if (method === 'DELETE') {
    finance.budgets = finance.budgets.filter(budget => budget.id !== id);
    return reply(route, 200, { id }, deletedSchema);
  }
  if (finance.budgets.some(budget => budget.id !== id && budget.category === body?.category)) {
    return refuse(route, 409, 'budget_exists', 'A budget for this category already exists.');
  }
  const existing = finance.budgets.find(budget => budget.id === id);
  const budget = { ...body, id, createdAt: existing?.createdAt ?? stamp, updatedAt: stamp };
  upsert(finance.budgets, budget);
  return reply(route, 200, budget, budgetSchema);
}

function handleGoal(route: Route, finance: FakeFinance, method: string, id: string, body: Json | null,
  stamp: string): Promise<void> {
  if (method === 'DELETE') {
    finance.goals = finance.goals.filter(goal => goal.id !== id);
    return reply(route, 200, { id }, deletedSchema);
  }
  const existing = finance.goals.find(goal => goal.id === id);
  const completedAt = body?.completed ? existing?.completedAt ?? stamp : null;
  const goal = serviceGoal({ ...body, id, completedAt, createdAt: existing?.createdAt ?? stamp, updatedAt: stamp });
  upsert(finance.goals, goal);
  return reply(route, 200, goal, savingsGoalSchema);
}

function handleReview(route: Route, finance: FakeFinance, method: string, body: Json | null,
  stamp: string): Promise<void> {
  if (method === 'GET') return reply(route, 200, { review: finance.review }, reviewEnvelopeSchema);
  const expected = body?.expectedUpdatedAt ?? null;
  if (expected === null && finance.review) return refuse(route, 409, 'review_exists', 'A banking review already exists.');
  if (expected !== null && finance.review?.updatedAt !== expected) {
    return refuse(route, 409, 'review_changed', 'The banking review changed since it was read; reload it and try again.');
  }
  finance.review = { ...(body?.review as Json), id: 'current', createdAt: finance.review?.createdAt ?? stamp, updatedAt: stamp };
  return reply(route, 200, { review: finance.review }, reviewEnvelopeSchema);
}

function handleEquity(route: Route, finance: FakeFinance, method: string, path: string, url: URL, body: Json | null,
  stamp: string): Promise<void> {
  const id = path.startsWith(`${BASE}/equity/positions/`) ? decodeURIComponent(path.split('/').at(-1) ?? '') : null;
  if (method === 'GET' && id === null) {
    const query = (url.searchParams.get('query') ?? '').toLowerCase();
    const limit = Number(url.searchParams.get('limit') ?? 50);
    const offset = Number(url.searchParams.get('offset') ?? 0);
    const matches = finance.positions.filter(position => String(position.company).toLowerCase().includes(query));
    return reply(route, 200, { positions: matches.slice(offset, offset + limit), total: matches.length },
      equityPositionsSchema);
  }
  const existing = finance.positions.find(position => position.id === id);
  if (method === 'GET') {
    return existing ? reply(route, 200, existing, equityPositionSchema)
      : refuse(route, 404, 'position_not_found', 'No such equity position.');
  }
  const expected = method === 'DELETE' ? url.searchParams.get('expectedUpdatedAt') : body?.expectedUpdatedAt ?? null;
  if (method === 'PUT' && expected === null) {
    if (existing) return refuse(route, 409, 'position_exists', 'This equity position already exists.');
  } else if (!existing) {
    return refuse(route, 404, 'position_not_found', 'No such equity position.');
  } else if (existing.updatedAt !== expected) {
    return refuse(route, 409, 'position_changed', 'The equity position changed since it was read; reload it and try again.');
  }
  if (method === 'DELETE') {
    finance.positions = finance.positions.filter(position => position.id !== id);
    return reply(route, 200, { id }, deletedSchema);
  }
  const position = { ...(body?.position as Json), id, createdAt: existing?.createdAt ?? stamp, updatedAt: stamp };
  upsert(finance.positions, position);
  return reply(route, 200, position, equityPositionSchema);
}
