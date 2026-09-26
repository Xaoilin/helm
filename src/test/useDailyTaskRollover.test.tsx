import { act, renderHook } from '@testing-library/react';
import type { ContextType } from 'react';
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';
import { TIMING } from '../config/constants';
import { toLocalDateStr } from '../services/localDate';
import { GamificationCtx, type GamificationContextValue } from '../store/contexts/GamificationContext';
import { PrayerCtx } from '../store/contexts/PrayerContext';
import { defaultSettings, SettingsCtx, type SettingsContextValue } from '../store/contexts/SettingsContext';
import { TaskCtx, type TaskContextValue } from '../store/contexts/TaskContext';
import { useDailyTaskRollover } from '../store/workflows/useDailyTaskRollover';
import type { GamificationProfile, Task } from '../types/domain';
import { makeGamification, makeTask } from './fixtures';
import { ContextStack, provide, type ContextBinding } from './renderWithContexts';

type PrayerContextValue = NonNullable<ContextType<typeof PrayerCtx>>;

// Monday 28 September 2026, 09:00 in London.
const MONDAY_MORNING = new Date('2026-09-28T08:00:00.000Z');

interface Fakes {
  tasks: Task[];
  tasksLoaded: boolean;
  profile: GamificationProfile;
  scheduleTimezoneValid: boolean;
  prayerToday: string;
}

function readingHabit(overrides: Partial<Task> = {}): Task {
  return makeTask({
    id: 'habit-read',
    title: 'Read',
    category: 'daily',
    completed: true,
    recurring: { frequency: 'daily', lastReset: '2026-09-27' },
    ...overrides,
  });
}

function setup(initial: Partial<Fakes> = {}) {
  const updateTask = vi.fn<TaskContextValue['updateTask']>();
  const updateGamification = vi.fn<GamificationContextValue['updateGamification']>();
  let fakes: Fakes = {
    tasks: [readingHabit()],
    tasksLoaded: true,
    profile: makeGamification(),
    scheduleTimezoneValid: true,
    prayerToday: '2026-09-28',
    ...initial,
  };

  const bindings = (): ContextBinding[] => [
    provide(TaskCtx, {
      tasks: fakes.tasks,
      loaded: fakes.tasksLoaded,
      addTask: () => 'task-id',
      updateTask,
      removeTask: () => undefined,
      setTasks: () => undefined,
    }),
    provide(GamificationCtx, {
      gamification: fakes.profile,
      loaded: true,
      updateGamification,
      backfillPrayerLog: () => undefined,
    }),
    provide(SettingsCtx, {
      settings: { ...defaultSettings, prayerEnabled: true },
      loaded: true,
      appTimeZone: { browserTimeZone: 'Europe/London', effectiveTimeZone: 'Europe/London', source: 'automatic' },
    } as SettingsContextValue),
    provide(PrayerCtx, {
      today: fakes.prayerToday,
      scheduleTimezoneValid: fakes.scheduleTimezoneValid,
    } as PrayerContextValue),
  ];

  const view = renderHook(() => useDailyTaskRollover(), {
    wrapper: ({ children }) => <ContextStack bindings={bindings()}>{children}</ContextStack>,
  });

  return {
    updateTask,
    updateGamification,
    update(next: Partial<Fakes>) {
      fakes = { ...fakes, ...next };
      view.rerender();
    },
  };
}

describe('useDailyTaskRollover', () => {
  beforeEach(() => {
    vi.useFakeTimers({ now: MONDAY_MORNING });
  });

  afterEach(() => {
    vi.useRealTimers();
  });

  it('reopens a habit completed yesterday once, even when the app re-renders', () => {
    const rollover = setup();

    expect(rollover.updateTask).toHaveBeenCalledTimes(1);
    expect(rollover.updateTask).toHaveBeenCalledWith('habit-read', {
      completed: false,
      completedAt: undefined,
      recurring: { frequency: 'daily', lastReset: '2026-09-28' },
    });

    rollover.update({ tasks: [readingHabit({ completed: false, recurring: { frequency: 'daily', lastReset: '2026-09-28' } })] });
    rollover.update({ tasks: [readingHabit()] });
    expect(rollover.updateTask).toHaveBeenCalledTimes(1);
  });

  it('does nothing until tasks have loaded', () => {
    const rollover = setup({ tasksLoaded: false, tasks: [] });
    expect(rollover.updateTask).not.toHaveBeenCalled();

    rollover.update({ tasksLoaded: true, tasks: [readingHabit()] });
    expect(rollover.updateTask).toHaveBeenCalledTimes(1);
  });

  it('runs again when the app day changes while the app stays open', () => {
    const rollover = setup({ tasks: [readingHabit({ recurring: { frequency: 'daily', lastReset: '2026-09-28' } })] });
    expect(rollover.updateTask).not.toHaveBeenCalled();

    act(() => {
      vi.setSystemTime(new Date('2026-09-28T23:30:00.000Z'));
      vi.advanceTimersByTime(TIMING.DAILY_ROLLOVER_CHECK_MS);
    });

    expect(rollover.updateTask).toHaveBeenCalledTimes(1);
    expect(rollover.updateTask.mock.calls[0][1].recurring?.lastReset).toBe('2026-09-29');
  });

  it('notices a new day as soon as the page becomes visible again', () => {
    const rollover = setup({ tasks: [readingHabit({ recurring: { frequency: 'daily', lastReset: '2026-09-28' } })] });

    act(() => {
      vi.setSystemTime(new Date('2026-09-29T07:00:00.000Z'));
      document.dispatchEvent(new Event('visibilitychange'));
    });

    expect(rollover.updateTask).toHaveBeenCalledTimes(1);
  });

  it('resets prayer tasks only once the prayer timetable date is known', () => {
    const fajr = makeTask({
      id: 'prayer-fajr',
      title: 'Fajr',
      category: 'prayer',
      prayerName: 'Fajr',
      completed: true,
      recurring: { frequency: 'daily', lastReset: '2026-09-27' },
    });
    const rollover = setup({ tasks: [fajr], scheduleTimezoneValid: false });
    expect(rollover.updateTask).not.toHaveBeenCalled();

    rollover.update({ scheduleTimezoneValid: true });
    expect(rollover.updateTask).toHaveBeenCalledWith('prayer-fajr', expect.objectContaining({
      completed: false,
      recurring: { frequency: 'daily', lastReset: '2026-09-28' },
    }));
  });

  it('zeroes a missed streak once per day', () => {
    const threeDaysAgo = new Date(MONDAY_MORNING);
    threeDaysAgo.setDate(threeDaysAgo.getDate() - 3);
    const profile = { ...makeGamification(), currentStreak: 5, longestStreak: 5, lastCompletionDate: toLocalDateStr(threeDaysAgo) };
    const rollover = setup({ tasks: [], profile });

    expect(rollover.updateGamification).toHaveBeenCalledTimes(1);
    expect(rollover.updateGamification).toHaveBeenCalledWith({ ...profile, currentStreak: 0 });

    rollover.update({ profile: { ...profile } });
    expect(rollover.updateGamification).toHaveBeenCalledTimes(1);
  });

  it('leaves a streak kept alive yesterday untouched', () => {
    const yesterday = new Date(MONDAY_MORNING);
    yesterday.setDate(yesterday.getDate() - 1);
    const rollover = setup({ tasks: [], profile: { ...makeGamification(), currentStreak: 2, lastCompletionDate: toLocalDateStr(yesterday) } });

    expect(rollover.updateGamification).not.toHaveBeenCalled();
  });
});
