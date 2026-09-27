/**
 * Task rules shared by the Tasks page and the daily rollover workflow.
 *
 * Plain functions only: every rule takes the current instant, app date, and
 * time zone as arguments so it can be tested without React or a real clock.
 *
 * Dates:
 * - Generic task dates (due dates, "today", habit resets) use the app time
 *   zone (`settings.appTimeZone.effectiveTimeZone`).
 * - The daily reset, completion stamps, XP and streaks belong to the planner
 *   service; prayer habits reopen by the prayer timetable's date there.
 */
import type {
  PrayerName,
  Task,
  TaskCategory,
  TaskPriority,
} from '../types/domain';
import { getAppDate } from './appTimeZone';
import { addLocalDays } from './localDate';
import {
  comparePrayerTasks,
  getPrayerTaskTitle,
  isHabitTask,
  isPrayerTask,
  isStandardDailyTask,
} from './prayerTasks';

// ── Dates ──

/** The app's calendar date for an instant. Throws when the zone or instant is unusable. */
export function getTaskAppDate(now: Date, appTimeZone: string): string {
  const appDate = getAppDate(now, appTimeZone);
  if (!appDate) throw new RangeError(`Cannot resolve the app date in time zone "${appTimeZone}".`);
  return appDate;
}

/** Day of week (0 = Sunday) for a `YYYY-MM-DD` key, independent of the device zone. */
export function weekdayOfDate(date: string): number {
  const [year, month, day] = date.split('-').map(Number);
  return new Date(Date.UTC(year, month - 1, day)).getUTCDay();
}

export function isWeekdayDate(date: string): boolean {
  const weekday = weekdayOfDate(date);
  return weekday >= 1 && weekday <= 5;
}

/** App date on which a completed task was completed, or undefined when it is not completed. */
export function getCompletionAppDate(task: Pick<Task, 'completedAt' | 'completedLocalDate'>, appTimeZone: string): string | undefined {
  if (task.completedLocalDate) return task.completedLocalDate;
  if (!task.completedAt) return undefined;
  return getAppDate(new Date(task.completedAt), appTimeZone) ?? undefined;
}

export type TaskDueStatus = 'overdue' | 'today' | 'tomorrow' | 'future';

/** Where a task's due date sits relative to the app date. Completed tasks are never overdue. */
export function getTaskDueStatus(task: Pick<Task, 'dueDate' | 'completed'>, appDate: string): TaskDueStatus | null {
  if (!task.dueDate) return null;
  if (task.dueDate < appDate) return task.completed ? 'future' : 'overdue';
  if (task.dueDate === appDate) return 'today';
  if (task.dueDate === addLocalDays(appDate, 1)) return 'tomorrow';
  return 'future';
}

// ── Daily rollover ──

/**
 * The time zone prayer habits reopen in, for the planner service's daily reset.
 *
 * While prayer times are on but the timetable zone is still unknown (loading or unavailable), prayer
 * habits wait (null) rather than reopen by a guessed date. With prayer times switched off there is no
 * timetable, so the app's zone is used.
 */
export function resolvePrayerRolloverZone(input: {
  prayerEnabled: boolean;
  scheduleTimezoneValid: boolean;
  scheduleTimeZone: string | null;
  appTimeZone: string;
}): string | null {
  if (!input.prayerEnabled) return input.appTimeZone;
  return input.scheduleTimezoneValid && input.scheduleTimeZone ? input.scheduleTimeZone : null;
}

// ── Completion ──

/** Habits stay completed for the rest of their day; only the daily reset reopens them. */
export function isCompletionLocked(task: Pick<Task, 'category' | 'completed'>): boolean {
  return isHabitTask(task) && task.completed;
}

// ── Today view ──

function completedLast(left: Task, right: Task): number {
  return left.completed === right.completed ? 0 : left.completed ? 1 : -1;
}

export function filterByProject(tasks: readonly Task[], projectId: string): Task[] {
  return projectId === 'all' ? [...tasks] : tasks.filter(task => task.projectId === projectId);
}

export interface TodayTasks {
  prayerTasks: Task[];
  dailyHabits: Task[];
  dueTodayTasks: Task[];
}

/** Prayers, daily habits, and one-off tasks due today or earlier, open items first. */
export function selectTodayTasks(tasks: readonly Task[], appDate: string): TodayTasks {
  return {
    prayerTasks: tasks
      .filter(isPrayerTask)
      .sort((left, right) => completedLast(left, right) || comparePrayerTasks(left, right)),
    dailyHabits: tasks.filter(isStandardDailyTask).sort(completedLast),
    dueTodayTasks: tasks
      .filter(task => task.category === 'task' && task.dueDate && task.dueDate <= appDate)
      .sort((left, right) => completedLast(left, right) || (left.dueDate || '').localeCompare(right.dueDate || '')),
  };
}

// ── All Tasks view ──

export interface AllTaskFilters {
  category: 'all' | 'daily' | 'prayer' | 'task';
  priority: 'all' | TaskPriority;
  status: 'all' | 'active' | 'completed';
}

const PRIORITY_ORDER: Record<TaskPriority, number> = { high: 0, medium: 1, low: 2 };

/** Non-goal tasks matching the filters: open first, then priority, then due date. */
export function filterAllTasks(tasks: readonly Task[], filters: AllTaskFilters): Task[] {
  return tasks
    .filter(task => task.category !== 'goal')
    .filter(task => filters.category === 'all' || task.category === filters.category)
    .filter(task => filters.priority === 'all' || task.priority === filters.priority)
    .filter(task => filters.status === 'all' || (filters.status === 'completed') === task.completed)
    .sort((left, right) => (
      completedLast(left, right)
      || PRIORITY_ORDER[left.priority] - PRIORITY_ORDER[right.priority]
      || (left.dueDate || '9999').localeCompare(right.dueDate || '9999')
    ));
}

export interface AllTaskStats {
  active: number;
  completed: number;
  overdue: number;
  dueToday: number;
  prayers: number;
  routines: number;
}

export function summarizeAllTasks(tasks: readonly Task[], appDate: string): AllTaskStats {
  const open = tasks.filter(task => !task.completed);
  const openOneOff = open.filter(task => task.category === 'task');
  return {
    active: open.length,
    completed: tasks.length - open.length,
    overdue: openOneOff.filter(task => getTaskDueStatus(task, appDate) === 'overdue').length,
    dueToday: openOneOff.filter(task => task.dueDate === appDate).length,
    prayers: open.filter(isPrayerTask).length,
    routines: open.filter(task => task.category === 'daily').length,
  };
}

export type AllTaskSectionId = 'overdue' | 'today' | 'upcoming' | 'prayers' | 'routines' | 'later';

export interface AllTaskSection {
  id: AllTaskSectionId;
  title: string;
  description: string;
  items: Task[];
}

const ALL_TASK_SECTIONS: ReadonlyArray<Omit<AllTaskSection, 'items'>> = [
  { id: 'overdue', title: 'Overdue', description: 'Needs attention first.' },
  { id: 'today', title: 'Due today', description: 'Keep today moving without losing track.' },
  { id: 'upcoming', title: 'Upcoming', description: 'Scheduled next so you can plan ahead.' },
  { id: 'prayers', title: 'Islamic', description: 'Prayer commitments tracked in their own lane.' },
  { id: 'routines', title: 'Routines', description: 'Daily habits and repeating commitments.' },
  { id: 'later', title: 'Later', description: 'Open tasks without a due date yet.' },
];

export function getAllTaskSectionId(task: Task, appDate: string): AllTaskSectionId {
  if (isPrayerTask(task)) return 'prayers';
  if (task.category === 'daily') return 'routines';
  if (!task.dueDate) return 'later';
  if (task.dueDate < appDate) return 'overdue';
  if (task.dueDate === appDate) return 'today';
  return 'upcoming';
}

/** Open tasks grouped into their All Tasks sections, keeping order and dropping empty sections. */
export function groupAllTaskSections(tasks: readonly Task[], appDate: string): AllTaskSection[] {
  const open = tasks.filter(task => !task.completed);
  return ALL_TASK_SECTIONS
    .map(section => ({ ...section, items: open.filter(task => getAllTaskSectionId(task, appDate) === section.id) }))
    .filter(section => section.items.length > 0);
}

// ── Goals view ──

/** `goalTag` is 'all', '' for goals without a category, or a specific category. */
export function filterGoals(tasks: readonly Task[], goalTag: string, completed: boolean): Task[] {
  return tasks
    .filter(task => task.category === 'goal' && task.completed === completed)
    .filter(goal => goalTag === 'all' || (goalTag === '' ? !goal.goalTag : goal.goalTag === goalTag));
}

// ── Editor ──

export type RecurringFrequency = 'daily' | 'weekdays' | 'weekly';

export interface TaskFormState {
  title: string;
  description: string;
  priority: TaskPriority;
  category: TaskCategory;
  prayerName: PrayerName;
  dueDate: string;
  recurringFreq: RecurringFrequency;
  goalTag: string;
  habitEmoji: string;
  taskProjectId: string;
}

export function areTaskFormsEqual(left: TaskFormState, right: TaskFormState): boolean {
  return JSON.stringify(left) === JSON.stringify(right);
}

export function createTaskForm(defaults: { category: TaskCategory; dueDate: string; goalTag: string; projectId: string }): TaskFormState {
  return {
    title: '',
    description: '',
    priority: 'medium',
    category: defaults.category,
    prayerName: 'Fajr',
    dueDate: defaults.dueDate,
    recurringFreq: 'daily',
    goalTag: defaults.goalTag,
    habitEmoji: '',
    taskProjectId: defaults.projectId,
  };
}

export function taskToForm(task: Task): TaskFormState {
  return {
    title: task.title,
    description: task.description,
    priority: task.priority,
    category: task.category,
    prayerName: task.prayerName || 'Fajr',
    dueDate: task.dueDate || '',
    recurringFreq: task.recurring?.frequency || 'daily',
    goalTag: task.goalTag || '',
    habitEmoji: task.emoji || '',
    taskProjectId: task.projectId || '',
  };
}

export function canSaveTaskForm(form: Pick<TaskFormState, 'category' | 'title'>): boolean {
  return form.category === 'prayer' || form.title.trim().length > 0;
}

function nextProjectBoardOrder(tasks: readonly Task[], projectId: string): number {
  return tasks
    .filter(task => task.projectId === projectId && task.category === 'task')
    .reduce((max, task) => Math.max(max, task.boardOrder ?? 0), 0) + 1;
}

/**
 * The task record an editor form saves, or null when the form has no title.
 * Editing keeps completion, reset, and project-board state that the form does not show.
 */
export function buildTaskFromForm(
  form: TaskFormState,
  editing: Task | null,
  tasks: readonly Task[],
): Omit<Task, 'id' | 'createdAt' | 'updatedAt'> | null {
  const { category } = form;
  const title = category === 'prayer' ? getPrayerTaskTitle(form.prayerName) : form.title.trim();
  if (!title) return null;
  const isRoutine = category === 'daily' || category === 'prayer';
  const projectId = isRoutine ? undefined : (form.taskProjectId || undefined);
  const onProjectBoard = category === 'task' && Boolean(projectId);
  const boardOrder = onProjectBoard && projectId
    ? (editing && editing.projectId === projectId && typeof editing.boardOrder === 'number'
      ? editing.boardOrder
      : nextProjectBoardOrder(tasks, projectId))
    : undefined;
  const lastReset = editing?.recurring?.lastReset;
  return {
    title,
    description: form.description.trim(),
    priority: form.priority,
    category,
    completed: editing?.completed ?? false,
    completedAt: editing?.completedAt,
    dueDate: isRoutine ? undefined : (form.dueDate || undefined),
    recurring: category === 'daily'
      ? { frequency: form.recurringFreq, lastReset }
      : category === 'prayer'
        ? { frequency: 'daily', lastReset }
        : undefined,
    prayerName: category === 'prayer' ? form.prayerName : undefined,
    goalTag: category === 'goal' && form.goalTag ? form.goalTag : undefined,
    emoji: category === 'daily' && form.habitEmoji ? form.habitEmoji : undefined,
    projectId,
    workflowState: onProjectBoard ? (editing?.workflowState || 'backlog') : undefined,
    blockedReason: onProjectBoard ? editing?.blockedReason : undefined,
    boardOrder,
  };
}
