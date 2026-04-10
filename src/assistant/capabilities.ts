import type { CapabilityId } from './plannerSchema';

export type ConfirmationRule = 'never' | 'always' | 'on_ambiguity';

export interface CapabilityDefinition {
  id: CapabilityId;
  title: string;
  description: string;
  examples: string[];
  confirmationRule: ConfirmationRule;
}

export const CAPABILITIES: CapabilityDefinition[] = [
  {
    id: 'navigation.go_to_surface',
    title: 'Go To Surface',
    description: 'Navigate Lina to a top-level app surface.',
    examples: ['Open calendar', 'Take me to finance'],
    confirmationRule: 'never',
  },
  {
    id: 'tasks.create_task',
    title: 'Create Task',
    description: 'Create a task, habit, or goal in the tasks domain.',
    examples: ['Add task buy milk tomorrow', 'Create a daily habit for Fajr'],
    confirmationRule: 'never',
  },
  {
    id: 'tasks.reveal_task',
    title: 'Reveal Task',
    description: 'Open the Tasks surface and reveal a specific task from recent context or an explicit query.',
    examples: ['Show me that task', 'Open task buy milk'],
    confirmationRule: 'never',
  },
  {
    id: 'tasks.complete_matching',
    title: 'Complete Task',
    description: 'Mark a matching task or habit as complete.',
    examples: ['Mark ship launch checklist done', 'Complete my water habit'],
    confirmationRule: 'on_ambiguity',
  },
  {
    id: 'tasks.delete_matching',
    title: 'Delete Task',
    description: 'Delete a matching task, habit, or goal.',
    examples: ['Delete the mirror task', 'Remove all tasks related to mirrors'],
    confirmationRule: 'always',
  },
  {
    id: 'calendar.create_event',
    title: 'Create Event',
    description: 'Create a calendar event on a resolved calendar source.',
    examples: ['Schedule dentist tomorrow at 3pm', 'Add a meeting with Sam next Friday morning'],
    confirmationRule: 'never',
  },
  {
    id: 'calendar.reschedule_event',
    title: 'Reschedule Event',
    description: 'Move an existing event to a new time.',
    examples: ['Move my 3pm to tomorrow after lunch', 'Push the design review back an hour'],
    confirmationRule: 'always',
  },
  {
    id: 'finance.record_transaction',
    title: 'Record Transaction',
    description: 'Record income, expense, or transfer in finance.',
    examples: ['Log £12.50 for coffee from Monzo', 'Record salary of £2500'],
    confirmationRule: 'never',
  },
  {
    id: 'knowledge.create_entry',
    title: 'Create Knowledge Entry',
    description: 'Create a knowledge note under an existing topic.',
    examples: ['Save a note about patience under Aqeedah', 'Create a knowledge entry on salah etiquette'],
    confirmationRule: 'never',
  },
];

const capabilityMap = new Map(CAPABILITIES.map(capability => [capability.id, capability]));

export function getCapabilityDefinition(id: CapabilityId): CapabilityDefinition {
  const capability = capabilityMap.get(id);
  if (!capability) {
    throw new Error(`Unknown capability: ${id}`);
  }
  return capability;
}

export function listCapabilitiesForPrompt(): string {
  return CAPABILITIES.map(capability => {
    const examples = capability.examples.map(example => `"${example}"`).join(', ');
    return `- ${capability.id}: ${capability.description}. Examples: ${examples}.`;
  }).join('\n');
}
