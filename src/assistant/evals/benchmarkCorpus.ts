import type { CapabilityId } from '../capabilities';
import type { AssistantEntityKind } from '../shared';
import type { Surface } from '../../types/domain';

export interface AssistantBenchmarkDialogSeed {
  currentSurface?: Surface;
  recentEntities?: Array<{
    kind: AssistantEntityKind;
    id: string;
  }>;
}

export interface AssistantBenchmarkCase {
  id: string;
  transcript: string;
  expectedMode: 'answer' | 'clarify' | 'confirm' | 'act';
  expectedCapabilities: CapabilityId[];
  expectedReferencedEntityIds?: string[];
  dialogStateSeed?: AssistantBenchmarkDialogSeed;
  tags: string[];
}

export interface AssistantBenchmarkExample {
  id: string;
  transcript: string;
  expectedMode: AssistantBenchmarkCase['expectedMode'];
  expectedCapabilities: CapabilityId[];
}

type AssistantBenchmarkCaseInput = string | {
  transcript: string;
  expectedReferencedEntityIds?: string[];
  dialogStateSeed?: AssistantBenchmarkDialogSeed;
};

function buildCases(
  prefix: string,
  utterances: AssistantBenchmarkCaseInput[],
  expectedMode: AssistantBenchmarkCase['expectedMode'],
  expectedCapabilities: CapabilityId[],
  tags: string[],
): AssistantBenchmarkCase[] {
  return utterances.map((input, index) => {
    const transcript = typeof input === 'string' ? input : input.transcript;
    return {
      id: `${prefix}-${index + 1}`,
      transcript,
      expectedMode,
      expectedCapabilities,
      expectedReferencedEntityIds: typeof input === 'string' ? undefined : input.expectedReferencedEntityIds,
      dialogStateSeed: typeof input === 'string' ? undefined : input.dialogStateSeed,
      tags,
    };
  });
}

function normaliseText(value: string): string {
  return value
    .toLowerCase()
    .replace(/[^\p{L}\p{N}\s:]/gu, ' ')
    .replace(/\s+/g, ' ')
    .trim();
}

function overlapScore(left: string, right: string): number {
  const leftTokens = new Set(normaliseText(left).split(' ').filter(Boolean));
  const rightTokens = new Set(normaliseText(right).split(' ').filter(Boolean));
  if (leftTokens.size === 0 || rightTokens.size === 0) return 0;

  let overlap = 0;
  for (const token of leftTokens) {
    if (rightTokens.has(token)) overlap += 1;
  }

  return overlap / Math.max(leftTokens.size, rightTokens.size);
}

const taskCreateCases = buildCases('task-create', [
  'Add task buy oat milk tomorrow',
  'Create a task to send the launch recap',
  'Make a task called renew passport',
  'Add a goal to finish the finance surface',
  'Create a daily habit for Fajr',
  'Add task call mum tonight',
  'Create task plan dentist paperwork',
  'New task: buy mirror hooks',
  'Please add a task to book train tickets',
  'Can you create a task for invoice follow-up on Friday',
  'Add a high priority task to reply to Sarah',
  'Create a goal called save more this month',
  'Add task prep Friday demo',
  'Create task finish release notes',
  'Please add a daily habit to stretch after Dhuhr',
  'Add task move the internet router',
  'Create a task to clear the inbox',
  'Add a goal to improve consistency',
  'Can you make a task to reorder supplements',
  'Add task write sprint summary',
  'Create task deep clean the office',
  'Add a habit to drink more water',
  'Please create task update the roadmap',
  'Add task send receipts to finance',
], 'act', ['tasks.create_task'], ['tasks', 'create']);

const taskViewCases = buildCases('task-view', [
  'Show me all my tasks',
  'Open my tasks',
  'Pull up the task list',
  'Go to all tasks',
  'Show my goals',
  'Open goals',
  'Take me to my goals',
  'Show today\'s tasks',
  'Open tasks for today',
  'Show my today tasks',
  'I want to see all my tasks',
  'Can you open my goals',
  'Show me the tasks tab',
  'Take me to today\'s tasks',
  'Open all tasks for me',
  'Show goals',
  'Open the all tasks view',
  'Show today habits',
], 'act', ['tasks.open_view'], ['tasks', 'read']);

const taskRevealCases = buildCases('task-reveal', [
  {
    transcript: 'Show me that task',
    expectedReferencedEntityIds: ['task-internet'],
    dialogStateSeed: { currentSurface: 'tasks', recentEntities: [{ kind: 'task', id: 'task-internet' }] },
  },
  {
    transcript: 'Open that task',
    expectedReferencedEntityIds: ['task-internet'],
    dialogStateSeed: { currentSurface: 'tasks', recentEntities: [{ kind: 'task', id: 'task-internet' }] },
  },
  'Find task buy milk',
  {
    transcript: 'Locate task ship launch checklist',
    expectedReferencedEntityIds: ['task-launch-checklist'],
  },
  {
    transcript: 'Show task internet task',
    expectedReferencedEntityIds: ['task-internet'],
  },
  {
    transcript: 'Open task buy mirror hooks',
    expectedReferencedEntityIds: ['task-mirror-hooks'],
  },
  {
    transcript: 'Take me to that one',
    expectedReferencedEntityIds: ['task-internet'],
    dialogStateSeed: { currentSurface: 'tasks', recentEntities: [{ kind: 'task', id: 'task-internet' }] },
  },
  {
    transcript: 'Find my task book train tickets',
    expectedReferencedEntityIds: ['task-book-train-tickets'],
  },
  {
    transcript: 'Pull up task renew passport',
    expectedReferencedEntityIds: ['task-renew-passport'],
  },
  {
    transcript: 'Show me the router task',
    expectedReferencedEntityIds: ['task-router-move'],
  },
  {
    transcript: 'Locate the invoice follow-up task',
    expectedReferencedEntityIds: ['task-invoice-follow-up'],
  },
  {
    transcript: 'Open the stretch habit',
    expectedReferencedEntityIds: ['habit-stretch-after-dhuhr'],
  },
  {
    transcript: 'Show the save more goal',
    expectedReferencedEntityIds: ['goal-save-more-this-month'],
  },
  {
    transcript: 'Find the dentist paperwork task',
    expectedReferencedEntityIds: ['task-dentist-paperwork'],
  },
  {
    transcript: 'Take me to the release notes task',
    expectedReferencedEntityIds: ['task-release-notes'],
    dialogStateSeed: { currentSurface: 'tasks', recentEntities: [{ kind: 'task', id: 'task-release-notes' }] },
  },
  {
    transcript: 'Open task write sprint summary',
    expectedReferencedEntityIds: ['task-sprint-summary'],
  },
  {
    transcript: 'Show me this task',
    expectedReferencedEntityIds: ['task-internet'],
    dialogStateSeed: { currentSurface: 'tasks', recentEntities: [{ kind: 'task', id: 'task-internet' }] },
  },
  {
    transcript: 'Open it',
    expectedReferencedEntityIds: ['task-internet'],
    dialogStateSeed: { currentSurface: 'tasks', recentEntities: [{ kind: 'task', id: 'task-internet' }] },
  },
], 'act', ['tasks.reveal_task'], ['tasks', 'read']);

const taskCompleteCases = buildCases('task-complete', [
  { transcript: 'Complete task ship launch checklist', expectedReferencedEntityIds: ['task-launch-checklist'] },
  { transcript: 'Mark buy mirror hooks done', expectedReferencedEntityIds: ['task-mirror-hooks'] },
  { transcript: 'Finish my water habit', expectedReferencedEntityIds: ['habit-drink-water'] },
  { transcript: 'Check off renew passport', expectedReferencedEntityIds: ['task-renew-passport'] },
  { transcript: 'Complete the router task', expectedReferencedEntityIds: ['task-router-move'] },
  { transcript: 'Mark the invoice follow-up task as done', expectedReferencedEntityIds: ['task-invoice-follow-up'] },
  { transcript: 'Finish task call mum', expectedReferencedEntityIds: ['task-call-mum'] },
  { transcript: 'Complete habit stretch after Dhuhr', expectedReferencedEntityIds: ['habit-stretch-after-dhuhr'] },
  { transcript: 'Mark send receipts to finance done', expectedReferencedEntityIds: ['task-send-receipts-finance'] },
  { transcript: 'Check off deep clean the office', expectedReferencedEntityIds: ['task-deep-clean-office'] },
  { transcript: 'Complete task prep Friday demo', expectedReferencedEntityIds: ['task-prep-friday-demo'] },
  { transcript: 'Mark task reply to Sarah done', expectedReferencedEntityIds: ['task-reply-sarah'] },
  { transcript: 'Finish book train tickets', expectedReferencedEntityIds: ['task-book-train-tickets'] },
  { transcript: 'Complete the dentist paperwork task', expectedReferencedEntityIds: ['task-dentist-paperwork'] },
  {
    transcript: 'Check off the release notes task',
    expectedReferencedEntityIds: ['task-release-notes'],
    dialogStateSeed: { currentSurface: 'tasks', recentEntities: [{ kind: 'task', id: 'task-release-notes' }] },
  },
  { transcript: 'Mark the router move task done', expectedReferencedEntityIds: ['task-router-move'] },
  { transcript: 'Finish the sprint summary', expectedReferencedEntityIds: ['task-sprint-summary'] },
  { transcript: 'Complete task clear the inbox', expectedReferencedEntityIds: ['task-clear-inbox'] },
], 'act', ['tasks.complete_matching'], ['tasks', 'complete']);

const taskDeleteCases = buildCases('task-delete', [
  { transcript: 'Delete my internet task', expectedReferencedEntityIds: ['task-internet'] },
  { transcript: 'Delete the internet task', expectedReferencedEntityIds: ['task-internet'] },
  { transcript: 'Remove the router task', expectedReferencedEntityIds: ['task-router-move'] },
  { transcript: 'Trash the invoice follow-up task', expectedReferencedEntityIds: ['task-invoice-follow-up'] },
  { transcript: 'Delete all of the tasks related to mirrors', expectedReferencedEntityIds: ['task-mirror-hooks', 'task-mirror-office'] },
  { transcript: 'Remove all tasks about the launch recap', expectedReferencedEntityIds: ['task-launch-recap'] },
  {
    transcript: 'Delete that task',
    expectedReferencedEntityIds: ['task-internet'],
    dialogStateSeed: { currentSurface: 'tasks', recentEntities: [{ kind: 'task', id: 'task-internet' }] },
  },
  {
    transcript: 'Delete this task',
    expectedReferencedEntityIds: ['task-internet'],
    dialogStateSeed: { currentSurface: 'tasks', recentEntities: [{ kind: 'task', id: 'task-internet' }] },
  },
  { transcript: 'Delete the task called renew passport', expectedReferencedEntityIds: ['task-renew-passport'] },
  { transcript: 'Delete task buy mirror hooks', expectedReferencedEntityIds: ['task-mirror-hooks'] },
  { transcript: 'Delete my goal save more this month', expectedReferencedEntityIds: ['goal-save-more-this-month'] },
  { transcript: 'Delete the stretch habit', expectedReferencedEntityIds: ['habit-stretch-after-dhuhr'] },
  { transcript: 'Remove all mirror tasks', expectedReferencedEntityIds: ['task-mirror-hooks', 'task-mirror-office'] },
  { transcript: 'Trash all tasks for internet', expectedReferencedEntityIds: ['task-internet', 'task-router-move'] },
  { transcript: 'Delete the task named dentist paperwork', expectedReferencedEntityIds: ['task-dentist-paperwork'] },
  { transcript: 'Delete all tasks about invoices', expectedReferencedEntityIds: ['task-invoice-follow-up', 'task-invoices-backlog'] },
  { transcript: 'Remove my call mum task', expectedReferencedEntityIds: ['task-call-mum'] },
  { transcript: 'Delete task clear the inbox', expectedReferencedEntityIds: ['task-clear-inbox'] },
  { transcript: 'Delete all of my release note tasks', expectedReferencedEntityIds: ['task-release-notes', 'task-release-notes-polish'] },
  { transcript: 'Trash the router move task', expectedReferencedEntityIds: ['task-router-move'] },
  { transcript: 'Remove the sprint summary task', expectedReferencedEntityIds: ['task-sprint-summary'] },
  { transcript: 'Delete the save more goal', expectedReferencedEntityIds: ['goal-save-more-this-month'] },
  { transcript: 'Delete my Fajr habit', expectedReferencedEntityIds: ['habit-fajr'] },
  { transcript: 'Remove task send receipts to finance', expectedReferencedEntityIds: ['task-send-receipts-finance'] },
], 'confirm', ['tasks.delete_matching'], ['tasks', 'delete', 'destructive']);

const calendarCreateCases = buildCases('calendar-create', [
  'Schedule dentist tomorrow at 3pm',
  'Create an event called launch review on Friday at 10',
  'Add a meeting with Sam next Tuesday morning',
  'Book a call for tomorrow after lunch',
  'Schedule design review at 4pm',
  'Create event invoice follow-up on Monday at 9am',
  'Add meeting for sprint planning next Wednesday at 2',
  'Book a calendar event called coffee with Ahmed tomorrow at 11',
  'Schedule gym check-in on Sunday at 8am',
  'Create an appointment for passport office next month',
  'Add a call with finance tomorrow at noon',
  'Schedule release retro Friday at 5pm',
  'Book deep work review on Thursday morning',
  'Create event family dinner Saturday at 7pm',
  'Add event client check-in Monday 14:00',
  'Schedule roadmap review next Friday at 1pm',
  'Book an appointment for the dentist on the personal calendar tomorrow at 3',
  'Add a meeting on my work calendar called product sync tomorrow at 11',
], 'act', ['calendar.create_event'], ['calendar', 'create']);

const calendarRescheduleCases = buildCases('calendar-reschedule', [
  { transcript: 'Move project sync to tomorrow after lunch', expectedReferencedEntityIds: ['evt-project-sync'] },
  { transcript: 'Push the design review back an hour', expectedReferencedEntityIds: ['evt-design-review'] },
  { transcript: 'Reschedule dentist to Friday at 4pm', expectedReferencedEntityIds: ['evt-dentist'] },
  { transcript: 'Move my client call to next Tuesday morning', expectedReferencedEntityIds: ['evt-client-call'] },
  { transcript: 'Push the launch retro to tomorrow evening', expectedReferencedEntityIds: ['evt-launch-retro'] },
  { transcript: 'Reschedule family dinner to Saturday at 8', expectedReferencedEntityIds: ['evt-family-dinner'] },
  { transcript: 'Move the roadmap review to Monday 10am', expectedReferencedEntityIds: ['evt-roadmap-review'] },
  { transcript: 'Push project sync to 3pm tomorrow', expectedReferencedEntityIds: ['evt-project-sync'] },
  { transcript: 'Move my 3pm to tomorrow after lunch', expectedReferencedEntityIds: ['evt-project-sync'] },
  { transcript: 'Reschedule the finance call to next week', expectedReferencedEntityIds: ['evt-finance-call'] },
  { transcript: 'Push the gym check-in to Sunday at 9', expectedReferencedEntityIds: ['evt-gym-checkin'] },
  { transcript: 'Move sprint planning to Thursday afternoon', expectedReferencedEntityIds: ['evt-sprint-planning'] },
], 'confirm', ['calendar.reschedule_event'], ['calendar', 'update']);

const financeCases = buildCases('finance-record', [
  'I spent £12 on coffee from Monzo',
  'Record expense of £45 for groceries',
  { transcript: 'Add an expense of £120 for train tickets from Chase', expectedReferencedEntityIds: ['fin-chase'] },
  'I paid $25 on lunch',
  'Log expense £60 for dentist',
  { transcript: 'Record income of £2500 for salary into Monzo', expectedReferencedEntityIds: ['fin-monzo'] },
  { transcript: 'I received £200 from freelance work into Savings', expectedReferencedEntityIds: ['fin-savings'] },
  'Log income of £30 for refund',
  'Add an expense of £9.99 for Spotify',
  'I spent £80 on fuel',
  { transcript: 'Record expense £15 for takeout from Monzo', expectedReferencedEntityIds: ['fin-monzo'] },
  'Add income of £120 from side project',
  { transcript: 'Log transaction £40 for groceries from Current', expectedReferencedEntityIds: ['fin-current'] },
  { transcript: 'I paid £18 for lunch from Monzo', expectedReferencedEntityIds: ['fin-monzo'] },
  'Record income of £50 for gift received',
  'Add expense of £6 for coffee',
  'I spent £35 on the train',
  { transcript: 'Log income of £400 from contract work into Main', expectedReferencedEntityIds: ['fin-main'] },
  'Record expense of £75 for utilities',
  'Add transaction £12.50 for breakfast',
  { transcript: 'I received £95 from a refund into Monzo', expectedReferencedEntityIds: ['fin-monzo'] },
  'Log expense of £110 for subscriptions',
  { transcript: 'Record £25 for charity from Monzo', expectedReferencedEntityIds: ['fin-monzo'] },
  'Add expense £16 for groceries',
], 'act', ['finance.record_transaction'], ['finance']);

const knowledgeCases = buildCases('knowledge-create', [
  'Save a note about patience under Tazkiyah',
  'Create a knowledge entry on salah etiquette',
  'Add a note about gratitude in Akhlaq',
  'Save a note titled Patience note about staying steady',
  'Create a knowledge note on tawakkul',
  'Add note about prayer focus under Salah',
  'Create knowledge entry on adab with parents',
  'Save a note under Tazkiyah about sabr in hard weeks',
  'Add a knowledge note about consistency',
  'Create note on purification basics',
  'Save a note about kindness under Akhlaq',
  'Create a note on duas for stress',
  'Add a note about presence in salah',
  'Save a knowledge entry on gratitude and patience',
  'Create note about staying calm before release day',
  'Add note on family adab under Akhlaq',
  'Save a note about trust in Allah',
  'Create a knowledge entry about daily discipline',
], 'act', ['knowledge.create_entry'], ['knowledge']);

const navigationCases = buildCases('navigation', [
  'Open calendar',
  'Go to finance',
  'Take me to knowledge',
  'Open profile',
  'Show settings',
  'Switch to debug',
  'Go to integrations',
  'Open dashboard',
  'Take me to chat',
  'Show workspaces',
  'Open credentials',
  'Go to the clock',
  'Open tasks',
  'Take me to calendar',
  'Switch to finance',
  'Open the dashboard',
  'Go to profile',
  'Show the settings page',
  'Take me to debug',
  'Open workspaces',
  'Go to integrations',
  'Open the knowledge tab',
  'Take me to chat',
  'Show me the dashboard',
  'Switch to credentials',
  'Open the timer page',
], 'act', ['navigation.go_to_surface'], ['navigation']);

const unsupportedCases = buildCases('unsupported', [
  'Email my tasks to John',
  'Text Sam my calendar',
  'Call my mum for me',
  'Post this to Slack',
  'Send my notes to Notion',
  'Book me an Uber',
  'Order groceries for me',
  'Delete my GitHub repo',
  'Start a Zoom meeting',
  'Turn my internet off',
  'Write a full PRD for my startup',
  'Make me a website from scratch',
  'Reply to all my emails',
  'Transfer money between my banks',
  'Open Spotify and play Qur\'an',
  'Create a Figma design for this app',
  'Sync all of this to Linear',
  'Send a WhatsApp message to my team',
  'Publish a tweet about my launch',
  'Turn on do not disturb across my devices',
], 'clarify', [], ['unsupported']);

export const ASSISTANT_BENCHMARK_CASES: readonly AssistantBenchmarkCase[] = [
  ...taskCreateCases,
  ...taskViewCases,
  ...taskRevealCases,
  ...taskCompleteCases,
  ...taskDeleteCases,
  ...calendarCreateCases,
  ...calendarRescheduleCases,
  ...financeCases,
  ...knowledgeCases,
  ...navigationCases,
  ...unsupportedCases,
];

export function retrieveBenchmarkExamples(
  transcript: string,
  capabilityIds: CapabilityId[],
  limit: number = 4,
): AssistantBenchmarkExample[] {
  const scoped = ASSISTANT_BENCHMARK_CASES.filter(example =>
    example.expectedCapabilities.length === 0
      ? capabilityIds.length === 0
      : example.expectedCapabilities.some(capability => capabilityIds.includes(capability)),
  );

  return scoped
    .map(example => ({
      example,
      score: overlapScore(transcript, example.transcript),
    }))
    .sort((left, right) => right.score - left.score || left.example.id.localeCompare(right.example.id))
    .slice(0, limit)
    .map(({ example }) => ({
      id: example.id,
      transcript: example.transcript,
      expectedMode: example.expectedMode,
      expectedCapabilities: [...example.expectedCapabilities],
    }));
}
