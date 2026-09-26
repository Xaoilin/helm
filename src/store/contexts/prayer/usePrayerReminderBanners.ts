import { useCallback, useMemo } from 'react';
import type { DailyMomentumState, PrayerTrackingState } from '../../../types/domain';
import type { PrayerTimesData } from '../../../services/prayerTimes';
import {
  canSnoozeBoundedReminder,
  getActiveBoundedReminder,
  snoozeBoundedReminder,
  type BoundedReminderPlan,
} from '../../../services/boundedReminders';
import {
  buildPrayerReminderGroups,
  getPrayerSnoozeEnd,
  selectActivePrayerReminder,
  selectBoundedReminderPlans,
  snoozePrayerReminderGroup,
  type PrayerReminderGroup,
} from '../../../services/prayerReminderPolicy';
import type { PrayerTrackingStore } from './usePrayerTracking';

export interface PrayerReminderBannersInput {
  prayerEnabled: boolean;
  reminderEnabled: boolean;
  reminderMinutes: number;
  reminderSchedules: readonly PrayerTimesData[];
  reminderSchedulesValid: boolean;
  /** Today's timetable, only when its zone is verified. */
  timetable: PrayerTimesData | null;
  /** Daily Momentum state, or null until it has loaded. */
  momentum: DailyMomentumState | null;
  tracking: PrayerTrackingState;
  getTracking: PrayerTrackingStore['getTracking'];
  commitTracking: PrayerTrackingStore['commitTracking'];
  today: string;
  now: Date;
}

export interface PrayerReminderBanners {
  /** Every unsettled prayer deadline still ahead, soonest first. */
  reminderGroups: PrayerReminderGroup[];
  /** Today's bounded prayer and momentum reminders. */
  boundedReminderPlans: BoundedReminderPlan[];
  /** The deadline reminder the in-app banner shows now, whatever the notification permission. */
  activeReminder: PrayerReminderGroup | null;
  activeBoundedReminder: BoundedReminderPlan | null;
  canSnoozeActiveBoundedReminder: boolean;
  snoozeActiveReminder: () => void;
  snoozeActiveBoundedReminder: () => void;
}

/**
 * Plans deadline and bounded reminders from the timetable and outcomes, and
 * picks what the in-app banners show. The banners are the fallback whenever a
 * Web Notification cannot be shown.
 */
export function usePrayerReminderBanners({
  prayerEnabled,
  reminderEnabled,
  reminderMinutes,
  reminderSchedules,
  reminderSchedulesValid,
  timetable,
  momentum,
  tracking,
  getTracking,
  commitTracking,
  today,
  now,
}: PrayerReminderBannersInput): PrayerReminderBanners {
  const reminderGroups = useMemo(
    () => buildPrayerReminderGroups({
      schedules: reminderSchedules,
      tracking,
      today,
      now,
      reminderMinutes,
    }),
    [now, reminderMinutes, reminderSchedules, today, tracking],
  );

  const activeReminder = useMemo(() => {
    if (!prayerEnabled || !reminderEnabled || !reminderSchedulesValid) return null;
    return selectActivePrayerReminder(reminderGroups, tracking, now);
  }, [now, prayerEnabled, reminderEnabled, reminderGroups, reminderSchedulesValid, tracking]);

  const boundedReminderPlans = useMemo(() => selectBoundedReminderPlans({
    prayerEnabled,
    reminderEnabled,
    timetable,
    momentum,
    prayerDate: today,
    tracking,
    reminderMinutes,
  }), [momentum, prayerEnabled, reminderEnabled, reminderMinutes, timetable, today, tracking]);

  const activeBoundedReminder = useMemo(() => getActiveBoundedReminder(
    boundedReminderPlans,
    tracking.boundedReminderReceipts,
    now,
  ), [boundedReminderPlans, now, tracking.boundedReminderReceipts]);

  const canSnoozeActiveBoundedReminder = useMemo(() => activeBoundedReminder
    ? canSnoozeBoundedReminder(tracking, activeBoundedReminder, getPrayerSnoozeEnd(now))
    : false, [activeBoundedReminder, now, tracking]);

  const snoozeActiveReminder = useCallback(() => {
    const next = snoozePrayerReminderGroup(getTracking(), activeReminder, new Date());
    if (next) commitTracking(next);
  }, [activeReminder, commitTracking, getTracking]);

  const snoozeActiveBoundedReminder = useCallback(() => {
    if (!activeBoundedReminder) return;
    const snoozedUntil = getPrayerSnoozeEnd(now);
    if (!canSnoozeBoundedReminder(getTracking(), activeBoundedReminder, snoozedUntil)) return;
    commitTracking(current => snoozeBoundedReminder(current, activeBoundedReminder, snoozedUntil));
  }, [activeBoundedReminder, commitTracking, getTracking, now]);

  return {
    reminderGroups,
    boundedReminderPlans,
    activeReminder,
    activeBoundedReminder,
    canSnoozeActiveBoundedReminder,
    snoozeActiveReminder,
    snoozeActiveBoundedReminder,
  };
}
