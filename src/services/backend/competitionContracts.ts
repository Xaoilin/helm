import { z } from 'zod';

export const competitionSummarySchema = z.object({
  from: z.string().regex(/^\d{4}-\d{2}-\d{2}$/u),
  to: z.string().regex(/^\d{4}-\d{2}-\d{2}$/u),
  asOf: z.string().datetime({ offset: true }),
  onTime: z.number().int().nonnegative(),
  late: z.number().int().nonnegative(),
  missed: z.number().int().nonnegative(),
}).refine(summary => summary.onTime + summary.late + summary.missed <= 155);

export const competitionSchema = z.object({
  status: z.enum(['ready', 'not_connected', 'unavailable']),
  self: competitionSummarySchema,
  partner: competitionSummarySchema.nullable(),
}).refine(value => (value.status === 'ready') === (value.partner !== null));
