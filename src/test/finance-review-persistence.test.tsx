import { act, renderHook, waitFor } from '@testing-library/react';
import { beforeEach, describe, expect, it, vi } from 'vitest';
import type { FinanceReview } from '../types/domain';
import { useFinanceReview } from '../store/contexts/useFinanceReview';
import { FINANCE_REVIEW } from './finance-review-fixture';

const mocks = vi.hoisted(() => ({ getSyncSessionSnapshot: vi.fn(), loadStore: vi.fn(), subscribeSyncSession: vi.fn(), subscribeStoreKey: vi.fn() }));
vi.mock('../store/persistence', () => mocks);
let listener: () => void;
const ready = { userId: 'account-a', status: 'ready', readOnly: false };

beforeEach(() => {
  vi.resetAllMocks();
  mocks.getSyncSessionSnapshot.mockImplementation(() => ({ ...ready }));
  mocks.loadStore.mockResolvedValue([FINANCE_REVIEW]);
  mocks.subscribeSyncSession.mockImplementation(callback => { listener = callback; return () => {}; });
  mocks.subscribeStoreKey.mockReturnValue(() => {});
});

describe('private banking review persistence', () => {
  it('hides prior account data immediately and rejects delayed prior reads', async () => {
    const { result } = renderHook(useFinanceReview);
    await waitFor(() => expect(result.current.review?.id).toBe('current'));
    let resolveRead!: (reviews: FinanceReview[]) => void;
    mocks.loadStore.mockReturnValueOnce(new Promise(resolve => { resolveRead = resolve; }));
    let refresh!: Promise<void>;
    act(() => { refresh = result.current.refresh(); });
    mocks.loadStore.mockResolvedValue([]);
    await act(async () => {
      mocks.getSyncSessionSnapshot.mockReturnValue({ ...ready, userId: 'account-b' }); listener();
    });
    expect(result.current.review).toBeNull();
    await act(async () => { resolveRead([FINANCE_REVIEW]); await refresh; });
    expect(result.current.review).toBeNull();
    expect(result.current.error).toBeNull();
  });
  it('fails closed when the signed-in session stops being ready and ignores a read finishing afterwards', async () => {
    const { result } = renderHook(useFinanceReview);
    await waitFor(() => expect(result.current.loaded).toBe(true));
    let rejectRead!: (error: Error) => void;
    mocks.loadStore.mockReturnValueOnce(new Promise((_, reject) => { rejectRead = reject; }));
    let refresh!: Promise<void>;
    act(() => { refresh = result.current.refresh(); });
    await act(async () => {
      mocks.getSyncSessionSnapshot.mockReturnValue({ userId: null, status: 'blocked', readOnly: true }); listener();
    });
    expect(result.current.review).toBeNull();
    await act(async () => { rejectRead(new Error('Private previous-account error')); await refresh; });
    expect(result.current.error).toBe('Reconnect your signed-in account to view the banking review.');
  });
  it('surfaces a failed refresh and clears stale data, then recovers on retry', async () => {
    const { result } = renderHook(useFinanceReview);
    await waitFor(() => expect(result.current.review).toBe(FINANCE_REVIEW));
    mocks.loadStore.mockRejectedValueOnce(new Error('Database read failed'));
    await act(async () => { await result.current.refresh(); });
    expect(result.current.review).toBeNull();
    expect(result.current.error).toBe('Database read failed');
    await act(async () => { await result.current.refresh(); });
    expect(result.current.review).toBe(FINANCE_REVIEW);
    expect(result.current.error).toBeNull();
  });
});
