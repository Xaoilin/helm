/**
 * Loading one domain from its Spring service: load on mount, keep the last confirmed data on screen
 * when a load fails, retry by itself a few times, then whenever the page is shown again. Writes report
 * failures through `reportFailure`, which reloads the confirmed state from the service. A change another
 * tab or device saves in one of `liveDomains` reloads it too (the live-update stream).
 */
import { useCallback, useEffect, useRef, useState } from 'react';
import { logWarn } from '../../services/logger';
import { useLiveRefresh } from './useLiveRefresh';

const LOAD_RETRY_DELAYS_MS = [2_000, 5_000, 15_000, 60_000];

export interface ServiceLoad {
  loaded: boolean;
  /** Why the last load or save failed; null while the data is current. */
  error: string | null;
  reload: () => Promise<void>;
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
): ServiceLoad {
  const [loaded, setLoaded] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const [failures, setFailures] = useState(0);
  const loadRef = useRef(load);
  useEffect(() => { loadRef.current = load; }, [load]);

  const reload = useCallback(async () => {
    if (!enabled) {
      setError(`The ${source.toLowerCase()} service is not configured for this build.`);
      setLoaded(true);
      return;
    }
    try {
      await loadRef.current();
      setError(null);
      setFailures(0);
    } catch (loadError) {
      logWarn(source, `Load failed: ${errorMessage(loadError)}`);
      setError(errorMessage(loadError));
      setFailures(count => count + 1);
    } finally {
      setLoaded(true);
    }
  }, [enabled, source]);

  const reportFailure = useCallback((writeError: unknown) => {
    logWarn(source, `Save failed: ${errorMessage(writeError)}`);
    setError(`Your last change was not saved: ${errorMessage(writeError)}`);
    void loadRef.current().catch(loadError => logWarn(source, `Reload failed: ${errorMessage(loadError)}`));
  }, [source]);

  useEffect(() => { void reload(); }, [reload]);
  useLiveRefresh(enabled ? liveDomains : [], reload);

  useEffect(() => {
    if (failures === 0 || !enabled) return undefined;
    const delay = LOAD_RETRY_DELAYS_MS[failures - 1];
    const retryWhenShown = () => { if (document.visibilityState === 'visible') void reload(); };
    document.addEventListener('visibilitychange', retryWhenShown);
    const timer = delay === undefined ? undefined : window.setTimeout(() => { void reload(); }, delay);
    return () => {
      document.removeEventListener('visibilitychange', retryWhenShown);
      if (timer !== undefined) window.clearTimeout(timer);
    };
  }, [enabled, failures, reload]);

  return { loaded, error, reload, reportFailure };
}
