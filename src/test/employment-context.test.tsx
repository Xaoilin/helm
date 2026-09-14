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
  status: 'blocked' | 'ready';
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
  const readySession: SessionSnapshot = { status: 'ready', readOnly: false, userId: 'account-a' };
  let syncListener: ((snapshot: SessionSnapshot) => void) | undefined;

  beforeEach(() => {
    vi.clearAllMocks();
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

  it('exposes plain persistence error messages and retries after readiness', async () => {
    const seededState = createDefaultEmploymentTrackerState();
    persistenceMocks.loadStore
      .mockRejectedValueOnce({ message: 'Employment backend temporarily unavailable.' })
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
      persistenceMocks.getSyncSessionSnapshot.mockReturnValue(readySession);
      syncListener?.(readySession);
    });

    expect(await screen.findByText('loaded|3|')).toBeInTheDocument();
    expect(persistenceMocks.saveStoreCommitted).toHaveBeenCalledWith(
      'employment',
      expect.objectContaining({ seedVersion: 1 }),
    );
  });

  it('retries when readiness arrives while the first write is in flight', async () => {
    const seededState = createDefaultEmploymentTrackerState();
    let releaseInitialLoad: ((value: unknown) => void) | undefined;
    const pendingInitialLoad = new Promise(resolve => {
      releaseInitialLoad = resolve;
    });
    persistenceMocks.loadStore
      .mockImplementationOnce(() => pendingInitialLoad)
      .mockResolvedValueOnce(null)
      .mockResolvedValueOnce(seededState);
    persistenceMocks.saveStoreCommitted
      .mockRejectedValueOnce({ message: 'Employment first write temporarily unavailable.' })
      .mockResolvedValueOnce(undefined);

    render(
      <EmploymentProvider>
        <EmploymentProbe />
      </EmploymentProvider>,
    );
    await waitFor(() => expect(releaseInitialLoad).toBeTypeOf('function'));

    await act(async () => {
      persistenceMocks.getSyncSessionSnapshot.mockReturnValue(readySession);
      syncListener?.(readySession);
      releaseInitialLoad?.(null);
    });

    expect(await screen.findByText('loaded|3|')).toBeInTheDocument();
    expect(persistenceMocks.saveStoreCommitted).toHaveBeenCalledTimes(2);
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
    expect(context.applications).toEqual(seeded.applications);
    expect(context.error).toBeNull();
  });
});
