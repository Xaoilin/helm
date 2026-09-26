import { useCallback, useState } from 'react';
import type {
  PrayerCompletionSource,
  PrayerCompletionStatus,
  PrayerName,
} from '../../../types/domain';
import type { PrayerTimesData } from '../../../services/prayerTimes';
import {
  getPrayerCompletionStatusAt,
  getPrayerDeadlineBounds,
} from '../../../services/prayerTracking';
import {
  PrayerCompletionRejectedError,
  prayerCompletionRejection,
} from '../../../services/prayerCompletionRules';
import type {
  PrayerCompletionMutationResult,
  PrayerCompletionWorkflow,
} from './usePrayerCompletionWorkflow';

export interface PrayerCompletionRequest {
  prayerName: PrayerName;
  taskId?: string;
  prayerDate?: string;
  source: PrayerCompletionSource;
  suggestedStatus: PrayerCompletionStatus | null;
  onCompleted?: (result: PrayerCompletionMutationResult) => void;
}

export type PrayerCompletionRequestOptions = Omit<PrayerCompletionRequest, 'prayerName' | 'suggestedStatus'>;

export interface PrayerCompletionPromptInput {
  today: string;
  /** Today's timetable, only when its zone is verified. */
  timetable: PrayerTimesData | null;
  completePrayer: PrayerCompletionWorkflow['completePrayer'];
  /** Shows why a completion was refused, or clears the notice with null. */
  showNotice: (notice: string | null) => void;
}

export interface PrayerCompletionPrompt {
  pendingCompletion: PrayerCompletionRequest | null;
  requestPrayerCompletion: (prayerName: PrayerName, options?: PrayerCompletionRequestOptions) => void;
  cancelPrayerCompletion: () => void;
  confirmPrayerCompletion: (status: PrayerCompletionStatus) => PrayerCompletionMutationResult | null;
}

/**
 * The On time / Late completion dialog. A request the prayer-time rule refuses
 * never opens the dialog and shows why instead; an open request suggests the
 * status from the deadline and completes through the shared workflow.
 */
export function usePrayerCompletionPrompt({
  today,
  timetable,
  completePrayer,
  showNotice,
}: PrayerCompletionPromptInput): PrayerCompletionPrompt {
  const [pendingCompletion, setPendingCompletion] = useState<PrayerCompletionRequest | null>(null);

  const requestPrayerCompletion = useCallback((
    prayerName: PrayerName,
    options: PrayerCompletionRequestOptions = { source: 'system' },
  ) => {
    const prayerDate = options.prayerDate || today;
    const rejection = prayerCompletionRejection({
      prayerName,
      prayerDate,
      today,
      timetable,
      now: new Date(),
    });
    if (rejection) {
      showNotice(rejection);
      return;
    }
    showNotice(null);
    const bounds = timetable
      ? getPrayerDeadlineBounds(timetable.prayers, prayerDate, prayerName, timetable.timezone)
      : null;
    const suggestedStatus = bounds
      ? getPrayerCompletionStatusAt(bounds.deadlineAt, new Date())
      : null;
    setPendingCompletion({
      ...options,
      prayerDate,
      prayerName,
      suggestedStatus,
    });
  }, [showNotice, timetable, today]);

  const cancelPrayerCompletion = useCallback(() => {
    setPendingCompletion(null);
  }, []);

  const confirmPrayerCompletion = useCallback((status: PrayerCompletionStatus) => {
    const pending = pendingCompletion;
    if (!pending) return null;
    let result: PrayerCompletionMutationResult;
    try {
      result = completePrayer(pending.prayerName, status, {
        taskId: pending.taskId,
        prayerDate: pending.prayerDate,
        source: pending.source,
      });
    } catch (error) {
      if (!(error instanceof PrayerCompletionRejectedError)) throw error;
      setPendingCompletion(null);
      showNotice(error.message);
      return null;
    }
    setPendingCompletion(null);
    pending.onCompleted?.(result);
    return result;
  }, [completePrayer, pendingCompletion, showNotice]);

  return { pendingCompletion, requestPrayerCompletion, cancelPrayerCompletion, confirmPrayerCompletion };
}
