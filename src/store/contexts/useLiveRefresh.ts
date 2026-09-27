import { useEffect, useRef } from 'react';
import { LIVE_READY, subscribeLiveEvents } from '../../services/backend/liveEvents';

/** Changes arriving together (a burst of saves) reload once. */
const COALESCE_MS = 300;

/**
 * Reloads a domain when another tab or device changes it: `refresh` runs after a live event for one of
 * `domains` (a write command's prefix, such as `lifestyle`), and after a live stream reconnects.
 */
export function useLiveRefresh(domains: readonly string[], refresh: () => void | Promise<void>): void {
  const refreshRef = useRef(refresh);
  const signature = domains.join('\u0000');

  useEffect(() => {
    refreshRef.current = refresh;
  }, [refresh]);

  useEffect(() => {
    const watched = new Set(signature.split('\u0000').filter(Boolean));
    if (watched.size === 0) return undefined;
    let timer: ReturnType<typeof setTimeout> | null = null;
    const unsubscribe = subscribeLiveEvents(event => {
      if (event.type !== LIVE_READY && !watched.has(event.domain)) return;
      if (timer) return;
      timer = setTimeout(() => {
        timer = null;
        void refreshRef.current();
      }, COALESCE_MS);
    });
    return () => {
      unsubscribe();
      if (timer) clearTimeout(timer);
    };
  }, [signature]);
}
