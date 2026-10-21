import { onCLS, onFCP, onINP, onLCP, onTTFB } from 'web-vitals';
import type { OperationalOperation } from '../types/domain';
import { flushOperationalEventsForReload, getOperationalSnapshot, recordOperationalEvent } from './operationalTelemetry';

/** Only bounded categories and numeric measurements leave the browser; never error text or URLs. */
export function recordBrowserFailure(operation: 'render' | 'exception' | 'unhandled_rejection', resource = false): void {
  recordOperationalEvent({ domain: 'browser', operation, outcome: 'failed',
    reason: operation === 'render' ? 'react_render_error' : resource ? 'resource_error' : 'javascript_error' });
}

export function recordWebMeasurement(operation: OperationalOperation, value: number): void {
  if (!Number.isFinite(value) || value < 0) return;
  recordOperationalEvent({ domain: 'browser', operation, outcome: 'ok', reason: 'ok',
    measurement: Math.min(value, 86_400_000), freshness: 'fresh' });
}

/** Install once outside React. Recording never waits for a transport or changes browser error handling. */
export function startBrowserObservability(): () => void {
  const error = (event: ErrorEvent | Event) => recordBrowserFailure('exception', !(event instanceof ErrorEvent));
  const rejection = () => recordBrowserFailure('unhandled_rejection');
  let reportedDrops = 0;
  const visibility = () => {
    const dropped = getOperationalSnapshot().dropped;
    if (dropped > reportedDrops) {
      recordOperationalEvent({ domain: 'browser', operation: 'collector', outcome: 'changed',
        reason: 'telemetry_dropped', measurement: dropped - reportedDrops });
    }
    reportedDrops = dropped;
    if (document.visibilityState === 'hidden') flushOperationalEventsForReload();
  };
  window.addEventListener('error', error, true);
  window.addEventListener('unhandledrejection', rejection);
  document.addEventListener('visibilitychange', visibility);
  const options = { reportAllChanges: false };
  onCLS(metric => recordWebMeasurement('cls', metric.value), options);
  onFCP(metric => recordWebMeasurement('fcp', metric.value), options);
  onINP(metric => recordWebMeasurement('inp', metric.value), options);
  onLCP(metric => recordWebMeasurement('lcp', metric.value), options);
  onTTFB(metric => recordWebMeasurement('ttfb', metric.value), options);
  let observer: PerformanceObserver | undefined;
  if (typeof PerformanceObserver !== 'undefined' && PerformanceObserver.supportedEntryTypes?.includes('longtask')) {
    observer = new PerformanceObserver(list => {
      // Coalesce a callback's tasks rather than sending one event per task.
      recordWebMeasurement('long_task', list.getEntries().reduce((total, entry) => total + entry.duration, 0));
    });
    observer.observe({ type: 'longtask', buffered: true });
  }
  return () => {
    window.removeEventListener('error', error, true);
    window.removeEventListener('unhandledrejection', rejection);
    document.removeEventListener('visibilitychange', visibility);
    observer?.disconnect();
  };
}
