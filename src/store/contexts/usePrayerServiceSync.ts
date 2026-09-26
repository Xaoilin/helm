/**
 * Connects `PrayerProvider` to the prayer service: loads outcomes (importing this account's
 * legacy history once), then sends every later outcome change to the service in order. Failures
 * are reported through `state.error` and retried; the local state keeps working meanwhile.
 */
import { useCallback, useEffect, useRef, useState } from 'react';
import type { PrayerTrackingState } from '../../types/domain';
import {
  applyOutcomeOperation,
  applyServiceTracking,
  confirmedFromService,
  historyStartDate,
  listAllOutcomes,
  mergeRecords,
  planOutcomeSync,
  type ConfirmedOutcomes,
} from '../../services/backend/prayerOutcomeSync';
import { getPrayerDashboard, importPrayerTracking, isPrayerServiceEnabled } from '../../services/backend/prayerServiceApi';
import { ServiceError } from '../../services/backend/serviceClient';

export type PrayerServiceSyncStatus = 'disabled' | 'loading' | 'synced' | 'syncing' | 'error';

export interface PrayerServiceSyncState {
  status: PrayerServiceSyncStatus;
  error: string | null;
}

export interface PrayerLocation {
  city: string;
  country: string;
}

const RETRY_DELAY_MS = 30_000;

export function usePrayerServiceSync(
  getTracking: () => PrayerTrackingState,
  commitTracking: (next: PrayerTrackingState) => void,
) {
  const enabled = isPrayerServiceEnabled();
  const [state, setState] = useState<PrayerServiceSyncState>({
    status: enabled ? 'loading' : 'disabled',
    error: null,
  });
  const confirmedRef = useRef<ConfirmedOutcomes | null>(null);
  const desiredRef = useRef<PrayerTrackingState['records'] | null>(null);
  const drainingRef = useRef(false);
  const locationRef = useRef<PrayerLocation | null>(null);
  const retryTimerRef = useRef<ReturnType<typeof setTimeout> | null>(null);
  const unmountedRef = useRef(false);
  // Retries call the latest callbacks through refs, which also breaks the drain/hydrate cycles.
  const drainRef = useRef<() => void>(() => {});
  const rehydrateRef = useRef<() => void>(() => {});
  const hydratingRef = useRef<Promise<PrayerTrackingState> | null>(null);

  useEffect(() => () => {
    unmountedRef.current = true;
    if (retryTimerRef.current) clearTimeout(retryTimerRef.current);
  }, []);

  const fail = useCallback((error: unknown, retry: () => void) => {
    const message = error instanceof Error ? error.message : 'Prayer data could not be synced.';
    console.error('Prayer service sync failed', error);
    setState({ status: 'error', error: message });
    if (retryTimerRef.current) clearTimeout(retryTimerRef.current);
    retryTimerRef.current = setTimeout(() => {
      retryTimerRef.current = null;
      if (!unmountedRef.current) retry();
    }, RETRY_DELAY_MS);
  }, []);

  /** Sends pending changes one at a time until the service matches the app. */
  const drain = useCallback(async (): Promise<void> => {
    if (drainingRef.current || !confirmedRef.current || !desiredRef.current) return;
    drainingRef.current = true;
    try {
      let operations = planOutcomeSync(confirmedRef.current, desiredRef.current);
      while (operations.length > 0) {
        setState({ status: 'syncing', error: null });
        for (const operation of operations) {
          confirmedRef.current = await applyOutcomeOperation(operation, confirmedRef.current);
        }
        operations = planOutcomeSync(confirmedRef.current, desiredRef.current);
      }
      setState({ status: 'synced', error: null });
    } catch (error) {
      fail(error, () => drainRef.current());
    } finally {
      drainingRef.current = false;
    }
  }, [fail]);

  /**
   * Loads the service's outcomes and merges them into the app's current state (read when the
   * response arrives, so changes made meanwhile are kept). The first time, it imports `local`, this
   * account's legacy history. On failure it returns the current state and retries in the background.
   */
  const load = useCallback(async (
    local: PrayerTrackingState,
    location: PrayerLocation,
  ): Promise<PrayerTrackingState> => {
    locationRef.current = location;
    setState({ status: 'loading', error: null });
    try {
      let dashboard = await getPrayerDashboard(location.city, location.country);
      if (!dashboard.tracking.importedAt) {
        await importPrayerTracking(local).catch(ignoreAlreadyImported);
        dashboard = await getPrayerDashboard(location.city, location.country);
      }
      const startDate = historyStartDate(dashboard.tracking.trackingStartedAt, local.records, getTracking().records);
      const confirmed = confirmedFromService(await listAllOutcomes(startDate, dashboard.today));
      const current = getTracking();
      const records = mergeRecords(confirmed.records, current.records);
      confirmedRef.current = confirmed;
      desiredRef.current = records;
      setState({ status: 'synced', error: null });
      void drain();
      return applyServiceTracking(current, dashboard.tracking, records);
    } catch (error) {
      confirmedRef.current = null;
      fail(error, () => rehydrateRef.current());
      return getTracking();
    }
  }, [drain, fail, getTracking]);

  /** Concurrent loads (e.g. React's development double effects) share one request. */
  const hydrate = useCallback((local: PrayerTrackingState, location: PrayerLocation): Promise<PrayerTrackingState> => {
    if (!enabled) return Promise.resolve(local);
    hydratingRef.current ??= load(local, location).finally(() => { hydratingRef.current = null; });
    return hydratingRef.current;
  }, [enabled, load]);

  const rehydrate = useCallback(async () => {
    const location = locationRef.current;
    if (!location) return;
    const next = await hydrate(getTracking(), location);
    if (confirmedRef.current) commitTracking(next);
  }, [commitTracking, getTracking, hydrate]);

  useEffect(() => {
    drainRef.current = () => void drain();
    rehydrateRef.current = () => void rehydrate();
  }, [drain, rehydrate]);

  /** Queues the app's current outcomes to be sent to the service. */
  const push = useCallback((tracking: PrayerTrackingState) => {
    if (!enabled) return;
    desiredRef.current = tracking.records;
    void drain();
  }, [drain, enabled]);

  return { state, hydrate, push, rehydrate };
}

function ignoreAlreadyImported(error: unknown): void {
  if (!(error instanceof ServiceError) || error.code !== 'already_imported') throw error;
}
