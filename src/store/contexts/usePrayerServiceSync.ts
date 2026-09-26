/**
 * Connects `PrayerProvider` to the prayer service: loads outcomes (importing this account's
 * legacy history once), then sends every later outcome change to the service in order. Failures
 * are reported through `state.error` and retried; the local state keeps working meanwhile.
 */
import { useCallback, useEffect, useRef, useState } from 'react';
import type { PrayerTrackingRecord, PrayerTrackingState } from '../../types/domain';
import {
  applyOutcomeOperation,
  applyServiceTracking,
  confirmedFromService,
  historyStartDate,
  isPermanentRejection,
  listAllOutcomes,
  mergeRecords,
  planOutcomeSync,
  type ConfirmedOutcomes,
} from '../../services/backend/prayerOutcomeSync';
import { getPrayerDashboard, isPrayerServiceEnabled } from '../../services/backend/prayerServiceApi';

export type PrayerServiceSyncStatus = 'disabled' | 'loading' | 'synced' | 'syncing' | 'error';

export interface PrayerServiceSyncState {
  status: PrayerServiceSyncStatus;
  error: string | null;
}

/** An outcome change the service refused; the app should show `confirmed` again. */
export interface PrayerOutcomeRejection {
  key: string;
  record: PrayerTrackingRecord;
  confirmed: PrayerTrackingRecord | undefined;
  message: string;
}

export interface PrayerLocation {
  city: string;
  country: string;
}

const RETRY_DELAY_MS = 30_000;
/** More deletions than this in one sync need an explicit reset; undos delete one at a time. */
export const MAX_DELETES_WITHOUT_RESET = 3;

export function usePrayerServiceSync(
  getTracking: () => PrayerTrackingState,
  commitTracking: (next: PrayerTrackingState) => void,
  onRejected: (rejection: PrayerOutcomeRejection) => void,
) {
  const enabled = isPrayerServiceEnabled();
  const [state, setState] = useState<PrayerServiceSyncState>({
    status: enabled ? 'loading' : 'disabled',
    error: null,
  });
  const confirmedRef = useRef<ConfirmedOutcomes | null>(null);
  const desiredRef = useRef<PrayerTrackingState['records'] | null>(null);
  const drainingRef = useRef(false);
  const bulkDeleteAllowedRef = useRef(false);
  const locationRef = useRef<PrayerLocation | null>(null);
  const retryTimerRef = useRef<ReturnType<typeof setTimeout> | null>(null);
  const unmountedRef = useRef(false);
  // Retries call the latest callbacks through refs, which also breaks the drain/hydrate cycles.
  const drainRef = useRef<() => void>(() => {});
  const rehydrateRef = useRef<() => void>(() => {});
  const hydratingRef = useRef<Promise<PrayerTrackingState> | null>(null);

  // Mounting resets the flag: StrictMode (and React re-mounts) run the cleanup and then mount again.
  useEffect(() => {
    unmountedRef.current = false;
    return () => {
      unmountedRef.current = true;
      if (retryTimerRef.current) clearTimeout(retryTimerRef.current);
    };
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

  /**
   * Sends pending changes one at a time until the service matches the app. A change the service
   * refuses for good is reverted to the service's version and reported, never retried; any other
   * failure stops the run and retries later.
   */
  const drain = useCallback(async (): Promise<void> => {
    if (drainingRef.current || !confirmedRef.current || !desiredRef.current) return;
    drainingRef.current = true;
    try {
      let operations = planOutcomeSync(confirmedRef.current, desiredRef.current);
      while (operations.length > 0) {
        const deletions = operations.filter(operation => operation.kind === 'delete').length;
        if (deletions > MAX_DELETES_WITHOUT_RESET && !bulkDeleteAllowedRef.current) {
          // A safety net: only "Reset all progress" removes many outcomes at once. Anything else
          // asking to is a bug, so nothing is sent; reloading the page loads the service's data again.
          console.error('Prayer service sync refused a bulk deletion', { deletions });
          setState({
            status: 'error',
            error: `Not synced: this change would delete ${deletions} saved prayers. Reload the page.`,
          });
          return;
        }
        setState({ status: 'syncing', error: null });
        for (const operation of operations) {
          try {
            confirmedRef.current = await applyOutcomeOperation(operation, confirmedRef.current);
          } catch (error) {
            if (!isPermanentRejection(error)) throw error;
            dropRejected(operation.key, error.message);
          }
        }
        operations = planOutcomeSync(confirmedRef.current, desiredRef.current);
      }
      bulkDeleteAllowedRef.current = false;
      setState({ status: 'synced', error: null });
    } catch (error) {
      fail(error, () => drainRef.current());
    } finally {
      drainingRef.current = false;
    }

    function dropRejected(key: string, message: string) {
      const confirmed = confirmedRef.current!.records[key];
      const record = desiredRef.current![key];
      const desired = { ...desiredRef.current! };
      if (confirmed) desired[key] = confirmed;
      else delete desired[key];
      desiredRef.current = desired;
      if (record) onRejected({ key, record, confirmed, message });
    }
  }, [fail, onRejected]);

  /**
   * Loads the service's outcomes and merges them into the app's current state (read when the
   * response arrives, so changes made meanwhile are kept). The service is the only store of
   * outcomes. On failure it returns the current state and retries in the background.
   */
  const load = useCallback(async (
    local: PrayerTrackingState,
    location: PrayerLocation,
  ): Promise<PrayerTrackingState> => {
    locationRef.current = location;
    setState({ status: 'loading', error: null });
    try {
      const dashboard = await getPrayerDashboard(location.city, location.country);
      const startDate = historyStartDate(dashboard.tracking.trackingStartedAt, local.records, getTracking().records);
      const confirmed = confirmedFromService(await listAllOutcomes(startDate, dashboard.today));
      const current = getTracking();
      const next = applyServiceTracking(current, dashboard.tracking, mergeRecords(confirmed.records, current.records));
      // Commit before accepting pushes, so no push can carry a state from before this merge.
      commitTracking(next);
      confirmedRef.current = confirmed;
      desiredRef.current = next.records;
      setState({ status: 'synced', error: null });
      void drain();
      return next;
    } catch (error) {
      confirmedRef.current = null;
      fail(error, () => rehydrateRef.current());
      return getTracking();
    }
  }, [commitTracking, drain, fail, getTracking]);

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

  /**
   * Queues the app's latest committed outcomes to be sent to the service. It never uses a copy from
   * a render: one from before the service's outcomes were merged in would read as deleting them all.
   */
  const push = useCallback(() => {
    if (!enabled) return;
    desiredRef.current = getTracking().records;
    void drain();
  }, [drain, enabled, getTracking]);

  /** The next sync may delete any number of outcomes: the user asked to reset all progress. */
  const allowBulkDelete = useCallback(() => { bulkDeleteAllowedRef.current = true; }, []);

  return { state, hydrate, push, rehydrate, allowBulkDelete };
}
