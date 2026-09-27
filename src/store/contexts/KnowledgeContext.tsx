/**
 * The knowledge base and the lifestyle tracker, owned by the knowledge service. Each change is shown at
 * once and saved as one record; positions come from the service, so moves and reorders show what it
 * stored. A refused save shows why and reloads what the service holds.
 */
import { createContext, useCallback, useContext, useMemo, useRef, useState, type ReactNode } from 'react';
import { v4 as uuid } from 'uuid';
import type { KnowledgeEntry, KnowledgeTopic, LifestyleItem, LifestyleType } from '../../types/domain';
import {
  deleteKnowledgeEntry,
  deleteKnowledgeTopic,
  deleteLifestyleItem,
  getKnowledge,
  getLifestyleItems,
  isKnowledgeServiceEnabled,
  moveLifestyleItem as moveLifestyleItemOnService,
  reorderLifestyleColumn,
  saveKnowledgeEntry,
  saveKnowledgeTopic,
  saveLifestyleItem,
  type EntryInput,
  type LifestyleItemInput,
  type TopicInput,
} from '../../services/backend/knowledgeServiceApi';
import { LIVE_DOMAINS } from '../../services/backend/liveDomains';
import { useServiceLoad } from './useServiceLoad';

export interface KnowledgeContextValue {
  knowledgeTopics: KnowledgeTopic[];
  knowledgeEntries: KnowledgeEntry[];
  lifestyleItems: LifestyleItem[];
  loaded: boolean;
  /** Why the knowledge base may be out of date; null while it is current. */
  error: string | null;
  reload: () => Promise<void>;
  addKnowledgeTopic: (topic: Omit<KnowledgeTopic, 'id' | 'createdAt' | 'updatedAt'>) => string;
  updateKnowledgeTopic: (id: string, updates: Partial<KnowledgeTopic>) => void;
  removeKnowledgeTopic: (id: string) => void;
  addKnowledgeEntry: (entry: Omit<KnowledgeEntry, 'id' | 'createdAt' | 'updatedAt'>) => string;
  updateKnowledgeEntry: (id: string, updates: Partial<KnowledgeEntry>) => void;
  removeKnowledgeEntry: (id: string) => void;
  addLifestyleItem: (item: Omit<LifestyleItem, 'id' | 'createdAt' | 'updatedAt' | 'sortOrder'>) => string;
  updateLifestyleItem: (id: string, updates: Partial<LifestyleItem>) => void;
  removeLifestyleItem: (id: string) => void;
  /** Moves an item into a column at a position (the end when absent); the service resets its status across families. */
  moveLifestyleItem: (id: string, type: LifestyleType, position?: number) => void;
  /** Puts one column in this order. */
  reorderLifestyleItems: (type: LifestyleType, reorderedIds: string[]) => void;
}

export const KnowledgeCtx = createContext<KnowledgeContextValue | null>(null);

export function useKnowledgeContext(): KnowledgeContextValue {
  const ctx = useContext(KnowledgeCtx);
  if (!ctx) throw new Error('useKnowledgeContext must be used within KnowledgeProvider');
  return ctx;
}

function topicInput(topic: KnowledgeTopic): TopicInput {
  return { name: topic.name, description: topic.description, icon: topic.icon, color: topic.color, sortOrder: topic.sortOrder };
}

function entryInput(entry: KnowledgeEntry): EntryInput {
  return { topicId: entry.topicId, title: entry.title, content: entry.content, sources: entry.sources, tags: entry.tags };
}

function lifestyleInput(item: LifestyleItem): LifestyleItemInput {
  return { type: item.type, title: item.title, notes: item.notes, status: item.status, sources: item.sources ?? [] };
}

/** One record list whose latest value writes can read without waiting for a render. */
function useRecords<T extends { id: string }>() {
  const [records, setRecords] = useState<T[]>([]);
  const ref = useRef<T[]>([]);
  const publish = useCallback((next: T[]) => {
    ref.current = next;
    setRecords(next);
  }, []);
  const confirm = useCallback((saved: T) => {
    publish(ref.current.some(record => record.id === saved.id)
      ? ref.current.map(record => (record.id === saved.id ? saved : record))
      : [...ref.current, saved]);
  }, [publish]);
  return { records, ref, publish, confirm };
}

export function KnowledgeProvider({ children }: { children: ReactNode }) {
  const { records: topicRecords, ref: topicsRef, publish: publishTopics, confirm: confirmTopic } =
    useRecords<KnowledgeTopic>();
  const { records: entryRecords, ref: entriesRef, publish: publishEntries, confirm: confirmEntry } =
    useRecords<KnowledgeEntry>();
  const { records: lifestyleRecords, ref: lifestyleRef, publish: publishLifestyle, confirm: confirmLifestyle } =
    useRecords<LifestyleItem>();

  const load = useCallback(async () => {
    const [knowledge, items] = await Promise.all([getKnowledge(), getLifestyleItems()]);
    publishTopics(knowledge.topics);
    publishEntries(knowledge.entries);
    publishLifestyle(items);
  }, [publishEntries, publishLifestyle, publishTopics]);
  const { loaded, error, reload, reportFailure } = useServiceLoad('Knowledge', isKnowledgeServiceEnabled(), load, LIVE_DOMAINS.knowledge);

  // ── Topics ──
  const addKnowledgeTopic = useCallback((topic: Omit<KnowledgeTopic, 'id' | 'createdAt' | 'updatedAt'>): string => {
    const id = uuid();
    const now = new Date().toISOString();
    publishTopics([...topicsRef.current, { ...topic, id, sortOrder: topicsRef.current.length, createdAt: now, updatedAt: now }]);
    // A new topic goes last; the service numbers it.
    saveKnowledgeTopic(id, { name: topic.name, description: topic.description, icon: topic.icon, color: topic.color })
      .then(confirmTopic, reportFailure);
    return id;
  }, [confirmTopic, publishTopics, reportFailure, topicsRef]);

  const updateKnowledgeTopic = useCallback((id: string, updates: Partial<KnowledgeTopic>) => {
    const current = topicsRef.current.find(topic => topic.id === id);
    if (!current) return;
    const next = { ...current, ...updates, id, updatedAt: new Date().toISOString() };
    publishTopics(topicsRef.current.map(topic => (topic.id === id ? next : topic)));
    saveKnowledgeTopic(id, topicInput(next)).then(confirmTopic, reportFailure);
  }, [confirmTopic, publishTopics, reportFailure, topicsRef]);

  const removeKnowledgeTopic = useCallback((id: string) => {
    publishTopics(topicsRef.current.filter(topic => topic.id !== id));
    publishEntries(entriesRef.current.filter(entry => entry.topicId !== id));
    deleteKnowledgeTopic(id).catch(reportFailure);
  }, [entriesRef, publishEntries, publishTopics, reportFailure, topicsRef]);

  // ── Entries ──
  const addKnowledgeEntry = useCallback((entry: Omit<KnowledgeEntry, 'id' | 'createdAt' | 'updatedAt'>): string => {
    const id = uuid();
    const now = new Date().toISOString();
    publishEntries([...entriesRef.current, { ...entry, id, createdAt: now, updatedAt: now }]);
    saveKnowledgeEntry(id, entry).then(confirmEntry, reportFailure);
    return id;
  }, [confirmEntry, entriesRef, publishEntries, reportFailure]);

  const updateKnowledgeEntry = useCallback((id: string, updates: Partial<KnowledgeEntry>) => {
    const current = entriesRef.current.find(entry => entry.id === id);
    if (!current) return;
    const next = { ...current, ...updates, id, updatedAt: new Date().toISOString() };
    publishEntries(entriesRef.current.map(entry => (entry.id === id ? next : entry)));
    saveKnowledgeEntry(id, entryInput(next)).then(confirmEntry, reportFailure);
  }, [confirmEntry, entriesRef, publishEntries, reportFailure]);

  const removeKnowledgeEntry = useCallback((id: string) => {
    publishEntries(entriesRef.current.filter(entry => entry.id !== id));
    deleteKnowledgeEntry(id).catch(reportFailure);
  }, [entriesRef, publishEntries, reportFailure]);

  // ── Lifestyle ──
  const addLifestyleItem = useCallback((item: Omit<LifestyleItem, 'id' | 'createdAt' | 'updatedAt' | 'sortOrder'>): string => {
    const id = uuid();
    const now = new Date().toISOString();
    const column = lifestyleRef.current.filter(existing => existing.type === item.type);
    const next: LifestyleItem = { ...item, id, sortOrder: column.length, createdAt: now, updatedAt: now };
    publishLifestyle([...lifestyleRef.current, next]);
    saveLifestyleItem(id, lifestyleInput(next)).then(confirmLifestyle, reportFailure);
    return id;
  }, [confirmLifestyle, lifestyleRef, publishLifestyle, reportFailure]);

  const updateLifestyleItem = useCallback((id: string, updates: Partial<LifestyleItem>) => {
    const current = lifestyleRef.current.find(item => item.id === id);
    if (!current) return;
    const next = { ...current, ...updates, id, updatedAt: new Date().toISOString() };
    publishLifestyle(lifestyleRef.current.map(item => (item.id === id ? next : item)));
    // A changed type moves the item to the end of its new column; the reload shows the renumbered columns.
    saveLifestyleItem(id, lifestyleInput(next)).then(saved => {
      if (saved.type !== current.type) void getLifestyleItems().then(publishLifestyle, reportFailure);
      else confirmLifestyle(saved);
    }, reportFailure);
  }, [confirmLifestyle, lifestyleRef, publishLifestyle, reportFailure]);

  const removeLifestyleItem = useCallback((id: string) => {
    publishLifestyle(lifestyleRef.current.filter(item => item.id !== id));
    deleteLifestyleItem(id).catch(reportFailure);
  }, [lifestyleRef, publishLifestyle, reportFailure]);

  const moveLifestyleItem = useCallback((id: string, type: LifestyleType, position?: number) => {
    moveLifestyleItemOnService(id, type, position).then(publishLifestyle, reportFailure);
  }, [publishLifestyle, reportFailure]);

  const reorderLifestyleItems = useCallback((type: LifestyleType, reorderedIds: string[]) => {
    // Show the new order at once; the service's answer replaces it.
    publishLifestyle(lifestyleRef.current.map(item => {
      const position = item.type === type ? reorderedIds.indexOf(item.id) : -1;
      return position >= 0 ? { ...item, sortOrder: position } : item;
    }));
    reorderLifestyleColumn(type, reorderedIds).then(publishLifestyle, reportFailure);
  }, [lifestyleRef, publishLifestyle, reportFailure]);

  const value = useMemo<KnowledgeContextValue>(() => ({
    knowledgeTopics: topicRecords,
    knowledgeEntries: entryRecords,
    lifestyleItems: lifestyleRecords,
    loaded,
    error,
    reload,
    addKnowledgeTopic, updateKnowledgeTopic, removeKnowledgeTopic,
    addKnowledgeEntry, updateKnowledgeEntry, removeKnowledgeEntry,
    addLifestyleItem, updateLifestyleItem, removeLifestyleItem, moveLifestyleItem, reorderLifestyleItems,
  }), [topicRecords, entryRecords, lifestyleRecords, loaded, error, reload, addKnowledgeTopic,
    updateKnowledgeTopic, removeKnowledgeTopic, addKnowledgeEntry, updateKnowledgeEntry, removeKnowledgeEntry,
    addLifestyleItem, updateLifestyleItem, removeLifestyleItem, moveLifestyleItem, reorderLifestyleItems]);

  return <KnowledgeCtx.Provider value={value}>{children}</KnowledgeCtx.Provider>;
}
