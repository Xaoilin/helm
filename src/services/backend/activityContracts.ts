/**
 * Runtime contracts for the profile service's product-usage ("Activity") endpoints. Every response is
 * parsed through these schemas; `contracts/profile-service/activity-*.json` holds one example each,
 * which the unit tests parse here and the services repository verifies its real responses against.
 */
import { z } from 'zod';
import { apiErrorSchema } from './contracts';

const count = z.number().int().nonnegative();
const percent = z.number().int();

export const activityReceiptSchema = z.object({ accepted: count, duplicates: count });

export const activitySummarySchema = z.object({
  eventCount: count,
  sessionCount: count,
  activeSurfaceCount: count,
  errorCount: count,
  failureRate: percent.nullable(),
});

export const activityTrendSchema = z.object({
  key: z.string(),
  feature: z.string(),
  action: z.string(),
  currentCount: count,
  previousCount: count,
  changePercent: percent.nullable(),
});

export const activityFunnelStageSchema = z.object({
  id: z.enum(['sessions', 'surface_views', 'successful_opens']),
  label: z.string(),
  sessionCount: count,
  conversionPercent: percent.nullable(),
});

export const activityErrorSchema = z.object({ code: z.string(), count, surface: z.string() });

export const activityRecommendationSchema = z.object({
  id: z.string(),
  title: z.string(),
  summary: z.string(),
  evidence: z.string(),
  confidence: z.enum(['low', 'medium', 'high']),
  suggestedAction: z.string(),
});

export const activityInsightsSchema = z.object({
  rangeDays: z.number().int().positive(),
  totalEventCount: count,
  features: z.array(z.string()),
  summary: activitySummarySchema,
  trends: z.array(activityTrendSchema),
  funnel: z.array(activityFunnelStageSchema),
  errors: z.array(activityErrorSchema),
  recommendations: z.array(activityRecommendationSchema),
  coldStart: z.boolean(),
});

export type ServiceActivityReceipt = z.infer<typeof activityReceiptSchema>;
export type ServiceActivityInsights = z.infer<typeof activityInsightsSchema>;
export type ServiceActivityFunnelStage = z.infer<typeof activityFunnelStageSchema>;
export type ServiceActivityRecommendation = z.infer<typeof activityRecommendationSchema>;

/** Contract fixture (contracts/<service>/<name>.json) to the schema its body must satisfy. */
export const ACTIVITY_CONTRACT_SCHEMAS: Record<string, z.ZodType> = {
  'profile-service/activity-events-accepted': activityReceiptSchema,
  'profile-service/activity-events-invalid': apiErrorSchema,
  'profile-service/activity-insights': activityInsightsSchema,
};
