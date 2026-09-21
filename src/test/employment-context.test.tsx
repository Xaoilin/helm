import { act, render, screen, waitFor } from '@testing-library/react';
import { useEffect } from 'react';
import { beforeEach, describe, expect, it, vi } from 'vitest';
import { createDefaultEmploymentTrackerState } from '../services/employmentTracker';
import {
  EmploymentProvider,
  useEmploymentContext,
  type EmploymentContextValue,
} from '../store/contexts/EmploymentContext';

type SessionSnapshot = {
  status: 'blocked' | 'ready' | 'reconnecting';
  hasUsableSnapshot?: boolean;
  readOnly: boolean;
  userId: string | null;
};

const persistenceMocks = vi.hoisted(() => ({
  getSyncSessionSnapshot: vi.fn(),
  loadStore: vi.fn(),
  refreshDatabasePersistence: vi.fn(),
  saveStoreCommitted: vi.fn(),
  subscribeStoreKey: vi.fn(),
  subscribeSyncSession: vi.fn(),
}));
const databaseMocks = vi.hoisted(() => ({ rpc: vi.fn() }));

vi.mock('../store/persistence', () => persistenceMocks);
vi.mock('../store/supabase', () => ({ getClient: () => databaseMocks }));

let context: EmploymentContextValue;

function EmploymentProbe() {
  const current = useEmploymentContext();
  useEffect(() => { context = current; }, [current]);
  const { applications, error, loaded } = current;
  return <output>{`${loaded ? 'loaded' : 'loading'}|${applications.length}|${error ?? ''}`}</output>;
}

describe('EmploymentContext', () => {
  const blockedSession: SessionSnapshot = { status: 'blocked', readOnly: false, userId: null };
  const readySession: SessionSnapshot = { status: 'ready', readOnly: false, userId: 'account-a', hasUsableSnapshot: true };
  let syncListener: ((snapshot: SessionSnapshot) => void) | undefined;

  beforeEach(() => {
    vi.resetAllMocks();
    syncListener = undefined;
    persistenceMocks.getSyncSessionSnapshot.mockReturnValue(blockedSession);
    persistenceMocks.loadStore.mockResolvedValue(null);
    persistenceMocks.saveStoreCommitted.mockResolvedValue(undefined);
    persistenceMocks.refreshDatabasePersistence.mockResolvedValue(undefined);
    databaseMocks.rpc.mockResolvedValue({ data: { applicationId: 'confirmed-id' }, error: null });
    persistenceMocks.subscribeStoreKey.mockReturnValue(() => undefined);
    persistenceMocks.subscribeSyncSession.mockImplementation((listener: (snapshot: SessionSnapshot) => void) => {
      syncListener = listener;
      listener(blockedSession);
      return () => undefined;
    });
  });

  it('reads the retained Employment snapshot on first mount during recovery without seeding', async () => {
    const seeded = createDefaultEmploymentTrackerState();
    persistenceMocks.getSyncSessionSnapshot.mockReturnValue({ ...readySession, status: 'reconnecting', readOnly: true });
    persistenceMocks.loadStore.mockResolvedValue(seeded);
    render(<EmploymentProvider><EmploymentProbe /></EmploymentProvider>);
    await screen.findByText('loaded|3|');
    expect(context.applications).toEqual(seeded.applications);
    expect(persistenceMocks.saveStoreCommitted).not.toHaveBeenCalled();
    await act(async () => {
      await expect(context.addApplication(seeded.applications[0])).rejects.toThrow('writable signed-in');
    });
    expect(databaseMocks.rpc).not.toHaveBeenCalled();
  });

  it('retries a failed initial seed explicitly while the account stays ready', async () => {
    const seeded = createDefaultEmploymentTrackerState();
    persistenceMocks.getSyncSessionSnapshot.mockReturnValue(readySession);
    persistenceMocks.loadStore.mockResolvedValueOnce(null).mockResolvedValueOnce(null).mockResolvedValueOnce(seeded);
    persistenceMocks.saveStoreCommitted.mockRejectedValueOnce(new Error('Employment seed unavailable'));
    render(<EmploymentProvider><EmploymentProbe /></EmploymentProvider>);
    await screen.findByText('loaded|0|Employment seed unavailable');
    expect(persistenceMocks.saveStoreCommitted).toHaveBeenCalledTimes(1);
    await act(async () => { await context.retryLoad(); });
    expect(context.applications).toEqual(seeded.applications);
    expect(context.error).toBeNull();
    expect(persistenceMocks.saveStoreCommitted).toHaveBeenCalledTimes(2);
  });

  it('exposes plain persistence error messages and retries after readiness', async () => {
    const seededState = createDefaultEmploymentTrackerState();
    persistenceMocks.getSyncSessionSnapshot.mockReturnValue(readySession);
    persistenceMocks.loadStore
      .mockRejectedValueOnce({ message: 'Employment backend temporarily unavailable.' })
      .mockResolvedValueOnce(null)
      .mockResolvedValueOnce(null)
      .mockResolvedValueOnce(seededState);

    render(
      <EmploymentProvider>
        <EmploymentProbe />
      </EmploymentProvider>,
    );

    expect(
      await screen.findByText('loaded|0|Employment backend temporarily unavailable.'),
    ).toBeInTheDocument();

    await act(async () => {
      const reconnecting = { ...readySession, status: 'reconnecting' as const };
      persistenceMocks.getSyncSessionSnapshot.mockReturnValue(reconnecting);
      syncListener?.(reconnecting);
    });
    await act(async () => {
      persistenceMocks.getSyncSessionSnapshot.mockReturnValue(readySession);
      syncListener?.(readySession);
    });

    expect(await screen.findByText('loaded|3|')).toBeInTheDocument();
    expect(persistenceMocks.saveStoreCommitted).toHaveBeenCalledWith(
      'employment',
      expect.objectContaining({ seedVersion: 1 }),
    );
  });

  it('discards a delayed prior-account initialization without seeding the new account', async () => {
    const seeded = createDefaultEmploymentTrackerState();
    let releaseInitialLoad!: (value: unknown) => void;
    persistenceMocks.getSyncSessionSnapshot.mockReturnValue(readySession);
    persistenceMocks.loadStore.mockReturnValueOnce(new Promise(resolve => { releaseInitialLoad = resolve; }))
      .mockResolvedValue({ seedVersion: 1, applications: [] });
    render(<EmploymentProvider><EmploymentProbe /></EmploymentProvider>);
    await waitFor(() => expect(releaseInitialLoad).toBeTypeOf('function'));
    await act(async () => {
      const next = { ...readySession, userId: 'account-b' };
      persistenceMocks.getSyncSessionSnapshot.mockReturnValue(next);
      syncListener?.(next);
    });
    await act(async () => { releaseInitialLoad(seeded); });
    expect(context.applications).toEqual([]);
    expect(persistenceMocks.saveStoreCommitted).not.toHaveBeenCalled();
  });

  it('retains confirmed applications after transient refresh failures and clears on invalid authentication', async () => {
    const seeded = createDefaultEmploymentTrackerState();
    let refresh!: () => void;
    persistenceMocks.subscribeStoreKey.mockImplementation((_key, listener) => { refresh = listener; return () => {}; });
    persistenceMocks.getSyncSessionSnapshot.mockReturnValue(readySession);
    persistenceMocks.loadStore.mockResolvedValue(seeded);
    render(<EmploymentProvider><EmploymentProbe /></EmploymentProvider>);
    await screen.findByText('loaded|3|');
    persistenceMocks.loadStore.mockRejectedValueOnce(new Error('Employment unavailable'));
    await act(async () => { refresh(); });
    expect(context.applications).toEqual(seeded.applications);
    expect(context.error).toBe('Employment unavailable');
    await act(async () => {
      const next = { ...readySession, status: 'reconnecting' as const, readOnly: true };
      persistenceMocks.getSyncSessionSnapshot.mockReturnValue(next);
      syncListener?.(next);
    });
    expect(context.applications).toEqual(seeded.applications);
    await act(async () => {
      const next = { ...readySession, status: 'blocked' as const, hasUsableSnapshot: false };
      persistenceMocks.getSyncSessionSnapshot.mockReturnValue(next);
      syncListener?.(next);
    });
    expect(context.applications).toEqual([]);
  });

  it('updates only the intended job fields and retains a concurrently agent-added job on database readback', async () => {
    const seeded = createDefaultEmploymentTrackerState();
    const existing = seeded.applications[0];
    const serverState = {
      ...seeded,
      applications: [
        { ...existing, notes: 'Updated note', updatedAt: '2026-09-14T10:00:00.000Z' },
        ...seeded.applications.slice(1),
        { ...existing, id: 'agent-added-micro1', company: 'micro1' },
      ],
    };
    persistenceMocks.getSyncSessionSnapshot.mockReturnValue(readySession);
    persistenceMocks.loadStore.mockResolvedValue(seeded);
    persistenceMocks.refreshDatabasePersistence.mockImplementation(async () => {
      persistenceMocks.loadStore.mockResolvedValue(serverState);
    });
    render(<EmploymentProvider><EmploymentProbe /></EmploymentProvider>);
    await screen.findByText('loaded|3|');

    await act(async () => {
      await context.updateApplication(existing.id, { notes: ' Updated note ', url: undefined });
    });

    expect(databaseMocks.rpc).toHaveBeenCalledWith('employment_update_application', {
      p_request_id: expect.any(String),
      p_application_id: existing.id,
      p_patch: { notes: 'Updated note', url: null },
      p_expected_updated_at: existing.updatedAt,
    });
    expect(persistenceMocks.saveStoreCommitted).not.toHaveBeenCalled();
    expect(persistenceMocks.refreshDatabasePersistence).toHaveBeenCalledOnce();
    expect(context.applications).toEqual(serverState.applications);
    expect(screen.getByText('loaded|4|')).toBeInTheDocument();
  });

  it('rejects a mutation while the account is read-only before contacting the database', async () => {
    const seeded = createDefaultEmploymentTrackerState();
    persistenceMocks.getSyncSessionSnapshot.mockReturnValue({ ...readySession, readOnly: true });
    persistenceMocks.loadStore.mockResolvedValue(seeded);
    render(<EmploymentProvider><EmploymentProbe /></EmploymentProvider>);
    await screen.findByText('loaded|3|');

    await act(async () => {
      await expect(context.removeApplication(seeded.applications[0].id)).rejects.toThrow('writable signed-in');
    });

    expect(databaseMocks.rpc).not.toHaveBeenCalled();
    expect(persistenceMocks.refreshDatabasePersistence).not.toHaveBeenCalled();
    expect(context.applications).toEqual(seeded.applications);
  });

  it('retains the editor original version after the cached job has changed and surfaces the conflict', async () => {
    const seeded = createDefaultEmploymentTrackerState();
    const original = seeded.applications[0];
    persistenceMocks.getSyncSessionSnapshot.mockReturnValue(readySession);
    persistenceMocks.loadStore.mockResolvedValue(seeded);
    render(<EmploymentProvider><EmploymentProbe /></EmploymentProvider>);
    await screen.findByText('loaded|3|');
    persistenceMocks.loadStore.mockResolvedValue({
      ...seeded,
      applications: [{ ...original, status: 'interview', updatedAt: '2026-09-14T10:00:00.000Z' }],
    });
    databaseMocks.rpc.mockResolvedValue({
      data: null,
      error: { message: 'Employment application changed; reload before saving.' },
    });

    await act(async () => {
      await expect(context.updateApplication(original.id, { notes: 'Old editor note' }, original.updatedAt))
        .rejects.toMatchObject({ message: 'Employment application changed; reload before saving.' });
    });

    expect(databaseMocks.rpc).toHaveBeenCalledWith('employment_update_application', expect.objectContaining({
      p_expected_updated_at: original.updatedAt,
    }));
    expect(context.error).toBe('Employment application changed; reload before saving.');
    expect(persistenceMocks.refreshDatabasePersistence).not.toHaveBeenCalled();
  });

  it('reuses create and history request identities after uncertain acknowledgements', async () => {
    const seeded = createDefaultEmploymentTrackerState();
    persistenceMocks.getSyncSessionSnapshot.mockReturnValue(readySession);
    persistenceMocks.loadStore.mockResolvedValue(seeded);
    render(<EmploymentProvider><EmploymentProbe /></EmploymentProvider>);
    await screen.findByText('loaded|3|');
    databaseMocks.rpc.mockRejectedValueOnce(new Error('Connection lost'));
    const draft = seeded.applications[0];
    await act(async () => { await expect(context.addApplication(draft)).rejects.toThrow('Connection lost'); });
    const createArgs = databaseMocks.rpc.mock.calls[0];
    await act(async () => { await context.addApplication(draft); });
    expect(databaseMocks.rpc.mock.calls[1]).toEqual(createArgs);
    const entry = { date: '2026-09-21', kind: 'note', summary: 'Follow up', details: '' } as const;
    persistenceMocks.refreshDatabasePersistence.mockRejectedValueOnce(new Error('Readback unavailable'));
    await act(async () => { await expect(context.addHistoryEntry(draft.id, entry)).rejects.toThrow('Readback unavailable'); });
    const historyArgs = databaseMocks.rpc.mock.calls[2];
    await act(async () => { await context.addHistoryEntry(draft.id, entry); });
    expect(databaseMocks.rpc.mock.calls[3]).toEqual(historyArgs);
  });

  it('does not publish a completed mutation after the signed-in account changes', async () => {
    const seeded = createDefaultEmploymentTrackerState();
    persistenceMocks.getSyncSessionSnapshot.mockReturnValue(readySession);
    persistenceMocks.loadStore.mockResolvedValue(seeded);
    persistenceMocks.refreshDatabasePersistence.mockImplementation(async () => {
      persistenceMocks.getSyncSessionSnapshot.mockReturnValue({ ...readySession, userId: 'account-b' });
      persistenceMocks.loadStore.mockResolvedValue({ seedVersion: 1, applications: [] });
    });
    render(<EmploymentProvider><EmploymentProbe /></EmploymentProvider>);
    await screen.findByText('loaded|3|');

    await act(async () => {
      await expect(context.updateApplication(seeded.applications[0].id, { notes: 'A note' }))
        .rejects.toThrow('signed-in account changed');
    });

    expect(databaseMocks.rpc).toHaveBeenCalledOnce();
    expect(context.applications).toEqual([]);
    expect(context.error).toBeNull();
  });
});
