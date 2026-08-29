import type { SupabaseRealtimeSnapshot } from '../supabase';
import type {
  PersistenceHealthSnapshot,
  SupabaseWriteQueueSnapshot,
  SyncSessionSnapshot,
} from './types';

interface PersistenceHealthSources {
  getSession: () => SyncSessionSnapshot;
  getWriteQueue: () => SupabaseWriteQueueSnapshot;
  getRealtime: () => SupabaseRealtimeSnapshot;
  countLegacyCandidates: () => number;
}

/** Owns persistence diagnostics and publishes immutable health snapshots. */
export class PersistenceHealthPublisher {
  private readonly sources: PersistenceHealthSources;
  private readonly subscribers = new Set<(snapshot: PersistenceHealthSnapshot) => void>();
  private lastLocalWriteAt: string | null = null;
  private lastLocalWriteKey: string | null = null;
  private lastLocalWriteError: string | null = null;
  private lastRemoteReadAt: string | null = null;
  private lastRemoteReadKey: string | null = null;
  private lastRemoteReadError: string | null = null;
  private lastRemoteWriteAt: string | null = null;
  private lastRemoteWriteKey: string | null = null;
  private lastRemoteWriteError: string | null = null;
  private lastCalendarCacheCleanupAt: string | null = null;
  private lastCalendarCacheCleanupReason: string | null = null;
  private lastCalendarSyncRequestAt: string | null = null;
  private lastCalendarSyncRequestReason: string | null = null;

  constructor(sources: PersistenceHealthSources) {
    this.sources = sources;
  }

  recordLocalWrite(key: string): void {
    this.lastLocalWriteAt = new Date().toISOString();
    this.lastLocalWriteKey = key;
    this.lastLocalWriteError = null;
    this.notify();
  }

  recordRemoteRead(key: string): void {
    this.lastRemoteReadAt = new Date().toISOString();
    this.lastRemoteReadKey = key;
    this.lastRemoteReadError = null;
    this.notify();
  }

  recordRemoteReadFailure(error: unknown): void {
    this.lastRemoteReadError = error instanceof Error ? error.message : String(error);
    this.notify();
  }

  recordRemoteWrite(key: string | null, completedAt = new Date().toISOString()): void {
    this.lastRemoteWriteAt = completedAt;
    this.lastRemoteWriteKey = key;
    this.lastRemoteWriteError = null;
    this.notify();
  }

  recordRemoteWriteFailure(error: unknown): void {
    this.lastRemoteWriteError = error instanceof Error ? error.message : String(error);
    this.notify();
  }

  recordCalendarCleanup(reason: string): void {
    this.lastCalendarCacheCleanupAt = new Date().toISOString();
    this.lastCalendarCacheCleanupReason = reason;
    this.notify();
  }

  recordCalendarRequest(reason: string): void {
    this.lastCalendarSyncRequestAt = new Date().toISOString();
    this.lastCalendarSyncRequestReason = reason;
    this.notify();
  }

  resetAccountDiagnostics(): void {
    this.lastRemoteReadAt = null;
    this.lastRemoteReadKey = null;
    this.lastRemoteReadError = null;
    this.lastRemoteWriteAt = null;
    this.lastRemoteWriteKey = null;
    this.lastRemoteWriteError = null;
    this.lastCalendarCacheCleanupAt = null;
    this.lastCalendarCacheCleanupReason = null;
    this.lastCalendarSyncRequestAt = null;
    this.lastCalendarSyncRequestReason = null;
    this.notify();
  }

  getLastRemoteWriteError(): string | null {
    return this.lastRemoteWriteError;
  }

  getSnapshot(): PersistenceHealthSnapshot {
    const syncSession = this.sources.getSession();
    return {
      mode: syncSession.status === 'ready'
        ? 'database'
        : syncSession.hasUsableSnapshot ? 'read-only' : 'blocked',
      syncSession,
      lastLocalWriteAt: this.lastLocalWriteAt,
      lastLocalWriteKey: this.lastLocalWriteKey,
      lastLocalWriteError: this.lastLocalWriteError,
      lastRemoteReadAt: this.lastRemoteReadAt,
      lastRemoteReadKey: this.lastRemoteReadKey,
      lastRemoteReadError: this.lastRemoteReadError,
      lastRemoteWriteAt: this.lastRemoteWriteAt,
      lastRemoteWriteKey: this.lastRemoteWriteKey,
      lastRemoteWriteError: this.lastRemoteWriteError,
      remoteReadFailedKeys: this.lastRemoteReadError ? [this.lastRemoteReadKey || 'account'] : [],
      lastSuppressedInitialWriteKey: null,
      lastSuppressedInitialWriteAt: null,
      dirtyKeys: [],
      supabaseQueue: this.sources.getWriteQueue(),
      supabaseRealtime: this.sources.getRealtime(),
      localImportCandidateCount: this.sources.countLegacyCandidates(),
      lastCalendarCacheCleanupAt: this.lastCalendarCacheCleanupAt,
      lastCalendarCacheCleanupReason: this.lastCalendarCacheCleanupReason,
      lastCalendarSyncRequestAt: this.lastCalendarSyncRequestAt,
      lastCalendarSyncRequestReason: this.lastCalendarSyncRequestReason,
    };
  }

  notify(): void {
    const snapshot = this.getSnapshot();
    this.subscribers.forEach(listener => listener(snapshot));
  }

  subscribe(listener: (snapshot: PersistenceHealthSnapshot) => void): () => void {
    this.subscribers.add(listener);
    listener(this.getSnapshot());
    return () => this.subscribers.delete(listener);
  }
}
