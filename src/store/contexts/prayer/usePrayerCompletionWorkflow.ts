import { useCallback, useEffect, useRef } from 'react';
import type {
  GamificationProfile,
  PrayerCompletionSource,
  PrayerCompletionStatus,
  PrayerCompletionUndoData,
  PrayerName,
  PrayerOutcomeStatus,
  Settings,
} from '../../../types/domain';
import type { CompletionResult } from '../../../services/gamification';
import type { PrayerTimesData } from '../../../services/prayerTimes';
import {
  applyPrayerCompletionUndo,
  buildPrayerCompletionTransition,
  buildPrayerCorrectionTransition,
  withdrawRefusedPrayerReward,
  type PrayerKnowledgeCounts,
} from '../../../services/prayerCompletionPolicy';
import { assertPrayerCompletable } from '../../../services/prayerCompletionRules';
import { revertRecord } from '../../../services/backend/prayerOutcomeSync';
import type { GamificationContextValue } from '../GamificationContext';
import type { TaskContextValue } from '../TaskContext';
import type { PrayerOutcomeRejection } from '../usePrayerServiceSync';
import type { PrayerTrackingStore } from './usePrayerTracking';

export interface PrayerCompletionMutationResult {
  undo: PrayerCompletionUndoData;
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
  /** Re-applies an already recorded outcome (reward recovery); skips the prayer-time rule. */
  recordedAlready?: boolean;
}

/**
 * What a prayer completion reads and writes. It spans prayer tracking, the
 * gamification profile and prayer tasks because one completion must move all
 * three together.
 */
export interface PrayerCompletionWorkflowInput {
  taskOwner: TaskContextValue;
  gamificationOwner: GamificationContextValue;
  knowledgeCounts: PrayerKnowledgeCounts;
  goalTags: Settings['goalTags'];
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
  /** Shows the service's version of an outcome it refused, giving back a never-confirmed reward. */
  revertRefusedOutcome: (rejection: PrayerOutcomeRejection) => void;
  /** The latest gamification profile, including writes not yet rendered. */
  getGamification: () => GamificationProfile;
}

/**
 * The cross-store prayer completion transaction. Each command builds one
 * transition with the pure completion policy, then commits tracking, the
 * gamification profile and the matching prayer task in that order. Both
 * tracking and gamification keep the canonical receipt, so hydration can repair
 * either side after an interrupted write without granting XP twice.
 */
export function usePrayerCompletionWorkflow({
  taskOwner,
  gamificationOwner,
  knowledgeCounts,
  goalTags,
  timetable,
  scheduleTimeZone,
  today,
  getToday,
  getTracking,
  commitTracking,
  cancelReminderForPrayer,
}: PrayerCompletionWorkflowInput): PrayerCompletionWorkflow {
  const gamificationRef = useRef(gamificationOwner.gamification);
  const taskOwnerRef = useRef(taskOwner);
  const { updateGamification } = gamificationOwner;

  useEffect(() => {
    gamificationRef.current = gamificationOwner.gamification;
  }, [gamificationOwner.gamification]);

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
    if (!options.recordedAlready) {
      assertPrayerCompletable({ prayerName, prayerDate, today, timetable, now: completedAt });
    }
    const transition = buildPrayerCompletionTransition({
      prayerName,
      status,
      prayerDate,
      source,
      completedAt,
      taskId: options.taskId,
      tasks: taskOwner.tasks,
      tracking: getTracking(),
      gamification: gamificationRef.current,
      goalTags,
      knowledge: knowledgeCounts,
      scheduleTimeZone,
    });

    commitTracking(transition.trackingAfter);
    gamificationRef.current = transition.gamificationAfter;
    gamificationOwner.updateGamification(transition.gamificationAfter);

    if (transition.taskCompletion && transition.task) {
      taskOwner.updateTask(transition.task.id, {
        completed: transition.taskCompletion.after.completed,
        completedAt: transition.taskCompletion.after.completedAt,
        ...(transition.task.recurring
          ? {
              recurring: {
                ...transition.task.recurring,
                lastReset: transition.taskCompletion.after.recurringLastReset,
              },
            }
          : {}),
      });
    }

    cancelReminderForPrayer(prayerDate, prayerName);
    return {
      undo: transition.undo,
      xpEarned: transition.xpEarned,
      status,
      prayerName,
      prayerDate,
      gamificationResult: transition.gamificationResult,
    };
  }, [
    cancelReminderForPrayer,
    commitTracking,
    gamificationOwner,
    getTracking,
    goalTags,
    knowledgeCounts,
    scheduleTimeZone,
    taskOwner,
    timetable,
    today,
  ]);

  const correctPrayerOutcome = useCallback((
    prayerDate: string,
    prayerName: PrayerName,
    status: PrayerOutcomeStatus,
  ) => {
    const correctedAt = new Date();
    const transition = buildPrayerCorrectionTransition({
      prayerDate,
      prayerName,
      status,
      correctedAt,
      tasks: taskOwner.tasks,
      tracking: getTracking(),
      gamification: gamificationRef.current,
    });
    commitTracking(transition.trackingAfter);
    cancelReminderForPrayer(prayerDate, prayerName);
    gamificationRef.current = transition.gamificationAfter;
    gamificationOwner.updateGamification(transition.gamificationAfter);

    if (prayerDate === today && transition.targetTask) {
      taskOwner.updateTask(transition.targetTask.id, {
        completed: transition.completed,
        completedAt: transition.completed ? correctedAt.toISOString() : undefined,
      });
    }
  }, [cancelReminderForPrayer, commitTracking, gamificationOwner, getTracking, taskOwner, today]);

  const undoPrayerCompletion = useCallback((inverse: PrayerCompletionUndoData) => {
    const transition = applyPrayerCompletionUndo(getTracking(), gamificationRef.current, inverse);
    commitTracking(transition.trackingAfter);
    gamificationRef.current = transition.gamificationAfter;
    gamificationOwner.updateGamification(transition.gamificationAfter);
  }, [commitTracking, gamificationOwner, getTracking]);

  // Reads refs only, so the service sync can hold it without it going stale.
  const revertRefusedOutcome = useCallback((rejection: PrayerOutcomeRejection) => {
    const { date: prayerDate, prayerName } = rejection.record;
    commitTracking(current => revertRecord(current, rejection.key, rejection.confirmed));
    // A refused first completion must also give back its reward, or the next load rebuilds it.
    if (rejection.confirmed) return;
    const owner = taskOwnerRef.current;
    const { gamificationAfter, taskId } = withdrawRefusedPrayerReward({
      prayerDate,
      prayerName,
      tasks: owner.tasks,
      gamification: gamificationRef.current,
    });
    if (gamificationAfter !== gamificationRef.current) {
      gamificationRef.current = gamificationAfter;
      updateGamification(gamificationAfter);
    }
    const task = taskId ? owner.tasks.find(candidate => candidate.id === taskId) : undefined;
    if (task?.completed && prayerDate === getToday()) {
      owner.updateTask(task.id, { completed: false, completedAt: undefined });
    }
  }, [commitTracking, getToday, updateGamification]);

  const getGamification = useCallback(() => gamificationRef.current, []);

  return { completePrayer, correctPrayerOutcome, undoPrayerCompletion, revertRefusedOutcome, getGamification };
}
