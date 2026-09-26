import { useEffect, useMemo, useState } from 'react';
import { MetricCard } from '../components/common/MetricCard';
import { logError } from '../services/logger';
import { getProductUsageEvents } from '../store/supabase/productUsage';
import { useOptionalAuthSession } from '../store/AuthSessionContext';
import {
  buildProductUsageInsights,
  DEFAULT_PRODUCT_USAGE_FILTERS,
  USAGE_RANGES,
  type ProductUsageFilters,
  type ProductUsageFunnelStage,
  type ProductUsageInsights,
  type ProductUsageRecommendation,
  type UsageRangeDays,
} from '../services/productUsageInsights';
import type {
  ProductUsageEventKind,
  ProductUsageOutcome,
  Surface,
} from '../types/domain';

function formatCount(value: number): string {
  return value.toLocaleString();
}

function taxonomyLabel(value: string): string {
  return value.replace(/_/g, ' ');
}

function FilterControls({
  filters,
  features,
  onChange,
}: {
  filters: ProductUsageFilters;
  features: string[];
  onChange: (next: Partial<ProductUsageFilters>) => void;
}) {
  const kinds: Array<ProductUsageEventKind | 'all'> = [
    'all', 'session', 'navigation', 'action', 'outcome', 'error', 'performance',
  ];
  const outcomes: Array<ProductUsageOutcome | 'all'> = [
    'all', 'success', 'failure', 'cancelled', 'unavailable',
  ];

  return (
    <div className="activity-filters" aria-label="Usage filters">
      <label>
        <span>Time window</span>
        <select aria-label="Usage time window" value={filters.rangeDays} onChange={event => onChange({ rangeDays: Number(event.target.value) as UsageRangeDays })}>
          {USAGE_RANGES.map(days => <option key={days} value={days}>Last {days} days</option>)}
        </select>
      </label>
      <label>
        <span>Event type</span>
        <select aria-label="Usage event type" value={filters.kind} onChange={event => onChange({ kind: event.target.value as ProductUsageFilters['kind'] })}>
          {kinds.map(kind => <option key={kind} value={kind}>{kind === 'all' ? 'All events' : taxonomyLabel(kind)}</option>)}
        </select>
      </label>
      <label>
        <span>Surface</span>
        <select aria-label="Usage surface" value={filters.surface} onChange={event => onChange({ surface: event.target.value as ProductUsageFilters['surface'] })}>
          <option value="all">All surfaces</option>
          {(['dashboard', 'chat', 'calendar', 'clock', 'trips', 'projects', 'inventory', 'secrets', 'tasks', 'employment', 'finance', 'health', 'knowledge', 'profile', 'integrations', 'activity', 'settings', 'debug'] as Surface[]).map(surface => (
            <option key={surface} value={surface}>{taxonomyLabel(surface)}</option>
          ))}
        </select>
      </label>
      <label>
        <span>Outcome</span>
        <select aria-label="Usage outcome" value={filters.outcome} onChange={event => onChange({ outcome: event.target.value as ProductUsageFilters['outcome'] })}>
          {outcomes.map(outcome => <option key={outcome} value={outcome}>{outcome === 'all' ? 'All outcomes' : taxonomyLabel(outcome)}</option>)}
        </select>
      </label>
      <label>
        <span>Feature</span>
        <select aria-label="Usage feature" value={filters.feature} onChange={event => onChange({ feature: event.target.value })}>
          <option value="all">All features</option>
          {features.map(feature => <option key={feature} value={feature}>{taxonomyLabel(feature)}</option>)}
        </select>
      </label>
    </div>
  );
}

function RecommendationCard({ recommendation }: { recommendation: ProductUsageRecommendation }) {
  return (
    <article className="activity-recommendation">
      <div className="activity-recommendation-header">
        <div>
          <span className="activity-eyebrow">Suggested review</span>
          <h3>{recommendation.title}</h3>
        </div>
        <span className={`activity-confidence ${recommendation.confidence}`}>{recommendation.confidence} confidence</span>
      </div>
      <p>{recommendation.summary}</p>
      <div className="activity-recommendation-evidence"><strong>Evidence</strong><span>{recommendation.evidence}</span></div>
      <div className="activity-recommendation-action"><strong>Suggested action</strong><span>{recommendation.suggestedAction.replace('Suggested action: ', '')}</span></div>
    </article>
  );
}

function Funnel({ stages }: { stages: ProductUsageFunnelStage[] }) {
  if (stages.length === 0) return <p className="activity-muted">No session funnel can be shown for this filter.</p>;
  const max = stages[0].sessionCount || 1;
  return (
    <div className="activity-funnel" aria-label="Usage funnel">
      {stages.map(stage => (
        <div className="activity-funnel-row" key={stage.id}>
          <div className="activity-funnel-label"><span>{stage.label}</span><strong>{formatCount(stage.sessionCount)}</strong></div>
          <div className="activity-funnel-track" aria-hidden="true"><span style={{ width: `${Math.max(4, (stage.sessionCount / max) * 100)}%` }} /></div>
          <span className="activity-funnel-percent">{stage.conversionPercent ?? 0}%</span>
        </div>
      ))}
    </div>
  );
}

function UsageInsights({ insights }: { insights: ProductUsageInsights }) {
  return (
    <>
      <div className="activity-stats" aria-label="Usage summary">
        <MetricCard variant="stat" label="Events" value={formatCount(insights.summary.eventCount)} note="content-free records" />
        <MetricCard variant="stat" label="Sessions" value={formatCount(insights.summary.sessionCount)} note="unique private sessions" />
        <MetricCard variant="stat" label="Surfaces" value={formatCount(insights.summary.activeSurfaceCount)} note="surfaces with activity" />
        <MetricCard variant="stat" label="Errors" value={formatCount(insights.summary.errorCount)} note="coded failures" />
      </div>

      {insights.coldStart ? (
        <section className="activity-panel activity-cold-start" aria-labelledby="activity-cold-start-title">
          <span className="activity-eyebrow">Cold start</span>
          <h2 id="activity-cold-start-title">More activity is needed before drawing product conclusions.</h2>
          <p>This view has {formatCount(insights.summary.eventCount)} events across {formatCount(insights.summary.sessionCount)} sessions. Trends, funnels, and recommendations stay conservative until there are at least 10 events across 3 sessions.</p>
        </section>
      ) : (
        <section className="activity-panel" aria-labelledby="activity-recommendations-title">
          <div className="activity-section-heading"><div><span className="activity-eyebrow">Evidence-led guidance</span><h2 id="activity-recommendations-title">Product recommendations</h2></div><span className="activity-panel-note">Suggested actions only</span></div>
          {insights.recommendations.length === 0 ? <p className="activity-muted">No action is recommended from this window yet.</p> : <div className="activity-recommendations">{insights.recommendations.map(recommendation => <RecommendationCard key={recommendation.id} recommendation={recommendation} />)}</div>}
        </section>
      )}

      <div className="activity-insight-grid">
        <section className="activity-panel" aria-labelledby="activity-trends-title">
          <div className="activity-section-heading"><div><span className="activity-eyebrow">Feature trends</span><h2 id="activity-trends-title">Most-used paths</h2></div></div>
          {insights.trends.length === 0 ? <p className="activity-muted">No feature paths match these filters.</p> : <div className="activity-trend-list">{insights.trends.map(trend => <div className="activity-trend-row" key={trend.key}><div><strong>{taxonomyLabel(trend.feature)}</strong><span>{taxonomyLabel(trend.action)}</span></div><strong>{formatCount(trend.currentCount)}</strong><span className="activity-trend-change">{trend.changePercent === null ? 'New path' : `${trend.changePercent >= 0 ? '+' : ''}${trend.changePercent}% vs prior`}</span></div>)}</div>}
        </section>
        <section className="activity-panel" aria-labelledby="activity-funnel-title">
          <div className="activity-section-heading"><div><span className="activity-eyebrow">Funnel</span><h2 id="activity-funnel-title">Session progression</h2></div></div>
          <Funnel stages={insights.funnel} />
        </section>
      </div>

      <section className="activity-panel" aria-labelledby="activity-errors-title">
        <div className="activity-section-heading"><div><span className="activity-eyebrow">Reliability</span><h2 id="activity-errors-title">Coded errors</h2></div><span className="activity-panel-note">No raw messages</span></div>
        {insights.errors.length === 0 ? <p className="activity-muted">No coded errors match these filters.</p> : <div className="activity-error-list">{insights.errors.map(error => <div className="activity-error-row" key={`${error.code}:${error.surface}`}><strong>{taxonomyLabel(error.code)}</strong><span>{taxonomyLabel(error.surface)}</span><b>{formatCount(error.count)}</b></div>)}</div>}
      </section>
      <p className="activity-privacy-note">Private to this signed-in account. Analytics is content-free.</p>
    </>
  );
}

function UsageSection() {
  const authSession = useOptionalAuthSession();
  const authUserId = authSession?.authUser?.id ?? null;
  const supabaseReady = authSession?.supabaseReady ?? false;
  const [events, setEvents] = useState<Awaited<ReturnType<typeof getProductUsageEvents>>>([]);
  const [filters, setFilters] = useState<ProductUsageFilters>(DEFAULT_PRODUCT_USAGE_FILTERS);
  const [loading, setLoading] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const [refreshNonce, setRefreshNonce] = useState(0);

  useEffect(() => {
    if (!authUserId || !supabaseReady || authSession?.loading) {
      setEvents([]); setError(null); setLoading(false); return;
    }
    let cancelled = false;
    setLoading(true); setError(null);
    getProductUsageEvents()
      .then(nextEvents => { if (!cancelled) setEvents(nextEvents); })
      .catch(reason => {
        if (cancelled) return;
        logError('Activity', reason);
        setEvents([]);
        setError('Private usage activity could not be loaded. Check the connection and try again.');
      })
      .finally(() => { if (!cancelled) setLoading(false); });
    return () => { cancelled = true; };
  }, [authSession?.loading, authUserId, refreshNonce, supabaseReady]);

  const features = useMemo(() => [...new Set(events.map(event => event.feature))].sort(), [events]);
  const insights = useMemo(() => buildProductUsageInsights(events, filters), [events, filters]);

  return (
    <section className="activity-usage" aria-labelledby="activity-usage-title">
      <div className="activity-section-heading activity-usage-heading"><div><span className="activity-eyebrow">Private product usage</span><h2 id="activity-usage-title">Usage overview</h2><p>Recent content-free activity, trends, funnels, and coded errors for this account.</p></div>{authUserId && supabaseReady && <button type="button" className="btn btn-secondary btn-sm" onClick={() => setRefreshNonce(value => value + 1)} disabled={loading}>{loading ? 'Refreshing…' : 'Refresh'}</button>}</div>
      {!authSession || !authSession.bootstrapped || authSession.loading ? (
        <div className="activity-panel activity-state" role="status" aria-live="polite">Checking private account access…</div>
      ) : !authUserId ? (
        <div className="activity-panel activity-state" role="status"><strong>Sign in to view private usage activity.</strong><span>Usage records are never shown in signed-out mode.</span></div>
      ) : !supabaseReady ? (
        <div className="activity-panel activity-state" role="alert"><strong>Account database unavailable.</strong><span>Private usage activity is hidden until the account database is ready.</span></div>
      ) : loading ? (
        <div className="activity-panel activity-state" role="status" aria-live="polite">Loading private usage activity…</div>
      ) : error ? (
        <div className="activity-panel activity-state activity-state-error" role="alert"><strong>{error}</strong><button type="button" className="btn btn-secondary btn-sm" onClick={() => setRefreshNonce(value => value + 1)}>Try again</button></div>
      ) : events.length === 0 ? (
        <div className="activity-panel activity-state"><strong>No private usage activity yet.</strong><span>Once this signed-in account uses Sabah One, content-free activity will appear here.</span></div>
      ) : (
        <><FilterControls filters={filters} features={features} onChange={next => setFilters(current => ({ ...current, ...next }))} />{insights.filteredEvents.length === 0 ? <div className="activity-panel activity-state"><strong>No activity matches these filters.</strong><button type="button" className="btn btn-secondary btn-sm" onClick={() => setFilters(DEFAULT_PRODUCT_USAGE_FILTERS)}>Clear filters</button></div> : <UsageInsights insights={insights} />}</>
      )}
    </section>
  );
}

export default function ActivitySurface() {
  return <><div className="surface-header"><div><h1>Activity</h1><div className="subtitle">Private usage insight.</div></div></div><div className="surface-body activity-surface"><UsageSection /></div></>;
}
