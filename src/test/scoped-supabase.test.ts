import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';

const mocks = vi.hoisted(() => ({ getSession: vi.fn(), rpc: vi.fn(), from: vi.fn() }));
vi.mock('@supabase/supabase-js', () => ({
  createClient: () => ({
    auth: { getSession: mocks.getSession },
    rpc: mocks.rpc,
    from: mocks.from,
  }),
}));

import { fetchHelmAccountSnapshot, fetchHelmCollectionPage, getSessionUser, initSupabase } from '../store/supabase';
import { PersistenceRecordCache } from '../store/persistence/cache';

const userId = 'synthetic-scoped-account';
const state = { userId, schemaVersion: 1, accountVersion: 7, minimumClientVersion: '0.2.86', migratedAt: null, updatedAt: '2026-09-22T12:00:00Z' };
const record = { userId, collection: 'tasks', recordId: 'task-a', payload: { title: 'Task' }, position: 0, revision: 1, accountVersion: 7, createdAt: state.updatedAt, updatedAt: state.updatedAt, deletedAt: null };

describe('scoped Supabase account reads', () => {
  beforeEach(async () => {
    mocks.getSession.mockReset().mockResolvedValue({ data: { session: { access_token: 'synthetic-token', user: { id: userId } } }, error: null });
    mocks.rpc.mockReset();
    mocks.from.mockReset();
    initSupabase('https://project.supabase.test', 'public-key');
    await getSessionUser();
  });
  afterEach(() => {
    initSupabase('', '');
    vi.restoreAllMocks();
  });

  it('keeps legacy reads, scopes explicit requests, and preserves authoritative empty results', async () => {
    const abortSignal = vi.fn().mockResolvedValue({ data: { state, records: [record] }, error: null });
    mocks.rpc.mockReturnValue({ abortSignal });
    expect(await fetchHelmAccountSnapshot()).toEqual({ state, records: [record] });
    expect(mocks.rpc).toHaveBeenLastCalledWith('get_helm_account_snapshot');
    expect(await fetchHelmAccountSnapshot(['tasks', 'tasks'])).toEqual({ state, records: [record] });
    expect(mocks.rpc).toHaveBeenLastCalledWith('get_helm_account_snapshot_for_collections', { p_collections: ['tasks'] });
    abortSignal.mockResolvedValue({ data: { state, records: [] }, error: null });
    expect(await fetchHelmAccountSnapshot([])).toEqual({ state, records: [] });
    expect(mocks.rpc).toHaveBeenLastCalledWith('get_helm_account_snapshot_for_collections', { p_collections: [] });
    expect(abortSignal).toHaveBeenCalledWith(expect.any(AbortSignal));
  });

  it('rejects unrelated collections and account records from a scoped response', async () => {
    const abortSignal = vi.fn().mockResolvedValue({ data: { state, records: [{ ...record, collection: 'transactions' }] }, error: null });
    mocks.rpc.mockReturnValue({ abortSignal });
    await expect(fetchHelmAccountSnapshot(['tasks'])).rejects.toThrow('invalid record');
    abortSignal.mockResolvedValue({ data: { state, records: [{ ...record, userId: 'other-account' }] }, error: null });
    await expect(fetchHelmAccountSnapshot(['tasks'])).rejects.toThrow('invalid record');
  });

  it('reads one deterministic live page with one lookahead row and no eager loop', async () => {
    const rows = Array.from({ length: 51 }, (_, index) => ({
      user_id: userId, collection: 'assistantActivityLog', record_id: `activity-${index}`,
      payload: { id: `activity-${index}` }, position: index, revision: 1, account_version: 7,
      created_at: state.updatedAt, updated_at: state.updatedAt, deleted_at: null,
    }));
    const query = { select: vi.fn(), eq: vi.fn(), is: vi.fn(), order: vi.fn(), range: vi.fn(), abortSignal: vi.fn() };
    for (const method of ['select', 'eq', 'is', 'order', 'range'] as const) query[method].mockReturnValue(query);
    query.abortSignal.mockResolvedValue({ data: rows, error: null });
    mocks.from.mockReturnValue(query);

    const first = await fetchHelmCollectionPage('assistantActivityLog', 0, 50);
    expect(first.records).toHaveLength(50);
    expect(first.hasMore).toBe(true);
    expect(mocks.from).toHaveBeenCalledOnce();
    expect(query.eq.mock.calls).toEqual([['user_id', userId], ['collection', 'assistantActivityLog']]);
    expect(query.is).toHaveBeenCalledWith('deleted_at', null);
    expect(query.order.mock.calls).toEqual([['created_at', { ascending: false }], ['record_id', { ascending: true }]]);
    expect(query.range).toHaveBeenCalledWith(0, 50);
    expect(query.abortSignal).toHaveBeenCalledWith(expect.any(AbortSignal));

    query.abortSignal.mockResolvedValue({ data: rows.slice(50), error: null });
    const last = await fetchHelmCollectionPage('assistantActivityLog', 50, 50);
    expect(last.records.map(row => row.recordId)).toEqual(['activity-50']);
    expect(last.hasMore).toBe(false);
    expect(query.range).toHaveBeenLastCalledWith(50, 100);

    query.order.mockClear();
    query.abortSignal.mockResolvedValue({ data: [], error: null });
    await fetchHelmCollectionPage('tasks', 0, 50);
    expect(query.order.mock.calls).toEqual([['position', { ascending: true, nullsFirst: false }], ['record_id', { ascending: true }]]);
  });

  it('keeps the newest activity ahead of more than 50 position ties across appended pages', async () => {
    const rows = Array.from({ length: 120 }, (_, index) => ({
      user_id: userId, collection: 'assistantActivityLog', record_id: `activity-${String(index).padStart(3, '0')}`,
      payload: { id: `activity-${String(index).padStart(3, '0')}` }, position: 0, revision: 1, account_version: 7,
      created_at: new Date(Date.parse(state.updatedAt) + index * 1_000).toISOString(), updated_at: state.updatedAt, deleted_at: null,
    }));
    rows.push({ ...rows[0], record_id: 'z-newest', payload: { id: 'z-newest' }, created_at: '2026-09-22T12:03:00.000Z' });
    const query = { select: vi.fn(), eq: vi.fn(), is: vi.fn(), order: vi.fn(), range: vi.fn(), abortSignal: vi.fn() };
    for (const method of ['select', 'eq', 'is', 'order', 'range'] as const) query[method].mockReturnValue(query);
    query.abortSignal.mockImplementation(async () => {
      const orders = query.order.mock.calls.slice(-2) as ['position' | 'created_at' | 'record_id', { ascending: boolean }][];
      const [from, to] = query.range.mock.lastCall as [number, number];
      const sorted = [...rows].sort((a, b) => {
        for (const [column, { ascending }] of orders) {
          if (a[column] === b[column]) continue;
          const comparison = a[column]! < b[column]! ? -1 : 1;
          return ascending ? comparison : -comparison;
        }
        return 0;
      });
      return { data: sorted.slice(from, to + 1), error: null };
    });
    mocks.from.mockReturnValue(query);
    const cache = new PersistenceRecordCache();
    const first = await fetchHelmCollectionPage('assistantActivityLog', 0, 50);
    cache.replaceCollection('assistantActivityLog', first.records);
    cache.confirm('assistantActivityLog', false, 50);
    const ids = () => (cache.decoded('assistantActivityLog') as { id: string }[]).map(entry => entry.id);
    expect(ids()).toEqual(['z-newest', ...Array.from({ length: 49 }, (_, i) => `activity-${String(119 - i).padStart(3, '0')}`)]);

    const second = await fetchHelmCollectionPage('assistantActivityLog', 50, 50);
    cache.applyChanges(second.records);
    expect(ids()).toHaveLength(100);
    expect(ids()[0]).toBe('z-newest');
    expect(ids().at(-1)).toBe('activity-021');
    const third = await fetchHelmCollectionPage('assistantActivityLog', 100, 50);
    cache.applyChanges(third.records);
    expect(ids()).toEqual(['z-newest', ...Array.from({ length: 120 }, (_, i) => `activity-${String(119 - i).padStart(3, '0')}`)]);
    expect(third.hasMore).toBe(false);

    // A confirmed prepend appears immediately even before the next refresh.
    cache.applyChanges([
      { ...first.records[0], recordId: 'z-confirmed', payload: { id: 'z-confirmed' }, createdAt: '2026-09-22T12:04:00.000002Z' },
      { ...first.records[0], recordId: 'a-confirmed', payload: { id: 'a-confirmed' }, createdAt: '2026-09-22T12:04:00.000001Z' },
    ]);
    expect(ids().slice(0, 3)).toEqual(['z-confirmed', 'a-confirmed', 'z-newest']);
    expect(cache.encoded('assistantActivityLog').every(entry => entry.position === 0)).toBe(true);
  });

  it('rejects page sizes that cannot leave room for a lookahead row', async () => {
    await expect(fetchHelmCollectionPage('assistantActivityLog', 0, 1_000)).rejects.toThrow('between 1 and 999');
    await expect(fetchHelmCollectionPage('assistantActivityLog', -1, 50)).rejects.toThrow('non-negative offset');
    expect(mocks.from).not.toHaveBeenCalled();
  });
});
