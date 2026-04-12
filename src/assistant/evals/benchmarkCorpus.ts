import type { CapabilityId } from '../capabilities';

export interface AssistantBenchmarkCase {
  id: string;
  transcript: string;
  expectedMode: 'answer' | 'clarify' | 'confirm' | 'act';
  expectedCapabilities: CapabilityId[];
  tags: string[];
}

export interface AssistantBenchmarkExample {
  id: string;
  transcript: string;
  expectedMode: AssistantBenchmarkCase['expectedMode'];
  expectedCapabilities: CapabilityId[];
}

function buildCases(
  prefix: string,
  utterances: string[],
  expectedMode: AssistantBenchmarkCase['expectedMode'],
  expectedCapabilities: CapabilityId[],
  tags: string[],
): AssistantBenchmarkCase[] {
  return utterances.map((transcript, index) => ({
    id: `${prefix}-${index + 1}`,
    transcript,
    expectedMode,
    expectedCapabilities,
    tags,
  }));
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
  'Show me that task',
  'Open that task',
  'Find task buy milk',
  'Locate task ship launch checklist',
  'Show task internet task',
  'Open task buy mirror hooks',
  'Take me to that one',
  'Find my task book train tickets',
  'Pull up task renew passport',
  'Show me the router task',
  'Locate the invoice follow-up task',
  'Open the stretch habit',
  'Show the save more goal',
  'Find the dentist paperwork task',
  'Take me to the release notes task',
  'Open task write sprint summary',
  'Show me this task',
  'Open it',
], 'act', ['tasks.reveal_task'], ['tasks', 'read']);

const taskCompleteCases = buildCases('task-complete', [
  'Complete task ship launch checklist',
  'Mark buy mirror hooks done',
  'Finish my water habit',
  'Check off renew passport',
  'Complete the router task',
  'Mark the invoice follow-up task as done',
  'Finish task call mum',
  'Complete habit stretch after Dhuhr',
  'Mark send receipts to finance done',
  'Check off deep clean the office',
  'Complete task prep Friday demo',
  'Mark task reply to Sarah done',
  'Finish book train tickets',
  'Complete the dentist paperwork task',
  'Check off the release notes task',
  'Mark the router move task done',
  'Finish the sprint summary',
  'Complete task clear the inbox',
], 'act', ['tasks.complete_matching'], ['tasks', 'complete']);

const taskDeleteCases = buildCases('task-delete', [
  'Delete my internet task',
  'Delete the internet task',
  'Remove the router task',
  'Trash the invoice follow-up task',
  'Delete all of the tasks related to mirrors',
  'Remove all tasks about the launch recap',
  'Delete that task',
  'Delete this task',
  'Delete the task called renew passport',
  'Delete task buy mirror hooks',
  'Delete my goal save more this month',
  'Delete the stretch habit',
  'Remove all mirror tasks',
  'Trash all tasks for internet',
  'Delete the task named dentist paperwork',
  'Delete all tasks about invoices',
  'Remove my call mum task',
  'Delete task clear the inbox',
  'Delete all of my release note tasks',
  'Trash the router move task',
  'Remove the sprint summary task',
  'Delete the save more goal',
  'Delete my Fajr habit',
  'Remove task send receipts to finance',
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
  'Move project sync to tomorrow after lunch',
  'Push the design review back an hour',
  'Reschedule dentist to Friday at 4pm',
  'Move my client call to next Tuesday morning',
  'Push the launch retro to tomorrow evening',
  'Reschedule family dinner to Saturday at 8',
  'Move the roadmap review to Monday 10am',
  'Push project sync to 3pm tomorrow',
  'Move my 3pm to tomorrow after lunch',
  'Reschedule the finance call to next week',
  'Push the gym check-in to Sunday at 9',
  'Move sprint planning to Thursday afternoon',
], 'confirm', ['calendar.reschedule_event'], ['calendar', 'update']);

const financeCases = buildCases('finance-record', [
  'I spent £12 on coffee from Monzo',
  'Record expense of £45 for groceries',
  'Add an expense of £120 for train tickets from Chase',
  'I paid $25 on lunch',
  'Log expense £60 for dentist',
  'Record income of £2500 for salary into Monzo',
  'I received £200 from freelance work into Savings',
  'Log income of £30 for refund',
  'Add an expense of £9.99 for Spotify',
  'I spent £80 on fuel',
  'Record expense £15 for takeout from Monzo',
  'Add income of £120 from side project',
  'Log transaction £40 for groceries from Current',
  'I paid £18 for lunch from Monzo',
  'Record income of £50 for gift received',
  'Add expense of £6 for coffee',
  'I spent £35 on the train',
  'Log income of £400 from contract work into Main',
  'Record expense of £75 for utilities',
  'Add transaction £12.50 for breakfast',
  'I received £95 from a refund into Monzo',
  'Log expense of £110 for subscriptions',
  'Record £25 for charity from Monzo',
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
