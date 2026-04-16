import { beforeEach, describe, expect, it, vi } from 'vitest';

const {
  chatWithHostedAssistantDetailedMock,
  testHostedAssistantConnectionMock,
} = vi.hoisted(() => ({
  chatWithHostedAssistantDetailedMock: vi.fn(),
  testHostedAssistantConnectionMock: vi.fn(),
}));

vi.mock('../services/hostedAssistantApi', () => ({
  chatWithHostedAssistantDetailed: chatWithHostedAssistantDetailedMock,
  testHostedAssistantConnection: testHostedAssistantConnectionMock,
}));

import {
  buildDashboardFocusCandidates,
  selectDashboardFocusRecommendation,
} from '../services/dashboardFocus';
import type { CalendarEvent, CalendarSource, FocusFeedback, Task } from '../types/domain';

function makeTask(overrides: Partial<Task> = {}): Task {
  return {
    id: 'task-1',
    title: 'Default task',
    description: '',
    completed: false,
    priority: 'medium',
    category: 'task',
    createdAt: '2026-04-16T08:00:00.000Z',
    updatedAt: '2026-04-16T08:00:00.000Z',
    ...overrides,
  };
}

function makeCalendarSource(overrides: Partial<CalendarSource> = {}): CalendarSource {
  return {
    id: 'src-1',
    accountId: 'acc-1',
    name: 'Personal',
    color: '#4285f4',
    visible: true,
    ...overrides,
  };
}

function makeEvent(overrides: Partial<CalendarEvent> = {}): CalendarEvent {
  return {
    id: 'evt-1',
    sourceId: 'src-1',
    title: 'Team sync',
    description: '',
    start: '2026-04-16T09:10:00.000Z',
    end: '2026-04-16T09:40:00.000Z',
    allDay: false,
    ...overrides,
  };
}

describe('dashboardFocus', () => {
  beforeEach(() => {
    vi.clearAllMocks();
    localStorage.clear();
    testHostedAssistantConnectionMock.mockResolvedValue({ status: 'available', model: 'gpt-5.4-mini' });
    chatWithHostedAssistantDetailedMock.mockResolvedValue({
      text: JSON.stringify({
        selectedCandidateId: 'task:task-overdue',
        why: 'It is overdue and fits the time you have before the next event.',
        confidence: 0.84,
        reasoningTags: ['overdue', 'fits_window'],
        estimatedMinutes: 20,
        alternativeIds: ['daily:habit-1'],
        refreshAfterMinutes: 10,
      }),
      model: 'gpt-5.4-mini',
    });
  });

  it('ranks an overdue task above an incomplete habit', () => {
    const result = buildDashboardFocusCandidates({
      tasks: [
        makeTask({
          id: 'task-overdue',
          title: 'Send the invoice',
          dueDate: '2026-04-15',
          priority: 'high',
        }),
        makeTask({
          id: 'habit-1',
          title: 'Morning review',
          category: 'daily',
          recurring: {
            frequency: 'daily',
          },
        }),
      ],
      calendarSources: [],
      calendarEvents: [],
      projects: [],
      gamification: {
        totalXp: 0,
        level: 1,
        currentStreak: 2,
        longestStreak: 2,
        totalTasksCompleted: 0,
        badges: [],
      },
      feedback: [],
      now: new Date('2026-04-16T09:00:00.000Z'),
    });

    expect(result.candidates[0]).toEqual(expect.objectContaining({
      id: 'task:task-overdue',
      kind: 'task',
      isUrgent: true,
    }));
    expect(result.stats).toEqual({
      overdueCount: 1,
      dueTodayCount: 0,
      routinesLeft: 1,
      activeTaskCount: 2,
    });
  });

  it('creates a meeting prep candidate when a visible event starts within 15 minutes', () => {
    const result = buildDashboardFocusCandidates({
      tasks: [
        makeTask({
          id: 'habit-1',
          title: 'Morning review',
          category: 'daily',
          recurring: {
            frequency: 'daily',
          },
        }),
      ],
      calendarSources: [makeCalendarSource()],
      calendarEvents: [
        makeEvent({
          id: 'evt-urgent',
          title: 'Client call',
          location: 'Canary Wharf',
          start: '2026-04-16T09:08:00.000Z',
          end: '2026-04-16T09:40:00.000Z',
        }),
      ],
      projects: [],
      gamification: {
        totalXp: 0,
        level: 1,
        currentStreak: 0,
        longestStreak: 0,
        totalTasksCompleted: 0,
        badges: [],
      },
      feedback: [],
      now: new Date('2026-04-16T09:00:00.000Z'),
    });

    expect(result.candidates[0]).toEqual(expect.objectContaining({
      kind: 'meeting_prep',
      eventId: 'evt-urgent',
    }));
  });

  it('suppresses a snoozed candidate until the snooze expires', () => {
    const feedback: FocusFeedback[] = [
      {
        id: 'fb-1',
        candidateId: 'task:task-overdue',
        action: 'snoozed',
        createdAt: '2026-04-16T08:30:00.000Z',
        snoozedUntil: '2026-04-16T10:00:00.000Z',
      },
    ];

    const result = buildDashboardFocusCandidates({
      tasks: [
        makeTask({
          id: 'task-overdue',
          title: 'Send the invoice',
          dueDate: '2026-04-15',
          priority: 'high',
        }),
        makeTask({
          id: 'task-backup',
          title: 'Review the notes',
          dueDate: '2026-04-16',
          priority: 'medium',
        }),
      ],
      calendarSources: [],
      calendarEvents: [],
      projects: [],
      gamification: {
        totalXp: 0,
        level: 1,
        currentStreak: 0,
        longestStreak: 0,
        totalTasksCompleted: 0,
        badges: [],
      },
      feedback,
      now: new Date('2026-04-16T09:00:00.000Z'),
    });

    expect(result.candidates.some(candidate => candidate.id === 'task:task-overdue')).toBe(false);
    expect(result.candidates[0].id).toBe('task:task-backup');
  });

  it('parses explicit duration from the task title and keeps it user-visible', () => {
    const result = buildDashboardFocusCandidates({
      tasks: [
        makeTask({
          id: 'habit-walk',
          title: 'Walk 1 hour',
          category: 'daily',
          recurring: {
            frequency: 'daily',
          },
        }),
      ],
      calendarSources: [],
      calendarEvents: [],
      projects: [],
      gamification: {
        totalXp: 0,
        level: 1,
        currentStreak: 1,
        longestStreak: 1,
        totalTasksCompleted: 0,
        badges: [],
      },
      feedback: [],
      now: new Date('2026-04-16T09:00:00.000Z'),
    });

    expect(result.candidates[0]).toEqual(expect.objectContaining({
      id: 'daily:habit-walk',
      estimatedMinutes: 60,
      estimatedMinutesSource: 'task_title',
    }));
  });

  it('keeps heuristic task durations out of the user-facing candidate metadata', () => {
    const result = buildDashboardFocusCandidates({
      tasks: [
        makeTask({
          id: 'habit-pushups',
          title: '25 Push Ups',
          category: 'daily',
          recurring: {
            frequency: 'daily',
          },
        }),
      ],
      calendarSources: [],
      calendarEvents: [],
      projects: [],
      gamification: {
        totalXp: 0,
        level: 1,
        currentStreak: 0,
        longestStreak: 0,
        totalTasksCompleted: 0,
        badges: [],
      },
      feedback: [],
      now: new Date('2026-04-16T09:00:00.000Z'),
    });

    expect(result.candidates[0].estimatedMinutes).toBeUndefined();
    expect(result.candidates[0].estimatedMinutesSource).toBe('heuristic');
  });

  it('falls back locally when hosted focus returns invalid JSON', async () => {
    chatWithHostedAssistantDetailedMock.mockResolvedValueOnce({
      text: '{"selectedCandidateId":42}',
      model: 'gpt-5.4-mini',
    });

    const buildResult = buildDashboardFocusCandidates({
      tasks: [
        makeTask({
          id: 'task-overdue',
          title: 'Send the invoice',
          dueDate: '2026-04-15',
          priority: 'high',
        }),
      ],
      calendarSources: [],
      calendarEvents: [],
      projects: [],
      gamification: {
        totalXp: 0,
        level: 1,
        currentStreak: 0,
        longestStreak: 0,
        totalTasksCompleted: 0,
        badges: [],
      },
      feedback: [],
      now: new Date('2026-04-16T09:00:00.000Z'),
    });

    const result = await selectDashboardFocusRecommendation(buildResult, {
      now: new Date('2026-04-16T09:00:00.000Z'),
      settings: {
        assistantProvider: 'hosted',
        hostedModel: 'gpt-5.4-mini',
      },
    });

    expect(result.source).toBe('local');
    expect(result.status).toBe('fallback');
    expect(result.fallbackReason).toBe('invalid_schema');
    expect(result.recommendation.selectedCandidateId).toBe('task:task-overdue');
  });

  it('uses the hosted GPT choice when the response is valid', async () => {
    const buildResult = buildDashboardFocusCandidates({
      tasks: [
        makeTask({
          id: 'task-overdue',
          title: 'Send the invoice',
          dueDate: '2026-04-15',
          priority: 'high',
        }),
        makeTask({
          id: 'habit-1',
          title: 'Morning review',
          category: 'daily',
          recurring: {
            frequency: 'daily',
          },
        }),
      ],
      calendarSources: [],
      calendarEvents: [],
      projects: [],
      gamification: {
        totalXp: 0,
        level: 1,
        currentStreak: 0,
        longestStreak: 0,
        totalTasksCompleted: 0,
        badges: [],
      },
      feedback: [],
      now: new Date('2026-04-16T09:00:00.000Z'),
    });

    const result = await selectDashboardFocusRecommendation(buildResult, {
      now: new Date('2026-04-16T09:00:00.000Z'),
      settings: {
        assistantProvider: 'auto',
        hostedModel: 'gpt-5.4-mini',
      },
    });

    expect(result.source).toBe('openai');
    expect(result.recommendation.selectedCandidateId).toBe('task:task-overdue');
    expect(result.recommendation.why).toContain('overdue');
    expect(result.recommendation.estimatedMinutes).toBeUndefined();
    expect(result.queueCandidateIds[0]).toBe('task:task-overdue');
  });

  it('skips hosted review after the daily GPT pass has already run', async () => {
    const buildResult = buildDashboardFocusCandidates({
      tasks: [
        makeTask({
          id: 'task-overdue',
          title: 'Send the invoice',
          dueDate: '2026-04-15',
          priority: 'high',
        }),
      ],
      calendarSources: [],
      calendarEvents: [],
      projects: [],
      gamification: {
        totalXp: 0,
        level: 1,
        currentStreak: 0,
        longestStreak: 0,
        totalTasksCompleted: 0,
        badges: [],
      },
      feedback: [],
      now: new Date('2026-04-16T09:00:00.000Z'),
    });

    const result = await selectDashboardFocusRecommendation(buildResult, {
      allowHostedReview: false,
      now: new Date('2026-04-16T09:00:00.000Z'),
      settings: {
        assistantProvider: 'hosted',
        hostedModel: 'gpt-5.4-mini',
      },
    });

    expect(result.source).toBe('local');
    expect(result.fallbackReason).toBeUndefined();
    expect(testHostedAssistantConnectionMock).not.toHaveBeenCalled();
    expect(chatWithHostedAssistantDetailedMock).not.toHaveBeenCalled();
  });
});
