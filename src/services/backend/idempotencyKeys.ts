/**
 * `Idempotency-Key` values for service writes. A key names one user action: retrying that action
 * reuses its key, so the service applies it once; a new action (even with the same content, such as
 * completing a prayer again after undoing it) gets a new key. Keys are visible ASCII, at most 200.
 */
import type { PrayerTrackingRecord, PrayerTrackingState } from '../../types/domain';

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

/** The legacy import happens once per account. */
export function importTrackingKey(state: Pick<PrayerTrackingState, 'trackingStartedAt'>): string {
  return `prayer-import:${state.trackingStartedAt}`;
}

/** A save that replaces a whole value (settings, preferences): repeating it is harmless, so each save is new. */
export function newWriteKey(): string {
  return crypto.randomUUID();
}
