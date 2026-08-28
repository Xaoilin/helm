/**
 * Generic factory for creating domain-specific React contexts with:
 * - State management (collection of items or single object)
 * - Standard CRUD callbacks with auto-generated IDs and timestamps
 * - Persistence (loadStore on mount, saveStore on change)
 *
 * Domain contexts that need custom logic (cascade deletes, balance updates, etc.)
 * should use the lower-level hooks directly rather than the factory.
 */
import { createContext, useContext, useEffect, useState, useCallback, type ReactNode } from 'react';
import { v4 as uuid } from 'uuid';
import { loadStore, saveStore } from '../persistence';
import { useRemoteStoreRefresh } from './useRemoteStoreRefresh';

// ── Collection Context (arrays of items with id) ──

export interface HasId { id: string }

export interface CollectionContextValue<T extends HasId> {
  items: T[];
  loaded: boolean;
  add: (item: Omit<T, 'id' | 'createdAt' | 'updatedAt'>) => string;
  update: (id: string, updates: Partial<T>) => void;
  remove: (id: string) => void;
  setItems: React.Dispatch<React.SetStateAction<T[]>>;
}

interface CollectionProviderProps {
  children: ReactNode;
}

export function createCollectionContext<T extends HasId>(storeKey: string, opts?: { timestamps?: boolean }) {
  const timestamps = opts?.timestamps !== false; // default true
  const Ctx = createContext<CollectionContextValue<T> | null>(null);

  function Provider({ children }: CollectionProviderProps) {
    const [items, setItems] = useState<T[]>([]);
    const [loaded, setLoaded] = useState(false);

    useEffect(() => {
      (async () => {
        const data = await loadStore<T[]>(storeKey);
        setItems(data ?? []);
        setLoaded(true);
      })();
    }, []);

    useRemoteStoreRefresh([storeKey], async () => {
      const data = await loadStore<T[]>(storeKey);
      setItems(data ?? []);
    });

    useEffect(() => {
      if (loaded) saveStore(storeKey, items);
    }, [items, loaded]);

    const add = useCallback((item: Omit<T, 'id' | 'createdAt' | 'updatedAt'>): string => {
      const id = uuid();
      const now = new Date().toISOString();
      const entry = timestamps
        ? { ...item, id, createdAt: now, updatedAt: now } as unknown as T
        : { ...item, id } as unknown as T;
      setItems(prev => [...prev, entry]);
      return id;
    }, []);

    const update = useCallback((id: string, updates: Partial<T>) => {
      const now = new Date().toISOString();
      setItems(prev =>
        prev.map(x =>
          x.id === id
            ? (timestamps ? { ...x, ...updates, updatedAt: now } : { ...x, ...updates })
            : x
        )
      );
    }, []);

    const remove = useCallback((id: string) => {
      setItems(prev => prev.filter(x => x.id !== id));
    }, []);

    return (
      <Ctx.Provider value={{ items, loaded, add, update, remove, setItems }}>
        {children}
      </Ctx.Provider>
    );
  }

  function useCtx() {
    const ctx = useContext(Ctx);
    if (!ctx) throw new Error(`use${storeKey}Context must be used within its Provider`);
    return ctx;
  }

  return { Provider, useContext: useCtx, Context: Ctx };
}
