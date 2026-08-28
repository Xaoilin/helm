// @vitest-environment node
import { describe, expect, it } from 'vitest';
import { DEFAULT_PROFILE } from '../services/gamification';
import { parseTaskCreationRequest } from '../assistant/taskRequestParser';
import type { AssistantCommandContext } from '../assistant/shared';

function makeContext(overrides: Partial<AssistantCommandContext> = {}): AssistantCommandContext {
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
    prayerTimes: [],
    goalTags: ['Work', 'Health'],
    currentSurface: 'chat',
    now: new Date('2026-04-10T09:00:00.000Z'),
    ...overrides,
  };
}

describe('task request parser', () => {
  it('parses explicit task creation with a due date', () => {
    const parsed = parseTaskCreationRequest('Add task buy milk tomorrow', makeContext());

    expect(parsed).toMatchObject({
      title: 'buy milk',
      category: 'task',
      priority: 'medium',
      dueDate: '2026-04-11',
    });
  });

  it('strips conversational scaffolding from polite task requests', () => {
    const parsed = parseTaskCreationRequest(
      'Can you add a task for me to put the mirror up on the office?',
      makeContext(),
    );

    expect(parsed).toMatchObject({
      title: 'put the mirror up on the office',
      category: 'task',
      priority: 'medium',
    });
  });

  it('clarifies instead of creating a vague scaffold-only title', () => {
    const parsed = parseTaskCreationRequest('Create the task now.', makeContext());

    expect(parsed).toEqual({
      clarify: 'What should I call the task?',
    });
  });

  it('keeps remind me to requests as undated tasks unless time is explicit', () => {
    const parsed = parseTaskCreationRequest(
      'Remind me to put the mirror up in the office tomorrow',
      makeContext(),
    );

    expect(parsed).toMatchObject({
      title: 'put the mirror up in the office',
      category: 'task',
      dueDate: '2026-04-11',
    });
  });

  it('normalizes daily habit phrasing to the actual habit title', () => {
    const parsed = parseTaskCreationRequest('Create a daily habit to stretch', makeContext());

    expect(parsed).toMatchObject({
      title: 'stretch',
      category: 'daily',
    });
  });

  it('normalizes goal phrasing to the actual goal title', () => {
    const parsed = parseTaskCreationRequest('Create a goal called launch the website', makeContext());

    expect(parsed).toMatchObject({
      title: 'launch the website',
      category: 'goal',
    });
  });

  it('normalizes new task called phrasing to the actual task title', () => {
    const parsed = parseTaskCreationRequest('Can you make a new task called ring the landlord?', makeContext());

    expect(parsed).toMatchObject({
      title: 'ring the landlord',
      category: 'task',
    });
  });

  it('does not hijack non-task creation requests', () => {
    const parsed = parseTaskCreationRequest('Create an event for tomorrow at 3pm', makeContext());

    expect(parsed).toBeNull();
  });
});
