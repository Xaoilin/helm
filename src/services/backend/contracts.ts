/**
 * Runtime contracts for the Spring Boot prayer, profile and calendar services. Every response is parsed
 * through these schemas, so a provider change the app cannot handle fails loudly instead of
 * corrupting state. `contracts/<service>/*.json` holds one example per response; the unit tests
 * parse every example here and the services repository verifies its real responses against them.
 */
import { z } from 'zod';

const isoDate = z.string().regex(/^\d{4}-\d{2}-\d{2}$/u);
const instant = z.string().datetime({ offset: true });
const prayerName = z.enum(['Fajr', 'Dhuhr', 'Asr', 'Maghrib', 'Isha']);
const outcomeStatus = z.enum(['on_time', 'late', 'missed', 'unclassified']);
const pillarName = z.enum(['learn', 'move']);

export const apiErrorSchema = z.object({ code: z.string(), message: z.string() });

export const outcomeSchema = z.object({
  id: z.string().uuid(),
  date: isoDate,
  prayer: prayerName,
  status: outcomeStatus,
  recordedAt: instant,
  source: z.string().nullable(),
  taskId: z.string().nullable(),
  rewarded: z.boolean(),
  deadlineAt: instant.nullable(),
});

export const outcomeListSchema = z.array(outcomeSchema);

export const outcomeChangeSchema = z.object({ outcome: outcomeSchema, firstReward: z.boolean() });

/** The planner service's read of rewarded outcomes (`GET /outcomes/rewarded`); the app does not call it. */
export const rewardedOutcomesSchema = z.object({
  outcomes: z.array(z.object({ date: isoDate, prayer: prayerName, recordedAt: instant, taskId: z.string().nullable() })),
});

export const preferencesSchema = z.object({
  enabled: z.boolean(),
  reminderEnabled: z.boolean(),
  reminderMinutes: z.number().int().positive(),
});

const tallySchema = z.object({
  onTime: z.number().int(),
  late: z.number().int(),
  missed: z.number().int(),
  inferredMissed: z.number().int(),
  unclassified: z.number().int(),
  pending: z.number().int(),
  classifiedTotal: z.number().int(),
  opportunities: z.number().int(),
  percentages: z.object({ onTime: z.number().int(), late: z.number().int(), missed: z.number().int() }),
});

export const statsSchema = z.object({
  overall: tallySchema,
  trackedDays: z.number().int(),
  perPrayer: z.record(prayerName, tallySchema),
});

export const scheduleSchema = z.object({
  date: isoDate,
  hijriDate: z.string(),
  city: z.string(),
  country: z.string(),
  timezone: z.string(),
  method: z.string(),
  times: z.array(z.object({
    name: z.string(),
    nameArabic: z.string(),
    time: z.string().regex(/^\d{2}:\d{2}$/u),
    type: z.enum(['prayer', 'event']),
  })),
  windows: z.array(z.object({
    prayer: prayerName,
    startsAt: instant,
    deadlineName: z.string(),
    deadlineAt: instant,
  })),
});

export const trackingSchema = z.object({
  trackingStartedAt: instant,
  activationDate: isoDate.nullable(),
  activationPrayers: z.array(prayerName),
  importedAt: instant.nullable(),
});

export const dashboardSchema = z.object({
  today: isoDate,
  preferences: preferencesSchema,
  schedule: scheduleSchema,
  tracking: trackingSchema,
  todayOutcomes: outcomeListSchema,
  recentDays: z.array(z.object({
    date: isoDate,
    prayers: z.array(z.object({
      prayer: prayerName,
      status: z.enum(['on_time', 'late', 'missed', 'unclassified', 'pending', 'not_tracked']),
      outcomeId: z.string().uuid().nullable(),
    })),
  })),
  monthStats: statsSchema,
});

/**
 * A reminder the prayer service decided and sent: a deadline warning, a prayer opportunity at its start, or a
 * Learn/Move (momentum) prompt after a prayer. It is the data of a `prayer.notice` live event and an item of
 * `GET /reminders`. `snoozeCount` is 0 or 1: each reminder may be snoozed once.
 */
export const prayerReminderSchema = z.object({
  key: z.string().min(1),
  kind: z.enum(['deadline', 'prayer-opportunity', 'momentum']),
  date: isoDate,
  prayer: prayerName,
  pillars: z.array(pillarName),
  firesAt: instant,
  expiresAt: instant,
  deadlineAt: instant.nullable(),
  deadline: z.string().nullable(),
  timeZone: z.string(),
  reminderMinutes: z.number().int().nullable(),
  snoozedUntil: instant.nullable(),
  snoozeCount: z.number().int().min(0).max(1),
});

/** One pillar's Learn/Move reminder preference, with the latest date its Level 1 was complete. */
export const momentumReminderPillarSchema = z.object({
  pillar: pillarName,
  enabled: z.boolean(),
  afterPrayers: z.array(prayerName),
  completedOn: isoDate.nullable(),
});

export const momentumRemindersSchema = z.object({ pillars: z.array(momentumReminderPillarSchema) });

export const prayerRemindersSchema = z.object({
  active: z.array(prayerReminderSchema),
  momentum: z.array(momentumReminderPillarSchema),
});

export const globalSettingsSchema = z.object({
  city: z.string(),
  country: z.string(),
  timeZone: z.string().nullable(),
  updatedAt: instant.nullable(),
});

/** App preferences every device shares; device-only settings stay in the browser. */
export const appPreferencesSchema = z.object({
  theme: z.string(),
  dataRetentionDays: z.number().int(),
  telemetry: z.boolean(),
  defaultCalendarTab: z.string().nullable(),
  goalTags: z.array(z.string()),
  updatedAt: instant.nullable(),
});

export const integrationSchema = z.object({
  provider: z.string(),
  status: z.enum(['connected', 'disconnected', 'error']),
  configuredAt: instant.nullable(),
  lastError: z.string().nullable(),
  updatedAt: instant,
});

export const integrationsSchema = z.object({ integrations: z.array(integrationSchema) });

export const operationalReceiptSchema = z.object({
  ok: z.literal(true),
  accepted: z.number().int().positive(),
  schemaVersion: z.literal(1),
});

const calendarAuthStatus = z.enum(['connected', 'needs_reconnect', 'revoked', 'error']);
/** An ISO instant for timed events, or a YYYY-MM-DD date for all-day events. */
const eventTime = z.union([instant, isoDate]);

export const calendarAccountSchema = z.object({
  id: z.string(),
  provider: z.enum(['google', 'local']),
  name: z.string(),
  email: z.string(),
  isPrimary: z.boolean(),
  paletteIndex: z.number().int().nullable(),
  authStatus: calendarAuthStatus,
  authError: z.string().nullable(),
  lastSyncedAt: instant.nullable(),
  syncError: z.string().nullable(),
});

export const calendarSourceSchema = z.object({
  id: z.string(),
  accountId: z.string(),
  name: z.string(),
  color: z.string(),
  visible: z.boolean(),
  googleCalendarId: z.string().nullable(),
  accessRole: z.string().nullable(),
  writable: z.boolean(),
});

export const calendarEventSchema = z.object({
  id: z.string(),
  sourceId: z.string(),
  title: z.string(),
  description: z.string(),
  location: z.string().nullable(),
  allDay: z.boolean(),
  start: eventTime,
  end: eventTime,
  googleEventId: z.string().nullable(),
});

export const calendarEventListSchema = z.array(calendarEventSchema);

export const calendarSchema = z.object({
  accounts: z.array(calendarAccountSchema),
  sources: z.array(calendarSourceSchema),
  events: calendarEventListSchema,
});

export const calendarSyncSchema = z.object({
  accounts: z.array(z.object({
    accountId: z.string(),
    email: z.string(),
    status: z.enum(['synced', 'failed', 'needs_reconnect', 'revoked']),
    message: z.string().nullable(),
    syncedAt: instant.nullable(),
    eventCount: z.number().int(),
  })),
});

export type ServiceCalendarAccount = z.infer<typeof calendarAccountSchema>;
export type ServiceCalendarSource = z.infer<typeof calendarSourceSchema>;
export type ServiceCalendarEvent = z.infer<typeof calendarEventSchema>;
export type ServiceCalendar = z.infer<typeof calendarSchema>;
export type ServiceCalendarSync = z.infer<typeof calendarSyncSchema>;

export type ServiceOutcome = z.infer<typeof outcomeSchema>;
export type ServiceOutcomeChange = z.infer<typeof outcomeChangeSchema>;
export type ServicePreferences = z.infer<typeof preferencesSchema>;
export type ServiceDashboard = z.infer<typeof dashboardSchema>;
export type ServiceTracking = z.infer<typeof trackingSchema>;
export type ServiceSchedule = z.infer<typeof scheduleSchema>;
export type ServicePrayerReminder = z.infer<typeof prayerReminderSchema>;
export type ServiceMomentumReminderPillar = z.infer<typeof momentumReminderPillarSchema>;
export type ServicePrayerReminders = z.infer<typeof prayerRemindersSchema>;
export type ServiceGlobalSettings = z.infer<typeof globalSettingsSchema>;
export type ServiceAppPreferences = z.infer<typeof appPreferencesSchema>;
export type ServiceIntegration = z.infer<typeof integrationSchema>;

/** Response schemas keyed by fixture file name in `contracts/<service>/`. */
export const CONTRACT_SCHEMAS: Record<string, z.ZodType> = {
  'prayer-service/dashboard': dashboardSchema,
  'prayer-service/schedule': scheduleSchema,
  'prayer-service/outcomes': outcomeListSchema,
  'prayer-service/outcome-created': outcomeChangeSchema,
  'prayer-service/outcome-corrected': outcomeChangeSchema,
  'prayer-service/outcome-exists': apiErrorSchema,
  'prayer-service/stats': statsSchema,
  'prayer-service/preferences': preferencesSchema,
  'prayer-service/preferences-updated': preferencesSchema,
  'prayer-service/reminders': prayerRemindersSchema,
  'prayer-service/reminder-snoozed': prayerReminderSchema,
  'prayer-service/snooze-used': apiErrorSchema,
  'prayer-service/snooze-too-late': apiErrorSchema,
  'prayer-service/reminder-not-found': apiErrorSchema,
  'prayer-service/rewarded-outcomes': rewardedOutcomesSchema,
  'prayer-service/momentum-reminders-saved': momentumRemindersSchema,
  'profile-service/settings-default': globalSettingsSchema,
  'profile-service/settings-updated': globalSettingsSchema,
  'profile-service/settings-invalid': apiErrorSchema,
  'profile-service/preferences-default': appPreferencesSchema,
  'profile-service/preferences-updated': appPreferencesSchema,
  'profile-service/preferences-invalid': apiErrorSchema,
  'profile-service/integrations': integrationsSchema,
  'profile-service/integration-saved': integrationSchema,
  'profile-service/operational-events-accepted': operationalReceiptSchema,
  'profile-service/rate-limited': apiErrorSchema,
  'calendar-service/calendar': calendarSchema,
  'calendar-service/events': calendarEventListSchema,
  'calendar-service/sync': calendarSyncSchema,
  'calendar-service/sync-needs-reconnect': calendarSyncSchema,
  'calendar-service/account-connected': calendarAccountSchema,
  'calendar-service/account-created': calendarAccountSchema,
  'calendar-service/account-updated': calendarAccountSchema,
  'calendar-service/source-created': calendarSourceSchema,
  'calendar-service/source-updated': calendarSourceSchema,
  'calendar-service/event-created': calendarEventSchema,
  'calendar-service/event-created-local': calendarEventSchema,
  'calendar-service/event-updated': calendarEventSchema,
  'calendar-service/event-invalid': apiErrorSchema,
  'calendar-service/google-reconnect-required': apiErrorSchema,
};
