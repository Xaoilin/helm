import { readFileSync } from 'node:fs';
import { resolve } from 'node:path';
import { beforeEach, describe, expect, it, vi } from 'vitest';
import { executeActionPlan } from '../assistant/executor';
import { resolveCalendarEventReference } from '../assistant/entityResolver';
import { parseActionPlan } from '../assistant/plannerSchema';
import { validateModelPlan } from '../assistant/planner';
import type { AssistantActionHandlers } from '../assistant/shared';
import {
  makeAssistantContext,
  makeCalendarAccount,
  makeCalendarEvent,
  makeCalendarSource,
  makeTask,
  TEST_NOW_ISO,
} from './fixtures';

describe('assistant planner and executor boundary', () => {
  beforeEach(() => {
    vi.useFakeTimers();
    vi.setSystemTime(new Date(TEST_NOW_ISO));
  });

  it('proves a grounded planner result reaches the shared executor and mutates the task store', () => {
    const task = makeTask();
    const context = makeAssistantContext({ tasks: [task] });
    const persistedTasks = [task];
    const handlers: AssistantActionHandlers = {
      addTask: vi.fn(() => 'unused'),
      updateTask: (id, updates) => {
        const index = persistedTasks.findIndex(candidate => candidate.id === id);
        persistedTasks[index] = { ...persistedTasks[index], ...updates };
      },
    };
    const parsed = parseActionPlan({
      mode: 'act',
      response: 'The checklist is complete.',
      confidence: 0.92,
      steps: [{
        capability: 'tasks.complete_matching',
        args: { taskId: task.id },
      }],
    });

    expect(parsed).toEqual({
      mode: 'act',
      response: 'The checklist is complete.',
      confidence: 0.92,
      steps: [{
        capability: 'tasks.complete_matching',
        args: { taskId: task.id },
      }],
    });

    if (!parsed) throw new Error('The grounded action plan should parse.');
    const validation = validateModelPlan('Complete the release checklist', parsed, context, 'en');
    expect(validation.plannerValidation).toEqual({ status: 'accepted' });
    expect(validation.referencedEntities).toEqual([{
      kind: 'task',
      id: task.id,
      label: task.title,
      surface: 'tasks',
      score: 1,
      lastUsedAt: TEST_NOW_ISO,
    }]);

    const execution = executeActionPlan(validation.plan, context, handlers, 'en');
    if (execution.kind !== 'executed') throw new Error('The grounded task plan should execute.');

    expect(persistedTasks[0]).toEqual({
      ...task,
      completed: true,
      completedAt: '2026-08-29T10:00:00.000Z',
    });
    expect(execution.execution).toMatchObject({
      status: 'executed',
      steps: [{
        callId: 'call_1',
        capability: 'tasks.complete_matching',
        status: 'completed',
        summary: 'Completed "Review the release checklist".',
      }],
      toolResults: [{
        callId: 'call_1',
        capability: 'tasks.complete_matching',
        status: 'completed',
        summary: 'Completed "Review the release checklist".',
        facts: ['Marked the task "Review the release checklist" as complete.'],
      }],
    });
  });

  it('proves an ungrounded model task id is rejected before any executor mutation', () => {
    const context = makeAssistantContext({ tasks: [makeTask()] });
    const updateTask = vi.fn();
    const parsed = parseActionPlan({
      mode: 'act',
      response: 'I will complete it.',
      confidence: 1,
      steps: [{
        capability: 'tasks.complete_matching',
        args: { taskId: 'task-not-in-context' },
      }],
    });

    if (!parsed) throw new Error('The syntactically valid action plan should parse.');
    const validation = validateModelPlan('Complete the release checklist', parsed, context, 'en');

    expect(validation.plannerValidation).toMatchObject({ status: 'rejected' });
    expect(validation.plan).toEqual({
      mode: 'clarify',
      response: 'Which task should I complete?',
      confidence: 0.7,
      steps: [],
    });

    const execution = executeActionPlan(validation.plan, context, {
      addTask: vi.fn(() => 'unused'),
      updateTask,
    }, 'en');
    expect(execution).toEqual({
      kind: 'executed',
      referencedEntities: [],
      execution: {
        status: 'skipped',
        toolResults: [],
        steps: [],
        undoToken: undefined,
        navigationRequests: undefined,
      },
    });
    expect(updateTask).not.toHaveBeenCalled();
  });

  it('proves chat and voice enter the same runtime before the shared executor', () => {
    const root = resolve(__dirname, '../..');
    const chat = readFileSync(resolve(root, 'src/store/contexts/ChatContext.tsx'), 'utf8');
    const voice = readFileSync(resolve(root, 'src/components/VoiceAssistant.tsx'), 'utf8');
    const runtime = readFileSync(resolve(root, 'src/assistant/runtime.ts'), 'utf8');

    expect(chat).toContain("import { runAssistantTurn } from '../../assistant/runtime'");
    expect(voice).toContain("import { runAssistantTurn } from '../assistant/runtime'");
    expect(runtime).toContain("import { executeActionPlan } from './executor'");
  });

  it('matches all-day events by descriptive fields without inventing a midnight alias', () => {
    const account = makeCalendarAccount({ name: 'Family account' });
    const source = makeCalendarSource({ name: 'Family calendar' });
    const event = makeCalendarEvent({
      title: 'Museum day',
      description: 'Annual members visit',
      location: 'City gallery',
      allDay: true,
      start: '2026-08-29',
      end: '2026-08-29',
    });
    const context = makeAssistantContext({
      calendarAccounts: [account],
      calendarSources: [source],
      calendarEvents: [event],
    });
    const timeFormatter = vi.spyOn(Date.prototype, 'toLocaleTimeString').mockReturnValue('12 am');

    try {
      expect(resolveCalendarEventReference('12am', context).best).toBeNull();
      expect(timeFormatter).not.toHaveBeenCalled();
      for (const query of ['Museum day', 'Family calendar', 'Family account', 'City gallery']) {
        expect(resolveCalendarEventReference(query, context).best?.id).toBe(event.id);
      }
    } finally {
      timeFormatter.mockRestore();
    }
  });
});
