import { act, renderHook, waitFor } from '@testing-library/react';
import { beforeEach, describe, expect, it, vi } from 'vitest';
import type { ReactNode } from 'react';

const persistenceMocks = vi.hoisted(() => ({
  loadStore: vi.fn(),
  saveStoreRecordFieldsCommitted: vi.fn(),
  subscribeStoreKey: vi.fn(() => () => undefined),
  storedProfile: null as Record<string, unknown> | null,
}));

vi.mock('../store/persistence', () => persistenceMocks);

import {
  DailyMomentumProvider,
  useDailyMomentumContext,
} from '../store/contexts/DailyMomentumContext';

function wrapper({ children }: { children: ReactNode }) {
  return <DailyMomentumProvider>{children}</DailyMomentumProvider>;
}

describe('DailyMomentumProvider committed mutations', () => {
  beforeEach(() => {
    vi.clearAllMocks();
    persistenceMocks.storedProfile = null;
    persistenceMocks.loadStore.mockImplementation(async () => persistenceMocks.storedProfile);
    persistenceMocks.saveStoreRecordFieldsCommitted.mockImplementation(async (
      _key: string,
      _recordId: string,
      fields: Record<string, unknown>,
      fallback: Record<string, unknown>,
    ) => {
      persistenceMocks.storedProfile = { ...(persistenceMocks.storedProfile ?? fallback), ...fields };
    });
  });

  it('does not diverge locally when an online-only account write fails', async () => {
    persistenceMocks.saveStoreRecordFieldsCommitted.mockRejectedValueOnce(new Error('Database unavailable'));
    const { result } = renderHook(() => useDailyMomentumContext(), { wrapper });
    await waitFor(() => expect(result.current.loaded).toBe(true));

    await act(async () => {
      await expect(result.current.recordProgress(
        'learn', 'learn-reading', 'pages', 2, '2026-08-28',
      )).rejects.toThrow('Database unavailable');
    });

    expect(result.current.getDay('2026-08-28').learn.log).toBeNull();
    expect(result.current.error).toBe('Database unavailable');
  });

  it('serializes concurrent same-pillar writes without losing progress', async () => {
    const resolvers: Array<() => void> = [];
    persistenceMocks.saveStoreRecordFieldsCommitted.mockImplementation((
      _key: string,
      _recordId: string,
      fields: Record<string, unknown>,
      fallback: Record<string, unknown>,
    ) => new Promise<void>(resolve => {
      resolvers.push(() => {
        persistenceMocks.storedProfile = { ...(persistenceMocks.storedProfile ?? fallback), ...fields };
        resolve();
      });
    }));
    const { result } = renderHook(() => useDailyMomentumContext(), { wrapper });
    await waitFor(() => expect(result.current.loaded).toBe(true));

    let first!: Promise<unknown>;
    let second!: Promise<unknown>;
    act(() => {
      first = result.current.recordProgress('learn', 'learn-reading', 'pages', 1, '2026-08-28');
      second = result.current.recordProgress('learn', 'learn-reading', 'pages', 1, '2026-08-28');
    });
    await waitFor(() => expect(persistenceMocks.saveStoreRecordFieldsCommitted).toHaveBeenCalledTimes(1));

    act(() => resolvers[0]());
    await waitFor(() => expect(persistenceMocks.saveStoreRecordFieldsCommitted).toHaveBeenCalledTimes(2));
    const secondFields = persistenceMocks.saveStoreRecordFieldsCommitted.mock.calls[1][2];
    expect(secondFields.dailyMomentumLearn.logs['2026-08-28:learn'].progress.pages).toBe(2);

    act(() => resolvers[1]());
    await act(async () => { await Promise.all([first, second]); });
    expect(result.current.getDay('2026-08-28').learn.log?.progress.pages).toBe(2);
  });

  it('surfaces malformed account data and blocks mutations', async () => {
    persistenceMocks.storedProfile = {
      totalXp: 0,
      level: 1,
      currentStreak: 0,
      longestStreak: 0,
      totalTasksCompleted: 0,
      badges: [],
      dailyMomentumLearn: { schemaVersion: 1, templates: 'invalid', logs: {} },
    };
    const { result } = renderHook(() => useDailyMomentumContext(), { wrapper });
    await waitFor(() => expect(result.current.loaded).toBe(true));

    expect(result.current.error).toMatch(/templates must be an array/i);
    await expect(result.current.selectPath('learn', 'learn-reading', '2026-08-28'))
      .rejects.toThrow(/unavailable until valid account data/i);
    expect(persistenceMocks.saveStoreRecordFieldsCommitted).not.toHaveBeenCalled();
  });
});
