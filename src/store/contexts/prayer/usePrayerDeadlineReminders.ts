import { useCallback, useEffect, useRef } from 'react';
import type { PrayerName, PrayerTrackingState } from '../../../types/domain';
import { PRAYER_REMINDERS } from '../../../config/constants';
import { prayerReminderDataSchema } from '../../../services/backend/liveContracts';
import { subscribeLiveEvents } from '../../../services/backend/liveEvents';
import {
  getPrayerReminderKey,
  schedulePrayerReminder,
  sendPrayerNotification,
  type PrayerReminderPermissionState,
} from '../../../services/browserPrayerReminder';
import { getPrayerDateAt, formatPrayerInstantTime } from '../../../services/prayerTimeZone';
import { getPrayerOutcome } from '../../../services/prayerTracking';
import type { PrayerReminderReporter } from './usePrayerReminderDiagnostics';

/** The live-update event the prayer service sends when a deadline reminder is due. */
export const PRAYER_REMINDER_EVENT = 'prayer.reminder';

export interface PrayerDeadlineRemindersInput {
  /** Tracking loaded, and prayer and deadline reminders on. */
  enabled: boolean;
  getTracking: () => PrayerTrackingState;
  /** Called after a reminder arrives, so banners re-evaluate. */
  onFired: () => void;
  refreshPermission: () => Promise<PrayerReminderPermissionState>;
  scheduleTimeZone: string;
  reporter: PrayerReminderReporter;
}

export interface PrayerDeadlineReminders {
  /** Nothing to cancel in the tab: the prayer service sends no reminder for a recorded prayer. */
  cancelForPrayer: (prayerDate: string, prayerName: PrayerName) => void;
  /** Schedules a test-only reminder a few seconds out; true when it was scheduled. */
  testReminder: (prayerName?: PrayerName) => Promise<boolean>;
}

/**
 * Deadline reminders are decided by the prayer service, which sends each one once over the live-update
 * stream. This shows each as a Web Notification when permitted (open tabs share one: its tag names the
 * reminder); the in-app banner is the fallback when notifications are unavailable.
 */
export function usePrayerDeadlineReminders({
  enabled,
  getTracking,
  onFired,
  refreshPermission,
  scheduleTimeZone,
  reporter,
}: PrayerDeadlineRemindersInput): PrayerDeadlineReminders {
  const enabledRef = useRef(enabled);
  useEffect(() => {
    enabledRef.current = enabled;
  }, [enabled]);

  useEffect(() => subscribeLiveEvents(event => {
    if (event.type !== PRAYER_REMINDER_EVENT || !enabledRef.current) return;
    const parsed = prayerReminderDataSchema.safeParse(event.data);
    if (!parsed.success) {
      reporter.noteError('A prayer reminder arrived in an unexpected shape.');
      return;
    }
    const reminder = parsed.data;
    const deadline = new Date(reminder.deadlineAt);
    // Recorded, or past its deadline, since the service sent it: nothing to remind.
    if (getPrayerOutcome(getTracking(), reminder.date, reminder.prayer) || Date.now() >= deadline.getTime()) return;
    const key = getPrayerReminderKey({
      prayerDate: reminder.date,
      prayerName: reminder.prayer,
      deadlineIso: reminder.deadlineAt,
    });
    reporter.noteNotificationKey(key);
    onFired();
    void sendPrayerNotification({
      title: `${reminder.prayer} prayer due soon`,
      body: `Pray ${reminder.prayer} before ${reminder.deadline} at ${formatPrayerInstantTime(deadline, reminder.timeZone)}.`,
      tag: key,
    }).catch(error => reporter.fail('PrayerReminder', error));
  }), [getTracking, onFired, reporter]);

  const cancelForPrayer = useCallback(() => undefined, []);

  const testReminder = useCallback(async (prayerName: PrayerName = 'Fajr') => {
    const permission = await refreshPermission();
    if (permission !== 'granted') return false;

    const reference = new Date();
    const fireAt = new Date(reference.getTime() + PRAYER_REMINDERS.TEST_DELAY_MS);
    const deadline = new Date(reference.getTime() + PRAYER_REMINDERS.TEST_DEADLINE_MS);
    try {
      const result = await schedulePrayerReminder({
        prayerDate: getPrayerDateAt(reference, scheduleTimeZone),
        prayerName,
        deadlineIso: deadline.toISOString(),
        fireAtIso: fireAt.toISOString(),
        title: `TEST — ${prayerName} deadline reminder`,
        body: 'Minimized-window timer test only. No prayer outcome, receipt, or XP was changed.',
        testOnly: true,
      });
      reporter.noteNotificationKey(result.key);
      return result.status === 'scheduled';
    } catch (error) {
      reporter.fail('PrayerReminderTest', error);
      return false;
    }
  }, [refreshPermission, reporter, scheduleTimeZone]);

  return { cancelForPrayer, testReminder };
}
