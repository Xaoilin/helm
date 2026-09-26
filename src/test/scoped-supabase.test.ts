import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';

const mocks = vi.hoisted(() => ({ getSession: vi.fn(), rpc: vi.fn(), from: vi.fn() }));
vi.mock('@supabase/supabase-js', () => ({
  createClient: () => ({
    auth: { getSession: mocks.getSession },
    rpc: mocks.rpc,
    from: mocks.from,
  }),
}));

import { fetchHelmChangedCollections, fetchHelmAccountSnapshot, getSessionUser, initSupabase } from '../store/supabase';

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

  it('reads bounded invalidation metadata and rejects a regressed or malformed checkpoint', async () => {
    const abortSignal = vi.fn().mockResolvedValue({ data: { accountVersion: 8, collections: ['tasks'], secretsChanged: true }, error: null });
    mocks.rpc.mockReturnValue({ abortSignal });
    expect(await fetchHelmChangedCollections(7)).toEqual({ accountVersion: 8, collections: ['tasks'], secretsChanged: true });
    expect(mocks.rpc).toHaveBeenCalledExactlyOnceWith('get_helm_changed_collections', { p_since_version: 7 });
    expect(abortSignal).toHaveBeenCalledWith(expect.any(AbortSignal));
    for (const data of [
      { accountVersion: 6, collections: [], secretsChanged: false },
      { accountVersion: 8, collections: [{ payload: 'invalid' }], secretsChanged: false },
      { accountVersion: 8, collections: [] },
    ]) {
      abortSignal.mockResolvedValue({ data, error: null });
      await expect(fetchHelmChangedCollections(7)).rejects.toThrow('invalid');
    }
    abortSignal.mockResolvedValue({ data: null, error: new Error('Unavailable') });
    await expect(fetchHelmChangedCollections(7)).rejects.toThrow('Unavailable');
  });

  it('rejects unrelated collections and account records from a scoped response', async () => {
    const abortSignal = vi.fn().mockResolvedValue({ data: { state, records: [{ ...record, collection: 'transactions' }] }, error: null });
    mocks.rpc.mockReturnValue({ abortSignal });
    await expect(fetchHelmAccountSnapshot(['tasks'])).rejects.toThrow('invalid record');
    abortSignal.mockResolvedValue({ data: { state, records: [{ ...record, userId: 'other-account' }] }, error: null });
    await expect(fetchHelmAccountSnapshot(['tasks'])).rejects.toThrow('invalid record');
  });
});
