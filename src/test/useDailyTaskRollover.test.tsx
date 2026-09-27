import { act, renderHook, waitFor } from '@testing-library/react';
import type { ContextType } from 'react';
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';
import { TIMING } from '../config/constants';
import * as planner from '../services/backend/plannerServiceApi';
import { GamificationCtx, type GamificationContextValue } from '../store/contexts/GamificationContext';
import { PrayerCtx } from '../store/contexts/PrayerContext';
import { defaultSettings, SettingsCtx, type SettingsContextValue } from '../store/contexts/SettingsContext';
import { TaskCtx, type TaskContextValue } from '../store/contexts/TaskContext';
import { useDailyTaskRollover } from '../store/workflows/useDailyTaskRollover';
import { makeGamification, makeTask } from './fixtures';
import { ContextStack, provide, type ContextBinding } from './renderWithContexts';

type PrayerContextValue = NonNullable<ContextType<typeof PrayerCtx>>;

// Monday 28 September 2026, 09:00 in London.
const MONDAY_MORNING = new Date('2026-09-28T08:00:00.000Z');

interface Fakes {
  tasksLoaded: boolean;
  prayerEnabled: boolean;
  scheduleTimezoneValid: boolean;
  prayerToday: string;
}

const DAY = { tasks: [makeTask({ id: 'habit-read', category: 'daily', completed: false })], profile: makeGamification() };

function setup(initial: Partial<Fakes> = {}) {
  const rollover = vi.spyOn(planner, 'rolloverDay').mockResolvedValue(DAY);
  const applyTasks = vi.fn<TaskContextValue['applyTasks']>();
  const applyProfile = vi.fn<GamificationContextValue['applyProfile']>();
  let fakes: Fakes = {
    tasksLoaded: true,
    prayerEnabled: true,
    scheduleTimezoneValid: true,
    prayerToday: '2026-09-28',
    ...initial,
  };

  const bindings = (): ContextBinding[] => [
    provide(TaskCtx, { loaded: fakes.tasksLoaded, applyTasks } as unknown as TaskContextValue),
    provide(GamificationCtx, { applyProfile } as unknown as GamificationContextValue),
    provide(SettingsCtx, {
      settings: { ...defaultSettings, prayerEnabled: fakes.prayerEnabled },
      loaded: true,
      serviceSettingsReady: true,
      appTimeZone: { browserTimeZone: 'Europe/London', effectiveTimeZone: 'Europe/London', source: 'automatic' },
    } as SettingsContextValue),
    provide(PrayerCtx, {
      today: fakes.prayerToday,
      scheduleTimezoneValid: fakes.scheduleTimezoneValid,
      schedule: { timezone: 'Asia/Riyadh' },
    } as unknown as PrayerContextValue),
  ];

  const view = renderHook(() => useDailyTaskRollover(), {
    wrapper: ({ children }) => <ContextStack bindings={bindings()}>{children}</ContextStack>,
  });
  const update = (patch: Partial<Fakes>) => {
    fakes = { ...fakes, ...patch };
    view.rerender();
  };
  return { rollover, applyTasks, applyProfile, update, view };
}

describe('useDailyTaskRollover', () => {
  beforeEach(() => {
    vi.useFakeTimers({ toFake: ['Date', 'setInterval', 'clearInterval'] });
    vi.setSystemTime(MONDAY_MORNING);
  });

  afterEach(() => {
    vi.useRealTimers();
    vi.restoreAllMocks();
  });

  it('asks the planner to start the day once, with the app and timetable zones, and shows its answer', async () => {
    const { rollover, applyTasks, applyProfile, view } = setup();
    await act(async () => { await Promise.resolve(); });

    expect(applyTasks).toHaveBeenCalledWith(DAY.tasks);
    expect(applyProfile).toHaveBeenCalledWith(DAY.profile);
    view.rerender();
    expect(rollover).toHaveBeenCalledExactlyOnceWith('Europe/London', 'Asia/Riyadh');
  });

  it('waits until tasks have loaded', async () => {
    const { rollover, update } = setup({ tasksLoaded: false });
    expect(rollover).not.toHaveBeenCalled();

    update({ tasksLoaded: true });
    await waitFor(() => expect(rollover).toHaveBeenCalledOnce());
  });

  it('keeps prayer habits waiting while the timetable zone is unknown, and uses the app zone with prayer off', async () => {
    const unknown = setup({ scheduleTimezoneValid: false });
    await waitFor(() => expect(unknown.rollover).toHaveBeenCalledWith('Europe/London', null));
    unknown.view.unmount();
    vi.restoreAllMocks();

    const off = setup({ prayerEnabled: false, scheduleTimezoneValid: false });
    await waitFor(() => expect(off.rollover).toHaveBeenCalledWith('Europe/London', 'Europe/London'));
  });

  it('asks again when the app day changes while the app stays open', async () => {
    const { rollover } = setup();
    await waitFor(() => expect(rollover).toHaveBeenCalledOnce());

    await act(async () => {
      vi.setSystemTime(new Date('2026-09-28T23:30:00.000Z'));
      vi.advanceTimersByTime(TIMING.DAILY_ROLLOVER_CHECK_MS);
    });
    await waitFor(() => expect(rollover).toHaveBeenCalledTimes(2));
  });

  it('asks again when the prayer day changes', async () => {
    const { rollover, update } = setup();
    await waitFor(() => expect(rollover).toHaveBeenCalledOnce());

    update({ prayerToday: '2026-09-29' });
    await waitFor(() => expect(rollover).toHaveBeenCalledTimes(2));
  });
});
