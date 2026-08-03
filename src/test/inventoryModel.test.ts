import { describe, expect, it } from 'vitest';
import type { InventoryItem } from '../types/domain';
import {
  findLikelyInventoryDuplicates,
  hasSufficientInventory,
  isInventoryLowStock,
  normalizeInventoryItemDraft,
  normalizeInventoryNeedDraft,
  normalizeInventoryQuantity,
  parseInventoryPaste,
} from '../inventory/inventoryModel';

const timestamp = '2026-08-03T04:00:00.000Z';

function owned(overrides: Partial<InventoryItem> = {}): InventoryItem {
  return {
    id: 'item-calipers',
    name: 'Digital calipers',
    category: 'tool',
    trackingMode: 'durable',
    quantity: 1,
    unit: 'item',
    lowStockThreshold: 1,
    brand: 'Mitutoyo',
    model: '500-196-30',
    specifications: { resolution: '0.01 mm' },
    condition: 'good',
    location: 'Workshop drawer',
    tags: ['measurement'],
    notes: '',
    projectCatalogKeys: ['magnus'],
    lastVerifiedAt: timestamp,
    createdAt: timestamp,
    updatedAt: timestamp,
    ...overrides,
  };
}

describe('Inventory model', () => {
  it('normalizes bounded item and need drafts', () => {
    expect(normalizeInventoryItemDraft({
      name: '  M3 heat-set inserts  ',
      quantity: '100' as unknown as number,
      unit: ' pcs ',
      category: 'fastener',
      trackingMode: 'counted',
      specifications: { thread: ' M3 ' },
      condition: 'new',
      tags: [' brass ', 'brass'],
      notes: ' Drawer A ',
      projectCatalogKeys: [' magnus ', 'magnus'],
      lastVerifiedAt: timestamp,
    }, timestamp)).toMatchObject({
      name: 'M3 heat-set inserts',
      quantity: 100,
      unit: 'pcs',
      specifications: { thread: 'M3' },
      tags: ['brass'],
      projectCatalogKeys: ['magnus'],
    });

    expect(normalizeInventoryNeedDraft({
      name: 'M3 heat-set inserts',
      requiredQuantity: 20,
      unit: 'pcs',
      specifications: { thread: 'M3' },
      priority: 'high',
      status: 'needed',
      notes: '',
    })).toMatchObject({ requiredQuantity: 20, priority: 'high', status: 'needed' });
  });

  it('rejects non-finite, negative, and oversized quantities', () => {
    expect(() => normalizeInventoryQuantity(Number.NaN)).toThrow(/finite number/);
    expect(() => normalizeInventoryQuantity(Number.POSITIVE_INFINITY)).toThrow(/finite number/);
    expect(() => normalizeInventoryQuantity(-1)).toThrow(/finite number/);
    expect(() => normalizeInventoryQuantity(1_000_000_001)).toThrow(/finite number/);
  });

  it('checks stock with unit and lifecycle awareness', () => {
    const item = owned({ quantity: 3, lowStockThreshold: 3 });
    expect(isInventoryLowStock(item)).toBe(true);
    expect(hasSufficientInventory(item, 2, 'ITEM')).toBe(true);
    expect(hasSufficientInventory(item, 4, 'item')).toBe(false);
    expect(hasSufficientInventory(item, 1, 'pcs')).toBe(false);
    expect(hasSufficientInventory({ ...item, archivedAt: timestamp }, 1, 'item')).toBe(false);
  });

  it('finds likely duplicates while ignoring archived stock', () => {
    const current = owned();
    const archived = owned({ id: 'archived', archivedAt: timestamp });
    expect(findLikelyInventoryDuplicates({
      name: ' digital calipers ',
      brand: 'Mitutoyo',
      model: '500 196 30',
    }, [current, archived])).toEqual([current]);
  });

  it('parses a rough list into reviewable, bounded candidates', () => {
    let id = 0;
    const candidates = parseInventoryPaste(
      '2x Digital calipers\nM3 heat-set inserts x 100 pcs\nBambu Lab P1S',
      [owned()],
      () => `candidate-${++id}`,
    );

    expect(candidates).toHaveLength(3);
    expect(candidates[0]).toMatchObject({
      id: 'candidate-1',
      duplicateItemIds: ['item-calipers'],
      draft: { name: 'Digital calipers', quantity: 2, unit: 'pcs', category: 'tool' },
    });
    expect(candidates[1].draft).toMatchObject({
      name: 'M3 heat-set inserts',
      quantity: 100,
      unit: 'pcs',
      category: 'fastener',
    });
    expect(candidates[2].uncertainFields).toEqual(expect.arrayContaining(['quantity', 'unit', 'category']));
  });
});
