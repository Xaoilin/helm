import { beforeEach, describe, expect, it, vi } from 'vitest';
import { DEFAULT_PROFILE } from '../services/gamification';
import { processAssistantCommand, resetOllamaCache } from '../services/assistantRuntime';
import type { AssistantCommandContext, AssistantDialogState } from '../services/assistantTypes';
import type {
  CalendarAccount,
  CalendarEvent,
  CalendarSource,
  FinanceAccount,
  KnowledgeTopic,
  Task,
  Transaction,
} from '../types/domain';
import { chatWithOllama, testOllamaConnection } from '../services/ollamaApi';
import { chatWithHostedAssistant, testHostedAssistantConnection } from '../services/hostedAssistantApi';

vi.mock('../services/ollamaApi', () => ({
  chatWithOllama: vi.fn(),
  testOllamaConnection: vi.fn(),
}));

vi.mock('../services/hostedAssistantApi', () => ({
  chatWithHostedAssistant: vi.fn(),
  testHostedAssistantConnection: vi.fn(),
}));

function makeTask(overrides: Partial<Task> = {}): Task {
  return {
    id: overrides.id || 'task-1',
    title: overrides.title || 'Buy milk',
    description: overrides.description || '',
    completed: overrides.completed ?? false,
    completedAt: overrides.completedAt,
    priority: overrides.priority || 'medium',
    category: overrides.category || 'task',
    dueDate: overrides.dueDate,
    recurring: overrides.recurring,
    goalTag: overrides.goalTag,
    emoji: overrides.emoji,
    createdAt: overrides.createdAt || '2026-04-06T09:00:00.000Z',
    updatedAt: overrides.updatedAt || '2026-04-06T09:00:00.000Z',
  };
}

function makeAccount(overrides: Partial<CalendarAccount> = {}): CalendarAccount {
  return {
    id: overrides.id || 'acc-1',
    name: overrides.name || 'Personal',
    email: overrides.email || 'me@example.com',
    provider: overrides.provider || 'local',
    isPrimary: overrides.isPrimary ?? true,
    connected: overrides.connected ?? false,
    mocked: overrides.mocked ?? true,
    lastSyncTime: overrides.lastSyncTime,
    syncError: overrides.syncError,
    paletteIndex: overrides.paletteIndex,
  };
}

function makeSource(overrides: Partial<CalendarSource> = {}): CalendarSource {
  return {
    id: overrides.id || 'src-1',
    accountId: overrides.accountId || 'acc-1',
    name: overrides.name || 'Personal',
    color: overrides.color || '#4f5bff',
    visible: overrides.visible ?? true,
    googleCalendarId: overrides.googleCalendarId,
    accessRole: overrides.accessRole,
  };
}

function makeEvent(overrides: Partial<CalendarEvent> = {}): CalendarEvent {
  return {
    id: overrides.id || 'evt-1',
    sourceId: overrides.sourceId || 'src-1',
    title: overrides.title || 'Design Review',
    description: overrides.description || '',
    start: overrides.start || '2026-04-06T15:00:00.000Z',
    end: overrides.end || '2026-04-06T16:00:00.000Z',
    allDay: overrides.allDay ?? false,
    location: overrides.location,
    googleEventId: overrides.googleEventId,
    googleCalendarId: overrides.googleCalendarId,
    pendingSync: overrides.pendingSync,
  };
}

function makeFinanceAccount(overrides: Partial<FinanceAccount> = {}): FinanceAccount {
  return {
    id: overrides.id || 'fin-1',
    name: overrides.name || 'Monzo',
    type: overrides.type || 'current',
    balance: overrides.balance ?? 100000,
    currency: overrides.currency || 'GBP',
    color: overrides.color || '#3b82f6',
    icon: overrides.icon || 'bank',
    includeInNetWorth: overrides.includeInNetWorth ?? true,
    sortOrder: overrides.sortOrder ?? 0,
    createdAt: overrides.createdAt || '2026-04-06T09:00:00.000Z',
    updatedAt: overrides.updatedAt || '2026-04-06T09:00:00.000Z',
  };
}

function makeTopic(overrides: Partial<KnowledgeTopic> = {}): KnowledgeTopic {
  return {
    id: overrides.id || 'topic-1',
    name: overrides.name || 'Tazkiyah',
    description: overrides.description || '',
    icon: overrides.icon || 'book',
    color: overrides.color || '#22c55e',
    sortOrder: overrides.sortOrder ?? 0,
    createdAt: overrides.createdAt || '2026-04-06T09:00:00.000Z',
    updatedAt: overrides.updatedAt || '2026-04-06T09:00:00.000Z',
  };
}

function makeContext(overrides: Partial<AssistantCommandContext> = {}): AssistantCommandContext {
  return {
    calendarAccounts: [makeAccount()],
    calendarSources: [makeSource()],
    calendarEvents: [],
    tasks: [],
    financeAccounts: [makeFinanceAccount()],
    transactions: [] as Transaction[],
    knowledgeEntries: [],
    knowledgeTopics: [makeTopic()],
    lifestyleItems: [],
    workspaces: [],
    gamification: DEFAULT_PROFILE,
    prayerTimes: [],
    goalTags: ['Work', 'Health'],
    currentSurface: 'chat',
    now: new Date('2026-04-06T09:00:00.000Z'),
    ...overrides,
  };
}

function makeDialogState(overrides: Partial<AssistantDialogState> = {}): AssistantDialogState {
  return {
    currentSurface: 'chat',
    recentEntities: [],
    recentPlans: [],
    ...overrides,
  };
}

describe('assistant runtime', () => {
  beforeEach(() => {
    resetOllamaCache();
    vi.clearAllMocks();
    vi.mocked(testOllamaConnection).mockResolvedValue(false);
    vi.mocked(chatWithOllama).mockResolvedValue('');
    vi.mocked(testHostedAssistantConnection).mockResolvedValue({ status: 'sign_in_required' });
    vi.mocked(chatWithHostedAssistant).mockResolvedValue('');
  });

  it('uses the shared runtime to execute local navigation commands', async () => {
    const navigate = vi.fn();

    const result = await processAssistantCommand('open calendar', makeContext(), {
      lang: 'en',
      handlers: {
        navigate,
        addTask: vi.fn(() => 'task-1'),
        updateTask: vi.fn(),
      },
    });

    expect(result.source).toBe('local');
    expect(result.plan.mode).toBe('act');
    expect(result.execution?.steps[0].capability).toBe('navigation.go_to_surface');
    expect(navigate).toHaveBeenCalledWith('calendar');
  });

  it('executes task creation through the structured capability runtime', async () => {
    const addTask = vi.fn(() => 'task-99');

    await processAssistantCommand('add task buy milk high priority tomorrow', makeContext(), {
      lang: 'en',
      handlers: {
        addTask,
        updateTask: vi.fn(),
      },
    });

    expect(addTask).toHaveBeenCalledWith(expect.objectContaining({
      title: 'buy milk',
      priority: 'high',
      category: 'task',
      dueDate: '2026-04-07',
    }));
  });

  it('reveals the recently created task when the user says show me that task', async () => {
    const addTask = vi.fn(() => 'task-77');
    const navigate = vi.fn();

    const first = await processAssistantCommand(
      'Can you add a task for me to put the mirror up on the office?',
      makeContext(),
      {
        lang: 'en',
        dialogState: makeDialogState(),
        handlers: {
          addTask,
          updateTask: vi.fn(),
          navigate,
        },
      },
    );

    expect(addTask).toHaveBeenCalledWith(expect.objectContaining({
      title: 'put the mirror up on the office',
      category: 'task',
    }));

    const reveal = await processAssistantCommand(
      'show me that task',
      makeContext({
        tasks: [makeTask({
          id: 'task-77',
          title: 'put the mirror up on the office',
        })],
      }),
      {
        lang: 'en',
        dialogState: first.dialogState,
        handlers: {
          addTask: vi.fn(() => 'unused'),
          updateTask: vi.fn(),
          navigate,
        },
      },
    );

    expect(reveal.execution?.steps[0].capability).toBe('tasks.reveal_task');
    expect(navigate).toHaveBeenLastCalledWith(expect.objectContaining({
      surface: 'tasks',
      taskReveal: expect.objectContaining({
        taskId: 'task-77',
        tab: 'all',
        resetFilters: true,
        highlight: true,
      }),
    }));
  });

  it('reveals an explicitly named task from chat context', async () => {
    const navigate = vi.fn();

    const result = await processAssistantCommand(
      'open task buy milk',
      makeContext({
        tasks: [makeTask({
          id: 'task-buy-milk',
          title: 'Buy milk',
        })],
      }),
      {
        lang: 'en',
        dialogState: makeDialogState(),
        handlers: {
          addTask: vi.fn(() => 'unused'),
          updateTask: vi.fn(),
          navigate,
        },
      },
    );

    expect(result.execution?.steps[0].capability).toBe('tasks.reveal_task');
    expect(navigate).toHaveBeenCalledWith(expect.objectContaining({
      surface: 'tasks',
      taskReveal: expect.objectContaining({
        taskId: 'task-buy-milk',
      }),
    }));
  });

  it('clarifies when the user asks to reveal a task without enough context', async () => {
    const result = await processAssistantCommand('show me that task', makeContext(), {
      lang: 'en',
      dialogState: makeDialogState(),
      handlers: {
        addTask: vi.fn(() => 'unused'),
        updateTask: vi.fn(),
      },
    });

    expect(result.plan.mode).toBe('clarify');
    expect(result.message).toContain(`I couldn't find a task matching "that task".`);
  });

  it('resolves and completes a matching task before mutating state', async () => {
    const updateTask = vi.fn();
    const updateGamification = vi.fn();
    const task = makeTask({ id: 'task-42', title: 'Ship launch checklist' });

    const result = await processAssistantCommand(
      'complete task ship launch checklist',
      makeContext({ tasks: [task] }),
      {
        lang: 'en',
        handlers: {
          addTask: vi.fn(() => 'unused'),
          updateTask,
          updateGamification,
        },
      },
    );

    expect(result.source).toBe('local');
    expect(result.execution?.steps[0].capability).toBe('tasks.complete_matching');
    expect(updateTask).toHaveBeenCalledWith(
      'task-42',
      expect.objectContaining({
        completed: true,
        completedAt: expect.any(String),
      }),
    );
    expect(updateGamification).toHaveBeenCalledTimes(1);
  });

  it('requires confirmation before rescheduling an existing event', async () => {
    const updateCalendarEvent = vi.fn();
    const event = makeEvent({ id: 'evt-9', title: 'Project Sync' });

    const first = await processAssistantCommand(
      'move project sync to tomorrow after lunch',
      makeContext({ calendarEvents: [event] }),
      {
        lang: 'en',
        dialogState: makeDialogState(),
        handlers: {
          addTask: vi.fn(() => 'unused'),
          updateTask: vi.fn(),
          updateCalendarEvent,
          addCalendarEvent: vi.fn(() => 'evt-new'),
        },
      },
    );

    expect(first.plan.mode).toBe('confirm');
    expect(updateCalendarEvent).not.toHaveBeenCalled();

    const second = await processAssistantCommand(
      'yes',
      makeContext({ calendarEvents: [event] }),
      {
        lang: 'en',
        dialogState: first.dialogState,
        handlers: {
          addTask: vi.fn(() => 'unused'),
          updateTask: vi.fn(),
          updateCalendarEvent,
          addCalendarEvent: vi.fn(() => 'evt-new'),
        },
      },
    );

    expect(second.source).toBe('local');
    expect(updateCalendarEvent).toHaveBeenCalledWith(
      'evt-9',
      expect.objectContaining({
        start: expect.any(String),
        end: expect.any(String),
      }),
    );
  });

  it('returns truthful degraded messaging when Ollama is offline for unsupported requests', async () => {
    const result = await processAssistantCommand('brainstorm my week', makeContext(), { lang: 'en' });

    expect(result.source).toBe('degraded');
    expect(result.degradedReason).toBe('ollama_offline');
    expect(result.message).toContain('Ollama is offline');
  });

  it('returns truthful hosted-AI messaging when sign-in is required', async () => {
    const result = await processAssistantCommand('brainstorm my week', makeContext(), {
      lang: 'en',
      provider: 'hosted',
    });

    expect(result.source).toBe('degraded');
    expect(result.degradedReason).toBe('hosted_sign_in_required');
    expect(result.message).toContain('Hosted AI is available after you sign in');
  });

  it('parses structured Ollama plans instead of action tags', async () => {
    vi.mocked(testOllamaConnection).mockResolvedValue(true);
    vi.mocked(chatWithOllama).mockResolvedValue(JSON.stringify({
      mode: 'act',
      response: 'Saving that note.',
      confidence: 0.91,
      steps: [{
        capability: 'knowledge.create_entry',
        args: {
          title: 'Patience note',
          content: 'Patience brings steadiness.',
          topicQuery: 'Tazkiyah',
        },
      }],
    }));

    const addKnowledgeEntry = vi.fn(() => 'entry-1');
    const result = await processAssistantCommand('capture something thoughtful about patience for later', makeContext(), {
      lang: 'en',
      handlers: {
        addTask: vi.fn(() => 'unused'),
        updateTask: vi.fn(),
        addKnowledgeEntry,
      },
    });

    expect(result.source).toBe('ollama');
    expect(addKnowledgeEntry).toHaveBeenCalledWith(expect.objectContaining({
      title: 'Patience note',
      content: 'Patience brings steadiness.',
    }));
    expect(result.execution?.steps[0].capability).toBe('knowledge.create_entry');
  });

  it('parses structured hosted plans instead of falling back to free-form text', async () => {
    vi.mocked(testHostedAssistantConnection).mockResolvedValue({ status: 'available' });
    vi.mocked(chatWithHostedAssistant).mockResolvedValue(JSON.stringify({
      mode: 'act',
      response: 'Saving that note.',
      confidence: 0.92,
      steps: [{
        capability: 'knowledge.create_entry',
        args: {
          title: 'Patience note',
          content: 'Patience brings steadiness.',
          topicQuery: 'Tazkiyah',
        },
      }],
    }));

    const addKnowledgeEntry = vi.fn(() => 'entry-hosted');
    const result = await processAssistantCommand('capture something thoughtful about patience for later', makeContext(), {
      lang: 'en',
      provider: 'hosted',
      handlers: {
        addTask: vi.fn(() => 'unused'),
        updateTask: vi.fn(),
        addKnowledgeEntry,
      },
    });

    expect(result.source).toBe('openai');
    expect(addKnowledgeEntry).toHaveBeenCalledWith(expect.objectContaining({
      title: 'Patience note',
      content: 'Patience brings steadiness.',
    }));
    expect(result.execution?.steps[0].capability).toBe('knowledge.create_entry');
  });
});
