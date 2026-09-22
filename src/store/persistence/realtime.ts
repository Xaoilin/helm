import {
  getSupabaseRealtimeSnapshot,
  subscribeHelmBroadcast,
  subscribeSupabaseRealtimeSnapshot,
} from '../supabase';
import type { HelmSecretRealtimeEvent } from '../databaseTypes';
import type { DatabaseRefreshRequest, SyncSessionReason } from './types';
import { recordOperationalEvent } from '../../services/operationalTelemetry';

const MAX_RECOVERY_ATTEMPTS = 5;

function canRecoverInBackground(): boolean {
  return (typeof document === 'undefined' || document.visibilityState !== 'hidden')
    && (typeof navigator === 'undefined' || navigator.onLine !== false);
}

function recoveryDelay(attempt: number): number {
  return Math.min(1_000 * (2 ** attempt), 30_000) * (1 + Math.random() * 0.25);
}

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
  private subscriptionGeneration = 0;
  private startPromise: Promise<void> | null = null;
  private readyWaitCancel: (() => void) | null = null;
  private lifecycleRegistered = false;
  private healthRegistered = false;
  private recoveryTimer: ReturnType<typeof globalThis.setTimeout> | null = null;
  private recoveryAttempt = 0;
  private recovering = false;
  private channelTimer: ReturnType<typeof globalThis.setTimeout> | null = null;
  private channelAttempt = 0;

  constructor(owner: PersistenceRealtimeOwner) {
    this.owner = owner;
  }

  register(): void {
    this.registerLifecycleHandlers();
    this.registerRealtimeHealth();
  }

  reset(): void {
    this.resumeRecovery();
    this.stopSubscription();
  }

  markReady(): void {
    this.clearRecoveryTimer();
    this.recoveryAttempt = 0;
    this.recovering = false;
  }

  isRecovering(): boolean {
    return this.recovering;
  }

  /** Explicit retry or a browser lifecycle transition opens a new bounded cycle. */
  resumeRecovery(): void {
    this.markReady();
    if (this.channelTimer !== null) globalThis.clearTimeout(this.channelTimer);
    this.channelTimer = null;
    this.channelAttempt = 0;
  }

  scheduleRecovery(): void {
    this.recovering = true;
    const session = this.owner.getSession();
    if (
      this.recoveryTimer !== null
      || this.recoveryAttempt >= MAX_RECOVERY_ATTEMPTS
      || !session.authenticated
      || !session.userId
      || session.reason === 'incompatible_schema'
      || session.reason === 'client_update_required'
      || !canRecoverInBackground()
    ) return;
    const { epoch, userId } = session;
    const delay = recoveryDelay(this.recoveryAttempt);
    this.recoveryAttempt += 1;
    recordOperationalEvent({
      domain: 'database',
      operation: 'recovery',
      outcome: 'pending',
      reason: 'network',
      attempt: this.recoveryAttempt,
      freshness: 'stale',
    });
    this.recoveryTimer = globalThis.setTimeout(() => {
      this.recoveryTimer = null;
      if (canRecoverInBackground() && this.owner.getSession().isCurrent(epoch, userId)) {
        void this.owner.refresh({ recovery: true });
      }
    }, delay);
  }

  /** Channel recovery never gates authoritative HTTPS reads or writes. */
  connect(epoch: number, userId: string): void {
    if (this.channelTimer !== null || this.channelAttempt >= MAX_RECOVERY_ATTEMPTS
      || !canRecoverInBackground()) return;
    this.connectAttempt(epoch, userId);
  }

  private connectAttempt(epoch: number, userId: string): void {
    const operation = this.ensureSubscription(epoch, userId);
    const generation = this.subscriptionGeneration;
    void operation.catch(() => {
      if (generation === this.subscriptionGeneration && this.owner.getSession().isCurrent(epoch, userId)) {
        this.scheduleChannelRecovery();
      }
    });
  }

  private scheduleChannelRecovery(): void {
    const session = this.owner.getSession();
    // Remove the failed channel so SDK rejoin/reconnect timers cannot outlive
    // this boundary's budget or race its next subscription.
    this.stopSubscription();
    if (this.channelTimer !== null || this.channelAttempt >= MAX_RECOVERY_ATTEMPTS
      || !session.authenticated || !session.userId
      || session.reason === 'incompatible_schema' || session.reason === 'client_update_required'
      || !canRecoverInBackground()) return;
    const { epoch, userId } = session;
    const delay = recoveryDelay(this.channelAttempt);
    recordOperationalEvent({
      domain: 'realtime',
      operation: 'recovery',
      outcome: 'pending',
      reason: 'channel_error',
      attempt: this.channelAttempt + 1,
      freshness: 'stale',
    });
    this.channelTimer = globalThis.setTimeout(() => {
      this.channelTimer = null;
      if (canRecoverInBackground() && this.owner.getSession().isCurrent(epoch, userId)) {
        this.channelAttempt += 1;
        this.connectAttempt(epoch, userId);
      }
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

    this.stopSubscription();
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

  private stopSubscription(): void {
    this.subscriptionGeneration += 1;
    this.subscriptionEpoch = null;
    this.subscriptionUserId = null;
    const unsubscribe = this.broadcastUnsubscribe;
    this.broadcastUnsubscribe = null;
    this.readyWaitCancel?.();
    this.readyWaitCancel = null;
    this.startPromise = null;
    unsubscribe?.();
  }

  private pauseRecovery(): void {
    this.clearRecoveryTimer();
    if (this.channelTimer !== null) globalThis.clearTimeout(this.channelTimer);
    this.channelTimer = null;
    if (getSupabaseRealtimeSnapshot().state !== 'subscribed') this.stopSubscription();
  }

  private registerLifecycleHandlers(): void {
    if (this.lifecycleRegistered || typeof window === 'undefined') return;
    this.lifecycleRegistered = true;
    window.addEventListener('offline', () => {
      this.pauseRecovery();
      recordOperationalEvent({ domain: 'browser', operation: 'connectivity', outcome: 'changed', reason: 'offline' });
      const session = this.owner.getSession();
      if (session.userId) this.owner.publishDegraded(session.userId, 'offline', 'The browser is offline.');
    });
    window.addEventListener('online', () => {
      recordOperationalEvent({ domain: 'browser', operation: 'connectivity', outcome: 'changed', reason: 'online' });
      const session = this.owner.getSession();
      if (!session.authenticated) return;
      if (!canRecoverInBackground()) return;
      this.resumeRecovery();
      recordOperationalEvent({ domain: 'browser', operation: 'recovery', outcome: 'pending', reason: 'online' });
      void this.owner.refresh({ realtime: true });
    });
    document.addEventListener('visibilitychange', () => {
      recordOperationalEvent({
        domain: 'browser',
        operation: 'visibility',
        outcome: 'changed',
        reason: document.visibilityState === 'visible' ? 'visible' : 'hidden',
      });
      const session = this.owner.getSession();
      if (document.visibilityState === 'hidden') this.pauseRecovery();
      if (document.visibilityState === 'visible' && session.authenticated) {
        if (!canRecoverInBackground()) return;
        this.resumeRecovery();
        recordOperationalEvent({ domain: 'browser', operation: 'recovery', outcome: 'pending', reason: 'visible' });
        void this.owner.refresh({ realtime: true });
      }
    });
    window.setInterval(() => {
      const session = this.owner.getSession();
      if (!session.authenticated || !session.userId || !session.hasUsableSnapshot
        || document.visibilityState === 'hidden' || navigator.onLine === false) return;
      void this.owner.refresh();
    }, 10 * 60_000);
  }

  private registerRealtimeHealth(): void {
    if (this.healthRegistered) return;
    this.healthRegistered = true;
    subscribeSupabaseRealtimeSnapshot(snapshot => {
      this.owner.notifyHealth();
      const session = this.owner.getSession();
      if (!session.userId || !session.isCurrent(this.subscriptionEpoch ?? -1, this.subscriptionUserId ?? '')) return;
      if (snapshot.state === 'subscribed') {
        if (this.channelTimer !== null) globalThis.clearTimeout(this.channelTimer);
        this.channelTimer = null;
        this.channelAttempt = 0;
        // Reconcile changes missed during subscription setup or interruption.
        void this.owner.refresh();
      } else if (snapshot.state === 'closed' || snapshot.state === 'error' || snapshot.state === 'timed_out') {
        this.scheduleChannelRecovery();
      }
    });
  }
}
