/**
 * Inventory, owned by the life admin service (the authoritative stock). Each change is shown at once
 * and saved as one record; acquiring a need is done by the service in one step so the stock and the
 * shopping list never disagree. A refused save shows why and reloads what the service holds.
 */
import { createContext, useCallback, useContext, useMemo, useRef, useState, type ReactNode } from 'react';
import { v4 as uuid } from 'uuid';
import type { InventoryItem, InventoryNeed } from '../../types/domain';
import {
  INVENTORY_LIMITS,
  normalizeInventoryItemDraft,
  normalizeInventoryNeedDraft,
  normalizeInventoryQuantity,
  type InventoryItemDraft,
  type InventoryNeedDraft,
} from '../../inventory/inventoryModel';
import {
  acquireInventoryNeed,
  archiveInventoryItem as archiveItemInService,
  getInventory,
  isLifeServiceEnabled,
  saveInventoryItem,
  saveInventoryItems,
  saveInventoryNeed,
  withoutKeys,
  type NeedInput,
} from '../../services/backend/lifeServiceApi';
import { LIVE_DOMAINS } from '../../services/backend/liveDomains';
import { useServiceLoad } from './useServiceLoad';

export interface InventoryContextValue {
  inventoryItems: InventoryItem[];
  inventoryNeeds: InventoryNeed[];
  loaded: boolean;
  /** Why Inventory may be out of date; null while it is current. */
  error: string | null;
  reload: () => Promise<void>;
  addInventoryItem: (item: InventoryItemDraft) => string;
  addInventoryItems: (items: InventoryItemDraft[]) => string[];
  updateInventoryItem: (id: string, updates: Partial<InventoryItemDraft>) => void;
  adjustInventoryQuantity: (id: string, delta: number) => void;
  archiveInventoryItem: (id: string) => void;
  addInventoryNeed: (need: InventoryNeedDraft) => string;
  updateInventoryNeed: (id: string, updates: Partial<InventoryNeedDraft>) => void;
  completeInventoryNeed: (needId: string) => void;
}

export const InventoryContext = createContext<InventoryContextValue | null>(null);

function needInput(need: InventoryNeedDraft): NeedInput {
  return withoutKeys(need, 'orderedAt', 'acquiredAt', 'dismissedAt');
}

function replaceById<T extends { id: string }>(records: T[], saved: T): T[] {
  return records.some(record => record.id === saved.id)
    ? records.map(record => (record.id === saved.id ? saved : record))
    : [...records, saved];
}

export function InventoryProvider({ children }: { children: ReactNode }) {
  const [items, setItems] = useState<InventoryItem[]>([]);
  const [needs, setNeeds] = useState<InventoryNeed[]>([]);
  const itemsRef = useRef<InventoryItem[]>([]);
  const needsRef = useRef<InventoryNeed[]>([]);
  const publishItems = useCallback((next: InventoryItem[]) => { itemsRef.current = next; setItems(next); }, []);
  const publishNeeds = useCallback((next: InventoryNeed[]) => { needsRef.current = next; setNeeds(next); }, []);
  const load = useCallback(async () => {
    const inventory = await getInventory();
    publishItems(inventory.items);
    publishNeeds(inventory.needs);
  }, [publishItems, publishNeeds]);
  const { loaded, error, reload, reportFailure } = useServiceLoad('Inventory', isLifeServiceEnabled(), load, LIVE_DOMAINS.inventory);

  const confirmItem = useCallback((saved: InventoryItem) => publishItems(replaceById(itemsRef.current, saved)),
    [publishItems]);
  const confirmNeed = useCallback((saved: InventoryNeed) => publishNeeds(replaceById(needsRef.current, saved)),
    [publishNeeds]);

  const showItem = useCallback((id: string, draft: InventoryItemDraft) => {
    const existing = itemsRef.current.find(item => item.id === id);
    const now = new Date().toISOString();
    publishItems(replaceById(itemsRef.current, { ...draft, id, createdAt: existing?.createdAt ?? now, updatedAt: now }));
  }, [publishItems]);

  const addInventoryItem = useCallback((draft: InventoryItemDraft) => {
    const id = uuid();
    const normalized = normalizeInventoryItemDraft(draft);
    showItem(id, normalized);
    saveInventoryItem(id, normalized).then(confirmItem, reportFailure);
    return id;
  }, [confirmItem, reportFailure, showItem]);

  const addInventoryItems = useCallback((drafts: InventoryItemDraft[]) => {
    if (drafts.length === 0) return [];
    if (drafts.length > INVENTORY_LIMITS.bulkItems) {
      throw new Error(`A paste review can save at most ${INVENTORY_LIMITS.bulkItems} items.`);
    }
    const batch = drafts.map(draft => ({ ...normalizeInventoryItemDraft(draft), id: uuid() }));
    batch.forEach(({ id, ...draft }) => showItem(id, draft));
    saveInventoryItems(batch).then(saved => saved.forEach(confirmItem), reportFailure);
    return batch.map(item => item.id);
  }, [confirmItem, reportFailure, showItem]);

  const updateInventoryItem = useCallback((id: string, updates: Partial<InventoryItemDraft>) => {
    const current = itemsRef.current.find(item => item.id === id);
    if (!current) throw new Error('Inventory item not found.');
    const normalized = normalizeInventoryItemDraft({ ...current, ...updates });
    showItem(id, normalized);
    saveInventoryItem(id, normalized).then(confirmItem, reportFailure);
  }, [confirmItem, reportFailure, showItem]);

  const adjustInventoryQuantity = useCallback((id: string, delta: number) => {
    if (!Number.isFinite(delta)) throw new Error('Quantity adjustment must be finite.');
    const current = itemsRef.current.find(item => item.id === id);
    if (!current) throw new Error('Inventory item not found.');
    updateInventoryItem(id, {
      quantity: normalizeInventoryQuantity(current.quantity + delta),
      lastVerifiedAt: new Date().toISOString(),
    });
  }, [updateInventoryItem]);

  const archiveInventoryItem = useCallback((id: string) => {
    const current = itemsRef.current.find(item => item.id === id);
    if (!current) throw new Error('Inventory item not found.');
    publishItems(replaceById(itemsRef.current, { ...current, archivedAt: new Date().toISOString() }));
    archiveItemInService(id).then(confirmItem, reportFailure);
  }, [confirmItem, publishItems, reportFailure]);

  const showNeed = useCallback((id: string, draft: InventoryNeedDraft) => {
    const existing = needsRef.current.find(need => need.id === id);
    const now = new Date().toISOString();
    publishNeeds(replaceById(needsRef.current, { ...draft, id, createdAt: existing?.createdAt ?? now, updatedAt: now }));
  }, [publishNeeds]);

  const addInventoryNeed = useCallback((draft: InventoryNeedDraft) => {
    const id = uuid();
    const normalized = normalizeInventoryNeedDraft(draft);
    showNeed(id, normalized);
    saveInventoryNeed(id, needInput(normalized)).then(confirmNeed, reportFailure);
    return id;
  }, [confirmNeed, reportFailure, showNeed]);

  const updateInventoryNeed = useCallback((id: string, updates: Partial<InventoryNeedDraft>) => {
    const current = needsRef.current.find(need => need.id === id);
    if (!current) throw new Error('Inventory need not found.');
    const normalized = normalizeInventoryNeedDraft({ ...current, ...updates });
    showNeed(id, normalized);
    saveInventoryNeed(id, needInput(normalized)).then(confirmNeed, reportFailure);
  }, [confirmNeed, reportFailure, showNeed]);

  /** The service closes the need and adds its quantity to the linked item (or a new one) together. */
  const completeInventoryNeed = useCallback((needId: string) => {
    const need = needsRef.current.find(entry => entry.id === needId);
    if (!need) throw new Error('Inventory need not found.');
    if (need.status === 'acquired') return;
    const linked = need.linkedItemId
      ? itemsRef.current.find(item => item.id === need.linkedItemId && !item.archivedAt)
      : undefined;
    if (linked && linked.unit.trim().toLocaleLowerCase() !== need.unit.trim().toLocaleLowerCase()) {
      throw new Error('The linked item and need must use the same unit before acquisition.');
    }
    publishNeeds(replaceById(needsRef.current, { ...need, status: 'acquired', acquiredAt: new Date().toISOString() }));
    acquireInventoryNeed(needId, uuid()).then(({ need: acquired, item }) => {
      confirmNeed(acquired);
      if (item) confirmItem(item);
    }, reportFailure);
  }, [confirmItem, confirmNeed, publishNeeds, reportFailure]);

  const value = useMemo<InventoryContextValue>(() => ({
    inventoryItems: items,
    inventoryNeeds: needs,
    loaded,
    error,
    reload,
    addInventoryItem,
    addInventoryItems,
    updateInventoryItem,
    adjustInventoryQuantity,
    archiveInventoryItem,
    addInventoryNeed,
    updateInventoryNeed,
    completeInventoryNeed,
  }), [
    items, needs, loaded, error, reload, addInventoryItem, addInventoryItems, updateInventoryItem,
    adjustInventoryQuantity, archiveInventoryItem, addInventoryNeed, updateInventoryNeed, completeInventoryNeed,
  ]);

  return <InventoryContext.Provider value={value}>{children}</InventoryContext.Provider>;
}

export function useInventoryContext(): InventoryContextValue {
  const context = useContext(InventoryContext);
  if (!context) throw new Error('useInventoryContext must be used within InventoryProvider');
  return context;
}
