import { PRAYER_REMINDERS } from '../config/constants';
import type {
  PrayerDeadlineBounds,
  PrayerName,
  PrayerTrackingState,
} from '../types/domain';
import { getPrayerReminderKey as getBrowserReminderKey } from './browserPrayerReminder';
import { formatPrayerInstantTime, shiftPrayerDate } from './prayerTimeZone';
import {
  CANONICAL_PRAYER_NAMES,
  getPrayerDeadlineBounds,
  getPrayerOutcome,
  getPrayerReminderKey as getTrackingReminderKey,
} from './prayerTracking';
import type { PrayerTimesData } from './prayerTimes';

export interface PrayerReminderGroup {
  prayerDate: string;
  prayerNames: PrayerName[];
  deadlineName: PrayerDeadlineBounds['deadlineName'];
  deadlineAt: Date;
  fireAt: Date;
  minutesRemaining: number;
  canSnooze: boolean;
  timezone: string;
}

export interface ScheduledPrayerReminderGroup {
  groupKey: string;
  signature: string;
  prayerDate: string;
  prayerNames: PrayerName[];
  leader: PrayerName;
  deadlineIso: string;
  fireAtIso: string;
  reminderKey: string;
  title: string;
  body: string;
}

export function buildPrayerReminderGroups(input: {
  schedules: readonly PrayerTimesData[];
  tracking: PrayerTrackingState;
  today: string;
  now: Date;
  reminderMinutes: number;
}): PrayerReminderGroup[] {
  const scheduleByDate = new Map(input.schedules.map(schedule => [schedule.date, schedule]));
  const previousDate = shiftPrayerDate(input.today, -1);
  const candidates = previousDate ? [previousDate, input.today] : [input.today];
  const reminders: PrayerReminderGroup[] = [];

  for (const prayerDate of candidates) {
    const schedule = scheduleByDate.get(prayerDate);
    if (!schedule) continue;
    const scheduleEntries = schedule.prayers.map(({ name, time }) => ({ name, time }));
    for (const prayerName of CANONICAL_PRAYER_NAMES) {
      if (getPrayerOutcome(input.tracking, prayerDate, prayerName)) continue;
      const bounds = getPrayerDeadlineBounds(
        scheduleEntries,
        prayerDate,
        prayerName,
        schedule.timezone,
      );
      if (!bounds || input.now >= bounds.deadlineAt) continue;
      const fireAt = new Date(bounds.deadlineAt.getTime() - input.reminderMinutes * 60_000);
      const minutesRemaining = Math.max(
        0,
        (bounds.deadlineAt.getTime() - input.now.getTime()) / 60_000,
      );
      reminders.push({
        prayerDate,
        prayerNames: [prayerName],
        deadlineName: bounds.deadlineName,
        deadlineAt: bounds.deadlineAt,
        fireAt,
        minutesRemaining,
        canSnooze: minutesRemaining > PRAYER_REMINDERS.SNOOZE_CUTOFF_MINUTES,
        timezone: schedule.timezone,
      });
    }
  }
  return reminders.sort((left, right) => left.deadlineAt.getTime() - right.deadlineAt.getTime());
}

export function buildScheduledPrayerReminderGroup(
  group: PrayerReminderGroup,
  tracking: PrayerTrackingState,
): ScheduledPrayerReminderGroup | null {
  const prayerNames = group.prayerNames.filter(prayerName => {
    const receiptKey = getTrackingReminderKey(group.prayerDate, prayerName, group.deadlineAt);
    return !tracking.reminderReceipts[receiptKey];
  });
  if (prayerNames.length === 0) return null;

  const leader = prayerNames[0];
  const deadlineIso = group.deadlineAt.toISOString();
  const fireAtIso = group.fireAt.toISOString();
  const groupKey = `${group.prayerDate}:${leader}:${group.deadlineAt.getTime()}`;
  const reminderKey = getBrowserReminderKey({
    prayerDate: group.prayerDate,
    prayerName: leader,
    deadlineIso,
  });
  const names = prayerNames.join(' and ');
  const title = `${names} prayer due soon`;
  const body = `Pray ${names} before ${group.deadlineName} at ${formatPrayerInstantTime(
    group.deadlineAt,
    group.timezone,
  )}.`;

  return {
    groupKey,
    signature: [leader, prayerNames.join(','), deadlineIso, fireAtIso, title, body].join('|'),
    prayerDate: group.prayerDate,
    prayerNames,
    leader,
    deadlineIso,
    fireAtIso,
    reminderKey,
    title,
    body,
  };
}

export function selectActivePrayerReminder(
  groups: readonly PrayerReminderGroup[],
  tracking: PrayerTrackingState,
  now: Date,
): PrayerReminderGroup | null {
  const active = groups.find(group => {
    if (now < group.fireAt || now >= group.deadlineAt) return false;
    return group.prayerNames.some(prayerName => {
      const receiptKey = getTrackingReminderKey(group.prayerDate, prayerName, group.deadlineAt);
      const snoozedUntil = tracking.reminderReceipts[receiptKey]?.snoozedUntil;
      return !snoozedUntil || now >= new Date(snoozedUntil);
    });
  });
  if (!active) return null;
  const alreadySnoozed = active.prayerNames.some(prayerName => {
    const receiptKey = getTrackingReminderKey(active.prayerDate, prayerName, active.deadlineAt);
    return Boolean(tracking.reminderReceipts[receiptKey]?.snoozedUntil);
  });
  return { ...active, canSnooze: active.canSnooze && !alreadySnoozed };
}
