import { beforeEach, describe, expect, it, vi } from 'vitest';
import type { CapabilityId } from '../assistant/capabilities';
import { toAssistantToolName } from '../assistant/toolSchemas';
import { DEFAULT_PROFILE } from '../services/gamification';
import { processAssistantCommand, resetOllamaCache } from '../services/assistantRuntime';
import type { HostedAssistantUsageSnapshot } from '../services/assistantBilling';
import type {
  AssistantCommandContext,
  AssistantConversationMessage,
  AssistantDialogState,
} from '../services/assistantTypes';
import type {
  CalendarAccount,
  CalendarSource,
  FinanceAccount,
  KnowledgeTopic,
  Task,
  Transaction,
} from '../types/domain';
import { chatWithOllama, testOllamaConnection } from '../services/ollamaApi';
import {
  chatWithHostedAssistantDetailed,
  runHostedAssistantTurn,
  testHostedAssistantConnection,
  type HostedAssistantChatResult,
  type HostedAssistantTurnResult,
} from '../services/hostedAssistantApi';

vi.mock('../services/ollamaApi', () => ({
  chatWithOllama: vi.fn(),
  testOllamaConnection: vi.fn(),
}));

vi.mock('../services/hostedAssistantApi', () => ({
  chatWithHostedAssistantDetailed: vi.fn(),
  runHostedAssistantTurn: vi.fn(),
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
    projects: [],
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

function makeHostedTextTurn(
  mode: 'reply' | 'clarify' | 'confirm' | 'tool_calls',
  assistantMessage: string,
  toolCalls: Array<{ capability: string; args: Record<string, string | boolean | string[]> }> = [],
): HostedAssistantTurnResult {
  return {
    type: 'text',
    text: JSON.stringify({
      mode,
      assistantMessage,
      toolCalls: toolCalls.map(toolCall => ({
        capability: toolCall.capability,
        args: toolCall.args,
      })),
    }),
    toolCalls: [],
    model: 'gpt-5.4',
    rawResponse: 'mock-text-turn',
  };
}

function makeHostedToolTurn(
  toolCalls: Array<{ callId: string; capability: CapabilityId; args: Record<string, string | boolean | string[]> }>,
): HostedAssistantTurnResult {
  return {
    type: 'tool_calls',
    toolCalls: toolCalls.map(toolCall => ({
      callId: toolCall.callId,
      name: toAssistantToolName(toolCall.capability),
      arguments: JSON.stringify(toolCall.args),
    })),
    model: 'gpt-5.4',
    rawResponse: 'mock-tool-turn',
  };
}

function makeHostedNarrationResult(message: string, overrides: Partial<HostedAssistantChatResult> = {}): HostedAssistantChatResult {
  return {
    text: JSON.stringify({ assistantMessage: message }),
    model: 'gpt-5.4',
    ...overrides,
  };
}

function makeUsage(overrides: Partial<HostedAssistantUsageSnapshot> = {}): HostedAssistantUsageSnapshot {
  return {
    model: 'gpt-5.4',
    inputTokens: 1200,
    cachedTokens: 200,
    outputTokens: 300,
    reasoningTokens: 180,
    totalTokens: 1500,
    ...overrides,
  };
}

function getLastMessageContent(messages: AssistantConversationMessage[]): string {
  return messages[messages.length - 1]?.content || '';
}

function parseNarrationPayload(messages: AssistantConversationMessage[]): Record<string, unknown> {
  const content = getLastMessageContent(messages);
  const prefix = 'Verified turn facts JSON:\n';
  if (!content.startsWith(prefix)) {
    return {};
  }
  return JSON.parse(content.slice(prefix.length));
}

function defaultNarrationMessage(payload: Record<string, unknown>): string {
  const turnState = typeof payload.turnState === 'string' ? payload.turnState : '';
  const executed = Array.isArray(payload.executedToolResults)
    ? payload.executedToolResults as Array<Record<string, unknown>>
    : [];
  const firstExecuted = executed[0];
  const firstCapability = typeof firstExecuted?.capability === 'string' ? firstExecuted.capability : '';
  const firstSummary = typeof firstExecuted?.summary === 'string' ? firstExecuted.summary : '';

  if (turnState === 'awaiting_confirmation') {
    if (firstCapability === 'tasks.delete_matching') {
      return 'Do you want me to delete that task?';
    }
    return 'Do you want me to go ahead?';
  }

  if (turnState === 'cancelled') {
    return "Okay, I won't do that.";
  }

  if (turnState === 'clarify') {
    return typeof payload.clarifyReason === 'string' ? payload.clarifyReason : 'I need a bit more detail first.';
  }

  if (turnState === 'blocked') {
    return typeof payload.reason === 'string' ? payload.reason : 'I could not continue safely.';
  }

  if (turnState === 'executed') {
    if (firstCapability === 'tasks.open_view') {
      return "I've opened your full task list.";
    }
    if (firstCapability === 'tasks.delete_matching') {
      return firstSummary ? `I completed it. ${firstSummary}` : 'I deleted that task.';
    }
    if (firstCapability === 'knowledge.create_entry') {
      return 'I saved that note for you.';
    }
    if (firstSummary) {
      return firstSummary;
    }
  }

  return 'How can I help next?';
}

function mockHostedAssistant(
  resolver: (transcript: string, messages: AssistantConversationMessage[]) => HostedAssistantTurnResult,
  narrationResolver: (payload: Record<string, unknown>) => string = defaultNarrationMessage,
): void {
  vi.mocked(testHostedAssistantConnection).mockResolvedValue({
    status: 'available',
    accessMode: 'project_key',
    model: 'gpt-5.4',
  });
  vi.mocked(runHostedAssistantTurn).mockImplementation(async (messages) => resolver(getLastMessageContent(messages), messages));
  vi.mocked(chatWithHostedAssistantDetailed).mockImplementation(async (messages) => {
    const payload = parseNarrationPayload(messages);
    return makeHostedNarrationResult(narrationResolver(payload));
  });
}

function mockOllamaNarration(): void {
  vi.mocked(testOllamaConnection).mockResolvedValue(true);
  vi.mocked(chatWithOllama).mockImplementation(async (messages) => {
    const payload = parseNarrationPayload(messages as AssistantConversationMessage[]);
    return JSON.stringify({ assistantMessage: defaultNarrationMessage(payload) });
  });
}

describe('assistant runtime', () => {
  beforeEach(() => {
    resetOllamaCache();
    vi.clearAllMocks();
    vi.mocked(testOllamaConnection).mockResolvedValue(false);
    vi.mocked(chatWithOllama).mockResolvedValue('');
    vi.mocked(testHostedAssistantConnection).mockResolvedValue({ status: 'sign_in_required' });
    vi.mocked(chatWithHostedAssistantDetailed).mockResolvedValue(makeHostedNarrationResult('Unhandled narration.'));
    vi.mocked(runHostedAssistantTurn).mockRejectedValue(new Error('runHostedAssistantTurn not mocked'));
  });

  it('executes hosted task-view tool calls and uses narration for the visible reply', async () => {
    mockHostedAssistant(transcript => {
      expect(transcript).toBe('show me all my tasks');
      return makeHostedToolTurn([{
        callId: 'call_open_tasks',
        capability: 'tasks.open_view',
        args: {
          tab: 'all',
          resetFilters: true,
        },
      }]);
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
    expect(result.execution?.steps[0]).toEqual(expect.objectContaining({
      callId: 'call_open_tasks',
      capability: 'tasks.open_view',
      status: 'completed',
    }));
    expect(result.execution?.toolResults[0]).toEqual(expect.objectContaining({
      callId: 'call_open_tasks',
      capability: 'tasks.open_view',
      status: 'completed',
    }));
    expect(result.assistantMessage).toBe("I've opened your full task list.");
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

  it('keeps visible replies in the narration layer instead of leaking executor wording', async () => {
    mockHostedAssistant(
      () => makeHostedToolTurn([{
        callId: 'call_open_tasks',
        capability: 'tasks.open_view',
        args: {
          tab: 'all',
          resetFilters: true,
        },
      }]),
      () => 'Here they are. I opened every task for you.',
    );

    const result = await processAssistantCommand('show me all my tasks', makeContext(), {
      lang: 'en',
      provider: 'hosted',
      handlers: {
        navigate: vi.fn(),
        addTask: vi.fn(() => 'task-1'),
        updateTask: vi.fn(),
      },
    });

    expect(result.assistantMessage).toBe('Here they are. I opened every task for you.');
    expect(result.assistantMessage).not.toBe('Opened the All Tasks task view.');
    expect(result.message).toBe(result.assistantMessage);
  });

  it('passes the selected hosted model through planning and narration', async () => {
    mockHostedAssistant(() => makeHostedToolTurn([{
      callId: 'call_open_tasks',
      capability: 'tasks.open_view',
      args: {
        tab: 'all',
        resetFilters: true,
      },
    }]));

    const result = await processAssistantCommand('show me all my tasks', makeContext(), {
      lang: 'en',
      provider: 'hosted',
      hostedModel: 'gpt-5.4-mini',
      handlers: {
        navigate: vi.fn(),
        addTask: vi.fn(() => 'task-1'),
        updateTask: vi.fn(),
      },
    });

    expect(testHostedAssistantConnection).toHaveBeenCalledWith({ model: 'gpt-5.4-mini' });
    expect(runHostedAssistantTurn).toHaveBeenCalledWith(expect.any(Array), expect.objectContaining({
      model: 'gpt-5.4-mini',
    }));
    expect(chatWithHostedAssistantDetailed).toHaveBeenCalledWith(
      expect.any(Array),
      expect.any(Object),
      expect.objectContaining({
        model: 'gpt-5.4-mini',
      }),
    );
    expect(result.planningModel).toBe('gpt-5.4');
  });

  it('aggregates hosted planner and narration billing into one assistant turn estimate', async () => {
    vi.mocked(testHostedAssistantConnection).mockResolvedValue({
      status: 'available',
      accessMode: 'project_key',
      model: 'gpt-5.4',
    });
    vi.mocked(runHostedAssistantTurn).mockResolvedValue({
      ...makeHostedToolTurn([{
        callId: 'call_open_tasks',
        capability: 'tasks.open_view',
        args: {
          tab: 'all',
          resetFilters: true,
        },
      }]),
      usage: makeUsage({
        responseId: 'resp-plan',
        inputTokens: 1000,
        cachedTokens: 100,
        outputTokens: 200,
        reasoningTokens: 120,
        totalTokens: 1200,
      }),
    });
    vi.mocked(chatWithHostedAssistantDetailed).mockResolvedValue(makeHostedNarrationResult(
      "I've opened your full task list.",
      {
        usage: makeUsage({
          responseId: 'resp-narrate',
          inputTokens: 600,
          cachedTokens: 50,
          outputTokens: 120,
          reasoningTokens: 70,
          totalTokens: 720,
        }),
      },
    ));

    const result = await processAssistantCommand('show me all my tasks', makeContext(), {
      lang: 'en',
      provider: 'hosted',
      handlers: {
        navigate: vi.fn(),
        addTask: vi.fn(() => 'task-1'),
        updateTask: vi.fn(),
      },
    });

    expect(result.assistantBilling).toEqual(expect.objectContaining({
      provider: 'openai',
      requestCount: 2,
      estimateLabel: 'Estimated from OpenAI usage',
      requests: [
        expect.objectContaining({
          kind: 'planner',
          responseId: 'resp-plan',
        }),
        expect.objectContaining({
          kind: 'narration',
          responseId: 'resp-narrate',
        }),
      ],
      totals: expect.objectContaining({
        inputTokens: 1600,
        cachedTokens: 150,
        outputTokens: 320,
        reasoningTokens: 190,
        totalTokens: 1920,
      }),
      estimatedUsd: 0.008463,
    }));
  });

  it('uses the validated clarify turn instead of the raw hosted draft when guardrails coerce an unsupported action', async () => {
    mockHostedAssistant(transcript => {
      expect(transcript).toBe('turn my internet off');
      return makeHostedTextTurn('confirm', 'Do you want me to mark the task “Internet” as done?', [{
        capability: 'tasks.complete_matching',
        args: {
          taskId: 'task-internet',
        },
      }]);
    });

    const result = await processAssistantCommand('turn my internet off', makeContext({
      tasks: [
        makeTask({ id: 'task-internet', title: 'Internet' }),
      ],
    }), {
      lang: 'en',
      provider: 'hosted',
      handlers: {
        navigate: vi.fn(),
        addTask: vi.fn(() => 'task-1'),
        updateTask: vi.fn(),
      },
    });

    expect(result.planningStatus).toBe('planned');
    expect(result.assistantMessage).toBe('I can help inside HELM, but I cannot control device or internet settings from here.');
    expect(result.plan).toEqual(expect.objectContaining({
      mode: 'clarify',
      response: 'I can help inside HELM, but I cannot control device or internet settings from here.',
      steps: [],
    }));
    expect(result.modelTurn).toEqual({
      mode: 'clarify',
      assistantMessage: 'I can help inside HELM, but I cannot control device or internet settings from here.',
      toolCalls: [],
    });
    expect(result.toolCalls).toEqual([]);
    expect(result.execution).toBeUndefined();
  });

  it('stores validated delete confirmations as pending tool calls and resolves natural assent locally', async () => {
    mockHostedAssistant(transcript => {
      if (transcript === 'Delete my Internet task.') {
        return makeHostedTextTurn('confirm', 'Do you want me to delete the task "Internet"?', [{
          capability: 'tasks.delete_matching',
          args: {
            taskIds: ['task-internet'],
          },
        }]);
      }

      throw new Error(`Unexpected transcript: ${transcript}`);
    });

    const removeTask = vi.fn();
    const first = await processAssistantCommand(
      'Delete my Internet task.',
      makeContext({
        tasks: [makeTask({ id: 'task-internet', title: 'Internet' })],
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

    expect(first.plan.mode).toBe('confirm');
    expect(first.dialogState.pendingConfirmation?.toolCalls).toEqual([
      expect.objectContaining({
        callId: 'call_1',
        capability: 'tasks.delete_matching',
        args: { taskIds: ['task-internet'] },
      }),
    ]);
    expect(removeTask).not.toHaveBeenCalled();

    const second = await processAssistantCommand(
      "Yeah. That's the one.",
      makeContext({
        tasks: [makeTask({ id: 'task-internet', title: 'Internet' })],
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

    expect(second.planningStatus).toBe('local_confirmation');
    expect(second.execution?.toolResults[0]).toEqual(expect.objectContaining({
      capability: 'tasks.delete_matching',
      status: 'completed',
    }));
    expect(second.assistantMessage).toContain('Deleted "Internet"');
    expect(removeTask).toHaveBeenCalledTimes(1);
    expect(removeTask).toHaveBeenCalledWith('task-internet');
  });

  it('handles the exported delete-task failure shape without falling back to "Which task should I delete?"', async () => {
    mockHostedAssistant(transcript => {
      if (transcript === 'Show me all my tasks.') {
        return makeHostedToolTurn([{
          callId: 'call_show_tasks',
          capability: 'tasks.open_view',
          args: {
            tab: 'all',
            resetFilters: true,
          },
        }]);
      }

      if (transcript === 'Okay. I see an Internet task. Can you please delete it?') {
        return makeHostedTextTurn('confirm', 'Do you want me to delete the task "Internet"?', [{
          capability: 'tasks.delete_matching',
          args: {
            taskIds: ['task-internet'],
          },
        }]);
      }

      if (transcript === 'Yes.') {
        return makeHostedTextTurn('reply', 'I already handled that. What would you like me to do next?');
      }

      throw new Error(`Unexpected transcript: ${transcript}`);
    });

    const removeTask = vi.fn();
    const first = await processAssistantCommand('Show me all my tasks.', makeContext(), {
      lang: 'en',
      provider: 'hosted',
      dialogState: makeDialogState(),
      handlers: {
        navigate: vi.fn(),
        addTask: vi.fn(() => 'unused'),
        updateTask: vi.fn(),
        removeTask,
      },
    });

    const second = await processAssistantCommand(
      'Okay. I see an Internet task. Can you please delete it?',
      makeContext({
        tasks: [makeTask({ id: 'task-internet', title: 'Internet' })],
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

    const third = await processAssistantCommand(
      "Yeah. That's the one.",
      makeContext({
        tasks: [makeTask({ id: 'task-internet', title: 'Internet' })],
      }),
      {
        lang: 'en',
        provider: 'hosted',
        dialogState: second.dialogState,
        handlers: {
          addTask: vi.fn(() => 'unused'),
          updateTask: vi.fn(),
          removeTask,
        },
      },
    );

    const fourth = await processAssistantCommand(
      'Yes.',
      makeContext(),
      {
        lang: 'en',
        provider: 'hosted',
        dialogState: third.dialogState,
        handlers: {
          addTask: vi.fn(() => 'unused'),
          updateTask: vi.fn(),
          removeTask,
        },
      },
    );

    expect(removeTask).toHaveBeenCalledTimes(1);
    expect(third.assistantMessage).not.toBe('Which task should I delete?');
    expect(fourth.assistantMessage).not.toBe('Which task should I delete?');
    expect(fourth.execution).toBeUndefined();
  });

  it('reuses the model when a pending confirmation reply is not an explicit yes or no', async () => {
    mockHostedAssistant(transcript => {
      if (transcript === 'Delete my task.') {
        return makeHostedTextTurn('confirm', 'Do you want me to delete "Internet"?', [{
          capability: 'tasks.delete_matching',
          args: {
            taskIds: ['task-internet'],
          },
        }]);
      }

      if (transcript === 'No, the router one.') {
        return makeHostedTextTurn('confirm', 'Okay, do you want me to delete "Router setup" instead?', [{
          capability: 'tasks.delete_matching',
          args: {
            taskIds: ['task-router'],
          },
        }]);
      }

      throw new Error(`Unexpected transcript: ${transcript}`);
    });

    const first = await processAssistantCommand(
      'Delete my task.',
      makeContext({
        tasks: [
          makeTask({ id: 'task-internet', title: 'Internet' }),
          makeTask({ id: 'task-router', title: 'Router setup' }),
        ],
      }),
      {
        lang: 'en',
        provider: 'hosted',
        dialogState: makeDialogState(),
        handlers: {
          addTask: vi.fn(() => 'unused'),
          updateTask: vi.fn(),
          removeTask: vi.fn(),
        },
      },
    );

    const second = await processAssistantCommand(
      'No, the router one.',
      makeContext({
        tasks: [
          makeTask({ id: 'task-internet', title: 'Internet' }),
          makeTask({ id: 'task-router', title: 'Router setup' }),
        ],
      }),
      {
        lang: 'en',
        provider: 'hosted',
        dialogState: first.dialogState,
        handlers: {
          addTask: vi.fn(() => 'unused'),
          updateTask: vi.fn(),
          removeTask: vi.fn(),
        },
      },
    );

    expect(runHostedAssistantTurn).toHaveBeenCalledTimes(2);
    expect(second.dialogState.pendingConfirmation?.toolCalls[0]).toEqual(expect.objectContaining({
      args: { taskIds: ['task-router'] },
    }));
    expect(second.assistantMessage).toContain('Router setup');
  });

  it('fails safe when no live AI provider is available and executes nothing', async () => {
    vi.mocked(testHostedAssistantConnection).mockResolvedValue({ status: 'not_configured' });
    vi.mocked(testOllamaConnection).mockResolvedValue(false);

    const result = await processAssistantCommand('Delete my Internet task.', makeContext(), {
      lang: 'en',
      provider: 'auto',
      handlers: {
        addTask: vi.fn(() => 'unused'),
        updateTask: vi.fn(),
        removeTask: vi.fn(),
      },
    });

    expect(result.source).toBe('degraded');
    expect(result.planningStatus).toBe('blocked_provider_unavailable');
    expect(result.execution).toBeUndefined();
    expect(result.assistantMessage).toContain('No live AI provider is available');
  });

  it('rejects destructive tool calls that contradict the transcript instead of executing them', async () => {
    mockHostedAssistant(() => makeHostedToolTurn([{
      callId: 'call_wrong_action',
      capability: 'navigation.go_to_surface',
      args: {
        surface: 'tasks',
      },
    }]));

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

    expect(result.plan.mode).toBe('clarify');
    expect(result.planningStatus).toBe('validator_rejected');
    expect(result.assistantMessage).toBe('Which task should I delete?');
    expect(navigate).not.toHaveBeenCalled();
  });

  it('uses the same narration contract for Ollama', async () => {
    vi.mocked(testHostedAssistantConnection).mockResolvedValue({ status: 'not_configured' });
    mockOllamaNarration();
    vi.mocked(chatWithOllama).mockImplementation(async (messages, _endpoint, _model, schema) => {
      if (schema && typeof schema === 'object' && 'properties' in schema && (schema as { properties?: { mode?: unknown } }).properties?.mode) {
        return JSON.stringify({
          mode: 'tool_calls',
          assistantMessage: '',
          toolCalls: [{
            capability: 'knowledge.create_entry',
            args: {
              title: 'Patience note',
              content: 'Patience brings steadiness.',
              topicId: 'topic-1',
            },
          }],
        });
      }

      const payload = parseNarrationPayload(messages as AssistantConversationMessage[]);
      return JSON.stringify({ assistantMessage: defaultNarrationMessage(payload) });
    });

    const addKnowledgeEntry = vi.fn(() => 'entry-1');
    const result = await processAssistantCommand('capture something thoughtful about patience', makeContext(), {
      lang: 'en',
      provider: 'ollama',
      handlers: {
        addTask: vi.fn(() => 'unused'),
        updateTask: vi.fn(),
        addKnowledgeEntry,
      },
    });

    expect(result.source).toBe('ollama');
    expect(result.execution?.toolResults[0].capability).toBe('knowledge.create_entry');
    expect(addKnowledgeEntry).toHaveBeenCalledWith(expect.objectContaining({
      title: 'Patience note',
      content: 'Patience brings steadiness.',
      topicId: 'topic-1',
    }));
    expect(result.assistantMessage).toBe('I saved that note for you.');
  });
});
