import type { HelmMutation } from '../databaseTypes';
import { applyHelmInventoryMutations, applyHelmMutations } from '../supabase';
import type { SupabaseWriteQueueSnapshot } from './types';

function shouldRetryMutation(error: unknown): boolean {
  if (typeof navigator !== 'undefined' && navigator.onLine === false) return false;
  const candidate = error as { status?: unknown; message?: unknown };
  const status = typeof candidate?.status === 'number' ? candidate.status : null;
  if (status === 408 || status === 429 || (status !== null && status >= 500)) return true;
  const message = String(candidate?.message || error || '').toLowerCase();
  return /fetch|network|socket|timeout|timed out|connection|econnreset/.test(message);
}

export async function applySharedMutationsWithIdempotentRetry(
  requestId: string,
  operations: HelmMutation[],
) {
  try {
    return await applyHelmMutations(requestId, operations);
  } catch (firstError) {
    if (!shouldRetryMutation(firstError)) throw firstError;
    return applyHelmMutations(requestId, operations);
  }
}

export async function applyInventoryMutationsWithIdempotentRetry(
  requestId: string,
  operations: HelmMutation[],
) {
  try {
    return await applyHelmInventoryMutations(requestId, operations);
  } catch (firstError) {
    if (!shouldRetryMutation(firstError)) throw firstError;
    return applyHelmInventoryMutations(requestId, operations);
  }
}

interface WriteSession {
  epoch: number;
  userId: string | null;
  isCurrent: (epoch: number, userId: string) => boolean;
}

interface PersistenceWriteQueueOwner {
  getSession: () => WriteSession;
  commit: (values: Map<string, unknown>, epoch: number, userId: string) => Promise<string[]>;
  isStaleError: (error: unknown) => boolean;
  onSuccess: (changedCollections: string[], requestedKeys: string[], completedAt: string) => void;
  onFailure: (error: unknown, requestedKeys: string[], userId: string) => Promise<void>;
  onSnapshot: (snapshot: SupabaseWriteQueueSnapshot) => void;
}

function initialSnapshot(): SupabaseWriteQueueSnapshot {
  return {
    queuedCount: 0,
    queuedKeys: [],
    lastQueuedAt: null,
    lastFlushStartedAt: null,
    lastFlushSuccessAt: null,
    lastFlushFailureAt: null,
    lastFlushError: null,
    lastFlushKeys: [],
    lastFailureKeys: [],
  };
}

function copySnapshot(snapshot: SupabaseWriteQueueSnapshot): SupabaseWriteQueueSnapshot {
  return {
    ...snapshot,
    queuedKeys: [...snapshot.queuedKeys],
    lastFlushKeys: [...snapshot.lastFlushKeys],
    lastFailureKeys: [...snapshot.lastFailureKeys],
  };
}

/**
 * Owns coalescing, one-at-a-time flushing, retry-visible queue diagnostics,
 * and serialization of reserved record-field commits.
 */
export class PersistenceWriteQueue {
  private readonly owner: PersistenceWriteQueueOwner;
  private readonly pendingValues = new Map<string, unknown>();
  private flushPromise: Promise<void> | null = null;
  private flushEpoch: number | null = null;
  private flushScheduled = false;
  private committedQueue: Promise<void> = Promise.resolve();
  private generation = 0;
  private snapshot = initialSnapshot();

  constructor(owner: PersistenceWriteQueueOwner) {
    this.owner = owner;
  }

  reset(): void {
    this.generation += 1;
    this.pendingValues.clear();
    this.flushPromise = null;
    this.flushEpoch = null;
    this.flushScheduled = false;
    this.committedQueue = Promise.resolve();
    this.snapshot = initialSnapshot();
    this.publish();
  }

  enqueue(key: string, value: unknown): void {
    this.pendingValues.set(key, value);
    this.publish({ lastQueuedAt: new Date().toISOString() });
  }

  scheduleFlush(): void {
    if (this.flushScheduled) return;
    this.flushScheduled = true;
    const generation = this.generation;
    queueMicrotask(() => {
      this.flushScheduled = false;
      if (generation === this.generation) void this.flush();
    });
  }

  async flush(): Promise<void> {
    const session = this.owner.getSession();
    if (!session.userId) return;
    if (this.flushPromise && this.flushEpoch === session.epoch) return this.flushPromise;
    const generation = this.generation;
    const operation = (async () => {
      while (
        this.pendingValues.size > 0
        && generation === this.generation
        && session.isCurrent(session.epoch, session.userId as string)
      ) {
        const batch = new Map(this.pendingValues);
        this.pendingValues.clear();
        const keys = [...batch.keys()].sort();
        this.publish({
          lastFlushStartedAt: new Date().toISOString(),
          lastFlushKeys: keys,
          lastFlushError: null,
        });
        try {
          const changedCollections = await this.owner.commit(
            batch,
            session.epoch,
            session.userId as string,
          );
          const completedAt = new Date().toISOString();
          this.publish({
            lastFlushSuccessAt: completedAt,
            lastFlushError: null,
            lastFailureKeys: [],
          });
          this.owner.onSuccess(changedCollections, keys, completedAt);
        } catch (error) {
          if (this.owner.isStaleError(error) || generation !== this.generation) break;
          const message = error instanceof Error ? error.message : String(error);
          this.publish({
            lastFlushFailureAt: new Date().toISOString(),
            lastFlushError: message,
            lastFailureKeys: keys,
          });
          await this.owner.onFailure(error, keys, session.userId as string);
          break;
        }
      }
    })().finally(() => {
      if (this.flushPromise === operation) {
        this.flushPromise = null;
        this.flushEpoch = null;
        this.publish();
      }
    });
    this.flushPromise = operation;
    this.flushEpoch = session.epoch;
    this.publish();
    return operation;
  }

  serializeCommitted<T>(operation: () => Promise<T>, staleError: () => Error): Promise<T> {
    const generation = this.generation;
    const queued = this.committedQueue.then(async () => {
      if (generation !== this.generation) throw staleError();
      return operation();
    });
    this.committedQueue = queued.then(() => undefined, () => undefined);
    return queued;
  }

  getSnapshot(): SupabaseWriteQueueSnapshot {
    return copySnapshot(this.snapshot);
  }

  beginDirectCommit(keys: string[]): void {
    this.publish({
      lastFlushStartedAt: new Date().toISOString(),
      lastFlushKeys: [...keys],
      lastFlushError: null,
    });
  }

  completeDirectCommit(completedAt: string): void {
    this.publish({
      lastFlushSuccessAt: completedAt,
      lastFlushError: null,
      lastFailureKeys: [],
    });
  }

  failDirectCommit(keys: string[], error: unknown): void {
    this.publish({
      lastFlushFailureAt: new Date().toISOString(),
      lastFlushError: error instanceof Error ? error.message : String(error),
      lastFailureKeys: [...keys],
    });
  }

  private publish(patch: Partial<SupabaseWriteQueueSnapshot> = {}): void {
    this.snapshot = {
      ...this.snapshot,
      ...patch,
      queuedCount: this.pendingValues.size + (this.flushPromise ? 1 : 0),
      queuedKeys: [...this.pendingValues.keys()].sort(),
    };
    this.owner.onSnapshot(this.getSnapshot());
  }
}
