import { readFileSync } from 'node:fs';
import { resolve } from 'node:path';
import { beforeEach, describe, expect, it, vi } from 'vitest';

const supabaseMocks = vi.hoisted(() => ({
  isSupabaseReady: vi.fn(),
  isAuthenticated: vi.fn(),
  getCurrentUserId: vi.fn(),
  getFreshAccessToken: vi.fn(),
  fetchHelmAccountSnapshot: vi.fn(),
  fetchHelmCollections: vi.fn(),
  probeHelmAccountVersion: vi.fn(),
  subscribeHelmBroadcast: vi.fn(),
  subscribeSupabaseRealtimeSnapshot: vi.fn(),
  getSupabaseRealtimeSnapshot: vi.fn(),
  applyHelmMutations: vi.fn(),
  applyHelmInventoryMutations: vi.fn(),
}));

vi.mock('../store/supabase', () => supabaseMocks);

import {
  bootstrapDatabasePersistence,
  getSyncSessionSnapshot,
  refreshDatabasePersistence,
  subscribeSyncSession,
  loadStore,
  resetDatabasePersistence,
  saveStoreCommitted,
  loadDeviceStore,
  saveDeviceStore,
  DEVICE_SETTINGS_STORE_KEY,
} from '../store/persistence';

const USER_ID = 'user-kan-252';
const SECOND_USER_ID = 'user-kan-253-switch';
const SNAPSHOT_TIME = '2026-08-29T10:00:00.000Z';

// Employment is a real singleton account collection; settings moved to the profile service.
function employmentRecord(
  payload: Record<string, unknown> = { stage: 'searching', remote: false },
  userId = USER_ID,
) {
  return {
    userId,
    collection: 'employment',
    recordId: 'singleton',
    payload,
    position: null,
    revision: 1,
    accountVersion: 7,
    createdAt: SNAPSHOT_TIME,
    updatedAt: SNAPSHOT_TIME,
    deletedAt: null,
  };
}

function accountSnapshot(userId = USER_ID, payload?: Record<string, unknown>) {
  return {
    state: {
      userId,
      schemaVersion: 1,
      accountVersion: 7,
      minimumClientVersion: '0.2.0',
      migratedAt: SNAPSHOT_TIME,
      updatedAt: SNAPSHOT_TIME,
    },
    records: [employmentRecord(payload, userId)],
  };
}

function configureSupabase({ authenticated = false } = {}) {
  supabaseMocks.isSupabaseReady.mockReturnValue(true);
  supabaseMocks.isAuthenticated.mockReturnValue(authenticated);
  supabaseMocks.getCurrentUserId.mockReturnValue(authenticated ? USER_ID : null);
  supabaseMocks.getFreshAccessToken.mockResolvedValue(authenticated ? 'renewed-token' : null);
  supabaseMocks.getSupabaseRealtimeSnapshot.mockReturnValue({
    state: 'subscribed',
    lastEventAt: null,
    lastStatusAt: SNAPSHOT_TIME,
    lastError: null,
  });
  supabaseMocks.subscribeSupabaseRealtimeSnapshot.mockReturnValue(() => undefined);
  supabaseMocks.subscribeHelmBroadcast.mockReturnValue(() => undefined);
  supabaseMocks.fetchHelmAccountSnapshot.mockResolvedValue(accountSnapshot());
  supabaseMocks.probeHelmAccountVersion.mockResolvedValue(7);
}

describe('signed-in persistence boundaries', () => {
  beforeEach(() => {
    vi.clearAllMocks();
    vi.useFakeTimers();
    vi.setSystemTime(new Date(SNAPSHOT_TIME));
    configureSupabase();
    resetDatabasePersistence();
  });

  it('keeps HTTPS reads and confirmed writes usable without Realtime, then reconciles missed changes', async () => {
    configureSupabase({ authenticated: true });
    supabaseMocks.getSupabaseRealtimeSnapshot.mockReturnValue({ state: 'error', lastError: 'WebSocket unavailable' });
    const boot = bootstrapDatabasePersistence();
    await vi.advanceTimersByTimeAsync(10_000);
    await boot;
    expect(getSyncSessionSnapshot()).toMatchObject({ status: 'ready', readOnly: false });
    expect(await loadStore('employment')).toMatchObject({ stage: 'searching' });
    supabaseMocks.applyHelmMutations.mockResolvedValue({
      requestId: 'confirmed', accountVersion: 8,
      changes: [{ ...employmentRecord({ stage: 'interviewing', remote: false }), accountVersion: 8, revision: 2 }],
    });
    await saveStoreCommitted('employment', { stage: 'interviewing', remote: false });
    expect(supabaseMocks.applyHelmMutations).toHaveBeenCalledTimes(1);
    expect(await loadStore('employment')).toMatchObject({ stage: 'interviewing' });

    const missed = accountSnapshot(USER_ID, { stage: 'searching', remote: true });
    missed.state.accountVersion = 9;
    supabaseMocks.fetchHelmAccountSnapshot.mockResolvedValue(missed);
    supabaseMocks.probeHelmAccountVersion.mockResolvedValue(9);
    await vi.advanceTimersByTimeAsync(10 * 60_000);
    expect(await loadStore('employment')).toMatchObject({ remote: true });
    expect(getSyncSessionSnapshot()).toMatchObject({ status: 'ready', readOnly: false, accountVersion: 9 });
  });

  it('retains same-account data on transient HTTPS failure and on an expired token the session can renew', async () => {
    configureSupabase({ authenticated: true });
    await bootstrapDatabasePersistence();
    supabaseMocks.fetchHelmAccountSnapshot.mockRejectedValueOnce(new TypeError('Failed to fetch'));
    await refreshDatabasePersistence();
    expect(getSyncSessionSnapshot()).toMatchObject({ status: 'reconnecting', readOnly: true, hasUsableSnapshot: true });
    expect(await loadStore('employment')).toMatchObject({ stage: 'searching' });
    await refreshDatabasePersistence();
    expect(getSyncSessionSnapshot()).toMatchObject({ status: 'ready', readOnly: false });

    // A token that expired while the tab slept is renewed; the user is not signed out.
    supabaseMocks.fetchHelmAccountSnapshot.mockRejectedValueOnce({ code: 'PGRST301', message: 'JWT expired' });
    await refreshDatabasePersistence();
    await vi.waitFor(() => expect(getSyncSessionSnapshot()).toMatchObject({
      status: 'reconnecting', userId: USER_ID, hasUsableSnapshot: true,
    }));
    expect(supabaseMocks.getFreshAccessToken).toHaveBeenCalledWith({ forceRefresh: true });
    expect(await loadStore('employment')).toMatchObject({ stage: 'searching' });
    await refreshDatabasePersistence();
    expect(getSyncSessionSnapshot()).toMatchObject({ status: 'ready', readOnly: false });
  });

  it('clears account data only when the session can no longer be renewed', async () => {
    configureSupabase({ authenticated: true });
    await bootstrapDatabasePersistence();
    supabaseMocks.getFreshAccessToken.mockResolvedValueOnce(null);
    supabaseMocks.fetchHelmAccountSnapshot.mockRejectedValueOnce({ code: '42501', status: 403, message: 'Anonymous' });
    await refreshDatabasePersistence();
    await vi.waitFor(() => expect(getSyncSessionSnapshot()).toMatchObject({
      status: 'blocked', hasUsableSnapshot: false, reason: 'signed_out',
    }));
    expect(await loadStore('employment')).toBeNull();
  });

  it('ignores late failures from an old account and fails closed on incompatible schemas', async () => {
    configureSupabase({ authenticated: true });
    let rejectFirst!: (error: Error) => void;
    supabaseMocks.fetchHelmAccountSnapshot.mockImplementationOnce(() => new Promise((_, reject) => { rejectFirst = reject; }));
    const firstBoot = bootstrapDatabasePersistence();
    supabaseMocks.getCurrentUserId.mockReturnValue(SECOND_USER_ID);
    supabaseMocks.fetchHelmAccountSnapshot.mockResolvedValue(accountSnapshot(SECOND_USER_ID));
    await bootstrapDatabasePersistence();
    rejectFirst(new Error('Old account fetch failed'));
    await firstBoot;
    expect(getSyncSessionSnapshot()).toMatchObject({ status: 'ready', userId: SECOND_USER_ID });
    const incompatible = accountSnapshot(SECOND_USER_ID);
    incompatible.state.schemaVersion = 999;
    supabaseMocks.fetchHelmAccountSnapshot.mockResolvedValue(incompatible);
    await refreshDatabasePersistence();
    expect(getSyncSessionSnapshot()).toMatchObject({ status: 'blocked', reason: 'incompatible_schema', hasUsableSnapshot: false });
    expect(await loadStore('employment')).toBeNull();
  });

  it('keeps a denied domain write local when authenticated account reads still succeed', async () => {
    configureSupabase({ authenticated: true });
    await bootstrapDatabasePersistence();
    const statuses: string[] = [];
    const unsubscribe = subscribeSyncSession(snapshot => statuses.push(snapshot.status));
    supabaseMocks.applyHelmMutations.mockRejectedValueOnce({ code: '42501', status: 403, message: 'Domain permission denied' });
    await expect(saveStoreCommitted('employment', { stage: 'interviewing', remote: false })).rejects.toThrow();
    unsubscribe();
    expect(supabaseMocks.applyHelmMutations).toHaveBeenCalledTimes(1);
    expect(statuses.every(status => status === 'ready')).toBe(true);
    expect(getSyncSessionSnapshot()).toMatchObject({ status: 'ready', userId: USER_ID, readOnly: false });
    expect(await loadStore('employment')).toMatchObject({ stage: 'searching' });
  });

  it('proves boot and shared reads fail closed without an authenticated account', async () => {
    await bootstrapDatabasePersistence();

    expect(getSyncSessionSnapshot()).toMatchObject({
      status: 'blocked',
      userId: null,
      hasUsableSnapshot: false,
      readOnly: true,
      reason: 'signed_out',
    });
    expect(supabaseMocks.fetchHelmAccountSnapshot).not.toHaveBeenCalled();
    expect(await loadStore('employment')).toBeNull();
    await expect(saveStoreCommitted('employment', { stage: 'interviewing' })).rejects.toThrow(
      'signed-in database session is ready',
    );
  });

  it('proves signed-in boot reads the account snapshot and commits a singleton collection as one patch', async () => {
    configureSupabase({ authenticated: true });
    await bootstrapDatabasePersistence();

    expect(getSyncSessionSnapshot()).toMatchObject({
      status: 'ready',
      userId: USER_ID,
      accountVersion: 7,
      hasUsableSnapshot: true,
      readOnly: false,
      reason: null,
    });
    expect(await loadStore('employment')).toEqual({ stage: 'searching', remote: false });

    supabaseMocks.applyHelmMutations.mockResolvedValue({
      requestId: 'request-employment-1',
      accountVersion: 8,
      changes: [employmentRecord({ stage: 'interviewing', remote: true })],
    });

    await saveStoreCommitted('employment', { stage: 'interviewing', remote: true });

    expect(supabaseMocks.applyHelmMutations).toHaveBeenCalledTimes(1);
    expect(supabaseMocks.applyHelmMutations.mock.calls[0][1]).toEqual([
      {
        op: 'patch',
        collection: 'employment',
        recordId: 'singleton',
        set: { stage: 'interviewing', remote: true },
        unset: [],
      },
    ]);
    expect(await loadStore('employment')).toEqual({ stage: 'interviewing', remote: true });
  });

  it('never reads or writes settings or integrations in the account record: the profile service owns them', async () => {
    configureSupabase({ authenticated: true });
    await bootstrapDatabasePersistence();

    for (const retired of ['settings', 'integrations']) {
      await expect(loadStore(retired)).rejects.toThrow(`${retired} is retired`);
      await expect(saveStoreCommitted(retired, { theme: 'light' })).rejects.toThrow(`${retired} is retired`);
    }
    expect(supabaseMocks.applyHelmMutations).not.toHaveBeenCalled();
  });

  it('keeps the original legacy settings migration source without copying provider values into new browser records', async () => {
    configureSupabase({ authenticated: true });
    const original = JSON.stringify({ theme: 'dark', telemetry: false, microphoneDeviceId: 'mic-legacy', elevenLabsApiKey: 'legacy-eleven', monzoAccessToken: 'legacy-monzo', unknownLegacyField: 'preserve' });
    localStorage.setItem('helm:settings', original);
    await bootstrapDatabasePersistence();
    expect(getSyncSessionSnapshot().status).toBe('ready');
    expect(localStorage.getItem('helm:settings')).toBe(original);
    expect(await loadDeviceStore(DEVICE_SETTINGS_STORE_KEY)).toMatchObject({ elevenLabsApiKey: 'legacy-eleven', microphoneDeviceId: 'mic-legacy' });
    expect(JSON.parse(localStorage.getItem('helm:device:deviceSettings:v2')!)).toEqual({ microphoneDeviceId: 'mic-legacy' });
    expect(Object.keys(localStorage).filter(key => key.includes('legacy-quarantine'))).toEqual([]);
  });

  it('never migrates legacy browser settings into the account record and keeps the Secrets migration source', async () => {
    configureSupabase({ authenticated: true });
    const original = JSON.stringify({ dataRetentionDays: 30, elevenLabsApiKey: 'legacy-eleven' });
    localStorage.setItem('helm:settings', original);
    await bootstrapDatabasePersistence();
    resetDatabasePersistence();
    await bootstrapDatabasePersistence();

    expect(getSyncSessionSnapshot().status).toBe('ready');
    expect(supabaseMocks.applyHelmMutations).not.toHaveBeenCalled();
    expect(localStorage.getItem('helm:settings')).toBe(original);
    expect(localStorage.getItem('helm:meta:settings')).toBeNull();
    expect(await loadDeviceStore(DEVICE_SETTINGS_STORE_KEY)).toMatchObject({ elevenLabsApiKey: 'legacy-eleven' });
  });

  it('does not restore cleared device preferences from v1 or retained shared legacy settings on rebootstrap', async () => {
    configureSupabase({ authenticated: true });
    const original = JSON.stringify({ microphoneDeviceId: 'old-mic', ollamaEndpoint: 'http://old-host:11434', elevenLabsApiKey: 'legacy-eleven' });
    localStorage.setItem('helm:device:deviceSettings', original);
    localStorage.setItem('helm:settings', original);
    await bootstrapDatabasePersistence();
    expect(await loadDeviceStore(DEVICE_SETTINGS_STORE_KEY)).toMatchObject({ microphoneDeviceId: 'old-mic' });
    await saveDeviceStore(DEVICE_SETTINGS_STORE_KEY, {});
    resetDatabasePersistence();
    await bootstrapDatabasePersistence();
    expect(await loadDeviceStore(DEVICE_SETTINGS_STORE_KEY)).toEqual({ elevenLabsApiKey: 'legacy-eleven' });
    expect(localStorage.getItem('helm:device:deviceSettings')).toBe(original);
    expect(localStorage.getItem('helm:settings')).toBe(original);
  });

  it('keeps shared migration retryable when its database commit fails', async () => {
    configureSupabase({ authenticated: true });
    const original = JSON.stringify({ stage: 'applying', remote: true });
    localStorage.setItem('helm:employment', original);
    supabaseMocks.fetchHelmAccountSnapshot.mockResolvedValue({ ...accountSnapshot(), records: [] });
    supabaseMocks.applyHelmMutations.mockRejectedValueOnce(new Error('permission denied'));
    await bootstrapDatabasePersistence();
    expect(localStorage.getItem('helm:meta:employment')).toBeNull();
    expect(localStorage.getItem('helm:employment')).toBe(original);
    expect(getSyncSessionSnapshot().status).not.toBe('ready');

    resetDatabasePersistence();
    const migrated = { stage: 'applying', remote: true };
    supabaseMocks.applyHelmMutations.mockResolvedValue({ requestId: 'migration-retry', accountVersion: 8, changes: [employmentRecord(migrated)] });
    await bootstrapDatabasePersistence();
    expect(getSyncSessionSnapshot().status).toBe('ready');
    expect(await loadStore('employment')).toEqual(migrated);
    expect(supabaseMocks.applyHelmMutations).toHaveBeenCalledTimes(2);
    expect(supabaseMocks.applyHelmMutations.mock.calls[1][1]).toEqual(supabaseMocks.applyHelmMutations.mock.calls[0][1]);
    expect(localStorage.getItem('helm:employment')).toBeNull();
  });

  it('retries a transient write once with the same request id and operations', async () => {
    configureSupabase({ authenticated: true });
    await bootstrapDatabasePersistence();
    supabaseMocks.applyHelmMutations
      .mockRejectedValueOnce(new TypeError('network fetch failed'))
      .mockResolvedValueOnce({
        requestId: 'request-employment-retry',
        accountVersion: 8,
        changes: [employmentRecord({ stage: 'interviewing', remote: false })],
      });

    await saveStoreCommitted('employment', { stage: 'interviewing', remote: false });

    expect(supabaseMocks.applyHelmMutations).toHaveBeenCalledTimes(2);
    expect(supabaseMocks.applyHelmMutations.mock.calls[1]).toEqual(
      supabaseMocks.applyHelmMutations.mock.calls[0],
    );
  });

  it('rejects an old hydration epoch after an account switch', async () => {
    configureSupabase({ authenticated: true });
    let resolveFirstSnapshot!: (value: ReturnType<typeof accountSnapshot>) => void;
    supabaseMocks.fetchHelmAccountSnapshot
      .mockImplementationOnce(() => new Promise(resolve => { resolveFirstSnapshot = resolve; }))
      .mockResolvedValueOnce(accountSnapshot(
        SECOND_USER_ID,
        { stage: 'interviewing', remote: true },
      ));

    const firstBoot = bootstrapDatabasePersistence();
    await vi.waitFor(() => expect(supabaseMocks.fetchHelmAccountSnapshot).toHaveBeenCalledTimes(1));
    supabaseMocks.getCurrentUserId.mockReturnValue(SECOND_USER_ID);
    resetDatabasePersistence('Switching Sabah One accounts.', 'switching_account');
    const secondBoot = bootstrapDatabasePersistence();
    await secondBoot;
    resolveFirstSnapshot(accountSnapshot(USER_ID, { stage: 'searching', remote: false }));
    await firstBoot;

    expect(getSyncSessionSnapshot()).toMatchObject({
      status: 'ready',
      userId: SECOND_USER_ID,
      accountVersion: 7,
    });
    expect(await loadStore('employment')).toEqual({ stage: 'interviewing', remote: true });
  });

  it('proves the app and database contracts keep shared data account-owned', () => {
    const root = resolve(__dirname, '../..');
    const appRoot = readFileSync(resolve(root, 'src/AppRoot.tsx'), 'utf8');
    const migration = readFileSync(
      resolve(root, 'supabase/migrations/20260731142920_helm_database_authoritative_persistence.sql'),
      'utf8',
    );

    expect(appRoot).toContain('resetDatabasePersistence');
    expect(appRoot).toContain('Shared data is never opened from a device fallback.');
    expect(migration).toContain('constraint helm_records_pkey primary key (user_id, collection, record_id)');
    expect(migration).toContain('using ((select auth.uid()) = user_id);');
  });

});
