import { createContext, useCallback, useContext, useEffect, useState, type ReactNode } from 'react';
import { v4 as uuid } from 'uuid';
import { LIMITS } from '../../config/constants';
import type { AssistantActivityDraft, AssistantActivityEntry } from '../../types/domain';
import { loadStore, saveStore } from '../persistence';

export interface AssistantActivityContextValue {
  assistantActivityLog: AssistantActivityEntry[];
  loaded: boolean;
  recordAssistantActivity: (activity: AssistantActivityDraft) => string;
  markAssistantActivityUndone: (id: string) => void;
  markAssistantActivityUndoFailed: (id: string, message: string) => void;
}

const AssistantActivityCtx = createContext<AssistantActivityContextValue | null>(null);

function normalizeActivity(entry: AssistantActivityEntry): AssistantActivityEntry {
  return {
    ...entry,
    details: Array.isArray(entry.details) ? entry.details.filter(Boolean) : [],
    entityRefs: Array.isArray(entry.entityRefs) ? entry.entityRefs : [],
    status: entry.status || 'applied',
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

  useEffect(() => {
    (async () => {
      const data = await loadStore<AssistantActivityEntry[]>('assistantActivityLog');
      setAssistantActivityLog((data ?? []).map(normalizeActivity).slice(0, LIMITS.ASSISTANT_ACTIVITY_LOG));
      setLoaded(true);
    })();
  }, []);

  useEffect(() => {
    if (loaded) {
      void saveStore('assistantActivityLog', assistantActivityLog);
    }
  }, [assistantActivityLog, loaded]);

  const recordAssistantActivity = useCallback((activity: AssistantActivityDraft): string => {
    const id = uuid();
    const now = activity.createdAt || new Date().toISOString();
    const entry: AssistantActivityEntry = normalizeActivity({
      ...activity,
      id,
      createdAt: now,
      status: activity.status || 'applied',
    });

    setAssistantActivityLog(prev => [entry, ...prev].slice(0, LIMITS.ASSISTANT_ACTIVITY_LOG));
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
      recordAssistantActivity,
      markAssistantActivityUndone,
      markAssistantActivityUndoFailed,
    }}
    >
      {children}
    </AssistantActivityCtx.Provider>
  );
}
