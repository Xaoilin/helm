/** Content-free product usage ingest and the account's usage read model. */
import type {
  ProductUsageEvent,
  ProductUsageEventKind,
  ProductUsageIngestReceipt,
  ProductUsageMetadataValue,
  ProductUsageOutcome,
} from '../../types/domain';
import { requireClient } from './client';
import { asRecord } from './json';

export async function ingestProductUsageEvents(
  events: ProductUsageEvent[],
): Promise<ProductUsageIngestReceipt> {
  if (events.length < 1 || events.length > 25) {
    throw new Error('Product usage batches must contain between 1 and 25 events.');
  }
  const database = requireClient();
  const { data, error } = await database.rpc('ingest_product_usage_events', {
    p_events: events,
  });
  if (error) throw error;
  const receipt = asRecord(data);
  const accepted = Number(receipt.accepted);
  const duplicates = Number(receipt.duplicates);
  if (
    !Number.isInteger(accepted)
    || !Number.isInteger(duplicates)
    || accepted < 0
    || duplicates < 0
    || accepted + duplicates !== events.length
  ) {
    throw new Error('The Sabah One product analytics receipt was invalid.');
  }
  return { accepted, duplicates };
}

interface ProductUsageEventRow {
  event_id: string;
  schema_version: number;
  session_id: string;
  sequence: number;
  event_kind: string;
  occurred_at: string;
  surface: string | null;
  feature: string;
  action: string;
  outcome: string | null;
  duration_ms: number | null;
  error_code: string | null;
  target: string | null;
  release_version: string;
  device_class: string;
  input_kind: string;
  online: boolean;
  reduced_motion: boolean;
  metadata: unknown;
}

const PRODUCT_USAGE_KINDS = new Set<ProductUsageEventKind>([
  'session', 'navigation', 'action', 'outcome', 'error', 'performance',
]);
const PRODUCT_USAGE_OUTCOMES = new Set<ProductUsageOutcome>([
  'success', 'failure', 'cancelled', 'unavailable',
]);
const PRODUCT_USAGE_SURFACES = new Set([
  'dashboard', 'chat', 'calendar', 'clock', 'trips', 'projects', 'inventory',
  'secrets', 'tasks', 'employment', 'finance', 'health', 'knowledge', 'profile',
  'integrations', 'activity', 'settings', 'debug',
]);
const PRODUCT_USAGE_DEVICE_CLASSES = new Set(['mobile', 'tablet', 'desktop']);
const PRODUCT_USAGE_INPUT_KINDS = new Set(['pointer', 'keyboard', 'voice', 'assistant', 'system']);

function mapProductUsageEvent(row: ProductUsageEventRow): ProductUsageEvent {
  if (
    row.schema_version !== 1
    || !PRODUCT_USAGE_KINDS.has(row.event_kind as ProductUsageEventKind)
    || (row.surface !== null && !PRODUCT_USAGE_SURFACES.has(row.surface))
    || (row.outcome !== null && !PRODUCT_USAGE_OUTCOMES.has(row.outcome as ProductUsageOutcome))
    || !PRODUCT_USAGE_DEVICE_CLASSES.has(row.device_class)
    || !PRODUCT_USAGE_INPUT_KINDS.has(row.input_kind)
  ) {
    throw new Error('The Sabah One product analytics read model contained invalid event data.');
  }

  const rawMetadata = asRecord(row.metadata);
  const metadata: Record<string, ProductUsageMetadataValue> = {};
  for (const [key, value] of Object.entries(rawMetadata)) {
    if (value === null || typeof value === 'string' || typeof value === 'number' || typeof value === 'boolean') {
      metadata[key] = value;
    }
  }
  return {
    eventId: row.event_id,
    schemaVersion: 1,
    sessionId: row.session_id,
    sequence: row.sequence,
    kind: row.event_kind as ProductUsageEventKind,
    occurredAt: row.occurred_at,
    surface: row.surface === null ? undefined : row.surface as ProductUsageEvent['surface'],
    feature: row.feature,
    action: row.action,
    outcome: row.outcome === null ? undefined : row.outcome as ProductUsageOutcome,
    durationMs: row.duration_ms ?? undefined,
    errorCode: row.error_code ?? undefined,
    target: row.target ?? undefined,
    releaseVersion: row.release_version,
    deviceClass: row.device_class as ProductUsageEvent['deviceClass'],
    inputKind: row.input_kind as ProductUsageEvent['inputKind'],
    online: row.online,
    reducedMotion: row.reduced_motion,
    metadata,
  };
}

export async function getProductUsageEvents(limit = 2_000): Promise<ProductUsageEvent[]> {
  if (!Number.isInteger(limit) || limit < 1 || limit > 2_000) {
    throw new Error('Product usage reads must request between 1 and 2,000 events.');
  }
  const database = requireClient();
  const { data, error } = await database
    .from('product_usage_events')
    .select([
      'event_id', 'schema_version', 'session_id', 'sequence', 'event_kind', 'occurred_at',
      'surface', 'feature', 'action', 'outcome', 'duration_ms', 'error_code', 'target',
      'release_version', 'device_class', 'input_kind', 'online', 'reduced_motion', 'metadata',
    ].join(','))
    .order('occurred_at', { ascending: false })
    .limit(limit);
  if (error) throw error;
  return ((data || []) as unknown as ProductUsageEventRow[]).map(mapProductUsageEvent);
}
