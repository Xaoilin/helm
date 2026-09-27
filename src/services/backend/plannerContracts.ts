/**
 * Runtime contracts for the Spring Boot planner service (tasks, habits and goals; XP, streaks and badges;
 * daily momentum; the clock). Responses are parsed straight into the app's domain types: an absent optional
 * value arrives as `null` and becomes `undefined`. `contracts/planner-service/*.json` holds one example per
 * response.
 */
import { z } from 'zod';
import type {
  ClockState,
  ClockStopwatchState,
  ClockTimerState,
  GamificationProfile,
  Task,
} from '../../types/domain';
import { apiErrorSchema } from './contracts';

const isoDate = z.string().regex(/^\d{4}-\d{2}-\d{2}$/u);
const instant = z.string().datetime({ offset: true });
const prayerName = z.enum(['Fajr', 'Dhuhr', 'Asr', 'Maghrib', 'Isha']);

/** A nullable value the app keeps as an optional field. */
function optional<T extends z.ZodType>(schema: T) {
  return schema.nullable().transform(value => value ?? undefined);
}

// ── Tasks ──

export const taskSchema = z.object({
  id: z.string(),
  title: z.string(),
  description: z.string(),
  completed: z.boolean(),
  completedAt: optional(instant),
  completedLocalDate: optional(isoDate),
  completionTimeZone: optional(z.string()),
  priority: z.enum(['low', 'medium', 'high']),
  category: z.enum(['daily', 'prayer', 'task', 'goal']),
  dueDate: optional(isoDate),
  recurring: optional(z.object({
    frequency: z.enum(['daily', 'weekdays', 'weekly']),
    lastReset: optional(isoDate),
  })),
  prayerName: optional(prayerName),
  goalTag: optional(z.string()),
  emoji: optional(z.string()),
  projectId: optional(z.string()),
  workflowState: optional(z.enum(['backlog', 'next_up', 'in_progress', 'blocked'])),
  blockedReason: optional(z.string()),
  boardOrder: optional(z.number().int()),
  createdAt: instant,
  updatedAt: instant,
}).transform((task): Task => task);

export const tasksSchema = z.object({ tasks: z.array(taskSchema) });

// ── Progress ──

/** XP, level, streaks and badges as the service keeps them; `title` is the level's name. */
export const gamificationSchema = z.object({
  totalXp: z.number().int(),
  level: z.number().int(),
  title: z.string(),
  currentStreak: z.number().int(),
  longestStreak: z.number().int(),
  lastCompletionDate: optional(isoDate),
  totalTasksCompleted: z.number().int(),
  badges: z.array(z.string()),
  habitTallies: z.record(z.string(), z.number().int()),
}).transform((profile): GamificationProfile => ({
  totalXp: profile.totalXp,
  level: profile.level,
  currentStreak: profile.currentStreak,
  longestStreak: profile.longestStreak,
  lastCompletionDate: profile.lastCompletionDate,
  totalTasksCompleted: profile.totalTasksCompleted,
  badges: profile.badges,
  habitTallies: profile.habitTallies,
}));

/** What one completion earned, for the celebration. */
export const rewardSchema = z.object({
  xpEarned: z.number().int(),
  level: z.number().int(),
  leveledUp: z.boolean(),
  title: z.string(),
  newBadges: z.array(z.string()),
  currentStreak: z.number().int(),
  streakMilestone: z.boolean(),
});

export const completionSchema = z.object({
  task: taskSchema,
  reward: rewardSchema.nullable(),
  profile: gamificationSchema,
});

export const daySchema = z.object({ tasks: z.array(taskSchema), profile: gamificationSchema });

export const prayerRewardSyncSchema = z.object({
  reward: rewardSchema.nullable(),
  task: taskSchema.nullable(),
  profile: gamificationSchema,
});

// ── Daily momentum ──

export const momentumPillarSchema = z.object({
  pillar: z.string(),
  state: z.record(z.string(), z.unknown()),
  version: z.number().int(),
  updatedAt: instant,
});

export const momentumSchema = z.object({ pillars: z.array(momentumPillarSchema) });

// ── Clock ──

const stopwatchSchema = z.object({
  id: z.string(),
  label: z.string(),
  accumulatedMs: z.number(),
  startedAt: z.number().nullable(),
  laps: z.array(z.number()),
}).transform((stopwatch): ClockStopwatchState => stopwatch);

const timerSchema = z.object({
  id: z.string(),
  label: z.string(),
  durationMs: z.number(),
  remainingMs: z.number(),
  endsAt: z.number().nullable(),
  status: z.enum(['idle', 'running', 'completed']),
  sound: z.enum(['chime', 'bell', 'pulse', 'dawn']),
  alerting: z.boolean(),
  completedAt: optional(instant),
}).transform((timer): ClockTimerState => timer);

export const clockSchema = z.object({
  stopwatches: z.array(stopwatchSchema),
  timers: z.array(timerSchema),
  nextStopwatchNumber: z.number().int(),
  nextTimerNumber: z.number().int(),
}).transform((clock): ClockState => clock);

export type PlannerReward = z.infer<typeof rewardSchema>;
export type PlannerCompletion = z.infer<typeof completionSchema>;
export type PlannerDay = z.infer<typeof daySchema>;
export type PlannerPrayerRewardSync = z.infer<typeof prayerRewardSyncSchema>;
export type PlannerMomentumPillar = z.infer<typeof momentumPillarSchema>;

/** Every contracts/planner-service fixture and the schema its body must satisfy. */
export const PLANNER_CONTRACT_SCHEMAS: Record<string, z.ZodType> = {
  'planner-service/tasks': tasksSchema,
  'planner-service/task-saved': taskSchema,
  'planner-service/task-invalid': apiErrorSchema,
  'planner-service/task-completed': completionSchema,
  'planner-service/task-already-completed': apiErrorSchema,
  'planner-service/habit-locked': apiErrorSchema,
  'planner-service/task-reopened': taskSchema,
  'planner-service/task-deleted': z.null(),
  'planner-service/tasks-unlinked': tasksSchema,
  'planner-service/day-rolled-over': daySchema,
  'planner-service/gamification': gamificationSchema,
  'planner-service/progress-reset': gamificationSchema,
  'planner-service/prayer-rewards-synced': prayerRewardSyncSchema,
  'planner-service/momentum': momentumSchema,
  'planner-service/momentum-saved': momentumPillarSchema,
  'planner-service/momentum-changed': apiErrorSchema,
  'planner-service/clock': clockSchema,
  'planner-service/stopwatch-saved': clockSchema,
  'planner-service/stopwatch-deleted': clockSchema,
  'planner-service/timer-saved': clockSchema,
  'planner-service/timer-deleted': clockSchema,
  'planner-service/rate-limited': apiErrorSchema,
};
