import type {
  GamificationProfile,
  PrayerCompletionSource,
  PrayerCompletionStatus,
  PrayerCompletionUndoData,
  PrayerName,
  PrayerOutcomeStatus,
  PrayerTrackingRecord,
  PrayerTrackingState,
  Settings,
  Task,
} from '../types/domain';
import {
  buildCompletionContext,
  levelFromXp,
  processTaskCompletion,
  recordHabitCompletion,
  type CompletionResult,
} from './gamification';
import { toLocalDateStr } from './financeHelpers';
import { getPrayerZonedDate } from './prayerTimeZone';
import {
  getPrayerOutcome,
  getPrayerRecordKey,
  getPrayerRewardLogId,
  setPrayerOutcome,
} from './prayerTracking';
import { getPrayerTaskName } from './prayerTasks';

type PrayerTaskCompletion = NonNullable<PrayerCompletionUndoData['taskCompletion']>;

export interface PrayerKnowledgeCounts {
  knowledgeEntries: number;
  knowledgeTopics: number;
  lifestyleHaramMastered: number;
  lifestyleHalalConsistent: number;
  lifestyleTotal: number;
}

export interface PrayerCompletionTransition {
  trackingAfter: PrayerTrackingState;
  gamificationAfter: GamificationProfile;
  task?: Task;
  taskCompletion?: PrayerTaskCompletion;
  outcomeAfter: PrayerTrackingRecord;
  undo: PrayerCompletionUndoData;
  xpEarned: number;
  gamificationResult?: CompletionResult;
}

function getMatchingPrayerTasks(tasks: readonly Task[], prayerName: PrayerName): Task[] {
  return tasks.filter(task => getPrayerTaskName(task) === prayerName);
}

function dateForInstant(instant: Date, scheduleTimeZone: string): string {
  return getPrayerZonedDate(instant, scheduleTimeZone) ?? toLocalDateStr(instant);
}

export function buildPrayerCompletionTransition(input: {
  prayerName: PrayerName;
  status: PrayerCompletionStatus;
  prayerDate: string;
  source: PrayerCompletionSource;
  completedAt: Date;
  taskId?: string;
  tasks: readonly Task[];
  tracking: PrayerTrackingState;
  gamification: GamificationProfile;
  goalTags?: Settings['goalTags'];
  knowledge: PrayerKnowledgeCounts;
  scheduleTimeZone: string;
}): PrayerCompletionTransition {
  const matchingTasks = getMatchingPrayerTasks(input.tasks, input.prayerName);
  const task = matchingTasks.find(candidate => candidate.id === input.taskId) || matchingTasks[0];
  const existingOutcome = getPrayerOutcome(input.tracking, input.prayerDate, input.prayerName);
  const rewardKey = getPrayerRecordKey(input.prayerDate, input.prayerName);
  const canonicalLogId = getPrayerRewardLogId(input.prayerName);
  const relevantLogIds = new Set([
    canonicalLogId,
    ...matchingTasks.map(candidate => candidate.id),
    ...(existingOutcome?.taskId ? [existingOutcome.taskId] : []),
  ]);
  const rewardLogId = task?.id || existingOutcome?.taskId || canonicalLogId;
  const dayLog = input.gamification.dailyLog?.[input.prayerDate] || [];
  const alreadyRewarded = Boolean(
    input.gamification.prayerCompletionLedger?.[rewardKey]?.rewarded
    || dayLog.some(taskId => relevantLogIds.has(taskId)),
  );

  const trackingAfter = setPrayerOutcome(input.tracking, {
    date: input.prayerDate,
    prayerName: input.prayerName,
    status: input.status,
    rewarded: true,
    taskId: task?.id,
    source: input.source,
    recordedAt: input.completedAt,
  });
  const currentPrayerDate = dateForInstant(input.completedAt, input.scheduleTimeZone);
  const taskCompletion = task && input.prayerDate === currentPrayerDate
    ? {
        taskId: task.id,
        before: {
          completed: task.completed,
          ...(task.completedAt !== undefined ? { completedAt: task.completedAt } : {}),
          ...(task.recurring?.lastReset !== undefined
            ? { recurringLastReset: task.recurring.lastReset }
            : {}),
        },
        after: {
          completed: true,
          completedAt: input.completedAt.toISOString(),
          ...(task.recurring ? { recurringLastReset: input.prayerDate } : {}),
        },
      } satisfies PrayerTaskCompletion
    : undefined;

  const cleanedDayLog = dayLog.filter(taskId => !relevantLogIds.has(taskId));
  const baseDailyLog = { ...(input.gamification.dailyLog || {}) };
  if (cleanedDayLog.length > 0) baseDailyLog[input.prayerDate] = cleanedDayLog;
  else delete baseDailyLog[input.prayerDate];
  let gamificationAfter: GamificationProfile = {
    ...input.gamification,
    dailyLog: baseDailyLog,
  };
  let xpEarned = 0;
  let gamificationResult: CompletionResult | undefined;

  if (!alreadyRewarded) {
    const completionsToday = input.tasks.filter(candidate => (
      candidate.completed
      && candidate.completedAt
      && dateForInstant(new Date(candidate.completedAt), input.scheduleTimeZone) === currentPrayerDate
    )).length;
    const completionContext = buildCompletionContext(
      input.tasks as Task[],
      input.goalTags,
      currentPrayerDate,
      input.gamification,
      input.knowledge,
    );
    const result = processTaskCompletion(
      gamificationAfter,
      task || { priority: 'medium', category: 'prayer' },
      completionsToday,
      input.completedAt,
      completionContext,
    );
    gamificationResult = result;
    xpEarned = result.xpEarned;
    gamificationAfter = recordHabitCompletion(result.updatedProfile, rewardLogId, input.prayerDate);
  } else {
    gamificationAfter = {
      ...gamificationAfter,
      dailyLog: {
        ...(gamificationAfter.dailyLog || {}),
        [input.prayerDate]: [...cleanedDayLog, rewardLogId],
      },
    };
  }

  gamificationAfter = {
    ...gamificationAfter,
    prayerCompletionLedger: {
      ...(gamificationAfter.prayerCompletionLedger || {}),
      [rewardKey]: {
        date: input.prayerDate,
        prayerName: input.prayerName,
        status: input.status,
        recordedAt: input.completedAt.toISOString(),
        rewarded: true,
        ...(task?.id ? { taskId: task.id } : {}),
        source: input.source,
      },
    },
  };
  const outcomeAfter = getPrayerOutcome(trackingAfter, input.prayerDate, input.prayerName);
  if (!outcomeAfter) {
    throw new Error(`Prayer outcome was not recorded for ${input.prayerName} on ${input.prayerDate}.`);
  }

  return {
    trackingAfter,
    gamificationAfter,
    task,
    taskCompletion,
    outcomeAfter,
    undo: {
      prayerDate: input.prayerDate,
      prayerName: input.prayerName,
      ...(taskCompletion ? { taskCompletion } : {}),
      ...(existingOutcome ? { outcomeBefore: existingOutcome } : {}),
      outcomeAfter,
      gamificationBefore: input.gamification,
      gamificationAfter,
    },
    xpEarned,
    gamificationResult,
  };
}

export function buildPrayerCorrectionTransition(input: {
  prayerDate: string;
  prayerName: PrayerName;
  status: PrayerOutcomeStatus;
  correctedAt: Date;
  tasks: readonly Task[];
  tracking: PrayerTrackingState;
  gamification: GamificationProfile;
}): {
  trackingAfter: PrayerTrackingState;
  gamificationAfter: GamificationProfile;
  targetTask?: Task;
  completed: boolean;
} {
  const matchingTasks = getMatchingPrayerTasks(input.tasks, input.prayerName);
  const existingRecord = getPrayerOutcome(input.tracking, input.prayerDate, input.prayerName);
  const targetTask = matchingTasks[0];
  const canonicalLogId = getPrayerRewardLogId(input.prayerName);
  const targetLogId = targetTask?.id || existingRecord?.taskId || canonicalLogId;
  const relevantLogIds = new Set([
    canonicalLogId,
    ...matchingTasks.map(task => task.id),
    ...(existingRecord?.taskId ? [existingRecord.taskId] : []),
  ]);
  const trackingAfter = setPrayerOutcome(input.tracking, {
    date: input.prayerDate,
    prayerName: input.prayerName,
    status: input.status,
    taskId: targetTask?.id,
    source: 'history',
    recordedAt: input.correctedAt,
  });
  const existingLog = input.gamification.dailyLog?.[input.prayerDate] || [];
  const completed = input.status === 'on_time'
    || input.status === 'late'
    || input.status === 'unclassified';
  const cleanedLog = existingLog.filter(taskId => !relevantLogIds.has(taskId));
  const nextDayLog = completed ? [...cleanedLog, targetLogId] : cleanedLog;
  const nextDailyLog = { ...(input.gamification.dailyLog || {}) };
  if (nextDayLog.length > 0) nextDailyLog[input.prayerDate] = nextDayLog;
  else delete nextDailyLog[input.prayerDate];
  const rewardKey = getPrayerRecordKey(input.prayerDate, input.prayerName);
  const previousLedger = input.gamification.prayerCompletionLedger?.[rewardKey];

  return {
    trackingAfter,
    gamificationAfter: {
      ...input.gamification,
      dailyLog: nextDailyLog,
      prayerCompletionLedger: {
        ...(input.gamification.prayerCompletionLedger || {}),
        [rewardKey]: {
          date: input.prayerDate,
          prayerName: input.prayerName,
          status: input.status,
          recordedAt: input.correctedAt.toISOString(),
          rewarded: previousLedger?.rewarded === true || existingRecord?.rewarded === true,
          ...(targetTask?.id ? { taskId: targetTask.id } : {}),
          source: 'history',
        },
      },
    },
    targetTask,
    completed,
  };
}

function prayerRecordsEqual(
  left: PrayerTrackingRecord | undefined,
  right: PrayerTrackingRecord | undefined,
): boolean {
  if (!left || !right) return left === right;
  return left.date === right.date
    && left.prayerName === right.prayerName
    && left.status === right.status
    && left.recordedAt === right.recordedAt
    && left.rewarded === right.rewarded
    && left.taskId === right.taskId
    && left.source === right.source;
}

function reverseHabitTallyDelta(
  current: Record<string, number> | undefined,
  before: Record<string, number> | undefined,
  after: Record<string, number> | undefined,
): Record<string, number> {
  const next = { ...(current || {}) };
  const changedIds = new Set([...Object.keys(before || {}), ...Object.keys(after || {})]);
  for (const taskId of changedIds) {
    const delta = (after?.[taskId] || 0) - (before?.[taskId] || 0);
    if (delta === 0) continue;
    const value = Math.max(0, (next[taskId] || 0) - delta);
    if (value > 0) next[taskId] = value;
    else delete next[taskId];
  }
  return next;
}

function reverseDailyLogDelta(
  current: Record<string, string[]> | undefined,
  before: Record<string, string[]> | undefined,
  after: Record<string, string[]> | undefined,
): Record<string, string[]> {
  const next = Object.fromEntries(
    Object.entries(current || {}).map(([date, taskIds]) => [date, [...taskIds]]),
  );
  const changedDates = new Set([...Object.keys(before || {}), ...Object.keys(after || {})]);
  for (const date of changedDates) {
    const beforeIds = new Set(before?.[date] || []);
    const afterIds = new Set(after?.[date] || []);
    const currentIds = new Set(next[date] || []);
    for (const taskId of afterIds) if (!beforeIds.has(taskId)) currentIds.delete(taskId);
    for (const taskId of beforeIds) if (!afterIds.has(taskId)) currentIds.add(taskId);
    if (currentIds.size > 0) next[date] = [...currentIds];
    else delete next[date];
  }
  return next;
}

function reversePrayerLedgerDelta(
  current: GamificationProfile['prayerCompletionLedger'],
  before: GamificationProfile['prayerCompletionLedger'],
  after: GamificationProfile['prayerCompletionLedger'],
): NonNullable<GamificationProfile['prayerCompletionLedger']> {
  const next = { ...(current || {}) };
  const changedKeys = new Set([...Object.keys(before || {}), ...Object.keys(after || {})]);
  for (const key of changedKeys) {
    const beforeEntry = before?.[key];
    const afterEntry = after?.[key];
    if (JSON.stringify(beforeEntry) === JSON.stringify(afterEntry)) continue;
    if (JSON.stringify(next[key]) !== JSON.stringify(afterEntry)) continue;
    if (beforeEntry) next[key] = beforeEntry;
    else delete next[key];
  }
  return next;
}

function reversePrayerGamification(
  current: GamificationProfile,
  inverse: PrayerCompletionUndoData,
): GamificationProfile {
  const { gamificationBefore: before, gamificationAfter: after } = inverse;
  if (current === after || JSON.stringify(current) === JSON.stringify(after)) return before;
  const totalXp = Math.max(0, current.totalXp - (after.totalXp - before.totalXp));
  return {
    ...current,
    totalXp,
    level: levelFromXp(totalXp),
    totalTasksCompleted: Math.max(
      0,
      current.totalTasksCompleted - (after.totalTasksCompleted - before.totalTasksCompleted),
    ),
    habitTallies: reverseHabitTallyDelta(current.habitTallies, before.habitTallies, after.habitTallies),
    dailyLog: reverseDailyLogDelta(current.dailyLog, before.dailyLog, after.dailyLog),
    prayerCompletionLedger: reversePrayerLedgerDelta(
      current.prayerCompletionLedger,
      before.prayerCompletionLedger,
      after.prayerCompletionLedger,
    ),
  };
}

export function applyPrayerCompletionUndo(
  tracking: PrayerTrackingState,
  gamification: GamificationProfile,
  inverse: PrayerCompletionUndoData,
): { trackingAfter: PrayerTrackingState; gamificationAfter: GamificationProfile } {
  const key = getPrayerRecordKey(inverse.prayerDate, inverse.prayerName);
  const currentOutcome = tracking.records[key];
  if (!prayerRecordsEqual(currentOutcome, inverse.outcomeAfter)) {
    throw new Error(
      `${inverse.prayerName} on ${inverse.prayerDate} changed after completion and was not undone.`,
    );
  }
  const records = { ...tracking.records };
  if (inverse.outcomeBefore) records[key] = inverse.outcomeBefore;
  else delete records[key];
  return {
    trackingAfter: { ...tracking, records },
    gamificationAfter: reversePrayerGamification(gamification, inverse),
  };
}
