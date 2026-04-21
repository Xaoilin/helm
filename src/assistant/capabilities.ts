import type { Surface, TaskCategory, TaskPriority } from '../types/domain';

export type ConfirmationRule = 'never' | 'always' | 'on_ambiguity';
export type AssistantActionStatus = 'live' | 'planned' | 'disabled';
export type AssistantActionDomain = 'navigation' | 'tasks' | 'calendar' | 'finance' | 'knowledge';
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
  'tasks',
  'finance',
  'health',
  'knowledge',
  'profile',
  'integrations',
  'settings',
  'debug',
];

const TASK_TAB_VALUES = ['today', 'all', 'goals'] as const;
const TASK_PRIORITY_VALUES: readonly TaskPriority[] = ['high', 'medium', 'low'];
const TASK_CATEGORY_VALUES: readonly TaskCategory[] = ['daily', 'prayer', 'task', 'goal'];
export const ASSISTANT_ACTIONS = [
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
        description: 'The top-level HELM surface to open.',
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
    description: 'Mark a matching task or habit as complete.',
    domain: 'tasks',
    status: 'live',
    examples: ['Mark ship launch checklist done', 'Complete my water habit'],
    aliases: ['mark done', 'complete task', 'complete habit'],
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
