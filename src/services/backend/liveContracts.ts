/**
 * Runtime contracts for the live-update gateway's events (server-sent events on `/api/live/v1/events`).
 * A `change` event names what changed so the tab reloads that domain. A `prayer.reminder` change carries a
 * deadline reminder the prayer service decided is due; a `prayer.notice` change carries any reminder it sent
 * (deadline, prayer opportunity or Learn/Move prompt) as the prayer service's reminder JSON.
 * `contracts/live-service/*.json` holds examples.
 */
import { z } from 'zod';
import { apiErrorSchema, prayerReminderSchema } from './contracts';

const instant = z.string().datetime({ offset: true });

export const liveEventSchema = z.object({
  type: z.string(),
  domain: z.string(),
  at: instant,
  data: z.unknown().nullable(),
});

export const prayerReminderDataSchema = z.object({
  date: z.string().regex(/^\d{4}-\d{2}-\d{2}$/u),
  prayer: z.enum(['Fajr', 'Dhuhr', 'Asr', 'Maghrib', 'Isha']),
  deadlineAt: instant,
  deadline: z.string(),
  timeZone: z.string(),
  reminderMinutes: z.number().int(),
});

/** A `prayer.reminder` event's data: the deadline reminder shape, or the full reminder JSON a newer service sends. */
export const prayerReminderEventDataSchema = z.union([prayerReminderSchema, prayerReminderDataSchema]);

/** A `prayer.notice` event's data: the reminder the prayer service sent. */
export const prayerNoticeDataSchema = prayerReminderSchema;

export type LiveEvent = z.infer<typeof liveEventSchema>;
export type PrayerReminderData = z.infer<typeof prayerReminderDataSchema>;

/** Every contracts/live-service fixture and the schema its body must satisfy. */
export const LIVE_CONTRACT_SCHEMAS: Record<string, z.ZodType> = {
  'live-service/change-event': liveEventSchema,
  'live-service/prayer-reminder-event': liveEventSchema.extend({ data: prayerReminderDataSchema }),
  'live-service/rate-limited': apiErrorSchema,
};
