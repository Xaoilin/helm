import { v4 as uuidv4 } from 'uuid';
import type {
  ProductUsageDiagnostics,
  ProductUsageEvent,
  ProductUsageIngestReceipt,
  ProductUsageInputKind,
  ProductUsageMetadataValue,
  ProductUsageOutcome,
  Surface,
} from '../types/domain';

const EVENT_SCHEMA_VERSION = 1 as const;
const FLUSH_DELAY_MS = 2_000;
const BATCH_SIZE = 25;
const MAX_QUEUE_SIZE = 200;
const MAX_METADATA_BYTES = 2_048;
const TAXONOMY_KEY = /^[a-z][a-z0-9_]{0,63}$/;
const TARGET_KEY = /^[a-z][a-z0-9_:-]{0,95}$/;
const ERROR_CODE = /^[a-z][a-z0-9_:-]{0,63}$/;
const SAFE_METADATA_KEYS = new Set([
  'previousSurface',
  'navigationSource',
  'viewportBucket',
  'visibilityState',
  'retryCount',
]);
const SURFACES = new Set<Surface>([
  'dashboard', 'chat', 'calendar', 'clock', 'trips', 'projects', 'inventory',
  'secrets', 'tasks', 'employment', 'finance', 'health', 'knowledge', 'profile',
  'integrations', 'activity', 'settings', 'debug',
]);

export interface ProductUsageEventInput {
  kind: ProductUsageEvent['kind'];
  feature: string;
  action: string;
  surface?: Surface;
  outcome?: ProductUsageOutcome;
  durationMs?: number;
  errorCode?: string;
  target?: string;
  inputKind?: ProductUsageInputKind;
  metadata?: Record<string, unknown>;
  occurredAt?: string;
}

export type ProductUsageSink = (
  events: ProductUsageEvent[],
) => Promise<ProductUsageIngestReceipt>;

interface ProductUsageConfiguration {
  enabled: boolean;
  accountId: string | null;
  releaseVersion: string;
  sink: ProductUsageSink;
}

let enabled = false;
let releaseVersion = 'unknown';
let sink: ProductUsageSink | null = null;
let activeAccountId: string | null = null;
let sessionId: string | null = null;
let sequence = 0;
let queue: ProductUsageEvent[] = [];
let flushTimer: ReturnType<typeof setTimeout> | null = null;
let flushPromise: Promise<void> | null = null;
let lifecycleAttached = false;
let accepted = 0;
let duplicates = 0;
let dropped = 0;
let rejected = 0;
let failedBatches = 0;
let lastFlushAt: string | null = null;
let lastFailureCode: string | null = null;

function isBrowser(): boolean {
  return typeof window !== 'undefined' && typeof document !== 'undefined';
}

function deviceClass(): ProductUsageEvent['deviceClass'] {
  if (!isBrowser()) return 'desktop';
  if (window.innerWidth < 640) return 'mobile';
  if (window.innerWidth < 1024) return 'tablet';
  return 'desktop';
}

function reducedMotion(): boolean {
  return isBrowser() && typeof window.matchMedia === 'function'
    ? window.matchMedia('(prefers-reduced-motion: reduce)').matches
    : false;
}

function scalar(value: unknown): value is ProductUsageMetadataValue {
  return value === null
    || typeof value === 'string'
    || typeof value === 'number'
    || typeof value === 'boolean';
}

export function sanitizeProductUsageMetadata(
  metadata: Record<string, unknown> | undefined,
): Record<string, ProductUsageMetadataValue> {
  if (!metadata) return {};
  const sanitized: Record<string, ProductUsageMetadataValue> = {};
  for (const [key, value] of Object.entries(metadata)) {
    if (!SAFE_METADATA_KEYS.has(key) || !scalar(value)) continue;
    if (typeof value === 'string' && value.length > 96) continue;
    if (typeof value === 'number' && !Number.isFinite(value)) continue;
    sanitized[key] = value;
  }
  return new TextEncoder().encode(JSON.stringify(sanitized)).byteLength <= MAX_METADATA_BYTES
    ? sanitized
    : {};
}

function normalizeEvent(input: ProductUsageEventInput): ProductUsageEvent | null {
  if (!sessionId || !TAXONOMY_KEY.test(input.feature) || !TAXONOMY_KEY.test(input.action)) {
    return null;
  }
  if (input.surface && !SURFACES.has(input.surface)) return null;
  if (input.target && !TARGET_KEY.test(input.target)) return null;
  if (input.errorCode && !ERROR_CODE.test(input.errorCode)) return null;
  if (
    input.durationMs !== undefined
    && (!Number.isFinite(input.durationMs) || input.durationMs < 0 || input.durationMs > 1_800_000)
  ) return null;

  sequence += 1;
  return {
    eventId: uuidv4(),
    schemaVersion: EVENT_SCHEMA_VERSION,
    sessionId,
    sequence,
    kind: input.kind,
    occurredAt: input.occurredAt ?? new Date().toISOString(),
    surface: input.surface,
    feature: input.feature,
    action: input.action,
    outcome: input.outcome,
    durationMs: input.durationMs === undefined ? undefined : Math.round(input.durationMs),
    errorCode: input.errorCode,
    target: input.target,
    releaseVersion,
    deviceClass: deviceClass(),
    inputKind: input.inputKind ?? 'system',
    online: typeof navigator === 'undefined' ? true : navigator.onLine,
    reducedMotion: reducedMotion(),
    metadata: sanitizeProductUsageMetadata(input.metadata),
  };
}

function scheduleFlush(): void {
  if (!enabled || flushTimer || !isBrowser()) return;
  flushTimer = setTimeout(() => {
    flushTimer = null;
    void flushProductUsageEvents();
  }, FLUSH_DELAY_MS);
}

export function trackProductUsageEvent(input: ProductUsageEventInput): string | null {
  if (!enabled || !sink) return null;
  const event = normalizeEvent(input);
  if (!event) {
    rejected += 1;
    return null;
  }

  if (queue.length >= MAX_QUEUE_SIZE) {
    queue.shift();
    dropped += 1;
  }
  queue.push(event);
  if (queue.length >= BATCH_SIZE) void flushProductUsageEvents();
  else scheduleFlush();
  return event.eventId;
}

export async function flushProductUsageEvents(): Promise<void> {
  if (flushPromise) return flushPromise;
  if (!sink || queue.length === 0) return;

  const currentSink = sink;
  const batch = queue.splice(0, BATCH_SIZE);
  flushPromise = currentSink(batch)
    .then(receipt => {
      accepted += receipt.accepted;
      duplicates += receipt.duplicates;
      lastFlushAt = new Date().toISOString();
      lastFailureCode = null;
    })
    .catch(() => {
      failedBatches += 1;
      lastFailureCode = 'ingest_failed';
      const available = Math.max(0, MAX_QUEUE_SIZE - queue.length);
      queue = (available === 0 ? [] : batch.slice(-available)).concat(queue);
      dropped += Math.max(0, batch.length - available);
    })
    .finally(() => {
      flushPromise = null;
      if (enabled && queue.length > 0) scheduleFlush();
    });
  return flushPromise;
}

function handleVisibilityChange(): void {
  if (document.visibilityState === 'hidden') void flushProductUsageEvents();
}

function handlePageHide(): void {
  void flushProductUsageEvents();
}

function attachLifecycle(): void {
  if (!isBrowser() || lifecycleAttached) return;
  document.addEventListener('visibilitychange', handleVisibilityChange);
  window.addEventListener('pagehide', handlePageHide);
  lifecycleAttached = true;
}

function detachLifecycle(): void {
  if (!isBrowser() || !lifecycleAttached) return;
  document.removeEventListener('visibilitychange', handleVisibilityChange);
  window.removeEventListener('pagehide', handlePageHide);
  lifecycleAttached = false;
}

export function configureProductUsageAnalytics(configuration: ProductUsageConfiguration): void {
  releaseVersion = configuration.releaseVersion.replace(/^v/u, '');
  sink = configuration.sink;

  if (!configuration.enabled || !configuration.accountId) {
    enabled = false;
    if (flushTimer) clearTimeout(flushTimer);
    flushTimer = null;
    dropped += queue.length;
    queue = [];
    detachLifecycle();
    activeAccountId = null;
    sessionId = null;
    sequence = 0;
    return;
  }

  const accountChanged = activeAccountId !== null
    && activeAccountId !== configuration.accountId;
  if (accountChanged) {
    dropped += queue.length;
    queue = [];
  }
  const startingSession = !enabled || !sessionId || accountChanged;
  enabled = true;
  activeAccountId = configuration.accountId;
  if (startingSession) {
    sessionId = uuidv4();
    sequence = 0;
  }
  attachLifecycle();
  if (startingSession) {
    trackProductUsageEvent({
      kind: 'session',
      feature: 'application',
      action: 'session_started',
      outcome: 'success',
      inputKind: 'system',
      metadata: {
        viewportBucket: deviceClass(),
        visibilityState: isBrowser() ? document.visibilityState : 'visible',
      },
    });
  }
}

export function getProductUsageDiagnostics(): ProductUsageDiagnostics {
  return {
    enabled,
    sessionId,
    queued: queue.length,
    accepted,
    duplicates,
    dropped,
    rejected,
    failedBatches,
    lastFlushAt,
    lastFailureCode,
  };
}

/** Test-only reset kept explicit so production callers cannot clear database history. */
export function resetProductUsageAnalyticsRuntime(): void {
  if (flushTimer) clearTimeout(flushTimer);
  flushTimer = null;
  flushPromise = null;
  detachLifecycle();
  enabled = false;
  releaseVersion = 'unknown';
  sink = null;
  activeAccountId = null;
  sessionId = null;
  sequence = 0;
  queue = [];
  accepted = 0;
  duplicates = 0;
  dropped = 0;
  rejected = 0;
  failedBatches = 0;
  lastFlushAt = null;
  lastFailureCode = null;
}
