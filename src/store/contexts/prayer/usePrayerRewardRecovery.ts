import { useEffect, useRef } from 'react';
import type { GamificationProfile, PrayerTrackingState } from '../../../types/domain';
import { getPrayerRecordKey } from '../../../services/prayerTracking';
import type { PrayerCompletionWorkflow } from './usePrayerCompletionWorkflow';

export interface PrayerRewardRecoveryInput {
  loaded: boolean;
  records: PrayerTrackingState['records'];
  getGamification: () => GamificationProfile;
  completePrayer: PrayerCompletionWorkflow['completePrayer'];
}

/**
 * Repairs an interrupted completion: an outcome recorded as rewarded whose
 * receipt is missing from the gamification ledger is completed again (without
 * the prayer-time rule) so its XP, log and task follow. The ledger receipt makes
 * this idempotent. It re-checks whenever `completePrayer` changes, which
 * includes every task or gamification change.
 */
export function usePrayerRewardRecovery({
  loaded,
  records,
  getGamification,
  completePrayer,
}: PrayerRewardRecoveryInput): void {
  const recoveringKeysRef = useRef(new Set<string>());

  useEffect(() => {
    if (!loaded) return;
    for (const record of Object.values(records)) {
      if ((record.status !== 'on_time' && record.status !== 'late') || record.rewarded !== true) {
        continue;
      }
      const rewardKey = getPrayerRecordKey(record.date, record.prayerName);
      if (
        getGamification().prayerCompletionLedger?.[rewardKey]?.rewarded
        || recoveringKeysRef.current.has(rewardKey)
      ) {
        continue;
      }

      recoveringKeysRef.current.add(rewardKey);
      try {
        completePrayer(record.prayerName, record.status, {
          prayerDate: record.date,
          source: record.source || 'system',
          recordedAlready: true,
          ...(record.taskId ? { taskId: record.taskId } : {}),
        });
      } finally {
        recoveringKeysRef.current.delete(rewardKey);
      }
    }
  }, [completePrayer, getGamification, loaded, records]);
}
