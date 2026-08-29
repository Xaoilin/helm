import { act, render, screen, waitFor } from '@testing-library/react';
import { beforeEach, describe, expect, it, vi } from 'vitest';
import { createDefaultEmploymentTrackerState } from '../services/employmentTracker';
import { EmploymentProvider, useEmploymentContext } from '../store/contexts/EmploymentContext';

type SessionSnapshot = {
  status: 'blocked' | 'ready';
  readOnly: boolean;
};

const persistenceMocks = vi.hoisted(() => ({
  getSyncSessionSnapshot: vi.fn(),
  loadStore: vi.fn(),
  saveStoreCommitted: vi.fn(),
  subscribeStoreKey: vi.fn(),
  subscribeSyncSession: vi.fn(),
}));

vi.mock('../store/persistence', () => persistenceMocks);

function EmploymentProbe() {
  const { applications, error, loaded } = useEmploymentContext();
  return <output>{`${loaded ? 'loaded' : 'loading'}|${applications.length}|${error ?? ''}`}</output>;
}

describe('EmploymentContext initialization', () => {
  const blockedSession: SessionSnapshot = { status: 'blocked', readOnly: false };
  const readySession: SessionSnapshot = { status: 'ready', readOnly: false };
  let syncListener: ((snapshot: SessionSnapshot) => void) | undefined;

  beforeEach(() => {
    vi.clearAllMocks();
    syncListener = undefined;
    persistenceMocks.getSyncSessionSnapshot.mockReturnValue(blockedSession);
    persistenceMocks.loadStore.mockResolvedValue(null);
    persistenceMocks.saveStoreCommitted.mockResolvedValue(undefined);
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
});
