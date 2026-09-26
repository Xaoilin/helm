import { useEffect, useRef, useState } from 'react';
import { TIMING } from '../../config/constants';
import { toLocalDateStr } from '../../services/localDate';
import {
  buildHabitResetUpdate,
  buildStreakBreakUpdate,
  getTaskAppDate,
  resolvePrayerRolloverDate,
  selectHabitsToReset,
} from '../../services/taskModel';
import { useGamificationContext } from '../contexts/GamificationContext';
import { usePrayerContext } from '../contexts/PrayerContext';
import { useSettingsContext } from '../contexts/SettingsContext';
import { useTaskContext } from '../contexts/TaskContext';

function dayKey(instant: Date, appTimeZone: string): string {
  return `${getTaskAppDate(instant, appTimeZone)}|${toLocalDateStr(instant)}`;
}

/**
 * The current instant, refreshed only when the app or device day changes.
 * Checks on a light interval and whenever the page becomes visible or focused,
 * so a tab left open overnight still notices the new day.
 */
function useDayChangeClock(appTimeZone: string): Date {
  const [now, setNow] = useState(() => new Date());

  useEffect(() => {
    const refresh = () => {
      const next = new Date();
      setNow(current => (dayKey(current, appTimeZone) === dayKey(next, appTimeZone) ? current : next));
    };
    const onVisibilityChange = () => {
      if (document.visibilityState === 'visible') refresh();
    };
    refresh();
    const interval = window.setInterval(refresh, TIMING.DAILY_ROLLOVER_CHECK_MS);
    document.addEventListener('visibilitychange', onVisibilityChange);
    window.addEventListener('focus', refresh);
    return () => {
      window.clearInterval(interval);
      document.removeEventListener('visibilitychange', onVisibilityChange);
      window.removeEventListener('focus', refresh);
    };
  }, [appTimeZone]);

  return now;
}

/**
 * Daily task rollover, independent of which page is open.
 *
 * Once per app day it reopens completed habits (daily habits against the app
 * date, prayer tasks against the prayer timetable date), and once per device
 * day it zeroes a streak that was missed. Nothing runs until Tasks,
 * Gamification, and Settings have loaded. Each reset stamps
 * `recurring.lastReset`, so a repeated run never resets a habit twice.
 */
export function useDailyTaskRollover(): void {
  const { tasks, loaded: tasksLoaded, updateTask } = useTaskContext();
  const { gamification, loaded: gamificationLoaded, updateGamification } = useGamificationContext();
  const { settings, appTimeZone, loaded: settingsLoaded } = useSettingsContext();
  const { today: prayerToday, scheduleTimezoneValid } = usePrayerContext();
  const now = useDayChangeClock(appTimeZone.effectiveTimeZone);
  const ready = tasksLoaded && gamificationLoaded && settingsLoaded;

  const appDate = getTaskAppDate(now, appTimeZone.effectiveTimeZone);
  const prayerDate = resolvePrayerRolloverDate({
    prayerEnabled: settings.prayerEnabled !== false,
    scheduleTimezoneValid,
    prayerToday,
    appDate,
  });
  const deviceDate = toLocalDateStr(now);

  const appliedHabitDates = useRef<string | null>(null);
  useEffect(() => {
    if (!ready) return;
    const key = `${appDate}|${prayerDate ?? ''}`;
    if (appliedHabitDates.current === key) return;
    appliedHabitDates.current = key;
    const dates = { appDate, prayerDate };
    for (const task of selectHabitsToReset(tasks, dates)) {
      updateTask(task.id, buildHabitResetUpdate(task, dates));
    }
  }, [ready, appDate, prayerDate, tasks, updateTask]);

  const appliedStreakDate = useRef<string | null>(null);
  useEffect(() => {
    if (!ready || appliedStreakDate.current === deviceDate) return;
    appliedStreakDate.current = deviceDate;
    const next = buildStreakBreakUpdate(gamification, now);
    if (next) updateGamification(next);
  }, [ready, deviceDate, gamification, now, updateGamification]);
}
