// @vitest-environment node
import { describe, expect, it } from 'vitest';
import { buildPlanningBundle, validateModelPlan } from '../assistant/planner';
import type { ActionPlan } from '../assistant/plannerSchema';
import type { AssistantCommandContext } from '../assistant/shared';
import { DEFAULT_PROFILE } from '../services/gamification';
import type { KnowledgeTopic, Task } from '../types/domain';

function makeTask(overrides: Partial<Task> = {}): Task {
  return {
    id: overrides.id || 'task-1',
    title: overrides.title || 'Internet',
    description: overrides.description || '',
    completed: overrides.completed ?? false,
    priority: overrides.priority || 'medium',
    category: overrides.category || 'task',
    progress: overrides.progress ?? 0,
    emoji: overrides.emoji || '📝',
    goalTag: overrides.goalTag,
    dueDate: overrides.dueDate,
    dueTime: overrides.dueTime,
    subTasks: overrides.subTasks || [],
    milestone: overrides.milestone,
    lastCompletedAt: overrides.lastCompletedAt,
    createdAt: overrides.createdAt || '2026-04-10T09:00:00.000Z',
    updatedAt: overrides.updatedAt || '2026-04-10T09:00:00.000Z',
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
    createdAt: overrides.createdAt || '2026-04-10T09:00:00.000Z',
    updatedAt: overrides.updatedAt || '2026-04-10T09:00:00.000Z',
  };
}

function makeContext(overrides: Partial<AssistantCommandContext> = {}): AssistantCommandContext {
  return {
    calendarAccounts: [],
    calendarSources: [],
    calendarEvents: [],
    tasks: [],
    financeAccounts: [],
    transactions: [],
    knowledgeEntries: [],
    knowledgeTopics: [makeTopic()],
    lifestyleItems: [],
    projects: [],
    gamification: DEFAULT_PROFILE,
    prayerTimes: [],
    goalTags: [],
    currentSurface: 'chat',
    timezone: 'Europe/London',
    now: new Date('2026-04-10T09:00:00.000Z'),
    ...overrides,
  };
}

describe('planner guardrails', () => {
  it('coerces unsupported device-control approximations into truthful clarification', () => {
    const plan: ActionPlan = {
      mode: 'confirm',
      response: 'Do you want me to mark the task “Internet” as done?',
      confidence: 1,
      steps: [{
        capability: 'tasks.complete_matching',
        args: {
          taskId: 'task-internet',
        },
      }],
    };

    const validation = validateModelPlan(
      'Turn my internet off',
      plan,
      makeContext({
        tasks: [makeTask({ id: 'task-internet', title: 'Internet' })],
      }),
      'en',
    );

    expect(validation.planningStatus).toBe('planned');
    expect(validation.plan).toEqual({
      mode: 'clarify',
      response: 'I can help inside Sabah One, but I cannot control device or internet settings from here.',
      confidence: 0.7,
      steps: [],
    });
    expect(validation.referencedEntities).toEqual([]);
  });

  it('surfaces default knowledge-topic coverage detail in the planning bundle', () => {
    const bundle = buildPlanningBundle(
      'Add note about prayer focus under Salah',
      makeContext({
        knowledgeTopics: [
          makeTopic({
            id: 'topic-knowledge',
            name: 'Tazkiyah',
            description: 'General notes for Tazkiyah, Akhlaq, Salah, purification, gratitude, duas, family adab, discipline, and daily consistency.',
          }),
        ],
      }),
      undefined,
    );

    const topicCandidate = bundle.entityCandidates.knowledgeTopics.find(candidate => candidate.id === 'topic-knowledge');

    expect(topicCandidate).toEqual(expect.objectContaining({
      label: 'Tazkiyah',
      detail: expect.stringContaining('default topic'),
    }));
    expect(topicCandidate?.detail).toContain('Akhlaq');
    expect(topicCandidate?.detail).toContain('Salah');
  });
});
