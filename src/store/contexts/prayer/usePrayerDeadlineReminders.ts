import { useCallback, useEffect, useRef, useState } from 'react';
import type { PrayerName, PrayerTrackingState } from '../../../types/domain';
import { PRAYER_REMINDERS } from '../../../config/constants';
import {
  cancelAllPrayerReminders,
  cancelPrayerReminder,
  onPrayerReminderFired,
  schedulePrayerReminder,
  type PrayerReminderPermissionState,
} from '../../../services/browserPrayerReminder';
import {
  buildScheduledPrayerReminderGroup,
  type PrayerReminderGroup,
  type ScheduledPrayerReminderGroup,
} from '../../../services/prayerReminderPolicy';
import { setPrayerReminderReceipt } from '../../../services/prayerTracking';
import { getPrayerDateAt } from '../../../services/prayerTimeZone';
import type { PrayerTrackingStore } from './usePrayerTracking';
import type { PrayerReminderReporter } from './usePrayerReminderDiagnostics';

export interface PrayerDeadlineRemindersInput {
  /** Tracking loaded, prayer and deadline reminders on, and every held timetable zone verified. */
  enabled: boolean;
  reminderGroups: readonly PrayerReminderGroup[];
  tracking: PrayerTrackingState;
  commitTracking: PrayerTrackingStore['commitTracking'];
  /** Called after a fired reminder's receipt is committed, so banners re-evaluate. */
  onFired: () => void;
  refreshPermission: () => Promise<PrayerReminderPermissionState>;
  scheduleTimeZone: string;
  reporter: PrayerReminderReporter;
}

export interface PrayerDeadlineReminders {
  /** Cancels the pending browser reminder covering a prayer that has just been settled. */
  cancelForPrayer: (prayerDate: string, prayerName: PrayerName) => void;
  /** Schedules a test-only reminder a few seconds out; true when it was scheduled. */
  testReminder: (prayerName?: PrayerName) => Promise<boolean>;
}

/**
 * Keeps one page-open browser timer per unreceipted reminder group, so the Web
 * Notification fires before each prayer's deadline. Reconciliation runs in a
 * queue, cancelling timers whose group changed and scheduling new ones; a fired
 * reminder commits a receipt for every prayer in its group so it never repeats.
 */
export function usePrayerDeadlineReminders({
  enabled,
  reminderGroups,
  tracking,
  commitTracking,
  onFired,
  refreshPermission,
  scheduleTimeZone,
  reporter,
}: PrayerDeadlineRemindersInput): PrayerDeadlineReminders {
  const reconcileQueueRef = useRef<Promise<void>>(Promise.resolve());
  const reconcileVersionRef = useRef(0);
  const inventoryInitializedRef = useRef(false);
  const scheduledGroupsRef = useRef(new Map<string, ScheduledPrayerReminderGroup>());
  const scheduledGroupNamesRef = useRef(new Map<string, PrayerName[]>());
  const [listenerReady, setListenerReady] = useState(false);

  const cancelForPrayer = useCallback((prayerDate: string, prayerName: PrayerName) => {
    for (const [groupKey, scheduled] of scheduledGroupsRef.current) {
      if (scheduled.prayerDate !== prayerDate || !scheduled.prayerNames.includes(prayerName)) continue;
      scheduledGroupsRef.current.delete(groupKey);
      scheduledGroupNamesRef.current.delete(scheduled.reminderKey);
      void cancelPrayerReminder({
        prayerDate: scheduled.prayerDate,
        prayerName: scheduled.leader,
        deadlineIso: scheduled.deadlineIso,
      }).catch(error => reporter.fail('PrayerReminderCancel', error));
    }
  }, [reporter]);

  useEffect(() => {
    let disposed = false;
    let unsubscribe: (() => void) | undefined;
    setListenerReady(false);

    void onPrayerReminderFired(event => {
      reporter.noteNotificationKey(event.key);
      if (event.error) reporter.noteError(event.error);
      if (event.testOnly) return;
      const prayerNames = scheduledGroupNamesRef.current.get(event.key) || [event.prayerName];
      scheduledGroupNamesRef.current.delete(event.key);
      for (const [groupKey, scheduled] of scheduledGroupsRef.current) {
        if (scheduled.reminderKey === event.key) {
          scheduledGroupsRef.current.delete(groupKey);
        }
      }
      commitTracking(current => {
        let next = current;
        for (const prayerName of prayerNames) {
          next = setPrayerReminderReceipt(next, {
            date: event.prayerDate,
            prayerName,
            deadlineAt: event.deadlineIso,
            notifiedAt: event.firedAtIso,
          });
        }
        return next;
      });
      onFired();
    }).then(nextUnsubscribe => {
      if (disposed) {
        nextUnsubscribe();
      } else {
        unsubscribe = nextUnsubscribe;
        setListenerReady(true);
      }
    }).catch(error => {
      if (disposed) return;
      reporter.fail('PrayerReminderListener', error);
    });

    return () => {
      disposed = true;
      setListenerReady(false);
      unsubscribe?.();
    };
  }, [commitTracking, onFired, reporter]);

  useEffect(() => {
    const active = enabled && listenerReady;
    const desired = new Map<string, ScheduledPrayerReminderGroup>();
    if (active) {
      for (const group of reminderGroups) {
        const scheduled = buildScheduledPrayerReminderGroup(group, tracking);
        if (scheduled) desired.set(scheduled.groupKey, scheduled);
      }
    }

    const reconcileVersion = ++reconcileVersionRef.current;
    reconcileQueueRef.current = reconcileQueueRef.current
      .catch(() => undefined)
      .then(async () => {
        if (reconcileVersion !== reconcileVersionRef.current) return;

        if (!inventoryInitializedRef.current) {
          try {
            // Clear the in-memory browser timer inventory once, then rebuild it
            // from persisted outcomes for this page session.
            await cancelAllPrayerReminders();
            inventoryInitializedRef.current = true;
            scheduledGroupsRef.current.clear();
            scheduledGroupNamesRef.current.clear();
          } catch (error) {
            reporter.fail('PrayerReminderInventoryReset', error);
            return;
          }
        }

        if (!active) {
          if (scheduledGroupsRef.current.size > 0) {
            try {
              await cancelAllPrayerReminders();
            } catch (error) {
              reporter.fail('PrayerReminderCancelAll', error);
            }
          }
          scheduledGroupsRef.current.clear();
          scheduledGroupNamesRef.current.clear();
          return;
        }

        for (const [groupKey, current] of [...scheduledGroupsRef.current]) {
          const replacement = desired.get(groupKey);
          if (replacement?.signature === current.signature) continue;

          scheduledGroupsRef.current.delete(groupKey);
          scheduledGroupNamesRef.current.delete(current.reminderKey);
          if (replacement?.reminderKey === current.reminderKey) continue;

          try {
            await cancelPrayerReminder({
              prayerDate: current.prayerDate,
              prayerName: current.leader,
              deadlineIso: current.deadlineIso,
            });
          } catch (error) {
            reporter.fail('PrayerReminderCancel', error);
          }
        }

        if (reconcileVersion !== reconcileVersionRef.current) return;

        for (const [groupKey, scheduled] of desired) {
          const current = scheduledGroupsRef.current.get(groupKey);
          if (current?.signature === scheduled.signature) continue;

          scheduledGroupsRef.current.set(groupKey, scheduled);
          scheduledGroupNamesRef.current.set(scheduled.reminderKey, [...scheduled.prayerNames]);
          try {
            const result = await schedulePrayerReminder({
              prayerDate: scheduled.prayerDate,
              prayerName: scheduled.leader,
              deadlineIso: scheduled.deadlineIso,
              fireAtIso: scheduled.fireAtIso,
              title: scheduled.title,
              body: scheduled.body,
            });
            reporter.noteNotificationKey(result.key);
            if (result.status === 'expired' && scheduledGroupsRef.current.get(groupKey) === scheduled) {
              scheduledGroupsRef.current.delete(groupKey);
              scheduledGroupNamesRef.current.delete(scheduled.reminderKey);
            }
          } catch (error) {
            if (scheduledGroupsRef.current.get(groupKey) === scheduled) {
              scheduledGroupsRef.current.delete(groupKey);
              scheduledGroupNamesRef.current.delete(scheduled.reminderKey);
            }
            reporter.fail('PrayerReminder', error);
          }
        }
      });
  }, [enabled, listenerReady, reminderGroups, reporter, tracking]);

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
