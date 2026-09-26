/** Private per-account Broadcast subscription and its observable connection state. */
import type { SupabaseClient } from '@supabase/supabase-js';
import { recordOperationalEvent } from '../../services/operationalTelemetry';
import type { HelmRealtimeEvent, HelmSecretRealtimeEvent } from '../databaseTypes';
import { getClient, getCurrentUserId } from './client';
import { asRecord } from './json';

export type SupabaseRealtimeState =
  | 'unavailable'
  | 'subscribing'
  | 'subscribed'
  | 'closed'
  | 'error'
  | 'timed_out';

export interface SupabaseRealtimeSnapshot {
  state: SupabaseRealtimeState;
  lastEventAt: string | null;
  lastStatusAt: string | null;
  lastError: string | null;
}

let realtimeSnapshot: SupabaseRealtimeSnapshot = {
  state: 'unavailable',
  lastEventAt: null,
  lastStatusAt: null,
  lastError: null,
};
const realtimeSubscribers = new Set<(snapshot: SupabaseRealtimeSnapshot) => void>();

function publishRealtimeSnapshot(patch: Partial<SupabaseRealtimeSnapshot>): void {
  realtimeSnapshot = {
    ...realtimeSnapshot,
    ...patch,
    lastStatusAt: patch.state ? new Date().toISOString() : realtimeSnapshot.lastStatusAt,
  };
  if (patch.state) {
    const failed = patch.state === 'error' || patch.state === 'timed_out' || patch.state === 'closed' || patch.state === 'unavailable';
    recordOperationalEvent({
      domain: 'realtime',
      operation: 'subscription',
      outcome: patch.state === 'subscribing' ? 'pending' : failed ? 'failed' : 'ok',
      reason: patch.state === 'subscribing'
        ? 'subscribing'
        : patch.state === 'subscribed'
          ? 'subscribed'
          : patch.state === 'closed'
            ? 'closed'
            : patch.state === 'timed_out'
              ? 'timeout'
              : patch.state === 'error' ? 'channel_error' : 'unknown',
    });
  }
  const snapshot = { ...realtimeSnapshot };
  realtimeSubscribers.forEach(listener => listener(snapshot));
}

function normalizeRealtimeStatus(status: string): SupabaseRealtimeState {
  switch (status) {
    case 'SUBSCRIBED': return 'subscribed';
    case 'CHANNEL_ERROR': return 'error';
    case 'TIMED_OUT': return 'timed_out';
    case 'CLOSED': return 'closed';
    default: return 'subscribing';
  }
}

function parseRealtimeEvent(value: unknown): HelmRealtimeEvent | null {
  const envelope = asRecord(value);
  const payload = asRecord(envelope.payload);
  if (typeof payload.requestId !== 'string' || typeof payload.accountVersion !== 'number') return null;
  const changes = Array.isArray(payload.changes)
    ? payload.changes.map(change => {
        const row = asRecord(change);
        return {
          collection: String(row.collection || ''),
          recordId: String(row.recordId || ''),
          revision: Number(row.revision || 0),
          deletedAt: typeof row.deletedAt === 'string' ? row.deletedAt : null,
        };
      }).filter(change => change.collection && change.recordId)
    : [];
  return {
    requestId: payload.requestId,
    accountVersion: payload.accountVersion,
    changes,
  };
}

function parseSecretRealtimeEvent(value: unknown): HelmSecretRealtimeEvent | null {
  const envelope = asRecord(value);
  const payload = asRecord(envelope.payload);
  if (
    typeof payload.requestId !== 'string'
    || typeof payload.accountVersion !== 'number'
    || typeof payload.secretId !== 'string'
    || typeof payload.revision !== 'number'
  ) return null;
  return {
    requestId: payload.requestId,
    accountVersion: payload.accountVersion,
    secretId: payload.secretId,
    revision: payload.revision,
    archivedAt: typeof payload.archivedAt === 'string' ? payload.archivedAt : null,
  };
}

export function getSupabaseRealtimeSnapshot(): SupabaseRealtimeSnapshot {
  return { ...realtimeSnapshot };
}

export function subscribeSupabaseRealtimeSnapshot(
  listener: (snapshot: SupabaseRealtimeSnapshot) => void,
): () => void {
  realtimeSubscribers.add(listener);
  listener({ ...realtimeSnapshot });
  return () => realtimeSubscribers.delete(listener);
}

export function subscribeHelmBroadcast(
  listener: (event: HelmRealtimeEvent) => void,
  secretListener?: (event: HelmSecretRealtimeEvent) => void,
): () => void {
  const client = getClient();
  const currentUserId = getCurrentUserId();
  if (!client || !currentUserId) {
    publishRealtimeSnapshot({
      state: 'unavailable',
      lastError: !client ? 'Supabase is not configured.' : 'No authenticated Sabah One account.',
    });
    return () => {};
  }

  const activeClient = client;
  const topic = `helm:account:${currentUserId}`;
  let cancelled = false;
  let channel: ReturnType<SupabaseClient['channel']> | null = null;
  publishRealtimeSnapshot({ state: 'subscribing', lastError: null });

  void activeClient.realtime.setAuth().then(() => {
    if (cancelled) return;
    channel = activeClient
      .channel(topic, { config: { private: true } })
      .on('broadcast', { event: 'helm_records_changed' }, payload => {
        const event = parseRealtimeEvent(payload);
        if (!event) return;
        publishRealtimeSnapshot({
          state: 'subscribed',
          lastEventAt: new Date().toISOString(),
          lastError: null,
        });
        listener(event);
      })
      .on('broadcast', { event: 'helm_secrets_changed' }, payload => {
        const event = parseSecretRealtimeEvent(payload);
        if (!event) return;
        publishRealtimeSnapshot({
          state: 'subscribed',
          lastEventAt: new Date().toISOString(),
          lastError: null,
        });
        secretListener?.(event);
      })
      .subscribe((status, error) => {
        if (cancelled) return;
        const state = normalizeRealtimeStatus(status);
        publishRealtimeSnapshot({
          state,
          lastError: error?.message || (state === 'error' || state === 'timed_out' ? `Realtime channel ${status}.` : null),
        });
      });
  }).catch(error => {
    if (cancelled) return;
    publishRealtimeSnapshot({
      state: 'error',
      lastError: error instanceof Error ? error.message : String(error),
    });
  });

  return () => {
    cancelled = true;
    if (channel) void activeClient.removeChannel(channel);
  };
}
