import { APP_VERSION } from '../config/release';
import type { OperationalDomain, OperationalEvent, OperationalOperation, OperationalReason } from '../types/domain';
import { OPERATIONAL_MAX_AGE_MS, OPERATIONAL_MAX_BATCH, parseOperationalEvent } from '../../supabase/functions/_shared/operationalEvents';

export type OperationalInput = Pick<OperationalEvent, 'domain' | 'operation' | 'outcome'> & Partial<Pick<OperationalEvent, 'reason' | 'durationMs' | 'attempt' | 'freshness' | 'correlationId'>>;
type Sender = (events: OperationalEvent[], signal: AbortSignal) => Promise<void>;
export interface OperationalSnapshot {
  events: OperationalEvent[];
  pending: number;
  dropped: number;
  sink: 'idle' | 'sending' | 'unavailable' | 'local_only';
  sinkReason: OperationalReason | null;
  counters: { disconnects: number; failedReads: number; failedWrites: number; recoveries: number; lastRecoveryMs: number | null };
}

const RING_LIMIT = 200;
const QUEUE_LIMIT = 50;
const RATE_LIMIT = 60;
const FLUSH_DELAY = 10_000;
const SINK_TIMEOUT = 3_000;
let events: OperationalEvent[] = [];
let queue: Array<{ event: OperationalEvent; attempts: number }> = [];
let account: string | null = null; // Memory-only guard; never serialized or sent.
let sender: Sender | null = null;
let generation = 0;
let timer: ReturnType<typeof setTimeout> | null = null;
let inFlight: AbortController | null = null;
let reloadFlight: AbortController | null = null;
let dropped = 0;
let sink: OperationalSnapshot['sink'] = 'local_only';
let sinkReason: OperationalReason | null = null;
let rateWindow = 0;
let rateCount = 0;
let counters: OperationalSnapshot['counters'] = { disconnects: 0, failedReads: 0, failedWrites: 0, recoveries: 0, lastRecoveryMs: null };
const incidents = new Map<string, { id: string; started: number; attempts: number }>();
const listeners = new Set<(snapshot: OperationalSnapshot) => void>();
const bounded = (n: number, max = 86_400_000) => Math.min(max, Math.max(0, Math.round(Number.isFinite(n) ? n : 0)));
const increment = (n: number) => Math.min(n + 1, 1_000_000);

export function getOperationalSnapshot(): OperationalSnapshot {
  const cutoff = Date.now() - OPERATIONAL_MAX_AGE_MS;
  return { events: events.filter(event => Date.parse(event.occurredAt) >= cutoff).map(event => ({ ...event })), pending: queue.length, dropped, sink, sinkReason, counters: { ...counters } };
}
function publish(): void {
  for (const listener of listeners) {
    // Diagnostics observers must never interrupt business operations.
    try { listener(getOperationalSnapshot()); } catch { /* isolated diagnostic observer */ }
  }
}
export function subscribeOperationalEvents(listener: (snapshot: OperationalSnapshot) => void): () => void {
  listeners.add(listener);
  listener(getOperationalSnapshot());
  return () => { listeners.delete(listener); };
}
export function exportOperationalDiagnostics(): string {
  return JSON.stringify({ schemaVersion: 1, exportedAt: new Date().toISOString(), ...getOperationalSnapshot() }, null, 2);
}

export function setOperationalAccount(next: string | null): void {
  if (account === next) return;
  account = next;
  generation += 1;
  inFlight?.abort();
  inFlight = null;
  reloadFlight?.abort();
  reloadFlight = null;
  if (timer !== null) clearTimeout(timer);
  timer = null;
  events = [];
  queue = [];
  incidents.clear();
  dropped = 0;
  rateCount = 0;
  rateWindow = Date.now();
  counters = { disconnects: 0, failedReads: 0, failedWrites: 0, recoveries: 0, lastRecoveryMs: null };
  sink = next && sender ? 'idle' : 'local_only';
  sinkReason = null;
  publish();
}

export function configureOperationalTransport(next: Sender | null): void {
  sender = next;
  sink = account && sender ? 'idle' : 'local_only';
  schedule();
}
function schedule(delay = FLUSH_DELAY): void {
  if (timer !== null || inFlight || !account || !sender || queue.length === 0) return;
  timer = setTimeout(() => { timer = null; void flushOperationalEvents(); }, delay);
}

/** One best-effort keepalive batch at navigation; never await this to reload. */
export function flushOperationalEventsForReload(): void {
  if (!account || !sender || reloadFlight || queue.length === 0) return;
  const epoch = generation;
  const batch = queue.splice(-OPERATIONAL_MAX_BATCH);
  const controller = new AbortController();
  reloadFlight = controller;
  const timeout = setTimeout(() => {
    controller.abort();
    if (reloadFlight === controller) reloadFlight = null;
  }, SINK_TIMEOUT);
  try {
    // Invoke synchronously so the keepalive request starts before navigation.
    void sender(batch.map(item => item.event), controller.signal).catch(() => {
      if (epoch === generation) dropped = Math.min(1_000_000, dropped + batch.length);
    }).finally(() => {
      clearTimeout(timeout);
      if (reloadFlight === controller) reloadFlight = null;
    });
  } catch {
    clearTimeout(timeout);
    if (reloadFlight === controller) reloadFlight = null;
    if (epoch === generation) dropped = Math.min(1_000_000, dropped + batch.length);
  }
}

/** Fire-and-forget bounded queue, including a deadline if a transport ignores AbortSignal. */
export async function flushOperationalEvents(): Promise<void> {
  if (inFlight || !account || !sender || queue.length === 0) return;
  if (timer !== null) clearTimeout(timer);
  timer = null;
  const epoch = generation;
  const transport = sender;
  const cutoff = Date.now() - OPERATIONAL_MAX_AGE_MS;
  const fresh = queue.filter(item => Date.parse(item.event.occurredAt) >= cutoff);
  dropped = Math.min(1_000_000, dropped + queue.length - fresh.length);
  queue = fresh;
  if (queue.length === 0) { publish(); return; }
  const batch = queue.splice(0, OPERATIONAL_MAX_BATCH);
  const controller = new AbortController();
  inFlight = controller;
  sink = 'sending';
  publish();
  let timeout: ReturnType<typeof setTimeout> | undefined;
  try {
    await Promise.race([
      Promise.resolve().then(() => {
        if (epoch !== generation || controller.signal.aborted) throw new Error('Telemetry session changed');
        return transport(batch.map(item => item.event), controller.signal);
      }),
      new Promise<never>((_, reject) => { timeout = setTimeout(() => { controller.abort(); reject(new DOMException('Telemetry deadline', 'TimeoutError')); }, SINK_TIMEOUT); }),
    ]);
    if (epoch !== generation) return;
    sink = 'idle';
    sinkReason = null;
  } catch (error) {
    if (epoch !== generation) return;
    sink = 'unavailable';
    sinkReason = classifyOperationalFailure(error);
    const retryable = ['network', 'timeout', 'server_error', 'rate_limited'].includes(sinkReason);
    const retry = batch.filter(item => retryable && ++item.attempts < 3);
    dropped = Math.min(1_000_000, dropped + batch.length - retry.length);
    queue = [...retry, ...queue];
    if (queue.length > QUEUE_LIMIT) { dropped = Math.min(1_000_000, dropped + queue.length - QUEUE_LIMIT); queue = queue.slice(-QUEUE_LIMIT); }
  } finally {
    if (timeout !== undefined) clearTimeout(timeout);
    if (epoch === generation) {
      inFlight = null;
      publish();
      schedule(sink === 'unavailable' ? 30_000 : FLUSH_DELAY);
    }
  }
}

export function recordOperationalEvent(input: OperationalInput): void {
  try {
    const now = Date.now();
    if (now - rateWindow >= 60_000 || now < rateWindow) { rateWindow = now; rateCount = 0; }
    if (++rateCount > RATE_LIMIT) { dropped = increment(dropped); return; }
    const key = `${input.domain}:${input.operation}`;
    // An explicit request correlation is one invocation, not evidence that a
    // separate concurrent invocation recovered. Only state streams auto-recover.
    const tracksState = input.correlationId === undefined;
    const prior = tracksState ? incidents.get(key) : undefined;
    const failed = input.outcome === 'failed';
    const recovered = input.outcome === 'ok' && Boolean(prior);
    const id = crypto.randomUUID();
    const event = parseOperationalEvent({
      id,
      correlationId: prior?.id ?? input.correlationId ?? id,
      occurredAt: new Date(now).toISOString(),
      release: APP_VERSION,
      domain: input.domain,
      operation: input.operation,
      outcome: recovered ? 'recovered' : input.outcome,
      reason: input.reason ?? (failed ? 'unknown' : 'ok'),
      attempt: bounded(input.attempt ?? (prior ? prior.attempts + 1 : 1), 100),
      durationMs: bounded(input.durationMs ?? 0),
      recoveryMs: recovered && prior ? bounded(now - prior.started) : null,
      freshness: input.freshness ?? 'unknown',
    }, now);
    if (!event) { dropped = increment(dropped); return; }
    if (failed) {
      if (tracksState) incidents.set(key, { id: event.correlationId, started: prior?.started ?? now, attempts: Math.min((prior?.attempts ?? 0) + 1, 100) });
      if (!prior && input.domain === 'realtime' && input.operation === 'subscription') counters.disconnects = increment(counters.disconnects);
      if (input.operation === 'read' || input.operation === 'version') counters.failedReads = increment(counters.failedReads);
      if (input.operation === 'write') counters.failedWrites = increment(counters.failedWrites);
    } else if (recovered) {
      incidents.delete(key);
      counters.recoveries = increment(counters.recoveries);
      counters.lastRecoveryMs = event.recoveryMs;
    }
    events = [...events.filter(item => Date.parse(item.occurredAt) >= now - OPERATIONAL_MAX_AGE_MS), event].slice(-RING_LIMIT);
    if (account && sender) {
      if (queue.length === QUEUE_LIMIT) { queue.shift(); dropped = increment(dropped); }
      queue.push({ event, attempts: 0 });
      schedule();
    }
    publish();
  } catch { /* Telemetry construction can never break product operation. */ }
}

export function classifyOperationalFailure(error: unknown): OperationalReason {
  const row = error && typeof error === 'object' ? error as { status?: unknown; httpStatus?: unknown; code?: unknown; name?: unknown; message?: unknown; context?: { status?: unknown } } : {};
  const status = Number(row.status ?? row.httpStatus ?? row.context?.status);
  if (status === 401 || ['PGRST301', 'PGRST302', 'PGRST303'].includes(String(row.code))) return 'unauthorized';
  if (status === 403 || row.code === '42501') return 'forbidden';
  if (status === 429) return 'rate_limited';
  if (status === 400 || row.code === 'invalid_response') return 'invalid_response';
  if (status >= 500 && status <= 599) return 'server_error';
  if (row.name === 'TimeoutError' || row.name === 'AbortError') return 'timeout';
  if (row.name === 'HostedAssistantSignInRequiredError') return 'unauthorized';
  if (row.name === 'HostedAssistantPausedError' || row.code === 'hosted_ai_paused') return 'paused';
  if (row.name === 'CircuitOpenError') return 'circuit_open';
  // Inspect text only for categories; never retain or export it.
  const message = typeof row.message === 'string' ? row.message.toLowerCase() : '';
  if (/timeout|timed out/u.test(message)) return 'timeout';
  if (/network|failed to fetch|fetch failed/u.test(message)) return 'network';
  if (/invalid|no data/u.test(message)) return 'invalid_response';
  return 'unknown';
}

export async function observeOperationalOperation<T>(domain: OperationalDomain, operation: OperationalOperation, work: () => Promise<T>, options: { attempt?: number; freshness?: OperationalEvent['freshness'] } = {}): Promise<T> {
  const started = performance.now();
  const epoch = generation;
  let correlationId: string;
  try { correlationId = crypto.randomUUID(); } catch { return work(); }
  try {
    const value = await work();
    if (epoch === generation) recordOperationalEvent({ domain, operation, outcome: 'ok', correlationId, durationMs: performance.now() - started, ...options });
    return value;
  } catch (error) {
    let reason: OperationalReason = 'unknown';
    try { reason = classifyOperationalFailure(error); } catch { /* Preserve the original product error. */ }
    if (epoch === generation) recordOperationalEvent({ domain, operation, outcome: 'failed', correlationId, reason, durationMs: performance.now() - started, ...options, freshness: options.freshness === 'stale' ? 'stale' : 'unknown' });
    throw error;
  }
}
