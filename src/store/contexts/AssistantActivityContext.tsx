import { createContext, useCallback, useContext, useEffect, useState, useSyncExternalStore, type ReactNode } from 'react';
import { v4 as uuid } from 'uuid';
import type { AssistantActivityDraft, AssistantActivityEntry } from '../../types/domain';
import { getStoreLoadState, loadMoreStoreRecords, loadStore, saveStore, subscribeStoreChanges } from '../persistence';
import { useRemoteStoreRefresh } from './useRemoteStoreRefresh';

export interface AssistantActivityContextValue {
  assistantActivityLog: AssistantActivityEntry[];
  loaded: boolean;
  hasMore: boolean;
  loadMore: () => Promise<void>;
  recordAssistantActivity: (activity: AssistantActivityDraft) => string;
  markAssistantActivityUndone: (id: string) => void;
  markAssistantActivityUndoFailed: (id: string, message: string) => void;
}

export const AssistantActivityCtx = createContext<AssistantActivityContextValue | null>(null);

export function normalizeAssistantActivityEntry(entry: AssistantActivityEntry): AssistantActivityEntry {
  const raw = entry as AssistantActivityEntry & {
    domain?: string;
    undoOperation?: { type?: string };
  };
  const retiredCapture = String(raw.domain) === 'capture'
    || String(raw.undoOperation?.type) === 'capture.delete';
  return {
    ...entry,
    details: Array.isArray(entry.details) ? entry.details.filter(Boolean) : [],
    entityRefs: Array.isArray(entry.entityRefs) ? entry.entityRefs : [],
    status: entry.status || 'applied',
    ...(retiredCapture ? { undoOperation: undefined } : {}),
  };
}

export function useAssistantActivityContext(): AssistantActivityContextValue {
  const ctx = useContext(AssistantActivityCtx);
  if (!ctx) throw new Error('useAssistantActivityContext must be used within AssistantActivityProvider');
  return ctx;
}

export function AssistantActivityProvider({ children }: { children: ReactNode }) {
  const [assistantActivityLog, setAssistantActivityLog] = useState<AssistantActivityEntry[]>([]);
  const [loaded, setLoaded] = useState(false);
  const hasMore = useSyncExternalStore(subscribeStoreChanges, () => {
    const state = getStoreLoadState('assistantActivityLog');
    return state.loaded && !state.complete;
  });
  const loadMore = useCallback(() => loadMoreStoreRecords('assistantActivityLog'), []);

  useEffect(() => {
    (async () => {
      const data = await loadStore<AssistantActivityEntry[]>('assistantActivityLog');
      setAssistantActivityLog((data ?? []).map(normalizeAssistantActivityEntry));
      setLoaded(true);
    })();
  }, []);

  useRemoteStoreRefresh(['assistantActivityLog'], async () => {
    const data = await loadStore<AssistantActivityEntry[]>('assistantActivityLog');
    setAssistantActivityLog((data ?? []).map(normalizeAssistantActivityEntry));
  });

  useEffect(() => {
    if (loaded) {
      void saveStore('assistantActivityLog', assistantActivityLog);
    }
  }, [assistantActivityLog, loaded]);

  const recordAssistantActivity = useCallback((activity: AssistantActivityDraft): string => {
    const id = uuid();
    const now = activity.createdAt || new Date().toISOString();
    const entry: AssistantActivityEntry = normalizeAssistantActivityEntry({
      ...activity,
      id,
      createdAt: now,
      status: activity.status || 'applied',
    });

    setAssistantActivityLog(prev => [entry, ...prev]);
    return id;
  }, []);

  const markAssistantActivityUndone = useCallback((id: string) => {
    const undoneAt = new Date().toISOString();
    setAssistantActivityLog(prev => prev.map(entry => (
      entry.id === id
        ? { ...entry, status: 'undone', undoneAt, undoError: undefined }
        : entry
    )));
  }, []);

  const markAssistantActivityUndoFailed = useCallback((id: string, message: string) => {
    setAssistantActivityLog(prev => prev.map(entry => (
      entry.id === id
        ? { ...entry, status: 'undo_failed', undoError: message }
        : entry
    )));
  }, []);

  return (
    <AssistantActivityCtx.Provider value={{
      assistantActivityLog,
      loaded,
      hasMore,
      loadMore,
      recordAssistantActivity,
      markAssistantActivityUndone,
      markAssistantActivityUndoFailed,
    }}
    >
      {children}
    </AssistantActivityCtx.Provider>
  );
}
