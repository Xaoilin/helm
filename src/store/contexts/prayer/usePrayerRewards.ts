import { useCallback, useEffect, useRef } from 'react';
import type { PrayerName } from '../../../types/domain';
import type { PlannerReward } from '../../../services/backend/plannerContracts';
import { isPlannerServiceEnabled, syncPrayerRewards } from '../../../services/backend/plannerServiceApi';
import { getPrayerRecordKey } from '../../../services/prayerTracking';
import { logWarn } from '../../../services/logger';
import type { GamificationContextValue } from '../GamificationContext';
import type { TaskContextValue } from '../TaskContext';

/** A celebration waits this long for its reward, then goes ahead without XP. */
const REWARD_WAIT_MS = 20_000;

export interface PrayerRewards {
  /** Resolves with what a just-recorded prayer earned once the planner rewarded it; null for nothing. */
  awaitReward: (prayerDate: string, prayerName: PrayerName) => Promise<PlannerReward | null>;
  /** The prayer service confirmed a change to this outcome (`date::prayer`): the planner catches up. */
  onOutcomeConfirmed: (key: string) => void;
  /** The prayer service refused a change to this outcome: nothing is rewarded for it. */
  onOutcomeRefused: (key: string) => void;
}

interface Waiter {
  resolve: (reward: PlannerReward | null) => void;
  timer: ReturnType<typeof setTimeout>;
}

/**
 * Prayer XP comes from the planner service, once the prayer service has recorded the prayer: after every
 * confirmed outcome change the planner brings rewards in line (granting a new prayer's XP once, taking back
 * an undone one's) and answers with the profile and, for today's prayer, its habit. A completion waiting
 * to celebrate gets that prayer's reward.
 */
export function usePrayerRewards(
  taskOwner: Pick<TaskContextValue, 'applyTask'>,
  gamificationOwner: Pick<GamificationContextValue, 'applyProfile'>,
): PrayerRewards {
  const waitersRef = useRef(new Map<string, Waiter[]>());
  const { applyTask } = taskOwner;
  const { applyProfile } = gamificationOwner;

  const settle = useCallback((key: string, reward: PlannerReward | null) => {
    const waiters = waitersRef.current.get(key) ?? [];
    waitersRef.current.delete(key);
    for (const waiter of waiters) {
      clearTimeout(waiter.timer);
      waiter.resolve(reward);
    }
  }, []);

  useEffect(() => () => {
    for (const key of [...waitersRef.current.keys()]) settle(key, null);
  }, [settle]);

  const awaitReward = useCallback((prayerDate: string, prayerName: PrayerName) => {
    const key = getPrayerRecordKey(prayerDate, prayerName);
    return new Promise<PlannerReward | null>(resolve => {
      const timer = setTimeout(() => settle(key, null), REWARD_WAIT_MS);
      waitersRef.current.set(key, [...(waitersRef.current.get(key) ?? []), { resolve, timer }]);
    });
  }, [settle]);

  const onOutcomeConfirmed = useCallback((key: string) => {
    if (!isPlannerServiceEnabled()) {
      settle(key, null);
      return;
    }
    const [date, prayer] = key.split('::') as [string, PrayerName];
    syncPrayerRewards(date, prayer).then(sync => {
      applyProfile(sync.profile);
      if (sync.task) applyTask(sync.task);
      settle(key, sync.reward);
    }, error => {
      logWarn('Prayer', `Prayer rewards could not be brought up to date: ${error instanceof Error ? error.message : String(error)}`);
      settle(key, null);
    });
  }, [applyProfile, applyTask, settle]);

  const onOutcomeRefused = useCallback((key: string) => settle(key, null), [settle]);

  return { awaitReward, onOutcomeConfirmed, onOutcomeRefused };
}
