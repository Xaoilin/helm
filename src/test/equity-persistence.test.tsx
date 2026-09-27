import { act, renderHook, waitFor } from '@testing-library/react';
import { beforeEach, describe, expect, it, vi } from 'vitest';
import type { EquityPosition, EquityPositionDraft } from '../types/domain';
import { useEquityPositions } from '../store/contexts/useEquityPositions';

const mocks = vi.hoisted(() => ({
  loadEquityPositions: vi.fn(), createEquityPosition: vi.fn(), updateEquityPosition: vi.fn(), deleteEquityPosition: vi.fn(),
}));
vi.mock('../services/equityAccount', () => mocks);
vi.mock('../services/backend/financeServiceApi', () => ({ isFinanceServiceEnabled: () => true }));

const position = { id: 'example-equity', company: 'Example Co', updatedAt: '2026-01-01T00:00:00Z' } as EquityPosition;
const draft = { company: 'Example Co' } as EquityPositionDraft;

beforeEach(() => {
  vi.resetAllMocks();
  mocks.loadEquityPositions.mockResolvedValue([position]);
});

describe('equity positions from the finance service', () => {
  it('loads the positions the service holds and allows writes', async () => {
    const { result } = renderHook(useEquityPositions);
    await waitFor(() => expect(result.current.positions).toEqual([position]));
    expect(result.current).toMatchObject({ loaded: true, writable: true, stale: false, error: null });
  });

  it('retains confirmed holdings through a failed read while blocking writes', async () => {
    const { result } = renderHook(useEquityPositions);
    await waitFor(() => expect(result.current.positions).toEqual([position]));
    mocks.loadEquityPositions.mockRejectedValueOnce(new Error('Read temporarily unavailable'));
    await act(async () => { await result.current.refresh(); });
    expect(result.current.positions).toEqual([position]);
    expect(result.current).toMatchObject({ error: 'Read temporarily unavailable', stale: true, writable: false });
  });

  it('shows the position the service saved without reloading', async () => {
    const saved = { ...position, id: 'new-id', updatedAt: '2026-09-27T06:00:00Z' };
    mocks.createEquityPosition.mockImplementation(async (_request: string, positionId: string) => ({ ...saved, id: positionId }));
    const { result } = renderHook(useEquityPositions);
    await waitFor(() => expect(result.current.loaded).toBe(true));
    await act(async () => { await result.current.save(draft); });
    const [, positionId] = mocks.createEquityPosition.mock.calls[0];
    expect(result.current.positions.map(item => item.id)).toEqual([position.id, positionId]);
    expect(mocks.loadEquityPositions).toHaveBeenCalledOnce();
  });

  it('repeats an unconfirmed create with the same request and position IDs, and a new change with new ones', async () => {
    const { result } = renderHook(useEquityPositions);
    await waitFor(() => expect(result.current.loaded).toBe(true));
    mocks.createEquityPosition.mockRejectedValueOnce(new Error('Connection lost'))
      .mockImplementation(async (_request: string, positionId: string) => ({ ...position, id: positionId }));
    await act(async () => { await expect(result.current.save(draft)).rejects.toThrow('Connection lost'); });
    expect(result.current.error).toBe('Connection lost');
    await act(async () => { await result.current.save(draft); });
    expect(mocks.createEquityPosition.mock.calls[1]).toEqual(mocks.createEquityPosition.mock.calls[0]);
    await act(async () => { await result.current.save({ ...draft, company: 'Other Co' }); });
    expect(mocks.createEquityPosition.mock.calls[2][0]).not.toBe(mocks.createEquityPosition.mock.calls[0][0]);
    expect(result.current.error).toBeNull();
  });

  it('edits with the shown revision and surfaces a stale-write refusal', async () => {
    const { result } = renderHook(useEquityPositions);
    await waitFor(() => expect(result.current.loaded).toBe(true));
    mocks.updateEquityPosition.mockRejectedValueOnce(new Error('Changed; reload before saving'));
    await act(async () => { await expect(result.current.save(draft, position)).rejects.toThrow('Changed'); });
    expect(mocks.updateEquityPosition).toHaveBeenCalledWith(expect.any(String), position.id, draft, position.updatedAt);
    expect(result.current.error).toBe('Changed; reload before saving');
    await waitFor(() => expect(mocks.loadEquityPositions).toHaveBeenCalledTimes(2));
  });

  it('removes a position with its revision', async () => {
    mocks.deleteEquityPosition.mockResolvedValue(undefined);
    const { result } = renderHook(useEquityPositions);
    await waitFor(() => expect(result.current.positions).toHaveLength(1));
    await act(async () => { await result.current.remove(position); });
    expect(mocks.deleteEquityPosition).toHaveBeenCalledWith(expect.any(String), position.id, position.updatedAt);
    expect(result.current.positions).toEqual([]);
  });
});
