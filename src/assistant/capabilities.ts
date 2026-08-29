import type { InventoryCategory, InventoryCondition, InventoryNeedPriority, InventorySubcategory, InventoryTrackingMode, Surface, TaskCategory, TaskPriority } from '../types/domain';
import { INVENTORY_SUBCATEGORY_OPTIONS } from '../inventory/inventoryModel';

export type ConfirmationRule = 'never' | 'always' | 'on_ambiguity';
export type AssistantActionStatus = 'live' | 'planned' | 'disabled';
export type AssistantActionDomain = 'navigation' | 'inventory' | 'tasks' | 'calendar' | 'finance' | 'knowledge';
export type AssistantActionArgType = 'string' | 'string_array' | 'boolean' | 'enum';

export interface AssistantActionArgDefinition {
  key: string;
  label: string;
  description: string;
  type: AssistantActionArgType;
  required: boolean;
  values?: readonly string[];
}

export interface AssistantActionDefinition {
  id: string;
  title: string;
  description: string;
  domain: AssistantActionDomain;
  status: AssistantActionStatus;
  examples: string[];
  aliases: string[];
  confirmationRule: ConfirmationRule;
  executorKey: string;
  debugSummary: string;
  args: readonly AssistantActionArgDefinition[];
}

const SURFACE_VALUES: readonly Surface[] = [
  'dashboard',
  'chat',
  'calendar',
  'clock',
  'trips',
  'projects',
  'inventory',
  'secrets',
  'tasks',
  'employment',
  'finance',
  'health',
  'knowledge',
  'profile',
  'integrations',
  'activity',
  'settings',
  'debug',
];

const TASK_TAB_VALUES = ['today', 'all', 'goals'] as const;
const TASK_PRIORITY_VALUES: readonly TaskPriority[] = ['high', 'medium', 'low'];
const TASK_CATEGORY_VALUES: readonly TaskCategory[] = ['daily', 'prayer', 'task', 'goal'];
const PRAYER_COMPLETION_STATUS_VALUES = ['on_time', 'late'] as const;
const INVENTORY_CATEGORY_VALUES: readonly InventoryCategory[] = [
  'machine', 'tool', 'electronics', 'component', 'material',
  'consumable', 'fastener', 'safety', 'storage', 'other',
];
const INVENTORY_TRACKING_VALUES: readonly InventoryTrackingMode[] = ['durable', 'counted', 'measured'];
const INVENTORY_CONDITION_VALUES: readonly InventoryCondition[] = ['unknown', 'new', 'good', 'worn', 'needs_repair'];
const INVENTORY_NEED_PRIORITY_VALUES: readonly InventoryNeedPriority[] = ['low', 'normal', 'high'];
const INVENTORY_SUBCATEGORY_VALUES: readonly InventorySubcategory[] = INVENTORY_SUBCATEGORY_OPTIONS.map(option => option.value);
export const ASSISTANT_ACTIONS = [
  {
    id: 'inventory.lookup',
    title: 'Check Inventory',
    description: 'Search owned stock and open needs before recommending a purchase.',
    domain: 'inventory',
    status: 'live',
    examples: ['Do I already have M3 inserts?', 'Check my inventory for soldering tools'],
    aliases: ['check inventory', 'do I have', 'in stock', 'already own'],
    confirmationRule: 'never',
    executorKey: 'inventory_lookup',
    debugSummary: 'Searches live account inventory without changing it.',
    args: [
      {
        key: 'query',
        label: 'Query',
        description: 'Item, tool, material, specification, tag, or location to find.',
        type: 'string',
        required: true,
      },
    ],
  },
  {
    id: 'inventory.add_item',
    title: 'Add Inventory Item',
    description: 'Add one explicitly requested owned item to account inventory.',
    domain: 'inventory',
    status: 'live',
    examples: ['Add 2 digital calipers to my inventory', 'I own a Bambu Lab P1S; add it'],
    aliases: ['add to inventory', 'I own', 'save this tool', 'add stock'],
    confirmationRule: 'on_ambiguity',
    executorKey: 'inventory_add_item',
    debugSummary: 'Validates and creates one owned inventory record. Multiline bulk input routes to Inventory review.',
    args: [
      { key: 'name', label: 'Name', description: 'Exact item name.', type: 'string', required: true },
      { key: 'quantity', label: 'Quantity', description: 'Finite non-negative quantity as text.', type: 'string', required: true },
      { key: 'unit', label: 'Unit', description: 'Quantity unit.', type: 'string', required: true },
      {
        key: 'category', label: 'Category', description: 'Inventory category.',
        type: 'enum',
        required: true,
        values: INVENTORY_CATEGORY_VALUES,
      },
      { key: 'trackingMode', label: 'Tracking mode', description: 'Durable, counted, or measured stock.', type: 'enum', required: true, values: INVENTORY_TRACKING_VALUES },
      { key: 'condition', label: 'Condition', description: 'Current item condition.', type: 'enum', required: false, values: INVENTORY_CONDITION_VALUES },
      { key: 'subcategory', label: 'Category detail', description: 'Practical Inventory category such as hand tools or screws and fasteners.', type: 'enum', required: false, values: INVENTORY_SUBCATEGORY_VALUES },
      { key: 'brand', label: 'Brand', description: 'Optional brand.', type: 'string', required: false },
      { key: 'model', label: 'Model', description: 'Optional model.', type: 'string', required: false },
      { key: 'location', label: 'Location', description: 'Optional storage location.', type: 'string', required: false },
      { key: 'imageUrl', label: 'Product image', description: 'Optional HTTPS product image URL.', type: 'string', required: false },
      { key: 'projectCatalogKeys', label: 'Projects', description: 'Stable linked project catalogue keys.', type: 'string_array', required: false },
      { key: 'dimensions', label: 'Dimensions', description: 'Optional JSON dimensions, for example {"length":120,"width":60,"unit":"cm"}.', type: 'string', required: false },
      { key: 'specifications', label: 'Specifications', description: 'Optional newline-separated name: value specifications.', type: 'string', required: false },
    ],
  },
  {
    id: 'inventory.adjust_quantity',
    title: 'Adjust Inventory Quantity',
    description: 'Increase or decrease the quantity of one grounded inventory item.',
    domain: 'inventory',
    status: 'live',
    examples: ['Add 5 to my M3 insert stock', 'I used 2 ESP32 boards'],
    aliases: ['adjust stock', 'used from inventory', 'increase quantity', 'decrease quantity'],
    confirmationRule: 'on_ambiguity',
    executorKey: 'inventory_adjust_quantity',
    debugSummary: 'Applies a finite delta while preventing negative inventory.',
    args: [
      { key: 'itemId', label: 'Item ID', description: 'Grounded inventory item ID.', type: 'string', required: true },
      { key: 'delta', label: 'Delta', description: 'Signed finite quantity adjustment as text.', type: 'string', required: true },
    ],
  },
  {
    id: 'inventory.add_need',
    title: 'Add Inventory Need',
    description: 'Record one explicitly requested requirement for later acquisition.',
    domain: 'inventory',
    status: 'live',
    examples: ['I need 20 M3 heat-set inserts for MAGNUS', 'Add a need for one soldering iron'],
    aliases: ['need to buy', 'add inventory need', 'need more', 'shopping requirement'],
    confirmationRule: 'on_ambiguity',
    executorKey: 'inventory_add_need',
    debugSummary: 'Creates one bounded need without purchasing anything.',
    args: [
      { key: 'name', label: 'Name', description: 'Needed item name.', type: 'string', required: true },
      { key: 'requiredQuantity', label: 'Quantity', description: 'Finite non-negative required quantity as text.', type: 'string', required: true },
      { key: 'unit', label: 'Unit', description: 'Quantity unit.', type: 'string', required: true },
      { key: 'category', label: 'Group', description: 'Optional broad Inventory group.', type: 'enum', required: false, values: INVENTORY_CATEGORY_VALUES },
      { key: 'subcategory', label: 'Category', description: 'Optional practical Inventory category.', type: 'enum', required: false, values: INVENTORY_SUBCATEGORY_VALUES },
      { key: 'imageUrl', label: 'Product image', description: 'Optional HTTPS product image URL.', type: 'string', required: false },
      { key: 'linkedItemId', label: 'Linked item', description: 'Optional grounded owned item ID.', type: 'string', required: false },
      { key: 'projectCatalogKey', label: 'Project', description: 'Optional stable project catalogue key.', type: 'string', required: false },
      { key: 'priority', label: 'Priority', description: 'Need priority.', type: 'enum', required: false, values: INVENTORY_NEED_PRIORITY_VALUES },
      { key: 'dimensions', label: 'Dimensions', description: 'Optional JSON dimensions, for example {"length":120,"width":60,"unit":"cm"}.', type: 'string', required: false },
      { key: 'specifications', label: 'Specifications', description: 'Optional newline-separated name: value specifications.', type: 'string', required: false },
      { key: 'notes', label: 'Notes', description: 'Optional requirement notes.', type: 'string', required: false },
    ],
  },
  {
    id: 'inventory.complete_need',
    title: 'Mark Inventory Need Acquired',
    description: 'Atomically add acquired stock and close one grounded need.',
    domain: 'inventory',
    status: 'live',
    examples: ['Mark the M3 insert need acquired', 'I bought that soldering iron'],
    aliases: ['mark acquired', 'bought that', 'complete inventory need'],
    confirmationRule: 'on_ambiguity',
    executorKey: 'inventory_complete_need',
    debugSummary: 'Updates stock and closes the need in the same persistence batch.',
    args: [
      { key: 'needId', label: 'Need ID', description: 'Grounded inventory need ID.', type: 'string', required: true },
    ],
  },
  {
    id: 'navigation.go_to_surface',
    title: 'Go To Surface',
    description: 'Navigate Lina to a top-level app surface.',
    domain: 'navigation',
    status: 'live',
    examples: ['Open calendar', 'Take me to finance'],
    aliases: ['open calendar', 'go to settings', 'take me to chat'],
    confirmationRule: 'never',
    executorKey: 'navigate_surface',
    debugSummary: 'Top-level app navigation only.',
    args: [
      {
        key: 'surface',
        label: 'Surface',
        description: 'The top-level Sabah One surface to open.',
        type: 'enum',
        required: true,
        values: SURFACE_VALUES,
      },
      {
        key: 'projectId',
        label: 'Project ID',
        description: 'Optional grounded project identifier when opening a specific project inside Projects.',
        type: 'string',
        required: false,
      },
    ],
  },
  {
    id: 'tasks.open_view',
    title: 'Open Tasks View',
    description: 'Open the Tasks surface to a specific tab without requiring a specific task.',
    domain: 'tasks',
    status: 'live',
    examples: ['Show me all my tasks', 'Show my goals', "Show today's tasks"],
    aliases: ['all tasks', 'my goals', "today's tasks"],
    confirmationRule: 'never',
    executorKey: 'open_tasks_view',
    debugSummary: 'Switches the Tasks surface to Today, All Tasks, or Goals and can reset filters.',
    args: [
      {
        key: 'tab',
        label: 'Tab',
        description: 'The task tab to open.',
        type: 'enum',
        required: true,
        values: TASK_TAB_VALUES,
      },
      {
        key: 'resetFilters',
        label: 'Reset Filters',
        description: 'Whether to clear task filters before showing the view.',
        type: 'boolean',
        required: false,
      },
    ],
  },
  {
    id: 'tasks.create_task',
    title: 'Create Task',
    description: 'Create a task, habit, or goal in the tasks domain.',
    domain: 'tasks',
    status: 'live',
    examples: ['Add task buy milk tomorrow', 'Create a daily habit for Fajr'],
    aliases: ['add task', 'create task', 'new habit', 'new goal'],
    confirmationRule: 'never',
    executorKey: 'create_task',
    debugSummary: 'Creates tasks, daily habits, and goals through the shared task mutation path.',
    args: [
      {
        key: 'title',
        label: 'Title',
        description: 'The saved task title.',
        type: 'string',
        required: true,
      },
      {
        key: 'priority',
        label: 'Priority',
        description: 'Task priority.',
        type: 'enum',
        required: true,
        values: TASK_PRIORITY_VALUES,
      },
      {
        key: 'category',
        label: 'Category',
        description: 'The task category.',
        type: 'enum',
        required: true,
        values: TASK_CATEGORY_VALUES,
      },
      {
        key: 'dueDate',
        label: 'Due Date',
        description: 'The resolved local due date if available.',
        type: 'string',
        required: false,
      },
      {
        key: 'duePhrase',
        label: 'Due Phrase',
        description: 'The original natural-language due phrase when resolution was partial.',
        type: 'string',
        required: false,
      },
    ],
  },
  {
    id: 'tasks.reveal_task',
    title: 'Reveal Task',
    description: 'Open the Tasks surface, select the right tab, and reveal a specific task.',
    domain: 'tasks',
    status: 'live',
    examples: ['Show me that task', 'Open task buy milk'],
    aliases: ['show me that task', 'open task', 'find task'],
    confirmationRule: 'never',
    executorKey: 'reveal_task',
    debugSummary: 'Uses task resolution plus a typed Tasks navigation payload to focus a specific item.',
    args: [
      {
        key: 'taskId',
        label: 'Task ID',
        description: 'The grounded task identifier to reveal.',
        type: 'string',
        required: true,
      },
    ],
  },
  {
    id: 'tasks.complete_matching',
    title: 'Complete Task',
    description: 'Mark a matching task or habit as complete. Prayer completions may include an explicit on-time or late outcome.',
    domain: 'tasks',
    status: 'live',
    examples: ['Mark ship launch checklist done', 'Complete my water habit', 'I prayed Fajr on time', 'Mark Isha as prayed late'],
    aliases: ['mark done', 'complete task', 'complete habit', 'prayed on time', 'prayed late'],
    confirmationRule: 'on_ambiguity',
    executorKey: 'complete_task',
    debugSummary: 'Resolves an incomplete task or habit and marks it complete through the shared task executor.',
    args: [
      {
        key: 'taskId',
        label: 'Task ID',
        description: 'The grounded task or habit identifier to complete.',
        type: 'string',
        required: true,
      },
      {
        key: 'prayerStatus',
        label: 'Prayer Status',
        description: 'Use on_time or late only when the user explicitly classifies a prayer. Omit it when they have not said which.',
        type: 'enum',
        required: false,
        values: PRAYER_COMPLETION_STATUS_VALUES,
      },
    ],
  },
  {
    id: 'tasks.delete_matching',
    title: 'Delete Task',
    description: 'Delete a matching task, habit, or goal.',
    domain: 'tasks',
    status: 'live',
    examples: ['Delete the mirror task', 'Remove all tasks related to mirrors'],
    aliases: ['delete task', 'remove task', 'trash task'],
    confirmationRule: 'always',
    executorKey: 'delete_task',
    debugSummary: 'Deletes one or more resolved tasks after confirmation.',
    args: [
      {
        key: 'taskIds',
        label: 'Task IDs',
        description: 'One or more grounded task identifiers to delete.',
        type: 'string_array',
        required: true,
      },
    ],
  },
  {
    id: 'calendar.create_event',
    title: 'Create Event',
    description: 'Create a calendar event on a resolved calendar source.',
    domain: 'calendar',
    status: 'live',
    examples: ['Schedule dentist tomorrow at 3pm', 'Add a meeting with Sam next Friday morning'],
    aliases: ['schedule event', 'create meeting', 'book appointment'],
    confirmationRule: 'never',
    executorKey: 'create_calendar_event',
    debugSummary: 'Creates calendar events after calendar and time resolution.',
    args: [
      {
        key: 'title',
        label: 'Title',
        description: 'The saved event title.',
        type: 'string',
        required: true,
      },
      {
        key: 'timePhrase',
        label: 'Time Phrase',
        description: 'Original natural-language time phrase when supplied.',
        type: 'string',
        required: false,
      },
      {
        key: 'start',
        label: 'Start',
        description: 'Resolved event start time.',
        type: 'string',
        required: false,
      },
      {
        key: 'end',
        label: 'End',
        description: 'Resolved event end time.',
        type: 'string',
        required: false,
      },
      {
        key: 'calendarSourceId',
        label: 'Calendar Source ID',
        description: 'Optional grounded calendar source identifier.',
        type: 'string',
        required: false,
      },
      {
        key: 'description',
        label: 'Description',
        description: 'Optional event description.',
        type: 'string',
        required: false,
      },
      {
        key: 'location',
        label: 'Location',
        description: 'Optional event location.',
        type: 'string',
        required: false,
      },
    ],
  },
  {
    id: 'calendar.reschedule_event',
    title: 'Reschedule Event',
    description: 'Move an existing event to a new time.',
    domain: 'calendar',
    status: 'live',
    examples: ['Move my 3pm to tomorrow after lunch', 'Push the design review back an hour'],
    aliases: ['move event', 'reschedule event', 'push meeting'],
    confirmationRule: 'always',
    executorKey: 'reschedule_calendar_event',
    debugSummary: 'Reschedules a resolved event after confirmation.',
    args: [
      {
        key: 'eventId',
        label: 'Event ID',
        description: 'The grounded event identifier to reschedule.',
        type: 'string',
        required: true,
      },
      {
        key: 'timePhrase',
        label: 'Time Phrase',
        description: 'Original natural-language target time phrase when supplied.',
        type: 'string',
        required: false,
      },
      {
        key: 'start',
        label: 'Start',
        description: 'Resolved target start time.',
        type: 'string',
        required: false,
      },
      {
        key: 'end',
        label: 'End',
        description: 'Resolved target end time.',
        type: 'string',
        required: false,
      },
    ],
  },
  {
    id: 'finance.record_transaction',
    title: 'Record Transaction',
    description: 'Record income, expense, or transfer in finance.',
    domain: 'finance',
    status: 'live',
    examples: ['Log £12.50 for coffee from Monzo', 'Record salary of £2500'],
    aliases: ['record expense', 'record income', 'log transaction'],
    confirmationRule: 'never',
    executorKey: 'record_finance_transaction',
    debugSummary: 'Records finance transactions against a resolved account.',
    args: [
      {
        key: 'type',
        label: 'Type',
        description: 'Transaction type.',
        type: 'enum',
        required: true,
        values: ['income', 'expense', 'transfer'],
      },
      {
        key: 'amount',
        label: 'Amount',
        description: 'Raw amount provided by the user.',
        type: 'string',
        required: true,
      },
      {
        key: 'description',
        label: 'Description',
        description: 'Transaction description.',
        type: 'string',
        required: false,
      },
      {
        key: 'accountId',
        label: 'Account ID',
        description: 'Optional grounded finance account identifier.',
        type: 'string',
        required: false,
      },
      {
        key: 'date',
        label: 'Date',
        description: 'Optional transaction date.',
        type: 'string',
        required: false,
      },
    ],
  },
  {
    id: 'knowledge.create_entry',
    title: 'Create Knowledge Entry',
    description: 'Create a knowledge note under an existing topic.',
    domain: 'knowledge',
    status: 'live',
    examples: ['Save a note about patience under Aqeedah', 'Create a knowledge entry on salah etiquette'],
    aliases: ['save note', 'create note', 'knowledge entry'],
    confirmationRule: 'never',
    executorKey: 'create_knowledge_entry',
    debugSummary: 'Creates knowledge entries under resolved topics.',
    args: [
      {
        key: 'title',
        label: 'Title',
        description: 'Entry title.',
        type: 'string',
        required: false,
      },
      {
        key: 'content',
        label: 'Content',
        description: 'Entry body content.',
        type: 'string',
        required: true,
      },
      {
        key: 'topicId',
        label: 'Topic ID',
        description: 'Optional grounded knowledge topic identifier.',
        type: 'string',
        required: false,
      },
    ],
  },
] as const satisfies readonly AssistantActionDefinition[];

export type CapabilityDefinition = AssistantActionDefinition;
export type CapabilityId = typeof ASSISTANT_ACTIONS[number]['id'];
export const CAPABILITIES = ASSISTANT_ACTIONS;

const capabilityMap = new Map<string, CapabilityDefinition>(ASSISTANT_ACTIONS.map(capability => [capability.id, capability]));

export function getCapabilityDefinition(id: CapabilityId): CapabilityDefinition {
  const capability = capabilityMap.get(id);
  if (!capability) {
    throw new Error(`Unknown capability: ${id}`);
  }
  return capability;
}

export function getAllCapabilityDefinitions(): readonly CapabilityDefinition[] {
  return ASSISTANT_ACTIONS;
}

export function getLiveCapabilityDefinitions(): readonly CapabilityDefinition[] {
  return ASSISTANT_ACTIONS.filter(capability => capability.status === 'live');
}

export function isKnownCapabilityId(id: string): id is CapabilityId {
  return capabilityMap.has(id);
}

export function isCapabilityLive(id: string): id is CapabilityId {
  return capabilityMap.get(id)?.status === 'live';
}

export function listCapabilitiesForPrompt(capabilities: readonly CapabilityDefinition[] = getLiveCapabilityDefinitions()): string {
  return capabilities.map(capability => {
    const args = capability.args.length > 0
      ? capability.args
        .map(arg => {
          const required = arg.required ? 'required' : 'optional';
          const values = arg.values && arg.values.length > 0 ? ` (${arg.values.join(', ')})` : '';
          return `${arg.key}${values} [${arg.type}, ${required}]`;
        })
        .join(', ')
      : 'none';
    const examples = capability.examples.map(example => `"${example}"`).join(', ');
    return `- ${capability.id}: ${capability.description}. Args: ${args}. Examples: ${examples}.`;
  }).join('\n');
}
