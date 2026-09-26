/**
 * Runtime contracts for the Spring Boot prayer and profile services. Every response is parsed
 * through these schemas, so a provider change the app cannot handle fails loudly instead of
 * corrupting state. `contracts/<service>/*.json` holds one example per response; the unit tests
 * parse every example here and the services repository verifies its real responses against them.
 */
import { z } from 'zod';

const isoDate = z.string().regex(/^\d{4}-\d{2}-\d{2}$/u);
const instant = z.string().datetime({ offset: true });
const prayerName = z.enum(['Fajr', 'Dhuhr', 'Asr', 'Maghrib', 'Isha']);
const outcomeStatus = z.enum(['on_time', 'late', 'missed', 'unclassified']);

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

export const importResultSchema = z.object({ imported: z.number().int(), skipped: z.number().int() });

export const globalSettingsSchema = z.object({
  city: z.string(),
  country: z.string(),
  timeZone: z.string().nullable(),
  updatedAt: instant.nullable(),
});

export type ServiceOutcome = z.infer<typeof outcomeSchema>;
export type ServiceOutcomeChange = z.infer<typeof outcomeChangeSchema>;
export type ServicePreferences = z.infer<typeof preferencesSchema>;
export type ServiceDashboard = z.infer<typeof dashboardSchema>;
export type ServiceTracking = z.infer<typeof trackingSchema>;
export type ServiceImportResult = z.infer<typeof importResultSchema>;
export type ServiceGlobalSettings = z.infer<typeof globalSettingsSchema>;

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
  'prayer-service/import-result': importResultSchema,
  'profile-service/settings-default': globalSettingsSchema,
  'profile-service/settings-updated': globalSettingsSchema,
  'profile-service/settings-invalid': apiErrorSchema,
};
