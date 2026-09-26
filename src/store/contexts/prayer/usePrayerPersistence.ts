import { useEffect } from 'react';
import type { GamificationProfile, PrayerTrackingState, Task } from '../../../types/domain';
import { normalizePrayerTrackingState } from '../../../services/prayerTracking';
import { isPrayerServiceEnabled, savePrayerPreferences } from '../../../services/backend/prayerServiceApi';
import { loadStore, saveStore } from '../../persistence';
import { useRemoteStoreRefresh } from '../useRemoteStoreRefresh';
import {
  usePrayerServiceSync,
  type PrayerLocation,
  type PrayerOutcomeRejection,
  type PrayerServiceSyncState,
} from '../usePrayerServiceSync';
import type { PrayerTrackingStore } from './usePrayerTracking';

export interface PrayerPreferences {
  enabled: boolean;
  reminderEnabled: boolean;
  reminderMinutes: number;
}

export interface PrayerPersistenceInput {
  store: PrayerTrackingStore;
  /** Tasks, gamification and settings have loaded, so legacy data can be migrated. */
  sourcesLoaded: boolean;
  /** Legacy sources older tracking data is rebuilt from when it is first normalized. */
  gamification: GamificationProfile;
  tasks: readonly Task[];
  location: PrayerLocation;
  preferences: PrayerPreferences;
  /** The prayer service refused an outcome for good. */
  onRejected: (rejection: PrayerOutcomeRejection) => void;
}

/**
 * Keeps prayer tracking in step with where it is stored: the account's Supabase
 * record (loaded, refreshed on remote change, saved on every change) and, when
 * configured, the Spring prayer service (the outcome source of truth, merged in
 * when it answers, and sent every change). Prayer preferences edited in
 * Settings are mirrored to the service too.
 */
export function usePrayerPersistence({
  store,
  sourcesLoaded,
  gamification,
  tasks,
  location,
  preferences,
  onRejected,
}: PrayerPersistenceInput): PrayerServiceSyncState {
  const { tracking, loaded, markLoaded, getTracking, commitTracking } = store;
  const { city, country } = location;
  const { enabled, reminderEnabled, reminderMinutes } = preferences;
  const serviceSync = usePrayerServiceSync(getTracking, commitTracking, onRejected);

  const normalizeStored = (value: unknown): PrayerTrackingState => normalizePrayerTrackingState(value, {
    now: new Date(),
    dailyLog: gamification.dailyLog,
    prayerCompletionLedger: gamification.prayerCompletionLedger,
    tasks,
  });

  useEffect(() => {
    if (!sourcesLoaded) return;
    let cancelled = false;

    void loadStore<unknown>('prayerTracking').then(async value => {
      if (cancelled) return;
      const normalized = commitTracking(normalizeStored(value));
      markLoaded();
      // The prayer service is the source of truth for outcomes when configured; its data is
      // merged in when it arrives, so the page never waits for it.
      const hydrated = await serviceSync.hydrate(normalized, { city, country });
      if (!cancelled && hydrated !== getTracking()) commitTracking(hydrated);
    });

    return () => {
      cancelled = true;
    };
    // Initial migration intentionally uses the first fully loaded task/profile snapshots.
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [sourcesLoaded]);

  useRemoteStoreRefresh(['prayerTracking'], async () => {
    const value = await loadStore<unknown>('prayerTracking');
    const normalized = commitTracking(normalizeStored(value));
    const hydrated = await serviceSync.hydrate(normalized, { city, country });
    if (hydrated !== getTracking()) commitTracking(hydrated);
  });

  useEffect(() => {
    if (!loaded) return;
    void saveStore('prayerTracking', tracking);
    serviceSync.push(tracking);
    // serviceSync.push is stable; the service mirrors every tracking change.
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [loaded, tracking]);

  useEffect(() => {
    if (!loaded || !isPrayerServiceEnabled()) return;
    void savePrayerPreferences({ enabled, reminderEnabled, reminderMinutes })
      .catch(error => console.error('Prayer preferences could not be saved to the prayer service', error));
  }, [loaded, enabled, reminderEnabled, reminderMinutes]);

  return serviceSync.state;
}
