/**
 * Showing the reminders the prayer service decides and sends. The service times every reminder (deadline,
 * prayer opportunity, Learn/Move); the app only decides whether one it was sent is still worth showing now
 * and how to word it. Nothing here plans, times or records a reminder.
 */
import { PRAYER_REMINDERS } from '../config/constants';
import type { DailyMomentumState, DailyPillar, PrayerName, PrayerTrackingState } from '../types/domain';
import type { ServiceMomentumReminderPillar, ServicePrayerReminder } from './backend/contracts';
import type { PrayerReminderData } from './backend/liveContracts';
import { getDailyMomentumPillarDay } from './dailyMomentum';
import { formatPrayerInstantTime } from './prayerTimeZone';
import { getPrayerOutcome } from './prayerTracking';

const MINUTE_MS = 60_000;
const PILLARS: readonly DailyPillar[] = ['learn', 'move'];
const PILLAR_LABELS: Record<DailyPillar, string> = { learn: 'Learn', move: 'Move' };

/** A sent reminder as the banners and notifications show it. */
export interface PrayerReminderView {
  key: string;
  kind: ServicePrayerReminder['kind'];
  date: string;
  prayerName: PrayerName;
  /** The Learn/Move pillars still incomplete (momentum reminders only). */
  pillars: DailyPillar[];
  firesAt: Date;
  expiresAt: Date;
  /** What ends the on-time window (deadline reminders only). */
  deadlineName: string | null;
  timeZone: string;
  title: string;
  body: string;
  canSnooze: boolean;
}

/** The reminders the banners show: at most one deadline and one other reminder. */
export interface ActivePrayerReminders {
  deadline: PrayerReminderView | null;
  notice: PrayerReminderView | null;
}

/** What has been done since a reminder was sent. */
export interface ReminderSettlement {
  tracking: PrayerTrackingState;
  /** Daily Momentum, or null until it has loaded. */
  momentum: DailyMomentumState | null;
}

/** The key the prayer service gives a deadline reminder. */
export function deadlineReminderKey(date: string, prayerName: PrayerName): string {
  return `deadline:${date}:${prayerName}`;
}

/** A `prayer.reminder` event in the deadline shape, as reminder JSON; `sentAt` is when the event was sent. */
export function reminderFromDeadlineEvent(data: PrayerReminderData, sentAt: string): ServicePrayerReminder {
  return {
    key: deadlineReminderKey(data.date, data.prayer),
    kind: 'deadline',
    date: data.date,
    prayer: data.prayer,
    pillars: [],
    firesAt: sentAt,
    expiresAt: data.deadlineAt,
    deadline: data.deadline,
    timeZone: data.timeZone,
    reminderMinutes: data.reminderMinutes,
    snoozedUntil: null,
    snoozeCount: 0,
  };
}

/** A reminder sent again after its snooze keeps the snooze it used, whatever shape the event had. */
export function mergeReminder(
  existing: ServicePrayerReminder | undefined,
  incoming: ServicePrayerReminder,
): ServicePrayerReminder {
  if (!existing) return incoming;
  return {
    ...incoming,
    snoozeCount: Math.max(existing.snoozeCount, incoming.snoozeCount),
    snoozedUntil: incoming.snoozedUntil ?? existing.snoozedUntil,
  };
}

function isPillarComplete(momentum: DailyMomentumState | null, date: string, pillar: DailyPillar): boolean {
  return momentum !== null && getDailyMomentumPillarDay(momentum, date, pillar).complete;
}

/** The pillars of a momentum reminder that still need their Level 1 that day. */
function openPillars(reminder: ServicePrayerReminder, momentum: DailyMomentumState | null): DailyPillar[] {
  return reminder.pillars.filter(pillar => !isPillarComplete(momentum, reminder.date, pillar));
}

/** Whether what the reminder asks for has been done: the prayer recorded, or every pillar completed. */
export function isReminderSettled(reminder: ServicePrayerReminder, settlement: ReminderSettlement): boolean {
  if (reminder.kind === 'momentum') return openPillars(reminder, settlement.momentum).length === 0;
  return Boolean(getPrayerOutcome(settlement.tracking, reminder.date, reminder.prayer));
}

/** Whether a sent reminder shows now: not expired, not snoozed, and not yet acted on. */
export function isReminderShowing(
  reminder: ServicePrayerReminder,
  now: Date,
  settlement: ReminderSettlement,
): boolean {
  const time = now.getTime();
  if (time >= Date.parse(reminder.expiresAt)) return false;
  if (reminder.snoozedUntil && time < Date.parse(reminder.snoozedUntil)) return false;
  return !isReminderSettled(reminder, settlement);
}

/** The service allows one snooze, ending before the reminder does; the button follows the same rule. */
export function canSnoozeReminder(reminder: ServicePrayerReminder, now: Date): boolean {
  const snoozeEnds = now.getTime() + PRAYER_REMINDERS.SNOOZE_MINUTES * MINUTE_MS;
  return reminder.snoozeCount < 1 && snoozeEnds < Date.parse(reminder.expiresAt);
}

function joinPillars(pillars: readonly DailyPillar[]): string {
  return pillars.map(pillar => PILLAR_LABELS[pillar]).join(' and ');
}

/** The notification and banner wording for a reminder. */
export function describeReminder(
  reminder: ServicePrayerReminder,
  pillars: readonly DailyPillar[] = reminder.pillars,
): { title: string; body: string } {
  const prayer = reminder.prayer;
  if (reminder.kind === 'deadline') {
    const deadlineClock = formatPrayerInstantTime(new Date(reminder.expiresAt), reminder.timeZone);
    return {
      title: `${prayer} prayer due soon`,
      body: `Pray ${prayer} before ${reminder.deadline ?? 'its deadline'} at ${deadlineClock}.`,
    };
  }
  if (reminder.kind === 'prayer-opportunity') {
    return { title: `${prayer} prayer opportunity`, body: `The ${prayer} prayer opportunity has begun.` };
  }
  const joined = joinPillars(pillars);
  return { title: `${joined} — Level 1`, body: `${prayer} has begun. Complete today's ${joined} Level 1.` };
}

export function toReminderView(
  reminder: ServicePrayerReminder,
  now: Date,
  momentum: DailyMomentumState | null,
): PrayerReminderView {
  const pillars = reminder.kind === 'momentum' ? openPillars(reminder, momentum) : [];
  return {
    key: reminder.key,
    kind: reminder.kind,
    date: reminder.date,
    prayerName: reminder.prayer,
    pillars,
    firesAt: new Date(reminder.firesAt),
    expiresAt: new Date(reminder.expiresAt),
    deadlineName: reminder.deadline,
    timeZone: reminder.timeZone,
    ...describeReminder(reminder, pillars),
    canSnooze: canSnoozeReminder(reminder, now),
  };
}

/** The deadline closing soonest first. */
function byNearestDeadline(left: ServicePrayerReminder, right: ServicePrayerReminder): number {
  return Date.parse(left.expiresAt) - Date.parse(right.expiresAt);
}

/** A prayer opportunity before a Learn/Move prompt, then the newest first. */
function byNoticePriority(left: ServicePrayerReminder, right: ServicePrayerReminder): number {
  return Number(right.kind === 'prayer-opportunity') - Number(left.kind === 'prayer-opportunity')
    || Date.parse(right.firesAt) - Date.parse(left.firesAt)
    || right.key.localeCompare(left.key);
}

/** The reminders the banners show now, out of every reminder the service sent. */
export function selectActiveReminders(
  reminders: readonly ServicePrayerReminder[],
  now: Date,
  settlement: ReminderSettlement,
): ActivePrayerReminders {
  const showing = reminders.filter(reminder => isReminderShowing(reminder, now, settlement));
  const deadline = showing.filter(reminder => reminder.kind === 'deadline').sort(byNearestDeadline)[0];
  const notice = showing.filter(reminder => reminder.kind !== 'deadline').sort(byNoticePriority)[0];
  return {
    deadline: deadline ? toReminderView(deadline, now, settlement.momentum) : null,
    notice: notice ? toReminderView(notice, now, settlement.momentum) : null,
  };
}

/** The latest date whose Level 1 is complete for a pillar, or null when none is. */
export function latestCompletedDate(momentum: DailyMomentumState, pillar: DailyPillar): string | null {
  const dates = [...new Set(Object.values(momentum.logs)
    .filter(log => log.pillar === pillar)
    .map(log => log.date))]
    .sort()
    .reverse();
  return dates.find(date => getDailyMomentumPillarDay(momentum, date, pillar).complete) ?? null;
}

/** The Learn/Move reminder preferences the prayer service plans momentum reminders from. */
export function buildMomentumReminderPillars(momentum: DailyMomentumState): ServiceMomentumReminderPillar[] {
  return PILLARS.map(pillar => {
    const preference = momentum.reminderPreferences[pillar];
    return {
      pillar,
      enabled: preference.enabled,
      afterPrayers: [...preference.afterPrayers],
      completedOn: latestCompletedDate(momentum, pillar),
    };
  });
}

/** Whether two sets of momentum reminder preferences say the same thing. */
export function sameMomentumReminderPillars(
  left: readonly ServiceMomentumReminderPillar[],
  right: readonly ServiceMomentumReminderPillar[],
): boolean {
  const canonical = (pillars: readonly ServiceMomentumReminderPillar[]) => JSON.stringify(
    [...pillars]
      .sort((a, b) => a.pillar.localeCompare(b.pillar))
      .map(({ pillar, enabled, afterPrayers, completedOn }) => ({ pillar, enabled, afterPrayers, completedOn })),
  );
  return canonical(left) === canonical(right);
}
