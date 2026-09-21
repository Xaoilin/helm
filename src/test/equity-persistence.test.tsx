import { act, renderHook, waitFor } from '@testing-library/react';
import { beforeEach, describe, expect, it, vi } from 'vitest';
import type { EquityPosition, EquityPositionDraft } from '../types/domain';
import { useEquityPositions } from '../store/contexts/useEquityPositions';
const mocks = vi.hoisted(() => ({
  getSyncSessionSnapshot: vi.fn(), loadStore: vi.fn(), refreshDatabasePersistence: vi.fn(),
  subscribeSyncSession: vi.fn(), subscribeStoreKey: vi.fn(),
  createEquityPosition: vi.fn(), updateEquityPosition: vi.fn(), deleteEquityPosition: vi.fn(),
}));
vi.mock('../store/persistence', () => mocks);
vi.mock('../services/equityAccount', () => mocks);
const position = { id: 'example-equity', company: 'Example Co', updatedAt: '2026-01-01T00:00:00Z' } as EquityPosition;
const draft = { company: 'Example Co' } as EquityPositionDraft;
let listener: () => void;
const ready = { userId: 'a', status: 'ready', readOnly: false };

beforeEach(() => {
  vi.resetAllMocks();
  mocks.getSyncSessionSnapshot.mockImplementation(() => ({ ...ready }));
  mocks.loadStore.mockResolvedValue([position]);
  mocks.refreshDatabasePersistence.mockResolvedValue(undefined);
  mocks.subscribeSyncSession.mockImplementation(callback => { listener = callback; return () => {}; });
  mocks.subscribeStoreKey.mockReturnValue(() => {});
  mocks.createEquityPosition.mockResolvedValue({ positionId: 'example-equity' });
});

describe('private equity persistence', () => {
  it('removes prior holdings on an account change and rejects delayed prior reads', async () => {
    const { result } = renderHook(useEquityPositions);
    await waitFor(() => expect(result.current.positions).toHaveLength(1));
    let resolveRead!: (positions: EquityPosition[]) => void;
    mocks.loadStore.mockReturnValueOnce(new Promise(resolve => { resolveRead = resolve; }));
    let refresh!: Promise<void>;
    act(() => { refresh = result.current.refresh(); });
    mocks.loadStore.mockResolvedValue([]);
    await act(async () => {
      mocks.getSyncSessionSnapshot.mockReturnValue({ ...ready, userId: 'b' }); listener();
    });
    expect(result.current.positions).toEqual([]);
    await act(async () => { resolveRead([position]); await refresh; });
    expect(result.current.positions).toEqual([]);
    await act(async () => {
      mocks.getSyncSessionSnapshot.mockReturnValue({ userId: null, status: 'blocked', readOnly: true }); listener();
    });
    await expect(result.current.save(draft)).rejects.toThrow('signed-in account');
    expect(mocks.createEquityPosition).not.toHaveBeenCalled();
  });
  it('preserves request and position identity after an unknown write result and waits for reload', async () => {
    const { result } = renderHook(useEquityPositions);
    await waitFor(() => expect(result.current.loaded).toBe(true));
    mocks.createEquityPosition.mockRejectedValueOnce(new Error('Connection lost'));
    await act(async () => { await expect(result.current.save(draft)).rejects.toThrow('Connection lost'); });
    const originalArgs = mocks.createEquityPosition.mock.calls[0];
    mocks.refreshDatabasePersistence.mockRejectedValueOnce(new Error('Readback unavailable'));
    await act(async () => { await expect(result.current.save(draft)).rejects.toThrow('Readback unavailable'); });
    expect(mocks.createEquityPosition.mock.calls[1]).toEqual(originalArgs);
    await act(async () => { await result.current.save(draft); });
    expect(mocks.createEquityPosition.mock.calls[2]).toEqual(originalArgs);
    expect(mocks.refreshDatabasePersistence).toHaveBeenCalledTimes(2);
  });
  it('keeps the existing record revision on updates and surfaces a stale-write failure', async () => {
    const { result } = renderHook(useEquityPositions);
    await waitFor(() => expect(result.current.loaded).toBe(true));
    mocks.updateEquityPosition.mockRejectedValueOnce(new Error('Changed; reload before saving'));
    await act(async () => { await expect(result.current.save(draft, position)).rejects.toThrow('Changed'); });
    expect(mocks.updateEquityPosition).toHaveBeenCalledWith(expect.any(String), position.id, draft, position.updatedAt);
  });
});
