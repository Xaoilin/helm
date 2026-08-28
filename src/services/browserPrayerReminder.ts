import type { PrayerName } from '../types/domain';

export const PRAYER_REMINDER_FIRED_EVENT = 'prayer-reminder-fired';

export interface PrayerReminderIdentity {
  prayerDate: string;
  prayerName: PrayerName;
  deadlineIso: string;
}

export interface PrayerReminderScheduleRequest extends PrayerReminderIdentity {
  fireAtIso: string;
  title?: string;
  body?: string;
  testOnly?: boolean;
}

export interface ScheduledPrayerReminder extends PrayerReminderIdentity {
  key: string;
  fireAtIso: string;
  testOnly: boolean;
}

export interface PrayerReminderScheduleResult {
  key: string;
  status: 'scheduled' | 'expired';
  deadlineIso: string;
  fireAtIso: string;
}

export interface PrayerReminderFiredEvent extends ScheduledPrayerReminder {
  firedAtIso: string;
  notificationSent: boolean;
  error: string | null;
}

export type PrayerReminderPermissionState = 'granted' | 'not_granted' | 'unsupported';
export type PrayerReminderPermissionRequestResult = NotificationPermission | 'unsupported';

type BrowserReminder = {
  handle: ReturnType<typeof setTimeout>;
  reminder: ScheduledPrayerReminder;
};

const browserReminders = new Map<string, BrowserReminder>();

function parseInstant(value: string, field: string): number {
  const instant = Date.parse(value);
  if (!Number.isFinite(instant)) {
    throw new Error(`${field} must be an RFC 3339 timestamp with an offset`);
  }
  return instant;
}

export function getPrayerReminderKey(identity: PrayerReminderIdentity): string {
  const deadline = parseInstant(identity.deadlineIso, 'deadlineIso');
  return `${identity.prayerDate}:${identity.prayerName}:${deadline}`;
}

function normalizedReminder(
  request: PrayerReminderScheduleRequest,
): ScheduledPrayerReminder {
  return {
    key: getPrayerReminderKey(request),
    prayerDate: request.prayerDate,
    prayerName: request.prayerName,
    deadlineIso: new Date(parseInstant(request.deadlineIso, 'deadlineIso')).toISOString(),
    fireAtIso: new Date(parseInstant(request.fireAtIso, 'fireAtIso')).toISOString(),
    testOnly: request.testOnly === true,
  };
}

function emitBrowserReminder(
  reminder: ScheduledPrayerReminder,
  request: PrayerReminderScheduleRequest,
): void {
  browserReminders.delete(reminder.key);
  if (Date.now() >= Date.parse(reminder.deadlineIso)) return;

  let notificationSent = false;
  let error: string | null = null;
  if (typeof window !== 'undefined' && 'Notification' in window && window.Notification.permission === 'granted') {
    try {
      new window.Notification(
        request.title?.trim() || `${request.prayerName} prayer due soon`,
        {
          body: request.body?.trim() || `Pray ${request.prayerName} before its on-time window closes.`,
        },
      );
      notificationSent = true;
    } catch (notificationError) {
      error = notificationError instanceof Error
        ? notificationError.message
        : String(notificationError);
    }
  }

  const payload: PrayerReminderFiredEvent = {
    ...reminder,
    firedAtIso: new Date().toISOString(),
    notificationSent,
    error,
  };
  if (typeof window !== 'undefined') {
    window.dispatchEvent(new CustomEvent(PRAYER_REMINDER_FIRED_EVENT, { detail: payload }));
  }
}

function scheduleBrowserReminder(
  request: PrayerReminderScheduleRequest,
): PrayerReminderScheduleResult {
  const reminder = normalizedReminder(request);
  const fireAt = Date.parse(reminder.fireAtIso);
  const deadline = Date.parse(reminder.deadlineIso);

  const existing = browserReminders.get(reminder.key);
  if (existing) {
    clearTimeout(existing.handle);
    browserReminders.delete(reminder.key);
  }

  if (deadline <= Date.now()) {
    return {
      ...reminder,
      status: 'expired',
    };
  }
  if (fireAt >= deadline) {
    throw new Error('fireAtIso must be before deadlineIso');
  }

  const handle = setTimeout(
    () => emitBrowserReminder(reminder, request),
    Math.max(0, fireAt - Date.now()),
  );
  browserReminders.set(reminder.key, { handle, reminder });
  return {
    ...reminder,
    status: 'scheduled',
  };
}

export async function schedulePrayerReminder(
  request: PrayerReminderScheduleRequest,
): Promise<PrayerReminderScheduleResult> {
  return scheduleBrowserReminder(request);
}

export async function cancelPrayerReminder(
  reminder: PrayerReminderIdentity,
): Promise<boolean> {
  const key = getPrayerReminderKey(reminder);
  const scheduled = browserReminders.get(key);
  if (!scheduled) return false;
  clearTimeout(scheduled.handle);
  browserReminders.delete(key);
  return true;
}

export async function cancelAllPrayerReminders(): Promise<number> {
  const count = browserReminders.size;
  for (const reminder of browserReminders.values()) {
    clearTimeout(reminder.handle);
  }
  browserReminders.clear();
  return count;
}

export async function listScheduledPrayerReminders(): Promise<ScheduledPrayerReminder[]> {
  return [...browserReminders.values()]
    .map(({ reminder }) => reminder)
    .sort((left, right) => left.fireAtIso.localeCompare(right.fireAtIso));
}

export async function onPrayerReminderFired(
  listener: (event: PrayerReminderFiredEvent) => void,
): Promise<() => void> {
  if (typeof window === 'undefined') return () => undefined;
  const browserListener = (event: Event) => {
    listener((event as CustomEvent<PrayerReminderFiredEvent>).detail);
  };
  window.addEventListener(PRAYER_REMINDER_FIRED_EVENT, browserListener);
  return () => window.removeEventListener(PRAYER_REMINDER_FIRED_EVENT, browserListener);
}

export async function getPrayerReminderPermission(): Promise<PrayerReminderPermissionState> {
  if (typeof window === 'undefined' || !('Notification' in window)) return 'unsupported';
  return window.Notification.permission === 'granted' ? 'granted' : 'not_granted';
}

export async function sendPrayerNotification(
  notification: { title: string; body: string },
): Promise<boolean> {
  if (
    typeof window === 'undefined'
    || !('Notification' in window)
    || window.Notification.permission !== 'granted'
  ) {
    return false;
  }
  try {
    new window.Notification(notification.title, { body: notification.body });
    return true;
  } catch {
    return false;
  }
}

/**
 * Explicit user-action API. Scheduling never invokes this or prompts for permission.
 */
export async function requestPrayerReminderPermission(): Promise<PrayerReminderPermissionRequestResult> {
  if (typeof window === 'undefined' || !('Notification' in window)) return 'unsupported';
  try {
    return window.Notification.requestPermission();
  } catch {
    return 'unsupported';
  }
}
