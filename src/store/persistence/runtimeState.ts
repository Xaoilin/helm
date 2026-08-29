import type { HelmSecretRealtimeEvent } from '../databaseTypes';
import type { RemoteStoreChange, SyncSessionSnapshot } from './types';

/**
 * Owns session, hydration, and refresh coordination state for one persistence
 * runtime. Cohesive cache, write, realtime, device, and health state lives in
 * their resettable boundaries rather than as unrelated module globals.
 */
export class PersistenceRuntimeState {
  accountVersion = 0;
  bootstrappedUserId: string | null = null;
  bootstrapPromise: Promise<void> | null = null;
  persistenceEpoch = 0;
  refreshPromise: Promise<void> | null = null;
  refreshQueued = false;
  refreshNeedsSnapshot = false;
  refreshNeedsRealtime = false;
  readonly refreshNeedsCollections = new Set<string>();
  refreshTargetVersion = 0;
  refreshActiveSnapshot = false;
  refreshActiveRealtime = false;
  refreshActiveTargetVersion = 0;
  readonly syncSessionSubscribers = new Set<(snapshot: SyncSessionSnapshot) => void>();
  readonly storeChangeSubscribers = new Set<(change: RemoteStoreChange) => void>();
  readonly secretChangeSubscribers = new Set<(event: HelmSecretRealtimeEvent) => void>();
  syncSession: SyncSessionSnapshot = {
    status: 'blocked',
    userId: null,
    accountVersion: 0,
    hasUsableSnapshot: false,
    readOnly: true,
    reason: 'signed_out',
    lastReadyAt: null,
    lastProbeAt: null,
    error: 'Sign in to load Sabah One data.',
  };

  resetCoordination(): void {
    this.bootstrapPromise = null;
    this.refreshPromise = null;
    this.refreshQueued = false;
    this.refreshNeedsSnapshot = false;
    this.refreshNeedsRealtime = false;
    this.refreshNeedsCollections.clear();
    this.refreshTargetVersion = 0;
    this.refreshActiveSnapshot = false;
    this.refreshActiveRealtime = false;
    this.refreshActiveTargetVersion = 0;
    this.accountVersion = 0;
    this.bootstrappedUserId = null;
  }
}
