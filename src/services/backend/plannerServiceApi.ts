/**
 * Typed calls to the planner service (`/api/planner/v1`), the system of record for tasks, habits and goals,
 * XP and streaks, daily momentum and the clock. Record IDs are chosen here, so a retried create never makes
 * a second record; every write names one record and carries an Idempotency-Key. Completion, rewards and the
 * daily reset are worked out by the service; the app only shows them.
 */
import type { z } from 'zod';
import { PLANNER_BACKEND_URL } from '../../config';
import type {
  ClockState,
  ClockStopwatchState,
  ClockTimerState,
  DailyPillar,
  GamificationProfile,
  PrayerName,
  Task,
} from '../../types/domain';
import { newWriteKey } from './idempotencyKeys';
import {
  clockSchema,
  completionSchema,
  daySchema,
  gamificationSchema,
  momentumPillarSchema,
  momentumSchema,
  prayerRewardSyncSchema,
  taskSchema,
  tasksSchema,
  type PlannerCompletion,
  type PlannerDay,
  type PlannerMomentumPillar,
  type PlannerPrayerRewardSync,
} from './plannerContracts';
import { callService } from './serviceClient';

const BASE = '/api/planner/v1';

export function isPlannerServiceEnabled(): boolean {
  return Boolean(PLANNER_BACKEND_URL.trim());
}

function path(...segments: string[]): string {
  return `${BASE}/${segments.map(segment => encodeURIComponent(segment)).join('/')}`;
}

function write<T>(method: 'POST' | 'PUT' | 'DELETE', to: string, schema: z.ZodType<T> | null,
  body?: unknown): Promise<T> {
  return callService<T>(PLANNER_BACKEND_URL, method, to, schema, body, { idempotencyKey: newWriteKey() });
}

/** Optional values the app keeps as `undefined` are sent as JSON null (absent). */
function withoutUndefined<T extends object>(value: T): T {
  return JSON.parse(JSON.stringify(value)) as T;
}

// ── Tasks ──

/** A task's details: completion and the reset day belong to the service. */
export type TaskDetails = Pick<Task, 'title' | 'description' | 'priority' | 'category' | 'dueDate' | 'prayerName'
  | 'goalTag' | 'emoji' | 'projectId' | 'workflowState' | 'blockedReason' | 'boardOrder'>
  & { recurring?: { frequency: NonNullable<Task['recurring']>['frequency'] } };

export function taskDetails(task: Omit<Task, 'id' | 'createdAt' | 'updatedAt'>): TaskDetails {
  return withoutUndefined({
    title: task.title,
    description: task.description,
    priority: task.priority,
    category: task.category,
    dueDate: task.dueDate,
    recurring: task.recurring ? { frequency: task.recurring.frequency } : undefined,
    prayerName: task.prayerName,
    goalTag: task.goalTag,
    emoji: task.emoji,
    projectId: task.projectId,
    workflowState: task.workflowState,
    blockedReason: task.blockedReason,
    boardOrder: task.boardOrder,
  });
}

export async function getTasks(): Promise<Task[]> {
  return (await callService(PLANNER_BACKEND_URL, 'GET', `${BASE}/tasks`, tasksSchema)).tasks;
}

export function saveTask(id: string, details: TaskDetails): Promise<Task> {
  return write('PUT', path('tasks', id), taskSchema, details);
}

/** Completes the task: the service stamps it in `timeZone` and says what it earned. */
export function completeTask(id: string, timeZone: string): Promise<PlannerCompletion> {
  return write('POST', `${path('tasks', id)}/complete`, completionSchema, { timeZone });
}

/** Reopens a one-off task or goal; a habit stays done until the next day. */
export function reopenTask(id: string): Promise<Task> {
  return write('POST', `${path('tasks', id)}/reopen`, taskSchema);
}

export function deleteTask(id: string): Promise<void> {
  return write('DELETE', path('tasks', id), null);
}

/** Takes a removed project's tasks off its board; returns every task. */
export async function unlinkProjectTasks(projectId: string): Promise<Task[]> {
  return (await write('POST', `${BASE}/tasks/unlink-project`, tasksSchema, { projectId })).tasks;
}

/**
 * Starts the day on the service: it remembers the zones, reopens completed habits once per new day, ends a
 * missed streak and rewards recorded prayers. `prayerTimeZone` is null while the timetable zone is unknown.
 */
export function rolloverDay(appTimeZone: string, prayerTimeZone: string | null): Promise<PlannerDay> {
  return write('POST', `${BASE}/day/rollover`, daySchema, { appTimeZone, prayerTimeZone });
}

// ── Progress ──

export function getGamification(): Promise<GamificationProfile> {
  return callService(PLANNER_BACKEND_URL, 'GET', `${BASE}/gamification`, gamificationSchema);
}

/** Starts progress again from nothing; recorded prayers are never rewarded again. */
export function resetGamification(): Promise<GamificationProfile> {
  return write('POST', `${BASE}/gamification/reset?confirm=true`, gamificationSchema);
}

/**
 * Brings prayer XP in line with the prayer service after a prayer was recorded, corrected or undone, and
 * reports what that prayer earned.
 */
export function syncPrayerRewards(date?: string, prayer?: PrayerName): Promise<PlannerPrayerRewardSync> {
  return write('POST', `${BASE}/rewards/prayers/sync`, prayerRewardSyncSchema, withoutUndefined({ date, prayer }));
}

// ── Daily momentum ──

export async function getMomentum(): Promise<PlannerMomentumPillar[]> {
  return (await callService(PLANNER_BACKEND_URL, 'GET', `${BASE}/momentum`, momentumSchema)).pillars;
}

/** Saves a pillar's whole state; `expectedVersion` (null for a first save) refuses an out-of-date copy. */
export function saveMomentumPillar(pillar: DailyPillar, state: object, expectedVersion: number | null):
Promise<PlannerMomentumPillar> {
  return write('PUT', path('momentum', pillar), momentumPillarSchema, { state, expectedVersion });
}

// ── Clock ──

export function getClock(): Promise<ClockState> {
  return callService(PLANNER_BACKEND_URL, 'GET', `${BASE}/clock`, clockSchema);
}

export function saveStopwatch(stopwatch: ClockStopwatchState): Promise<ClockState> {
  const { id, ...rest } = stopwatch;
  return write('PUT', path('clock', 'stopwatches', id), clockSchema, rest);
}

export function deleteStopwatch(id: string): Promise<ClockState> {
  return write('DELETE', path('clock', 'stopwatches', id), clockSchema);
}

export function saveTimer(timer: ClockTimerState): Promise<ClockState> {
  const { id, ...rest } = timer;
  return write('PUT', path('clock', 'timers', id), clockSchema, withoutUndefined({ ...rest, completedAt: rest.completedAt ?? null }));
}

export function deleteTimer(id: string): Promise<ClockState> {
  return write('DELETE', path('clock', 'timers', id), clockSchema);
}
