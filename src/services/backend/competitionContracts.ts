import { z } from 'zod';
import { PRAYER_TIMING_POINTS } from '../../config/prayerCompetition';

export function competitionCalendarDays(from: string, to: string) {
  return (Date.parse(to) - Date.parse(from)) / 86_400_000 + 1;
}

export const competitionSummarySchema = z.object({
  from: z.string().regex(/^\d{4}-\d{2}-\d{2}$/u),
  to: z.string().regex(/^\d{4}-\d{2}-\d{2}$/u),
  asOf: z.string().datetime({ offset: true }),
  onTime: z.number().int().nonnegative(),
  late: z.number().int().nonnegative(),
  missed: z.number().int().nonnegative(),
  allPrayed: z.boolean().optional(),
  pending: z.number().int().nonnegative().optional(),
  pointsEarned: z.number().int().nonnegative().optional(),
  pointsAvailable: z.number().int().nonnegative().optional(),
}).refine(summary => {
  const total = summary.onTime + summary.late + summary.missed;
  if (total > 155) return false;
  if (summary.pending !== undefined) {
    const days = competitionCalendarDays(summary.from, summary.to);
    if (!Number.isInteger(days) || days < 1 || days > 31 || total + summary.pending > days * 5) return false;
  }
  if (summary.pointsEarned === undefined && summary.pointsAvailable === undefined) return true;
  return summary.pointsEarned !== undefined && summary.pointsAvailable === total * PRAYER_TIMING_POINTS.prompt
    && summary.pointsEarned <= summary.pointsAvailable;
});

export const competitionSchema = z.object({
  status: z.enum(['ready', 'not_connected', 'unavailable']),
  self: competitionSummarySchema,
  partner: competitionSummarySchema.nullable(),
  periodDaysExcluded: z.number().int().positive().optional(),
}).refine(value => {
  if ((value.status === 'ready') !== (value.partner !== null)) return false;
  if (value.periodDaysExcluded === undefined) return true;
  const days = competitionCalendarDays(value.self.from, value.self.to);
  const includedDays = days - value.periodDaysExcluded;
  if (!Number.isInteger(days) || days > 31 || includedDays < 0 || value.status === 'not_connected') return false;
  return [value.self, value.partner].every(summary => summary === null
    || summary.onTime + summary.late + summary.missed + (summary.pending ?? 0) <= includedDays * 5);
});
