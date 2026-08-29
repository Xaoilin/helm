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
  saveStoreCommitted,
  subscribeSyncSession,
} from '../persistence';
import { useRemoteStoreRefresh } from './useRemoteStoreRefresh';

export interface EmploymentContextValue {
  applications: EmploymentApplication[];
  loaded: boolean;
  saving: boolean;
  error: string | null;
  addApplication: (draft: EmploymentApplicationDraft) => Promise<string>;
  updateApplication: (id: string, updates: Partial<EmploymentApplicationDraft>) => Promise<void>;
  addHistoryEntry: (
    applicationId: string,
    entry: Omit<EmploymentHistoryEntry, 'id'>,
  ) => Promise<void>;
  removeApplication: (id: string) => Promise<void>;
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
    const initialize = async () => {
      if (initializing) return;
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
          setError(loadError instanceof Error ? loadError.message : String(loadError));
        }
      } finally {
        initializing = false;
        if (active) setLoaded(true);
      }
    };

    void initialize();
    const unsubscribe = subscribeSyncSession(snapshot => {
      if (
        snapshot.status === 'ready'
        && !snapshot.readOnly
        && stateRef.current.seedVersion === 0
      ) {
        void initialize();
      }
    });
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
      setError(refreshError instanceof Error ? refreshError.message : String(refreshError));
    }
  });

  const mutate = useCallback(<T,>(
    transform: (current: EmploymentTrackerState) => { next: EmploymentTrackerState; result: T },
  ): Promise<T> => {
    let result!: T;
    const operation = mutationQueueRef.current.then(async () => {
      pendingMutationsRef.current += 1;
      setSaving(true);
      try {
        const latest = await loadStore<EmploymentTrackerState>('employment') ?? stateRef.current;
        if (latest.seedVersion === 0) {
          throw new Error('Employment tracker data is unavailable until the account seed is confirmed.');
        }
        const transformed = transform(latest);
        result = transformed.result;
        await saveStoreCommitted('employment', transformed.next);
        const confirmed = await loadStore<EmploymentTrackerState>('employment');
        if (!confirmed) throw new Error('The database did not return the confirmed Employment tracker change.');
        publish(confirmed);
      } catch (mutationError) {
        setError(mutationError instanceof Error ? mutationError.message : String(mutationError));
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
    return mutate(current => {
      const now = new Date().toISOString();
      return {
        next: {
          ...current,
          applications: [...current.applications, { ...normalized, id, createdAt: now, updatedAt: now }],
        },
        result: id,
      };
    });
  }, [mutate]);

  const updateApplication = useCallback((id: string, updates: Partial<EmploymentApplicationDraft>) => (
    mutate(current => {
      const existing = current.applications.find(application => application.id === id);
      if (!existing) throw new Error('Employment application not found.');
      const normalized = normalizeEmploymentApplicationDraft({ ...existing, ...updates });
      return {
        next: {
          ...current,
          applications: current.applications.map(application => (
            application.id === id
              ? { ...application, ...normalized, updatedAt: new Date().toISOString() }
              : application
          )),
        },
        result: undefined,
      };
    })
  ), [mutate]);

  const addHistoryEntry = useCallback((applicationId: string, entry: Omit<EmploymentHistoryEntry, 'id'>) => (
    mutate(current => {
      const existing = current.applications.find(application => application.id === applicationId);
      if (!existing) throw new Error('Employment application not found.');
      const nextEntry: EmploymentHistoryEntry = { ...entry, id: uuid() };
      const normalized = normalizeEmploymentApplicationDraft({
        ...existing,
        history: [...existing.history, nextEntry],
      });
      return {
        next: {
          ...current,
          applications: current.applications.map(application => (
            application.id === applicationId
              ? { ...application, ...normalized, updatedAt: new Date().toISOString() }
              : application
          )),
        },
        result: undefined,
      };
    })
  ), [mutate]);

  const removeApplication = useCallback((id: string) => (
    mutate(current => {
      if (!current.applications.some(application => application.id === id)) {
        throw new Error('Employment application not found.');
      }
      return {
        next: {
          ...current,
          applications: current.applications.filter(application => application.id !== id),
        },
        result: undefined,
      };
    })
  ), [mutate]);

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
