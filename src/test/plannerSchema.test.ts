import { describe, expect, it, vi } from 'vitest';
import { executeActionPlan } from '../assistant/executor';
import {
  actionPlanJsonSchema,
  actionPlanStepJsonSchema,
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
    projects: [],
    gamification: DEFAULT_PROFILE,
    goalTags: [],
    currentSurface: 'chat',
    timezone: 'Europe/London',
    now: new Date('2026-04-10T09:00:00.000Z'),
  };
}

function findCapabilityStepSchema(capabilityId: string) {
  return actionPlanStepJsonSchema.anyOf.find(step => {
    if (!('properties' in step) || typeof step.properties !== 'object' || step.properties === null) {
      return false;
    }

    const capability = step.properties.capability;
    if (typeof capability !== 'object' || capability === null || !('const' in capability)) {
      return false;
    }

    return capability.const === capabilityId;
  });
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
      expect(required).toEqual(properties);
    }
  });

  it('emits required nullable hosted args for optional capability fields', () => {
    const taskViewSchema = findCapabilityStepSchema('tasks.open_view');
    expect(taskViewSchema).toBeDefined();

    const argsSchema = (taskViewSchema as {
      properties: {
        args: {
          required: string[];
          properties: {
            resetFilters: { type: string[] };
            tab: { type: string };
          };
        };
      };
    }).properties.args;

    expect([...argsSchema.required].sort()).toEqual(['resetFilters', 'tab']);
    expect(argsSchema.properties.resetFilters).toEqual({
      type: ['boolean', 'null'],
    });
    expect(argsSchema.properties.tab).toEqual(expect.objectContaining({
      type: 'string',
    }));
  });

  it('parses capability-specific action-plan args with null optional values without breaking executor behavior', () => {
    const navigate = vi.fn();
    const parsed = parseActionPlan({
      mode: 'act',
      response: 'Opening all your tasks.',
      confidence: 1,
      steps: [
        {
          capability: 'tasks.open_view',
          args: {
            tab: 'all',
            resetFilters: null,
          },
          unresolved: null,
          requiresConfirmation: null,
        },
      ],
    });

    expect(parsed).not.toBeNull();
    expect(parsed?.steps[0]?.args).toEqual({
      tab: 'all',
    });

    const handlers = {
      navigate,
      addTask: vi.fn(() => 'unused'),
      updateTask: vi.fn(),
    } as AssistantActionHandlers;

    const execution = executeActionPlan(parsed as ActionPlan, makeContext(), handlers, 'en');
    if (execution.kind !== 'executed') {
      throw new Error(`Expected executed outcome, got ${execution.kind}`);
    }

    expect(navigate).toHaveBeenCalledWith(expect.objectContaining({
      surface: 'tasks',
      surfaceState: expect.objectContaining({
        tasks: expect.objectContaining({
          tab: 'all',
          resetFilters: false,
        }),
      }),
    }));
    expect(execution.execution.toolResults[0].summary).toContain('Opened the All Tasks task view');
  });
});
