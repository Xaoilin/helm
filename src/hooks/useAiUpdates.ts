import { useCallback, useEffect, useRef, useState } from 'react';
import { AI_UPDATES_REFRESH_MS, AI_UPDATES_STALE_MS, loadAiUpdates, newestAiRelease } from '../services/aiUpdates';
import type { AiUpdatesSnapshot } from '../types/domain';

interface AiUpdatesState {
  snapshot: AiUpdatesSnapshot | null;
  loading: boolean;
  offline: boolean;
  checkedAt: number;
}

export function useAiUpdates() {
  const [state, setState] = useState<AiUpdatesState>({ snapshot: null, loading: true, offline: false, checkedAt: 0 });
  const activeRequest = useRef<AbortController | null>(null);
  const lastAttempt = useRef(0);

  const refresh = useCallback(async (force = false) => {
    if (activeRequest.current || (!force && Date.now() - lastAttempt.current < AI_UPDATES_REFRESH_MS)) return;
    const request = new AbortController();
    activeRequest.current = request;
    lastAttempt.current = Date.now();
    setState(previous => ({ ...previous, loading: true }));
    try {
      const { snapshot, offline } = await loadAiUpdates(request.signal);
      if (request.signal.aborted) return;
      const checkedAt = Date.now();
      setState(previous => ({
        snapshot: previous.snapshot && Date.parse(previous.snapshot.updatedAt) > Date.parse(snapshot.updatedAt)
          ? previous.snapshot
          : snapshot,
        loading: false,
        offline,
        checkedAt,
      }));
    } catch (error) {
      if (request.signal.aborted) return;
      console.warn('AI Updates saved edition unavailable', error);
      const checkedAt = Date.now();
      setState(previous => ({ ...previous, loading: false, offline: true, checkedAt }));
    } finally {
      if (activeRequest.current === request) activeRequest.current = null;
    }
  }, []);

  useEffect(() => {
    void refresh(true);
    const refreshWhileVisible = () => {
      if (document.visibilityState === 'visible') void refresh();
    };
    const interval = window.setInterval(refreshWhileVisible, AI_UPDATES_REFRESH_MS);
    document.addEventListener('visibilitychange', refreshWhileVisible);
    return () => {
      window.clearInterval(interval);
      document.removeEventListener('visibilitychange', refreshWhileVisible);
      activeRequest.current?.abort();
      activeRequest.current = null;
    };
  }, [refresh]);

  const { snapshot, checkedAt } = state;
  const latestRelease = snapshot ? newestAiRelease(snapshot, checkedAt) : 0;
  const stale = Boolean(snapshot && checkedAt - Date.parse(snapshot.updatedAt) > AI_UPDATES_STALE_MS);
  return { ...state, latestRelease, stale, refresh };
}
