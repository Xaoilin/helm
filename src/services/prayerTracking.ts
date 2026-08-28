import type {
  BoundedReminderReceipt,
  PrayerActivationDayEligibility,
  PrayerCompletionSource,
  PrayerCompletionLedgerEntry,
  PrayerCompletionStatus,
  PrayerDeadlineBounds,
  PrayerDeadlineName,
  PrayerName,
  PrayerOutcomePercentages,
  PrayerOutcomeStats,
  PrayerOutcomeStatus,
  PrayerOutcomeTally,
  PrayerReminderReceipt,
  PrayerScheduleDay,
  PrayerScheduleEntry,
  PrayerTrackingRecord,
  PrayerTrackingState,
  Task,
} from '../types/domain';
import { toLocalDateStr } from './financeHelpers';
import { getPrayerTaskName } from './prayerTasks';

export const PRAYER_TRACKING_SCHEMA_VERSION = 1;
export const CANONICAL_PRAYER_NAMES = ['Fajr', 'Dhuhr', 'Asr', 'Maghrib', 'Isha'] as const satisfies readonly PrayerName[];
const BOUNDED_REMINDER_KINDS = new Set(['prayer-opportunity', 'prayer-deadline', 'momentum']);

const PRAYER_DEADLINES: Record<PrayerName, PrayerDeadlineName> = {
  Fajr: 'Sunrise',
  Dhuhr: 'Asr',
  Asr: 'Maghrib',
  Maghrib: 'Isha',
  Isha: 'Midnight',
};

export function getPrayerDeadlineName(prayerName: PrayerName): PrayerDeadlineName {
  return PRAYER_DEADLINES[prayerName];
}

const PRAYER_NAME_SET = new Set<string>(CANONICAL_PRAYER_NAMES);
const OUTCOME_STATUS_SET = new Set<string>(['on_time', 'late', 'missed', 'unclassified']);
const LOCAL_DATE_PATTERN = /^(\d{4})-(\d{2})-(\d{2})$/;
const CLOCK_TIME_PATTERN = /^(\d{1,2}):(\d{2})(?::\d{2})?/;

type LegacyPrayerTask = Pick<Task, 'id' | 'category' | 'title' | 'prayerName'>;

export interface NormalizePrayerTrackingOptions {
  now?: Date;
  dailyLog?: Record<string, string[]>;
  prayerCompletionLedger?: Record<string, PrayerCompletionLedgerEntry>;
  tasks?: readonly LegacyPrayerTask[];
}

export interface SetPrayerOutcomeInput {
  date: string;
  prayerName: PrayerName;
  status: PrayerOutcomeStatus;
  recordedAt?: Date | string;
  rewarded?: true;
  taskId?: string;
  source?: PrayerCompletionSource;
}

export interface SetPrayerReminderReceiptInput {
  date: string;
  prayerName: PrayerName;
  deadlineAt: Date | string;
  notifiedAt?: Date | string;
  snoozedUntil?: Date | string;
}

type MutablePrayerOutcomeTally = Omit<PrayerOutcomeTally, 'percentages'>;

function isObject(value: unknown): value is Record<string, unknown> {
  return typeof value === 'object' && value !== null && !Array.isArray(value);
}

function isPrayerName(value: unknown): value is PrayerName {
  return typeof value === 'string' && PRAYER_NAME_SET.has(value);
}

function isPrayerOutcomeStatus(value: unknown): value is PrayerOutcomeStatus {
  return typeof value === 'string' && OUTCOME_STATUS_SET.has(value);
}

function parseLocalDate(value: string): Date | null {
  const match = LOCAL_DATE_PATTERN.exec(value);
  if (!match) return null;

  const year = Number(match[1]);
  const month = Number(match[2]);
  const day = Number(match[3]);
  const parsed = new Date(year, month - 1, day, 0, 0, 0, 0);
  return toLocalDateStr(parsed) === value ? parsed : null;
}

function requireLocalDate(value: string): Date {
  const parsed = parseLocalDate(value);
  if (!parsed) {
    throw new RangeError(`Invalid local prayer date: ${value}`);
  }
  return parsed;
}

function parseInstant(value: unknown): Date | null {
  if (value instanceof Date) {
    return Number.isFinite(value.getTime()) ? new Date(value) : null;
  }
  if (typeof value !== 'string' || !value.trim()) return null;
  const parsed = new Date(value);
  return Number.isFinite(parsed.getTime()) ? parsed : null;
}

function normalizeInstant(value: unknown, fallback: string): string {
  return parseInstant(value)?.toISOString() ?? fallback;
}

function optionalInstant(value: unknown): string | undefined {
  return parseInstant(value)?.toISOString();
}

function parseClockOnDate(date: Date, time: string): Date | null {
  const match = CLOCK_TIME_PATTERN.exec(time.trim());
  if (!match) return null;

  const hours = Number(match[1]);
  const minutes = Number(match[2]);
  if (hours > 23 || minutes > 59) return null;

  const parsed = new Date(date);
  parsed.setHours(hours, minutes, 0, 0);
  return parsed;
}

function findScheduleEntry(prayers: readonly PrayerScheduleEntry[], name: string): PrayerScheduleEntry | undefined {
  return prayers.find(prayer => prayer.name === name);
}

function normalizePrayerRecord(value: unknown, fallbackRecordedAt: string): PrayerTrackingRecord | null {
  if (!isObject(value)) return null;
  if (typeof value.date !== 'string' || !parseLocalDate(value.date)) return null;
  if (!isPrayerName(value.prayerName) || !isPrayerOutcomeStatus(value.status)) return null;

  const record: PrayerTrackingRecord = {
    date: value.date,
    prayerName: value.prayerName,
    status: value.status,
    recordedAt: normalizeInstant(value.recordedAt, fallbackRecordedAt),
  };
  if (value.rewarded === true) {
    record.rewarded = true;
  }
  if (typeof value.taskId === 'string' && value.taskId.trim()) {
    record.taskId = value.taskId;
  }
  if (typeof value.source === 'string' && value.source.trim()) {
    record.source = value.source;
  }
  return record;
}

function normalizeReminderReceipt(value: unknown): PrayerReminderReceipt | null {
  if (!isObject(value)) return null;
  if (typeof value.date !== 'string' || !parseLocalDate(value.date)) return null;
  if (!isPrayerName(value.prayerName)) return null;

  const deadlineAt = optionalInstant(value.deadlineAt);
  if (!deadlineAt) return null;

  const notificationKey = getPrayerReminderKey(value.date, value.prayerName, deadlineAt);
  const receipt: PrayerReminderReceipt = {
    date: value.date,
    prayerName: value.prayerName,
    deadlineAt,
    notificationKey,
  };
  const notifiedAt = optionalInstant(value.notifiedAt);
  const snoozedUntil = optionalInstant(value.snoozedUntil);
  if (notifiedAt) receipt.notifiedAt = notifiedAt;
  if (snoozedUntil) receipt.snoozedUntil = snoozedUntil;
  return receipt;
}

function normalizeActivationDayEligibility(
  value: unknown,
  activationDate: string,
): PrayerActivationDayEligibility | undefined {
  if (!isObject(value) || typeof value.date !== 'string' || !parseLocalDate(value.date)) {
    return undefined;
  }
  if (value.date !== activationDate) return undefined;
  const rawPrayerNames = value.prayerNames;
  if (!Array.isArray(rawPrayerNames)) return undefined;

  const prayerNames = CANONICAL_PRAYER_NAMES.filter(prayerName =>
    rawPrayerNames.includes(prayerName)
  );
  return {
    date: value.date,
    prayerNames,
  };
}

function emptyMutableTally(): MutablePrayerOutcomeTally {
  return {
    onTime: 0,
    late: 0,
    missed: 0,
    inferredMissed: 0,
    unclassified: 0,
    pending: 0,
    classifiedTotal: 0,
    opportunities: 0,
  };
}

function sumPreservingPercentages(tally: MutablePrayerOutcomeTally): PrayerOutcomePercentages {
  const counts = [tally.onTime, tally.late, tally.missed] as const;
  if (tally.classifiedTotal === 0) {
    return { onTime: 0, late: 0, missed: 0 };
  }

  const raw = counts.map(count => (count / tally.classifiedTotal) * 100);
  const rounded = raw.map(value => Math.floor(value));
  const remaining = 100 - rounded.reduce((sum, value) => sum + value, 0);
  const distributionOrder = raw
    .map((value, index) => ({ index, remainder: value - rounded[index] }))
    .sort((left, right) => right.remainder - left.remainder || left.index - right.index);

  for (let index = 0; index < remaining; index += 1) {
    rounded[distributionOrder[index].index] += 1;
  }

  return {
    onTime: rounded[0],
    late: rounded[1],
    missed: rounded[2],
  };
}

function finalizeTally(tally: MutablePrayerOutcomeTally): PrayerOutcomeTally {
  return {
    ...tally,
    percentages: sumPreservingPercentages(tally),
  };
}

function incrementTally(
  tally: MutablePrayerOutcomeTally,
  status: PrayerOutcomeStatus | 'pending',
  inferred = false,
): void {
  tally.opportunities += 1;
  if (status === 'on_time') {
    tally.onTime += 1;
    tally.classifiedTotal += 1;
  } else if (status === 'late') {
    tally.late += 1;
    tally.classifiedTotal += 1;
  } else if (status === 'missed') {
    tally.missed += 1;
    tally.classifiedTotal += 1;
    if (inferred) tally.inferredMissed += 1;
  } else if (status === 'unclassified') {
    tally.unclassified += 1;
  } else {
    tally.pending += 1;
  }
}

export function getPrayerRecordKey(date: string, prayerName: PrayerName): string {
  return `${date}::${prayerName}`;
}

export function getPrayerRewardLogId(prayerName: PrayerName): string {
  return `prayer:${prayerName.toLowerCase()}`;
}

export function getPrayerReminderKey(
  date: string,
  prayerName: PrayerName,
  deadlineAt: Date | string,
): string {
  const deadline = parseInstant(deadlineAt);
  if (!deadline) {
    throw new RangeError('Invalid prayer reminder deadline');
  }
  return `${getPrayerRecordKey(date, prayerName)}::${deadline.toISOString()}`;
}

export function createPrayerTrackingState(now: Date = new Date()): PrayerTrackingState {
  if (!Number.isFinite(now.getTime())) {
    throw new RangeError('Invalid prayer tracking activation time');
  }
  return {
    schemaVersion: PRAYER_TRACKING_SCHEMA_VERSION,
    trackingStartedAt: now.toISOString(),
    records: {},
    reminderReceipts: {},
    boundedReminderReceipts: {},
  };
}

/**
 * Normalize persisted state and import legacy daily-log completions as
 * unclassified. Migration records when import happened, never a guessed prayer
 * completion time.
 */
export function normalizePrayerTrackingState(
  value: unknown,
  options: NormalizePrayerTrackingOptions = {},
): PrayerTrackingState {
  const now = options.now ?? new Date();
  const fallback = createPrayerTrackingState(now);
  const raw = isObject(value) ? value : {};
  const trackingStartedAt = normalizeInstant(raw.trackingStartedAt, fallback.trackingStartedAt);
  const activationDate = toLocalDateStr(new Date(trackingStartedAt));
  const activationDayEligibility = normalizeActivationDayEligibility(
    raw.activationDayEligibility,
    activationDate,
  );
  const records: Record<string, PrayerTrackingRecord> = {};
  const reminderReceipts: Record<string, PrayerReminderReceipt> = {};
  const boundedReminderReceipts: Record<string, BoundedReminderReceipt> = {};

  if (isObject(raw.records)) {
    for (const candidate of Object.values(raw.records)) {
      const record = normalizePrayerRecord(candidate, trackingStartedAt);
      if (!record) continue;
      records[getPrayerRecordKey(record.date, record.prayerName)] = record;
    }
  }

  if (isObject(raw.reminderReceipts)) {
    for (const candidate of Object.values(raw.reminderReceipts)) {
      const receipt = normalizeReminderReceipt(candidate);
      if (!receipt) continue;
      reminderReceipts[receipt.notificationKey] = receipt;
    }
  }

  if (isObject(raw.boundedReminderReceipts)) {
    for (const [key, candidate] of Object.entries(raw.boundedReminderReceipts)) {
      if (
        !isObject(candidate)
        || candidate.notificationKey !== key
        || typeof candidate.date !== 'string'
        || !parseLocalDate(candidate.date)
        || typeof candidate.kind !== 'string'
        || !BOUNDED_REMINDER_KINDS.has(candidate.kind)
        || (candidate.snoozeCount !== 0 && candidate.snoozeCount !== 1)
      ) continue;
      const attemptedAt = optionalInstant(candidate.attemptedAt);
      const notifiedAt = optionalInstant(candidate.notifiedAt);
      const snoozedUntil = optionalInstant(candidate.snoozedUntil);
      boundedReminderReceipts[key] = {
        notificationKey: key,
        date: candidate.date,
        kind: candidate.kind as BoundedReminderReceipt['kind'],
        snoozeCount: candidate.snoozeCount,
        ...(attemptedAt ? { attemptedAt } : {}),
        ...(notifiedAt ? { notifiedAt } : {}),
        ...(snoozedUntil ? { snoozedUntil } : {}),
      };
    }
  }

  for (const candidate of Object.values(options.prayerCompletionLedger ?? {})) {
    if (!isObject(candidate)) continue;
    if (
      typeof candidate.date !== 'string'
      || !parseLocalDate(candidate.date)
      || !isPrayerName(candidate.prayerName)
      || !isPrayerOutcomeStatus(candidate.status)
    ) {
      continue;
    }
    const key = getPrayerRecordKey(candidate.date, candidate.prayerName);
    if (records[key]) continue;
    const record: PrayerTrackingRecord = {
      date: candidate.date,
      prayerName: candidate.prayerName,
      status: candidate.status,
      recordedAt: normalizeInstant(candidate.recordedAt, trackingStartedAt),
      source: typeof candidate.source === 'string' && candidate.source.trim()
        ? candidate.source
        : 'system',
    };
    if (candidate.rewarded === true) record.rewarded = true;
    if (typeof candidate.taskId === 'string' && candidate.taskId.trim()) {
      record.taskId = candidate.taskId;
    }
    records[key] = record;
  }

  const prayerTaskById = new Map<string, { prayerName: PrayerName; taskId?: string }>(
    CANONICAL_PRAYER_NAMES.map(prayerName => [
      getPrayerRewardLogId(prayerName),
      { prayerName },
    ]),
  );
  for (const task of options.tasks ?? []) {
    const prayerName = getPrayerTaskName(task);
    if (prayerName && isPrayerName(prayerName)) {
      prayerTaskById.set(task.id, { prayerName, taskId: task.id });
    }
  }

  for (const [date, taskIds] of Object.entries(options.dailyLog ?? {})) {
    if (!parseLocalDate(date) || !Array.isArray(taskIds)) continue;
    for (const taskId of taskIds) {
      const prayerTask = prayerTaskById.get(taskId);
      if (!prayerTask) continue;

      const key = getPrayerRecordKey(date, prayerTask.prayerName);
      if (records[key]) continue;
      records[key] = {
        date,
        prayerName: prayerTask.prayerName,
        status: 'unclassified',
        recordedAt: trackingStartedAt,
        rewarded: true,
        ...(prayerTask.taskId ? { taskId: prayerTask.taskId } : {}),
        source: 'migration',
      };
    }
  }

  return {
    schemaVersion: PRAYER_TRACKING_SCHEMA_VERSION,
    trackingStartedAt,
    ...(activationDayEligibility ? { activationDayEligibility } : {}),
    records,
    reminderReceipts,
    boundedReminderReceipts,
  };
}

/**
 * Freeze which canonical prayers were still eligible when tracking activated.
 * Once captured, later timetable/location changes cannot rewrite this snapshot.
 */
export function capturePrayerActivationDayEligibility(
  state: PrayerTrackingState,
  scheduleDay: PrayerScheduleDay,
): PrayerTrackingState {
  const normalized = normalizePrayerTrackingState(state);
  if (normalized.activationDayEligibility) return normalized;

  const trackingStartedAt = new Date(normalized.trackingStartedAt);
  const activationDate = toLocalDateStr(trackingStartedAt);
  if (scheduleDay.date !== activationDate) return normalized;

  const bounds = CANONICAL_PRAYER_NAMES.map(prayerName =>
    getPrayerDeadlineBounds(scheduleDay.prayers, scheduleDay.date, prayerName)
  );
  if (bounds.some(candidate => candidate === null)) return normalized;

  return {
    ...normalized,
    activationDayEligibility: {
      date: activationDate,
      prayerNames: CANONICAL_PRAYER_NAMES.filter((_, index) =>
        bounds[index]!.deadlineAt > trackingStartedAt
      ),
    },
  };
}

export function getPrayerOutcome(
  state: PrayerTrackingState,
  date: string,
  prayerName: PrayerName,
): PrayerTrackingRecord | undefined {
  return state.records[getPrayerRecordKey(date, prayerName)];
}

export function filterPrayerTrackingRecords(
  state: PrayerTrackingState,
  matchesDate: (date: string) => boolean,
): PrayerTrackingState {
  const records = Object.fromEntries(
    Object.entries(state.records).filter(([, record]) => matchesDate(record.date)),
  );
  return Object.keys(records).length === Object.keys(state.records).length
    ? state
    : { ...state, records };
}

export function setPrayerOutcome(
  state: PrayerTrackingState,
  input: SetPrayerOutcomeInput,
): PrayerTrackingState {
  requireLocalDate(input.date);
  if (!isPrayerName(input.prayerName) || !isPrayerOutcomeStatus(input.status)) {
    throw new RangeError('Invalid prayer outcome');
  }

  const recordedAtDate = input.recordedAt === undefined ? new Date() : parseInstant(input.recordedAt);
  if (!recordedAtDate) {
    throw new RangeError('Invalid prayer outcome recorded time');
  }

  const normalized = normalizePrayerTrackingState(state, { now: recordedAtDate });
  const key = getPrayerRecordKey(input.date, input.prayerName);
  const existing = normalized.records[key];
  const record: PrayerTrackingRecord = {
    date: input.date,
    prayerName: input.prayerName,
    status: input.status,
    recordedAt: recordedAtDate.toISOString(),
  };
  const rewarded = input.rewarded ?? existing?.rewarded;
  const taskId = input.taskId ?? existing?.taskId;
  const source = input.source ?? existing?.source;
  if (rewarded) record.rewarded = true;
  if (taskId) record.taskId = taskId;
  if (source) record.source = source;

  return {
    ...normalized,
    records: {
      ...normalized.records,
      [key]: record,
    },
  };
}

export function removePrayerOutcome(
  state: PrayerTrackingState,
  date: string,
  prayerName: PrayerName,
): PrayerTrackingState {
  const key = getPrayerRecordKey(date, prayerName);
  if (!state.records[key]) return state;

  const records = { ...state.records };
  delete records[key];
  return { ...state, records };
}

export function setPrayerReminderReceipt(
  state: PrayerTrackingState,
  input: SetPrayerReminderReceiptInput,
): PrayerTrackingState {
  requireLocalDate(input.date);
  if (!isPrayerName(input.prayerName)) {
    throw new RangeError('Invalid prayer reminder prayer name');
  }

  const deadlineAt = optionalInstant(input.deadlineAt);
  if (!deadlineAt) {
    throw new RangeError('Invalid prayer reminder deadline');
  }
  const notificationKey = getPrayerReminderKey(input.date, input.prayerName, deadlineAt);
  const existing = state.reminderReceipts[notificationKey];
  const receipt: PrayerReminderReceipt = {
    date: input.date,
    prayerName: input.prayerName,
    deadlineAt,
    notificationKey,
  };
  const notifiedAt = optionalInstant(input.notifiedAt) ?? existing?.notifiedAt;
  const snoozedUntil = optionalInstant(input.snoozedUntil) ?? existing?.snoozedUntil;
  if (notifiedAt) receipt.notifiedAt = notifiedAt;
  if (snoozedUntil) receipt.snoozedUntil = snoozedUntil;

  return {
    ...state,
    reminderReceipts: {
      ...state.reminderReceipts,
      [notificationKey]: receipt,
    },
  };
}

export function getPrayerDeadlineBounds(
  prayers: readonly PrayerScheduleEntry[],
  date: string,
  prayerName: PrayerName,
): PrayerDeadlineBounds | null {
  const localDate = requireLocalDate(date);
  const deadlineName = getPrayerDeadlineName(prayerName);
  const startEntry = findScheduleEntry(prayers, prayerName);
  const deadlineEntry = findScheduleEntry(prayers, deadlineName);
  if (!startEntry || !deadlineEntry) return null;

  const startsAt = parseClockOnDate(localDate, startEntry.time);
  const deadlineAt = parseClockOnDate(localDate, deadlineEntry.time);
  if (!startsAt || !deadlineAt) return null;
  if (deadlineAt <= startsAt && deadlineName !== 'Midnight') {
    return null;
  }
  if (deadlineAt <= startsAt) {
    deadlineAt.setDate(deadlineAt.getDate() + 1);
  }

  return {
    date,
    prayerName,
    deadlineName,
    startsAt,
    deadlineAt,
  };
}

export function getPrayerCompletionStatusAt(
  deadlineAt: Date | string,
  completedAt: Date | string = new Date(),
): PrayerCompletionStatus {
  const deadline = parseInstant(deadlineAt);
  const completion = parseInstant(completedAt);
  if (!deadline || !completion) {
    throw new RangeError('Invalid prayer completion boundary');
  }
  return completion < deadline ? 'on_time' : 'late';
}

/**
 * Whether a schedule opportunity belongs to the classified tracking period.
 * The activation-day snapshot wins over later timetable or location changes.
 */
export function isPrayerOpportunityTracked(
  state: PrayerTrackingState,
  scheduleDay: PrayerScheduleDay,
  prayerName: PrayerName,
  referenceTime: Date = new Date(),
): boolean {
  if (!parseLocalDate(scheduleDay.date)) return false;
  if (!Number.isFinite(referenceTime.getTime())) return false;
  const trackingStartedAt = parseInstant(state.trackingStartedAt);
  if (!trackingStartedAt) return false;

  const bounds = getPrayerDeadlineBounds(
    scheduleDay.prayers,
    scheduleDay.date,
    prayerName,
  );
  if (!bounds) return false;

  const activationDate = toLocalDateStr(trackingStartedAt);
  if (scheduleDay.date < activationDate) return false;
  if (scheduleDay.date > activationDate) return true;

  const activationEligibility = state.activationDayEligibility;
  if (activationEligibility?.date === activationDate) {
    return activationEligibility.prayerNames.includes(prayerName);
  }
  if (toLocalDateStr(referenceTime) !== activationDate) return false;
  return bounds.deadlineAt > trackingStartedAt;
}

/**
 * Calculate outcome stats for supplied schedule days. Schedule days define
 * reporting scope; each valid day is evaluated across all five canonical
 * prayers. Missing deadline data cannot be safely inferred and is skipped
 * unless an explicit record exists.
 */
export function calculatePrayerOutcomeStats(
  state: PrayerTrackingState,
  scheduleDays: readonly PrayerScheduleDay[],
  now: Date = new Date(),
): PrayerOutcomeStats {
  if (!Number.isFinite(now.getTime())) {
    throw new RangeError('Invalid prayer stats reference time');
  }

  const normalized = normalizePrayerTrackingState(state, { now });
  const trackingStartedAt = new Date(normalized.trackingStartedAt);
  const overall = emptyMutableTally();
  const perPrayerMutable = Object.fromEntries(
    CANONICAL_PRAYER_NAMES.map(prayerName => [prayerName, emptyMutableTally()]),
  ) as Record<PrayerName, MutablePrayerOutcomeTally>;
  const trackedDates = new Set<string>();
  const uniqueScheduleDays = new Map<string, PrayerScheduleDay>();
  const countedRecordKeys = new Set<string>();

  for (const scheduleDay of scheduleDays) {
    if (parseLocalDate(scheduleDay.date)) {
      uniqueScheduleDays.set(scheduleDay.date, scheduleDay);
    }
  }

  for (const scheduleDay of uniqueScheduleDays.values()) {
    for (const prayerName of CANONICAL_PRAYER_NAMES) {
      const record = getPrayerOutcome(normalized, scheduleDay.date, prayerName);
      if (record) countedRecordKeys.add(getPrayerRecordKey(scheduleDay.date, prayerName));
      const bounds = getPrayerDeadlineBounds(scheduleDay.prayers, scheduleDay.date, prayerName);
      let status: PrayerOutcomeStatus | 'pending' | null = null;
      let inferred = false;

      if (record?.status === 'unclassified') {
        status = 'unclassified';
      } else if (record && new Date(record.recordedAt) >= trackingStartedAt) {
        status = record.status;
      } else if (bounds) {
        if (!isPrayerOpportunityTracked(normalized, scheduleDay, prayerName, now)) continue;

        if (now >= bounds.deadlineAt) {
          status = 'missed';
          inferred = true;
        } else {
          status = 'pending';
        }
      }

      if (!status) continue;
      incrementTally(overall, status, inferred);
      incrementTally(perPrayerMutable[prayerName], status, inferred);
      trackedDates.add(scheduleDay.date);
    }
  }

  // Explicit outcomes remain reportable when today's schedule is unavailable
  // or when their historical date is outside the supplied schedule window.
  // Missing schedule data never creates inferred misses or pending entries.
  for (const [key, record] of Object.entries(normalized.records)) {
    if (countedRecordKeys.has(key)) continue;
    const status = record.status === 'unclassified'
      ? record.status
      : new Date(record.recordedAt) >= trackingStartedAt
        ? record.status
        : null;
    if (!status) continue;
    incrementTally(overall, status);
    incrementTally(perPrayerMutable[record.prayerName], status);
    trackedDates.add(record.date);
  }

  return {
    ...finalizeTally(overall),
    trackedDays: trackedDates.size,
    perPrayer: Object.fromEntries(
      CANONICAL_PRAYER_NAMES.map(prayerName => [
        prayerName,
        finalizeTally(perPrayerMutable[prayerName]),
      ]),
    ) as Record<PrayerName, PrayerOutcomeTally>,
  };
}
