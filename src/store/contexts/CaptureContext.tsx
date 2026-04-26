import type { ReactNode } from 'react';
import type { CaptureItem } from '../../types/domain';
import { createCollectionContext } from './createDomainContext';

const captureCollection = createCollectionContext<CaptureItem>('captureItems');

export interface CaptureContextValue {
  captureItems: CaptureItem[];
  loaded: boolean;
  addCaptureItem: (item: Omit<CaptureItem, 'id' | 'createdAt' | 'updatedAt'>) => string;
  updateCaptureItem: (id: string, updates: Partial<CaptureItem>) => void;
  removeCaptureItem: (id: string) => void;
}

export function CaptureProvider({ children }: { children: ReactNode }) {
  return <captureCollection.Provider>{children}</captureCollection.Provider>;
}

export function useCaptureContext(): CaptureContextValue {
  const ctx = captureCollection.useContext();
  return {
    captureItems: ctx.items,
    loaded: ctx.loaded,
    addCaptureItem: ctx.add,
    updateCaptureItem: ctx.update,
    removeCaptureItem: ctx.remove,
  };
}
