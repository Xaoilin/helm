import { useEffect, useRef } from 'react';
import type { PrayerTrackingState } from '../../../types/domain';
import type { PrayerTimesData } from '../../../services/prayerTimes';
import { classifyExpiredPrayerOutcomes } from '../../../services/prayerSchedulePolicy';

export interface PrayerOutcomeUpkeepInput {
  loaded: boolean;
  tracking: PrayerTrackingState;
  reminderSchedules: Record<string, PrayerTimesData>;
  reminderSchedulesValid: boolean;
  today: string;
  now: Date;
  /** Reloads outcomes from the prayer service. */
  reload: () => void;
}

/**
 * Keeps shown outcomes truthful as time passes. The prayer service records a miss once a prayer's
 * deadline passes (and which prayers were open on the activation day), so when a deadline passes
 * without an outcome the app reloads from the service instead of writing the miss itself. Each
 * newly expired prayer asks once, so a prayer the service does not track never causes a loop.
 */
export function usePrayerOutcomeUpkeep({
  loaded,
  tracking,
  reminderSchedules,
  reminderSchedulesValid,
  today,
  now,
  reload,
}: PrayerOutcomeUpkeepInput): void {
  const requestedRef = useRef(new Set<string>());

  useEffect(() => {
    if (!loaded || !reminderSchedulesValid) return;
    const expired = classifyExpiredPrayerOutcomes({ schedules: reminderSchedules, tracking, today, now });
    const newlyExpired = Object.keys(expired.records)
      .filter(key => !tracking.records[key] && !requestedRef.current.has(key));
    if (newlyExpired.length === 0) return;
    for (const key of newlyExpired) requestedRef.current.add(key);
    reload();
  }, [loaded, now, reload, reminderSchedules, reminderSchedulesValid, today, tracking]);
}
