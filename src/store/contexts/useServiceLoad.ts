/**
 * Loading one domain from its Spring service when demanded, keep confirmed data in this account's
 * mounted providers, and invalidate it even while its view is closed. Concurrent reads share one
 * request; a live change during that request schedules one trailing read. Keep confirmed data on screen
 * when a load fails, retry by itself a few times, then whenever the page is shown again. Writes report
 * failures through `reportFailure`, which reloads the confirmed state from the service. A change another
 * tab or device saves in one of `liveDomains` reloads it too (the live-update stream).
 */
import { useCallback, useEffect, useRef, useState } from 'react';
import { logWarn } from '../../services/logger';
import { useLiveRefresh } from './useLiveRefresh';
import { useDomainDemand } from './useDomainDemand';
import { TIMING } from '../../config/constants';

const LOAD_RETRY_DELAYS_MS = [2_000, 5_000, 15_000, 60_000];

export interface ServiceLoad {
  loaded: boolean;
  /** Why the last load or save failed; null while the data is current. */
  error: string | null;
  reload: () => Promise<void>;
  /** Marks memory stale; reads now only if a consumer is active. */
  invalidate: () => Promise<void>;
  /** A write was refused or failed: show why and reload what the service holds. */
  reportFailure: (error: unknown) => void;
}

export function errorMessage(error: unknown): string {
  return error instanceof Error ? error.message : String(error);
}

export function useServiceLoad(
  source: string,
  enabled: boolean,
  load: () => Promise<void>,
  liveDomains: readonly string[] = [],
  options: { active?: boolean; requestKey?: string } = {},
): ServiceLoad {
  const demanded = useDomainDemand(source);
  const active = options.active ?? demanded;
  const requestKey = options.requestKey ?? '';
  const [loaded, setLoaded] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const [failures, setFailures] = useState(0);
  const loadRef = useRef(load);
  useEffect(() => { loadRef.current = load; }, [load]);
  const activeRef = useRef(active);
  const keyRef = useRef(requestKey);
  const dirty = useRef(true);
  const confirmed = useRef<{ key: string; at: number } | null>(null);
  const inFlight = useRef<Promise<void> | null>(null);
  const inFlightKey = useRef<string | null>(null);
  const mounted = useRef(true);
  useEffect(() => {
    mounted.current = true;
    return () => { mounted.current = false; };
  }, []);
  useEffect(() => { activeRef.current = active; keyRef.current = requestKey; }, [active, requestKey]);

  const reload = useCallback((): Promise<void> => {
    if (!mounted.current) return Promise.resolve();
    // A readiness prerequisite may become enabled in this same effect turn. A disabled
    // no-op must never occupy the flight needed by the subsequent real read.
    if (!enabled) {
      setError(`The ${source.toLowerCase()} service is not configured for this build.`);
      setLoaded(true);
      return Promise.resolve();
    }
    if (inFlight.current) return inFlight.current;
    inFlightKey.current = keyRef.current;
    inFlight.current = Promise.resolve().then(async () => {
      do {
        dirty.current = false;
        const key = keyRef.current;
        inFlightKey.current = key;
        try {
          await loadRef.current();
          confirmed.current = { key, at: Date.now() };
          setError(null);
          setFailures(0);
        } catch (loadError) {
          logWarn(source, `Load failed: ${errorMessage(loadError)}`);
          confirmed.current = null;
          setError(errorMessage(loadError));
          setFailures(count => count + 1);
        } finally {
          setLoaded(true);
        }
      } while (dirty.current && activeRef.current && mounted.current);
    }).finally(() => { inFlight.current = null; });
    return inFlight.current;
  }, [enabled, source]);

  const reportFailure = useCallback((writeError: unknown) => {
    logWarn(source, `Save failed: ${errorMessage(writeError)}`);
    const message = `Your last change was not saved: ${errorMessage(writeError)}`;
    setError(message);
    dirty.current = true;
    void reload().then(() => setError(message));
  }, [reload, source]);

  useEffect(() => {
    if (!active) return undefined;
    const refreshIfNeeded = () => {
      const cached = confirmed.current;
      if (dirty.current || !cached || cached.key !== requestKey
        || Date.now() - cached.at >= TIMING.SERVICE_MEMORY_FRESH_MS) {
        // A changed window during an existing request must load after that request settles.
        if (inFlight.current && inFlightKey.current !== requestKey) dirty.current = true;
        void reload();
      }
    };
    refreshIfNeeded();
    const whenShown = () => { if (document.visibilityState === 'visible') refreshIfNeeded(); };
    document.addEventListener('visibilitychange', whenShown);
    return () => document.removeEventListener('visibilitychange', whenShown);
  }, [active, reload, requestKey]);
  const invalidate = useCallback(() => {
    dirty.current = true;
    return activeRef.current ? reload() : Promise.resolve();
  }, [reload]);
  useLiveRefresh(enabled ? liveDomains : [], invalidate);

  useEffect(() => {
    if (failures === 0 || !enabled || !active) return undefined;
    const delay = LOAD_RETRY_DELAYS_MS[failures - 1];
    const retryWhenShown = () => { if (document.visibilityState === 'visible') void reload(); };
    document.addEventListener('visibilitychange', retryWhenShown);
    const timer = delay === undefined ? undefined : window.setTimeout(() => { void reload(); }, delay);
    return () => {
      document.removeEventListener('visibilitychange', retryWhenShown);
      if (timer !== undefined) window.clearTimeout(timer);
    };
  }, [active, enabled, failures, reload]);

  return { loaded, error, reload, invalidate, reportFailure };
}
