/**
 * The finance service client: each call reaches the right endpoint with an Idempotency-Key on every write,
 * and the contract examples in contracts/finance-service parse into the app's domain shapes.
 */
import { readFileSync } from 'node:fs';
import { join } from 'node:path';
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';
import { resetServiceCircuits, ServiceError } from '../services/backend/serviceClient';
import {
  deleteAccount,
  deleteEquityPosition,
  deleteTransaction,
  getAllEquityPositions,
  getLedger,
  getReview,
  saveEquityPosition,
  saveReview,
  saveSavingsGoal,
  saveTransaction,
} from '../services/backend/financeServiceApi';
import type { EquityPositionDraft, FinanceReviewDraft } from '../types/domain';

vi.mock('../config', () => ({ FINANCE_BACKEND_URL: 'https://finance.example.test/' }));
vi.mock('../store/supabase', () => ({
  SessionUnavailableError: class extends Error {},
  getFreshAccessToken: async () => 'user-access-token',
}));

function fixture(name: string): { status: number; body: unknown } {
  return JSON.parse(readFileSync(join(process.cwd(), 'contracts', 'finance-service', `${name}.json`), 'utf8'));
}

function answer(name: string): Response {
  const { status, body } = fixture(name);
  return Response.json(body, { status });
}

let fetchMock: ReturnType<typeof vi.spyOn>;

function sent(index = 0): { url: string; method: string; headers: Record<string, string>; body: unknown } {
  const [url, init] = fetchMock.mock.calls[index] as [string, RequestInit];
  return {
    url,
    method: String(init.method),
    headers: init.headers as Record<string, string>,
    body: init.body === undefined ? undefined : JSON.parse(String(init.body)),
  };
}

beforeEach(() => {
  resetServiceCircuits();
  fetchMock = vi.spyOn(globalThis, 'fetch');
});
afterEach(() => {
  vi.restoreAllMocks();
});

describe('finance service ledger', () => {
  it('reads the ledger and turns absent optionals into undefined', async () => {
    fetchMock.mockResolvedValue(answer('ledger'));

    const ledger = await getLedger();

    expect(sent().url).toBe('https://finance.example.test/api/finance/v1/ledger');
    expect(sent().method).toBe('GET');
    expect(ledger.accounts.map(account => account.name)).toEqual(['Example Bank', 'Example Savings']);
    const food = ledger.transactions.find(transaction => transaction.id === 'food');
    expect(food).toBeDefined();
    expect(food?.toAccountId).toBeUndefined();
    expect(ledger.savingsGoals[0].completedAt).toBeUndefined();
    expect(ledger.budgets[0]).toMatchObject({ category: 'groceries', monthlyLimit: 30000 });
  });

  it('saves a transaction under its own ID with an Idempotency-Key and returns the changed accounts', async () => {
    fetchMock.mockResolvedValue(answer('transaction-saved'));

    const change = await saveTransaction('pay', {
      type: 'transfer', amount: 12345, category: 'transfer', accountId: 'example-current',
      toAccountId: 'example-savings', description: 'Monthly saving', date: '2026-09-26', tags: undefined,
    });

    const request = sent();
    expect(request.url).toBe('https://finance.example.test/api/finance/v1/transactions/pay');
    expect(request.method).toBe('PUT');
    expect(request.headers['Idempotency-Key']).toMatch(/^[0-9a-f-]{36}$/u);
    expect(request.body).toEqual({
      type: 'transfer', amount: 12345, category: 'transfer', accountId: 'example-current',
      toAccountId: 'example-savings', description: 'Monthly saving', date: '2026-09-26',
    });
    expect(change.transaction.id).toBe('pay');
    expect(change.transaction.toAccountId).toBeUndefined();
    expect(change.accounts.map(account => account.balance)).toEqual([360401]);
  });

  it('removes a transaction and an account with their own write keys', async () => {
    fetchMock.mockResolvedValueOnce(answer('transaction-deleted')).mockResolvedValueOnce(answer('account-deleted'));

    const removed = await deleteTransaction('pay');
    const account = await deleteAccount('savings');

    expect(sent(0)).toMatchObject({ method: 'DELETE', url: expect.stringContaining('/transactions/pay') });
    expect(sent(1)).toMatchObject({ method: 'DELETE', url: expect.stringContaining('/accounts/savings') });
    expect(sent(0).headers['Idempotency-Key']).not.toBe(sent(1).headers['Idempotency-Key']);
    expect(removed.accounts.map(changed => changed.balance)).toEqual([110401]);
    expect(account.removedTransactionIds).toEqual(['move']);
  });

  it('never sends the completion stamp of a savings goal', async () => {
    fetchMock.mockResolvedValue(answer('savings-goal-saved'));

    await saveSavingsGoal('example-emergency', {
      name: 'Emergency fund', targetAmount: 100000, currentAmount: 50000, linkedAccountId: 'example-savings',
      icon: '£', deadline: undefined, completed: false,
      ...{ completedAt: '2026-09-27T06:00:00Z' },
    });

    expect(sent().body).toEqual({
      name: 'Emergency fund', targetAmount: 100000, currentAmount: 50000, linkedAccountId: 'example-savings',
      icon: '£', completed: false,
    });
  });

  it('refuses a transfer into its own account in the service\'s words', async () => {
    const invalid = fixture('transaction-invalid') as { status: number; body: { code: string; message: string } };
    fetchMock.mockResolvedValue(answer('transaction-invalid'));

    await expect(saveTransaction('bad', {
      type: 'transfer', amount: 100, category: 'transfer', accountId: 'current', toAccountId: 'current',
      description: 'Loop', date: '2026-09-26', tags: undefined,
    })).rejects.toMatchObject({ status: 400, code: 'invalid_to_account', message: invalid.body.message });
  });

  it('reports a refusal as a service error with its code', async () => {
    fetchMock.mockImplementation(async () => answer('agent-not-approved'));

    await expect(getLedger()).rejects.toMatchObject({ status: 403, code: 'agent_not_approved' });
  });
});

describe('finance service banking review', () => {
  it('reads no review before the first save', async () => {
    fetchMock.mockResolvedValue(answer('review-empty'));

    await expect(getReview()).resolves.toBeNull();
  });

  it('reads the review and sends the expected revision when saving it', async () => {
    fetchMock.mockResolvedValueOnce(answer('review')).mockResolvedValueOnce(answer('review-saved'));

    const review = await getReview();
    expect(review?.loans[0].balancePence).toBeUndefined();
    expect(review?.loans[1].balancePence).toBe(0);
    const { updatedAt } = review!;
    const draft = Object.fromEntries(Object.entries(review!)
      .filter(([key]) => !['id', 'createdAt', 'updatedAt'].includes(key))) as FinanceReviewDraft;
    const saved = await saveReview(draft, updatedAt, 'review-request-1');

    expect(sent(1)).toMatchObject({ method: 'PUT', url: 'https://finance.example.test/api/finance/v1/review' });
    expect(sent(1).headers['Idempotency-Key']).toBe('review-request-1');
    expect(sent(1).body).toMatchObject({ expectedUpdatedAt: updatedAt, review: { asOf: draft.asOf } });
    expect(saved.id).toBe(review!.id);
  });

  it('refuses a review changed since it was read', async () => {
    fetchMock.mockResolvedValue(answer('review-changed'));

    const failure = await saveReview({} as FinanceReviewDraft, '2026-09-27T06:00:00Z').catch(error => error);

    expect(failure).toBeInstanceOf(ServiceError);
    expect(failure).toMatchObject({ status: 409, code: 'review_changed' });
  });
});

describe('finance service equity', () => {
  it('reads every page of positions', async () => {
    const page = fixture('equity-positions').body as { positions: unknown[]; total: number };
    fetchMock.mockResolvedValueOnce(Response.json({ positions: page.positions, total: 2 }))
      .mockResolvedValueOnce(Response.json({ positions: page.positions, total: 2 }));

    const positions = await getAllEquityPositions();

    expect(positions).toHaveLength(2);
    expect(sent(0).url).toBe('https://finance.example.test/api/finance/v1/equity/positions?query=&limit=100&offset=0');
    expect(sent(1).url).toBe('https://finance.example.test/api/finance/v1/equity/positions?query=&limit=100&offset=1');
    expect(positions[0].stockPlan.reviewMonth).toBeUndefined();
  });

  it('creates with a null revision, edits with the stored one and removes with it as a query parameter', async () => {
    fetchMock.mockResolvedValueOnce(answer('position-saved'))
      .mockResolvedValueOnce(answer('position-saved'))
      .mockResolvedValueOnce(answer('position-deleted'));
    const draft = { company: 'Example Co' } as EquityPositionDraft;

    await saveEquityPosition('example-equity', draft, null, 'create-1');
    await saveEquityPosition('example-equity', draft, '2026-09-27T06:00:00Z', 'edit-1');
    await deleteEquityPosition('example-equity', '2026-09-27T06:05:00Z', 'remove-1');

    expect(sent(0).body).toEqual({ position: draft, expectedUpdatedAt: null });
    expect(sent(0).headers['Idempotency-Key']).toBe('create-1');
    expect(sent(1).body).toEqual({ position: draft, expectedUpdatedAt: '2026-09-27T06:00:00Z' });
    expect(sent(2).url).toBe('https://finance.example.test/api/finance/v1/equity/positions/example-equity'
      + '?expectedUpdatedAt=2026-09-27T06%3A05%3A00Z');
    expect(sent(2).headers['Idempotency-Key']).toBe('remove-1');
  });

  it('refuses a stale edit with position_changed', async () => {
    fetchMock.mockResolvedValue(answer('position-changed'));

    await expect(saveEquityPosition('example-equity', {} as EquityPositionDraft, '2026-01-01T00:00:00Z'))
      .rejects.toMatchObject({ status: 409, code: 'position_changed' });
  });
});
