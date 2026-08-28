import type {
  ClockState,
  GamificationProfile,
  PrayerTrackingState,
  Settings,
} from '../types/domain';
import { KNOWN_SHARED_STORE_KEY_SET, SHARED_STORE_KEY_SET } from './storeKeys';

export interface EncodedStoreRecord {
  recordId: string;
  payload: Record<string, unknown>;
  position: number | null;
}

const SINGLETON_STORE_KEYS = new Set(['settings']);
const COMPLEX_STORE_KEYS = new Set(['clock', 'gamification', 'prayerTracking']);

export const DEVICE_SETTING_FIELDS = [
  'deepgramApiKey',
  'elevenLabsApiKey',
  'googleOAuthClientId',
  'microphoneDeviceId',
  'ollamaEndpoint',
  'ollamaModel',
  'supabaseAnonKey',
  'supabaseUrl',
] as const satisfies readonly (keyof Settings)[];

export type DeviceSettings = Pick<Settings, (typeof DEVICE_SETTING_FIELDS)[number]>;

const DEVICE_SETTING_FIELD_SET = new Set<string>(DEVICE_SETTING_FIELDS);
const SHARED_SETTING_FIELDS = new Set<string>([
  'theme',
  'dataRetentionDays',
  'telemetry',
  'defaultCalendarTab',
  'goalTags',
  'prayerEnabled',
  'prayerCity',
  'prayerCountry',
  'prayerReminderEnabled',
  'prayerReminderMinutes',
  'assistantEnabled',
  'elevenLabsVoiceId',
  'wakeWordEnabled',
  'assistantLanguage',
  'assistantProvider',
  'hostedModel',
]);

function isRecord(value: unknown): value is Record<string, unknown> {
  return Boolean(value) && typeof value === 'object' && !Array.isArray(value);
}

function assertKnownCollection(collection: string): void {
  if (!KNOWN_SHARED_STORE_KEY_SET.has(collection) && collection !== 'workspaces') {
    throw new Error(`Unknown shared store collection: ${collection}`);
  }
}

function assertWritableCollection(collection: string): void {
  if (!SHARED_STORE_KEY_SET.has(collection) && collection !== 'workspaces') {
    throw new Error(`Shared store collection is retired or unknown: ${collection}`);
  }
}

function assertRecordId(value: unknown, collection: string, index: number): string {
  if (typeof value !== 'string' || !value.trim()) {
    throw new Error(`${collection} item ${index + 1} does not have a stable id.`);
  }
  return value;
}

export function splitSettings(value: unknown): {
  shared: Partial<Settings>;
  device: DeviceSettings;
} {
  const shared: Partial<Settings> = {};
  const device: DeviceSettings = {};
  if (!isRecord(value)) return { shared, device };

  for (const [key, entry] of Object.entries(value)) {
    if (DEVICE_SETTING_FIELD_SET.has(key)) {
      (device as Record<string, unknown>)[key] = entry;
    } else if (SHARED_SETTING_FIELDS.has(key)) {
      (shared as Record<string, unknown>)[key] = entry;
    }
  }
  return { shared, device };
}

export function sanitizeSharedStoreValue(collection: string, value: unknown): unknown {
  if (collection === 'settings') return splitSettings(value).shared;
  return value;
}

export function sanitizeLegacyStoreValue(collection: string, value: unknown): {
  value: unknown;
  ambiguous: boolean;
} {
  assertKnownCollection(collection);
  if (collection === 'settings') {
    if (!isRecord(value)) return { value: {}, ambiguous: value != null };
    const known = new Set([...SHARED_SETTING_FIELDS, ...DEVICE_SETTING_FIELD_SET]);
    return {
      value,
      ambiguous: Object.keys(value).some(key => !known.has(key)),
    };
  }
  if (COMPLEX_STORE_KEYS.has(collection)) {
    return { value: isRecord(value) ? value : null, ambiguous: value != null && !isRecord(value) };
  }
  if (!Array.isArray(value)) return { value: [], ambiguous: value != null };
  const safe = value.filter(entry => (
    isRecord(entry)
    && typeof entry.id === 'string'
    && Boolean(entry.id.trim())
  ));
  return { value: safe, ambiguous: safe.length !== value.length };
}

function encodeArrayStore(collection: string, value: unknown): EncodedStoreRecord[] {
  if (value == null) return [];
  if (!Array.isArray(value)) throw new Error(`${collection} must be an array.`);
  return value.map((entry, index) => {
    if (!isRecord(entry)) throw new Error(`${collection} item ${index + 1} must be an object.`);
    return {
      recordId: assertRecordId(entry.id, collection, index),
      payload: entry,
      position: index,
    };
  });
}

function encodeClock(value: unknown): EncodedStoreRecord[] {
  if (!isRecord(value)) return [];
  const clock = value as unknown as ClockState;
  const records: EncodedStoreRecord[] = [{
    recordId: 'meta',
    payload: {
      nextStopwatchNumber: Number.isFinite(clock.nextStopwatchNumber) ? clock.nextStopwatchNumber : 1,
      nextTimerNumber: Number.isFinite(clock.nextTimerNumber) ? clock.nextTimerNumber : 1,
    },
    position: null,
  }];
  for (const [position, stopwatch] of (clock.stopwatches || []).entries()) {
    records.push({ recordId: `stopwatch:${stopwatch.id}`, payload: stopwatch as unknown as Record<string, unknown>, position });
  }
  for (const [position, timer] of (clock.timers || []).entries()) {
    records.push({ recordId: `timer:${timer.id}`, payload: timer as unknown as Record<string, unknown>, position });
  }
  return records;
}

function encodeGamification(value: unknown): EncodedStoreRecord[] {
  if (!isRecord(value)) return [];
  const profile = value as unknown as GamificationProfile;
  const {
    habitTallies = {},
    dailyLog = {},
    prayerCompletionLedger = {},
    ...summary
  } = profile;
  const records: EncodedStoreRecord[] = [{
    recordId: 'profile',
    payload: summary as unknown as Record<string, unknown>,
    position: null,
  }];
  for (const [id, count] of Object.entries(habitTallies)) {
    records.push({ recordId: `habit:${id}`, payload: { count }, position: null });
  }
  for (const [date, taskIds] of Object.entries(dailyLog)) {
    records.push({ recordId: `day:${date}`, payload: { taskIds }, position: null });
  }
  for (const [id, entry] of Object.entries(prayerCompletionLedger)) {
    records.push({ recordId: `prayer:${id}`, payload: entry as unknown as Record<string, unknown>, position: null });
  }
  return records;
}

function encodePrayerTracking(value: unknown): EncodedStoreRecord[] {
  if (!isRecord(value)) return [];
  const tracking = value as unknown as PrayerTrackingState;
  const records: EncodedStoreRecord[] = [{
    recordId: 'meta',
    payload: {
      schemaVersion: tracking.schemaVersion,
      trackingStartedAt: tracking.trackingStartedAt,
    },
    position: null,
  }];
  if (tracking.activationDayEligibility) {
    records.push({
      recordId: 'activation',
      payload: tracking.activationDayEligibility as unknown as Record<string, unknown>,
      position: null,
    });
  }
  for (const [id, entry] of Object.entries(tracking.records || {})) {
    records.push({ recordId: `record:${id}`, payload: entry as unknown as Record<string, unknown>, position: null });
  }
  for (const [id, entry] of Object.entries(tracking.reminderReceipts || {})) {
    records.push({ recordId: `reminder:${id}`, payload: entry as unknown as Record<string, unknown>, position: null });
  }
  for (const [id, entry] of Object.entries(tracking.boundedReminderReceipts || {})) {
    records.push({ recordId: `bounded:${id}`, payload: entry as unknown as Record<string, unknown>, position: null });
  }
  return records;
}

export function encodeStoreValue(collection: string, value: unknown): EncodedStoreRecord[] {
  assertWritableCollection(collection);
  const sanitized = sanitizeSharedStoreValue(collection, value);
  if (SINGLETON_STORE_KEYS.has(collection)) {
    if (!isRecord(sanitized)) return [];
    return [{ recordId: 'singleton', payload: sanitized, position: null }];
  }
  if (collection === 'clock') return encodeClock(sanitized);
  if (collection === 'gamification') return encodeGamification(sanitized);
  if (collection === 'prayerTracking') return encodePrayerTracking(sanitized);
  return encodeArrayStore(collection, sanitized);
}

function ordered(records: EncodedStoreRecord[]): EncodedStoreRecord[] {
  return [...records].sort((a, b) => {
    const aPosition = a.position ?? Number.MAX_SAFE_INTEGER;
    const bPosition = b.position ?? Number.MAX_SAFE_INTEGER;
    return aPosition - bPosition || a.recordId.localeCompare(b.recordId);
  });
}

function decodeClock(records: EncodedStoreRecord[]): ClockState | null {
  if (records.length === 0) return null;
  const meta = records.find(record => record.recordId === 'meta')?.payload ?? {};
  return {
    stopwatches: ordered(records.filter(record => record.recordId.startsWith('stopwatch:')))
      .map(record => record.payload) as unknown as ClockState['stopwatches'],
    timers: ordered(records.filter(record => record.recordId.startsWith('timer:')))
      .map(record => record.payload) as unknown as ClockState['timers'],
    nextStopwatchNumber: typeof meta.nextStopwatchNumber === 'number' ? meta.nextStopwatchNumber : 1,
    nextTimerNumber: typeof meta.nextTimerNumber === 'number' ? meta.nextTimerNumber : 1,
  };
}

function decodeGamification(records: EncodedStoreRecord[]): GamificationProfile | null {
  if (records.length === 0) return null;
  const summary = records.find(record => record.recordId === 'profile')?.payload ?? {};
  const habitTallies: Record<string, number> = {};
  const dailyLog: Record<string, string[]> = {};
  const prayerCompletionLedger: Record<string, never> = {};
  for (const record of records) {
    if (record.recordId.startsWith('habit:') && typeof record.payload.count === 'number') {
      habitTallies[record.recordId.slice('habit:'.length)] = record.payload.count;
    } else if (record.recordId.startsWith('day:') && Array.isArray(record.payload.taskIds)) {
      dailyLog[record.recordId.slice('day:'.length)] = record.payload.taskIds.filter(id => typeof id === 'string') as string[];
    } else if (record.recordId.startsWith('prayer:')) {
      prayerCompletionLedger[record.recordId.slice('prayer:'.length)] = record.payload as never;
    }
  }
  return {
    ...(summary as unknown as GamificationProfile),
    habitTallies,
    dailyLog,
    prayerCompletionLedger,
  };
}

function decodePrayerTracking(records: EncodedStoreRecord[]): PrayerTrackingState | null {
  if (records.length === 0) return null;
  const meta = records.find(record => record.recordId === 'meta')?.payload ?? {};
  const activation = records.find(record => record.recordId === 'activation')?.payload;
  const tracked: PrayerTrackingState['records'] = {};
  const reminders: PrayerTrackingState['reminderReceipts'] = {};
  const boundedReminders: PrayerTrackingState['boundedReminderReceipts'] = {};
  for (const record of records) {
    if (record.recordId.startsWith('record:')) {
      tracked[record.recordId.slice('record:'.length)] = record.payload as never;
    } else if (record.recordId.startsWith('reminder:')) {
      reminders[record.recordId.slice('reminder:'.length)] = record.payload as never;
    } else if (record.recordId.startsWith('bounded:')) {
      boundedReminders[record.recordId.slice('bounded:'.length)] = record.payload as never;
    }
  }
  return {
    schemaVersion: typeof meta.schemaVersion === 'number' ? meta.schemaVersion : 1,
    trackingStartedAt: typeof meta.trackingStartedAt === 'string' ? meta.trackingStartedAt : new Date().toISOString(),
    ...(activation ? { activationDayEligibility: activation as never } : {}),
    records: tracked,
    reminderReceipts: reminders,
    boundedReminderReceipts: boundedReminders,
  };
}

export function decodeStoreValue(collection: string, records: EncodedStoreRecord[]): unknown {
  assertKnownCollection(collection);
  const active = records.filter(record => isRecord(record.payload));
  if (SINGLETON_STORE_KEYS.has(collection)) {
    return active.find(record => record.recordId === 'singleton')?.payload ?? null;
  }
  if (collection === 'clock') return decodeClock(active);
  if (collection === 'gamification') return decodeGamification(active);
  if (collection === 'prayerTracking') return decodePrayerTracking(active);
  return ordered(active).map(record => (
    typeof record.payload.id === 'string'
      ? record.payload
      : { ...record.payload, id: record.recordId }
  ));
}

function fillMissing(database: Record<string, unknown>, local: Record<string, unknown>): Record<string, unknown> {
  const merged = { ...database };
  for (const [key, value] of Object.entries(local)) {
    if (!(key in merged)) merged[key] = value;
  }
  return merged;
}

function mergeArrayRecords(database: unknown[], local: unknown[]): unknown[] {
  const localById = new Map(local
    .filter(isRecord)
    .filter(item => typeof item.id === 'string' && item.id.trim())
    .map(item => [item.id as string, item]));
  const databaseIds = new Set<string>();
  const merged = database.map(item => {
    if (!isRecord(item) || typeof item.id !== 'string') return item;
    databaseIds.add(item.id);
    const localRecord = localById.get(item.id);
    return localRecord ? fillMissing(item, localRecord) : item;
  });
  for (const [id, item] of localById) {
    if (!databaseIds.has(id)) merged.push(item);
  }
  return merged;
}

function mergeRecordMap(database: unknown, local: unknown): unknown {
  if (!isRecord(database)) return isRecord(local) ? local : database;
  if (!isRecord(local)) return database;
  return fillMissing(database, local);
}

function mergeComplexLegacyStore(
  collection: string,
  database: Record<string, unknown>,
  local: Record<string, unknown>,
): Record<string, unknown> {
  const merged = fillMissing(database, local);
  if (collection === 'clock') {
    merged.stopwatches = mergeArrayRecords(
      Array.isArray(database.stopwatches) ? database.stopwatches : [],
      Array.isArray(local.stopwatches) ? local.stopwatches : [],
    );
    merged.timers = mergeArrayRecords(
      Array.isArray(database.timers) ? database.timers : [],
      Array.isArray(local.timers) ? local.timers : [],
    );
  } else if (collection === 'gamification') {
    // Matching counters remain database-authoritative; local-only ledger keys
    // may be preserved, but values are never added together.
    merged.habitTallies = mergeRecordMap(database.habitTallies, local.habitTallies);
    merged.dailyLog = mergeRecordMap(database.dailyLog, local.dailyLog);
    merged.prayerCompletionLedger = mergeRecordMap(
      database.prayerCompletionLedger,
      local.prayerCompletionLedger,
    );
  } else if (collection === 'prayerTracking') {
    merged.records = mergeRecordMap(database.records, local.records);
    merged.reminderReceipts = mergeRecordMap(database.reminderReceipts, local.reminderReceipts);
    merged.boundedReminderReceipts = mergeRecordMap(
      database.boundedReminderReceipts,
      local.boundedReminderReceipts,
    );
  }
  return merged;
}

export function mergeLegacyStoreValue(collection: string, database: unknown, local: unknown): unknown {
  const safeLocal = sanitizeSharedStoreValue(
    collection,
    sanitizeLegacyStoreValue(collection, local).value,
  );
  if (Array.isArray(database) && Array.isArray(safeLocal)) {
    return mergeArrayRecords(database, safeLocal);
  }
  if (database == null) return safeLocal;
  if (isRecord(database) && isRecord(safeLocal)) {
    return COMPLEX_STORE_KEYS.has(collection)
      ? mergeComplexLegacyStore(collection, database, safeLocal)
      : fillMissing(database, safeLocal);
  }
  return database;
}

export function isComplexStoreCollection(collection: string): boolean {
  return COMPLEX_STORE_KEYS.has(collection);
}
