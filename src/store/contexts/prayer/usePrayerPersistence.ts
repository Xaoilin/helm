import { useEffect, useRef } from 'react';
import { LIVE_DOMAINS } from '../../../services/backend/liveDomains';
import { useLiveRefresh } from '../useLiveRefresh';
import {
  usePrayerServiceSync,
  type PrayerLocation,
  type PrayerOutcomeRejection,
  type PrayerServiceSyncState,
} from '../usePrayerServiceSync';
import type { PrayerTrackingStore } from './usePrayerTracking';

export interface PrayerPersistenceInput {
  store: PrayerTrackingStore;
  /** Tasks, rewards and settings have loaded, so prayer tracking can start. */
  sourcesLoaded: boolean;
  /** The location has come from the profile service, so outcomes can load for it. */
  locationReady: boolean;
  location: PrayerLocation;
  /** The prayer service refused an outcome for good. */
  onRejected: (rejection: PrayerOutcomeRejection) => void;
  /** The prayer service confirmed a change to this outcome (`date::prayer`). */
  onConfirmed: (key: string) => void;
}

export interface PrayerPersistence {
  serviceSync: PrayerServiceSyncState;
  /** Reloads outcomes from the service, e.g. to pick up misses the service records itself. */
  reload: () => void;
  /** Lets the next change delete every outcome: the user asked to reset all progress. */
  allowBulkDelete: () => void;
}

/**
 * Keeps prayer tracking in step with the prayer service, the only store of outcomes, the tracking start
 * and activation: they load from it (again whenever the page becomes visible, to pick up other devices)
 * and every change is sent to it. Reminders are the service's too (see usePrayerServiceReminders); the
 * account's old `prayerTracking` record is never read or written.
 */
export function usePrayerPersistence({
  store,
  sourcesLoaded,
  locationReady,
  location,
  onRejected,
  onConfirmed,
}: PrayerPersistenceInput): PrayerPersistence {
  const { tracking, loaded, markLoaded, getTracking, commitTracking } = store;
  const { city, country } = location;
  const serviceSync = usePrayerServiceSync(getTracking, commitTracking, onRejected, onConfirmed);
  // An outcome saved in another tab or device (a live-update event) reloads outcomes.
  useLiveRefresh(loaded ? LIVE_DOMAINS.prayer : [], serviceSync.rehydrate);

  // Outcomes load below when the location is final.
  useEffect(() => {
    if (sourcesLoaded) markLoaded();
  }, [markLoaded, sourcesLoaded]);

  // Reads need only the final location: start them alongside Tasks, whose readiness still gates writes.
  const hydratedRef = useRef(false);
  useEffect(() => {
    if (!locationReady || hydratedRef.current) return;
    hydratedRef.current = true;
    let cancelled = false;
    void serviceSync.hydrate(getTracking(), { city, country }).then(hydrated => {
      if (!cancelled && hydrated !== getTracking()) commitTracking(hydrated);
    });
    return () => {
      cancelled = true;
    };
    // The first load uses the final location; later changes reload through the service sync.
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [locationReady]);

  useEffect(() => {
    if (!loaded) return;
    const reloadWhenVisible = () => {
      if (document.visibilityState === 'visible') void serviceSync.rehydrate();
    };
    document.addEventListener('visibilitychange', reloadWhenVisible);
    return () => document.removeEventListener('visibilitychange', reloadWhenVisible);
    // serviceSync.rehydrate is stable.
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [loaded]);

  useEffect(() => {
    if (!loaded) return;
    serviceSync.push();
    // serviceSync.push is stable; the service receives every tracking change.
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [loaded, tracking]);

  return { serviceSync: serviceSync.state, reload: serviceSync.rehydrate, allowBulkDelete: serviceSync.allowBulkDelete };
}
