import type { OperationalEvent } from '../../../src/types/domain.ts';

export const OPERATIONAL_MAX_BATCH = 10;
export const OPERATIONAL_MAX_BYTES = 12_000;
export const OPERATIONAL_MAX_AGE_MS = 60 * 60 * 1_000;
const domains = new Set(['auth', 'database', 'realtime', 'browser', 'release', 'calendar', 'github', 'assistant', 'employment', 'finance', 'equity']);
const operations = new Set(['session', 'refresh', 'read', 'write', 'version', 'subscription', 'heartbeat', 'connectivity', 'visibility', 'manifest', 'reload', 'request', 'recovery']);
const reasons = new Set(['ok', 'network', 'timeout', 'unauthorized', 'forbidden', 'rate_limited', 'server_error', 'invalid_response', 'offline', 'online', 'hidden', 'visible', 'signed_in', 'signed_out', 'token_refreshed', 'initial_session', 'subscribing', 'subscribed', 'closed', 'channel_error', 'heartbeat_sent', 'heartbeat_ok', 'heartbeat_timeout', 'heartbeat_error', 'release_available', 'reload_suppressed', 'client_update_required', 'circuit_open', 'paused', 'unknown']);
const outcomes = new Set(['ok', 'failed', 'pending', 'changed', 'recovered']);
const fields = ['id', 'correlationId', 'occurredAt', 'release', 'domain', 'operation', 'outcome', 'reason', 'attempt', 'durationMs', 'recoveryMs', 'freshness'];
const uuid = /^[0-9a-f]{8}-[0-9a-f]{4}-4[0-9a-f]{3}-[89ab][0-9a-f]{3}-[0-9a-f]{12}$/u;
const integer = (value: unknown, max: number) => Number.isSafeInteger(value) && Number(value) >= 0 && Number(value) <= max;

/** Reconstruct an allowlisted envelope. Reject unknown keys instead of redacting arbitrary text. */
export function parseOperationalEvent(value: unknown, now = Date.now()): OperationalEvent | null {
  if (!value || typeof value !== 'object' || Array.isArray(value)) return null;
  const row = value as Record<string, unknown>;
  if (Object.keys(row).length !== fields.length || Object.keys(row).some(key => !fields.includes(key))) return null;
  if (typeof row.id !== 'string' || !uuid.test(row.id) || typeof row.correlationId !== 'string' || !uuid.test(row.correlationId)) return null;
  if (typeof row.occurredAt !== 'string' || !/^\d{4}-\d{2}-\d{2}T\d{2}:\d{2}:\d{2}\.\d{3}Z$/u.test(row.occurredAt)) return null;
  const timestamp = Date.parse(row.occurredAt);
  if (!Number.isFinite(timestamp) || timestamp > now + 60_000 || timestamp < now - OPERATIONAL_MAX_AGE_MS) return null;
  if (typeof row.release !== 'string' || !/^\d{1,4}\.\d{1,4}\.\d{1,4}$/u.test(row.release)) return null;
  if (typeof row.domain !== 'string' || !domains.has(row.domain) || typeof row.operation !== 'string' || !operations.has(row.operation) || typeof row.reason !== 'string' || !reasons.has(row.reason) || typeof row.outcome !== 'string' || !outcomes.has(row.outcome)) return null;
  if (typeof row.freshness !== 'string' || !['fresh', 'stale', 'unknown'].includes(row.freshness)) return null;
  if (!integer(row.attempt, 100) || !integer(row.durationMs, 86_400_000) || !(row.recoveryMs === null || integer(row.recoveryMs, 86_400_000))) return null;
  // Explicit construction also prevents future unreviewed properties entering logs.
  return Object.fromEntries(fields.map(key => [key, row[key]])) as unknown as OperationalEvent;
}

export function parseOperationalBatch(value: unknown, now = Date.now()): OperationalEvent[] | null {
  if (!value || typeof value !== 'object' || Array.isArray(value)) return null;
  const row = value as Record<string, unknown>;
  if (Object.keys(row).length !== 1 || !Array.isArray(row.events) || row.events.length < 1 || row.events.length > OPERATIONAL_MAX_BATCH) return null;
  const events = row.events.map(event => parseOperationalEvent(event, now));
  return events.every((event): event is OperationalEvent => event !== null) ? events : null;
}
