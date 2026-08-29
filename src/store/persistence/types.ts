import type { SyncSessionStatus } from '../databaseTypes';
import type { SupabaseRealtimeSnapshot } from '../supabase';

export interface RemoteStoreChange {
  event: 'REMOTE_REFRESH' | 'RECONNECT';
  namespace: string;
  key: string;
  updatedAt: string | null;
  value: unknown;
}

export interface SupabaseWriteQueueSnapshot {
  queuedCount: number;
  queuedKeys: string[];
  lastQueuedAt: string | null;
  lastFlushStartedAt: string | null;
  lastFlushSuccessAt: string | null;
  lastFlushFailureAt: string | null;
  lastFlushError: string | null;
  lastFlushKeys: string[];
  lastFailureKeys: string[];
}

export type SyncSessionReason =
  | 'signed_out'
  | 'configuration'
  | 'switching_account'
  | 'offline'
  | 'database_unavailable'
  | 'realtime_unavailable'
  | 'incompatible_schema'
  | 'client_update_required'
  | null;

export interface SyncSessionSnapshot {
  status: SyncSessionStatus;
  userId: string | null;
  accountVersion: number;
  hasUsableSnapshot: boolean;
  readOnly: boolean;
  reason: SyncSessionReason;
  lastReadyAt: string | null;
  lastProbeAt: string | null;
  error: string | null;
}

export interface PersistenceHealthSnapshot {
  mode: 'database' | 'read-only' | 'blocked';
  syncSession: SyncSessionSnapshot;
  lastLocalWriteAt: string | null;
  lastLocalWriteKey: string | null;
  lastLocalWriteError: string | null;
  lastRemoteReadAt: string | null;
  lastRemoteReadKey: string | null;
  lastRemoteReadError: string | null;
  lastRemoteWriteAt: string | null;
  lastRemoteWriteKey: string | null;
  lastRemoteWriteError: string | null;
  remoteReadFailedKeys: string[];
  lastSuppressedInitialWriteKey: string | null;
  lastSuppressedInitialWriteAt: string | null;
  dirtyKeys: string[];
  supabaseQueue: SupabaseWriteQueueSnapshot;
  supabaseRealtime: SupabaseRealtimeSnapshot;
  localImportCandidateCount: number;
  lastCalendarCacheCleanupAt: string | null;
  lastCalendarCacheCleanupReason: string | null;
  lastCalendarSyncRequestAt: string | null;
  lastCalendarSyncRequestReason: string | null;
}

export interface LocalImportCandidate {
  key: string;
  label: string;
  description: string;
  localStorage: boolean;
  remoteExists: boolean | null;
  sizeBytes: number;
}

export interface DatabaseRefreshRequest {
  collections?: string[];
  snapshot?: boolean;
  realtime?: boolean;
  targetVersion?: number;
}
