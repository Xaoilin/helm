import type {
  ProductUsageEvent,
  ProductUsageEventKind,
  ProductUsageOutcome,
  Surface,
} from '../types/domain';

export const USAGE_RANGES = [7, 30, 90] as const;
export type UsageRangeDays = typeof USAGE_RANGES[number];

export interface ProductUsageFilters {
  rangeDays: UsageRangeDays;
  kind: ProductUsageEventKind | 'all';
  surface: Surface | 'all';
  outcome: ProductUsageOutcome | 'all';
  feature: string | 'all';
}

export interface ProductUsageSummary {
  eventCount: number;
  sessionCount: number;
  activeSurfaceCount: number;
  errorCount: number;
  failureRate: number | null;
}

export interface ProductUsageTrend {
  key: string;
  feature: string;
  action: string;
  currentCount: number;
  previousCount: number;
  changePercent: number | null;
}

export interface ProductUsageFunnelStage {
  id: 'sessions' | 'surface_views' | 'successful_opens';
  label: string;
  sessionCount: number;
  conversionPercent: number | null;
}

export interface ProductUsageErrorSummary {
  code: string;
  count: number;
  surface: string;
}

export type ProductUsageRecommendationConfidence = 'low' | 'medium' | 'high';

export interface ProductUsageRecommendation {
  id: string;
  title: string;
  summary: string;
  evidence: string;
  confidence: ProductUsageRecommendationConfidence;
  suggestedAction: string;
}

export interface ProductUsageInsights {
  filteredEvents: ProductUsageEvent[];
  summary: ProductUsageSummary;
  trends: ProductUsageTrend[];
  funnel: ProductUsageFunnelStage[];
  errors: ProductUsageErrorSummary[];
  recommendations: ProductUsageRecommendation[];
  coldStart: boolean;
}

export const DEFAULT_PRODUCT_USAGE_FILTERS: ProductUsageFilters = {
  rangeDays: 30,
  kind: 'all',
  surface: 'all',
  outcome: 'all',
  feature: 'all',
};

function isInRange(value: string, start: number, end: number): boolean {
  const time = Date.parse(value);
  return Number.isFinite(time) && time >= start && time < end;
}

function matchesFilters(event: ProductUsageEvent, filters: ProductUsageFilters): boolean {
  return (filters.kind === 'all' || event.kind === filters.kind)
    && (filters.surface === 'all' || event.surface === filters.surface)
    && (filters.outcome === 'all' || event.outcome === filters.outcome)
    && (filters.feature === 'all' || event.feature === filters.feature);
}

function taxonomyKey(event: ProductUsageEvent): string {
  return `${event.feature}:${event.action}`;
}

function percentage(value: number, total: number): number | null {
  if (total <= 0) return null;
  return Math.round((value / total) * 100);
}

function confidenceFor(sampleSize: number): ProductUsageRecommendationConfidence {
  if (sampleSize >= 30) return 'high';
  if (sampleSize >= 10) return 'medium';
  return 'low';
}

function displayKey(value: string): string {
  return value.replace(/_/g, ' ');
}

function buildTrends(
  currentEvents: ProductUsageEvent[],
  previousEvents: ProductUsageEvent[],
): ProductUsageTrend[] {
  const current = new Map<string, ProductUsageTrend>();
  const previous = new Map<string, number>();

  for (const event of previousEvents) {
    previous.set(taxonomyKey(event), (previous.get(taxonomyKey(event)) || 0) + 1);
  }
  for (const event of currentEvents) {
    const key = taxonomyKey(event);
    const existing = current.get(key);
    if (existing) {
      existing.currentCount += 1;
    } else {
      current.set(key, {
        key,
        feature: event.feature,
        action: event.action,
        currentCount: 1,
        previousCount: 0,
        changePercent: null,
      });
    }
  }

  return [...current.values()]
    .map(trend => {
      trend.previousCount = previous.get(trend.key) || 0;
      trend.changePercent = trend.previousCount === 0
        ? null
        : Math.round(((trend.currentCount - trend.previousCount) / trend.previousCount) * 100);
      return trend;
    })
    .sort((left, right) => right.currentCount - left.currentCount || left.key.localeCompare(right.key))
    .slice(0, 8);
}

function buildFunnel(events: ProductUsageEvent[]): ProductUsageFunnelStage[] {
  const sessions = new Set<string>();
  const viewed = new Set<string>();
  const opened = new Set<string>();

  for (const event of events) {
    if (event.kind === 'session') sessions.add(event.sessionId);
    if (event.kind === 'navigation' && event.action === 'viewed') viewed.add(event.sessionId);
    if (
      event.kind === 'outcome'
      && event.action === 'surface_opened'
      && event.outcome === 'success'
    ) opened.add(event.sessionId);
  }

  if (sessions.size === 0) return [];
  return [
    {
      id: 'sessions',
      label: 'Sessions started',
      sessionCount: sessions.size,
      conversionPercent: 100,
    },
    {
      id: 'surface_views',
      label: 'Sessions with a surface view',
      sessionCount: [...viewed].filter(sessionId => sessions.has(sessionId)).length,
      conversionPercent: percentage([...viewed].filter(sessionId => sessions.has(sessionId)).length, sessions.size),
    },
    {
      id: 'successful_opens',
      label: 'Sessions with a successful surface open',
      sessionCount: [...opened].filter(sessionId => sessions.has(sessionId)).length,
      conversionPercent: percentage([...opened].filter(sessionId => sessions.has(sessionId)).length, sessions.size),
    },
  ];
}

function buildErrors(events: ProductUsageEvent[]): ProductUsageErrorSummary[] {
  const grouped = new Map<string, ProductUsageErrorSummary>();
  for (const event of events) {
    if (event.kind !== 'error' && event.outcome !== 'failure') continue;
    const code = event.errorCode || event.action;
    const surface = event.surface || 'application';
    const key = `${code}:${surface}`;
    const existing = grouped.get(key);
    if (existing) {
      existing.count += 1;
    } else {
      grouped.set(key, { code, count: 1, surface });
    }
  }
  return [...grouped.values()]
    .sort((left, right) => right.count - left.count || left.code.localeCompare(right.code))
    .slice(0, 8);
}

function buildRecommendations(
  summary: ProductUsageSummary,
  trends: ProductUsageTrend[],
  funnel: ProductUsageFunnelStage[],
  errors: ProductUsageErrorSummary[],
  coldStart: boolean,
): ProductUsageRecommendation[] {
  if (coldStart) return [];
  const recommendations: ProductUsageRecommendation[] = [];

  if (summary.errorCount >= 3 && (summary.failureRate || 0) >= 20) {
    recommendations.push({
      id: 'reliability-review',
      title: 'Review the highest-frequency failure path',
      summary: 'Failures are a meaningful share of the selected activity window.',
      evidence: `${summary.errorCount} error events across ${summary.eventCount} events (${summary.failureRate}% failure outcomes). The most frequent code is ${displayKey(errors[0]?.code || 'unknown')}.`,
      confidence: confidenceFor(summary.eventCount),
      suggestedAction: 'Suggested action: inspect the affected surface and reproduce the coded failure before changing product behavior.',
    });
  }

  const views = funnel.find(stage => stage.id === 'surface_views');
  const opens = funnel.find(stage => stage.id === 'successful_opens');
  if (
    views
    && opens
    && views.sessionCount >= 5
    && opens.sessionCount < views.sessionCount * 0.7
  ) {
    recommendations.push({
      id: 'funnel-drop-off',
      title: 'Investigate the surface-open drop-off',
      summary: 'Fewer sessions reached a successful surface open than viewed a surface.',
      evidence: `${opens.sessionCount} of ${views.sessionCount} viewed sessions reached a successful open (${opens.conversionPercent ?? 0}% of started sessions).`,
      confidence: confidenceFor(summary.sessionCount),
      suggestedAction: 'Suggested action: compare the affected loading and error states with the intended entry flow; no automatic rearrangement is applied.',
    });
  }

  const risingTrend = trends.find(trend =>
    trend.currentCount >= 5
    && trend.previousCount >= 2
    && trend.currentCount >= trend.previousCount * 1.5,
  );
  if (risingTrend) {
    recommendations.push({
      id: `rising-${risingTrend.key}`,
      title: `Review the rising ${displayKey(risingTrend.feature)} path`,
      summary: 'This stable feature/action path appeared more often than in the preceding window.',
      evidence: `${displayKey(risingTrend.feature)} / ${displayKey(risingTrend.action)} occurred ${risingTrend.currentCount} times versus ${risingTrend.previousCount} previously (${risingTrend.changePercent}% change).`,
      confidence: confidenceFor(summary.eventCount),
      suggestedAction: 'Suggested action: decide whether this usage pattern deserves product review; usage alone does not trigger a change.',
    });
  }

  return recommendations.slice(0, 3);
}

export function buildProductUsageInsights(
  events: ProductUsageEvent[],
  filters: ProductUsageFilters = DEFAULT_PRODUCT_USAGE_FILTERS,
  now = new Date(),
): ProductUsageInsights {
  const end = now.getTime();
  const currentStart = end - filters.rangeDays * 24 * 60 * 60 * 1000;
  const previousStart = currentStart - filters.rangeDays * 24 * 60 * 60 * 1000;
  const currentEvents = events.filter(event =>
    isInRange(event.occurredAt, currentStart, end) && matchesFilters(event, filters),
  );
  const previousEvents = events.filter(event =>
    isInRange(event.occurredAt, previousStart, currentStart) && matchesFilters(event, filters),
  );
  const errorEvents = currentEvents.filter(event => event.kind === 'error' || event.outcome === 'failure');
  const outcomeEvents = currentEvents.filter(event => event.outcome !== undefined);
  const summary: ProductUsageSummary = {
    eventCount: currentEvents.length,
    sessionCount: new Set(currentEvents.map(event => event.sessionId)).size,
    activeSurfaceCount: new Set(currentEvents.map(event => event.surface).filter(Boolean)).size,
    errorCount: errorEvents.length,
    failureRate: percentage(errorEvents.length, outcomeEvents.length),
  };
  const trends = buildTrends(currentEvents, previousEvents);
  const funnel = buildFunnel(currentEvents);
  const errors = buildErrors(currentEvents);
  const coldStart = summary.eventCount < 10 || summary.sessionCount < 3;

  return {
    filteredEvents: currentEvents,
    summary,
    trends,
    funnel,
    errors,
    recommendations: buildRecommendations(summary, trends, funnel, errors, coldStart),
    coldStart,
  };
}
