import { useEffect, useRef, useState } from 'react';
import { TIMING } from '../../config/constants';
import { rolloverDay } from '../../services/backend/plannerServiceApi';
import { toLocalDateStr } from '../../services/localDate';
import { logWarn } from '../../services/logger';
import { getTaskAppDate, resolvePrayerRolloverZone } from '../../services/taskModel';
import { useGamificationContext } from '../contexts/GamificationContext';
import { usePrayerContext } from '../contexts/PrayerContext';
import { useSettingsContext } from '../contexts/SettingsContext';
import { useTaskContext } from '../contexts/TaskContext';

const ROLLOVER_RETRY_MS = 30_000;

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
 * The daily reset runs on the planner service, which reopens completed habits once per new day (daily
 * habits by the app's date, prayer habits by the timetable's), ends a missed streak and rewards any
 * recorded prayer. This tells it the user's time zones when the app loads and whenever the app or prayer
 * day changes, and shows the tasks and progress it answers with. The service also runs the reset by itself
 * for the zones it was last told, so the day starts right even with no tab open.
 */
export function useDailyTaskRollover(): void {
  const { loaded: tasksLoaded, applyTasks } = useTaskContext();
  const { applyProfile } = useGamificationContext();
  const { settings, appTimeZone, serviceSettingsReady } = useSettingsContext();
  const { today: prayerToday, schedule, scheduleTimezoneValid } = usePrayerContext();
  const appZone = appTimeZone.effectiveTimeZone;
  const now = useDayChangeClock(appZone);
  const ready = tasksLoaded && serviceSettingsReady;
  const prayerZone = resolvePrayerRolloverZone({
    prayerEnabled: settings.prayerEnabled !== false,
    scheduleTimezoneValid,
    scheduleTimeZone: schedule?.timezone ?? null,
    appTimeZone: appZone,
  });
  const key = `${dayKey(now, appZone)}|${appZone}|${prayerZone ?? ''}|${prayerToday}`;

  const appliedKey = useRef<string | null>(null);
  // A failed reset is tried again a little later.
  const [attempt, setAttempt] = useState(0);
  useEffect(() => {
    if (!ready || appliedKey.current === key) return;
    appliedKey.current = key;
    rolloverDay(appZone, prayerZone).then(day => {
      applyTasks(day.tasks);
      applyProfile(day.profile);
    }, error => {
      appliedKey.current = null;
      window.setTimeout(() => setAttempt(count => count + 1), ROLLOVER_RETRY_MS);
      logWarn('Tasks', `The daily reset could not run: ${error instanceof Error ? error.message : String(error)}`);
    });
  }, [appZone, applyProfile, applyTasks, attempt, key, prayerZone, ready]);
}
