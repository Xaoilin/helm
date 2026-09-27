/**
 * `Idempotency-Key` values for service writes. A key names one user action: retrying that action
 * reuses its key, so the service applies it once; a new action (even with the same content, such as
 * completing a prayer again after undoing it) gets a new key. Keys are visible ASCII, at most 200.
 */
import type { PrayerTrackingRecord, ProductUsageEvent } from '../../types/domain';

/** The completion this record was created by: retries share its `recordedAt`. */
export function createOutcomeKey(record: PrayerTrackingRecord): string {
  return `prayer-outcome:create:${record.date}:${record.prayerName}:${record.status}:${record.recordedAt}`;
}

/** Each correction stamps a new `recordedAt`, so correcting back and forth never reuses a key. */
export function correctOutcomeKey(outcomeId: string, record: PrayerTrackingRecord): string {
  return `prayer-outcome:correct:${outcomeId}:${record.status}:${record.recordedAt}`;
}

export function deleteOutcomeKey(outcomeId: string): string {
  return `prayer-outcome:delete:${outcomeId}`;
}

/** A save that replaces a whole value (settings, preferences): repeating it is harmless, so each save is new. */
export function newWriteKey(): string {
  return crypto.randomUUID();
}

/**
 * A batch of product-usage events is named by its events: a retry of the same batch reuses the key, a
 * batch with any other event gets another. The event IDs are hashed so the key stays under 200 characters.
 */
export function activityBatchKey(events: ProductUsageEvent[]): string {
  const ids = events.map(event => event.eventId).join(',');
  return `activity-events:${events.length}:${events[0]?.eventId ?? 'none'}:${hash53(ids)}`;
}

/** A fast, well-distributed 53-bit string hash (cyrb53), as 14 hexadecimal characters. */
function hash53(value: string): string {
  let first = 0xdeadbeef;
  let second = 0x41c6ce57;
  for (let index = 0; index < value.length; index += 1) {
    const code = value.charCodeAt(index);
    first = Math.imul(first ^ code, 2654435761);
    second = Math.imul(second ^ code, 1597334677);
  }
  first = Math.imul(first ^ (first >>> 16), 2246822507) ^ Math.imul(second ^ (second >>> 13), 3266489909);
  second = Math.imul(second ^ (second >>> 16), 2246822507) ^ Math.imul(first ^ (first >>> 13), 3266489909);
  return (4294967296 * (2097151 & second) + (first >>> 0)).toString(16).padStart(14, '0');
}
