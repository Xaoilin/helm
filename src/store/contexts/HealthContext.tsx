/**
 * The fast-food journal, owned by the life admin service. Each change is shown at once and saved as
 * one record; a refused save shows why and reloads what the service holds.
 */
import { createContext, useCallback, useContext, useMemo, useRef, useState, type ReactNode } from 'react';
import { v4 as uuid } from 'uuid';
import type { FastFoodLogEntry } from '../../types/domain';
import {
  deleteFastFoodEntry,
  getFastFoodEntries,
  isLifeServiceEnabled,
  saveFastFoodEntry,
  withoutKeys,
  type FastFoodEntryInput,
} from '../../services/backend/lifeServiceApi';
import { useServiceLoad } from './useServiceLoad';

export interface HealthContextValue {
  fastFoodEntries: FastFoodLogEntry[];
  loaded: boolean;
  /** Why the journal may be out of date; null while it is current. */
  error: string | null;
  reload: () => Promise<void>;
  addFastFoodEntry: (entry: FastFoodEntryInput) => string;
  updateFastFoodEntry: (id: string, updates: Partial<FastFoodLogEntry>) => void;
  removeFastFoodEntry: (id: string) => void;
}

export const HealthContext = createContext<HealthContextValue | null>(null);

function inputOf(entry: FastFoodLogEntry): FastFoodEntryInput {
  return withoutKeys(entry, 'id', 'createdAt', 'updatedAt');
}

export function HealthProvider({ children }: { children: ReactNode }) {
  const [entries, setEntries] = useState<FastFoodLogEntry[]>([]);
  const entriesRef = useRef<FastFoodLogEntry[]>([]);
  const publish = useCallback((next: FastFoodLogEntry[]) => {
    entriesRef.current = next;
    setEntries(next);
  }, []);
  const load = useCallback(async () => publish(await getFastFoodEntries()), [publish]);
  const { loaded, error, reload, reportFailure } = useServiceLoad('Health', isLifeServiceEnabled(), load);

  const confirm = useCallback((saved: FastFoodLogEntry) => {
    publish(entriesRef.current.map(entry => (entry.id === saved.id ? saved : entry)));
  }, [publish]);

  const addFastFoodEntry = useCallback((input: FastFoodEntryInput): string => {
    const id = uuid();
    const now = new Date().toISOString();
    publish([...entriesRef.current, { ...input, id, createdAt: now, updatedAt: now }]);
    saveFastFoodEntry(id, input).then(confirm, reportFailure);
    return id;
  }, [confirm, publish, reportFailure]);

  const updateFastFoodEntry = useCallback((id: string, updates: Partial<FastFoodLogEntry>) => {
    const current = entriesRef.current.find(entry => entry.id === id);
    if (!current) return;
    const next = { ...current, ...updates, id, updatedAt: new Date().toISOString() };
    publish(entriesRef.current.map(entry => (entry.id === id ? next : entry)));
    saveFastFoodEntry(id, inputOf(next)).then(confirm, reportFailure);
  }, [confirm, publish, reportFailure]);

  const removeFastFoodEntry = useCallback((id: string) => {
    publish(entriesRef.current.filter(entry => entry.id !== id));
    deleteFastFoodEntry(id).catch(reportFailure);
  }, [publish, reportFailure]);

  const value = useMemo<HealthContextValue>(() => ({
    fastFoodEntries: entries, loaded, error, reload, addFastFoodEntry, updateFastFoodEntry, removeFastFoodEntry,
  }), [entries, loaded, error, reload, addFastFoodEntry, updateFastFoodEntry, removeFastFoodEntry]);

  return <HealthContext.Provider value={value}>{children}</HealthContext.Provider>;
}

export function useHealthContext(): HealthContextValue {
  const context = useContext(HealthContext);
  if (!context) throw new Error('useHealthContext must be used within HealthProvider');
  return context;
}
