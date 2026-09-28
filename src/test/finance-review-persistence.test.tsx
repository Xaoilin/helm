import { act, renderHook, waitFor } from '@testing-library/react';
import { beforeEach, describe, expect, it, vi } from 'vitest';
import { useFinanceReview } from '../store/contexts/useFinanceReview';
import { FINANCE_REVIEW } from './finance-review-fixture';

const api = vi.hoisted(() => ({ getReview: vi.fn(), enabled: true }));
vi.mock('../services/backend/financeServiceApi', () => ({
  getReview: api.getReview,
  isFinanceServiceEnabled: () => api.enabled,
}));

beforeEach(() => {
  api.getReview.mockReset();
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
});
