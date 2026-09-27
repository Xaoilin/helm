/**
 * What recording, correcting or undoing a prayer changes in the app: the prayer's outcome and, for today's
 * prayer, its habit shown done. XP is not part of it: the planner service rewards a prayer once the prayer
 * service has recorded it (and takes the reward back if it is undone).
 */
import type {
  PrayerCompletionSource,
  PrayerCompletionStatus,
  PrayerCompletionUndoData,
  PrayerName,
  PrayerOutcomeStatus,
  PrayerTrackingRecord,
  PrayerTrackingState,
  Task,
} from '../types/domain';
import { toLocalDateStr } from './financeHelpers';
import { getPrayerZonedDate } from './prayerTimeZone';
import {
  getPrayerOutcome,
  getPrayerRecordKey,
  setPrayerOutcome,
} from './prayerTracking';
import { getPrayerTaskName } from './prayerTasks';

type PrayerTaskCompletion = NonNullable<PrayerCompletionUndoData['taskCompletion']>;

export interface PrayerCompletionTransition {
  trackingAfter: PrayerTrackingState;
  task?: Task;
  taskCompletion?: PrayerTaskCompletion;
  outcomeAfter: PrayerTrackingRecord;
  undo: PrayerCompletionUndoData;
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
  scheduleTimeZone: string;
}): PrayerCompletionTransition {
  const matchingTasks = getMatchingPrayerTasks(input.tasks, input.prayerName);
  const task = matchingTasks.find(candidate => candidate.id === input.taskId) || matchingTasks[0];
  const existingOutcome = getPrayerOutcome(input.tracking, input.prayerDate, input.prayerName);

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

  const outcomeAfter = getPrayerOutcome(trackingAfter, input.prayerDate, input.prayerName);
  if (!outcomeAfter) {
    throw new Error(`Prayer outcome was not recorded for ${input.prayerName} on ${input.prayerDate}.`);
  }

  return {
    trackingAfter,
    task,
    taskCompletion,
    outcomeAfter,
    undo: {
      prayerDate: input.prayerDate,
      prayerName: input.prayerName,
      ...(taskCompletion ? { taskCompletion } : {}),
      ...(existingOutcome ? { outcomeBefore: existingOutcome } : {}),
      outcomeAfter,
    },
  };
}

export function buildPrayerCorrectionTransition(input: {
  prayerDate: string;
  prayerName: PrayerName;
  status: PrayerOutcomeStatus;
  correctedAt: Date;
  tasks: readonly Task[];
  tracking: PrayerTrackingState;
}): {
  trackingAfter: PrayerTrackingState;
  targetTask?: Task;
  completed: boolean;
} {
  const targetTask = getMatchingPrayerTasks(input.tasks, input.prayerName)[0];
  const trackingAfter = setPrayerOutcome(input.tracking, {
    date: input.prayerDate,
    prayerName: input.prayerName,
    status: input.status,
    taskId: targetTask?.id,
    source: 'history',
    recordedAt: input.correctedAt,
  });
  const completed = input.status === 'on_time'
    || input.status === 'late'
    || input.status === 'unclassified';
  return { trackingAfter, targetTask, completed };
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

/** Puts the prayer's outcome back as it was before the completion; refuses if it changed since. */
export function applyPrayerCompletionUndo(
  tracking: PrayerTrackingState,
  inverse: PrayerCompletionUndoData,
): { trackingAfter: PrayerTrackingState } {
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
  return { trackingAfter: { ...tracking, records } };
}
