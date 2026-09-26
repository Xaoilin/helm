import { useEffect, useRef } from 'react';
import type { PrayerTrackingState } from '../../../types/domain';
import { normalizePrayerTrackingState } from '../../../services/prayerTracking';
import { loadStore, saveStore } from '../../persistence';
import { useRemoteStoreRefresh } from '../useRemoteStoreRefresh';
import {
  usePrayerServiceSync,
  type PrayerLocation,
  type PrayerOutcomeRejection,
  type PrayerServiceSyncState,
} from '../usePrayerServiceSync';
import type { PrayerTrackingStore } from './usePrayerTracking';

export interface PrayerPersistenceInput {
  store: PrayerTrackingStore;
  /** Tasks, rewards and settings have loaded, so reminder receipts can load. */
  sourcesLoaded: boolean;
  /** The location has come from the profile service, so outcomes can load for it. */
  locationReady: boolean;
  location: PrayerLocation;
  /** The prayer service refused an outcome for good. */
  onRejected: (rejection: PrayerOutcomeRejection) => void;
}

export interface PrayerPersistence {
  serviceSync: PrayerServiceSyncState;
  /** Reloads outcomes from the service, e.g. to pick up misses the service records itself. */
  reload: () => void;
}

/** Reminder receipts from the account's `prayerTracking` record, applied to the current state. */
function withStoredReceipts(current: PrayerTrackingState, stored: unknown): PrayerTrackingState {
  if (!stored) return current;
  const receipts = normalizePrayerTrackingState(stored, { now: new Date() });
  return {
    ...current,
    reminderReceipts: receipts.reminderReceipts,
    boundedReminderReceipts: receipts.boundedReminderReceipts,
  };
}

/**
 * Keeps prayer tracking in step with where it is stored. The prayer service is the only store of
 * outcomes, the tracking start and activation: they load from it (again whenever the page becomes
 * visible, to pick up other devices) and every change is sent to it. Reminder receipts, which the
 * service does not hold, live in the account's `prayerTracking` record.
 */
export function usePrayerPersistence({
  store,
  sourcesLoaded,
  locationReady,
  location,
  onRejected,
}: PrayerPersistenceInput): PrayerPersistence {
  const { tracking, loaded, markLoaded, getTracking, commitTracking } = store;
  const { city, country } = location;
  const serviceSync = usePrayerServiceSync(getTracking, commitTracking, onRejected);

  useEffect(() => {
    if (!sourcesLoaded) return;
    let cancelled = false;

    void loadStore<unknown>('prayerTracking').then(stored => {
      if (cancelled) return;
      commitTracking(current => withStoredReceipts(current, stored));
      markLoaded();
    });

    return () => {
      cancelled = true;
    };
    // Receipts load once; outcomes load below when the location is final.
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [sourcesLoaded]);

  // The page does not wait for the service: outcomes merge in when it answers.
  const hydratedRef = useRef(false);
  useEffect(() => {
    if (!loaded || !locationReady || hydratedRef.current) return;
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
  }, [loaded, locationReady]);

  useRemoteStoreRefresh(['prayerTracking'], async () => {
    const stored = await loadStore<unknown>('prayerTracking');
    commitTracking(current => withStoredReceipts(current, stored));
  });

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
    // The account record keeps only reminder receipts (see recordCodec); outcomes go to the service.
    void saveStore('prayerTracking', tracking);
    serviceSync.push(tracking);
    // serviceSync.push is stable; the service receives every tracking change.
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [loaded, tracking]);

  return { serviceSync: serviceSync.state, reload: serviceSync.rehydrate };
}
