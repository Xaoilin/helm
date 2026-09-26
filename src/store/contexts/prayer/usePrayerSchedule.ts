import { useCallback, useEffect, useRef, useState } from 'react';
import { getPrayerTimes, type PrayerTimesData } from '../../../services/prayerTimes';
import {
  assertCurrentPrayerSchedule,
  retainReminderSchedules,
} from '../../../services/prayerSchedulePolicy';
import { describeError, type PrayerScheduleStatus } from '../../../services/prayerDiagnostics';
import { logError } from '../../../services/logger';

export interface PrayerLocationSettings {
  city: string;
  country: string;
  prayerEnabled: boolean;
}

export interface PrayerScheduleState {
  /** Today's verified timetable, or null while loading, disabled, or unavailable. */
  schedule: PrayerTimesData | null;
  /** Timetables reminders still need, keyed by prayer date (today and, once held, yesterday). */
  reminderSchedules: Record<string, PrayerTimesData>;
  status: PrayerScheduleStatus;
  error: string | null;
  /** Fetches the timetable again, bypassing the same-day cache. */
  retry: () => Promise<void>;
  /** The prayer date rolled over: drop today's timetable and fetch the new day's. */
  reloadForNewDay: () => void;
}

/**
 * Owns the prayer timetable for the chosen location. It refuses a timetable
 * whose zone or date is not current, ignores responses superseded by a newer
 * request, and starts again whenever the location or enablement changes.
 */
export function usePrayerSchedule({ city, country, prayerEnabled }: PrayerLocationSettings): PrayerScheduleState {
  const [schedule, setSchedule] = useState<PrayerTimesData | null>(null);
  const [reminderSchedules, setReminderSchedules] = useState<Record<string, PrayerTimesData>>({});
  const [status, setStatus] = useState<PrayerScheduleStatus>('idle');
  const [error, setError] = useState<string | null>(null);
  const refreshSequenceRef = useRef(0);

  useEffect(() => () => {
    // Invalidate in-flight schedule requests before React tears down the test/app tree.
    refreshSequenceRef.current += 1;
  }, []);

  const refresh = useCallback(async (forceRefresh: boolean) => {
    if (!prayerEnabled) {
      setSchedule(null);
      setStatus('idle');
      setError(null);
      return;
    }

    const sequence = ++refreshSequenceRef.current;
    setStatus(current => current === 'ready' ? current : 'loading');
    setError(null);
    try {
      const data = await getPrayerTimes(city, country, { forceRefresh });
      if (sequence !== refreshSequenceRef.current) return;
      assertCurrentPrayerSchedule(data, new Date());
      setSchedule(data);
      setReminderSchedules(current => retainReminderSchedules(current, data));
      setStatus('ready');
    } catch (failure) {
      if (sequence !== refreshSequenceRef.current) return;
      setSchedule(null);
      setStatus('unavailable');
      setError(describeError(failure));
      logError('PrayerSchedule', failure);
    }
  }, [city, country, prayerEnabled]);

  const retry = useCallback(() => refresh(true), [refresh]);

  const reloadForNewDay = useCallback(() => {
    setSchedule(null);
    void refresh(true);
  }, [refresh]);

  useEffect(() => {
    setSchedule(null);
    setReminderSchedules({});
    void refresh(false);
    // Location and enablement own the schedule lifecycle.
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [city, country, prayerEnabled]);

  return { schedule, reminderSchedules, status, error, retry, reloadForNewDay };
}
