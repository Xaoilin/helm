import { useCallback, useEffect, useRef, useState } from 'react';
import type { PrayerTrackingState } from '../../../types/domain';
import { createPrayerTrackingState } from '../../../services/prayerTracking';

export type PrayerTrackingUpdate =
  | PrayerTrackingState
  | ((current: PrayerTrackingState) => PrayerTrackingState);

/** The in-memory prayer tracking aggregate and whether it has loaded. */
export interface PrayerTrackingStore {
  tracking: PrayerTrackingState;
  loaded: boolean;
  markLoaded: () => void;
  /** The latest committed state, including commits not yet rendered. */
  getTracking: () => PrayerTrackingState;
  /** Applies an update to the latest committed state, publishes it, and returns it. */
  commitTracking: (update: PrayerTrackingUpdate) => PrayerTrackingState;
}

/**
 * Owns the prayer tracking state. Commits update a ref synchronously as well as
 * React state, so several writes in one event (a completion, then a reminder
 * receipt) each build on the previous one instead of on the last render.
 */
export function usePrayerTracking(): PrayerTrackingStore {
  const [tracking, setTracking] = useState<PrayerTrackingState>(() => createPrayerTrackingState());
  const [loaded, setLoaded] = useState(false);
  const trackingRef = useRef(tracking);

  useEffect(() => {
    trackingRef.current = tracking;
  }, [tracking]);

  const commitTracking = useCallback((update: PrayerTrackingUpdate): PrayerTrackingState => {
    const next = typeof update === 'function' ? update(trackingRef.current) : update;
    trackingRef.current = next;
    setTracking(next);
    return next;
  }, []);

  const getTracking = useCallback(() => trackingRef.current, []);
  const markLoaded = useCallback(() => setLoaded(true), []);

  return { tracking, loaded, markLoaded, getTracking, commitTracking };
}
