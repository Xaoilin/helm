import { createContext, useCallback, useContext, useMemo, type ReactNode } from 'react';
import type { InventoryItem, InventoryNeed } from '../../types/domain';
import {
  INVENTORY_LIMITS,
  normalizeInventoryItemDraft,
  normalizeInventoryNeedDraft,
  normalizeInventoryQuantity,
  type InventoryItemDraft,
  type InventoryNeedDraft,
} from '../../inventory/inventoryModel';
import { createCollectionContext } from './createDomainContext';

const itemCollection = createCollectionContext<InventoryItem>('inventoryItems');
const needCollection = createCollectionContext<InventoryNeed>('inventoryNeeds');

export interface InventoryContextValue {
  inventoryItems: InventoryItem[];
  inventoryNeeds: InventoryNeed[];
  loaded: boolean;
  addInventoryItem: (item: InventoryItemDraft) => string;
  addInventoryItems: (items: InventoryItemDraft[]) => string[];
  updateInventoryItem: (id: string, updates: Partial<InventoryItemDraft>) => void;
  adjustInventoryQuantity: (id: string, delta: number) => void;
  archiveInventoryItem: (id: string) => void;
  addInventoryNeed: (need: InventoryNeedDraft) => string;
  updateInventoryNeed: (id: string, updates: Partial<InventoryNeedDraft>) => void;
  completeInventoryNeed: (needId: string) => void;
}

const InventoryContext = createContext<InventoryContextValue | null>(null);

function InventoryBridge({ children }: { children: ReactNode }) {
  const items = itemCollection.useContext();
  const needs = needCollection.useContext();

  const addInventoryItem = useCallback((draft: InventoryItemDraft) => (
    items.add(normalizeInventoryItemDraft(draft))
  ), [items]);

  const addInventoryItems = useCallback((drafts: InventoryItemDraft[]) => {
    if (drafts.length === 0) return [];
    if (drafts.length > INVENTORY_LIMITS.bulkItems) {
      throw new Error(`A paste review can save at most ${INVENTORY_LIMITS.bulkItems} items.`);
    }
    const normalized = drafts.map(draft => normalizeInventoryItemDraft(draft));
    const ids: string[] = [];
    for (const draft of normalized) ids.push(items.add(draft));
    return ids;
  }, [items]);

  const updateInventoryItem = useCallback((id: string, updates: Partial<InventoryItemDraft>) => {
    const current = items.items.find(item => item.id === id);
    if (!current) throw new Error('Inventory item not found.');
    items.update(id, normalizeInventoryItemDraft({ ...current, ...updates }));
  }, [items]);

  const adjustInventoryQuantity = useCallback((id: string, delta: number) => {
    if (!Number.isFinite(delta)) throw new Error('Quantity adjustment must be finite.');
    const current = items.items.find(item => item.id === id);
    if (!current) throw new Error('Inventory item not found.');
    updateInventoryItem(id, {
      quantity: normalizeInventoryQuantity(current.quantity + delta),
      lastVerifiedAt: new Date().toISOString(),
    });
  }, [items.items, updateInventoryItem]);

  const archiveInventoryItem = useCallback((id: string) => {
    updateInventoryItem(id, { archivedAt: new Date().toISOString() });
  }, [updateInventoryItem]);

  const addInventoryNeed = useCallback((draft: InventoryNeedDraft) => (
    needs.add(normalizeInventoryNeedDraft(draft))
  ), [needs]);

  const updateInventoryNeed = useCallback((id: string, updates: Partial<InventoryNeedDraft>) => {
    const current = needs.items.find(need => need.id === id);
    if (!current) throw new Error('Inventory need not found.');
    needs.update(id, normalizeInventoryNeedDraft({ ...current, ...updates }));
  }, [needs]);

  const completeInventoryNeed = useCallback((needId: string) => {
    const need = needs.items.find(entry => entry.id === needId);
    if (!need) throw new Error('Inventory need not found.');
    if (need.status === 'acquired') return;
    const acquiredAt = new Date().toISOString();
    const linked = need.linkedItemId
      ? items.items.find(item => item.id === need.linkedItemId && !item.archivedAt)
      : undefined;

    if (linked) {
      if (linked.unit.trim().toLocaleLowerCase() !== need.unit.trim().toLocaleLowerCase()) {
        throw new Error('The linked item and need must use the same unit before acquisition.');
      }
      const nextQuantity = normalizeInventoryQuantity(linked.quantity + need.requiredQuantity);
      items.update(linked.id, {
        quantity: nextQuantity,
        lastVerifiedAt: acquiredAt,
      });
    } else {
      const newItemId = items.add(normalizeInventoryItemDraft({
        name: need.name,
        category: need.category || 'other',
        subcategory: need.subcategory,
        imageUrl: need.imageUrl,
        trackingMode: 'counted',
        quantity: need.requiredQuantity,
        unit: need.unit,
        specifications: need.specifications,
        condition: 'new',
        tags: [],
        notes: need.notes,
        projectCatalogKeys: need.projectCatalogKey ? [need.projectCatalogKey] : [],
        lastVerifiedAt: acquiredAt,
      }, acquiredAt));
      needs.update(need.id, { linkedItemId: newItemId });
    }
    needs.update(need.id, {
      status: 'acquired',
      acquiredAt,
    });
  }, [items, needs]);

  const value = useMemo<InventoryContextValue>(() => ({
    inventoryItems: items.items,
    inventoryNeeds: needs.items,
    loaded: items.loaded && needs.loaded,
    addInventoryItem,
    addInventoryItems,
    updateInventoryItem,
    adjustInventoryQuantity,
    archiveInventoryItem,
    addInventoryNeed,
    updateInventoryNeed,
    completeInventoryNeed,
  }), [
    items.items,
    items.loaded,
    needs.items,
    needs.loaded,
    addInventoryItem,
    addInventoryItems,
    updateInventoryItem,
    adjustInventoryQuantity,
    archiveInventoryItem,
    addInventoryNeed,
    updateInventoryNeed,
    completeInventoryNeed,
  ]);

  return <InventoryContext.Provider value={value}>{children}</InventoryContext.Provider>;
}

export function InventoryProvider({ children }: { children: ReactNode }) {
  return (
    <itemCollection.Provider>
      <needCollection.Provider>
        <InventoryBridge>{children}</InventoryBridge>
      </needCollection.Provider>
    </itemCollection.Provider>
  );
}

export function useInventoryContext(): InventoryContextValue {
  const context = useContext(InventoryContext);
  if (!context) throw new Error('useInventoryContext must be used within InventoryProvider');
  return context;
}
