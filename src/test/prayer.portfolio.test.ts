import { describe, expect, it } from 'vitest';
import {
  buildBoundedReminderPlan,
  canSnoozeBoundedReminder,
  getAttemptableBoundedReminders,
  recordBoundedReminderAttempt,
  snoozeBoundedReminder,
} from '../services/boundedReminders';
import {
  calculatePrayerOutcomeStats,
  createPrayerTrackingState,
  getPrayerCompletionStatusAt,
  getPrayerDeadlineBounds,
  getPrayerOutcome,
  isPrayerOpportunityTracked,
  setPrayerOutcome,
} from '../services/prayerTracking';
import {
  getNextPrayer,
  isAdhanTime,
  type PrayerTime,
} from '../services/prayerTimes';
import {
  getPrayerZonedDateTimeParts,
  prayerZonedDateTimeToInstant,
  validatePrayerTimeZone,
} from '../services/prayerTimeZone';
import { makeMomentumState, makePrayerScheduleDay, makePrayerScheduleEntries } from './fixtures';

const TIMEZONE = 'Europe/London';
const DATE = '2026-08-29';

const prayerTimes: PrayerTime[] = [
  { name: 'Fajr', nameArabic: 'الفجر', time: '05:00', type: 'prayer' },
  { name: 'Sunrise', nameArabic: 'الشروق', time: '06:00', type: 'event' },
  { name: 'Dhuhr', nameArabic: 'الظهر', time: '12:00', type: 'prayer' },
  { name: 'Asr', nameArabic: 'العصر', time: '15:00', type: 'prayer' },
  { name: 'Sunset', nameArabic: 'غروب', time: '19:00', type: 'event' },
  { name: 'Maghrib', nameArabic: 'المغرب', time: '19:05', type: 'prayer' },
  { name: 'Isha', nameArabic: 'العشاء', time: '21:00', type: 'prayer' },
];

describe('prayer schedule, deadline, and reminder semantics', () => {
  it('proves timezone conversion rejects nonexistent wall time and chooses the first fall-back occurrence', () => {
    expect(validatePrayerTimeZone(TIMEZONE)).toBe(TIMEZONE);
    expect(validatePrayerTimeZone('Not/AZone')).toBe('');
    expect(prayerZonedDateTimeToInstant('2026-03-29', '01:30', TIMEZONE)).toBeNull();
    expect(prayerZonedDateTimeToInstant('2026-10-25', '01:30', TIMEZONE)?.toISOString()).toBe(
      '2026-10-25T00:30:00.000Z',
    );
    expect(getPrayerZonedDateTimeParts(new Date('2026-08-29T09:00:00.000Z'), TIMEZONE)).toEqual({
      year: 2026,
      month: 8,
      day: 29,
      hour: 10,
      minute: 0,
      second: 0,
    });
  });

  it('proves prayer deadlines are explicit instants and the deadline itself is late', () => {
    const bounds = getPrayerDeadlineBounds(makePrayerScheduleEntries(), DATE, 'Isha', TIMEZONE);
    if (!bounds) throw new Error('The complete Isha schedule should produce deadline bounds.');

    expect({
      deadlineName: bounds.deadlineName,
      startsAt: bounds.startsAt.toISOString(),
      deadlineAt: bounds.deadlineAt.toISOString(),
    }).toEqual({
      deadlineName: 'Midnight',
      startsAt: '2026-08-29T20:00:00.000Z',
      deadlineAt: '2026-08-29T23:00:00.000Z',
    });
    expect(getPrayerCompletionStatusAt(bounds.deadlineAt, new Date(bounds.deadlineAt.getTime() - 1))).toBe('on_time');
    expect(getPrayerCompletionStatusAt(bounds.deadlineAt, bounds.deadlineAt)).toBe('late');
  });

  it('proves next-prayer and adhan windows are based on the supplied instant', () => {
    const next = getNextPrayer(prayerTimes, new Date('2026-08-29T09:59:00.000Z'), TIMEZONE);
    expect(next).toEqual({ prayer: prayerTimes[2], minutesUntil: 61 });

    const dhuhr = prayerZonedDateTimeToInstant(DATE, '12:00', TIMEZONE);
    if (!dhuhr) throw new Error('The Dhuhr wall time should convert.');
    expect(isAdhanTime(prayerTimes, new Date(dhuhr.getTime() + 30_000), TIMEZONE)).toEqual(prayerTimes[2]);
    expect(isAdhanTime(prayerTimes, new Date(dhuhr.getTime() + 60_000), TIMEZONE)).toBeNull();
  });

  it('proves tracking starts from explicit activation time and does not infer before a deadline', () => {
    const tracking = createPrayerTrackingState(new Date('2026-08-29T03:30:00.000Z'));
    const scheduleDay = makePrayerScheduleDay(DATE, TIMEZONE);
    const now = new Date('2026-08-29T11:00:00.000Z');

    expect(isPrayerOpportunityTracked(tracking, scheduleDay, 'Fajr', now)).toBe(true);
    expect(calculatePrayerOutcomeStats(tracking, [scheduleDay], now)).toMatchObject({
      trackedDays: 1,
      opportunities: 5,
      missed: 1,
      inferredMissed: 1,
      pending: 4,
      classifiedTotal: 1,
      percentages: { onTime: 0, late: 0, missed: 100 },
    });

    const recorded = setPrayerOutcome(tracking, {
      date: DATE,
      prayerName: 'Fajr',
      status: 'on_time',
      recordedAt: '2026-08-29T04:30:00.000Z',
      source: 'history',
    });
    expect(getPrayerOutcome(recorded, DATE, 'Fajr')).toEqual({
      date: DATE,
      prayerName: 'Fajr',
      status: 'on_time',
      recordedAt: '2026-08-29T04:30:00.000Z',
      source: 'history',
    });
  });

  it('proves bounded reminders have one attempt and one snooze with deadline plans excluded from immediate display', () => {
    const tracking = createPrayerTrackingState(new Date('2026-08-29T03:30:00.000Z'));
    const plans = buildBoundedReminderPlan({
      prayerDate: DATE,
      schedule: makePrayerScheduleEntries(),
      timeZone: TIMEZONE,
      tracking,
      momentum: makeMomentumState(),
      reminderMinutes: 15,
    });
    const fajrOpportunity = plans.find(plan => (
      plan.kind === 'prayer-opportunity' && plan.prayerNames[0] === 'Fajr'
    ));
    if (!fajrOpportunity) throw new Error('The Fajr opportunity plan should exist.');

    const justAfterFire = new Date(fajrOpportunity.fireAt.getTime() + 1_000);
    expect(plans.filter(plan => plan.kind === 'prayer-opportunity')).toHaveLength(5);
    expect(plans.filter(plan => plan.kind === 'prayer-deadline')).toHaveLength(5);
    expect(getAttemptableBoundedReminders(plans, {}, justAfterFire)).toEqual([fajrOpportunity]);

    const attempted = recordBoundedReminderAttempt(tracking, fajrOpportunity, justAfterFire, true);
    expect(getAttemptableBoundedReminders(plans, attempted.boundedReminderReceipts, justAfterFire)).toEqual([]);
    const snoozedUntil = new Date(fajrOpportunity.fireAt.getTime() + 5 * 60_000);
    expect(canSnoozeBoundedReminder(attempted, fajrOpportunity, snoozedUntil)).toBe(true);
    const snoozed = snoozeBoundedReminder(attempted, fajrOpportunity, snoozedUntil);
    expect(snoozed.boundedReminderReceipts[fajrOpportunity.receiptKeys[0]]).toMatchObject({
      snoozedUntil: snoozedUntil.toISOString(),
      snoozeCount: 1,
    });
    expect(() => snoozeBoundedReminder(snoozed, fajrOpportunity, snoozedUntil)).toThrow(
      'one snooze',
    );
  });
});
