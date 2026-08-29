import type {
  PrayerDeadlineBounds,
  PrayerName,
  PrayerOutcomeStats,
  PrayerScheduleDay,
  PrayerTrackingState,
} from '../types/domain';
import {
  CANONICAL_PRAYER_NAMES,
  calculatePrayerOutcomeStats,
  getPrayerDeadlineBounds,
  getPrayerOutcome,
  isPrayerOpportunityTracked,
  setPrayerOutcome,
} from './prayerTracking';
import {
  getPrayerZonedDate,
  shiftPrayerDate,
} from './prayerTimeZone';
import {
  getNextPrayer,
  type PrayerTimesData,
} from './prayerTimes';

export interface PrayerSchedulePolicySnapshot {
  scheduleDays: PrayerScheduleDay[];
  stats: PrayerOutcomeStats;
  deadlines: Record<PrayerName, PrayerDeadlineBounds | null>;
  nextPrayer: ReturnType<typeof getNextPrayer>;
}

export function buildPrayerScheduleDays(
  schedule: PrayerTimesData | null,
  trackingStartedAt: string,
  today: string,
): PrayerScheduleDay[] {
  if (!schedule) return [];

  const start = new Date(trackingStartedAt);
  if (!Number.isFinite(start.getTime())) return [];
  const firstDate = getPrayerZonedDate(start, schedule.timezone);
  if (!firstDate || firstDate > today) return [];

  const prayers = schedule.prayers.map(({ name, time }) => ({ name, time }));
  const days: PrayerScheduleDay[] = [];
  let cursor = firstDate;
  while (cursor <= today) {
    days.push({ date: cursor, timezone: schedule.timezone, prayers });
    const next = shiftPrayerDate(cursor, 1);
    if (!next) return [];
    cursor = next;
  }
  return days;
}

export function buildPrayerSchedulePolicySnapshot(input: {
  schedule: PrayerTimesData | null;
  tracking: PrayerTrackingState;
  today: string;
  now: Date;
}): PrayerSchedulePolicySnapshot {
  const scheduleDays = buildPrayerScheduleDays(
    input.schedule,
    input.tracking.trackingStartedAt,
    input.today,
  );
  const deadlines = Object.fromEntries(CANONICAL_PRAYER_NAMES.map(prayerName => [
    prayerName,
    input.schedule
      ? getPrayerDeadlineBounds(
        input.schedule.prayers,
        input.today,
        prayerName,
        input.schedule.timezone,
      )
      : null,
  ])) as Record<PrayerName, PrayerDeadlineBounds | null>;

  return {
    scheduleDays,
    stats: calculatePrayerOutcomeStats(input.tracking, scheduleDays, input.now),
    deadlines,
    nextPrayer: input.schedule
      ? getNextPrayer(input.schedule.prayers, input.now, input.schedule.timezone)
      : null,
  };
}

export function classifyExpiredPrayerOutcomes(input: {
  schedules: Readonly<Record<string, PrayerTimesData>>;
  tracking: PrayerTrackingState;
  today: string;
  now: Date;
}): PrayerTrackingState {
  let next = input.tracking;
  const previousDate = shiftPrayerDate(input.today, -1);
  for (const prayerDate of previousDate ? [previousDate, input.today] : [input.today]) {
    const schedule = input.schedules[prayerDate];
    if (!schedule) continue;
    const scheduleDay = {
      date: prayerDate,
      timezone: schedule.timezone,
      prayers: schedule.prayers,
    };
    for (const prayerName of CANONICAL_PRAYER_NAMES) {
      if (getPrayerOutcome(next, prayerDate, prayerName)) continue;
      const bounds = getPrayerDeadlineBounds(
        schedule.prayers,
        prayerDate,
        prayerName,
        schedule.timezone,
      );
      if (
        !bounds
        || !isPrayerOpportunityTracked(next, scheduleDay, prayerName, input.now)
        || input.now < bounds.deadlineAt
      ) continue;
      next = setPrayerOutcome(next, {
        date: prayerDate,
        prayerName,
        status: 'missed',
        recordedAt: input.now,
        source: 'system',
      });
    }
  }
  return next;
}
