import { act, renderHook } from '@testing-library/react';
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';
import { PRAYER_REMINDERS } from '../config/constants';
import { usePrayerClock } from '../store/contexts/prayer/usePrayerClock';

function setVisibility(state: DocumentVisibilityState) {
  Object.defineProperty(document, 'visibilityState', { configurable: true, get: () => state });
}

describe('usePrayerClock', () => {
  const onDayChange = vi.fn();
  const onResume = vi.fn();

  beforeEach(() => {
    vi.useFakeTimers();
    onDayChange.mockClear();
    onResume.mockClear();
  });

  afterEach(() => {
    setVisibility('visible');
  });

  function renderClock(scheduleTimeZone = 'Europe/London') {
    return renderHook(props => usePrayerClock(props), {
      initialProps: { scheduleTimeZone, onDayChange, onResume },
    });
  }

  it('ticks on the runtime interval and reports the schedule-zone date', () => {
    vi.setSystemTime(new Date('2026-09-26T12:00:00Z'));
    const { result } = renderClock();
    expect(result.current.today).toBe('2026-09-26');

    act(() => { vi.advanceTimersByTime(PRAYER_REMINDERS.RUNTIME_TICK_MS); });

    expect(result.current.now.toISOString()).toBe('2026-09-26T12:00:15.000Z');
    expect(onDayChange).not.toHaveBeenCalled();
  });

  it('reports the prayer-date rollover once, at the schedule zone midnight', () => {
    // 23:59:50 in London (UTC+1) is 22:59:50Z.
    vi.setSystemTime(new Date('2026-09-26T22:59:50Z'));
    const { result } = renderClock();
    expect(result.current.today).toBe('2026-09-26');

    act(() => { vi.advanceTimersByTime(PRAYER_REMINDERS.RUNTIME_TICK_MS); });
    expect(result.current.today).toBe('2026-09-27');
    expect(result.current.getToday()).toBe('2026-09-27');
    expect(onDayChange).toHaveBeenCalledTimes(1);

    act(() => { vi.advanceTimersByTime(PRAYER_REMINDERS.RUNTIME_TICK_MS * 3); });
    expect(onDayChange).toHaveBeenCalledTimes(1);
  });

  it('uses the host date before a timetable zone is known', () => {
    vi.setSystemTime(new Date('2026-09-26T23:30:00Z'));
    const { result } = renderClock('');
    // Vitest runs with TZ=UTC; London would already be the 27th.
    expect(result.current.today).toBe('2026-09-26');
  });

  it('catches up when the page becomes visible or regains focus, but not when hidden', () => {
    vi.setSystemTime(new Date('2026-09-26T12:00:00Z'));
    const { result } = renderClock();
    vi.setSystemTime(new Date('2026-09-26T13:00:00Z'));

    setVisibility('hidden');
    act(() => { document.dispatchEvent(new Event('visibilitychange')); });
    expect(onResume).not.toHaveBeenCalled();
    expect(result.current.now.toISOString()).toBe('2026-09-26T12:00:00.000Z');

    setVisibility('visible');
    act(() => { document.dispatchEvent(new Event('visibilitychange')); });
    expect(onResume).toHaveBeenCalledTimes(1);
    expect(result.current.now.toISOString()).toBe('2026-09-26T13:00:00.000Z');

    act(() => { window.dispatchEvent(new Event('focus')); });
    expect(onResume).toHaveBeenCalledTimes(2);
  });

  it('moves now forward on touch and stops ticking after unmount', () => {
    vi.setSystemTime(new Date('2026-09-26T12:00:00Z'));
    const { result, unmount } = renderClock();
    vi.setSystemTime(new Date('2026-09-26T12:00:05Z'));
    act(() => result.current.touch());
    expect(result.current.now.toISOString()).toBe('2026-09-26T12:00:05.000Z');

    unmount();
    expect(vi.getTimerCount()).toBe(0);
  });

  describe('when the timetable or callback changes', () => {
    beforeEach(() => {
      // 23:59:50 in London (BST): the prayer date rolls over ten seconds later.
      vi.setSystemTime(new Date('2026-09-30T22:59:50Z'));
    });

    it('still detects the rollover on the tick that was already due', () => {
      const first = vi.fn();
      const second = vi.fn();
      const hook = renderHook(props => usePrayerClock(props), {
        initialProps: { scheduleTimeZone: 'Europe/London', onDayChange: first, onResume },
      });
      expect(hook.result.current.today).toBe('2026-09-30');

      // New callback 5s in, as when prayer settings arrive from their services.
      act(() => { vi.advanceTimersByTime(5_000); });
      hook.rerender({ scheduleTimeZone: 'Europe/London', onDayChange: second, onResume });
      act(() => { vi.advanceTimersByTime(PRAYER_REMINDERS.RUNTIME_TICK_MS - 5_000); });

      expect(hook.result.current.today).toBe('2026-10-01');
      expect(second).toHaveBeenCalledTimes(1);
      expect(first).not.toHaveBeenCalled();
    });

    it('uses the latest timetable zone when the tick fires', () => {
      const hook = renderClock('Europe/London');

      // In New York it is still 30 September after London's midnight.
      hook.rerender({ scheduleTimeZone: 'America/New_York', onDayChange, onResume });
      act(() => { vi.advanceTimersByTime(PRAYER_REMINDERS.RUNTIME_TICK_MS); });

      expect(hook.result.current.today).toBe('2026-09-30');
      expect(onDayChange).not.toHaveBeenCalled();
    });
  });
});
