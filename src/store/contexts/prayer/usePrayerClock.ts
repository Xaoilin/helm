import { useCallback, useEffect, useRef, useState } from 'react';
import { PRAYER_REMINDERS } from '../../../config/constants';
import { toLocalDateStr } from '../../../services/localDate';
import { getPrayerDateAt } from '../../../services/prayerTimeZone';

export interface PrayerClockOptions {
  /** The verified timetable zone, or '' before one has loaded (the host date is used then). */
  scheduleTimeZone: string;
  /** Called from the tick when the prayer date rolls over. */
  onDayChange: () => void;
  /** Called after the page regains focus or becomes visible again. */
  onResume: () => void;
}

export interface PrayerClock {
  now: Date;
  /** The prayer date at `now` in the timetable's zone. */
  today: string;
  /** The latest prayer date, including a rollover not yet rendered. */
  getToday: () => string;
  /** Moves `now` to the current instant, e.g. after a reminder fired. */
  touch: () => void;
}

/**
 * The page-open prayer clock: ticks every `PRAYER_REMINDERS.RUNTIME_TICK_MS`,
 * reports a prayer-date rollover once, and catches up when the page resumes
 * from the background (timers are throttled while it is hidden).
 */
export function usePrayerClock({ scheduleTimeZone, onDayChange, onResume }: PrayerClockOptions): PrayerClock {
  const [now, setNow] = useState(() => new Date());
  const todayRef = useRef(toLocalDateStr(now));
  const today = getPrayerDateAt(now, scheduleTimeZone);

  useEffect(() => {
    todayRef.current = today;
  }, [today]);

  useEffect(() => {
    const tick = () => {
      const nextNow = new Date();
      const nextToday = getPrayerDateAt(nextNow, scheduleTimeZone);
      setNow(nextNow);
      if (todayRef.current !== nextToday) {
        todayRef.current = nextToday;
        onDayChange();
      }
    };
    const interval = window.setInterval(tick, PRAYER_REMINDERS.RUNTIME_TICK_MS);
    return () => window.clearInterval(interval);
  }, [onDayChange, scheduleTimeZone]);

  useEffect(() => {
    const resume = () => {
      setNow(new Date());
      onResume();
    };
    const visibility = () => {
      if (document.visibilityState === 'visible') resume();
    };
    window.addEventListener('focus', resume);
    document.addEventListener('visibilitychange', visibility);
    return () => {
      window.removeEventListener('focus', resume);
      document.removeEventListener('visibilitychange', visibility);
    };
  }, [onResume]);

  const getToday = useCallback(() => todayRef.current, []);
  const touch = useCallback(() => setNow(new Date()), []);

  return { now, today, getToday, touch };
}
