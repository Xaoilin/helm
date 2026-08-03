import type {
  InventoryCategory,
  InventoryCondition,
  InventoryItem,
  InventoryNeed,
  InventoryNeedPriority,
  InventoryTrackingMode,
} from '../types/domain';

export const INVENTORY_LIMITS = {
  bulkItems: 100,
  name: 160,
  unit: 32,
  brand: 120,
  model: 120,
  location: 160,
  notes: 4_000,
  tags: 25,
  tag: 50,
  projects: 25,
  projectKey: 160,
  specifications: 30,
  specificationKey: 60,
  specificationValue: 200,
  quantity: 1_000_000_000,
} as const;

const CATEGORIES = new Set<InventoryCategory>([
  'machine', 'tool', 'electronics', 'component', 'material',
  'consumable', 'fastener', 'safety', 'storage', 'other',
]);
const TRACKING_MODES = new Set<InventoryTrackingMode>(['durable', 'counted', 'measured']);
const CONDITIONS = new Set<InventoryCondition>(['unknown', 'new', 'good', 'worn', 'needs_repair']);
const PRIORITIES = new Set<InventoryNeedPriority>(['low', 'normal', 'high']);

function text(value: unknown, label: string, max: number, required = false): string {
  const result = typeof value === 'string' ? value.trim() : '';
  if (required && !result) throw new Error(`${label} is required.`);
  if (result.length > max) throw new Error(`${label} must be ${max} characters or fewer.`);
  return result;
}

export function normalizeInventoryQuantity(value: unknown, label = 'Quantity'): number {
  const result = typeof value === 'number' ? value : Number(value);
  if (!Number.isFinite(result) || result < 0 || result > INVENTORY_LIMITS.quantity) {
    throw new Error(`${label} must be a finite number from 0 to ${INVENTORY_LIMITS.quantity}.`);
  }
  return result;
}

function stringList(value: unknown, label: string, count: number, size: number): string[] {
  if (value == null) return [];
  if (!Array.isArray(value)) throw new Error(`${label} must be a list.`);
  if (value.length > count) throw new Error(`${label} can contain at most ${count} values.`);
  return [...new Set(value.map((entry, index) => text(entry, `${label} value ${index + 1}`, size, true)))];
}

function specifications(value: unknown): Record<string, string> {
  if (value == null) return {};
  if (typeof value !== 'object' || Array.isArray(value)) throw new Error('Specifications must be an object.');
  const entries = Object.entries(value);
  if (entries.length > INVENTORY_LIMITS.specifications) {
    throw new Error(`Specifications can contain at most ${INVENTORY_LIMITS.specifications} fields.`);
  }
  return Object.fromEntries(entries.map(([key, entry]) => [
    text(key, 'Specification name', INVENTORY_LIMITS.specificationKey, true),
    text(entry, `Specification ${key}`, INVENTORY_LIMITS.specificationValue, true),
  ]));
}

export type InventoryItemDraft = Omit<InventoryItem, 'id' | 'createdAt' | 'updatedAt'>;
export type InventoryNeedDraft = Omit<InventoryNeed, 'id' | 'createdAt' | 'updatedAt'>;

export function normalizeInventoryItemDraft(
  input: Partial<InventoryItemDraft> & Pick<InventoryItemDraft, 'name'>,
  now = new Date().toISOString(),
): InventoryItemDraft {
  const category = input.category ?? 'other';
  const trackingMode = input.trackingMode ?? 'counted';
  const condition = input.condition ?? 'unknown';
  if (!CATEGORIES.has(category)) throw new Error('Inventory category is invalid.');
  if (!TRACKING_MODES.has(trackingMode)) throw new Error('Inventory tracking mode is invalid.');
  if (!CONDITIONS.has(condition)) throw new Error('Inventory condition is invalid.');

  const lowStockThreshold = input.lowStockThreshold == null
    ? undefined
    : normalizeInventoryQuantity(input.lowStockThreshold, 'Low-stock threshold');
  const archivedAt = input.archivedAt == null
    ? undefined
    : text(input.archivedAt, 'Archived timestamp', 64, true);

  return {
    name: text(input.name, 'Name', INVENTORY_LIMITS.name, true),
    category,
    trackingMode,
    quantity: normalizeInventoryQuantity(input.quantity ?? (trackingMode === 'durable' ? 1 : 0)),
    unit: text(input.unit ?? (trackingMode === 'durable' ? 'item' : 'pcs'), 'Unit', INVENTORY_LIMITS.unit, true),
    ...(lowStockThreshold == null ? {} : { lowStockThreshold }),
    ...(text(input.brand, 'Brand', INVENTORY_LIMITS.brand) ? { brand: text(input.brand, 'Brand', INVENTORY_LIMITS.brand) } : {}),
    ...(text(input.model, 'Model', INVENTORY_LIMITS.model) ? { model: text(input.model, 'Model', INVENTORY_LIMITS.model) } : {}),
    specifications: specifications(input.specifications),
    condition,
    ...(text(input.location, 'Location', INVENTORY_LIMITS.location) ? { location: text(input.location, 'Location', INVENTORY_LIMITS.location) } : {}),
    tags: stringList(input.tags, 'Tags', INVENTORY_LIMITS.tags, INVENTORY_LIMITS.tag),
    notes: text(input.notes, 'Notes', INVENTORY_LIMITS.notes),
    projectCatalogKeys: stringList(
      input.projectCatalogKeys,
      'Linked projects',
      INVENTORY_LIMITS.projects,
      INVENTORY_LIMITS.projectKey,
    ),
    lastVerifiedAt: text(input.lastVerifiedAt ?? now, 'Last verified timestamp', 64, true),
    ...(archivedAt ? { archivedAt } : {}),
  };
}

export function normalizeInventoryNeedDraft(
  input: Partial<InventoryNeedDraft> & Pick<InventoryNeedDraft, 'name'>,
): InventoryNeedDraft {
  const priority = input.priority ?? 'normal';
  const status = input.status ?? 'needed';
  if (!PRIORITIES.has(priority)) throw new Error('Inventory need priority is invalid.');
  if (!['needed', 'ordered', 'acquired', 'dismissed'].includes(status)) {
    throw new Error('Inventory need status is invalid.');
  }
  const optionalTimestamp = (value: unknown, label: string) => {
    const result = text(value, label, 64);
    return result || undefined;
  };
  return {
    name: text(input.name, 'Name', INVENTORY_LIMITS.name, true),
    ...(text(input.linkedItemId, 'Linked item', 256) ? { linkedItemId: text(input.linkedItemId, 'Linked item', 256) } : {}),
    ...(text(input.projectCatalogKey, 'Linked project', INVENTORY_LIMITS.projectKey)
      ? { projectCatalogKey: text(input.projectCatalogKey, 'Linked project', INVENTORY_LIMITS.projectKey) }
      : {}),
    requiredQuantity: normalizeInventoryQuantity(input.requiredQuantity ?? 1, 'Required quantity'),
    unit: text(input.unit ?? 'pcs', 'Unit', INVENTORY_LIMITS.unit, true),
    specifications: specifications(input.specifications),
    priority,
    status,
    notes: text(input.notes, 'Notes', INVENTORY_LIMITS.notes),
    ...(optionalTimestamp(input.orderedAt, 'Ordered timestamp') ? { orderedAt: optionalTimestamp(input.orderedAt, 'Ordered timestamp') } : {}),
    ...(optionalTimestamp(input.acquiredAt, 'Acquired timestamp') ? { acquiredAt: optionalTimestamp(input.acquiredAt, 'Acquired timestamp') } : {}),
    ...(optionalTimestamp(input.dismissedAt, 'Dismissed timestamp') ? { dismissedAt: optionalTimestamp(input.dismissedAt, 'Dismissed timestamp') } : {}),
  };
}

export function isInventoryLowStock(item: InventoryItem): boolean {
  return !item.archivedAt
    && item.lowStockThreshold != null
    && item.quantity <= item.lowStockThreshold;
}

export function hasSufficientInventory(item: InventoryItem | undefined, requiredQuantity: number, unit?: string): boolean {
  if (!item || item.archivedAt) return false;
  if (unit && item.unit.toLocaleLowerCase() !== unit.trim().toLocaleLowerCase()) return false;
  return item.quantity >= normalizeInventoryQuantity(requiredQuantity, 'Required quantity');
}

export function inventoryIdentity(value: Pick<InventoryItem, 'name' | 'brand' | 'model'>): string {
  return [value.name, value.brand, value.model]
    .map(entry => (entry || '').normalize('NFKC').trim().toLocaleLowerCase().replace(/[^a-z0-9]+/g, ' '))
    .join('|');
}

export function findLikelyInventoryDuplicates(
  candidate: Pick<InventoryItem, 'name' | 'brand' | 'model'>,
  items: InventoryItem[],
): InventoryItem[] {
  const identity = inventoryIdentity(candidate);
  const candidateName = candidate.name.normalize('NFKC').trim().toLocaleLowerCase();
  return items.filter(item => !item.archivedAt && (
    inventoryIdentity(item) === identity
    || item.name.normalize('NFKC').trim().toLocaleLowerCase() === candidateName
  ));
}

export interface InventoryPasteCandidate {
  id: string;
  selected: boolean;
  draft: InventoryItemDraft;
  sourceLine: string;
  uncertainFields: Array<'name' | 'quantity' | 'unit' | 'category'>;
  duplicateItemIds: string[];
}

function inferCategory(name: string): InventoryCategory {
  const value = name.toLocaleLowerCase();
  if (/printer|soldering station|multimeter|oscilloscope|drill|saw/.test(value)) return 'machine';
  if (/screw|bolt|nut|washer|insert|fastener/.test(value)) return 'fastener';
  if (/filament|resin|wire|sheet|tube|timber|wood|acrylic/.test(value)) return 'material';
  if (/glove|goggle|mask|respirator|helmet/.test(value)) return 'safety';
  if (/sensor|led|resistor|capacitor|connector|arduino|raspberry|pcb|motor/.test(value)) return 'electronics';
  if (/tape|glue|flux|oil|paint|battery/.test(value)) return 'consumable';
  if (/driver|wrench|spanner|plier|cutter|caliper|knife|hammer|tool/.test(value)) return 'tool';
  return 'other';
}

export function parseInventoryPaste(
  input: string,
  existingItems: InventoryItem[] = [],
  createId: () => string = () => crypto.randomUUID(),
): InventoryPasteCandidate[] {
  const lines = input
    .split(/\r?\n/)
    .map(line => line.replace(/^\s*(?:[-*•]|\d+[.)])\s*/, '').trim())
    .filter(Boolean)
    .slice(0, INVENTORY_LIMITS.bulkItems);

  return lines.map(line => {
    let name = line;
    let quantity = 1;
    let unit = 'pcs';
    let parsedQuantity = false;
    const prefix = line.match(/^([0-9]+(?:\.[0-9]+)?)\s*(?:x|×)?\s*(pcs?|pieces?|items?|kg|g|m|mm|cm|l|ml)?\s+(.+)$/i);
    const suffix = line.match(/^(.+?)\s+(?:x|×)\s*([0-9]+(?:\.[0-9]+)?)\s*(pcs?|pieces?|items?|kg|g|m|mm|cm|l|ml)?$/i);
    if (prefix) {
      quantity = normalizeInventoryQuantity(prefix[1]);
      unit = (prefix[2] || 'pcs').toLocaleLowerCase();
      name = prefix[3].trim();
      parsedQuantity = true;
    } else if (suffix) {
      name = suffix[1].trim();
      quantity = normalizeInventoryQuantity(suffix[2]);
      unit = (suffix[3] || 'pcs').toLocaleLowerCase();
      parsedQuantity = true;
    }

    const category = inferCategory(name);
    const draft = normalizeInventoryItemDraft({
      name,
      category,
      trackingMode: quantity === 1 && unit === 'item' ? 'durable' : 'counted',
      quantity,
      unit: unit === 'piece' || unit === 'pieces' || unit === 'pc' ? 'pcs' : unit,
      specifications: {},
      condition: 'unknown',
      tags: [],
      notes: '',
      projectCatalogKeys: [],
    });
    return {
      id: createId(),
      selected: true,
      draft,
      sourceLine: line,
      uncertainFields: [
        ...(!parsedQuantity ? ['quantity' as const, 'unit' as const] : []),
        ...(category === 'other' ? ['category' as const] : []),
      ],
      duplicateItemIds: findLikelyInventoryDuplicates(draft as InventoryItem, existingItems).map(item => item.id),
    };
  });
}
