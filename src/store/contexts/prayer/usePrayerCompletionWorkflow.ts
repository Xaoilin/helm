import { useCallback, useEffect, useRef } from 'react';
import type {
  PrayerCompletionSource,
  PrayerCompletionStatus,
  PrayerCompletionUndoData,
  PrayerName,
  PrayerOutcomeStatus,
} from '../../../types/domain';
import type { CompletionResult } from '../../../services/gamification';
import type { PrayerTimesData } from '../../../services/prayerTimes';
import {
  applyPrayerCompletionUndo,
  buildPrayerCompletionTransition,
  buildPrayerCorrectionTransition,
} from '../../../services/prayerCompletionPolicy';
import { assertPrayerCompletable } from '../../../services/prayerCompletionRules';
import { revertRecord } from '../../../services/backend/prayerOutcomeSync';
import type { TaskContextValue } from '../TaskContext';
import type { PrayerOutcomeRejection } from '../usePrayerServiceSync';
import type { PrayerTrackingStore } from './usePrayerTracking';

export interface PrayerCompletionMutationResult {
  undo: PrayerCompletionUndoData;
  /** XP the planner granted for this prayer; 0 until it has (see `usePrayerRewards`). */
  xpEarned: number;
  status: PrayerCompletionStatus;
  prayerName: PrayerName;
  prayerDate: string;
  gamificationResult?: CompletionResult;
}

export interface CompletePrayerOptions {
  taskId?: string;
  prayerDate?: string;
  source?: PrayerCompletionSource;
}

/**
 * What a prayer completion reads and writes: prayer tracking, and today's prayer habit shown done. XP is
 * the planner service's: it rewards the prayer once the prayer service has recorded it.
 */
export interface PrayerCompletionWorkflowInput {
  taskOwner: TaskContextValue;
  /** Today's timetable, only when its zone is verified; null refuses completions of today's prayers. */
  timetable: PrayerTimesData | null;
  scheduleTimeZone: string;
  today: string;
  getToday: () => string;
  getTracking: PrayerTrackingStore['getTracking'];
  commitTracking: PrayerTrackingStore['commitTracking'];
  /** Cancels the pending deadline reminder for a prayer that has just been settled. */
  cancelReminderForPrayer: (prayerDate: string, prayerName: PrayerName) => void;
}

export interface PrayerCompletionWorkflow {
  completePrayer: (
    prayerName: PrayerName,
    status: PrayerCompletionStatus,
    options?: CompletePrayerOptions,
  ) => PrayerCompletionMutationResult;
  correctPrayerOutcome: (prayerDate: string, prayerName: PrayerName, status: PrayerOutcomeStatus) => void;
  undoPrayerCompletion: (inverse: PrayerCompletionUndoData) => void;
  /** Shows the service's version of an outcome it refused. */
  revertRefusedOutcome: (rejection: PrayerOutcomeRejection) => void;
}

/**
 * The prayer completion transaction on the app's side: each command builds one transition with the pure
 * completion policy, commits tracking (which the prayer service then receives) and shows today's prayer
 * habit done or not. The planner service confirms the habit and grants the XP afterwards.
 */
export function usePrayerCompletionWorkflow({
  taskOwner,
  timetable,
  scheduleTimeZone,
  today,
  getToday,
  getTracking,
  commitTracking,
  cancelReminderForPrayer,
}: PrayerCompletionWorkflowInput): PrayerCompletionWorkflow {
  const taskOwnerRef = useRef(taskOwner);

  useEffect(() => {
    taskOwnerRef.current = taskOwner;
  }, [taskOwner]);

  const completePrayer = useCallback((
    prayerName: PrayerName,
    status: PrayerCompletionStatus,
    options: CompletePrayerOptions = {},
  ): PrayerCompletionMutationResult => {
    const completedAt = new Date();
    const prayerDate = options.prayerDate || today;
    const source = options.source || 'system';
    assertPrayerCompletable({ prayerName, prayerDate, today, timetable, now: completedAt });
    const transition = buildPrayerCompletionTransition({
      prayerName,
      status,
      prayerDate,
      source,
      completedAt,
      taskId: options.taskId,
      tasks: taskOwner.tasks,
      tracking: getTracking(),
      scheduleTimeZone,
    });

    commitTracking(transition.trackingAfter);
    if (transition.taskCompletion && transition.task) {
      taskOwner.showPrayerHabit(transition.task.id, true);
    }
    cancelReminderForPrayer(prayerDate, prayerName);
    return { undo: transition.undo, xpEarned: 0, status, prayerName, prayerDate };
  }, [cancelReminderForPrayer, commitTracking, getTracking, scheduleTimeZone, taskOwner, timetable, today]);

  const correctPrayerOutcome = useCallback((
    prayerDate: string,
    prayerName: PrayerName,
    status: PrayerOutcomeStatus,
  ) => {
    const transition = buildPrayerCorrectionTransition({
      prayerDate,
      prayerName,
      status,
      correctedAt: new Date(),
      tasks: taskOwner.tasks,
      tracking: getTracking(),
    });
    commitTracking(transition.trackingAfter);
    cancelReminderForPrayer(prayerDate, prayerName);
    if (prayerDate === today && transition.targetTask) {
      taskOwner.showPrayerHabit(transition.targetTask.id, transition.completed);
    }
  }, [cancelReminderForPrayer, commitTracking, getTracking, taskOwner, today]);

  const undoPrayerCompletion = useCallback((inverse: PrayerCompletionUndoData) => {
    const transition = applyPrayerCompletionUndo(getTracking(), inverse);
    commitTracking(transition.trackingAfter);
    if (inverse.taskCompletion) {
      taskOwner.showPrayerHabit(inverse.taskCompletion.taskId, inverse.taskCompletion.before.completed);
    }
  }, [commitTracking, getTracking, taskOwner]);

  // Reads refs only, so the service sync can hold it without it going stale.
  const revertRefusedOutcome = useCallback((rejection: PrayerOutcomeRejection) => {
    const prayerDate = rejection.record.date;
    commitTracking(current => revertRecord(current, rejection.key, rejection.confirmed));
    if (rejection.confirmed || prayerDate !== getToday()) return;
    const owner = taskOwnerRef.current;
    const task = owner.tasks.find(candidate => candidate.id === rejection.record.taskId);
    if (task?.completed) owner.showPrayerHabit(task.id, false);
  }, [commitTracking, getToday]);

  return { completePrayer, correctPrayerOutcome, undoPrayerCompletion, revertRefusedOutcome };
}
