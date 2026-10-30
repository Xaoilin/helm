import { act, renderHook, waitFor } from '@testing-library/react';
import { beforeEach, describe, expect, it, vi } from 'vitest';
import { useFinanceReview } from '../store/contexts/useFinanceReview';
import { FINANCE_REVIEW } from './finance-review-fixture';
import { OVERPAYMENT_PROFILE } from './loan-overpayment-fixture';
import { BUDGET_REVIEW } from './budget-forecast-fixture';
import { forecastFromMonth } from '../services/budgetForecast';

const api = vi.hoisted(() => ({ getReview: vi.fn(), saveReview: vi.fn(), changeLoanProfile: vi.fn(), enabled: true }));
vi.mock('../services/backend/financeServiceApi', () => ({
  getReview: api.getReview,
  saveReview: api.saveReview,
  changeLoanProfile: api.changeLoanProfile,
  isFinanceServiceEnabled: () => api.enabled,
}));

beforeEach(() => {
  api.getReview.mockReset();
  api.saveReview.mockReset();
  api.getReview.mockResolvedValue(FINANCE_REVIEW);
  api.changeLoanProfile.mockReset();
  api.enabled = true;
});

describe('banking review from the finance service', () => {
  it('saves a forecast with the exact review revision and preserves spending and profiles', async () => {
    const original = { ...BUDGET_REVIEW, loanProfiles: [OVERPAYMENT_PROFILE] };
    const budgetForecast = forecastFromMonth(original, '2026-09');
    api.getReview.mockResolvedValue(original);
    api.saveReview.mockResolvedValue({ ...original, budgetForecast });
    const { result } = renderHook(useFinanceReview);
    await waitFor(() => expect(result.current.loaded).toBe(true));
    await act(async () => { await result.current.saveForecast(budgetForecast); });
    expect(api.saveReview).toHaveBeenCalledWith(expect.objectContaining({ budgetForecast,
      months: original.months, expenseGroups: original.expenseGroups, loanProfiles: original.loanProfiles }), original.updatedAt);
    expect(result.current.review?.budgetForecast).toEqual(budgetForecast);
  });
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
  it('saves only the group change with the exact revision and waits for server confirmation', async () => {
    const original = { ...FINANCE_REVIEW, loanProfiles: [OVERPAYMENT_PROFILE] };
    api.getReview.mockResolvedValue(original);
    const confirmed = { ...original, expenseGroups: [{ label: 'Retail purchases', group: 'necessary' as const }] };
    let finish!: (value: typeof confirmed) => void;
    api.saveReview.mockReturnValue(new Promise(resolve => { finish = resolve; }));
    const { result } = renderHook(useFinanceReview);
    await waitFor(() => expect(result.current.loaded).toBe(true));
    let saving!: Promise<void>;
    act(() => { saving = result.current.moveExpense('Retail purchases', 'necessary'); });
    expect(result.current.saving).toBe(true);
    expect(result.current.review).toBe(original);
    await act(async () => { await result.current.moveExpense('Retail purchases', 'necessary'); });
    expect(api.saveReview).toHaveBeenCalledOnce();
    const [draft, expectedUpdatedAt] = api.saveReview.mock.calls[0];
    expect(draft).toMatchObject({ budget: FINANCE_REVIEW.budget, months: FINANCE_REVIEW.months,
      loans: FINANCE_REVIEW.loans, sources: FINANCE_REVIEW.sources, loanProfiles: original.loanProfiles,
      expenseGroups: confirmed.expenseGroups });
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

  it('keeps a newer confirmed refresh when an earlier expense save response arrives late', async () => {
    const saved = { ...FINANCE_REVIEW, expenseGroups: [{ label: 'Fuel', group: 'necessary' as const }], updatedAt: '2026-10-30T10:00:00Z' };
    const latest = { ...saved, loanProfiles: [OVERPAYMENT_PROFILE], updatedAt: '2026-10-30T10:01:00Z' };
    let finish!: (value: typeof saved) => void;
    api.saveReview.mockReturnValue(new Promise(resolve => { finish = resolve; }));
    const { result } = renderHook(useFinanceReview);
    await waitFor(() => expect(result.current.loaded).toBe(true));
    let saving!: Promise<void>;
    act(() => { saving = result.current.moveExpense('Fuel', 'necessary'); });
    api.getReview.mockResolvedValueOnce(latest);
    await act(async () => { await result.current.refresh(); });
    expect(result.current.review).toBe(latest);
    await act(async () => { finish(saved); await saving; });
    expect(result.current.review).toBe(latest);
  });
});
