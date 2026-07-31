// @vitest-environment node
import { beforeEach, describe, expect, it, vi } from 'vitest';

const mocks = vi.hoisted(() => {
  const recordResult = { data: [] as unknown[], error: null as unknown };
  const stateResult = { data: null as unknown, error: null as unknown };
  const collectionResult = { data: [] as unknown[], error: null as unknown };
  const recordQuery = {
    in: vi.fn(async () => collectionResult),
    then: (resolve: (value: unknown) => unknown, reject: (error: unknown) => unknown) => (
      Promise.resolve(recordResult).then(resolve, reject)
    ),
  };
  const channel = {
    on: vi.fn(),
    subscribe: vi.fn(),
  };
  channel.on.mockReturnValue(channel);
  channel.subscribe.mockReturnValue(channel);
  const client = {
    auth: {
      getSession: vi.fn(),
      onAuthStateChange: vi.fn(),
      signInWithOAuth: vi.fn(),
      signOut: vi.fn(),
    },
    channel: vi.fn(() => channel),
    from: vi.fn((table: string) => ({
      select: vi.fn(() => ({
        eq: vi.fn(() => table === 'helm_account_state'
          ? { maybeSingle: vi.fn(async () => stateResult) }
          : recordQuery),
      })),
    })),
    realtime: { setAuth: vi.fn(async () => undefined) },
    removeChannel: vi.fn(async () => undefined),
    rpc: vi.fn(),
  };
  return {
    channel,
    client,
    collectionResult,
    recordResult,
    stateResult,
  };
});

vi.mock('@supabase/supabase-js', () => ({
  createClient: vi.fn(() => mocks.client),
}));

import {
  applyHelmMutations,
  fetchHelmAccountSnapshot,
  initSupabase,
  isSupabaseReady,
  listHelmSecrets,
  revealHelmSecret,
  saveHelmSecret,
  setHelmSecretArchived,
  setCurrentUserId,
  subscribeHelmBroadcast,
} from '../store/supabase';

const USER_ID = '11111111-1111-4111-8111-111111111111';

describe('Supabase account record API', () => {
  beforeEach(() => {
    vi.clearAllMocks();
    mocks.channel.on.mockReturnValue(mocks.channel);
    mocks.channel.subscribe.mockReturnValue(mocks.channel);
    mocks.recordResult.data = [];
    mocks.recordResult.error = null;
    mocks.stateResult.data = null;
    mocks.stateResult.error = null;
    mocks.collectionResult.data = [];
    mocks.collectionResult.error = null;
    mocks.client.rpc.mockResolvedValue({ data: null, error: null });
    initSupabase('', '');
    setCurrentUserId(null);
  });

  it('requires build-managed database configuration', () => {
    initSupabase('', '');
    expect(isSupabaseReady()).toBe(false);

    initSupabase('https://test.supabase.co', 'publishable-key');
    expect(isSupabaseReady()).toBe(true);
  });

  it('maps the authenticated account snapshot into client records', async () => {
    initSupabase('https://test.supabase.co', 'publishable-key');
    setCurrentUserId(USER_ID);
    mocks.recordResult.data = [{
      user_id: USER_ID,
      collection: 'tasks',
      record_id: 'task-1',
      payload: { id: 'task-1', title: 'Database task' },
      position: 0,
      revision: 3,
      account_version: 8,
      created_at: '2026-07-31T10:00:00.000Z',
      updated_at: '2026-07-31T11:00:00.000Z',
      deleted_at: null,
    }];
    mocks.stateResult.data = {
      user_id: USER_ID,
      schema_version: 1,
      account_version: 8,
      minimum_client_version: '0.2.82',
      migrated_at: '2026-07-31T09:00:00.000Z',
      updated_at: '2026-07-31T11:00:00.000Z',
    };

    const result = await fetchHelmAccountSnapshot();

    expect(result.state).toMatchObject({ userId: USER_ID, accountVersion: 8 });
    expect(result.records[0]).toMatchObject({
      userId: USER_ID,
      collection: 'tasks',
      recordId: 'task-1',
      revision: 3,
    });
  });

  it('calls only the constrained transactional RPC without a caller user id', async () => {
    initSupabase('https://test.supabase.co', 'publishable-key');
    setCurrentUserId(USER_ID);
    mocks.client.rpc.mockResolvedValue({
      data: { requestId: '22222222-2222-4222-8222-222222222222', accountVersion: 9, changes: [] },
      error: null,
    });
    const operations = [{
      op: 'patch' as const,
      collection: 'tasks',
      recordId: 'task-1',
      set: { completed: true },
    }];

    await applyHelmMutations('22222222-2222-4222-8222-222222222222', operations);

    expect(mocks.client.rpc).toHaveBeenCalledWith('apply_helm_mutations', {
      p_request_id: '22222222-2222-4222-8222-222222222222',
      p_operations: operations,
    });
    expect(JSON.stringify(mocks.client.rpc.mock.calls[0][1])).not.toContain('user_id');
  });

  it('lists secret metadata without requesting plaintext or a caller user id', async () => {
    initSupabase('https://test.supabase.co', 'publishable-key');
    setCurrentUserId(USER_ID);
    mocks.client.rpc.mockResolvedValue({
      data: {
        accountVersion: 10,
        secrets: [{
          secretId: '33333333-3333-4333-8333-333333333333',
          label: 'Production database',
          kind: 'database',
          environment: 'production',
          projectCatalogKeys: ['catalog:helm'],
          sourceRef: null,
          revision: 1,
          accountVersion: 10,
          createdAt: '2026-07-31T10:00:00.000Z',
          updatedAt: '2026-07-31T10:00:00.000Z',
          archivedAt: null,
        }],
      },
      error: null,
    });

    const result = await listHelmSecrets();

    expect(mocks.client.rpc).toHaveBeenCalledWith('list_helm_secrets');
    expect(result).toMatchObject({
      accountVersion: 10,
      secrets: [{ label: 'Production database', kind: 'database' }],
    });
    expect(JSON.stringify(mocks.client.rpc.mock.calls[0])).not.toContain(USER_ID);
  });

  it('reveals one value lazily and mutates secrets only through constrained RPCs', async () => {
    initSupabase('https://test.supabase.co', 'publishable-key');
    setCurrentUserId(USER_ID);
    const secretId = '33333333-3333-4333-8333-333333333333';
    mocks.client.rpc.mockResolvedValueOnce({
      data: { secretId, value: 'sensitive-test-value', username: 'postgres', url: null, notes: null },
      error: null,
    });
    const detail = await revealHelmSecret(secretId);
    expect(detail.value).toBe('sensitive-test-value');
    expect(mocks.client.rpc).toHaveBeenLastCalledWith('reveal_helm_secret', { p_secret_id: secretId });

    const summary = {
      secretId,
      label: 'Production database',
      kind: 'database',
      environment: 'production',
      projectCatalogKeys: ['catalog:helm'],
      sourceRef: null,
      revision: 2,
      accountVersion: 11,
      createdAt: '2026-07-31T10:00:00.000Z',
      updatedAt: '2026-07-31T11:00:00.000Z',
      archivedAt: null,
    };
    mocks.client.rpc.mockResolvedValueOnce({ data: summary, error: null });
    await saveHelmSecret('44444444-4444-4444-8444-444444444444', {
      secretId,
      label: 'Production database',
      kind: 'database',
      environment: 'production',
      projectCatalogKeys: ['catalog:helm', 'catalog:helm'],
      value: 'rotated-test-value',
    });
    expect(mocks.client.rpc).toHaveBeenLastCalledWith('save_helm_secret', expect.objectContaining({
      p_request_id: '44444444-4444-4444-8444-444444444444',
      p_secret_id: secretId,
      p_project_catalog_keys: ['catalog:helm'],
      p_value: 'rotated-test-value',
    }));
    expect(JSON.stringify(mocks.client.rpc.mock.calls.at(-1))).not.toContain(USER_ID);

    mocks.client.rpc.mockResolvedValueOnce({ data: { ...summary, archivedAt: '2026-07-31T12:00:00.000Z' }, error: null });
    await setHelmSecretArchived('55555555-5555-4555-8555-555555555555', secretId, true);
    expect(mocks.client.rpc).toHaveBeenLastCalledWith('set_helm_secret_archived', {
      p_request_id: '55555555-5555-4555-8555-555555555555',
      p_secret_id: secretId,
      p_archived: true,
    });
  });

  it('subscribes to a private account topic and emits identifiers only', async () => {
    initSupabase('https://test.supabase.co', 'publishable-key');
    setCurrentUserId(USER_ID);
    const listener = vi.fn();

    const unsubscribe = subscribeHelmBroadcast(listener);
    await vi.waitFor(() => expect(mocks.client.channel).toHaveBeenCalled());

    expect(mocks.client.channel).toHaveBeenCalledWith(`helm:account:${USER_ID}`, {
      config: { private: true },
    });
    const callback = mocks.channel.on.mock.calls[0][2] as (payload: unknown) => void;
    callback({
      payload: {
        requestId: '22222222-2222-4222-8222-222222222222',
        accountVersion: 9,
        changes: [{ collection: 'tasks', recordId: 'task-1', revision: 4, deletedAt: null }],
      },
    });

    expect(listener).toHaveBeenCalledWith({
      requestId: '22222222-2222-4222-8222-222222222222',
      accountVersion: 9,
      changes: [{ collection: 'tasks', recordId: 'task-1', revision: 4, deletedAt: null }],
    });
    expect(JSON.stringify(listener.mock.calls)).not.toContain('Database task');

    unsubscribe();
    expect(mocks.client.removeChannel).toHaveBeenCalledWith(mocks.channel);
  });

  it('emits secret Broadcast metadata without plaintext', async () => {
    initSupabase('https://test.supabase.co', 'publishable-key');
    setCurrentUserId(USER_ID);
    const secretListener = vi.fn();

    subscribeHelmBroadcast(vi.fn(), secretListener);
    await vi.waitFor(() => expect(mocks.channel.on).toHaveBeenCalledTimes(2));
    const secretRegistration = mocks.channel.on.mock.calls.find(call => call[1]?.event === 'helm_secrets_changed');
    const callback = secretRegistration?.[2] as (payload: unknown) => void;
    callback({
      payload: {
        requestId: '66666666-6666-4666-8666-666666666666',
        accountVersion: 12,
        secretId: '33333333-3333-4333-8333-333333333333',
        revision: 3,
        archivedAt: null,
      },
    });

    expect(secretListener).toHaveBeenCalledWith({
      requestId: '66666666-6666-4666-8666-666666666666',
      accountVersion: 12,
      secretId: '33333333-3333-4333-8333-333333333333',
      revision: 3,
      archivedAt: null,
    });
    expect(JSON.stringify(secretListener.mock.calls)).not.toContain('value');
  });
});
