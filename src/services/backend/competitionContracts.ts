import { z } from 'zod';
import { PRAYER_TIMING_POINTS } from '../../config/prayerCompetition';

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
    const days = (Date.parse(summary.to) - Date.parse(summary.from)) / 86_400_000 + 1;
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
}).refine(value => (value.status === 'ready') === (value.partner !== null));
