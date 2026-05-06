import { invoke } from '@tauri-apps/api/core';
import {
  flushWriteQueue,
  getSupabaseRealtimeSnapshot,
  getSupabaseWriteQueueSnapshot,
  isAuthenticated,
  isSupabaseReady,
  loadRemote,
  saveRemote,
  queueRemoteWrite,
  subscribeRemoteStore,
  subscribeSupabaseRealtimeSnapshot,
  subscribeSupabaseWriteQueueSnapshot,
  type RemoteStoreChange,
  type SupabaseRealtimeSnapshot,
  type SupabaseWriteQueueSnapshot,
} from './supabase';
import { logWarn } from '../services/logger';
import { getSharedStoreKey, SHARED_STORE_KEYS } from './storeKeys';

const NAMESPACE = 'helm';
const META_PREFIX = `${NAMESPACE}:meta:`;

let tauriAvailable: boolean | null = null;
let remoteFlushHandlersRegistered = false;
let remoteStoreUnsubscribe: (() => void) | null = null;
let lastLocalWriteAt: string | null = null;
let lastLocalWriteKey: string | null = null;
let lastLocalWriteError: string | null = null;
let lastRemoteReadAt: string | null = null;
let lastRemoteReadKey: string | null = null;
let lastRemoteReadError: string | null = null;
let lastRemoteWriteAt: string | null = null;
let lastRemoteWriteKey: string | null = null;
let lastRemoteWriteError: string | null = null;
let lastSuppressedInitialWriteKey: string | null = null;
let lastSuppressedInitialWriteAt: string | null = null;
let lastSyncDriftScanAt: string | null = null;
let lastSyncDriftResolutionAt: string | null = null;
let lastSyncDriftError: string | null = null;
let syncDriftConflictCount = 0;
const persistenceHealthSubscribers = new Set<(snapshot: PersistenceHealthSnapshot) => void>();
const storeChangeSubscribers = new Set<(change: RemoteStoreChange) => void>();
const lastKnownRemoteJson = new Map<string, string>();
const suppressNextAuthenticatedSave = new Set<string>();
const remoteReadFailedKeys = new Map<string, string>();

interface LocalCacheMeta {
  updatedAt: string | null;
  dirty: boolean;
}

interface LocalCacheSnapshot<T> {
  value: T | null;
  hasValue: boolean;
}

export interface PersistenceHealthSnapshot {
  mode: 'database' | 'local';
  lastLocalWriteAt: string | null;
  lastLocalWriteKey: string | null;
  lastLocalWriteError: string | null;
  lastRemoteReadAt: string | null;
  lastRemoteReadKey: string | null;
  lastRemoteReadError: string | null;
  lastRemoteWriteAt: string | null;
  lastRemoteWriteKey: string | null;
  lastRemoteWriteError: string | null;
  remoteReadFailedKeys: string[];
  lastSuppressedInitialWriteKey: string | null;
  lastSuppressedInitialWriteAt: string | null;
  dirtyKeys: string[];
  supabaseQueue: SupabaseWriteQueueSnapshot;
  supabaseRealtime: SupabaseRealtimeSnapshot;
  localImportCandidateCount: number;
  syncDriftConflictCount: number;
  lastSyncDriftScanAt: string | null;
  lastSyncDriftResolutionAt: string | null;
  lastSyncDriftError: string | null;
}

export interface LocalImportCandidate {
  key: string;
  label: string;
  description: string;
  localStorage: boolean;
  tauri: boolean;
  remoteExists: boolean | null;
  sizeBytes: number;
}

export interface LocalImportResult {
  key: string;
  imported: boolean;
  cleared: boolean;
  reason: 'imported' | 'remote_exists' | 'no_local_data' | 'not_authenticated' | 'remote_write_failed';
}

export type SyncDriftKind = 'identical' | 'local_only' | 'remote_only' | 'conflict' | 'unreadable';
export type SyncResolutionChoice = 'keep_database' | 'use_device';

export interface SyncDriftDiffItem {
  key: string;
  keyLabel: string;
  id: string;
  label: string;
  detail: string;
}

export interface SyncDriftDiff {
  localOnly: SyncDriftDiffItem[];
  remoteOnly: SyncDriftDiffItem[];
  changed: SyncDriftDiffItem[];
  unchangedCount: number;
}

export interface SyncDriftSideSummary {
  hasValue: boolean;
  source: 'database' | 'tauri' | 'localStorage' | 'mixed' | 'none';
  sizeBytes: number;
  updatedAt: string | null;
  redactedJson: string;
}

export interface SyncDriftKeySummary {
  key: string;
  label: string;
  description: string;
  kind: SyncDriftKind;
  local: SyncDriftSideSummary;
  remote: SyncDriftSideSummary;
}

export interface SyncDriftCandidate {
  groupId: string;
  label: string;
  description: string;
  keys: SyncDriftKeySummary[];
  kind: SyncDriftKind;
  requiresUserChoice: boolean;
  recommendedChoice: SyncResolutionChoice;
  local: SyncDriftSideSummary;
  remote: SyncDriftSideSummary;
  diff: SyncDriftDiff;
  conflictHash: string;
  canUseDevice: boolean;
}

export interface SyncResolutionResult {
  groupId: string;
  choice: SyncResolutionChoice;
  resolved: boolean;
  clearedKeys: string[];
  savedKeys: string[];
  error: string | null;
}

async function isTauri(): Promise<boolean> {
  if (tauriAvailable !== null) return tauriAvailable;
  try {
    await invoke('get_app_data_dir');
    tauriAvailable = true;
  } catch {
    logWarn('Persistence', 'Tauri detection failed');
    tauriAvailable = false;
  }
  return tauriAvailable;
}

function getDataKey(key: string): string {
  return `${NAMESPACE}:${key}`;
}

function getMetaKey(key: string): string {
  return `${META_PREFIX}${key}`;
}

function readLocalCache<T>(key: string): LocalCacheSnapshot<T> {
  const raw = localStorage.getItem(getDataKey(key));
  if (raw === null) {
    return { value: null, hasValue: false };
  }

  try {
    return {
      value: JSON.parse(raw) as T,
      hasValue: true,
    };
  } catch {
    logWarn('Persistence', 'Local cache JSON parse failed');
    return {
      value: null,
      hasValue: false,
    };
  }
}

function readLocalCacheMeta(key: string): LocalCacheMeta {
  const raw = localStorage.getItem(getMetaKey(key));
  if (!raw) {
    return {
      updatedAt: null,
      dirty: false,
    };
  }

  try {
    const parsed = JSON.parse(raw) as Partial<LocalCacheMeta>;
    return {
      updatedAt: typeof parsed.updatedAt === 'string' ? parsed.updatedAt : null,
      dirty: parsed.dirty === true,
    };
  } catch {
    logWarn('Persistence', 'Local cache metadata parse failed');
    return {
      updatedAt: null,
      dirty: false,
    };
  }
}

function writeLocalCacheMeta(key: string, meta: LocalCacheMeta): void {
  localStorage.setItem(getMetaKey(key), JSON.stringify(meta));
}

function removeLocalCacheValue(key: string): void {
  localStorage.removeItem(getDataKey(key));
  localStorage.removeItem(getMetaKey(key));
}

async function readTauriRaw(key: string): Promise<string | null> {
  try {
    if (!(await isTauri())) return null;
    return await invoke<string>('read_store', { key });
  } catch {
    return null;
  }
}

function parseImportRaw(raw: string | null): { value: unknown; hasValue: boolean; sizeBytes: number; parseError: boolean } {
  if (raw === null) {
    return { value: null, hasValue: false, sizeBytes: 0, parseError: false };
  }

  try {
    const value = JSON.parse(raw);
    return {
      value,
      hasValue: value !== null,
      sizeBytes: new Blob([raw]).size,
      parseError: false,
    };
  } catch {
    logWarn('Persistence', 'Local import JSON parse failed');
    return { value: null, hasValue: false, sizeBytes: raw.length, parseError: true };
  }
}

async function readLocalImportValue(key: string): Promise<{ value: unknown; hasValue: boolean; source: 'tauri' | 'localStorage' | null; sizeBytes: number }> {
  const tauri = parseImportRaw(await readTauriRaw(key));
  if (tauri.hasValue) {
    return { ...tauri, source: 'tauri' };
  }

  const rawLocal = localStorage.getItem(getDataKey(key));
  const local = parseImportRaw(rawLocal);
  if (local.hasValue) {
    return { ...local, source: 'localStorage' };
  }

  return { value: null, hasValue: false, source: null, sizeBytes: 0 };
}

interface SyncDriftGroupDefinition {
  groupId: string;
  label: string;
  description: string;
  keys: string[];
}

interface LocalDriftValue {
  value: unknown;
  hasValue: boolean;
  source: 'tauri' | 'localStorage' | null;
  sizeBytes: number;
  parseError: boolean;
}

interface RemoteDriftValue {
  value: unknown;
  hasValue: boolean;
  updatedAt: string | null;
  sizeBytes: number;
}

interface SyncDriftKeyScan {
  key: string;
  label: string;
  description: string;
  kind: SyncDriftKind;
  local: LocalDriftValue;
  remote: RemoteDriftValue;
}

interface SyncDriftGroupScan {
  definition: SyncDriftGroupDefinition;
  entries: SyncDriftKeyScan[];
  kind: SyncDriftKind;
}

const SYNC_DRIFT_GROUPS: SyncDriftGroupDefinition[] = [
  { groupId: 'settings', label: 'Settings', description: 'Theme, assistant, voice, and provider settings.', keys: ['settings'] },
  { groupId: 'integrations', label: 'Integrations', description: 'Integration connection status and metadata.', keys: ['integrations'] },
  { groupId: 'conversations', label: 'Chat conversations', description: 'Saved Lina chat threads.', keys: ['conversations'] },
  { groupId: 'calendar', label: 'Calendar', description: 'Calendar accounts, sources, and events kept together.', keys: ['calendarAccounts', 'calendarSources', 'calendarEvents'] },
  { groupId: 'clock', label: 'Clock workspace', description: 'Timers and stopwatches.', keys: ['clock'] },
  { groupId: 'trips', label: 'Trips', description: 'Trips, legs, itinerary, bookings, and trip budget data.', keys: ['trips', 'tripLegs', 'tripItineraryItems', 'tripBookings', 'tripBudgetEntries'] },
  { groupId: 'projects', label: 'Projects', description: 'Project portfolio and project wiki pages.', keys: ['projects', 'projectPages'] },
  { groupId: 'tasks', label: 'Tasks', description: 'Tasks, habits, goals, and board state.', keys: ['tasks'] },
  { groupId: 'dashboard', label: 'Dashboard feedback', description: 'Up Next feedback and dismissal history.', keys: ['dashboardFocusFeedback'] },
  { groupId: 'knowledge', label: 'Knowledge', description: 'Knowledge topics, notes, and lifestyle tracker items.', keys: ['knowledgeTopics', 'knowledgeEntries', 'lifestyleItems'] },
  { groupId: 'health', label: 'Health', description: 'Fast-food journal entries.', keys: ['healthFastFoodEntries'] },
  { groupId: 'finance', label: 'Finance', description: 'Finance accounts, transactions, budgets, and savings goals.', keys: ['financeAccounts', 'transactions', 'financeBudgets', 'savingsGoals'] },
  { groupId: 'profile', label: 'Profile progress', description: 'Gamification and prayer progress.', keys: ['gamification'] },
  { groupId: 'assistant', label: 'Assistant memory', description: 'Lina corrections and action audit history.', keys: ['assistantCorrections', 'assistantActivityLog'] },
];

const SYNC_DRIFT_GROUP_BY_ID = new Map(SYNC_DRIFT_GROUPS.map(group => [group.groupId, group]));
const TOKEN_LIKE_PATTERN = /[A-Za-z0-9_-]{24,}/g;
const SENSITIVE_KEY_PATTERN = /(apiKey|anonKey|accessToken|refreshToken|providerToken|secret|password|credential|clientSecret|privateKey)/i;

function stableStringify(value: unknown): string {
  if (value === null || typeof value !== 'object') {
    return JSON.stringify(value);
  }

  if (Array.isArray(value)) {
    return `[${value.map(item => stableStringify(item)).join(',')}]`;
  }

  const record = value as Record<string, unknown>;
  return `{${Object.keys(record).sort().map(key => `${JSON.stringify(key)}:${stableStringify(record[key])}`).join(',')}}`;
}

function valuesEqual(a: unknown, b: unknown): boolean {
  return stableStringify(a) === stableStringify(b);
}

function byteSize(value: unknown): number {
  try {
    return new Blob([JSON.stringify(value)]).size;
  } catch {
    return stableStringify(value).length;
  }
}

function redactValue(value: unknown, path = ''): unknown {
  if (typeof value === 'string') {
    return SENSITIVE_KEY_PATTERN.test(path) ? '[redacted]' : value.replace(TOKEN_LIKE_PATTERN, '[redacted]');
  }

  if (Array.isArray(value)) {
    return value.map((item, index) => redactValue(item, `${path}.${index}`));
  }

  if (value && typeof value === 'object') {
    return Object.fromEntries(Object.entries(value as Record<string, unknown>).map(([key, child]) => [
      key,
      redactValue(child, path ? `${path}.${key}` : key),
    ]));
  }

  return value;
}

function redactedJson(value: unknown): string {
  try {
    return JSON.stringify(redactValue(value), null, 2);
  } catch {
    return '"[unreadable]"';
  }
}

function displayValue(value: unknown): string {
  if (typeof value === 'string') return value.replace(TOKEN_LIKE_PATTERN, '[redacted]');
  if (typeof value === 'number' || typeof value === 'boolean') return String(value);
  if (value === null || value === undefined) return 'Empty';
  return 'Nested data';
}

function isRecord(value: unknown): value is Record<string, unknown> {
  return Boolean(value) && typeof value === 'object' && !Array.isArray(value);
}

function itemId(value: unknown, fallback: string): string {
  if (isRecord(value) && (typeof value.id === 'string' || typeof value.id === 'number')) {
    return String(value.id);
  }
  return fallback;
}

function itemLabel(value: unknown): string {
  if (isRecord(value)) {
    for (const key of ['title', 'name', 'email', 'provider', 'summary', 'id']) {
      const candidate = value[key];
      if (typeof candidate === 'string' && candidate.trim()) return candidate;
      if (typeof candidate === 'number') return String(candidate);
    }
  }
  return displayValue(value);
}

function hasIdRecords(value: unknown): value is Array<Record<string, unknown>> {
  return Array.isArray(value)
    && value.every(item => isRecord(item) && (typeof item.id === 'string' || typeof item.id === 'number'));
}

function diffItem(
  entry: SyncDriftKeyScan,
  id: string,
  label: string,
  detail: string,
): SyncDriftDiffItem {
  return {
    key: entry.key,
    keyLabel: entry.label,
    id,
    label,
    detail,
  };
}

function collectionItems(entry: SyncDriftKeyScan, value: unknown, detail: string): SyncDriftDiffItem[] {
  if (Array.isArray(value)) {
    return value.map((item, index) => diffItem(entry, itemId(item, `${entry.key}-${index}`), itemLabel(item), detail));
  }

  if (isRecord(value)) {
    return Object.keys(value)
      .sort()
      .map(key => diffItem(entry, `${entry.key}.${key}`, `${entry.label}: ${key}`, detail));
  }

  return [diffItem(entry, entry.key, entry.label, detail)];
}

function buildValueDiff(entry: SyncDriftKeyScan): SyncDriftDiff {
  const diff: SyncDriftDiff = {
    localOnly: [],
    remoteOnly: [],
    changed: [],
    unchangedCount: 0,
  };

  if (entry.local.parseError) {
    diff.changed.push(diffItem(entry, entry.key, entry.label, 'This device has unreadable JSON.'));
    return diff;
  }

  if (entry.local.hasValue && !entry.remote.hasValue) {
    diff.localOnly.push(...collectionItems(entry, entry.local.value, 'Only on this device.'));
    return diff;
  }

  if (!entry.local.hasValue && entry.remote.hasValue) {
    diff.remoteOnly.push(...collectionItems(entry, entry.remote.value, 'Only in Supabase.'));
    return diff;
  }

  if (!entry.local.hasValue || !entry.remote.hasValue) {
    return diff;
  }

  if (valuesEqual(entry.local.value, entry.remote.value)) {
    diff.unchangedCount += 1;
    return diff;
  }

  if (hasIdRecords(entry.local.value) && hasIdRecords(entry.remote.value)) {
    const localById = new Map(entry.local.value.map(item => [String(item.id), item]));
    const remoteById = new Map(entry.remote.value.map(item => [String(item.id), item]));
    const ids = new Set([...localById.keys(), ...remoteById.keys()]);

    ids.forEach(id => {
      const local = localById.get(id);
      const remote = remoteById.get(id);
      if (local && !remote) {
        diff.localOnly.push(diffItem(entry, id, itemLabel(local), 'Only on this device.'));
      } else if (!local && remote) {
        diff.remoteOnly.push(diffItem(entry, id, itemLabel(remote), 'Only in Supabase.'));
      } else if (local && remote && !valuesEqual(local, remote)) {
        diff.changed.push(diffItem(entry, id, itemLabel(local), 'Different fields in both places.'));
      } else {
        diff.unchangedCount += 1;
      }
    });
    return diff;
  }

  if (isRecord(entry.local.value) && isRecord(entry.remote.value)) {
    const localRecord = entry.local.value;
    const remoteRecord = entry.remote.value;
    const fields = new Set([...Object.keys(entry.local.value), ...Object.keys(entry.remote.value)]);
    fields.forEach(field => {
      if (!(field in remoteRecord)) {
        diff.localOnly.push(diffItem(entry, `${entry.key}.${field}`, `${entry.label}: ${field}`, 'Only on this device.'));
      } else if (!(field in localRecord)) {
        diff.remoteOnly.push(diffItem(entry, `${entry.key}.${field}`, `${entry.label}: ${field}`, 'Only in Supabase.'));
      } else if (!valuesEqual(localRecord[field], remoteRecord[field])) {
        diff.changed.push(diffItem(entry, `${entry.key}.${field}`, `${entry.label}: ${field}`, 'Different values.'));
      } else {
        diff.unchangedCount += 1;
      }
    });
    return diff;
  }

  diff.changed.push(diffItem(entry, entry.key, entry.label, 'The stored values are different.'));
  return diff;
}

function mergeDiffs(entries: SyncDriftKeyScan[]): SyncDriftDiff {
  return entries.reduce<SyncDriftDiff>((merged, entry) => {
    const next = buildValueDiff(entry);
    merged.localOnly.push(...next.localOnly);
    merged.remoteOnly.push(...next.remoteOnly);
    merged.changed.push(...next.changed);
    merged.unchangedCount += next.unchangedCount;
    return merged;
  }, {
    localOnly: [],
    remoteOnly: [],
    changed: [],
    unchangedCount: 0,
  });
}

async function readLocalDriftValue(key: string): Promise<LocalDriftValue> {
  const tauri = parseImportRaw(await readTauriRaw(key));
  if (tauri.hasValue || tauri.parseError) {
    return { ...tauri, source: 'tauri' };
  }

  const local = parseImportRaw(localStorage.getItem(getDataKey(key)));
  if (local.hasValue || local.parseError) {
    return { ...local, source: 'localStorage' };
  }

  return { value: null, hasValue: false, source: null, sizeBytes: 0, parseError: false };
}

async function readRemoteDriftValue(key: string): Promise<RemoteDriftValue> {
  const remote = await loadRemote(NAMESPACE, key);
  if (!remote) {
    return { value: null, hasValue: false, updatedAt: null, sizeBytes: 0 };
  }
  return {
    value: remote.value,
    hasValue: true,
    updatedAt: remote.updatedAt,
    sizeBytes: byteSize(remote.value),
  };
}

function buildSideSummary(
  entries: SyncDriftKeyScan[],
  side: 'local' | 'remote',
): SyncDriftSideSummary {
  const values: Record<string, unknown> = {};
  const sources = new Set<string>();
  let sizeBytes = 0;
  let updatedAt: string | null = null;

  entries.forEach(entry => {
    const value = entry[side];
    if (!value.hasValue) return;
    values[entry.key] = value.value;
    sizeBytes += value.sizeBytes;
    if (side === 'local') {
      sources.add((value as LocalDriftValue).source || 'none');
    } else {
      sources.add('database');
      const remoteUpdatedAt = (value as RemoteDriftValue).updatedAt;
      if (remoteUpdatedAt && (!updatedAt || new Date(remoteUpdatedAt).getTime() > new Date(updatedAt).getTime())) {
        updatedAt = remoteUpdatedAt;
      }
    }
  });

  const source = sources.size === 0
    ? 'none'
    : sources.size === 1
      ? Array.from(sources)[0] as SyncDriftSideSummary['source']
      : 'mixed';
  const hasValue = Object.keys(values).length > 0;
  const jsonValue = entries.length === 1 ? values[entries[0].key] : values;

  return {
    hasValue,
    source,
    sizeBytes,
    updatedAt,
    redactedJson: hasValue ? redactedJson(jsonValue) : 'null',
  };
}

function buildKeySummary(entry: SyncDriftKeyScan): SyncDriftKeySummary {
  return {
    key: entry.key,
    label: entry.label,
    description: entry.description,
    kind: entry.kind,
    local: buildSideSummary([entry], 'local'),
    remote: buildSideSummary([entry], 'remote'),
  };
}

function combineGroupKind(entries: SyncDriftKeyScan[]): SyncDriftKind {
  const hasUnreadable = entries.some(entry => entry.kind === 'unreadable');
  const hasConflict = entries.some(entry => entry.kind === 'conflict');
  const hasLocalOnly = entries.some(entry => entry.kind === 'local_only');
  const hasRemoteOnly = entries.some(entry => entry.kind === 'remote_only');

  if (hasUnreadable) return 'unreadable';
  if (hasConflict || (hasLocalOnly && hasRemoteOnly)) return 'conflict';
  if (hasLocalOnly) return 'local_only';
  if (hasRemoteOnly) return 'remote_only';
  return 'identical';
}

function buildConflictHash(scan: SyncDriftGroupScan): string {
  const serialized = stableStringify({
    groupId: scan.definition.groupId,
    kind: scan.kind,
    keys: scan.entries.map(entry => ({
      key: entry.key,
      kind: entry.kind,
      local: entry.local.hasValue ? stableStringify(entry.local.value) : entry.local.parseError ? 'unreadable' : null,
      remote: entry.remote.hasValue ? stableStringify(entry.remote.value) : null,
    })),
  });
  let hash = 0;
  for (let index = 0; index < serialized.length; index += 1) {
    hash = ((hash << 5) - hash + serialized.charCodeAt(index)) | 0;
  }
  return Math.abs(hash).toString(16);
}

function buildSyncDriftCandidate(scan: SyncDriftGroupScan): SyncDriftCandidate {
  return {
    groupId: scan.definition.groupId,
    label: scan.definition.label,
    description: scan.definition.description,
    keys: scan.entries.map(buildKeySummary),
    kind: scan.kind,
    requiresUserChoice: scan.kind === 'conflict' || scan.kind === 'unreadable',
    recommendedChoice: 'keep_database',
    local: buildSideSummary(scan.entries, 'local'),
    remote: buildSideSummary(scan.entries, 'remote'),
    diff: mergeDiffs(scan.entries),
    conflictHash: buildConflictHash(scan),
    canUseDevice: scan.kind !== 'unreadable',
  };
}

async function scanSyncDriftGroup(definition: SyncDriftGroupDefinition): Promise<SyncDriftGroupScan> {
  const entries = await Promise.all(definition.keys.map(async key => {
    const storeKey = getSharedStoreKey(key);
    const local = await readLocalDriftValue(key);
    let remote: RemoteDriftValue = { value: null, hasValue: false, updatedAt: null, sizeBytes: 0 };
    try {
      remote = await readRemoteDriftValue(key);
      rememberRemoteRead(key, null);
    } catch (error) {
      const message = error instanceof Error ? error.message : String(error);
      rememberRemoteRead(key, message);
      throw error;
    }

    const kind: SyncDriftKind = local.parseError
      ? 'unreadable'
      : local.hasValue && remote.hasValue
        ? valuesEqual(local.value, remote.value) ? 'identical' : 'conflict'
        : local.hasValue
          ? 'local_only'
          : remote.hasValue
            ? 'remote_only'
            : 'identical';

    return {
      key,
      label: storeKey?.label || key,
      description: storeKey?.description || 'App data.',
      kind,
      local,
      remote,
    };
  }));

  return {
    definition,
    entries,
    kind: combineGroupKind(entries),
  };
}

async function autoResolveSafeSyncDrift(scan: SyncDriftGroupScan): Promise<void> {
  if (scan.kind === 'identical') {
    await Promise.all(scan.entries
      .filter(entry => entry.local.hasValue)
      .map(entry => clearLocalStoreCopy(entry.key)));
    return;
  }

  if (scan.kind !== 'local_only') return;

  for (const entry of scan.entries) {
    if (!entry.local.hasValue) continue;
    const success = await saveRemote(NAMESPACE, entry.key, entry.local.value);
    if (!success) {
      throw new Error(`Supabase import write failed for ${entry.key}.`);
    }
    lastKnownRemoteJson.set(entry.key, JSON.stringify(entry.local.value));
    rememberRemoteWrite(entry.key, null);
  }

  await Promise.all(scan.entries
    .filter(entry => entry.local.hasValue)
    .map(entry => clearLocalStoreCopy(entry.key)));
}

function readDirtyKeys(): string[] {
  const dirtyKeys: string[] = [];

  try {
    for (let index = 0; index < localStorage.length; index += 1) {
      const storageKey = localStorage.key(index);
      if (!storageKey?.startsWith(META_PREFIX)) continue;
      const key = storageKey.slice(META_PREFIX.length);
      if (readLocalCacheMeta(key).dirty) {
        dirtyKeys.push(key);
      }
    }
  } catch {
    logWarn('Persistence', 'Local cache metadata scan failed');
  }

  return dirtyKeys.sort();
}

function countLocalImportCandidates(): number {
  try {
    return SHARED_STORE_KEYS.filter(item => localStorage.getItem(getDataKey(item.key)) !== null).length;
  } catch {
    return 0;
  }
}

function buildPersistenceHealthSnapshot(): PersistenceHealthSnapshot {
  return {
    mode: isSupabaseReady() && isAuthenticated() ? 'database' : 'local',
    lastLocalWriteAt,
    lastLocalWriteKey,
    lastLocalWriteError,
    lastRemoteReadAt,
    lastRemoteReadKey,
    lastRemoteReadError,
    lastRemoteWriteAt,
    lastRemoteWriteKey,
    lastRemoteWriteError,
    remoteReadFailedKeys: Array.from(remoteReadFailedKeys.keys()).sort(),
    lastSuppressedInitialWriteKey,
    lastSuppressedInitialWriteAt,
    dirtyKeys: readDirtyKeys(),
    supabaseQueue: getSupabaseWriteQueueSnapshot(),
    supabaseRealtime: getSupabaseRealtimeSnapshot(),
    localImportCandidateCount: countLocalImportCandidates(),
    syncDriftConflictCount,
    lastSyncDriftScanAt,
    lastSyncDriftResolutionAt,
    lastSyncDriftError,
  };
}

function notifyPersistenceHealthSubscribers(): void {
  const snapshot = buildPersistenceHealthSnapshot();
  persistenceHealthSubscribers.forEach(listener => listener(snapshot));
}

function rememberLocalWrite(key: string, error: string | null): void {
  lastLocalWriteKey = key;
  lastLocalWriteAt = error ? lastLocalWriteAt : new Date().toISOString();
  lastLocalWriteError = error;
  notifyPersistenceHealthSubscribers();
}

function rememberRemoteRead(key: string, error: string | null): void {
  lastRemoteReadKey = key;
  lastRemoteReadAt = new Date().toISOString();
  lastRemoteReadError = error;
  if (error) {
    remoteReadFailedKeys.set(key, error);
  } else {
    remoteReadFailedKeys.delete(key);
  }
  notifyPersistenceHealthSubscribers();
}

function rememberRemoteWrite(key: string, error: string | null): void {
  lastRemoteWriteKey = key;
  lastRemoteWriteAt = new Date().toISOString();
  lastRemoteWriteError = error;
  notifyPersistenceHealthSubscribers();
}

function rememberSuppressedInitialWrite(key: string): void {
  lastSuppressedInitialWriteKey = key;
  lastSuppressedInitialWriteAt = new Date().toISOString();
  notifyPersistenceHealthSubscribers();
}

export function getPersistenceHealthSnapshot(): PersistenceHealthSnapshot {
  return buildPersistenceHealthSnapshot();
}

export function subscribePersistenceHealth(
  listener: (snapshot: PersistenceHealthSnapshot) => void,
): () => void {
  persistenceHealthSubscribers.add(listener);
  listener(buildPersistenceHealthSnapshot());

  const unsubscribeQueue = subscribeSupabaseWriteQueueSnapshot(() => {
    notifyPersistenceHealthSubscribers();
  });
  const unsubscribeRealtime = subscribeSupabaseRealtimeSnapshot(() => {
    notifyPersistenceHealthSubscribers();
  });

  return () => {
    persistenceHealthSubscribers.delete(listener);
    unsubscribeQueue();
    unsubscribeRealtime();
  };
}

function ensureRemoteFlushHandlers(): void {
  if (remoteFlushHandlersRegistered || typeof window === 'undefined') return;

  const flushQueuedWrites = () => {
    void flushWriteQueue();
  };

  window.addEventListener('beforeunload', flushQueuedWrites);
  window.addEventListener('pagehide', flushQueuedWrites);

  if (typeof document !== 'undefined') {
    document.addEventListener('visibilitychange', () => {
      if (document.visibilityState === 'hidden') {
        void flushWriteQueue();
      }
    });
  }

  remoteFlushHandlersRegistered = true;
}

function ensureRemoteStoreSubscription(): void {
  if (remoteStoreUnsubscribe || !isSupabaseReady() || !isAuthenticated()) return;

  remoteStoreUnsubscribe = subscribeRemoteStore(NAMESPACE, change => {
    storeChangeSubscribers.forEach(listener => listener(change));
    notifyPersistenceHealthSubscribers();
  });
}

export function subscribeStoreChanges(listener: (change: RemoteStoreChange) => void): () => void {
  storeChangeSubscribers.add(listener);
  ensureRemoteStoreSubscription();

  return () => {
    storeChangeSubscribers.delete(listener);
    if (storeChangeSubscribers.size === 0 && remoteStoreUnsubscribe) {
      remoteStoreUnsubscribe();
      remoteStoreUnsubscribe = null;
    }
  };
}

export function subscribeStoreKey(key: string, listener: (change: RemoteStoreChange) => void): () => void {
  return subscribeStoreChanges(change => {
    if (change.key === key) {
      listener(change);
    }
  });
}

export async function clearLocalStoreCopy(key: string): Promise<void> {
  removeLocalCacheValue(key);
  try {
    if (await isTauri()) {
      await invoke('delete_store', { key });
    }
  } catch {
    logWarn('Persistence', `Tauri delete failed for ${key}`);
  }
  notifyPersistenceHealthSubscribers();
}

export async function listLocalImportCandidates(): Promise<LocalImportCandidate[]> {
  const candidates: LocalImportCandidate[] = [];
  const authenticated = isSupabaseReady() && isAuthenticated();

  for (const item of SHARED_STORE_KEYS) {
    const rawLocal = localStorage.getItem(getDataKey(item.key));
    const local = parseImportRaw(rawLocal);
    const tauri = parseImportRaw(await readTauriRaw(item.key));
    if (!local.hasValue && !tauri.hasValue) continue;

    let remoteExists: boolean | null = null;
    if (authenticated) {
      try {
        remoteExists = Boolean(await loadRemote(NAMESPACE, item.key));
      } catch (error) {
        remoteExists = null;
        logWarn('Persistence', `Could not check remote import state for ${item.key}: ${error instanceof Error ? error.message : String(error)}`);
      }
    }

    candidates.push({
      key: item.key,
      label: item.label,
      description: item.description,
      localStorage: local.hasValue,
      tauri: tauri.hasValue,
      remoteExists,
      sizeBytes: Math.max(local.sizeBytes, tauri.sizeBytes),
    });
  }

  return candidates;
}

export async function importLocalStoreCandidate(
  key: string,
  options: { replace?: boolean } = {},
): Promise<LocalImportResult> {
  if (!isSupabaseReady() || !isAuthenticated()) {
    return { key, imported: false, cleared: false, reason: 'not_authenticated' };
  }

  const storeKey = getSharedStoreKey(key);
  if (!storeKey) {
    return { key, imported: false, cleared: false, reason: 'no_local_data' };
  }

  const local = await readLocalImportValue(key);
  if (!local.hasValue) {
    return { key, imported: false, cleared: false, reason: 'no_local_data' };
  }

  try {
    const remote = await loadRemote(NAMESPACE, key);
    if (remote && !options.replace) {
      return { key, imported: false, cleared: false, reason: 'remote_exists' };
    }
  } catch (error) {
    const message = error instanceof Error ? error.message : String(error);
    rememberRemoteRead(key, message);
    return { key, imported: false, cleared: false, reason: 'remote_write_failed' };
  }

  const success = await saveRemote(NAMESPACE, key, local.value);
  if (!success) {
    rememberRemoteWrite(key, 'Supabase import write failed.');
    return { key, imported: false, cleared: false, reason: 'remote_write_failed' };
  }

  lastKnownRemoteJson.set(key, JSON.stringify(local.value));
  rememberRemoteWrite(key, null);
  await clearLocalStoreCopy(key);
  return { key, imported: true, cleared: true, reason: 'imported' };
}

export async function listSyncDriftCandidates(): Promise<SyncDriftCandidate[]> {
  if (!isSupabaseReady() || !isAuthenticated()) {
    syncDriftConflictCount = 0;
    lastSyncDriftScanAt = new Date().toISOString();
    lastSyncDriftError = null;
    notifyPersistenceHealthSubscribers();
    return [];
  }

  lastSyncDriftScanAt = new Date().toISOString();
  lastSyncDriftError = null;
  const candidates: SyncDriftCandidate[] = [];

  try {
    for (const definition of SYNC_DRIFT_GROUPS) {
      const scan = await scanSyncDriftGroup(definition);
      const hasLocalData = scan.entries.some(entry => entry.local.hasValue || entry.local.parseError);
      if (!hasLocalData) continue;

      if (scan.kind === 'identical' || scan.kind === 'local_only') {
        await autoResolveSafeSyncDrift(scan);
        continue;
      }

      if (scan.kind === 'conflict' || scan.kind === 'unreadable') {
        candidates.push(buildSyncDriftCandidate(scan));
      }
    }

    syncDriftConflictCount = candidates.length;
    notifyPersistenceHealthSubscribers();
    return candidates;
  } catch (error) {
    const message = error instanceof Error ? error.message : String(error);
    lastSyncDriftError = message.replace(TOKEN_LIKE_PATTERN, '[redacted]');
    syncDriftConflictCount = candidates.length;
    notifyPersistenceHealthSubscribers();
    logWarn('Persistence', `Sync drift scan failed: ${lastSyncDriftError}`);
    return candidates;
  }
}

export async function resolveSyncDriftCandidate(
  groupId: string,
  choice: SyncResolutionChoice,
): Promise<SyncResolutionResult> {
  const definition = SYNC_DRIFT_GROUP_BY_ID.get(groupId);
  if (!definition || !isSupabaseReady() || !isAuthenticated()) {
    return {
      groupId,
      choice,
      resolved: false,
      clearedKeys: [],
      savedKeys: [],
      error: !definition ? 'Unknown sync drift group.' : 'Supabase is not ready or the user is not signed in.',
    };
  }

  const scan = await scanSyncDriftGroup(definition);
  const clearedKeys: string[] = [];
  const savedKeys: string[] = [];

  try {
    if (choice === 'use_device') {
      const unreadable = scan.entries.find(entry => entry.local.parseError);
      if (unreadable) {
        throw new Error(`${unreadable.label} has unreadable local data.`);
      }

      for (const entry of scan.entries) {
        if (!entry.local.hasValue) continue;
        const success = await saveRemote(NAMESPACE, entry.key, entry.local.value);
        if (!success) {
          throw new Error(`Supabase write failed for ${entry.label}.`);
        }
        lastKnownRemoteJson.set(entry.key, JSON.stringify(entry.local.value));
        rememberRemoteWrite(entry.key, null);
        savedKeys.push(entry.key);
      }
    }

    for (const entry of scan.entries) {
      if (!entry.local.hasValue && !entry.local.parseError) continue;
      await clearLocalStoreCopy(entry.key);
      clearedKeys.push(entry.key);
    }

    lastSyncDriftResolutionAt = new Date().toISOString();
    lastSyncDriftError = null;
    syncDriftConflictCount = Math.max(0, syncDriftConflictCount - 1);
    notifyPersistenceHealthSubscribers();
    return {
      groupId,
      choice,
      resolved: true,
      clearedKeys,
      savedKeys,
      error: null,
    };
  } catch (error) {
    const message = error instanceof Error ? error.message : String(error);
    lastSyncDriftError = message.replace(TOKEN_LIKE_PATTERN, '[redacted]');
    notifyPersistenceHealthSubscribers();
    logWarn('Persistence', `Sync drift resolution failed: ${lastSyncDriftError}`);
    return {
      groupId,
      choice,
      resolved: false,
      clearedKeys,
      savedKeys,
      error: lastSyncDriftError,
    };
  }
}

/**
 * Load data. When authenticated with Supabase, the database is the
 * source of truth and local persistent storage is ignored.
 *
 * Priority:
 *   Authenticated: Supabase only
 *   Not authenticated: Tauri → localStorage
 */
export async function loadStore<T>(key: string): Promise<T | null> {
  if (isSupabaseReady() && isAuthenticated()) {
    try {
      const remote = await loadRemote<T>(NAMESPACE, key);
      suppressNextAuthenticatedSave.add(key);
      rememberRemoteRead(key, null);
      if (remote) {
        lastKnownRemoteJson.set(key, JSON.stringify(remote.value));
        return remote.value;
      }
      lastKnownRemoteJson.delete(key);
      return null;
    } catch (error) {
      const message = error instanceof Error ? error.message : String(error);
      suppressNextAuthenticatedSave.add(key);
      rememberRemoteRead(key, message);
      logWarn('Persistence', `Supabase load failed for ${key}: ${message}`);
      return null;
    }
  }

  // Not authenticated - local-first mode

  // 1. Try Tauri file store
  try {
    if (await isTauri()) {
      const raw = await invoke<string>('read_store', { key });
      const parsed = JSON.parse(raw);
      return parsed as T;
    }
  } catch { logWarn('Persistence', 'Tauri read failed'); }

  // 2. Try localStorage
  const localCache = readLocalCache<T>(key);
  if (localCache.hasValue) {
    return localCache.value;
  }

  return null;
}

/**
 * Save data. Signed-in users write to Supabase only. Signed-out users
 * write to the local-first Tauri/localStorage store.
 */
export async function saveStore<T>(key: string, value: T): Promise<void> {
  const json = JSON.stringify(value);
  const updatedAt = new Date().toISOString();
  const authenticated = isSupabaseReady() && isAuthenticated();

  if (authenticated) {
    if (lastKnownRemoteJson.get(key) === json) {
      suppressNextAuthenticatedSave.delete(key);
      return;
    }

    if (suppressNextAuthenticatedSave.has(key)) {
      suppressNextAuthenticatedSave.delete(key);
      rememberSuppressedInitialWrite(key);
      return;
    }

    const readFailure = remoteReadFailedKeys.get(key);
    if (readFailure) {
      const message = `Skipped Supabase write for ${key} because the last database read failed: ${readFailure}`;
      rememberRemoteWrite(key, message);
      logWarn('Persistence', message);
      return;
    }

    ensureRemoteFlushHandlers();
    ensureRemoteStoreSubscription();
    queueRemoteWrite(NAMESPACE, key, value, {
      updatedAt,
      onSettled: ({ success }) => {
        if (!success) {
          rememberRemoteWrite(key, getSupabaseWriteQueueSnapshot().lastFlushError || 'Supabase write failed.');
          return;
        }
        lastKnownRemoteJson.set(key, json);
        rememberRemoteWrite(key, null);
      },
    });
    notifyPersistenceHealthSubscribers();
    return;
  }

  // 1. Try Tauri
  try {
    if (await isTauri()) {
      await invoke('write_store', { key, value: json });
    }
  } catch { logWarn('Persistence', 'Tauri write failed'); }

  // 2. Always write to localStorage (fast cache)
  try {
    localStorage.setItem(getDataKey(key), json);
    writeLocalCacheMeta(key, {
      updatedAt,
      dirty: authenticated,
    });
    rememberLocalWrite(key, null);
  } catch (error) {
    const message = error instanceof Error ? error.message : String(error);
    rememberLocalWrite(key, message);
    logWarn('Persistence', `Local cache write failed: ${message}`);
    throw error;
  }
}
