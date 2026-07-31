export const HELM_DATABASE_SCHEMA_VERSION = 1;

export type SyncSessionStatus = 'bootstrapping' | 'ready' | 'reconnecting' | 'blocked';

export interface HelmRecord {
  userId: string;
  collection: string;
  recordId: string;
  payload: Record<string, unknown>;
  position: number | null;
  revision: number;
  accountVersion: number;
  createdAt: string;
  updatedAt: string;
  deletedAt: string | null;
}

export interface HelmAccountState {
  userId: string;
  schemaVersion: number;
  accountVersion: number;
  minimumClientVersion: string;
  migratedAt: string | null;
  updatedAt: string;
}

export type HelmMutation =
  | {
      op: 'create';
      collection: string;
      recordId: string;
      payload: Record<string, unknown>;
      position?: number | null;
    }
  | {
      op: 'patch';
      collection: string;
      recordId: string;
      set: Record<string, unknown>;
      unset?: string[];
    }
  | {
      op: 'increment';
      collection: string;
      recordId: string;
      field: string;
      amount: number;
    }
  | {
      op: 'delete';
      collection: string;
      recordId: string;
    }
  | {
      op: 'restore';
      collection: string;
      recordId: string;
    }
  | {
      op: 'reorder';
      collection: string;
      orderedRecordIds: string[];
    };

export interface HelmMutationResult {
  requestId: string;
  accountVersion: number;
  changes: HelmRecord[];
}

export interface HelmRealtimeChange {
  collection: string;
  recordId: string;
  revision: number;
  deletedAt: string | null;
}

export interface HelmRealtimeEvent {
  requestId: string;
  accountVersion: number;
  changes: HelmRealtimeChange[];
}
