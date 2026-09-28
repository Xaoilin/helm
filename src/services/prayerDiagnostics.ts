import type { ServicePrayerReminder } from './backend/contracts';
import type { PrayerReminderPermissionState } from './browserPrayerReminder';
import type { PrayerTimesData } from './prayerTimes';

export type PrayerScheduleStatus = 'idle' | 'loading' | 'ready' | 'unavailable';

/** What Settings and Debug show about the prayer schedule and the reminders the prayer service sent. */
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
  /** The reminders the prayer service sent that show now. */
  activeReminders: ServicePrayerReminder[];
  suppressionReason: string | null;
  permissionState: PrayerReminderPermissionState;
  lastNotificationKey: string | null;
  lastError: string | null;
}

/** A readable message for any thrown value, for diagnostics. */
export function describeError(error: unknown): string {
  return error instanceof Error ? error.message : String(error);
}

/** Why no prayer reminder can show right now, or null when the service's reminders can show. */
export function describeReminderSuppression(input: {
  prayerEnabled: boolean;
  reminderEnabled: boolean;
  serviceEnabled: boolean;
  reminderLoadError: string | null;
}): string | null {
  if (!input.prayerEnabled) return 'Prayer times are disabled.';
  if (!input.reminderEnabled) return 'Prayer reminders are disabled; Learn/Move reminders follow their own settings.';
  if (!input.serviceEnabled) return 'The prayer service is not configured for this build.';
  if (input.reminderLoadError) return `The prayer service reminders could not be loaded: ${input.reminderLoadError}`;
  return null;
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
  /** The reminders the prayer service sent that show now. */
  activeReminders: ServicePrayerReminder[];
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
    activeReminders: input.activeReminders,
    suppressionReason: input.suppressionReason,
    permissionState: input.permissionState,
    lastNotificationKey: input.lastNotificationKey,
    lastError: input.lastReminderError || input.scheduleError,
  };
}
