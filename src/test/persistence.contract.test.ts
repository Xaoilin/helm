import { readFileSync } from 'node:fs';
import { resolve } from 'node:path';
import { beforeEach, describe, expect, it, vi } from 'vitest';

const supabaseMocks = vi.hoisted(() => ({
  isSupabaseReady: vi.fn(),
  isAuthenticated: vi.fn(),
  getCurrentUserId: vi.fn(),
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
  loadStore,
  resetDatabasePersistence,
  saveStoreCommitted,
} from '../store/persistence';

const USER_ID = 'user-kan-252';
const SECOND_USER_ID = 'user-kan-253-switch';
const SNAPSHOT_TIME = '2026-08-29T10:00:00.000Z';

function settingsRecord(
  payload: Record<string, unknown> = { theme: 'dark', telemetry: false },
  userId = USER_ID,
) {
  return {
    userId,
    collection: 'settings',
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
    records: [settingsRecord(payload, userId)],
  };
}

function configureSupabase({ authenticated = false } = {}) {
  supabaseMocks.isSupabaseReady.mockReturnValue(true);
  supabaseMocks.isAuthenticated.mockReturnValue(authenticated);
  supabaseMocks.getCurrentUserId.mockReturnValue(authenticated ? USER_ID : null);
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
    expect(await loadStore('settings')).toBeNull();
    await expect(saveStoreCommitted('settings', { theme: 'light' })).rejects.toThrow(
      'signed-in database session is ready',
    );
  });

  it('proves signed-in boot reads the account snapshot and commits only shared settings fields', async () => {
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
    expect(await loadStore('settings')).toEqual({ theme: 'dark', telemetry: false });

    supabaseMocks.applyHelmMutations.mockResolvedValue({
      requestId: 'request-settings-1',
      accountVersion: 8,
      changes: [settingsRecord({ theme: 'light', telemetry: true })],
    });

    await saveStoreCommitted('settings', {
      theme: 'light',
      telemetry: true,
      deepgramApiKey: 'device-secret-must-not-cross-boundary',
      supabaseUrl: 'https://device.example.test',
    });

    expect(supabaseMocks.applyHelmMutations).toHaveBeenCalledTimes(1);
    expect(supabaseMocks.applyHelmMutations.mock.calls[0][1]).toEqual([
      {
        op: 'patch',
        collection: 'settings',
        recordId: 'singleton',
        set: { theme: 'light', telemetry: true },
        unset: [],
      },
    ]);
    expect(await loadStore('settings')).toEqual({ theme: 'light', telemetry: true });
  });

  it('retries a transient write once with the same request id and operations', async () => {
    configureSupabase({ authenticated: true });
    await bootstrapDatabasePersistence();
    supabaseMocks.applyHelmMutations
      .mockRejectedValueOnce(new TypeError('network fetch failed'))
      .mockResolvedValueOnce({
        requestId: 'request-settings-retry',
        accountVersion: 8,
        changes: [settingsRecord({ theme: 'light', telemetry: false })],
      });

    await saveStoreCommitted('settings', { theme: 'light', telemetry: false });

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
        { theme: 'light', telemetry: true },
      ));

    const firstBoot = bootstrapDatabasePersistence();
    await vi.waitFor(() => expect(supabaseMocks.fetchHelmAccountSnapshot).toHaveBeenCalledTimes(1));
    supabaseMocks.getCurrentUserId.mockReturnValue(SECOND_USER_ID);
    resetDatabasePersistence('Switching Sabah One accounts.', 'switching_account');
    const secondBoot = bootstrapDatabasePersistence();
    await secondBoot;
    resolveFirstSnapshot(accountSnapshot(USER_ID, { theme: 'dark', telemetry: false }));
    await firstBoot;

    expect(getSyncSessionSnapshot()).toMatchObject({
      status: 'ready',
      userId: SECOND_USER_ID,
      accountVersion: 7,
    });
    expect(await loadStore('settings')).toEqual({ theme: 'light', telemetry: true });
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
