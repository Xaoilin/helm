/**
 * Keeps the app's prayer outcomes in step with the prayer service, which is the source of truth.
 *
 * The app keeps working with its `PrayerTrackingState`; this module only translates between that
 * state and service calls. It never decides prayer rules, rewards, or reminders.
 */
import type { PrayerTrackingRecord, PrayerTrackingState } from '../../types/domain';
import { getPrayerRecordKey } from '../prayerTracking';
import type { ServiceOutcome, ServiceTracking } from './contracts';
import { correctOutcomeKey, createOutcomeKey, deleteOutcomeKey } from './idempotencyKeys';
import {
  correctPrayerOutcome,
  createPrayerOutcome,
  deletePrayerOutcome,
  listPrayerOutcomes,
} from './prayerServiceApi';
import { ServiceError } from './serviceClient';

/** Outcomes the service has confirmed, keyed like `PrayerTrackingState.records`, with their ids. */
export interface ConfirmedOutcomes {
  records: Record<string, PrayerTrackingRecord>;
  ids: Record<string, string>;
}

export type OutcomeOperation =
  | { kind: 'create'; key: string; record: PrayerTrackingRecord }
  | { kind: 'correct'; key: string; id: string; record: PrayerTrackingRecord }
  | { kind: 'delete'; key: string; id: string };

/** The service accepts at most this many days per outcome query. */
const MAX_QUERY_DAYS = 366;

export function toTrackingRecord(outcome: ServiceOutcome): PrayerTrackingRecord {
  return {
    date: outcome.date,
    prayerName: outcome.prayer,
    status: outcome.status,
    recordedAt: outcome.recordedAt,
    ...(outcome.rewarded ? { rewarded: true as const } : {}),
    ...(outcome.taskId ? { taskId: outcome.taskId } : {}),
    ...(outcome.source ? { source: outcome.source } : {}),
  };
}

export function confirmedFromService(outcomes: readonly ServiceOutcome[]): ConfirmedOutcomes {
  const confirmed: ConfirmedOutcomes = { records: {}, ids: {} };
  for (const outcome of outcomes) {
    const key = getPrayerRecordKey(outcome.date, outcome.prayer);
    confirmed.records[key] = toTrackingRecord(outcome);
    confirmed.ids[key] = outcome.id;
  }
  return confirmed;
}

/**
 * Combines service outcomes with the app's records. A local record that says the same thing as
 * the service's is kept as is, so loading never rewrites unchanged data. Where they differ, the
 * most recently recorded status wins (changes made on this device while the service was
 * unreachable). Records only one side has are kept; nothing is deleted.
 */
export function mergeRecords(
  service: Record<string, PrayerTrackingRecord>,
  local: Record<string, PrayerTrackingRecord>,
): Record<string, PrayerTrackingRecord> {
  const merged: Record<string, PrayerTrackingRecord> = { ...local };
  for (const [key, confirmed] of Object.entries(service)) {
    const current = local[key];
    if (!current || (current.status !== confirmed.status && !isNewer(current, confirmed))) merged[key] = confirmed;
  }
  return merged;
}

/**
 * Adopts the service's tracking timeline. The activation-day snapshot is kept from this device
 * when the service has none yet; reminder receipts always stay local. Returns `local` itself
 * when nothing changes, so an unchanged load causes no save.
 */
export function applyServiceTracking(
  local: PrayerTrackingState,
  tracking: ServiceTracking,
  records: Record<string, PrayerTrackingRecord>,
): PrayerTrackingState {
  const trackingStartedAt = sameInstant(local.trackingStartedAt, tracking.trackingStartedAt)
    ? local.trackingStartedAt
    : tracking.trackingStartedAt;
  const activationDayEligibility = tracking.activationDate
    ? sameActivation(local.activationDayEligibility, tracking)
      ? local.activationDayEligibility
      : { date: tracking.activationDate, prayerNames: [...tracking.activationPrayers] }
    : local.activationDayEligibility;
  if (trackingStartedAt === local.trackingStartedAt
    && activationDayEligibility === local.activationDayEligibility
    && sameRecords(records, local.records)) return local;

  const next: PrayerTrackingState = { ...local, trackingStartedAt, records };
  if (activationDayEligibility) next.activationDayEligibility = activationDayEligibility;
  else delete next.activationDayEligibility;
  return next;
}

function sameInstant(left: string, right: string): boolean {
  return Date.parse(left) === Date.parse(right);
}

function sameActivation(local: PrayerTrackingState['activationDayEligibility'], tracking: ServiceTracking): boolean {
  return Boolean(local
    && local.date === tracking.activationDate
    && local.prayerNames.length === tracking.activationPrayers.length
    && local.prayerNames.every(name => tracking.activationPrayers.includes(name)));
}

function sameRecords(
  left: Record<string, PrayerTrackingRecord>,
  right: Record<string, PrayerTrackingRecord>,
): boolean {
  const keys = Object.keys(left);
  return keys.length === Object.keys(right).length && keys.every(key => left[key] === right[key]);
}

/** The service calls that turn the confirmed outcomes into the desired ones. */
export function planOutcomeSync(
  confirmed: ConfirmedOutcomes,
  desired: Record<string, PrayerTrackingRecord>,
): OutcomeOperation[] {
  const operations: OutcomeOperation[] = [];
  for (const [key, record] of Object.entries(desired)) {
    if (record.status === 'unclassified') continue; // Legacy records arrive only through the import.
    const current = confirmed.records[key];
    const id = confirmed.ids[key];
    if (!current) operations.push({ kind: 'create', key, record });
    else if (current.status !== record.status && id) operations.push({ kind: 'correct', key, id, record });
  }
  for (const key of Object.keys(confirmed.records)) {
    const id = confirmed.ids[key];
    if (!(key in desired) && id) operations.push({ kind: 'delete', key, id });
  }
  return operations;
}

/**
 * Whether the service refused a change for good (a rule or validation failure), as opposed to
 * a temporary failure worth retrying (network, timeout, server error, signed out).
 */
export function isPermanentRejection(error: unknown): error is ServiceError {
  return error instanceof ServiceError
    && error.status >= 400 && error.status < 500
    && error.status !== 401 && error.status !== 408 && error.status !== 429;
}

/** Puts one record back to what the service confirmed, or removes it if the service has none. */
export function revertRecord(
  state: PrayerTrackingState,
  key: string,
  confirmed: PrayerTrackingRecord | undefined,
): PrayerTrackingState {
  const records = { ...state.records };
  if (confirmed) records[key] = confirmed;
  else delete records[key];
  return { ...state, records };
}

/** Applies one operation and returns the updated confirmed outcomes. */
export async function applyOutcomeOperation(
  operation: OutcomeOperation,
  confirmed: ConfirmedOutcomes,
): Promise<ConfirmedOutcomes> {
  if (operation.kind === 'delete') {
    await deletePrayerOutcome(operation.id, deleteOutcomeKey(operation.id)).catch(ignoreNotFound);
    return withoutKey(confirmed, operation.key);
  }
  const status = writableStatus(operation.record);
  if (operation.kind === 'correct') {
    const change = await correctPrayerOutcome(operation.id, status, operation.record.source,
      correctOutcomeKey(operation.id, operation.record));
    return withOutcome(confirmed, operation.key, change.outcome);
  }
  try {
    const change = await createPrayerOutcome({
      date: operation.record.date,
      prayer: operation.record.prayerName,
      status,
      ...(operation.record.source ? { source: operation.record.source } : {}),
      ...(operation.record.taskId ? { taskId: operation.record.taskId } : {}),
    }, createOutcomeKey(operation.record));
    return withOutcome(confirmed, operation.key, change.outcome);
  } catch (error) {
    if (!(error instanceof ServiceError) || error.code !== 'outcome_exists') throw error;
    return correctExisting(operation.record, operation.key, confirmed, status);
  }
}

/**
 * The first date whose outcomes must be loaded: the tracking start, or an earlier outcome date.
 * Imported history can hold outcomes from before tracking started (e.g. legacy completions).
 */
export function historyStartDate(trackingStartedAt: string, ...recordSets: Record<string, PrayerTrackingRecord>[]): string {
  let start = trackingStartedAt.slice(0, 10);
  for (const records of recordSets) {
    for (const record of Object.values(records)) {
      if (record.date < start) start = record.date;
    }
  }
  return start;
}

/** Every outcome from `from` to `to`, fetched in service-sized pages. */
export async function listAllOutcomes(from: string, to: string): Promise<ServiceOutcome[]> {
  const outcomes: ServiceOutcome[] = [];
  for (let start = from; start <= to; start = addDays(start, MAX_QUERY_DAYS)) {
    const end = minDate(addDays(start, MAX_QUERY_DAYS - 1), to);
    outcomes.push(...await listPrayerOutcomes(start, end));
  }
  return outcomes;
}

/** Another device or the service recorded this prayer first: adopt it, then apply our status. */
async function correctExisting(
  record: PrayerTrackingRecord,
  key: string,
  confirmed: ConfirmedOutcomes,
  status: ReturnType<typeof writableStatus>,
): Promise<ConfirmedOutcomes> {
  const existing = (await listPrayerOutcomes(record.date, record.date))
    .find(outcome => outcome.prayer === record.prayerName);
  if (!existing) throw new ServiceError(409, 'outcome_exists', `${record.prayerName} is already recorded.`);
  if (existing.status === status) return withOutcome(confirmed, key, existing);
  const change = await correctPrayerOutcome(existing.id, status, record.source, correctOutcomeKey(existing.id, record));
  return withOutcome(confirmed, key, change.outcome);
}

function writableStatus(record: PrayerTrackingRecord): Exclude<PrayerTrackingRecord['status'], 'unclassified'> {
  if (record.status === 'unclassified') throw new Error('Unclassified outcomes are import-only.');
  return record.status;
}

function withOutcome(confirmed: ConfirmedOutcomes, key: string, outcome: ServiceOutcome): ConfirmedOutcomes {
  return {
    records: { ...confirmed.records, [key]: toTrackingRecord(outcome) },
    ids: { ...confirmed.ids, [key]: outcome.id },
  };
}

function withoutKey(confirmed: ConfirmedOutcomes, key: string): ConfirmedOutcomes {
  const records = { ...confirmed.records };
  const ids = { ...confirmed.ids };
  delete records[key];
  delete ids[key];
  return { records, ids };
}

function ignoreNotFound(error: unknown): void {
  if (!(error instanceof ServiceError) || error.status !== 404) throw error;
}

function isNewer(record: PrayerTrackingRecord, than: PrayerTrackingRecord): boolean {
  return Date.parse(record.recordedAt) > Date.parse(than.recordedAt);
}

function addDays(date: string, days: number): string {
  const next = new Date(`${date}T00:00:00.000Z`);
  next.setUTCDate(next.getUTCDate() + days);
  return next.toISOString().slice(0, 10);
}

function minDate(left: string, right: string): string {
  return left < right ? left : right;
}
