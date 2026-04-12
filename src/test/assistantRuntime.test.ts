import { beforeEach, describe, expect, it, vi } from 'vitest';
import { DEFAULT_PROFILE } from '../services/gamification';
import { processAssistantCommand, resetOllamaCache } from '../services/assistantRuntime';
import type {
  AssistantCommandContext,
  AssistantConversationMessage,
  AssistantDialogState,
} from '../services/assistantTypes';
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

function makePlanStep(
  capability: string,
  args: Record<string, string | boolean | string[] | null>,
  overrides: Record<string, unknown> = {},
) {
  return {
    capability,
    args,
    ...overrides,
  };
}

function makePlan(
  mode: 'answer' | 'clarify' | 'confirm' | 'act',
  response: string,
  steps: ReturnType<typeof makePlanStep>[] = [],
) {
  return {
    mode,
    response,
    confidence: 0.95,
    steps,
  };
}

function findCapabilityStepSchema(schema: unknown, capabilityId: string) {
  if (typeof schema !== 'object' || schema === null || !('properties' in schema)) {
    return null;
  }

  const steps = (schema as { properties?: { steps?: { items?: { anyOf?: unknown[] } } } }).properties?.steps;
  const variants = steps?.items?.anyOf || [];
  return variants.find(step => {
    if (typeof step !== 'object' || step === null || !('properties' in step)) {
      return false;
    }

    const capability = (step as { properties?: { capability?: { const?: string } } }).properties?.capability;
    return capability?.const === capabilityId;
  }) || null;
}

function getLastTranscript(messages: AssistantConversationMessage[]): string {
  return messages[messages.length - 1]?.content || '';
}

function mockHostedPlanner(
  resolver: (transcript: string, schema: unknown, messages: AssistantConversationMessage[]) => unknown,
): void {
  vi.mocked(testHostedAssistantConnection).mockResolvedValue({
    status: 'available',
    accessMode: 'project_key',
    model: 'gpt-5.4',
  });
  vi.mocked(chatWithHostedAssistant).mockImplementation(async (messages, schema) => {
    const transcript = getLastTranscript(messages);
    const result = resolver(transcript, schema, messages);
    return typeof result === 'string' ? result : JSON.stringify(result);
  });
}

function mockOllamaPlanner(
  resolver: (transcript: string, schema: unknown, messages: AssistantConversationMessage[]) => unknown,
): void {
  vi.mocked(testOllamaConnection).mockResolvedValue(true);
  vi.mocked(chatWithOllama).mockImplementation(async (messages, _endpoint, _model, schema) => {
    const transcript = getLastTranscript(messages);
    const result = resolver(transcript, schema, messages);
    return typeof result === 'string' ? result : JSON.stringify(result);
  });
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

  it('executes hosted task-view plans through the shared runtime', async () => {
    mockHostedPlanner(transcript => {
      expect(transcript).toBe('show me all my tasks');
      return makePlan('act', 'Showing all your tasks.', [
        makePlanStep('tasks.open_view', {
          tab: 'all',
          resetFilters: true,
        }),
      ]);
    });

    const navigate = vi.fn();
    const result = await processAssistantCommand('show me all my tasks', makeContext(), {
      lang: 'en',
      provider: 'hosted',
      handlers: {
        navigate,
        addTask: vi.fn(() => 'task-1'),
        updateTask: vi.fn(),
      },
    });

    expect(result.source).toBe('openai');
    expect(result.planningSource).toBe('openai');
    expect(result.planningStatus).toBe('planned');
    expect(result.execution?.steps[0].capability).toBe('tasks.open_view');
    expect(result.planningBundle?.capabilities.length).toBeGreaterThan(0);
    expect(navigate).toHaveBeenCalledWith(expect.objectContaining({
      surface: 'tasks',
      surfaceState: expect.objectContaining({
        tasks: expect.objectContaining({
          tab: 'all',
          resetFilters: true,
        }),
      }),
    }));
  });

  it('executes hosted surface navigation without any local parser fallback', async () => {
    mockHostedPlanner(() => makePlan('act', 'Opening Tasks for you.', [
      makePlanStep('navigation.go_to_surface', {
        surface: 'tasks',
      }),
    ]));

    const navigate = vi.fn();
    const result = await processAssistantCommand('open tasks', makeContext(), {
      lang: 'en',
      provider: 'hosted',
      handlers: {
        navigate,
        addTask: vi.fn(() => 'task-1'),
        updateTask: vi.fn(),
      },
    });

    expect(result.source).toBe('openai');
    expect(result.execution?.steps[0].capability).toBe('navigation.go_to_surface');
    expect(navigate).toHaveBeenCalledWith(expect.objectContaining({
      surface: 'tasks',
    }));
  });

  it('executes hosted task creation plans with deterministic local execution', async () => {
    mockHostedPlanner(() => makePlan('act', 'Adding that task.', [
      makePlanStep('tasks.create_task', {
        title: 'buy milk',
        priority: 'high',
        category: 'task',
        dueDate: '2026-04-07',
      }),
    ]));

    const addTask = vi.fn(() => 'task-99');
    const result = await processAssistantCommand('add task buy milk high priority tomorrow', makeContext(), {
      lang: 'en',
      provider: 'hosted',
      handlers: {
        addTask,
        updateTask: vi.fn(),
      },
    });

    expect(result.source).toBe('openai');
    expect(result.execution?.steps[0].capability).toBe('tasks.create_task');
    expect(addTask).toHaveBeenCalledWith(expect.objectContaining({
      title: 'buy milk',
      priority: 'high',
      category: 'task',
      dueDate: '2026-04-07',
    }));
  });

  it('reveals a recently created task by using grounded ids from the hosted planner', async () => {
    mockHostedPlanner(transcript => {
      if (transcript === 'Can you add a task for me to put the mirror up on the office?') {
        return makePlan('act', 'Adding that task.', [
          makePlanStep('tasks.create_task', {
            title: 'put the mirror up on the office',
            priority: 'medium',
            category: 'task',
          }),
        ]);
      }

      if (transcript === 'show me that task') {
        return makePlan('act', 'Opening that task.', [
          makePlanStep('tasks.reveal_task', {
            taskId: 'task-77',
          }),
        ]);
      }

      throw new Error(`Unexpected transcript: ${transcript}`);
    });

    const addTask = vi.fn(() => 'task-77');
    const navigate = vi.fn();

    const first = await processAssistantCommand(
      'Can you add a task for me to put the mirror up on the office?',
      makeContext(),
      {
        lang: 'en',
        provider: 'hosted',
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
        provider: 'hosted',
        dialogState: first.dialogState,
        handlers: {
          addTask: vi.fn(() => 'unused'),
          updateTask: vi.fn(),
          navigate,
        },
      },
    );

    expect(reveal.source).toBe('openai');
    expect(reveal.execution?.steps[0].capability).toBe('tasks.reveal_task');
    expect(navigate).toHaveBeenLastCalledWith(expect.objectContaining({
      surface: 'tasks',
      surfaceState: expect.objectContaining({
        tasks: expect.objectContaining({
          revealTaskId: 'task-77',
          highlightTaskId: 'task-77',
        }),
      }),
    }));
  });

  it('completes a matching task when the hosted planner returns a grounded task id', async () => {
    mockHostedPlanner(() => makePlan('act', 'Completing that now.', [
      makePlanStep('tasks.complete_matching', {
        taskId: 'task-42',
      }),
    ]));

    const updateTask = vi.fn();
    const updateGamification = vi.fn();
    const result = await processAssistantCommand(
      'complete task ship launch checklist',
      makeContext({
        tasks: [makeTask({ id: 'task-42', title: 'Ship launch checklist' })],
      }),
      {
        lang: 'en',
        provider: 'hosted',
        handlers: {
          addTask: vi.fn(() => 'unused'),
          updateTask,
          updateGamification,
        },
      },
    );

    expect(result.source).toBe('openai');
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

  it('returns a delete confirmation plan for "Delete my Internet task." and executes locally after yes', async () => {
    mockHostedPlanner(transcript => {
      if (transcript === 'Delete my Internet task.') {
        return makePlan('act', 'I can delete "Internet". Do you want me to do that?', [
          makePlanStep('tasks.delete_matching', {
            taskIds: ['task-internet'],
          }),
        ]);
      }

      throw new Error(`Unexpected transcript: ${transcript}`);
    });

    const removeTask = vi.fn();
    const first = await processAssistantCommand(
      'Delete my Internet task.',
      makeContext({
        tasks: [makeTask({ id: 'task-internet', title: 'Internet', completed: false })],
      }),
      {
        lang: 'en',
        provider: 'hosted',
        dialogState: makeDialogState(),
        handlers: {
          addTask: vi.fn(() => 'unused'),
          updateTask: vi.fn(),
          removeTask,
        },
      },
    );

    expect(first.source).toBe('openai');
    expect(first.plan.mode).toBe('confirm');
    expect(first.execution).toBeUndefined();
    expect(first.planningStatus).toBe('planned');
    expect(first.validatedPlan?.steps[0].capability).toBe('tasks.delete_matching');
    expect(first.validatedPlan?.steps[0].args).toEqual({ taskIds: ['task-internet'] });
    expect(removeTask).not.toHaveBeenCalled();

    const second = await processAssistantCommand(
      'yes',
      makeContext({
        tasks: [makeTask({ id: 'task-internet', title: 'Internet', completed: false })],
      }),
      {
        lang: 'en',
        provider: 'hosted',
        dialogState: first.dialogState,
        handlers: {
          addTask: vi.fn(() => 'unused'),
          updateTask: vi.fn(),
          removeTask,
        },
      },
    );

    expect(second.source).toBe('local');
    expect(second.planningStatus).toBe('local_confirmation');
    expect(second.execution?.steps[0].capability).toBe('tasks.delete_matching');
    expect(removeTask).toHaveBeenCalledWith('task-internet');
  });

  it('learns spoken corrections before sending the request to the hosted planner', async () => {
    mockHostedPlanner((transcript, _schema, messages) => {
      expect(transcript).toBe('delete all of the tasks related to mirrors');
      expect(getLastTranscript(messages)).toBe('delete all of the tasks related to mirrors');
      return makePlan('act', 'I can delete 2 tasks. Do you want me to do that?', [
        makePlanStep('tasks.delete_matching', {
          taskIds: ['task-mirror-office', 'task-mirror-hooks'],
        }),
      ]);
    });

    const upsertAssistantCorrection = vi.fn(() => 'corr-1');
    const result = await processAssistantCommand(
      'No, I said delete all of the tasks related to mirrors',
      makeContext({
        tasks: [
          makeTask({ id: 'task-mirror-office', title: 'Hang up the mirror in this small office' }),
          makeTask({ id: 'task-mirror-hooks', title: 'Buy mirror hooks for the hallway' }),
        ],
      }),
      {
        lang: 'en',
        provider: 'hosted',
        conversationHistory: [
          { role: 'user', content: 'delete all of the tasks related to minors' },
          { role: 'assistant', content: `I couldn't find any tasks matching "minors".` },
        ],
        dialogState: makeDialogState(),
        handlers: {
          addTask: vi.fn(() => 'unused'),
          updateTask: vi.fn(),
          removeTask: vi.fn(),
          upsertAssistantCorrection,
        },
      },
    );

    expect(result.plan.mode).toBe('confirm');
    expect(result.message).toContain(`Thanks, I'll remember that.`);
    expect(result.message).toContain('I can delete 2 tasks');
    expect(upsertAssistantCorrection).toHaveBeenCalledWith(expect.objectContaining({
      sourceText: 'delete all of the tasks related to minors',
      targetText: 'delete all of the tasks related to mirrors',
      scope: 'utterance',
    }));
  });

  it('applies stored corrections before model-first planning', async () => {
    mockHostedPlanner((transcript, _schema, messages) => {
      expect(transcript).toBe('delete all of the tasks related to mirrors');
      expect(getLastTranscript(messages)).toBe('delete all of the tasks related to mirrors');
      return makePlan('act', 'I can delete 2 tasks. Do you want me to do that?', [
        makePlanStep('tasks.delete_matching', {
          taskIds: ['task-mirror-office', 'task-mirror-hooks'],
        }),
      ]);
    });

    const result = await processAssistantCommand(
      'delete all of the tasks related to minors',
      makeContext({
        tasks: [
          makeTask({ id: 'task-mirror-office', title: 'Hang up the mirror in this small office' }),
          makeTask({ id: 'task-mirror-hooks', title: 'Buy mirror hooks for the hallway' }),
        ],
      }),
      {
        lang: 'en',
        provider: 'hosted',
        corrections: [{
          id: 'corr-mirrors',
          sourceText: 'minors',
          targetText: 'mirrors',
          lang: 'en',
          scope: 'phrase',
          appliedCount: 0,
          createdAt: '2026-04-10T09:00:00.000Z',
          updatedAt: '2026-04-10T09:00:00.000Z',
        }],
        dialogState: makeDialogState(),
        handlers: {
          addTask: vi.fn(() => 'unused'),
          updateTask: vi.fn(),
          removeTask: vi.fn(),
          noteAssistantCorrectionApplied: vi.fn(),
        },
      },
    );

    expect(result.plan.mode).toBe('confirm');
    expect(result.message).toContain('I can delete 2 tasks');
  });

  it('requires confirmation before rescheduling an existing event and keeps yes local', async () => {
    mockHostedPlanner(transcript => {
      if (transcript === 'move project sync to tomorrow after lunch') {
        return makePlan('act', 'I can move "Project Sync" to tomorrow after lunch. Do you want me to do that?', [
          makePlanStep('calendar.reschedule_event', {
            eventId: 'evt-9',
            timePhrase: 'tomorrow after lunch',
          }),
        ]);
      }

      throw new Error(`Unexpected transcript: ${transcript}`);
    });

    const updateCalendarEvent = vi.fn();
    const event = makeEvent({ id: 'evt-9', title: 'Project Sync' });

    const first = await processAssistantCommand(
      'move project sync to tomorrow after lunch',
      makeContext({ calendarEvents: [event] }),
      {
        lang: 'en',
        provider: 'hosted',
        dialogState: makeDialogState(),
        handlers: {
          addTask: vi.fn(() => 'unused'),
          updateTask: vi.fn(),
          updateCalendarEvent,
          addCalendarEvent: vi.fn(() => 'evt-new'),
        },
      },
    );

    expect(first.source).toBe('openai');
    expect(first.plan.mode).toBe('confirm');
    expect(updateCalendarEvent).not.toHaveBeenCalled();

    const second = await processAssistantCommand(
      'yes',
      makeContext({ calendarEvents: [event] }),
      {
        lang: 'en',
        provider: 'hosted',
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
    expect(second.planningStatus).toBe('local_confirmation');
    expect(updateCalendarEvent).toHaveBeenCalledWith(
      'evt-9',
      expect.objectContaining({
        start: expect.any(String),
        end: expect.any(String),
      }),
    );
  });

  it('fails safe when no live planner is available and executes nothing', async () => {
    const result = await processAssistantCommand('brainstorm my week', makeContext(), {
      lang: 'en',
      provider: 'hosted',
      handlers: {
        addTask: vi.fn(() => 'unused'),
        updateTask: vi.fn(),
      },
    });

    expect(result.source).toBe('degraded');
    expect(result.degradedReason).toBe('hosted_sign_in_required');
    expect(result.planningStatus).toBe('blocked_provider_unavailable');
    expect(result.execution).toBeUndefined();
    expect(result.message).toContain('Hosted AI needs sign-in');
  });

  it('parses structured Ollama plans instead of action tags', async () => {
    mockOllamaPlanner(() => makePlan('act', 'Saving that note.', [
      makePlanStep('knowledge.create_entry', {
        title: 'Patience note',
        content: 'Patience brings steadiness.',
        topicId: 'topic-1',
      }),
    ]));

    const addKnowledgeEntry = vi.fn(() => 'entry-1');
    const result = await processAssistantCommand('capture something thoughtful about patience for later', makeContext(), {
      lang: 'en',
      provider: 'ollama',
      handlers: {
        addTask: vi.fn(() => 'unused'),
        updateTask: vi.fn(),
        addKnowledgeEntry,
      },
    });

    expect(result.source).toBe('ollama');
    expect(result.planningSource).toBe('ollama');
    expect(addKnowledgeEntry).toHaveBeenCalledWith(expect.objectContaining({
      title: 'Patience note',
      content: 'Patience brings steadiness.',
      topicId: 'topic-1',
    }));
  });

  it('parses structured hosted plans and exposes validated planning metadata', async () => {
    mockHostedPlanner(() => makePlan('act', 'Saving that note.', [
      makePlanStep('knowledge.create_entry', {
        title: 'Patience note',
        content: 'Patience brings steadiness.',
        topicId: 'topic-1',
      }),
    ]));

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
    expect(result.execution?.steps[0].capability).toBe('knowledge.create_entry');
    expect(result.parsedPlan?.steps[0].args).toEqual(expect.objectContaining({
      topicId: 'topic-1',
    }));
    expect(result.validatedPlan?.steps[0].args).toEqual(expect.objectContaining({
      topicId: 'topic-1',
    }));
  });

  it('recovers a valid hosted plan when the provider repeats the same JSON payload', async () => {
    vi.mocked(testHostedAssistantConnection).mockResolvedValue({
      status: 'available',
      accessMode: 'project_key',
      model: 'gpt-5.4',
    });
    const repeatedPlan = JSON.stringify(makePlan('act', 'Saving that note.', [
      makePlanStep('knowledge.create_entry', {
        title: 'Patience note',
        content: 'Patience brings steadiness.',
        topicId: 'topic-1',
      }),
    ]));
    vi.mocked(chatWithHostedAssistant).mockResolvedValue(`${repeatedPlan}\n${repeatedPlan}`);

    const addKnowledgeEntry = vi.fn(() => 'entry-repeated');
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
    expect(result.execution?.steps[0].capability).toBe('knowledge.create_entry');
    expect(result.message).toBe('Saved "Patience note" under Tazkiyah.');
    expect(result.message).not.toContain('"mode":"act"');
  });

  it('never surfaces malformed hosted planner JSON as the visible assistant reply', async () => {
    vi.mocked(testHostedAssistantConnection).mockResolvedValue({
      status: 'available',
      accessMode: 'project_key',
      model: 'gpt-5.4',
    });
    vi.mocked(chatWithHostedAssistant).mockResolvedValue(
      '{"mode":"act","response":"Saving that note.","confidence":0.98,"steps":[{"capability":"knowledge.create_entry"',
    );

    const result = await processAssistantCommand('capture something thoughtful about patience for later', makeContext(), {
      lang: 'en',
      provider: 'hosted',
      handlers: {
        addTask: vi.fn(() => 'unused'),
        updateTask: vi.fn(),
        addKnowledgeEntry: vi.fn(() => 'unused'),
      },
    });

    expect(result.source).toBe('degraded');
    expect(result.degradedReason).toBe('hosted_error');
    expect(result.planningStatus).toBe('model_response_invalid');
    expect(result.message).toContain("I had trouble interpreting the hosted planner's response");
    expect(result.message).not.toContain('"mode":"act"');
  });

  it('rejects a model plan that contradicts a destructive transcript instead of approximating it', async () => {
    mockHostedPlanner(() => makePlan('act', 'Opening tasks for you.', [
      makePlanStep('navigation.go_to_surface', {
        surface: 'tasks',
      }),
    ]));

    const navigate = vi.fn();
    const result = await processAssistantCommand(
      'Delete my Internet task.',
      makeContext({
        tasks: [makeTask({ id: 'task-internet', title: 'Internet' })],
      }),
      {
        lang: 'en',
        provider: 'hosted',
        handlers: {
          navigate,
          addTask: vi.fn(() => 'unused'),
          updateTask: vi.fn(),
          removeTask: vi.fn(),
        },
      },
    );

    expect(result.source).toBe('openai');
    expect(result.plan.mode).toBe('clarify');
    expect(result.planningStatus).toBe('validator_rejected');
    expect(result.plannerValidation).toEqual(expect.objectContaining({
      status: 'rejected',
    }));
    expect(result.message).toBe('Which task should I delete?');
    expect(navigate).not.toHaveBeenCalled();
  });

  it('sends a hosted planner schema that keeps optional booleans nullable and delete ids as arrays', async () => {
    mockHostedPlanner(() => makePlan('clarify', 'Classes are not available in HELM yet.'));

    const result = await processAssistantCommand('show me all my classes', makeContext(), {
      lang: 'en',
      provider: 'hosted',
      handlers: {
        addTask: vi.fn(() => 'unused'),
        updateTask: vi.fn(),
      },
    });

    expect(result.source).toBe('openai');
    expect(result.plan.mode).toBe('clarify');
    expect(chatWithHostedAssistant).toHaveBeenCalledTimes(1);

    const schema = vi.mocked(chatWithHostedAssistant).mock.calls[0]?.[1];
    const taskViewSchema = findCapabilityStepSchema(schema, 'tasks.open_view') as {
      properties: {
        args: {
          required: string[];
          properties: {
            resetFilters: { type: string[] };
          };
        };
      };
    } | null;
    const deleteSchema = findCapabilityStepSchema(schema, 'tasks.delete_matching') as {
      properties: {
        args: {
          properties: {
            taskIds: {
              type: string[];
              items: { type: string[] };
            };
          };
        };
      };
    } | null;

    expect(taskViewSchema).not.toBeNull();
    expect(taskViewSchema?.properties.args.required).toContain('resetFilters');
    expect(taskViewSchema?.properties.args.properties.resetFilters).toEqual({
      type: ['boolean', 'null'],
    });

    expect(deleteSchema).not.toBeNull();
    expect(deleteSchema?.properties.args.properties.taskIds).toEqual({
      type: 'array',
      items: { type: 'string' },
    });
  });
});
