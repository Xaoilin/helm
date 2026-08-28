// @vitest-environment node
import { describe, expect, it, vi } from 'vitest';
import { executeActionPlan } from '../assistant/executor';
import { DEFAULT_PROFILE } from '../services/gamification';
import type { AssistantCommandContext } from '../assistant/shared';
import type { ActionPlan } from '../assistant/plannerSchema';

function makeContext(): AssistantCommandContext {
  return {
    calendarAccounts: [{
      id: 'acc-google',
      name: 'Google',
      email: 'alisa@example.com',
      provider: 'google',
      isPrimary: true,
      connected: true,
      mocked: false,
    }],
    calendarSources: [{
      id: 'src-google',
      accountId: 'acc-google',
      name: 'Primary',
      color: '#4f5bff',
      visible: true,
      googleCalendarId: 'alisa@example.com',
    }],
    calendarEvents: [{
      id: 'evt-google',
      sourceId: 'src-google',
      title: 'Planning',
      description: '',
      start: '2026-05-06T10:00:00.000Z',
      end: '2026-05-06T11:00:00.000Z',
      allDay: false,
      googleEventId: 'google-event-1',
      googleCalendarId: 'alisa@example.com',
    }],
    tasks: [],
    financeAccounts: [],
    transactions: [],
    knowledgeEntries: [],
    knowledgeTopics: [],
    lifestyleItems: [],
    projects: [],
    gamification: DEFAULT_PROFILE,
    prayerTimes: [],
    goalTags: [],
    currentSurface: 'chat',
    now: new Date('2026-05-06T09:00:00.000Z'),
  };
}

describe('assistant calendar provider guardrails', () => {
  it('does not create local-only copies for Google-backed calendars', () => {
    const addCalendarEvent = vi.fn();
    const plan: ActionPlan = {
      mode: 'act',
      response: '',
      confidence: 1,
      steps: [{
        capability: 'calendar.create_event',
        args: {
          calendarSourceId: 'src-google',
          title: 'New meeting',
          start: '2026-05-06T12:00:00.000Z',
          end: '2026-05-06T13:00:00.000Z',
        },
      }],
    };

    const result = executeActionPlan(plan, makeContext(), {
      addTask: vi.fn(),
      addCalendarEvent,
    }, 'en');

    expect(result.kind).toBe('clarify');
    expect(addCalendarEvent).not.toHaveBeenCalled();
  });

  it('does not move Google-backed events as offline local mutations', () => {
    const updateCalendarEvent = vi.fn();
    const plan: ActionPlan = {
      mode: 'act',
      response: '',
      confidence: 1,
      steps: [{
        capability: 'calendar.reschedule_event',
        args: {
          eventId: 'evt-google',
          start: '2026-05-06T14:00:00.000Z',
          end: '2026-05-06T15:00:00.000Z',
        },
      }],
    };

    const result = executeActionPlan(plan, makeContext(), {
      addTask: vi.fn(),
      updateCalendarEvent,
    }, 'en');

    expect(result.kind).toBe('clarify');
    expect(updateCalendarEvent).not.toHaveBeenCalled();
  });
});
