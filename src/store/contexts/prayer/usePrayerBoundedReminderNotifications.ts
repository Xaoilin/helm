import { useEffect, useRef } from 'react';
import type { PrayerTrackingState } from '../../../types/domain';
import { sendPrayerNotification } from '../../../services/browserPrayerReminder';
import {
  getAttemptableBoundedReminders,
  recordBoundedReminderAttempt,
  type BoundedReminderPlan,
} from '../../../services/boundedReminders';
import { saveStoreCommitted } from '../../persistence';
import type { PrayerTrackingStore } from './usePrayerTracking';
import type { PrayerNotificationPermission } from './usePrayerNotificationPermission';
import type { PrayerReminderReporter } from './usePrayerReminderDiagnostics';

export interface PrayerBoundedReminderNotificationsInput {
  loaded: boolean;
  plans: readonly BoundedReminderPlan[];
  receipts: PrayerTrackingState['boundedReminderReceipts'];
  getTracking: PrayerTrackingStore['getTracking'];
  commitTracking: PrayerTrackingStore['commitTracking'];
  now: Date;
  permission: Pick<PrayerNotificationPermission, 'state' | 'refresh' | 'waitingReminderKeysRef'>;
  reporter: PrayerReminderReporter;
}

/**
 * Sends each due bounded reminder as a Web Notification at most once.
 *
 * The attempt receipt is saved and server-confirmed before the notification is
 * shown, and the delivered receipt after it, so a reload or a second tab never
 * repeats one. Without permission nothing is sent or receipted: the reminder
 * waits until permission is granted and the in-app banner shows it meanwhile.
 */
export function usePrayerBoundedReminderNotifications({
  loaded,
  plans,
  receipts,
  getTracking,
  commitTracking,
  now,
  permission,
  reporter,
}: PrayerBoundedReminderNotificationsInput): void {
  const attemptingKeysRef = useRef(new Set<string>());
  const plansRef = useRef<readonly BoundedReminderPlan[]>(plans);
  const { state: permissionState, refresh: refreshPermission, waitingReminderKeysRef } = permission;

  useEffect(() => {
    plansRef.current = plans;
  }, [plans]);

  useEffect(() => {
    if (!loaded || plans.length === 0) return;
    const waitingKeys = waitingReminderKeysRef.current;
    const attemptable = getAttemptableBoundedReminders(plans, receipts, now).filter(plan => (
      !attemptingKeysRef.current.has(plan.notificationKey)
      && !(permissionState !== 'granted' && waitingKeys.has(plan.notificationKey))
    ));
    if (attemptable.length === 0) return;
    for (const plan of attemptable) attemptingKeysRef.current.add(plan.notificationKey);

    void (async () => {
      const currentPermission = await refreshPermission();
      if (currentPermission === 'granted') waitingKeys.clear();
      for (const plan of attemptable) {
        let notified = false;
        try {
          const currentPlan = plansRef.current.find(candidate => (
            candidate.notificationKey === plan.notificationKey
          ));
          const attemptedAt = new Date();
          if (!currentPlan || getAttemptableBoundedReminders(
            [currentPlan],
            getTracking().boundedReminderReceipts,
            attemptedAt,
          ).length === 0) {
            continue;
          }
          if (currentPermission !== 'granted') {
            waitingKeys.add(currentPlan.notificationKey);
            reporter.noteNotificationKey(currentPlan.notificationKey);
            continue;
          }

          const attemptedState = recordBoundedReminderAttempt(
            getTracking(),
            currentPlan,
            attemptedAt,
            false,
          );
          await saveStoreCommitted('prayerTracking', attemptedState);
          commitTracking(attemptedState);
          notified = await sendPrayerNotification({ title: currentPlan.title, body: currentPlan.body });
          if (notified) {
            const notifiedState = recordBoundedReminderAttempt(
              getTracking(),
              currentPlan,
              attemptedAt,
              true,
            );
            await saveStoreCommitted('prayerTracking', notifiedState);
            commitTracking(notifiedState);
          }
          reporter.noteNotificationKey(currentPlan.notificationKey);
        } catch (error) {
          reporter.fail('BoundedReminder', error);
        } finally {
          attemptingKeysRef.current.delete(plan.notificationKey);
        }
      }
    })();
  }, [
    commitTracking,
    getTracking,
    loaded,
    now,
    permissionState,
    plans,
    receipts,
    refreshPermission,
    reporter,
    waitingReminderKeysRef,
  ]);
}
