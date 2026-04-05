import { createContext, useContext, useEffect, useState, useCallback, type ReactNode } from 'react';
import { v4 as uuid } from 'uuid';
import type { KnowledgeTopic, KnowledgeEntry, LifestyleItem } from '../../types/domain';
import { loadStore, saveStore } from '../persistence';

export interface KnowledgeContextValue {
  knowledgeTopics: KnowledgeTopic[];
  knowledgeEntries: KnowledgeEntry[];
  lifestyleItems: LifestyleItem[];
  loaded: boolean;
  addKnowledgeTopic: (topic: Omit<KnowledgeTopic, 'id' | 'createdAt' | 'updatedAt'>) => string;
  updateKnowledgeTopic: (id: string, updates: Partial<KnowledgeTopic>) => void;
  removeKnowledgeTopic: (id: string) => void;
  addKnowledgeEntry: (entry: Omit<KnowledgeEntry, 'id' | 'createdAt' | 'updatedAt'>) => string;
  updateKnowledgeEntry: (id: string, updates: Partial<KnowledgeEntry>) => void;
  removeKnowledgeEntry: (id: string) => void;
  addLifestyleItem: (item: Omit<LifestyleItem, 'id' | 'createdAt' | 'updatedAt'>) => string;
  updateLifestyleItem: (id: string, updates: Partial<LifestyleItem>) => void;
  removeLifestyleItem: (id: string) => void;
  reorderLifestyleItems: (reorderedIds: string[]) => void;
}

const KnowledgeCtx = createContext<KnowledgeContextValue | null>(null);

export function useKnowledgeContext(): KnowledgeContextValue {
  const ctx = useContext(KnowledgeCtx);
  if (!ctx) throw new Error('useKnowledgeContext must be used within KnowledgeProvider');
  return ctx;
}

export function KnowledgeProvider({ children }: { children: ReactNode }) {
  const [knowledgeTopics, setKnowledgeTopics] = useState<KnowledgeTopic[]>([]);
  const [knowledgeEntries, setKnowledgeEntries] = useState<KnowledgeEntry[]>([]);
  const [lifestyleItems, setLifestyleItems] = useState<LifestyleItem[]>([]);
  const [loaded, setLoaded] = useState(false);

  useEffect(() => {
    (async () => {
      const [topics, entries, lifestyle] = await Promise.all([
        loadStore<KnowledgeTopic[]>('knowledgeTopics'),
        loadStore<KnowledgeEntry[]>('knowledgeEntries'),
        loadStore<LifestyleItem[]>('lifestyleItems'),
      ]);
      setKnowledgeTopics(topics ?? []);
      setKnowledgeEntries(entries ?? []);
      setLifestyleItems(lifestyle ?? []);
      setLoaded(true);
    })();
  }, []);

  useEffect(() => { if (loaded) saveStore('knowledgeTopics', knowledgeTopics); }, [knowledgeTopics, loaded]);
  useEffect(() => { if (loaded) saveStore('knowledgeEntries', knowledgeEntries); }, [knowledgeEntries, loaded]);
  useEffect(() => { if (loaded) saveStore('lifestyleItems', lifestyleItems); }, [lifestyleItems, loaded]);

  // ── Topics ──
  const addKnowledgeTopic = useCallback((topic: Omit<KnowledgeTopic, 'id' | 'createdAt' | 'updatedAt'>): string => {
    const id = uuid();
    const now = new Date().toISOString();
    setKnowledgeTopics(prev => [...prev, { ...topic, id, createdAt: now, updatedAt: now }]);
    return id;
  }, []);

  const updateKnowledgeTopic = useCallback((id: string, updates: Partial<KnowledgeTopic>) => {
    setKnowledgeTopics(prev =>
      prev.map(t => t.id === id ? { ...t, ...updates, updatedAt: new Date().toISOString() } : t)
    );
  }, []);

  const removeKnowledgeTopic = useCallback((id: string) => {
    setKnowledgeTopics(prev => prev.filter(t => t.id !== id));
    setKnowledgeEntries(prev => prev.filter(e => e.topicId !== id));
  }, []);

  // ── Entries ──
  const addKnowledgeEntry = useCallback((entry: Omit<KnowledgeEntry, 'id' | 'createdAt' | 'updatedAt'>): string => {
    const id = uuid();
    const now = new Date().toISOString();
    setKnowledgeEntries(prev => [...prev, { ...entry, id, createdAt: now, updatedAt: now }]);
    return id;
  }, []);

  const updateKnowledgeEntry = useCallback((id: string, updates: Partial<KnowledgeEntry>) => {
    setKnowledgeEntries(prev =>
      prev.map(e => e.id === id ? { ...e, ...updates, updatedAt: new Date().toISOString() } : e)
    );
  }, []);

  const removeKnowledgeEntry = useCallback((id: string) => {
    setKnowledgeEntries(prev => prev.filter(e => e.id !== id));
  }, []);

  // ── Lifestyle ──
  const addLifestyleItem = useCallback((item: Omit<LifestyleItem, 'id' | 'createdAt' | 'updatedAt'>): string => {
    const id = uuid();
    const now = new Date().toISOString();
    setLifestyleItems(prev => [...prev, { ...item, id, createdAt: now, updatedAt: now }]);
    return id;
  }, []);

  const updateLifestyleItem = useCallback((id: string, updates: Partial<LifestyleItem>) => {
    setLifestyleItems(prev =>
      prev.map(i => i.id === id ? { ...i, ...updates, updatedAt: new Date().toISOString() } : i)
    );
  }, []);

  const removeLifestyleItem = useCallback((id: string) => {
    setLifestyleItems(prev => prev.filter(i => i.id !== id));
  }, []);

  const reorderLifestyleItems = useCallback((reorderedIds: string[]) => {
    setLifestyleItems(prev =>
      prev.map(item => {
        const newOrder = reorderedIds.indexOf(item.id);
        return newOrder >= 0 ? { ...item, sortOrder: newOrder } : item;
      })
    );
  }, []);

  const value: KnowledgeContextValue = {
    knowledgeTopics, knowledgeEntries, lifestyleItems, loaded,
    addKnowledgeTopic, updateKnowledgeTopic, removeKnowledgeTopic,
    addKnowledgeEntry, updateKnowledgeEntry, removeKnowledgeEntry,
    addLifestyleItem, updateLifestyleItem, removeLifestyleItem, reorderLifestyleItems,
  };

  return <KnowledgeCtx.Provider value={value}>{children}</KnowledgeCtx.Provider>;
}
