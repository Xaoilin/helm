import type { ReactNode } from 'react';
import type { FastFoodLogEntry } from '../../types/domain';
import { createCollectionContext } from './createDomainContext';

const fastFoodCollection = createCollectionContext<FastFoodLogEntry>('healthFastFoodEntries');

export interface HealthContextValue {
  fastFoodEntries: FastFoodLogEntry[];
  loaded: boolean;
  addFastFoodEntry: (entry: Omit<FastFoodLogEntry, 'id' | 'createdAt' | 'updatedAt'>) => string;
  updateFastFoodEntry: (id: string, updates: Partial<FastFoodLogEntry>) => void;
  removeFastFoodEntry: (id: string) => void;
}

export function HealthProvider({ children }: { children: ReactNode }) {
  return <fastFoodCollection.Provider>{children}</fastFoodCollection.Provider>;
}

export function useHealthContext(): HealthContextValue {
  const ctx = fastFoodCollection.useContext();
  return {
    fastFoodEntries: ctx.items,
    loaded: ctx.loaded,
    addFastFoodEntry: ctx.add,
    updateFastFoodEntry: ctx.update,
    removeFastFoodEntry: ctx.remove,
  };
}
