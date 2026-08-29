import type { AssistantCommandContext } from '../assistant/shared';
import type {
  CalendarAccount,
  CalendarEvent,
  CalendarSource,
  DailyMomentumState,
  GamificationProfile,
  PrayerScheduleDay,
  PrayerScheduleEntry,
  Task,
} from '../types/domain';

export const TEST_NOW_ISO = '2026-08-29T10:00:00.000Z';

export function makeTask(overrides: Partial<Task> = {}): Task {
  return {
    id: 'task-review',
    title: 'Review the release checklist',
    description: 'Confirm the hosted web checks.',
    completed: false,
    priority: 'medium',
    category: 'task',
    createdAt: '2026-08-28T10:00:00.000Z',
    updatedAt: '2026-08-28T10:00:00.000Z',
    ...overrides,
  };
}

export function makeCalendarAccount(overrides: Partial<CalendarAccount> = {}): CalendarAccount {
  return {
    id: 'account-local',
    name: 'Personal calendar',
    email: 'me@example.test',
    provider: 'local',
    isPrimary: true,
    connected: true,
    mocked: false,
    ...overrides,
  };
}

export function makeCalendarSource(overrides: Partial<CalendarSource> = {}): CalendarSource {
  return {
    id: 'source-local',
    accountId: 'account-local',
    name: 'Personal',
    color: '#3366ff',
    visible: true,
    ...overrides,
  };
}

export function makeCalendarEvent(overrides: Partial<CalendarEvent> = {}): CalendarEvent {
  return {
    id: 'event-standup',
    sourceId: 'source-local',
    title: 'Stand-up',
    description: '',
    start: '2026-08-29T10:00:00.000Z',
    end: '2026-08-29T11:00:00.000Z',
    allDay: false,
    ...overrides,
  };
}

export function makeGamification(): GamificationProfile {
  return {
    totalXp: 0,
    level: 1,
    currentStreak: 0,
    longestStreak: 0,
    totalTasksCompleted: 0,
    badges: [],
    habitTallies: {},
    dailyLog: {},
    prayerCompletionLedger: {},
  };
}

export function makeAssistantContext(
  overrides: Partial<AssistantCommandContext> = {},
): AssistantCommandContext {
  return {
    calendarAccounts: [],
    calendarSources: [],
    calendarEvents: [],
    inventoryItems: [],
    inventoryNeeds: [],
    tasks: [],
    financeAccounts: [],
    transactions: [],
    knowledgeEntries: [],
    knowledgeTopics: [],
    lifestyleItems: [],
    projects: [],
    gamification: makeGamification(),
    now: new Date(TEST_NOW_ISO),
    timezone: 'UTC',
    ...overrides,
  };
}

export function makePrayerScheduleEntries(): PrayerScheduleEntry[] {
  return [
    { name: 'Fajr', time: '05:00' },
    { name: 'Sunrise', time: '06:00' },
    { name: 'Dhuhr', time: '12:00' },
    { name: 'Asr', time: '15:00' },
    { name: 'Sunset', time: '19:00' },
    { name: 'Maghrib', time: '19:05' },
    { name: 'Isha', time: '21:00' },
    { name: 'Midnight', time: '00:00' },
  ];
}

export function makePrayerScheduleDay(
  date = '2026-08-29',
  timezone = 'Europe/London',
): PrayerScheduleDay {
  return {
    date,
    timezone,
    prayers: makePrayerScheduleEntries(),
  };
}

export function makeMomentumState(): DailyMomentumState {
  return {
    schemaVersion: 1,
    templates: [],
    logs: {},
    reminderPreferences: {
      learn: { enabled: false, afterPrayers: [] },
      move: { enabled: false, afterPrayers: [] },
    },
  };
}
