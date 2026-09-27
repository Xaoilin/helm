/**
 * Display-only types for the Activity page. The profile service computes the insights
 * (`GET /api/profile/v1/activity/insights`); the page only chooses filters and shows the result.
 */
import type { ProductUsageEventKind, ProductUsageOutcome, Surface } from '../types/domain';
import type {
  ServiceActivityFunnelStage,
  ServiceActivityInsights,
  ServiceActivityRecommendation,
} from './backend/activityContracts';

export const USAGE_RANGES = [7, 30, 90] as const;
export type UsageRangeDays = typeof USAGE_RANGES[number];

export interface ProductUsageFilters {
  rangeDays: UsageRangeDays;
  kind: ProductUsageEventKind | 'all';
  surface: Surface | 'all';
  outcome: ProductUsageOutcome | 'all';
  feature: string | 'all';
}

export type ProductUsageInsights = ServiceActivityInsights;
export type ProductUsageFunnelStage = ServiceActivityFunnelStage;
export type ProductUsageRecommendation = ServiceActivityRecommendation;

export const DEFAULT_PRODUCT_USAGE_FILTERS: ProductUsageFilters = {
  rangeDays: 30,
  kind: 'all',
  surface: 'all',
  outcome: 'all',
  feature: 'all',
};
