import { useEffect } from 'react';
import type { PrayerTrackingState } from '../../../types/domain';
import type { PrayerTimesData } from '../../../services/prayerTimes';
import { capturePrayerActivationDayEligibility } from '../../../services/prayerTracking';
import { classifyExpiredPrayerOutcomes } from '../../../services/prayerSchedulePolicy';
import type { PrayerTrackingStore } from './usePrayerTracking';

export interface PrayerOutcomeUpkeepInput {
  loaded: boolean;
  tracking: PrayerTrackingState;
  commitTracking: PrayerTrackingStore['commitTracking'];
  /** Today's timetable, only when its zone is verified. */
  timetable: PrayerTimesData | null;
  reminderSchedules: Record<string, PrayerTimesData>;
  reminderSchedulesValid: boolean;
  today: string;
  now: Date;
}

/**
 * Keeps recorded outcomes truthful as time passes: records which prayers were
 * still open on the activation day (once), and marks prayers whose deadline
 * has passed without an outcome as missed.
 */
export function usePrayerOutcomeUpkeep({
  loaded,
  tracking,
  commitTracking,
  timetable,
  reminderSchedules,
  reminderSchedulesValid,
  today,
  now,
}: PrayerOutcomeUpkeepInput): void {
  useEffect(() => {
    if (!loaded || !timetable) return;
    commitTracking(current => {
      if (current.activationDayEligibility) return current;
      return capturePrayerActivationDayEligibility(current, {
        date: timetable.date,
        timezone: timetable.timezone,
        prayers: timetable.prayers,
      });
    });
  }, [commitTracking, loaded, timetable]);

  useEffect(() => {
    if (!loaded || !reminderSchedulesValid) return;
    const next = classifyExpiredPrayerOutcomes({
      schedules: reminderSchedules,
      tracking,
      today,
      now,
    });
    if (next !== tracking) commitTracking(next);
  }, [commitTracking, loaded, now, reminderSchedules, reminderSchedulesValid, today, tracking]);
}
