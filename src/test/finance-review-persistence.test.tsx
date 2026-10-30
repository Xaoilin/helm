import { act, renderHook, waitFor } from '@testing-library/react';
import { beforeEach, describe, expect, it, vi } from 'vitest';
import { useFinanceReview } from '../store/contexts/useFinanceReview';
import { FINANCE_REVIEW } from './finance-review-fixture';

const api = vi.hoisted(() => ({ getReview: vi.fn(), saveReview: vi.fn(), enabled: true }));
vi.mock('../services/backend/financeServiceApi', () => ({
  getReview: api.getReview,
  saveReview: api.saveReview,
  isFinanceServiceEnabled: () => api.enabled,
}));

beforeEach(() => {
  api.getReview.mockReset();
  api.saveReview.mockReset();
  api.getReview.mockResolvedValue(FINANCE_REVIEW);
  api.enabled = true;
});

describe('banking review from the finance service', () => {
  it('reads the review the service holds', async () => {
    const { result } = renderHook(useFinanceReview);
    await waitFor(() => expect(result.current.review).toBe(FINANCE_REVIEW));
    expect(result.current).toMatchObject({ loaded: true, error: null, stale: false });
    expect(api.getReview).toHaveBeenCalledOnce();
  });

  it('shows that no review exists yet', async () => {
    api.getReview.mockResolvedValue(null);
    const { result } = renderHook(useFinanceReview);
    await waitFor(() => expect(result.current.loaded).toBe(true));
    expect(result.current.review).toBeNull();
    expect(result.current.error).toBeNull();
  });

  it('retains the last confirmed review on a failed refresh, then recovers on retry', async () => {
    const { result } = renderHook(useFinanceReview);
    await waitFor(() => expect(result.current.review).toBe(FINANCE_REVIEW));
    api.getReview.mockRejectedValueOnce(new Error('Finance service unavailable'));
    await act(async () => { await result.current.refresh(); });
    expect(result.current.review).toBe(FINANCE_REVIEW);
    expect(result.current.error).toBe('Finance service unavailable');
    expect(result.current.stale).toBe(true);
    await act(async () => { await result.current.refresh(); });
    expect(result.current.review).toBe(FINANCE_REVIEW);
    expect(result.current).toMatchObject({ error: null, stale: false });
  });

  it('says the service is not configured instead of reading anything', async () => {
    api.enabled = false;
    const { result } = renderHook(useFinanceReview);
    await waitFor(() => expect(result.current.loaded).toBe(true));
    expect(result.current.error).toMatch(/not configured/u);
    expect(api.getReview).not.toHaveBeenCalled();
  });

  it('saves only the group change with the exact revision and waits for server confirmation', async () => {
    const confirmed = { ...FINANCE_REVIEW, expenseGroups: [{ label: 'Retail purchases', group: 'necessary' as const }] };
    let finish!: (value: typeof confirmed) => void;
    api.saveReview.mockReturnValue(new Promise(resolve => { finish = resolve; }));
    const { result } = renderHook(useFinanceReview);
    await waitFor(() => expect(result.current.loaded).toBe(true));
    let saving!: Promise<void>;
    act(() => { saving = result.current.moveExpense('Retail purchases', 'necessary'); });
    expect(result.current.saving).toBe(true);
    expect(result.current.review).toBe(FINANCE_REVIEW);
    await act(async () => { await result.current.moveExpense('Retail purchases', 'necessary'); });
    expect(api.saveReview).toHaveBeenCalledOnce();
    const [draft, expectedUpdatedAt] = api.saveReview.mock.calls[0];
    expect(draft).toMatchObject({ budget: FINANCE_REVIEW.budget, months: FINANCE_REVIEW.months,
      loans: FINANCE_REVIEW.loans, sources: FINANCE_REVIEW.sources, expenseGroups: confirmed.expenseGroups });
    expect(draft).not.toHaveProperty('id');
    expect(draft).not.toHaveProperty('createdAt');
    expect(draft).not.toHaveProperty('updatedAt');
    expect(expectedUpdatedAt).toBe(FINANCE_REVIEW.updatedAt);
    await act(async () => { finish(confirmed); await saving; });
    expect(result.current.review).toBe(confirmed);
    expect(result.current.saving).toBe(false);
  });

  it('retains the confirmed group and shows a refused save instead of claiming a move', async () => {
    api.saveReview.mockRejectedValue(new Error('The review changed; reload and try again.'));
    const { result } = renderHook(useFinanceReview);
    await waitFor(() => expect(result.current.loaded).toBe(true));
    await act(async () => {
      await expect(result.current.moveExpense('Retail purchases', 'necessary')).rejects.toThrow('review changed');
    });
    expect(result.current.review).toBe(FINANCE_REVIEW);
    expect(result.current.error).toContain('not saved');
    expect(result.current.saving).toBe(false);
  });
});
