import {
  getSupabaseRealtimeSnapshot,
  subscribeHelmBroadcast,
  subscribeSupabaseRealtimeSnapshot,
} from '../supabase';
import type { HelmSecretRealtimeEvent } from '../databaseTypes';
import type { DatabaseRefreshRequest, SyncSessionReason } from './types';

interface RealtimeSessionContext {
  epoch: number;
  userId: string | null;
  authenticated: boolean;
  hasUsableSnapshot: boolean;
  readOnly: boolean;
  reason: SyncSessionReason;
  isCurrent: (epoch: number, userId: string) => boolean;
}

interface PersistenceRealtimeOwner {
  getSession: () => RealtimeSessionContext;
  refresh: (request?: DatabaseRefreshRequest) => Promise<void>;
  publishDegraded: (
    userId: string,
    reason: Exclude<SyncSessionReason, 'signed_out' | 'configuration' | 'switching_account' | null>,
    error: string,
  ) => void;
  publishSecretChange: (event: HelmSecretRealtimeEvent) => void;
  notifyHealth: () => void;
  staleError: () => Error;
}

/**
 * Owns the private Broadcast channel, browser lifecycle refresh triggers, and
 * bounded recovery scheduling. Broadcast is an invalidation signal; the owner
 * always performs an authoritative database refresh before publication.
 */
export class PersistenceRealtimeBoundary {
  private readonly owner: PersistenceRealtimeOwner;
  private broadcastUnsubscribe: (() => void) | null = null;
  private subscriptionEpoch: number | null = null;
  private subscriptionUserId: string | null = null;
  private startPromise: Promise<void> | null = null;
  private readyWaitCancel: (() => void) | null = null;
  private lifecycleRegistered = false;
  private healthRegistered = false;
  private recoveryTimer: ReturnType<typeof globalThis.setTimeout> | null = null;
  private recoveryAttempt = 0;

  constructor(owner: PersistenceRealtimeOwner) {
    this.owner = owner;
  }

  register(): void {
    this.registerLifecycleHandlers();
    this.registerRealtimeHealth();
  }

  reset(): void {
    this.clearRecoveryTimer();
    this.readyWaitCancel?.();
    this.readyWaitCancel = null;
    this.broadcastUnsubscribe?.();
    this.broadcastUnsubscribe = null;
    this.subscriptionEpoch = null;
    this.subscriptionUserId = null;
    this.startPromise = null;
    this.recoveryAttempt = 0;
  }

  markReady(): void {
    this.clearRecoveryTimer();
    this.recoveryAttempt = 0;
  }

  scheduleRecovery(request: DatabaseRefreshRequest = { snapshot: true, realtime: true }): void {
    const session = this.owner.getSession();
    if (
      this.recoveryTimer !== null
      || !session.authenticated
      || !session.userId
      || session.reason === 'incompatible_schema'
      || session.reason === 'client_update_required'
      || (typeof navigator !== 'undefined' && navigator.onLine === false)
    ) return;
    const delay = Math.min(1_000 * (2 ** this.recoveryAttempt), 30_000);
    this.recoveryAttempt += 1;
    this.recoveryTimer = globalThis.setTimeout(() => {
      this.recoveryTimer = null;
      void this.owner.refresh(request);
    }, delay);
  }

  async ensureSubscription(epoch: number, userId: string): Promise<void> {
    const session = this.owner.getSession();
    if (!session.isCurrent(epoch, userId)) throw this.owner.staleError();
    const current = getSupabaseRealtimeSnapshot();
    if (
      this.broadcastUnsubscribe
      && this.subscriptionEpoch === epoch
      && this.subscriptionUserId === userId
      && current.state === 'subscribed'
    ) return;
    if (
      this.startPromise
      && this.subscriptionEpoch === epoch
      && this.subscriptionUserId === userId
    ) return this.startPromise;

    this.broadcastUnsubscribe?.();
    this.subscriptionEpoch = epoch;
    this.subscriptionUserId = userId;
    this.broadcastUnsubscribe = subscribeHelmBroadcast(event => {
      const active = this.owner.getSession();
      if (!active.isCurrent(epoch, userId)) return;
      const collections = [...new Set(event.changes.map(change => change.collection))];
      void this.owner.refresh({
        collections,
        snapshot: collections.length === 0,
        targetVersion: event.accountVersion,
      });
    }, event => {
      const active = this.owner.getSession();
      if (!active.isCurrent(epoch, userId)) return;
      void this.owner.refresh({ targetVersion: event.accountVersion }).then(() => {
        const latest = this.owner.getSession();
        if (latest.isCurrent(epoch, userId)) this.owner.publishSecretChange(event);
      });
    });
    const operation = this.waitForReady(epoch, userId).finally(() => {
      if (this.startPromise === operation) this.startPromise = null;
    });
    this.startPromise = operation;
    return operation;
  }

  private waitForReady(epoch: number, userId: string): Promise<void> {
    const current = getSupabaseRealtimeSnapshot();
    if (current.state === 'subscribed') return Promise.resolve();
    return new Promise((resolve, reject) => {
      let settled = false;
      let unsubscribe = () => {};
      let cancel = () => {};
      const finish = (error?: Error) => {
        if (settled) return;
        settled = true;
        globalThis.clearTimeout(timeout);
        unsubscribe();
        if (this.readyWaitCancel === cancel) this.readyWaitCancel = null;
        if (error) reject(error);
        else resolve();
      };
      cancel = () => finish(this.owner.staleError());
      this.readyWaitCancel = cancel;
      const timeout = globalThis.setTimeout(() => {
        finish(new Error('The private Sabah One database update channel did not become ready.'));
      }, 10_000);
      const removeSubscription = subscribeSupabaseRealtimeSnapshot(snapshot => {
        const session = this.owner.getSession();
        if (!session.isCurrent(epoch, userId)) {
          finish(this.owner.staleError());
        } else if (snapshot.state === 'subscribed') {
          finish();
        } else if (snapshot.state === 'error' || snapshot.state === 'timed_out' || snapshot.state === 'closed') {
          finish(new Error(snapshot.lastError || `The private Sabah One update channel is ${snapshot.state}.`));
        }
      });
      unsubscribe = removeSubscription;
      if (settled) unsubscribe();
    });
  }

  private clearRecoveryTimer(): void {
    if (this.recoveryTimer !== null) globalThis.clearTimeout(this.recoveryTimer);
    this.recoveryTimer = null;
  }

  private registerLifecycleHandlers(): void {
    if (this.lifecycleRegistered || typeof window === 'undefined') return;
    this.lifecycleRegistered = true;
    window.addEventListener('offline', () => {
      const session = this.owner.getSession();
      if (session.userId) this.owner.publishDegraded(session.userId, 'offline', 'The browser is offline.');
    });
    window.addEventListener('online', () => {
      const session = this.owner.getSession();
      if (!session.authenticated) return;
      this.clearRecoveryTimer();
      void this.owner.refresh({ realtime: true });
    });
    document.addEventListener('visibilitychange', () => {
      const session = this.owner.getSession();
      if (document.visibilityState === 'visible' && session.authenticated) {
        void this.owner.refresh();
      }
    });
    window.setInterval(() => {
      const session = this.owner.getSession();
      if (!session.userId || !session.hasUsableSnapshot || session.readOnly) return;
      void this.owner.refresh();
    }, 15_000);
  }

  private registerRealtimeHealth(): void {
    if (this.healthRegistered) return;
    this.healthRegistered = true;
    subscribeSupabaseRealtimeSnapshot(snapshot => {
      this.owner.notifyHealth();
      const session = this.owner.getSession();
      if (
        session.hasUsableSnapshot
        && (snapshot.state === 'closed' || snapshot.state === 'error' || snapshot.state === 'timed_out')
        && session.userId
      ) {
        this.owner.publishDegraded(
          session.userId,
          'realtime_unavailable',
          snapshot.lastError || `The private database update channel is ${snapshot.state}.`,
        );
        this.scheduleRecovery({ realtime: true });
      }
    });
  }
}
