import { useEffect, useMemo, useRef } from 'react';
import type { DailyMomentumState } from '../../../types/domain';
import { PRAYER_REMINDERS } from '../../../config/constants';
import type { ServiceMomentumReminderPillar } from '../../../services/backend/contracts';
import { saveMomentumReminders } from '../../../services/backend/prayerServiceApi';
import {
  buildMomentumReminderPillars,
  sameMomentumReminderPillars,
} from '../../../services/prayerServiceReminders';
import type { PrayerReminderReporter } from './usePrayerReminderDiagnostics';

export interface PrayerMomentumReminderSyncInput {
  /** Daily Momentum as the planner service holds it, or null until it has loaded (or when it failed to). */
  momentum: DailyMomentumState | null;
  /** The preferences the prayer service holds, or null until they have loaded. */
  saved: ServiceMomentumReminderPillar[] | null;
  reporter: PrayerReminderReporter;
}

/**
 * Tells the prayer service what it plans Learn/Move reminders from: each pillar's reminder preference and the
 * latest date its Level 1 was complete. Sent (debounced) whenever Daily Momentum or its reminder preferences
 * change, and only when that differs from what the service holds.
 */
export function usePrayerMomentumReminderSync({ momentum, saved, reporter }: PrayerMomentumReminderSyncInput): void {
  const desired = useMemo(() => (momentum ? buildMomentumReminderPillars(momentum) : null), [momentum]);
  const confirmedRef = useRef<ServiceMomentumReminderPillar[] | null>(null);

  useEffect(() => {
    if (saved) confirmedRef.current = saved;
  }, [saved]);

  useEffect(() => {
    if (!desired || !saved) return undefined;
    const confirmed = confirmedRef.current ?? saved;
    if (sameMomentumReminderPillars(desired, confirmed)) return undefined;
    const timer = window.setTimeout(() => {
      void saveMomentumReminders(desired)
        .then(pillars => { confirmedRef.current = pillars; })
        .catch(error => reporter.fail('MomentumReminders', error));
    }, PRAYER_REMINDERS.MOMENTUM_SYNC_DEBOUNCE_MS);
    return () => window.clearTimeout(timer);
  }, [desired, reporter, saved]);
}
