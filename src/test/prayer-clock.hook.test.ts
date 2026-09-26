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
});
