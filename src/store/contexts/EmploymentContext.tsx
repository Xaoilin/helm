import {
  createContext,
  useCallback,
  useContext,
  useEffect,
  useMemo,
  useRef,
  useState,
  useSyncExternalStore,
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
  retryLoad: () => Promise<void>;
  addApplication: (draft: EmploymentApplicationDraft) => Promise<string>;
  updateApplication: (id: string, updates: Partial<EmploymentApplicationDraft>, expectedUpdatedAt?: string) => Promise<void>;
  addHistoryEntry: (
    applicationId: string,
    entry: Omit<EmploymentHistoryEntry, 'id'>,
  ) => Promise<void>;
  removeApplication: (id: string, expectedUpdatedAt?: string) => Promise<void>;
}

interface EmploymentRetryAttempt {
  requestId: string;
  id: string;
  expectedUpdatedAt?: string;
  patch?: EmploymentApplicationPatch;
}

const sessionIdentity = () => {
  const session = getSyncSessionSnapshot();
  return JSON.stringify([session.userId, session.status, session.readOnly, session.hasUsableSnapshot]);
};

export const EmploymentContext = createContext<EmploymentContextValue | null>(null);

export function useEmploymentContext(): EmploymentContextValue {
  const context = useContext(EmploymentContext);
  if (!context) throw new Error('useEmploymentContext must be used within EmploymentProvider');
  return context;
}

export function EmploymentProvider({ children }: { children: ReactNode }) {
  const sessionKey = useSyncExternalStore(subscribeSyncSession, sessionIdentity);
  const [userId, status, , hasUsableSnapshot] = JSON.parse(sessionKey) as [string | null, string, boolean, boolean];
  const readable = Boolean(userId) && (status === 'ready' || (status === 'reconnecting' && hasUsableSnapshot));
  const [state, setState] = useState<{ owner: string | null; tracker: EmploymentTrackerState }>(() => ({
    owner: null, tracker: { seedVersion: 0, applications: [] },
  }));
  const [loaded, setLoaded] = useState(false);
  const [saving, setSaving] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const stateRef = useRef(state.tracker);
  const ownerRef = useRef<string | null>(null);
  const generation = useRef(0);
  const retries = useRef(new Map<string, EmploymentRetryAttempt>());
  const mutationQueueRef = useRef<Promise<void>>(Promise.resolve());
  const pendingMutationsRef = useRef(0);
  const initialLoadRef = useRef<Promise<void> | null>(null);

  const publish = useCallback((next: EmploymentTrackerState, owner: string) => {
    stateRef.current = next;
    ownerRef.current = owner;
    setState({ owner, tracker: next });
    setError(null);
  }, []);

  const refresh = useCallback(async (allowSeed = false) => {
    const requestedSession = sessionIdentity();
    const session = getSyncSessionSnapshot();
    const request = ++generation.current;
    if (!session.userId || (session.status !== 'ready'
      && !(session.status === 'reconnecting' && session.hasUsableSnapshot))) return;
    const owner = session.userId;
    const isCurrent = () => request === generation.current && sessionIdentity() === requestedSession;
    try {
      let stored = await loadStore<EmploymentTrackerState>('employment');
      if (!isCurrent()) return;
      if (!stored && allowSeed) {
        requireWritableActor(owner);
        setError(null);
        setLoaded(false);
        await saveStoreCommitted('employment', createDefaultEmploymentTrackerState());
        if (!isCurrent()) return;
        stored = await loadStore<EmploymentTrackerState>('employment');
        if (!isCurrent()) return;
      }
      if (!stored) throw new Error('Employment tracker data is unavailable from the signed-in account.');
      publish(stored, owner);
    } catch (loadError) {
      if (isCurrent()) setError(getErrorMessage(loadError));
    } finally {
      if (isCurrent()) setLoaded(true);
    }
  }, [publish]);

  useEffect(() => {
    if (!readable || ownerRef.current !== userId) {
      const owner = readable ? userId : null;
      ownerRef.current = owner;
      stateRef.current = { seedVersion: 0, applications: [] };
      setState({ owner, tracker: stateRef.current });
      setError(null);
      retries.current.clear();
      setLoaded(false);
    }
    const initialLoad = refresh(true);
    initialLoadRef.current = initialLoad;
    void initialLoad.finally(() => {
      if (initialLoadRef.current === initialLoad) initialLoadRef.current = null;
    });
    return () => { generation.current += 1; };
  }, [sessionKey, userId, readable, refresh]);

  useRemoteStoreRefresh(['employment'], async () => {
    const requestedSession = sessionIdentity();
    // First scoped delivery also notifies subscribers. It must not supersede
    // the initial reader while that reader awaits its server-confirmed seed.
    await initialLoadRef.current;
    await mutationQueueRef.current;
    if (sessionIdentity() === requestedSession) await refresh();
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
        const latest = await loadStore<EmploymentTrackerState>('employment')
          ?? (ownerRef.current === userId ? stateRef.current : { seedVersion: 0, applications: [] });
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
        publish(confirmed, userId!);
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

  const retryAttempt = useCallback((key: string) => {
    const existing = retries.current.get(key);
    if (existing) return existing;
    const attempt: EmploymentRetryAttempt = { requestId: uuid(), id: uuid() };
    retries.current.set(key, attempt);
    return attempt;
  }, []);

  const addApplication = useCallback(async (draft: EmploymentApplicationDraft) => {
    const normalized = normalizeEmploymentApplicationDraft(draft);
    const key = JSON.stringify([getSyncSessionSnapshot().userId, 'add', normalized]);
    const attempt = retryAttempt(key);
    const result = await mutate(async () => {
      const receipt = await createEmploymentApplication(attempt.requestId, { ...normalized, id: attempt.id });
      return receipt.applicationId;
    });
    retries.current.delete(key);
    return result;
  }, [mutate, retryAttempt]);

  const updateApplication = useCallback(async (id: string, updates: Partial<EmploymentApplicationDraft>, expectedUpdatedAt?: string) => {
    const key = JSON.stringify([getSyncSessionSnapshot().userId, 'update', id, updates, expectedUpdatedAt]);
    const attempt = retryAttempt(key);
    await mutate(async current => {
      if (!attempt.patch) {
        const existing = current.applications.find(application => application.id === id);
        if (!existing) throw new Error('Employment application not found.');
        const normalized = normalizeEmploymentApplicationDraft({ ...existing, ...updates });
        attempt.patch = Object.fromEntries(
          (Object.keys(updates) as Array<keyof EmploymentApplicationDraft>)
            .map(key => [key, normalized[key] ?? null]),
        ) as EmploymentApplicationPatch;
        attempt.expectedUpdatedAt = expectedUpdatedAt ?? existing.updatedAt;
      }
      await updateEmploymentApplication(attempt.requestId, id, attempt.patch, attempt.expectedUpdatedAt!);
    });
    retries.current.delete(key);
  }, [mutate, retryAttempt]);

  const addHistoryEntry = useCallback(async (applicationId: string, entry: Omit<EmploymentHistoryEntry, 'id'>) => {
    const key = JSON.stringify([getSyncSessionSnapshot().userId, 'history', applicationId, entry]);
    const attempt = retryAttempt(key);
    const nextEntry: EmploymentHistoryEntry = { ...entry, id: attempt.id };
    await mutate(async current => {
      const existing = current.applications.find(application => application.id === applicationId);
      if (!existing) throw new Error('Employment application not found.');
      const normalized = normalizeEmploymentApplicationDraft({ ...existing, history: [nextEntry] });
      await appendEmploymentHistory(attempt.requestId, applicationId, normalized.history[0]);
    });
    retries.current.delete(key);
  }, [mutate, retryAttempt]);

  const removeApplication = useCallback(async (id: string, expectedUpdatedAt?: string) => {
    const key = JSON.stringify([getSyncSessionSnapshot().userId, 'remove', id, expectedUpdatedAt]);
    const attempt = retryAttempt(key);
    await mutate(async current => {
      if (!attempt.expectedUpdatedAt) {
        const existing = current.applications.find(application => application.id === id);
        if (!existing) throw new Error('Employment application not found.');
        attempt.expectedUpdatedAt = expectedUpdatedAt ?? existing.updatedAt;
      }
      await deleteEmploymentApplication(attempt.requestId, id, attempt.expectedUpdatedAt);
    });
    retries.current.delete(key);
  }, [mutate, retryAttempt]);

  const retryLoad = useCallback(() => refresh(true), [refresh]);

  const value = useMemo<EmploymentContextValue>(() => ({
    applications: readable && state.owner === userId ? state.tracker.applications : [],
    loaded: !readable || (state.owner === userId && loaded),
    saving,
    error: state.owner === userId && readable ? error : null,
    retryLoad,
    addApplication,
    updateApplication,
    addHistoryEntry,
    removeApplication,
  }), [
    state,
    readable,
    userId,
    loaded,
    saving,
    error,
    retryLoad,
    addApplication,
    updateApplication,
    addHistoryEntry,
    removeApplication,
  ]);

  return <EmploymentContext.Provider value={value}>{children}</EmploymentContext.Provider>;
}
