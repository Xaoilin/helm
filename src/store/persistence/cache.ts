import type { HelmMutation, HelmRecord } from '../databaseTypes';
import {
  decodeStoreValue,
  encodeStoreValue,
  type EncodedStoreRecord,
} from '../recordCodec';

function stableValue(value: unknown): unknown {
  if (Array.isArray(value)) return value.map(stableValue);
  if (value && typeof value === 'object') {
    return Object.fromEntries(Object.entries(value as Record<string, unknown>)
      .sort(([a], [b]) => a.localeCompare(b))
      .map(([key, entry]) => [key, stableValue(entry)]));
  }
  return value;
}

export function valuesEqual(a: unknown, b: unknown): boolean {
  return JSON.stringify(stableValue(a)) === JSON.stringify(stableValue(b));
}

function copyEncodedRecords(records: EncodedStoreRecord[]): Map<string, EncodedStoreRecord> {
  return new Map(records.map(record => [record.recordId, {
    recordId: record.recordId,
    payload: structuredClone(record.payload),
    position: record.position,
  }]));
}

function isAtomicCounter(collection: string, recordId: string, field: string): boolean {
  return (
    collection === 'gamification'
    && (
      (recordId === 'profile' && (field === 'totalXp' || field === 'totalTasksCompleted'))
      || (recordId.startsWith('habit:') && field === 'count')
    )
  ) || (collection === 'assistantCorrections' && field === 'appliedCount');
}

function patchForPayload(
  collection: string,
  recordId: string,
  before: Record<string, unknown>,
  after: Record<string, unknown>,
): HelmMutation[] {
  // Older clients omit these reserved fields. Preserve the server-known value
  // so a partial edit cannot silently turn it into an unset operation.
  let effectiveAfter = (
    (collection === 'inventoryItems' || collection === 'inventoryNeeds')
    && before.dimensions !== undefined
    && !('dimensions' in after)
  ) ? { ...after, dimensions: before.dimensions } : after;
  if (collection === 'gamification' && recordId === 'profile') {
    effectiveAfter = { ...effectiveAfter };
    for (const field of ['dailyMomentumLearn', 'dailyMomentumMove']) {
      if (before[field] !== undefined) effectiveAfter[field] = before[field];
    }
  }

  const set: Record<string, unknown> = {};
  const unset: string[] = [];
  const mutations: HelmMutation[] = [];
  for (const [key, value] of Object.entries(effectiveAfter)) {
    if (valuesEqual(before[key], value)) continue;
    if (
      isAtomicCounter(collection, recordId, key)
      && typeof before[key] === 'number'
      && typeof value === 'number'
      && value !== before[key]
    ) {
      mutations.push({
        op: 'increment',
        collection,
        recordId,
        field: key,
        amount: value - before[key],
      });
    } else {
      set[key] = value;
    }
  }
  for (const key of Object.keys(before)) {
    if (!(key in effectiveAfter)) unset.push(key);
  }
  if (Object.keys(set).length > 0 || unset.length > 0) {
    mutations.unshift({ op: 'patch', collection, recordId, set, unset });
  }
  return mutations;
}

/**
 * Owns the authoritative record cache and the provider-delivered comparison
 * view. Keeping both together prevents concurrent remote additions from being
 * misread as local deletions while a mounted provider saves stale state.
 */
export class PersistenceRecordCache {
  private readonly recordsByCollection = new Map<string, Map<string, HelmRecord>>();
  private readonly deliveredRecordsByCollection = new Map<string, Map<string, EncodedStoreRecord>>();

  reset(): void {
    this.recordsByCollection.clear();
    this.deliveredRecordsByCollection.clear();
  }

  collectionKeys(): IterableIterator<string> {
    return this.recordsByCollection.keys();
  }

  getRecord(collection: string, recordId: string): HelmRecord | undefined {
    return this.recordsByCollection.get(collection)?.get(recordId);
  }

  replaceAll(records: HelmRecord[]): void {
    this.recordsByCollection.clear();
    for (const record of records) this.put(record);
  }

  replaceCollection(collection: string, records: HelmRecord[]): void {
    this.recordsByCollection.delete(collection);
    for (const record of records) this.put(record);
  }

  applyChanges(records: HelmRecord[]): void {
    for (const record of records) this.put(record);
  }

  encoded(collection: string): EncodedStoreRecord[] {
    return [...(this.recordsByCollection.get(collection)?.values() || [])]
      .filter(record => record.deletedAt === null)
      .map(record => ({
        recordId: record.recordId,
        payload: record.payload,
        position: record.position,
      }));
  }

  decoded(collection: string): unknown {
    return decodeStoreValue(collection, this.encoded(collection));
  }

  markDeliveredFromCache(collection: string): void {
    this.deliveredRecordsByCollection.set(collection, copyEncodedRecords(this.encoded(collection)));
  }

  markDeliveredValue(collection: string, value: unknown): void {
    this.deliveredRecordsByCollection.set(collection, copyEncodedRecords(encodeStoreValue(collection, value)));
  }

  buildMutations(collection: string, desiredValue: unknown): HelmMutation[] {
    const currentRecords = this.encoded(collection);
    const delivered = this.deliveredRecordsByCollection.get(collection) ?? copyEncodedRecords(currentRecords);
    const desiredRecords = encodeStoreValue(collection, desiredValue);
    const desired = new Map(desiredRecords.map(record => [record.recordId, record]));
    const operations: HelmMutation[] = [];

    for (const record of desiredRecords) {
      const existing = delivered.get(record.recordId);
      if (!existing) {
        const tombstone = this.getRecord(collection, record.recordId);
        if (tombstone?.deletedAt) {
          operations.push({ op: 'restore', collection, recordId: record.recordId });
          operations.push(...patchForPayload(
            collection,
            record.recordId,
            tombstone.payload,
            record.payload,
          ));
        } else {
          operations.push({
            op: 'create',
            collection,
            recordId: record.recordId,
            payload: record.payload,
            position: record.position,
          });
        }
        continue;
      }
      operations.push(...patchForPayload(collection, record.recordId, existing.payload, record.payload));
    }

    for (const record of delivered.values()) {
      if (!desired.has(record.recordId)) {
        operations.push({ op: 'delete', collection, recordId: record.recordId });
      }
    }

    const currentOrder = [...delivered.values()]
      .filter(record => record.position !== null)
      .sort((a, b) => (a.position ?? 0) - (b.position ?? 0))
      .map(record => record.recordId);
    const desiredOrder = desiredRecords
      .filter(record => record.position !== null)
      .sort((a, b) => (a.position ?? 0) - (b.position ?? 0))
      .map(record => record.recordId);
    if (!valuesEqual(currentOrder, desiredOrder) && desiredOrder.length > 0) {
      operations.push({ op: 'reorder', collection, orderedRecordIds: desiredOrder });
    }
    return operations;
  }

  private put(record: HelmRecord): void {
    let collection = this.recordsByCollection.get(record.collection);
    if (!collection) {
      collection = new Map();
      this.recordsByCollection.set(record.collection, collection);
    }
    collection.set(record.recordId, record);
  }
}
