import { act, renderHook, waitFor } from '@testing-library/react';
import { beforeEach, describe, expect, it, vi } from 'vitest';
import { useFinanceReview } from '../store/contexts/useFinanceReview';
import { FINANCE_REVIEW } from './finance-review-fixture';
import { OVERPAYMENT_PROFILE } from './loan-overpayment-fixture';

const api = vi.hoisted(() => ({ getReview: vi.fn(), changeLoanProfile: vi.fn(), enabled: true }));
vi.mock('../services/backend/financeServiceApi', () => ({
  getReview: api.getReview,
  changeLoanProfile: api.changeLoanProfile,
  isFinanceServiceEnabled: () => api.enabled,
}));

beforeEach(() => {
  api.getReview.mockReset();
  api.getReview.mockResolvedValue(FINANCE_REVIEW);
  api.changeLoanProfile.mockReset();
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

  it('saves only the semantic profile command and publishes server-confirmed profiles', async () => {
    const confirmed = { ...FINANCE_REVIEW, loanProfiles: [OVERPAYMENT_PROFILE], updatedAt: '2026-10-30T10:00:00Z' };
    api.changeLoanProfile.mockResolvedValue(confirmed);
    const { result } = renderHook(useFinanceReview);
    await waitFor(() => expect(result.current.loaded).toBe(true));
    await act(async () => { await result.current.changeProfile({ operation: 'save', profile: OVERPAYMENT_PROFILE }); });
    expect(api.changeLoanProfile).toHaveBeenCalledWith({ operation: 'save', profile: OVERPAYMENT_PROFILE }, FINANCE_REVIEW.updatedAt, expect.any(String));
    expect(result.current.review).toBe(confirmed);
    expect(result.current.savingProfile).toBe(false);
  });

  it('retains exact command identity after an unknown response and refuses an unconfirmed save', async () => {
    api.changeLoanProfile.mockRejectedValueOnce(new Error('Connection lost'))
      .mockResolvedValueOnce({ ...FINANCE_REVIEW, loanProfiles: [OVERPAYMENT_PROFILE] });
    const { result } = renderHook(useFinanceReview);
    await waitFor(() => expect(result.current.loaded).toBe(true));
    const change = { operation: 'save' as const, profile: OVERPAYMENT_PROFILE };
    await act(async () => { await expect(result.current.changeProfile(change)).rejects.toThrow('Connection lost'); });
    expect(result.current.review?.loanProfiles).toBeUndefined();
    await act(async () => { await result.current.changeProfile(change); });
    expect(api.changeLoanProfile.mock.calls[1]).toEqual(api.changeLoanProfile.mock.calls[0]);
    api.changeLoanProfile.mockResolvedValueOnce(FINANCE_REVIEW);
    await act(async () => { await expect(result.current.changeProfile(change)).rejects.toThrow('did not confirm'); });
  });
});
