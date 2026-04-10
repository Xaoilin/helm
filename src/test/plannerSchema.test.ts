import { describe, expect, it, vi } from 'vitest';
import { executeActionPlan } from '../assistant/executor';
import {
  actionPlanJsonSchema,
  parseActionPlan,
  type ActionPlan,
} from '../assistant/plannerSchema';
import { DEFAULT_PROFILE } from '../services/gamification';
import type { AssistantActionHandlers, AssistantCommandContext } from '../assistant/shared';

function walkSchema(
  node: unknown,
  visit: (node: Record<string, unknown>) => void,
): void {
  if (typeof node !== 'object' || node === null || Array.isArray(node)) {
    return;
  }

  visit(node);

  if ('properties' in node && typeof node.properties === 'object' && node.properties !== null) {
    for (const value of Object.values(node.properties as Record<string, unknown>)) {
      walkSchema(value, visit);
    }
  }

  if ('items' in node) {
    walkSchema(node.items, visit);
  }

  if ('anyOf' in node && Array.isArray(node.anyOf)) {
    for (const value of node.anyOf) {
      walkSchema(value, visit);
    }
  }
}

function makeContext(): AssistantCommandContext {
  return {
    calendarAccounts: [],
    calendarSources: [],
    calendarEvents: [],
    tasks: [],
    financeAccounts: [],
    transactions: [],
    knowledgeEntries: [],
    knowledgeTopics: [],
    lifestyleItems: [],
    workspaces: [],
    gamification: DEFAULT_PROFILE,
    goalTags: [],
    currentSurface: 'chat',
    timezone: 'Europe/London',
    now: new Date('2026-04-10T09:00:00.000Z'),
  };
}

describe('plannerSchema', () => {
  it('uses strict object schemas throughout the hosted action-plan contract', () => {
    const objectSchemas: Record<string, unknown>[] = [];
    walkSchema(actionPlanJsonSchema, node => {
      if (node.type === 'object') {
        objectSchemas.push(node);
      }
    });

    expect(objectSchemas.length).toBeGreaterThan(0);
    for (const schema of objectSchemas) {
      expect(schema.additionalProperties).toBe(false);
      const required = Array.isArray(schema.required) ? [...schema.required].sort() : [];
      const properties = Object.keys((schema.properties || {}) as Record<string, unknown>).sort();
      expect(required.every(key => properties.includes(key))).toBe(true);
    }
  });

  it('parses capability-specific action-plan args without breaking executor behavior', () => {
    const parsed = parseActionPlan({
      mode: 'act',
      response: 'Adding a task.',
      confidence: 1,
      steps: [
        {
          capability: 'tasks.create_task',
          args: {
            title: 'Buy milk',
            priority: 'high',
            category: 'task',
          },
          unresolved: null,
          requiresConfirmation: null,
        },
      ],
    });

    expect(parsed).not.toBeNull();
    expect(parsed?.steps[0]?.args).toEqual({
      title: 'Buy milk',
      priority: 'high',
      category: 'task',
    });

    const addTask = vi.fn(() => 'task-1');
    const handlers = {
      addTask,
      updateTask: vi.fn(),
    } as AssistantActionHandlers;

    const execution = executeActionPlan(parsed as ActionPlan, makeContext(), handlers, 'en');
    if (execution.kind !== 'executed') {
      throw new Error(`Expected executed outcome, got ${execution.kind}`);
    }

    expect(addTask).toHaveBeenCalledWith(expect.objectContaining({
      title: 'Buy milk',
      priority: 'high',
      category: 'task',
    }));
    expect(execution.message).toContain('Buy milk');
  });
});
