import { describe, expect, it } from 'vitest';
import {
  buildProductUsageInsights,
  DEFAULT_PRODUCT_USAGE_FILTERS,
  type ProductUsageFilters,
} from '../services/productUsageInsights';
import type { ProductUsageEvent } from '../types/domain';

const NOW = new Date('2026-08-30T12:00:00.000Z');

function makeEvent(overrides: Partial<ProductUsageEvent> = {}): ProductUsageEvent {
  return {
    eventId: 'event-default',
    schemaVersion: 1,
    sessionId: 'session-1',
    sequence: 1,
    kind: 'action',
    occurredAt: '2026-08-29T12:00:00.000Z',
    surface: 'dashboard',
    feature: 'surface',
    action: 'surface_selected',
    releaseVersion: '0.2.129',
    deviceClass: 'desktop',
    inputKind: 'system',
    online: true,
    reducedMotion: false,
    ...overrides,
  };
}

function makeHealthyEvents(): ProductUsageEvent[] {
  return [
    ...(['session-1', 'session-2', 'session-3'].map((sessionId, index) => makeEvent({
      eventId: `session-${index}`,
      sessionId,
      sequence: 1,
      kind: 'session',
      feature: 'application',
      action: 'session_started',
      occurredAt: `2026-08-${28 + index}T10:00:00.000Z`,
    }))),
    ...Array.from({ length: 8 }, (_, index) => makeEvent({
      eventId: `current-${index}`,
      sessionId: `session-${(index % 3) + 1}`,
      sequence: index + 2,
      feature: 'navigation',
      action: 'surface_viewed',
      occurredAt: `2026-08-${28 + (index % 3)}T11:00:00.000Z`,
    })),
    ...Array.from({ length: 4 }, (_, index) => makeEvent({
      eventId: `previous-${index}`,
      sessionId: `session-${(index % 3) + 1}`,
      sequence: index + 20,
      feature: 'navigation',
      action: 'surface_viewed',
      occurredAt: `2026-07-${10 + (index % 3)}T11:00:00.000Z`,
    })),
  ];
}

function withFilters(overrides: Partial<ProductUsageFilters>): ProductUsageFilters {
  return { ...DEFAULT_PRODUCT_USAGE_FILTERS, ...overrides };
}

describe('private product usage insights', () => {
  it('builds current trends, session funnels, and error summaries from content-free events', () => {
    const events = [
      ...makeHealthyEvents(),
      makeEvent({ eventId: 'error-1', kind: 'error', action: 'render_failed', errorCode: 'react_render_error', outcome: 'failure' }),
    ];
    const insights = buildProductUsageInsights(events, DEFAULT_PRODUCT_USAGE_FILTERS, NOW);

    expect(insights.coldStart).toBe(false);
    expect(insights.summary).toMatchObject({ eventCount: 12, sessionCount: 3, errorCount: 1 });
    expect(insights.trends[0]).toMatchObject({ feature: 'navigation', action: 'surface_viewed', currentCount: 8, previousCount: 4 });
    expect(insights.funnel.map(stage => stage.id)).toEqual(['sessions', 'surface_views', 'successful_opens']);
    expect(insights.errors).toEqual([{ code: 'react_render_error', count: 1, surface: 'dashboard' }]);
  });

  it('applies event, surface, outcome, feature, and time-window filters', () => {
    const events = [
      ...makeHealthyEvents(),
      makeEvent({ eventId: 'calendar-1', surface: 'calendar', feature: 'calendar', action: 'viewed', outcome: 'success' }),
      makeEvent({ eventId: 'old-1', occurredAt: '2026-07-01T12:00:00.000Z', surface: 'calendar', feature: 'calendar', outcome: 'success' }),
    ];
    const insights = buildProductUsageInsights(events, withFilters({
      rangeDays: 7,
      kind: 'action',
      surface: 'calendar',
      outcome: 'all',
      feature: 'calendar',
    }), NOW);

    expect(insights.filteredEvents).toHaveLength(1);
    expect(insights.filteredEvents[0]).toMatchObject({ surface: 'calendar', feature: 'calendar' });
  });

  it('suppresses conclusions during cold start', () => {
    const insights = buildProductUsageInsights(
      Array.from({ length: 9 }, (_, index) => makeEvent({ eventId: `small-${index}` })),
      DEFAULT_PRODUCT_USAGE_FILTERS,
      NOW,
    );

    expect(insights.coldStart).toBe(true);
    expect(insights.recommendations).toEqual([]);
  });

  it('includes evidence, confidence, and a suggested action for recommendations', () => {
    const events = [
      ...makeHealthyEvents(),
      ...Array.from({ length: 4 }, (_, index) => makeEvent({
        eventId: `failure-${index}`,
        kind: 'error',
        action: 'render_failed',
        errorCode: 'surface_unavailable',
        outcome: 'failure',
      })),
    ];
    const recommendations = buildProductUsageInsights(events, DEFAULT_PRODUCT_USAGE_FILTERS, NOW).recommendations;

    expect(recommendations.length).toBeGreaterThan(0);
    for (const recommendation of recommendations) {
      expect(recommendation.evidence).toBeTruthy();
      expect(['low', 'medium', 'high']).toContain(recommendation.confidence);
      expect(recommendation.suggestedAction).toMatch(/suggested action/i);
    }
    expect(JSON.stringify(recommendations).toLowerCase()).not.toContain('xp');
  });
});
