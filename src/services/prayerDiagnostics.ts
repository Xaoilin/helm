import type { PrayerReminderPermissionState } from './browserPrayerReminder';
import type { PrayerReminderGroup } from './prayerReminderPolicy';
import type { PrayerTimesData } from './prayerTimes';

export type PrayerScheduleStatus = 'idle' | 'loading' | 'ready' | 'unavailable';

/** What Settings and Debug show about the prayer schedule and deadline reminders. */
export interface PrayerDiagnostics {
  scheduleStatus: PrayerScheduleStatus;
  scheduleDate: string | null;
  scheduleSource: PrayerTimesData['source'] | null;
  fetchedAt: string | null;
  location: string;
  method: string | null;
  scheduleTimezone: string | null;
  localTimezone: string;
  timezoneMatches: boolean;
  scheduleTimezoneValid: boolean;
  nextReminderAt: string | null;
  suppressionReason: string | null;
  permissionState: PrayerReminderPermissionState;
  lastNotificationKey: string | null;
  lastError: string | null;
}

/** A readable message for any thrown value, for diagnostics. */
export function describeError(error: unknown): string {
  return error instanceof Error ? error.message : String(error);
}

/** Why no deadline reminder can be scheduled right now, or null when reminders can run. */
export function describeReminderSuppression(input: {
  prayerEnabled: boolean;
  reminderEnabled: boolean;
  scheduleStatus: PrayerScheduleStatus;
  schedule: PrayerTimesData | null;
  scheduleTimezone: string;
  reminderGroupCount: number;
}): string | null {
  if (!input.prayerEnabled) return 'Prayer times are disabled.';
  if (!input.reminderEnabled) return 'Deadline reminders are disabled.';
  if (input.scheduleStatus !== 'ready' || !input.schedule) {
    return 'No matching current-day prayer schedule is available.';
  }
  if (!input.scheduleTimezone) return 'The schedule timezone could not be verified.';
  if (input.reminderGroupCount === 0) return 'No incomplete prayer is currently eligible.';
  return null;
}

/** When the next reminder fires: the first group whose deadline is still ahead. */
export function findNextReminderAt(groups: readonly PrayerReminderGroup[], now: Date): string | null {
  return groups.find(group => group.deadlineAt > now)?.fireAt.toISOString() || null;
}

export function buildPrayerDiagnostics(input: {
  scheduleStatus: PrayerScheduleStatus;
  schedule: PrayerTimesData | null;
  scheduleError: string | null;
  city: string;
  country: string;
  scheduleTimezone: string;
  scheduleTimezoneValid: boolean;
  localTimezone: string;
  timezoneMatches: boolean;
  nextReminderAt: string | null;
  suppressionReason: string | null;
  permissionState: PrayerReminderPermissionState;
  lastNotificationKey: string | null;
  lastReminderError: string | null;
}): PrayerDiagnostics {
  return {
    scheduleStatus: input.scheduleStatus,
    scheduleDate: input.schedule?.date || null,
    scheduleSource: input.schedule?.source || null,
    fetchedAt: input.schedule?.fetchedAt || null,
    location: `${input.city}, ${input.country}`,
    method: input.schedule?.method || null,
    scheduleTimezone: input.scheduleTimezone || null,
    localTimezone: input.localTimezone,
    timezoneMatches: input.timezoneMatches,
    scheduleTimezoneValid: input.scheduleTimezoneValid,
    nextReminderAt: input.nextReminderAt,
    suppressionReason: input.suppressionReason,
    permissionState: input.permissionState,
    lastNotificationKey: input.lastNotificationKey,
    lastError: input.lastReminderError || input.scheduleError,
  };
}
