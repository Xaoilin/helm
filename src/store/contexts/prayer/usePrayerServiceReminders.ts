import { useCallback, useEffect, useMemo, useRef, useState } from 'react';
import type { DailyMomentumState, PrayerName, PrayerTrackingState } from '../../../types/domain';
import { PRAYER_REMINDERS } from '../../../config/constants';
import type { ServiceMomentumReminderPillar, ServicePrayerReminder } from '../../../services/backend/contracts';
import {
  prayerNoticeDataSchema,
  prayerReminderEventDataSchema,
  type LiveEvent,
} from '../../../services/backend/liveContracts';
import { LIVE_DOMAINS } from '../../../services/backend/liveDomains';
import { subscribeLiveEvents } from '../../../services/backend/liveEvents';
import {
  getPrayerReminders,
  isPrayerServiceEnabled,
  snoozePrayerReminder,
} from '../../../services/backend/prayerServiceApi';
import {
  sendPrayerNotification,
  type PrayerReminderPermissionState,
} from '../../../services/browserPrayerReminder';
import {
  describeReminder,
  isReminderShowing,
  mergeReminder,
  reminderFromDeadlineEvent,
  selectActiveReminders,
  type ActivePrayerReminders,
  type ReminderSettlement,
} from '../../../services/prayerServiceReminders';
import { errorMessage, useServiceLoad } from '../useServiceLoad';
import type { PrayerReminderReporter } from './usePrayerReminderDiagnostics';

/** The live-update event carrying a deadline reminder (the first reminder kind the service sent). */
export const PRAYER_REMINDER_EVENT = 'prayer.reminder';
/** The live-update event carrying any reminder the prayer service sent, as its reminder JSON. */
export const PRAYER_NOTICE_EVENT = 'prayer.notice';

export interface PrayerServiceRemindersInput {
  /** Tracking loaded and prayer on. */
  enabled: boolean;
  /** Prayer reminders (deadline and opportunity) on; Learn/Move reminders follow their own preferences. */
  prayerRemindersEnabled: boolean;
  tracking: PrayerTrackingState;
  getTracking: () => PrayerTrackingState;
  /** Daily Momentum, or null until it has loaded. */
  momentum: DailyMomentumState | null;
  now: Date;
  refreshPermission: () => Promise<PrayerReminderPermissionState>;
  /** Called after a reminder arrives, so the clock (and the banners) catch up at once. */
  onArrived: () => void;
  reporter: PrayerReminderReporter;
}

export interface PrayerServiceReminders extends ActivePrayerReminders {
  /** Every reminder the service sent that shows now, for diagnostics. */
  showing: ServicePrayerReminder[];
  /** The Learn/Move preferences the service holds, or null until they have loaded. */
  momentumPreferences: ServiceMomentumReminderPillar[] | null;
  /** Why the reminders could not be loaded, or null. */
  loadError: string | null;
  /** Why the last snooze was refused, in the service's words, or null. */
  snoozeError: string | null;
  snooze: (key: string) => Promise<void>;
  /** Shows a clearly labelled test notification a few seconds out; true when it will be shown. */
  testReminder: (prayerName?: PrayerName) => Promise<boolean>;
}

/** Deadline and opportunity reminders follow the prayer reminder setting; Learn/Move ones their own preferences. */
function isAllowed(reminder: ServicePrayerReminder, prayerRemindersEnabled: boolean): boolean {
  return reminder.kind === 'momentum' || prayerRemindersEnabled;
}

/** A live event as a reminder, or null for another event; `invalid` for a reminder in an unexpected shape. */
function reminderFromEvent(event: LiveEvent): ServicePrayerReminder | 'invalid' | null {
  if (event.type === PRAYER_NOTICE_EVENT) {
    const parsed = prayerNoticeDataSchema.safeParse(event.data);
    return parsed.success ? parsed.data : 'invalid';
  }
  if (event.type === PRAYER_REMINDER_EVENT) {
    const parsed = prayerReminderEventDataSchema.safeParse(event.data);
    if (!parsed.success) return 'invalid';
    return 'key' in parsed.data ? parsed.data : reminderFromDeadlineEvent(parsed.data, event.at);
  }
  return null;
}

/**
 * The reminders the prayer service decides and sends. They load on start (`GET /reminders`: those already
 * sent and still active) and whenever a prayer change or reconnect arrives, and each new one arrives over the
 * live-update stream as a `prayer.notice` or `prayer.reminder` event. A new one shows as a Web Notification when
 * permitted (tabs share one: its tag names the reminder); the in-app banners show every active one and hide it
 * once it expires, is snoozed, or its prayer or Learn/Move Level 1 is done. No timer here decides a reminder.
 */
export function usePrayerServiceReminders({
  enabled,
  prayerRemindersEnabled,
  tracking,
  getTracking,
  momentum,
  now,
  refreshPermission,
  onArrived,
  reporter,
}: PrayerServiceRemindersInput): PrayerServiceReminders {
  const serviceEnabled = enabled && isPrayerServiceEnabled();
  const [reminders, setReminders] = useState<Record<string, ServicePrayerReminder>>({});
  const [momentumPreferences, setMomentumPreferences] = useState<ServiceMomentumReminderPillar[] | null>(null);
  const [snoozeError, setSnoozeError] = useState<string | null>(null);
  const enabledRef = useRef(serviceEnabled);
  const prayerKindsRef = useRef(prayerRemindersEnabled);
  const momentumRef = useRef(momentum);
  const snoozingRef = useRef(new Set<string>());

  useEffect(() => {
    enabledRef.current = serviceEnabled;
    if (!serviceEnabled) setReminders({});
  }, [serviceEnabled]);
  useEffect(() => {
    momentumRef.current = momentum;
    prayerKindsRef.current = prayerRemindersEnabled;
  }, [momentum, prayerRemindersEnabled]);

  const load = useCallback(async () => {
    const loaded = await getPrayerReminders();
    setReminders(Object.fromEntries(loaded.active.map(reminder => [reminder.key, reminder])));
    setMomentumPreferences(loaded.momentum);
  }, []);
  const { error: loadError } = useServiceLoad('Prayer reminders', serviceEnabled, load, LIVE_DOMAINS.prayer);

  const notify = useCallback(async (reminder: ServicePrayerReminder) => {
    reporter.noteNotificationKey(reminder.key);
    await refreshPermission();
    const settlement = { tracking: getTracking(), momentum: momentumRef.current };
    if (!isAllowed(reminder, prayerKindsRef.current) || !isReminderShowing(reminder, new Date(), settlement)) return;
    await sendPrayerNotification({ ...describeReminder(reminder), tag: reminder.key });
  }, [getTracking, refreshPermission, reporter]);

  useEffect(() => subscribeLiveEvents(event => {
    if (!enabledRef.current) return;
    const reminder = reminderFromEvent(event);
    if (reminder === null) return;
    if (reminder === 'invalid') {
      reporter.noteError('A prayer reminder arrived in an unexpected shape.');
      return;
    }
    setReminders(current => ({ ...current, [reminder.key]: mergeReminder(current[reminder.key], reminder) }));
    onArrived();
    void notify(reminder).catch(error => reporter.fail('PrayerReminder', error));
  }), [notify, onArrived, reporter]);

  const snooze = useCallback(async (key: string) => {
    if (snoozingRef.current.has(key)) return;
    snoozingRef.current.add(key);
    try {
      const snoozed = await snoozePrayerReminder(key);
      setReminders(current => ({ ...current, [snoozed.key]: snoozed }));
      setSnoozeError(null);
    } catch (error) {
      setSnoozeError(errorMessage(error));
    } finally {
      snoozingRef.current.delete(key);
    }
  }, []);

  const testReminder = useCallback(async (prayerName: PrayerName = 'Fajr') => {
    const permission = await refreshPermission();
    if (permission !== 'granted') return false;
    const tag = `test:${prayerName}:${Date.now()}`;
    window.setTimeout(() => {
      void sendPrayerNotification({
        title: `TEST — ${prayerName} prayer reminder`,
        body: 'Notification test only. No prayer outcome, reminder, or XP was changed.',
        tag,
      }).catch(error => reporter.fail('PrayerReminderTest', error));
    }, PRAYER_REMINDERS.TEST_DELAY_MS);
    reporter.noteNotificationKey(tag);
    return true;
  }, [refreshPermission, reporter]);

  const settlement = useMemo<ReminderSettlement>(() => ({ tracking, momentum }), [momentum, tracking]);
  const all = useMemo(
    () => Object.values(reminders).filter(reminder => isAllowed(reminder, prayerRemindersEnabled)),
    [prayerRemindersEnabled, reminders],
  );
  const showing = useMemo(
    () => all.filter(reminder => isReminderShowing(reminder, now, settlement)),
    [all, now, settlement],
  );
  const active = useMemo(() => selectActiveReminders(showing, now, settlement), [now, settlement, showing]);

  return {
    ...active,
    showing,
    momentumPreferences,
    loadError: serviceEnabled ? loadError : null,
    snoozeError,
    snooze,
    testReminder,
  };
}
