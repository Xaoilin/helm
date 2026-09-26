import { describe, expect, it } from 'vitest';
import { toLocalDateStr } from '../services/localDate';
import {
  areTaskFormsEqual,
  buildCompletionReward,
  buildHabitResetUpdate,
  buildStreakBreakUpdate,
  buildTaskFromForm,
  buildTaskToggleUpdate,
  canSaveTaskForm,
  countKnowledgeProgress,
  createTaskForm,
  filterAllTasks,
  filterByProject,
  filterGoals,
  getAllTaskSectionId,
  getCompletionAppDate,
  getTaskAppDate,
  getTaskDueStatus,
  groupAllTaskSections,
  isCompletionLocked,
  isWeekdayDate,
  resolvePrayerRolloverDate,
  selectHabitsToReset,
  selectTodayTasks,
  summarizeAllTasks,
  taskToForm,
  weekdayOfDate,
  type CompletionRewardInput,
} from '../services/taskModel';
import type { GamificationProfile, Task } from '../types/domain';
import { makeGamification, makeTask } from './fixtures';

// 12:30 UTC on Saturday 26 September 2026: 13:30 in London, 00:30 on Sunday 27th in Auckland.
const NEAR_AUCKLAND_MIDNIGHT = new Date('2026-09-26T12:30:00.000Z');

function habit(overrides: Partial<Task> = {}): Task {
  return makeTask({
    id: 'habit-read',
    title: 'Read',
    category: 'daily',
    completed: true,
    completedAt: '2026-09-25T08:00:00.000Z',
    recurring: { frequency: 'daily', lastReset: '2026-09-25' },
    ...overrides,
  });
}

function prayerTask(overrides: Partial<Task> = {}): Task {
  return makeTask({
    id: 'prayer-fajr',
    title: 'Fajr',
    category: 'prayer',
    prayerName: 'Fajr',
    completed: true,
    recurring: { frequency: 'daily', lastReset: '2026-09-25' },
    ...overrides,
  });
}

const NO_KNOWLEDGE = countKnowledgeProgress({ knowledgeEntries: [], knowledgeTopics: [], lifestyleItems: [] });

function rewardInput(overrides: Partial<CompletionRewardInput> = {}): CompletionRewardInput {
  const task = overrides.task ?? makeTask();
  return {
    task,
    tasks: [task],
    profile: makeGamification(),
    goalTags: [],
    knowledge: NO_KNOWLEDGE,
    now: NEAR_AUCKLAND_MIDNIGHT,
    appDate: '2026-09-26',
    appTimeZone: 'Europe/London',
    ...overrides,
  };
}

describe('task app dates', () => {
  it('reads today in the app time zone rather than the device zone', () => {
    expect(getTaskAppDate(NEAR_AUCKLAND_MIDNIGHT, 'Europe/London')).toBe('2026-09-26');
    expect(getTaskAppDate(NEAR_AUCKLAND_MIDNIGHT, 'Pacific/Auckland')).toBe('2026-09-27');
  });

  it('refuses an unusable time zone instead of guessing', () => {
    expect(() => getTaskAppDate(NEAR_AUCKLAND_MIDNIGHT, 'Not/AZone')).toThrow(RangeError);
  });

  it('names the weekday of a date key without the device zone', () => {
    expect(weekdayOfDate('2026-09-26')).toBe(6);
    expect(isWeekdayDate('2026-09-26')).toBe(false);
    expect(isWeekdayDate('2026-09-27')).toBe(false);
    expect(isWeekdayDate('2026-09-28')).toBe(true);
  });

  it('uses the stamped completion date, or the completion instant in the app zone', () => {
    expect(getCompletionAppDate({ completedAt: '2026-09-26T12:30:00.000Z', completedLocalDate: '2026-09-26' }, 'Pacific/Auckland')).toBe('2026-09-26');
    expect(getCompletionAppDate({ completedAt: '2026-09-26T12:30:00.000Z' }, 'Pacific/Auckland')).toBe('2026-09-27');
    expect(getCompletionAppDate({}, 'Europe/London')).toBeUndefined();
  });
});

describe('due status', () => {
  it('classifies overdue, today, tomorrow, and later due dates', () => {
    expect(getTaskDueStatus({ dueDate: '2026-09-25', completed: false }, '2026-09-26')).toBe('overdue');
    expect(getTaskDueStatus({ dueDate: '2026-09-26', completed: false }, '2026-09-26')).toBe('today');
    expect(getTaskDueStatus({ dueDate: '2026-09-27', completed: false }, '2026-09-26')).toBe('tomorrow');
    expect(getTaskDueStatus({ dueDate: '2026-10-01', completed: false }, '2026-09-26')).toBe('future');
    expect(getTaskDueStatus({ completed: false }, '2026-09-26')).toBeNull();
  });

  it('never calls a completed task overdue', () => {
    expect(getTaskDueStatus({ dueDate: '2026-09-25', completed: true }, '2026-09-26')).toBe('future');
  });

  it('follows the app zone across a London and Auckland date difference', () => {
    const task = { dueDate: '2026-09-26', completed: false };
    expect(getTaskDueStatus(task, getTaskAppDate(NEAR_AUCKLAND_MIDNIGHT, 'Europe/London'))).toBe('today');
    expect(getTaskDueStatus(task, getTaskAppDate(NEAR_AUCKLAND_MIDNIGHT, 'Pacific/Auckland'))).toBe('overdue');
  });
});

describe('daily habit rollover', () => {
  const dates = { appDate: '2026-09-28', prayerDate: '2026-09-28' };

  it('resets a completed habit last reset on an earlier day', () => {
    expect(selectHabitsToReset([habit()], dates).map(task => task.id)).toEqual(['habit-read']);
  });

  it('leaves habits already reset or completed today, open habits, and one-off tasks alone', () => {
    const tasks = [
      habit({ id: 'reset-today', recurring: { frequency: 'daily', lastReset: '2026-09-28' } }),
      habit({ id: 'stamped-later', recurring: { frequency: 'daily', lastReset: '2026-09-29' } }),
      habit({ id: 'open', completed: false }),
      makeTask({ id: 'one-off', completed: true }),
    ];
    expect(selectHabitsToReset(tasks, dates)).toEqual([]);
  });

  it('resets a habit that was never stamped', () => {
    expect(selectHabitsToReset([habit({ recurring: { frequency: 'daily' } })], dates)).toHaveLength(1);
  });

  it('keeps weekday-only habits completed over the weekend and resets them on Monday', () => {
    const weekdayHabit = habit({ recurring: { frequency: 'weekdays', lastReset: '2026-09-25' } });
    expect(selectHabitsToReset([weekdayHabit], { appDate: '2026-09-26', prayerDate: null })).toEqual([]);
    expect(selectHabitsToReset([weekdayHabit], { appDate: '2026-09-27', prayerDate: null })).toEqual([]);
    expect(selectHabitsToReset([weekdayHabit], { appDate: '2026-09-28', prayerDate: null })).toHaveLength(1);
  });

  it('resets prayer tasks against the prayer date and waits while it is unknown', () => {
    const fajr = prayerTask({ recurring: { frequency: 'daily', lastReset: '2026-09-27' } });
    expect(selectHabitsToReset([fajr], { appDate: '2026-09-28', prayerDate: '2026-09-27' })).toEqual([]);
    expect(selectHabitsToReset([fajr], { appDate: '2026-09-28', prayerDate: null })).toEqual([]);
    expect(selectHabitsToReset([fajr], { appDate: '2026-09-27', prayerDate: '2026-09-28' })).toHaveLength(1);
  });

  it('reopens a habit and stamps the reset date so a second pass selects nothing', () => {
    const update = buildHabitResetUpdate(habit(), dates);
    expect(update).toEqual({
      completed: false,
      completedAt: undefined,
      recurring: { frequency: 'daily', lastReset: '2026-09-28' },
    });
    expect(selectHabitsToReset([{ ...habit(), ...update }], dates)).toEqual([]);
  });

  it('stamps prayer tasks with the prayer date', () => {
    expect(buildHabitResetUpdate(prayerTask(), { appDate: '2026-09-29', prayerDate: '2026-09-28' }).recurring?.lastReset).toBe('2026-09-28');
  });

  it('refuses to build a reset for a task that is not a resettable habit', () => {
    expect(() => buildHabitResetUpdate(makeTask(), dates)).toThrow();
    expect(() => buildHabitResetUpdate(prayerTask(), { appDate: '2026-09-28', prayerDate: null })).toThrow();
  });

  it('chooses the prayer rollover date from the timetable, or the app date when prayer times are off', () => {
    const base = { prayerToday: '2026-09-27', appDate: '2026-09-28' };
    expect(resolvePrayerRolloverDate({ ...base, prayerEnabled: true, scheduleTimezoneValid: true })).toBe('2026-09-27');
    expect(resolvePrayerRolloverDate({ ...base, prayerEnabled: true, scheduleTimezoneValid: false })).toBeNull();
    expect(resolvePrayerRolloverDate({ ...base, prayerEnabled: false, scheduleTimezoneValid: false })).toBe('2026-09-28');
  });
});

describe('streak break', () => {
  const now = new Date(2026, 8, 26, 12);
  const daysAgo = (days: number) => toLocalDateStr(new Date(2026, 8, 26 - days, 12));
  const profile = (overrides: Partial<GamificationProfile>) => ({ ...makeGamification(), currentStreak: 4, ...overrides });

  it('zeroes a streak whose last completion was before yesterday', () => {
    expect(buildStreakBreakUpdate(profile({ lastCompletionDate: daysAgo(2) }), now)?.currentStreak).toBe(0);
  });

  it('keeps a streak completed today or yesterday, and ignores an empty streak', () => {
    expect(buildStreakBreakUpdate(profile({ lastCompletionDate: daysAgo(1) }), now)).toBeNull();
    expect(buildStreakBreakUpdate(profile({ lastCompletionDate: daysAgo(0) }), now)).toBeNull();
    expect(buildStreakBreakUpdate(profile({ currentStreak: 0, lastCompletionDate: daysAgo(5) }), now)).toBeNull();
  });
});

describe('task completion', () => {
  it('locks completed habits but not completed one-off tasks', () => {
    expect(isCompletionLocked(habit())).toBe(true);
    expect(isCompletionLocked(habit({ completed: false }))).toBe(false);
    expect(isCompletionLocked(makeTask({ completed: true }))).toBe(false);
  });

  it('stamps a completed habit as reset for the app date', () => {
    expect(buildTaskToggleUpdate(habit({ completed: false }), NEAR_AUCKLAND_MIDNIGHT, '2026-09-27')).toEqual({
      completed: true,
      completedAt: '2026-09-26T12:30:00.000Z',
      recurring: { frequency: 'daily', lastReset: '2026-09-27' },
    });
  });

  it('reopens a one-off task without a reset stamp', () => {
    expect(buildTaskToggleUpdate(makeTask({ completed: true }), NEAR_AUCKLAND_MIDNIGHT, '2026-09-26')).toEqual({
      completed: false,
      completedAt: undefined,
    });
  });

  it('awards XP for a first habit completion and logs it under the app date', () => {
    const task = habit({ completed: false });
    const reward = buildCompletionReward(rewardInput({ task, tasks: [task], appDate: '2026-09-27', appTimeZone: 'Pacific/Auckland' }));
    expect(reward?.result.xpEarned).toBeGreaterThan(0);
    expect(reward?.profile.totalXp).toBe(reward?.result.xpEarned);
    expect(reward?.profile.dailyLog).toEqual({ '2026-09-27': ['habit-read'] });
  });

  it('refuses a second reward for the same habit on the same app date', () => {
    const task = habit({ completed: false });
    const profile = { ...makeGamification(), dailyLog: { '2026-09-26': ['habit-read'] } };
    expect(buildCompletionReward(rewardInput({ task, profile }))).toBeNull();
    expect(buildCompletionReward(rewardInput({ task, profile, appDate: '2026-09-27' }))).not.toBeNull();
  });

  it('rewards one-off tasks without logging them as habits', () => {
    const task = makeTask({ id: 'report' });
    const profile = { ...makeGamification(), dailyLog: { '2026-09-26': ['report'] } };
    const reward = buildCompletionReward(rewardInput({ task, profile }));
    expect(reward?.result.xpEarned).toBeGreaterThan(0);
    expect(reward?.profile.dailyLog).toEqual({ '2026-09-26': ['report'] });
  });

  it('counts knowledge progress for badge checks', () => {
    expect(countKnowledgeProgress({
      knowledgeEntries: [{}, {}] as never[],
      knowledgeTopics: [{}] as never[],
      lifestyleItems: [
        { type: 'haram', status: 'mastered' },
        { type: 'halal', status: 'consistent' },
        { type: 'halal', status: 'learning' },
      ] as never[],
    })).toEqual({
      knowledgeEntries: 2,
      knowledgeTopics: 1,
      lifestyleHaramMastered: 1,
      lifestyleHalalConsistent: 1,
      lifestyleTotal: 3,
    });
  });
});

describe('task views', () => {
  const appDate = '2026-09-26';
  const tasks = [
    makeTask({ id: 'overdue', dueDate: '2026-09-20', priority: 'low' }),
    makeTask({ id: 'today-done', dueDate: appDate, completed: true }),
    makeTask({ id: 'today', dueDate: appDate, priority: 'high', projectId: 'p1' }),
    makeTask({ id: 'upcoming', dueDate: '2026-10-02' }),
    makeTask({ id: 'later' }),
    habit({ id: 'routine', completed: false }),
    prayerTask({ id: 'isha', title: 'Isha', prayerName: 'Isha', completed: false }),
    prayerTask({ id: 'fajr' }),
    makeTask({ id: 'goal', category: 'goal', goalTag: 'Health' }),
    makeTask({ id: 'goal-untagged', category: 'goal' }),
    makeTask({ id: 'goal-done', category: 'goal', goalTag: 'Health', completed: true }),
  ];

  it('builds the Today view with open items first', () => {
    const today = selectTodayTasks(tasks, appDate);
    expect(today.prayerTasks.map(task => task.id)).toEqual(['isha', 'fajr']);
    expect(today.dailyHabits.map(task => task.id)).toEqual(['routine']);
    expect(today.dueTodayTasks.map(task => task.id)).toEqual(['overdue', 'today', 'today-done']);
  });

  it('filters by project', () => {
    expect(filterByProject(tasks, 'p1').map(task => task.id)).toEqual(['today']);
    expect(filterByProject(tasks, 'all')).toHaveLength(tasks.length);
  });

  it('filters and orders All Tasks by status, priority, then due date', () => {
    const all = filterAllTasks(tasks, { category: 'task', priority: 'all', status: 'all' });
    expect(all.map(task => task.id)).toEqual(['today', 'upcoming', 'later', 'overdue', 'today-done']);
    expect(filterAllTasks(tasks, { category: 'all', priority: 'all', status: 'completed' }).map(task => task.id)).toEqual(['today-done', 'fajr']);
    expect(filterAllTasks(tasks, { category: 'all', priority: 'high', status: 'active' }).map(task => task.id)).toEqual(['today']);
  });

  it('summarizes and groups open work into sections', () => {
    const nonGoals = tasks.filter(task => task.category !== 'goal');
    expect(summarizeAllTasks(nonGoals, appDate)).toEqual({ active: 6, completed: 2, overdue: 1, dueToday: 1, prayers: 1, routines: 1 });
    expect(groupAllTaskSections(nonGoals, appDate).map(section => [section.id, section.items.map(task => task.id)])).toEqual([
      ['overdue', ['overdue']],
      ['today', ['today']],
      ['upcoming', ['upcoming']],
      ['prayers', ['isha']],
      ['routines', ['routine']],
      ['later', ['later']],
    ]);
    expect(getAllTaskSectionId(makeTask({ dueDate: '2026-09-27' }), appDate)).toBe('upcoming');
  });

  it('filters goals by category, including uncategorized goals', () => {
    expect(filterGoals(tasks, 'all', false).map(task => task.id)).toEqual(['goal', 'goal-untagged']);
    expect(filterGoals(tasks, '', false).map(task => task.id)).toEqual(['goal-untagged']);
    expect(filterGoals(tasks, 'Health', true).map(task => task.id)).toEqual(['goal-done']);
  });
});

describe('task editor form', () => {
  it('creates a blank form with the given defaults and round-trips an existing task', () => {
    const form = createTaskForm({ category: 'goal', dueDate: '', goalTag: 'Health', projectId: '' });
    expect(form).toMatchObject({ category: 'goal', goalTag: 'Health', title: '', prayerName: 'Fajr', recurringFreq: 'daily' });
    const existing = habit({ emoji: '📚', recurring: { frequency: 'weekdays' } });
    expect(taskToForm(existing)).toMatchObject({ title: 'Read', category: 'daily', recurringFreq: 'weekdays', habitEmoji: '📚' });
    expect(areTaskFormsEqual(taskToForm(existing), taskToForm(existing))).toBe(true);
    expect(areTaskFormsEqual(form, { ...form, title: 'x' })).toBe(false);
  });

  it('requires a title except for prayer tasks', () => {
    expect(canSaveTaskForm({ category: 'task', title: '  ' })).toBe(false);
    expect(canSaveTaskForm({ category: 'prayer', title: '' })).toBe(true);
    const blank = createTaskForm({ category: 'task', dueDate: '', goalTag: '', projectId: '' });
    expect(buildTaskFromForm(blank, null, [])).toBeNull();
  });

  it('names prayer tasks after their prayer and drops fields that do not apply', () => {
    const form = { ...createTaskForm({ category: 'prayer', dueDate: '2026-09-26', goalTag: '', projectId: 'p1' }), prayerName: 'Asr' as const };
    expect(buildTaskFromForm(form, null, [])).toMatchObject({
      category: 'prayer',
      prayerName: 'Asr',
      dueDate: undefined,
      projectId: undefined,
      recurring: { frequency: 'daily', lastReset: undefined },
    });
  });

  it('puts a new project task at the end of its board and keeps an edited task in place', () => {
    const board = [makeTask({ id: 'a', projectId: 'p1', boardOrder: 3 }), makeTask({ id: 'b', projectId: 'p2', boardOrder: 9 })];
    const form = { ...createTaskForm({ category: 'task', dueDate: '', goalTag: '', projectId: 'p1' }), title: 'Ship' };
    expect(buildTaskFromForm(form, null, board)).toMatchObject({ projectId: 'p1', boardOrder: 4, workflowState: 'backlog' });
    const editing = board[0];
    expect(buildTaskFromForm({ ...taskToForm(editing), title: 'Renamed' }, editing, board)).toMatchObject({ title: 'Renamed', boardOrder: 3 });
  });

  it('keeps completion and the last reset when editing a habit', () => {
    const editing = habit();
    expect(buildTaskFromForm(taskToForm(editing), editing, [editing])).toMatchObject({
      completed: true,
      completedAt: editing.completedAt,
      recurring: { frequency: 'daily', lastReset: '2026-09-25' },
    });
  });
});
