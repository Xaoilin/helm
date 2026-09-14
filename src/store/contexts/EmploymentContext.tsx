import {
  createContext,
  useCallback,
  useContext,
  useEffect,
  useMemo,
  useRef,
  useState,
  type ReactNode,
} from 'react';
import { v4 as uuid } from 'uuid';
import {
  appendEmploymentHistory,
  createEmploymentApplication,
  deleteEmploymentApplication,
  updateEmploymentApplication,
  type EmploymentApplicationPatch,
} from '../../services/employmentAccount';
import {
  createDefaultEmploymentTrackerState,
  normalizeEmploymentApplicationDraft,
  type EmploymentApplicationDraft,
} from '../../services/employmentTracker';
import type {
  EmploymentApplication,
  EmploymentHistoryEntry,
  EmploymentTrackerState,
} from '../../types/domain';
import {
  getSyncSessionSnapshot,
  loadStore,
  refreshDatabasePersistence,
  saveStoreCommitted,
  subscribeSyncSession,
} from '../persistence';
import { useRemoteStoreRefresh } from './useRemoteStoreRefresh';

function getErrorMessage(error: unknown): string {
  if (error instanceof Error) return error.message;
  if (error && typeof error === 'object' && 'message' in error && typeof error.message === 'string') {
    return error.message;
  }
  return String(error);
}

function requireWritableActor(userId: string | null): void {
  const session = getSyncSessionSnapshot();
  if (!userId || session.userId !== userId) {
    throw new Error('The signed-in account changed. Reopen Employment before saving.');
  }
  if (session.status !== 'ready' || session.readOnly) {
    throw new Error(session.error || 'Employment changes require a writable signed-in database session.');
  }
}

export interface EmploymentContextValue {
  applications: EmploymentApplication[];
  loaded: boolean;
  saving: boolean;
  error: string | null;
  addApplication: (draft: EmploymentApplicationDraft) => Promise<string>;
  updateApplication: (id: string, updates: Partial<EmploymentApplicationDraft>, expectedUpdatedAt?: string) => Promise<void>;
  addHistoryEntry: (
    applicationId: string,
    entry: Omit<EmploymentHistoryEntry, 'id'>,
  ) => Promise<void>;
  removeApplication: (id: string, expectedUpdatedAt?: string) => Promise<void>;
}

const EmploymentContext = createContext<EmploymentContextValue | null>(null);

export function useEmploymentContext(): EmploymentContextValue {
  const context = useContext(EmploymentContext);
  if (!context) throw new Error('useEmploymentContext must be used within EmploymentProvider');
  return context;
}

export function EmploymentProvider({ children }: { children: ReactNode }) {
  const [state, setState] = useState<EmploymentTrackerState>(() => ({ seedVersion: 0, applications: [] }));
  const [loaded, setLoaded] = useState(false);
  const [saving, setSaving] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const stateRef = useRef(state);
  const mutationQueueRef = useRef<Promise<void>>(Promise.resolve());
  const pendingMutationsRef = useRef(0);

  const publish = useCallback((next: EmploymentTrackerState) => {
    stateRef.current = next;
    setState(next);
    setError(null);
  }, []);

  useEffect(() => {
    let active = true;
    let initializing = false;
    let retryRequested = false;
    let receivedInitialSessionSnapshot = false;
    const initialize = async () => {
      if (initializing) {
        retryRequested = true;
        return;
      }
      initializing = true;
      try {
        const stored = await loadStore<EmploymentTrackerState>('employment');
        if (stored) {
          if (active) publish(stored);
          return;
        }

        const syncSession = getSyncSessionSnapshot();
        if (syncSession.status !== 'ready' || syncSession.readOnly) {
          throw new Error('Employment will initialise when the signed-in database session is writable.');
        }
        const seeded = createDefaultEmploymentTrackerState();
        await saveStoreCommitted('employment', seeded);
        const confirmed = await loadStore<EmploymentTrackerState>('employment');
        if (!confirmed) throw new Error('The database did not return the confirmed Employment tracker seed.');
        if (active) publish(confirmed);
      } catch (loadError) {
        if (active) {
          stateRef.current = { seedVersion: 0, applications: [] };
          setState(stateRef.current);
          setError(getErrorMessage(loadError));
        }
      } finally {
        initializing = false;
        if (active) setLoaded(true);
        if (active && retryRequested && stateRef.current.seedVersion === 0) {
          retryRequested = false;
          void initialize();
        } else {
          retryRequested = false;
        }
      }
    };

    const unsubscribe = subscribeSyncSession(snapshot => {
      if (
        snapshot.status === 'ready'
        && !snapshot.readOnly
        && stateRef.current.seedVersion === 0
      ) {
        receivedInitialSessionSnapshot = true;
        void initialize();
      }
    });
    if (!receivedInitialSessionSnapshot) void initialize();
    return () => {
      active = false;
      unsubscribe();
    };
  }, [publish]);

  useRemoteStoreRefresh(['employment'], async () => {
    await mutationQueueRef.current;
    try {
      const stored = await loadStore<EmploymentTrackerState>('employment');
      if (!stored) throw new Error('Employment tracker data is unavailable from the signed-in account.');
      publish(stored);
    } catch (refreshError) {
      setError(getErrorMessage(refreshError));
    }
  });

  const mutate = useCallback(<T,>(
    commit: (current: EmploymentTrackerState) => Promise<T>,
  ): Promise<T> => {
    const userId = getSyncSessionSnapshot().userId;
    let result!: T;
    const operation = mutationQueueRef.current.then(async () => {
      pendingMutationsRef.current += 1;
      setSaving(true);
      try {
        requireWritableActor(userId);
        const latest = await loadStore<EmploymentTrackerState>('employment') ?? stateRef.current;
        requireWritableActor(userId);
        if (latest.seedVersion === 0) {
          throw new Error('Employment tracker data is unavailable until the account seed is confirmed.');
        }
        result = await commit(latest);
        requireWritableActor(userId);
        await refreshDatabasePersistence();
        requireWritableActor(userId);
        const confirmed = await loadStore<EmploymentTrackerState>('employment');
        requireWritableActor(userId);
        if (!confirmed) throw new Error('The database did not return the confirmed Employment tracker change.');
        publish(confirmed);
      } catch (mutationError) {
        if (getSyncSessionSnapshot().userId === userId) setError(getErrorMessage(mutationError));
        throw mutationError;
      } finally {
        pendingMutationsRef.current -= 1;
        if (pendingMutationsRef.current === 0) setSaving(false);
      }
    });
    mutationQueueRef.current = operation.then(() => undefined, () => undefined);
    return operation.then(() => result);
  }, [publish]);

  const addApplication = useCallback((draft: EmploymentApplicationDraft) => {
    const normalized = normalizeEmploymentApplicationDraft(draft);
    const id = uuid();
    const requestId = uuid();
    return mutate(async () => {
      const receipt = await createEmploymentApplication(requestId, { ...normalized, id });
      return receipt.applicationId;
    });
  }, [mutate]);

  const updateApplication = useCallback((id: string, updates: Partial<EmploymentApplicationDraft>, expectedUpdatedAt?: string) => {
    const requestId = uuid();
    return mutate(async current => {
      const existing = current.applications.find(application => application.id === id);
      if (!existing) throw new Error('Employment application not found.');
      const normalized = normalizeEmploymentApplicationDraft({ ...existing, ...updates });
      const patch = Object.fromEntries(
        (Object.keys(updates) as Array<keyof EmploymentApplicationDraft>)
          .map(key => [key, normalized[key] ?? null]),
      ) as EmploymentApplicationPatch;
      await updateEmploymentApplication(requestId, id, patch, expectedUpdatedAt ?? existing.updatedAt);
    });
  }, [mutate]);

  const addHistoryEntry = useCallback((applicationId: string, entry: Omit<EmploymentHistoryEntry, 'id'>) => {
    const requestId = uuid();
    const nextEntry: EmploymentHistoryEntry = { ...entry, id: uuid() };
    return mutate(async current => {
      const existing = current.applications.find(application => application.id === applicationId);
      if (!existing) throw new Error('Employment application not found.');
      const normalized = normalizeEmploymentApplicationDraft({
        ...existing,
        history: [nextEntry],
      });
      await appendEmploymentHistory(requestId, applicationId, normalized.history[0]);
    });
  }, [mutate]);

  const removeApplication = useCallback((id: string, expectedUpdatedAt?: string) => {
    const requestId = uuid();
    return mutate(async current => {
      const existing = current.applications.find(application => application.id === id);
      if (!existing) throw new Error('Employment application not found.');
      await deleteEmploymentApplication(requestId, id, expectedUpdatedAt ?? existing.updatedAt);
    });
  }, [mutate]);

  const value = useMemo<EmploymentContextValue>(() => ({
    applications: state.applications,
    loaded,
    saving,
    error,
    addApplication,
    updateApplication,
    addHistoryEntry,
    removeApplication,
  }), [
    state.applications,
    loaded,
    saving,
    error,
    addApplication,
    updateApplication,
    addHistoryEntry,
    removeApplication,
  ]);

  return <EmploymentContext.Provider value={value}>{children}</EmploymentContext.Provider>;
}
