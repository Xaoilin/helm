import { StrictMode } from 'react';
import { act, renderHook } from '@testing-library/react';
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';
import { useServiceLoad } from '../store/contexts/useServiceLoad';
import { TIMING } from '../config/constants';
import type { LiveEvent } from '../services/backend/liveContracts';

const live = vi.hoisted(() => ({ listeners: new Set<(event: LiveEvent) => void>() }));
vi.mock('../services/backend/liveEvents', () => ({
  LIVE_READY: 'live.ready',
  subscribeLiveEvents: (listener: (event: LiveEvent) => void) => {
    live.listeners.add(listener);
    return () => live.listeners.delete(listener);
  },
}));

async function emit(type = 'calendar.changed') {
  await act(async () => {
    for (const listener of live.listeners) listener({ type, domain: 'calendar', at: '2026-09-08T10:00:00Z', data: null });
    await vi.advanceTimersByTimeAsync(300);
  });
}

describe('demanded confirmed service memory', () => {
  beforeEach(() => { vi.useFakeTimers(); });
  afterEach(() => { live.listeners.clear(); });

  it('defers inactive reads, shares StrictMode and concurrent loads, reuses warm memory and expires on revisit', async () => {
    let finish!: () => void;
    const load = vi.fn(() => new Promise<void>(resolve => { finish = resolve; }));
    const { result, rerender } = renderHook(({ active }) => useServiceLoad('Calendar', true, load, ['calendar'], { active }),
      { initialProps: { active: false }, wrapper: StrictMode });
    await act(async () => {});
    expect(load).not.toHaveBeenCalled();
    rerender({ active: true });
    await act(async () => {});
    expect(load).toHaveBeenCalledTimes(1);
    expect(result.current.reload()).toBe(result.current.reload());
    await act(async () => { finish(); });
    rerender({ active: false });
    rerender({ active: true });
    await act(async () => {});
    expect(load).toHaveBeenCalledTimes(1);
    rerender({ active: false });
    await act(async () => { await vi.advanceTimersByTimeAsync(TIMING.SERVICE_MEMORY_FRESH_MS); });
    rerender({ active: true });
    await act(async () => {});
    expect(load).toHaveBeenCalledTimes(2);
    await act(async () => { finish(); });
  });

  it('coalesces reconnect bursts and preserves a real change arriving during an in-flight read', async () => {
    let finish!: () => void;
    const load = vi.fn().mockResolvedValue(undefined);
    const { result } = renderHook(() => useServiceLoad('Calendar', true, load, ['calendar']), { wrapper: StrictMode });
    await act(async () => {});
    load.mockImplementationOnce(() => new Promise<void>(resolve => { finish = resolve; }));
    act(() => { void result.current.reload(); });
    await act(async () => {});
    await emit();
    expect(load).toHaveBeenCalledTimes(2);
    await act(async () => { finish(); });
    expect(load).toHaveBeenCalledTimes(3);
    await act(async () => {
      for (let i = 0; i < 4; i++) for (const listener of live.listeners) {
        listener({ type: 'live.ready', domain: 'live', at: '2026-09-08T10:00:00Z', data: null });
      }
      await vi.advanceTimersByTimeAsync(300);
    });
    expect(load).toHaveBeenCalledTimes(4);
  });

  it('invalidates inactive views without a read and reloads once when opened', async () => {
    const load = vi.fn().mockResolvedValue(undefined);
    const { rerender } = renderHook(({ active }) => useServiceLoad('Calendar', true, load, ['calendar'], { active }),
      { initialProps: { active: true } });
    await act(async () => {});
    rerender({ active: false });
    await emit();
    await emit('live.ready');
    expect(load).toHaveBeenCalledTimes(1);
    rerender({ active: true });
    await act(async () => {});
    expect(load).toHaveBeenCalledTimes(2);
  });

  it('queues the latest date window after an old request and never shares memory with a remounted account', async () => {
    let finish!: () => void;
    const load = vi.fn().mockImplementationOnce(() => new Promise<void>(resolve => { finish = resolve; })).mockResolvedValue(undefined);
    const first = renderHook(({ requestKey }) => useServiceLoad('Calendar', true, load, [], { requestKey }),
      { initialProps: { requestKey: 'first-week' } });
    await act(async () => {});
    first.rerender({ requestKey: 'last-week' });
    await act(async () => { finish(); });
    expect(load).toHaveBeenCalledTimes(2);
    first.unmount();
    renderHook(() => useServiceLoad('Calendar', true, load));
    await act(async () => {});
    expect(load).toHaveBeenCalledTimes(3);
  });

  it('does not mark failed data fresh and retains a failed-write message after reconciliation', async () => {
    const load = vi.fn().mockRejectedValueOnce(new Error('Unavailable')).mockResolvedValue(undefined);
    const { result, rerender } = renderHook(({ active }) => useServiceLoad('Calendar', true, load, [], { active }),
      { initialProps: { active: true } });
    await act(async () => {});
    expect(result.current.error).toBe('Unavailable');
    rerender({ active: false });
    rerender({ active: true });
    await act(async () => {});
    expect(load).toHaveBeenCalledTimes(2);
    await act(async () => { result.current.reportFailure(new Error('Refused')); });
    expect(result.current.error).toBe('Your last change was not saved: Refused');
  });

  it('stops an invalidated in-flight account load from starting another request after unmount', async () => {
    let finish!: () => void;
    const load = vi.fn(() => new Promise<void>(resolve => { finish = resolve; }));
    const { unmount } = renderHook(() => useServiceLoad('Calendar', true, load, ['calendar']));
    await act(async () => {});
    await emit();
    unmount();
    await act(async () => { finish(); });
    expect(load).toHaveBeenCalledTimes(1);
  });

  it('starts the real read when a disabled prerequisite enables before the initial effect settles', async () => {
    const load = vi.fn().mockResolvedValue(undefined);
    const { result, rerender } = renderHook(({ enabled }) => useServiceLoad('Prayer reminders', enabled, load),
      { initialProps: { enabled: false } });
    rerender({ enabled: true });
    await act(async () => {});
    expect(load).toHaveBeenCalledOnce();
    expect(result.current.error).toBeNull();
  });
});
