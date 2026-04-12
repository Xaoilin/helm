import { DEFAULT_PROFILE } from '../../services/gamification';
import type {
  CalendarAccount,
  CalendarEvent,
  CalendarSource,
  FinanceAccount,
  KnowledgeTopic,
  Surface,
  Task,
  Transaction,
} from '../../types/domain';
import { makeEntityReference } from '../entityResolver';
import type {
  AssistantCommandContext,
  AssistantDialogPlanReference,
  AssistantDialogState,
  AssistantEntityReference,
} from '../shared';
import type { AssistantBenchmarkDialogSeed } from './benchmarkCorpus';

const FIXTURE_NOW = new Date('2026-04-06T09:00:00+01:00');

function makeTask(overrides: Partial<Task> & Pick<Task, 'id' | 'title'>): Task {
  return {
    id: overrides.id,
    title: overrides.title,
    description: overrides.description || '',
    completed: overrides.completed ?? false,
    completedAt: overrides.completedAt,
    priority: overrides.priority || 'medium',
    category: overrides.category || 'task',
    dueDate: overrides.dueDate,
    recurring: overrides.recurring,
    goalTag: overrides.goalTag,
    emoji: overrides.emoji,
    createdAt: overrides.createdAt || '2026-04-01T09:00:00.000Z',
    updatedAt: overrides.updatedAt || '2026-04-01T09:00:00.000Z',
  };
}

function makeAccount(overrides: Partial<CalendarAccount> & Pick<CalendarAccount, 'id' | 'name' | 'email'>): CalendarAccount {
  return {
    id: overrides.id,
    name: overrides.name,
    email: overrides.email,
    provider: overrides.provider || 'local',
    isPrimary: overrides.isPrimary ?? false,
    connected: overrides.connected ?? true,
    mocked: overrides.mocked ?? true,
    lastSyncTime: overrides.lastSyncTime,
    syncError: overrides.syncError,
    paletteIndex: overrides.paletteIndex,
    authProvider: overrides.authProvider,
    authStatus: overrides.authStatus,
    authEmail: overrides.authEmail,
    authExpiresAt: overrides.authExpiresAt,
    lastAuthError: overrides.lastAuthError,
    lastAuthCheckAt: overrides.lastAuthCheckAt,
  };
}

function makeSource(overrides: Partial<CalendarSource> & Pick<CalendarSource, 'id' | 'accountId' | 'name'>): CalendarSource {
  return {
    id: overrides.id,
    accountId: overrides.accountId,
    name: overrides.name,
    color: overrides.color || '#4f5bff',
    visible: overrides.visible ?? true,
    googleCalendarId: overrides.googleCalendarId,
    accessRole: overrides.accessRole,
  };
}

function makeEvent(overrides: Partial<CalendarEvent> & Pick<CalendarEvent, 'id' | 'sourceId' | 'title' | 'start' | 'end'>): CalendarEvent {
  return {
    id: overrides.id,
    sourceId: overrides.sourceId,
    title: overrides.title,
    description: overrides.description || '',
    start: overrides.start,
    end: overrides.end,
    allDay: overrides.allDay ?? false,
    location: overrides.location,
    googleEventId: overrides.googleEventId,
    googleCalendarId: overrides.googleCalendarId,
    pendingSync: overrides.pendingSync,
  };
}

function makeFinanceAccount(overrides: Partial<FinanceAccount> & Pick<FinanceAccount, 'id' | 'name' | 'type'>): FinanceAccount {
  return {
    id: overrides.id,
    name: overrides.name,
    type: overrides.type,
    balance: overrides.balance ?? 100000,
    currency: overrides.currency || 'GBP',
    color: overrides.color || '#3b82f6',
    icon: overrides.icon || 'bank',
    includeInNetWorth: overrides.includeInNetWorth ?? true,
    sortOrder: overrides.sortOrder ?? 0,
    createdAt: overrides.createdAt || '2026-04-01T09:00:00.000Z',
    updatedAt: overrides.updatedAt || '2026-04-01T09:00:00.000Z',
  };
}

function makeTopic(overrides: Partial<KnowledgeTopic> & Pick<KnowledgeTopic, 'id' | 'name'>): KnowledgeTopic {
  return {
    id: overrides.id,
    name: overrides.name,
    description: overrides.description || '',
    icon: overrides.icon || 'book',
    color: overrides.color || '#22c55e',
    sortOrder: overrides.sortOrder ?? 0,
    createdAt: overrides.createdAt || '2026-04-01T09:00:00.000Z',
    updatedAt: overrides.updatedAt || '2026-04-01T09:00:00.000Z',
  };
}

const calendarAccounts: CalendarAccount[] = [
  makeAccount({ id: 'acc-personal', name: 'Personal', email: 'alisa.personal@example.com', isPrimary: true }),
  makeAccount({ id: 'acc-work', name: 'Work', email: 'alisa.work@example.com' }),
];

const calendarSources: CalendarSource[] = [
  makeSource({ id: 'src-personal', accountId: 'acc-personal', name: 'Personal' }),
  makeSource({ id: 'src-work', accountId: 'acc-work', name: 'Work' }),
];

const calendarEvents: CalendarEvent[] = [
  makeEvent({ id: 'evt-project-sync', sourceId: 'src-work', title: 'Project Sync', start: '2026-04-06T15:00:00+01:00', end: '2026-04-06T16:00:00+01:00' }),
  makeEvent({ id: 'evt-design-review', sourceId: 'src-work', title: 'Design Review', start: '2026-04-06T16:30:00+01:00', end: '2026-04-06T17:30:00+01:00' }),
  makeEvent({ id: 'evt-dentist', sourceId: 'src-personal', title: 'Dentist', start: '2026-04-07T15:00:00+01:00', end: '2026-04-07T16:00:00+01:00' }),
  makeEvent({ id: 'evt-client-call', sourceId: 'src-work', title: 'Client Call', start: '2026-04-08T11:00:00+01:00', end: '2026-04-08T12:00:00+01:00' }),
  makeEvent({ id: 'evt-launch-retro', sourceId: 'src-work', title: 'Launch Retro', start: '2026-04-07T17:00:00+01:00', end: '2026-04-07T18:00:00+01:00' }),
  makeEvent({ id: 'evt-family-dinner', sourceId: 'src-personal', title: 'Family Dinner', start: '2026-04-11T19:00:00+01:00', end: '2026-04-11T21:00:00+01:00' }),
  makeEvent({ id: 'evt-roadmap-review', sourceId: 'src-work', title: 'Roadmap Review', start: '2026-04-10T13:00:00+01:00', end: '2026-04-10T14:00:00+01:00' }),
  makeEvent({ id: 'evt-finance-call', sourceId: 'src-work', title: 'Finance Call', start: '2026-04-09T10:00:00+01:00', end: '2026-04-09T11:00:00+01:00' }),
  makeEvent({ id: 'evt-gym-checkin', sourceId: 'src-personal', title: 'Gym Check-In', start: '2026-04-12T08:00:00+01:00', end: '2026-04-12T09:00:00+01:00' }),
  makeEvent({ id: 'evt-sprint-planning', sourceId: 'src-work', title: 'Sprint Planning', start: '2026-04-09T14:00:00+01:00', end: '2026-04-09T15:00:00+01:00' }),
];

const tasks: Task[] = [
  makeTask({ id: 'task-launch-checklist', title: 'Ship launch checklist', priority: 'high' }),
  makeTask({ id: 'task-mirror-hooks', title: 'Buy mirror hooks' }),
  makeTask({ id: 'task-mirror-office', title: 'Hang mirror in office' }),
  makeTask({ id: 'habit-drink-water', title: 'Drink more water', category: 'daily' }),
  makeTask({ id: 'task-renew-passport', title: 'Renew passport' }),
  makeTask({ id: 'task-internet', title: 'Internet' }),
  makeTask({ id: 'task-router-move', title: 'Move the internet router' }),
  makeTask({ id: 'task-invoice-follow-up', title: 'Invoices follow-up' }),
  makeTask({ id: 'task-invoices-backlog', title: 'Check invoices backlog' }),
  makeTask({ id: 'task-launch-recap', title: 'Send launch recap' }),
  makeTask({ id: 'task-call-mum', title: 'Call mum' }),
  makeTask({ id: 'habit-stretch-after-dhuhr', title: 'Stretch after Dhuhr', category: 'daily' }),
  makeTask({ id: 'task-send-receipts-finance', title: 'Send receipts to finance' }),
  makeTask({ id: 'task-deep-clean-office', title: 'Deep clean the office' }),
  makeTask({ id: 'task-prep-friday-demo', title: 'Prep Friday demo', priority: 'high' }),
  makeTask({ id: 'task-reply-sarah', title: 'Reply to Sarah', priority: 'high' }),
  makeTask({ id: 'task-book-train-tickets', title: 'Book train tickets' }),
  makeTask({ id: 'task-dentist-paperwork', title: 'Dentist paperwork' }),
  makeTask({ id: 'task-release-notes', title: 'Finish release notes' }),
  makeTask({ id: 'task-release-notes-polish', title: 'Polish release notes' }),
  makeTask({ id: 'task-sprint-summary', title: 'Write sprint summary' }),
  makeTask({ id: 'task-clear-inbox', title: 'Clear the inbox' }),
  makeTask({ id: 'goal-save-more-this-month', title: 'Save more this month', category: 'goal', goalTag: 'Finance' }),
  makeTask({ id: 'habit-fajr', title: 'Fajr habit', category: 'daily' }),
];

const financeAccounts: FinanceAccount[] = [
  makeFinanceAccount({ id: 'fin-monzo', name: 'Monzo', type: 'current', sortOrder: 0 }),
  makeFinanceAccount({ id: 'fin-chase', name: 'Chase', type: 'current', sortOrder: 1 }),
  makeFinanceAccount({ id: 'fin-savings', name: 'Savings', type: 'savings', sortOrder: 2 }),
  makeFinanceAccount({ id: 'fin-current', name: 'Current', type: 'current', sortOrder: 3 }),
  makeFinanceAccount({ id: 'fin-main', name: 'Main', type: 'current', sortOrder: 4 }),
];

const knowledgeTopics: KnowledgeTopic[] = [
  makeTopic({
    id: 'topic-knowledge',
    name: 'Tazkiyah',
    description: 'General notes for Tazkiyah, Akhlaq, Salah, purification, gratitude, duas, family adab, discipline, and daily consistency.',
  }),
];

const transactions: Transaction[] = [];

const entityMap = new Map<string, AssistantEntityReference>();

function seedEntityMap(): void {
  if (entityMap.size > 0) return;

  const pushEntity = (kind: AssistantEntityReference['kind'], id: string, label: string, surface: Surface | undefined) => {
    entityMap.set(id, makeEntityReference(kind, id, label, surface, 1));
  };

  tasks.forEach(task => pushEntity('task', task.id, task.title, 'tasks'));
  calendarEvents.forEach(event => pushEntity('calendar_event', event.id, event.title, 'calendar'));
  calendarSources.forEach(source => pushEntity('calendar_source', source.id, source.name, 'calendar'));
  financeAccounts.forEach(account => pushEntity('finance_account', account.id, account.name, 'finance'));
  knowledgeTopics.forEach(topic => pushEntity('knowledge_topic', topic.id, topic.name, 'knowledge'));
}

export function buildAssistantBenchmarkContext(): AssistantCommandContext {
  seedEntityMap();

  return {
    calendarAccounts: [...calendarAccounts],
    calendarSources: [...calendarSources],
    calendarEvents: [...calendarEvents],
    tasks: [...tasks],
    financeAccounts: [...financeAccounts],
    transactions: [...transactions],
    knowledgeEntries: [],
    knowledgeTopics: [...knowledgeTopics],
    lifestyleItems: [],
    workspaces: [],
    gamification: DEFAULT_PROFILE,
    prayerTimes: [
      { name: 'Fajr', time: '05:10' },
      { name: 'Dhuhr', time: '13:05' },
      { name: 'Asr', time: '16:35' },
      { name: 'Maghrib', time: '19:48' },
      { name: 'Isha', time: '21:10' },
    ],
    goalTags: ['Finance', 'Health', 'Work'],
    currentSurface: 'chat',
    now: new Date(FIXTURE_NOW),
    timezone: 'Europe/London',
  };
}

function buildRecentEntities(seed: AssistantBenchmarkDialogSeed | undefined): AssistantEntityReference[] {
  seedEntityMap();

  return (seed?.recentEntities || [])
    .map(entity => entityMap.get(entity.id))
    .filter((entity): entity is AssistantEntityReference => Boolean(entity))
    .map(entity => ({ ...entity, lastUsedAt: FIXTURE_NOW.toISOString() }));
}

export function buildAssistantBenchmarkDialogState(
  seed: AssistantBenchmarkDialogSeed | undefined,
): AssistantDialogState {
  return {
    currentSurface: seed?.currentSurface || 'chat',
    recentEntities: buildRecentEntities(seed),
    recentPlans: [] as AssistantDialogPlanReference[],
  };
}
