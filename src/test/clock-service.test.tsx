import { act, renderHook, waitFor } from '@testing-library/react';
import { beforeEach, describe, expect, it, vi } from 'vitest';
import { ClockProvider, useClockContext } from '../store/contexts/ClockContext';
import type { ClockState } from '../types/domain';

const planner = vi.hoisted(() => ({
  isPlannerServiceEnabled: () => true,
  getClock: vi.fn(),
  saveStopwatch: vi.fn(),
  deleteStopwatch: vi.fn(),
  saveTimer: vi.fn(),
  deleteTimer: vi.fn(),
}));
vi.mock('../services/backend/plannerServiceApi', () => planner);
vi.mock('../services/clockAudio', () => ({
  playTimerAlarm: vi.fn(async () => undefined),
  primeTimerAlarmAudio: vi.fn(async () => undefined),
  stopTimerAlarm: vi.fn(),
}));

const STORED: ClockState = {
  stopwatches: [
    { id: 'a', label: 'Tea', accumulatedMs: 0, startedAt: null, laps: [] },
    { id: 'b', label: 'Run', accumulatedMs: 1_000, startedAt: null, laps: [] },
  ],
  timers: [],
  nextStopwatchNumber: 3,
  nextTimerNumber: 1,
};

/** The clock saves one stopwatch or timer per change, and deletes only what was removed here. */
describe('clock persistence', () => {
  beforeEach(() => {
    vi.clearAllMocks();
    planner.getClock.mockResolvedValue(STORED);
    planner.saveStopwatch.mockResolvedValue(STORED);
    planner.deleteStopwatch.mockResolvedValue(STORED);
  });

  async function render() {
    const view = renderHook(() => useClockContext(), { wrapper: ({ children }) => <ClockProvider>{children}</ClockProvider> });
    await waitFor(() => expect(view.result.current.clock.stopwatches).toHaveLength(2));
    return view;
  }

  it('saves only the stopwatch that changed', async () => {
    const { result } = await render();

    act(() => result.current.setStopwatchLabel('a', 'Green tea'));

    await waitFor(() => expect(planner.saveStopwatch).toHaveBeenCalledOnce());
    expect(planner.saveStopwatch).toHaveBeenCalledWith(expect.objectContaining({ id: 'a', label: 'Green tea' }));
    expect(planner.deleteStopwatch).not.toHaveBeenCalled();
  });

  it('deletes a stopwatch removed here, and never one that is merely missing from this tab', async () => {
    const { result } = await render();

    act(() => result.current.removeStopwatch('a'));
    await waitFor(() => expect(planner.deleteStopwatch).toHaveBeenCalledExactlyOnceWith('a'));

    planner.deleteStopwatch.mockClear();
    planner.getClock.mockResolvedValue({ ...STORED, stopwatches: [] });
    act(() => result.current.setStopwatchLabel('b', 'Long run'));
    await waitFor(() => expect(planner.saveStopwatch).toHaveBeenCalled());
    expect(planner.deleteStopwatch).not.toHaveBeenCalled();
  });
});
