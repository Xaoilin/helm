import type {
  InventoryCategory,
  InventoryCondition,
  InventoryItem,
  InventoryNeed,
  InventoryNeedPriority,
  InventorySubcategory,
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
  imageUrl: 2_048,
  quantity: 1_000_000_000,
} as const;

const CATEGORIES = new Set<InventoryCategory>([
  'machine', 'tool', 'electronics', 'component', 'material',
  'consumable', 'fastener', 'safety', 'storage', 'other',
]);
const TRACKING_MODES = new Set<InventoryTrackingMode>(['durable', 'counted', 'measured']);
const CONDITIONS = new Set<InventoryCondition>(['unknown', 'new', 'good', 'worn', 'needs_repair']);
const PRIORITIES = new Set<InventoryNeedPriority>(['low', 'normal', 'high']);

export interface InventorySubcategoryOption {
  value: InventorySubcategory;
  label: string;
  category: InventoryCategory;
}

export const INVENTORY_SUBCATEGORY_OPTIONS: readonly InventorySubcategoryOption[] = [
  { value: '3d_printers', label: '3D Printers', category: 'machine' },
  { value: 'other_machines', label: 'Other Machines', category: 'machine' },
  { value: 'workshop_equipment', label: 'Workshop Equipment', category: 'tool' },
  { value: 'general_tools', label: 'General Tools', category: 'tool' },
  { value: 'hand_tools', label: 'Hand Tools', category: 'tool' },
  { value: 'power_tools', label: 'Power Tools', category: 'tool' },
  { value: 'measuring_tools', label: 'Measuring Tools', category: 'tool' },
  { value: 'screws_fasteners', label: 'Screws & Fasteners', category: 'fastener' },
  { value: 'filament', label: '3D Printing Filament', category: 'material' },
  { value: 'resin', label: '3D Printing Resin', category: 'material' },
  { value: 'wire_cable', label: 'Wire & Cable', category: 'material' },
  { value: 'connectors_terminals', label: 'Connectors & Terminals', category: 'component' },
  { value: 'power_supplies', label: 'Power Supplies', category: 'electronics' },
  { value: 'power_modules', label: 'Power Modules', category: 'component' },
  { value: 'switches_relays', label: 'Switches & Relays', category: 'component' },
  { value: 'microcontrollers', label: 'Microcontrollers', category: 'electronics' },
  { value: 'prototyping_boards', label: 'Prototyping Boards', category: 'component' },
  { value: 'fuses_protection', label: 'Fuses & Protection', category: 'component' },
  { value: 'lights_alarms', label: 'Lights & Alarms', category: 'component' },
  { value: 'heat_shrink_sleeving', label: 'Heat Shrink & Sleeving', category: 'consumable' },
  { value: 'cable_management', label: 'Cable Management', category: 'consumable' },
  { value: 'magnets', label: 'Magnets', category: 'component' },
  { value: 'adhesives_tapes', label: 'Adhesives & Tapes', category: 'material' },
  { value: 'mechanical_hardware', label: 'Mechanical Hardware', category: 'component' },
  { value: 'general_components', label: 'General Components', category: 'component' },
  { value: 'general_electronics', label: 'General Electronics', category: 'electronics' },
  { value: 'general_materials', label: 'General Materials', category: 'material' },
  { value: 'general_consumables', label: 'General Consumables', category: 'consumable' },
  { value: 'storage_organisation', label: 'Storage & Organisation', category: 'storage' },
  { value: 'safety_equipment', label: 'Safety Equipment', category: 'safety' },
  { value: 'other', label: 'Other', category: 'other' },
] as const;

const SUBCATEGORY_BY_VALUE = new Map(
  INVENTORY_SUBCATEGORY_OPTIONS.map(option => [option.value, option]),
);

export function inventorySubcategoryMeta(value: InventorySubcategory | undefined): InventorySubcategoryOption | undefined {
  return value ? SUBCATEGORY_BY_VALUE.get(value) : undefined;
}

export function inventoryCategoryForSubcategory(value: InventorySubcategory): InventoryCategory {
  const option = SUBCATEGORY_BY_VALUE.get(value);
  if (!option) throw new Error('Inventory subcategory is invalid.');
  return option.category;
}

export function inventoryMajorCategoryForRecord(
  value: { category?: InventoryCategory; subcategory?: InventorySubcategory },
): InventoryCategory {
  if (value.category) return value.category;
  if (value.subcategory) return inventoryCategoryForSubcategory(value.subcategory);
  return 'other';
}

export function defaultInventorySubcategory(category: InventoryCategory): InventorySubcategory {
  switch (category) {
    case 'machine': return 'other_machines';
    case 'tool': return 'general_tools';
    case 'electronics': return 'general_electronics';
    case 'component': return 'general_components';
    case 'material': return 'general_materials';
    case 'consumable': return 'general_consumables';
    case 'fastener': return 'screws_fasteners';
    case 'safety': return 'safety_equipment';
    case 'storage': return 'storage_organisation';
    case 'other': return 'other';
  }
}

function text(value: unknown, label: string, max: number, required = false): string {
  const result = typeof value === 'string' ? value.trim() : '';
  if (required && !result) throw new Error(`${label} is required.`);
  if (result.length > max) throw new Error(`${label} must be ${max} characters or fewer.`);
  return result;
}

export function normalizeInventoryImageUrl(value: unknown): string | undefined {
  const result = text(value, 'Image URL', INVENTORY_LIMITS.imageUrl);
  if (!result) return undefined;
  try {
    const parsed = new URL(result);
    if (
      parsed.protocol !== 'https:'
      || !parsed.hostname
      || parsed.username
      || parsed.password
      || !/^https:\/\/[^/@:\s]+(?::[0-9]{1,5})?(?:[/?#]\S*)?$/.test(result)
    ) {
      throw new Error();
    }
  } catch {
    throw new Error('Image URL must be a valid HTTPS address.');
  }
  return result;
}

function normalizeInventorySubcategory(
  category: InventoryCategory,
  value: unknown,
): InventorySubcategory | undefined {
  if (value == null || value === '') return undefined;
  if (typeof value !== 'string' || !SUBCATEGORY_BY_VALUE.has(value as InventorySubcategory)) {
    throw new Error('Inventory subcategory is invalid.');
  }
  const subcategory = value as InventorySubcategory;
  if (inventoryCategoryForSubcategory(subcategory) !== category) {
    throw new Error('Inventory subcategory does not match its category.');
  }
  return subcategory;
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
  const subcategory = normalizeInventorySubcategory(category, input.subcategory);
  const imageUrl = normalizeInventoryImageUrl(input.imageUrl);

  return {
    name: text(input.name, 'Name', INVENTORY_LIMITS.name, true),
    category,
    ...(subcategory ? { subcategory } : {}),
    ...(imageUrl ? { imageUrl } : {}),
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
  const requestedSubcategory = input.subcategory;
  const category = input.category ?? (
    requestedSubcategory ? inventoryCategoryForSubcategory(requestedSubcategory) : undefined
  );
  if (category != null && !CATEGORIES.has(category)) throw new Error('Inventory category is invalid.');
  const subcategory = category == null
    ? undefined
    : normalizeInventorySubcategory(category, requestedSubcategory);
  const imageUrl = normalizeInventoryImageUrl(input.imageUrl);
  return {
    name: text(input.name, 'Name', INVENTORY_LIMITS.name, true),
    ...(category ? { category } : {}),
    ...(subcategory ? { subcategory } : {}),
    ...(imageUrl ? { imageUrl } : {}),
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
  uncertainFields: Array<'name' | 'quantity' | 'unit' | 'category' | 'subcategory'>;
  duplicateItemIds: string[];
}

function inferClassification(name: string): { category: InventoryCategory; subcategory?: InventorySubcategory } {
  const value = name.toLocaleLowerCase();
  if (/3d\s*printer|filament printer|bambu\s+lab\s+(a1|p1|x1)|elegoo\s+(centauri|neptune|saturn|mars)|prusa\s+mk|creality\s+(ender|k1)/.test(value)) return { category: 'machine', subcategory: '3d_printers' };
  if (/cabinet jack|support rod|workshop equipment/.test(value)) return { category: 'tool', subcategory: 'workshop_equipment' };
  if (/caliper|multimeter|oscilloscope|gauge|measuring|ruler/.test(value)) return { category: 'tool', subcategory: 'measuring_tools' };
  if (/cordless|power tool|heat gun|electric screwdriver|drill|saw/.test(value)) return { category: 'tool', subcategory: 'power_tools' };
  if (/driver|wrench|spanner|plier|cutter|stripper|crimp|knife|hammer|tool/.test(value)) return { category: 'tool', subcategory: 'hand_tools' };
  if (/screw|bolt|nut|washer|insert|fastener/.test(value)) return { category: 'fastener', subcategory: 'screws_fasteners' };
  if (/filament/.test(value)) return { category: 'material', subcategory: 'filament' };
  if (/\bresin\b/.test(value)) return { category: 'material', subcategory: 'resin' };
  if (/power adapter|power supply|extension lead|power box/.test(value)) return { category: 'electronics', subcategory: 'power_supplies' };
  if (/step.?down|converter|regulator/.test(value)) return { category: 'component', subcategory: 'power_modules' };
  if (/relay|switch/.test(value)) return { category: 'component', subcategory: 'switches_relays' };
  if (/arduino|raspberry|pico|microcontroller/.test(value)) return { category: 'electronics', subcategory: 'microcontrollers' };
  if (/prototype|prototyping|\bpcb\b|breadboard/.test(value)) return { category: 'component', subcategory: 'prototyping_boards' };
  if (/fuse|circuit breaker/.test(value)) return { category: 'component', subcategory: 'fuses_protection' };
  if (/\bled\b|light|strobe|alarm|beacon/.test(value)) return { category: 'component', subcategory: 'lights_alarms' };
  if (/heat.?shrink|sleeving/.test(value)) return { category: 'consumable', subcategory: 'heat_shrink_sleeving' };
  if (/cable tie|cable management/.test(value)) return { category: 'consumable', subcategory: 'cable_management' };
  if (/connector|terminal|ferrule|\bjack\b|\bplug\b/.test(value)) return { category: 'component', subcategory: 'connectors_terminals' };
  if (/tape|glue|adhesive/.test(value)) return { category: 'material', subcategory: 'adhesives_tapes' };
  if (/magnet/.test(value)) return { category: 'component', subcategory: 'magnets' };
  if (/drawer slide|bracket|hinge|mechanical hardware/.test(value)) return { category: 'component', subcategory: 'mechanical_hardware' };
  if (/wire|cable/.test(value)) return { category: 'material', subcategory: 'wire_cable' };
  if (/glove|goggle|mask|respirator|helmet/.test(value)) return { category: 'safety', subcategory: 'safety_equipment' };
  if (/storage|organiser|organizer|drawer|bin/.test(value)) return { category: 'storage', subcategory: 'storage_organisation' };
  if (/sensor|resistor|capacitor|motor|electronics?/.test(value)) return { category: 'electronics', subcategory: 'general_electronics' };
  if (/sheet|tube|timber|wood|acrylic|material/.test(value)) return { category: 'material', subcategory: 'general_materials' };
  if (/flux|oil|paint|battery|consumable/.test(value)) return { category: 'consumable', subcategory: 'general_consumables' };
  if (/machine/.test(value)) return { category: 'machine', subcategory: 'other_machines' };
  return { category: 'other', subcategory: 'other' };
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

    const { category, subcategory } = inferClassification(name);
    const draft = normalizeInventoryItemDraft({
      name,
      category,
      subcategory,
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
        ...(category === 'other' ? ['category' as const, 'subcategory' as const] : []),
      ],
      duplicateItemIds: findLikelyInventoryDuplicates(draft as InventoryItem, existingItems).map(item => item.id),
    };
  });
}
