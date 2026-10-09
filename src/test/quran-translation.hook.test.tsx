import { act, renderHook, waitFor } from '@testing-library/react';
import { beforeEach, describe, expect, it, vi } from 'vitest';
import { useQuranTranslation } from '../hooks/useQuranTranslation';
import { getQuranTranslation } from '../services/quranTranslation';
import { logError } from '../services/logger';
import type { QuranMotivationReference } from '../types/domain';

vi.mock('../services/quranTranslation', () => ({ getQuranTranslation: vi.fn() }));
vi.mock('../services/logger', () => ({ logError: vi.fn() }));

describe('dashboard Quran.com translation loading', () => {
  beforeEach(() => vi.clearAllMocks());

  it('discards a previous passage response when the prayer date changes', async () => {
    let resolveOld!: (text: string) => void;
    const old = new Promise<string>(resolve => { resolveOld = resolve; });
    vi.mocked(getQuranTranslation).mockReturnValueOnce(old).mockResolvedValueOnce('Current passage fixture.');
    const { result, rerender } = renderHook(
      ({ reference }: { reference: QuranMotivationReference }) => useQuranTranslation(reference),
      { initialProps: { reference: '94:5' as QuranMotivationReference } },
    );
    const oldSignal = vi.mocked(getQuranTranslation).mock.calls[0]![1];
    rerender({ reference: '94:6' });
    expect(oldSignal.aborted).toBe(true);
    await waitFor(() => expect(result.current.text).toBe('Current passage fixture.'));
    await act(async () => resolveOld('Old passage fixture.'));
    expect(result.current.text).toBe('Current passage fixture.');
  });

  it('reports a provider error and retries the same passage on request', async () => {
    const failure = new Error('HTTP 503');
    vi.mocked(getQuranTranslation).mockRejectedValueOnce(failure).mockResolvedValueOnce('Recovered fixture.');
    const { result } = renderHook(() => useQuranTranslation('94:5'));
    await waitFor(() => expect(result.current.error).toContain('Retry'));
    expect(result.current.text).toBeUndefined();
    expect(logError).toHaveBeenCalledWith('Quran.com translation 94:5', failure);
    act(() => result.current.retry());
    await waitFor(() => expect(result.current.text).toBe('Recovered fixture.'));
    expect(result.current.error).toBeUndefined();
  });
});
