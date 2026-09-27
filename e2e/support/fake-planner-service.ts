/**
 * A stateful stand-in for the planner service (tasks, habits and goals; XP and streaks; daily momentum; the
 * clock). It keeps records in the service's JSON shapes and answers through the app's contract schemas, so
 * it cannot drift from contracts/planner-service. Like the real service it owns completion, rewards and the
 * daily reset (with simplified XP: a base by priority plus the habit and goal bonuses); the shared write path
 * in fake-services.ts applies the Idempotency-Key rules.
 */
import type { Route } from '@playwright/test';
import type { z } from 'zod';
import type { ClockState, GamificationProfile, Task } from '../../src/types/domain';
import { apiErrorSchema, type ServiceOutcome } from '../../src/services/backend/contracts';
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
} from '../../src/services/backend/plannerContracts';

type Json = Record<string, unknown>;

export interface FakePlannerSeed {
  tasks?: Partial<Task>[];
  gamification?: Partial<GamificationProfile>;
  clock?: Partial<ClockState>;
}

export interface FakePlanner {
  tasks: Json[];
  profile: Json;
  /** `day|taskId` for every habit rewarded that day. */
  dailyLog: Set<string>;
  /** Prayer rewards granted, by `date::prayer`, with what each earned. */
  prayerRewards: Map<string, { xpEarned: number; taskId: string | null; completedTask: boolean }>;
  momentum: Map<string, { state: Json; version: number; updatedAt: string }>;
  clock: { stopwatches: Json[]; timers: Json[]; nextStopwatchNumber: number; nextTimerNumber: number };
  zones: { app: string; prayer: string | null };
}

const SEEDED_AT = '2026-08-01T12:00:00.000Z';
const BASE_XP: Record<string, number> = { low: 5, medium: 10, high: 20 };
const HABITS = new Set(['daily', 'prayer']);
const TASK_FIELDS = ['completedAt', 'completedLocalDate', 'completionTimeZone', 'dueDate', 'recurring', 'prayerName',
  'goalTag', 'emoji', 'projectId', 'workflowState', 'blockedReason', 'boardOrder'];

function withNulls(record: Json, fields: string[]): Json {
  return { ...Object.fromEntries(fields.map(field => [field, null])),
    ...Object.fromEntries(Object.entries(record).filter(([, value]) => value !== undefined)) };
}

function serviceTask(value: Partial<Task>): Json {
  const prayer = value.prayerName ?? null;
  const category = prayer ? 'prayer' : value.category ?? 'task';
  const recurring = HABITS.has(category)
    ? { frequency: value.recurring?.frequency ?? 'daily', lastReset: value.recurring?.lastReset ?? null }
    : null;
  return withNulls({
    description: '', priority: 'medium', createdAt: SEEDED_AT, updatedAt: SEEDED_AT,
    ...value,
    title: prayer ? `${prayer} Prayer` : value.title ?? 'Task',
    category,
    completed: Boolean(value.completed && value.completedAt),
    recurring,
    prayerName: prayer,
    completedLocalDate: value.completed && value.completedAt ? value.completedLocalDate ?? value.completedAt.slice(0, 10) : null,
    completionTimeZone: value.completed && value.completedAt ? value.completionTimeZone ?? 'UTC' : null,
  } as Json, TASK_FIELDS);
}

function levelOf(totalXp: number): number {
  return Math.max(1, Math.floor(Math.sqrt(totalXp / 25)));
}

function titleOf(level: number): string {
  if (level >= 20) return 'Legend';
  if (level >= 15) return 'Relentless';
  if (level >= 10) return 'Consistent';
  if (level >= 5) return 'Focused';
  return 'Beginner';
}

function profileOf(value: Partial<GamificationProfile> = {}): Json {
  const totalXp = value.totalXp ?? 0;
  return {
    totalXp,
    level: levelOf(totalXp),
    title: titleOf(levelOf(totalXp)),
    currentStreak: value.currentStreak ?? 0,
    longestStreak: Math.max(value.longestStreak ?? 0, value.currentStreak ?? 0),
    lastCompletionDate: value.lastCompletionDate ?? null,
    totalTasksCompleted: value.totalTasksCompleted ?? 0,
    badges: value.badges ?? [],
    habitTallies: value.habitTallies ?? {},
  };
}

export function createFakePlanner(seed: FakePlannerSeed = {}): FakePlanner {
  const clock = seed.clock ?? {};
  return {
    tasks: (seed.tasks ?? []).map(serviceTask),
    profile: profileOf(seed.gamification),
    dailyLog: new Set(),
    prayerRewards: new Map(),
    momentum: new Map(),
    clock: {
      stopwatches: (clock.stopwatches ?? []) as unknown as Json[],
      timers: ((clock.timers ?? []) as unknown as Json[]).map(timer => withNulls(timer, ['completedAt'])),
      nextStopwatchNumber: clock.nextStopwatchNumber ?? 1,
      nextTimerNumber: clock.nextTimerNumber ?? 1,
    },
    zones: { app: 'UTC', prayer: null },
  };
}

function dateIn(instant: Date, timeZone: string): string {
  return new Intl.DateTimeFormat('en-CA', { timeZone, year: 'numeric', month: '2-digit', day: '2-digit' }).format(instant);
}

async function reply(route: Route, status: number, body: unknown, schema?: z.ZodType): Promise<void> {
  if (schema) schema.parse(body);
  await route.fulfill({ status, contentType: 'application/json', body: JSON.stringify(body) });
}

function refuse(route: Route, status: number, code: string, message: string): Promise<void> {
  return reply(route, status, { code, message }, apiErrorSchema);
}

/** XP for one completion, the profile updated for it, and what it earned. */
function reward(planner: FakePlanner, task: Json, day: string): Json {
  const xpEarned = (BASE_XP[String(task.priority)] ?? 10) + (HABITS.has(String(task.category)) ? 5 : 0)
    + (task.category === 'goal' ? 50 : 0);
  const profile = planner.profile;
  const before = Number(profile.level);
  const last = profile.lastCompletionDate as string | null;
  const yesterday = new Date(`${day}T12:00:00Z`);
  yesterday.setUTCDate(yesterday.getUTCDate() - 1);
  const streak = last === day ? Number(profile.currentStreak)
    : last === yesterday.toISOString().slice(0, 10) ? Number(profile.currentStreak) + 1 : 1;
  const totalXp = Number(profile.totalXp) + xpEarned;
  planner.profile = {
    ...profile,
    totalXp,
    level: levelOf(totalXp),
    title: titleOf(levelOf(totalXp)),
    currentStreak: streak,
    longestStreak: Math.max(Number(profile.longestStreak), streak),
    lastCompletionDate: day,
    totalTasksCompleted: Number(profile.totalTasksCompleted) + 1,
  };
  return {
    xpEarned, level: levelOf(totalXp), leveledUp: levelOf(totalXp) > before, title: titleOf(levelOf(totalXp)),
    newBadges: [], currentStreak: streak, streakMilestone: false,
  };
}

function rollover(planner: FakePlanner, now: Date): void {
  const appDate = dateIn(now, planner.zones.app);
  const prayerDate = planner.zones.prayer ? dateIn(now, planner.zones.prayer) : null;
  for (const task of planner.tasks) {
    const recurring = task.recurring as Json | null;
    const date = task.category === 'prayer' ? prayerDate : appDate;
    if (!recurring || !task.completed || !date) continue;
    if (recurring.lastReset && String(recurring.lastReset) >= date) continue;
    Object.assign(task, { completed: false, completedAt: null, completedLocalDate: null, completionTimeZone: null,
      recurring: { ...recurring, lastReset: date }, updatedAt: now.toISOString() });
  }
}

/** Brings prayer rewards in line with the prayer service's recorded outcomes, as the real service does. */
function syncPrayers(planner: FakePlanner, outcomes: Map<string, ServiceOutcome>, now: Date): Map<string, Json> {
  const changed = new Map<string, Json>();
  const today = dateIn(now, planner.zones.prayer ?? planner.zones.app);
  for (const [key, receipt] of [...planner.prayerRewards]) {
    if ([...outcomes.values()].some(outcome => `${outcome.date}::${outcome.prayer}` === key && outcome.rewarded)) continue;
    planner.prayerRewards.delete(key);
    const totalXp = Math.max(0, Number(planner.profile.totalXp) - receipt.xpEarned);
    planner.profile = { ...planner.profile, totalXp, level: levelOf(totalXp), title: titleOf(levelOf(totalXp)) };
    const task = planner.tasks.find(candidate => candidate.id === receipt.taskId);
    if (task && receipt.completedTask && task.completed) {
      Object.assign(task, { completed: false, completedAt: null, completedLocalDate: null, completionTimeZone: null });
      changed.set(key, task);
    }
  }
  for (const outcome of outcomes.values()) {
    const key = `${outcome.date}::${outcome.prayer}`;
    if (!outcome.rewarded || planner.prayerRewards.has(key)) continue;
    const task = planner.tasks.find(candidate => candidate.category === 'prayer' && candidate.prayerName === outcome.prayer);
    const earned = reward(planner, task ?? { priority: 'medium', category: 'prayer' }, today);
    const completesTask = Boolean(task && !task.completed && outcome.date === today);
    if (task && completesTask) {
      Object.assign(task, { completed: true, completedAt: outcome.recordedAt, completedLocalDate: outcome.date,
        completionTimeZone: planner.zones.prayer ?? planner.zones.app,
        recurring: { ...(task.recurring as Json), lastReset: outcome.date }, updatedAt: now.toISOString() });
      changed.set(key, task);
    }
    planner.prayerRewards.set(key, { xpEarned: Number(earned.xpEarned), taskId: task ? String(task.id) : null,
      completedTask: completesTask });
    changed.set(`${key}#reward`, earned);
  }
  return changed;
}

function day(planner: FakePlanner): Json {
  return { tasks: planner.tasks, profile: planner.profile };
}

export async function handlePlanner(
  route: Route, planner: FakePlanner, method: string, path: string, body: Json | null, now: Date,
  outcomes: Map<string, ServiceOutcome>,
): Promise<void> {
  const segments = path.replace('/api/planner/v1/', '').split('/').map(decodeURIComponent);
  const call = `${method} ${segments[0]}`;
  const task = segments[0] === 'tasks' && segments[1] ? planner.tasks.find(candidate => candidate.id === segments[1]) : undefined;
  const at = now.toISOString();

  if (method === 'GET' && path === '/api/planner/v1/tasks') return reply(route, 200, { tasks: planner.tasks }, tasksSchema);
  if (method === 'PUT' && segments[0] === 'tasks' && segments.length === 2) {
    const details = serviceTask({ ...(body as Partial<Task>), id: segments[1] });
    const saved = task
      ? Object.assign(task, { ...details, completed: task.completed, completedAt: task.completedAt,
        completedLocalDate: task.completedLocalDate, completionTimeZone: task.completionTimeZone,
        recurring: details.recurring ? { ...(details.recurring as Json), lastReset: (task.recurring as Json | null)?.lastReset ?? null } : null,
        createdAt: task.createdAt, updatedAt: at })
      : (planner.tasks.push({ ...details, completed: false, completedAt: null, completedLocalDate: null,
        completionTimeZone: null, createdAt: at, updatedAt: at }), planner.tasks.at(-1)!);
    return reply(route, 200, saved, taskSchema);
  }
  if (method === 'POST' && segments[0] === 'tasks' && segments[2] === 'complete') {
    if (!task) return refuse(route, 404, 'task_not_found', 'This task does not exist.');
    if (task.category === 'prayer') return refuse(route, 409, 'prayer_task', 'Record the prayer to complete a prayer habit.');
    if (task.completed) return refuse(route, 409, 'task_already_completed', 'This task is already done.');
    const zone = String(body?.timeZone ?? 'UTC');
    const today = dateIn(now, zone);
    const habitLog = `${today}|${task.id}`;
    const earned = HABITS.has(String(task.category)) && planner.dailyLog.has(habitLog) ? null : reward(planner, task, today);
    if (earned && HABITS.has(String(task.category))) planner.dailyLog.add(habitLog);
    Object.assign(task, { completed: true, completedAt: at, completedLocalDate: today, completionTimeZone: zone,
      ...(task.recurring ? { recurring: { ...(task.recurring as Json), lastReset: today } } : {}), updatedAt: at });
    return reply(route, 200, { task, reward: earned, profile: planner.profile }, completionSchema);
  }
  if (method === 'POST' && segments[0] === 'tasks' && segments[2] === 'reopen') {
    if (!task) return refuse(route, 404, 'task_not_found', 'This task does not exist.');
    if (HABITS.has(String(task.category)) && task.completed) {
      return refuse(route, 409, 'habit_locked', 'A habit stays done until the next day.');
    }
    Object.assign(task, { completed: false, completedAt: null, completedLocalDate: null, completionTimeZone: null, updatedAt: at });
    return reply(route, 200, task, taskSchema);
  }
  if (method === 'DELETE' && segments[0] === 'tasks' && segments.length === 2) {
    if (!task) return refuse(route, 404, 'task_not_found', 'This task does not exist.');
    planner.tasks = planner.tasks.filter(candidate => candidate !== task);
    return route.fulfill({ status: 204 });
  }
  if (method === 'POST' && path === '/api/planner/v1/tasks/unlink-project') {
    for (const candidate of planner.tasks.filter(existing => existing.projectId === body?.projectId)) {
      Object.assign(candidate, { projectId: null, workflowState: null, blockedReason: null, boardOrder: null, updatedAt: at });
    }
    return reply(route, 200, { tasks: planner.tasks }, tasksSchema);
  }
  if (method === 'POST' && path === '/api/planner/v1/day/rollover') {
    planner.zones = { app: String(body?.appTimeZone ?? 'UTC'), prayer: (body?.prayerTimeZone as string | null) ?? planner.zones.prayer };
    rollover(planner, now);
    syncPrayers(planner, outcomes, now);
    return reply(route, 200, day(planner), daySchema);
  }
  if (method === 'GET' && path === '/api/planner/v1/gamification') return reply(route, 200, planner.profile, gamificationSchema);
  if (method === 'POST' && path === '/api/planner/v1/gamification/reset') {
    planner.profile = profileOf();
    return reply(route, 200, planner.profile, gamificationSchema);
  }
  if (method === 'POST' && path === '/api/planner/v1/rewards/prayers/sync') {
    const changed = syncPrayers(planner, outcomes, now);
    const key = `${String(body?.date)}::${String(body?.prayer)}`;
    const earned = changed.get(`${key}#reward`) ?? null;
    const receipt = planner.prayerRewards.get(key);
    const rewardBody = earned ?? (receipt && receipt.xpEarned > 0
      ? { xpEarned: receipt.xpEarned, level: planner.profile.level, leveledUp: false, title: planner.profile.title,
        newBadges: [], currentStreak: planner.profile.currentStreak, streakMilestone: false }
      : null);
    return reply(route, 200, { reward: rewardBody, task: changed.get(key) ?? null, profile: planner.profile },
      prayerRewardSyncSchema);
  }
  if (method === 'GET' && path === '/api/planner/v1/momentum') {
    const pillars = [...planner.momentum].map(([pillar, saved]) => ({ pillar, ...saved }));
    return reply(route, 200, { pillars }, momentumSchema);
  }
  if (method === 'PUT' && segments[0] === 'momentum') {
    const pillar = segments[1];
    const current = planner.momentum.get(pillar);
    if ((current?.version ?? null) !== (body?.expectedVersion ?? null)) {
      return refuse(route, 409, 'momentum_changed', 'Daily momentum changed since it was shown; reload and try again.');
    }
    const saved = { state: body?.state as Json, version: current ? current.version + 1 : 0, updatedAt: at };
    planner.momentum.set(pillar, saved);
    return reply(route, 200, { pillar, ...saved }, momentumPillarSchema);
  }
  if (segments[0] === 'clock') return handleClock(route, planner, method, segments, body);
  return refuse(route, 404, 'not_found', `No fake for ${call}.`);
}

function handleClock(route: Route, planner: FakePlanner, method: string, segments: string[], body: Json | null) {
  const clock = planner.clock;
  if (method === 'GET' && segments.length === 1) return reply(route, 200, clock, clockSchema);
  const kind = segments[1] === 'stopwatches' ? 'stopwatches' : 'timers';
  const id = segments[2];
  const list = clock[kind];
  const existing = list.find(item => item.id === id);
  if (method === 'DELETE') {
    if (!existing) return refuse(route, 404, `${kind === 'stopwatches' ? 'stopwatch' : 'timer'}_not_found`, 'Not found.');
    clock[kind] = list.filter(item => item !== existing);
    return reply(route, 200, clock, clockSchema);
  }
  const record = kind === 'timers' ? withNulls({ ...body, id }, ['completedAt']) : { ...body, id };
  if (existing) {
    Object.assign(existing, record);
  } else {
    if (kind === 'stopwatches') clock.nextStopwatchNumber += 1;
    else clock.nextTimerNumber += 1;
    list.push(record);
  }
  return reply(route, 200, clock, clockSchema);
}
