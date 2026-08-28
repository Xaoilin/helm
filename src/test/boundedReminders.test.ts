import { describe, expect, it } from 'vitest';
import {
  buildBoundedReminderPlan,
  canSnoozeBoundedReminder,
  getActiveBoundedReminder,
  getAttemptableBoundedReminders,
  isNonPrayerQuietHour,
  recordBoundedReminderAttempt,
  snoozeBoundedReminder,
} from '../services/boundedReminders';
import {
  createDefaultDailyMomentumState,
  recordDailyMomentumProgress,
} from '../services/dailyMomentum';
import { createPrayerTrackingState, setPrayerOutcome } from '../services/prayerTracking';

const DATE = '2026-08-28';
const SCHEDULE = [
  { name: 'Fajr', time: '05:00' },
  { name: 'Sunrise', time: '06:45' },
  { name: 'Dhuhr', time: '13:00' },
  { name: 'Asr', time: '16:30' },
  { name: 'Sunset', time: '20:00' },
  { name: 'Maghrib', time: '20:15' },
  { name: 'Isha', time: '21:45' },
  { name: 'Midnight', time: '00:15' },
] as const;

function plan(schedule = SCHEDULE, momentum = createDefaultDailyMomentumState()) {
  return buildBoundedReminderPlan({
    prayerDate: DATE,
    schedule,
    timeZone: 'Europe/London',
    tracking: createPrayerTrackingState(new Date(2026, 7, 28, 0, 0)),
    momentum,
    reminderMinutes: 15,
  });
}

describe('bounded reminder plan', () => {
  it('adds independent opportunity and deadline warnings for every unresolved prayer', () => {
    const reminders = plan();
    expect(reminders.filter(item => item.kind === 'prayer-opportunity')).toHaveLength(5);
    const deadlines = reminders.filter(item => item.kind === 'prayer-deadline');
    expect(deadlines).toHaveLength(5);
    expect(deadlines.every(item => item.prayerNames.length === 1)).toBe(true);
    expect(new Set(deadlines.map(item => item.prayerNames[0]))).toEqual(new Set([
      'Fajr', 'Dhuhr', 'Asr', 'Maghrib', 'Isha',
    ]));
    expect(deadlines.find(item => item.prayerNames[0] === 'Fajr')?.body).toBe('Pray Fajr before Sunrise.');
    expect(deadlines.find(item => item.prayerNames[0] === 'Dhuhr')?.body).toBe('Pray Dhuhr before Asr.');
    expect(deadlines.find(item => item.prayerNames[0] === 'Asr')?.body).toBe('Pray Asr before Maghrib.');
    expect(deadlines.find(item => item.prayerNames[0] === 'Maghrib')?.body).toBe('Pray Maghrib before Isha.');
    expect(deadlines.find(item => item.prayerNames[0] === 'Isha')?.body).toBe('Pray Isha before Midnight.');
  });

  it('uses the configured Learn/Move anchors and coalesces simultaneous prompts', () => {
    const reminders = plan();
    const momentum = reminders.filter(item => item.kind === 'momentum');
    expect(momentum).toHaveLength(4);
    expect(momentum.find(item => item.prayerNames[0] === 'Dhuhr')?.pillars).toEqual(['learn']);
    expect(momentum.find(item => item.prayerNames[0] === 'Asr')?.pillars).toEqual(['move']);
    expect(momentum.find(item => item.prayerNames[0] === 'Maghrib')?.pillars).toEqual(['learn', 'move']);
    expect(momentum.find(item => item.prayerNames[0] === 'Isha')?.pillars).toEqual(['learn', 'move']);
  });

  it('suppresses non-prayer anchors during 22:00-08:00 without suppressing prayer reminders', () => {
    const lateSchedule = SCHEDULE.map(entry => entry.name === 'Isha'
      ? { ...entry, time: '22:30' }
      : entry);
    const reminders = plan(lateSchedule);
    expect(reminders.some(item => item.kind === 'momentum' && item.prayerNames[0] === 'Isha')).toBe(false);
    expect(reminders.some(item => item.kind === 'prayer-opportunity' && item.prayerNames[0] === 'Isha')).toBe(true);
    expect(isNonPrayerQuietHour(new Date('2026-08-28T06:59:00.000Z'), 'Europe/London')).toBe(true);
    expect(isNonPrayerQuietHour(new Date('2026-08-28T07:00:00.000Z'), 'Europe/London')).toBe(false);
    expect(isNonPrayerQuietHour(new Date('2026-08-28T20:59:00.000Z'), 'Europe/London')).toBe(false);
    expect(isNonPrayerQuietHour(new Date('2026-08-28T21:00:00.000Z'), 'Europe/London')).toBe(true);
  });

  it('keeps an active Prayer opportunity dominant over a later momentum prompt', () => {
    const reminders = plan();
    const asrPrayer = reminders.find(item => (
      item.kind === 'prayer-opportunity' && item.prayerNames[0] === 'Asr'
    ))!;
    const asrMove = reminders.find(item => item.kind === 'momentum' && item.prayerNames[0] === 'Asr')!;
    const now = new Date('2026-08-28T15:31:00.000Z');

    expect(getActiveBoundedReminder([asrPrayer, asrMove], {}, now)).toBe(asrPrayer);
  });

  it('cancels completed pillar prompts and completed prayer reminders at plan generation', () => {
    const completedMomentum = recordDailyMomentumProgress(createDefaultDailyMomentumState(), {
      date: DATE,
      pillar: 'learn',
      templateId: 'learn-reading',
      stepId: 'pages',
      amount: 2,
      updatedAt: '2026-08-28T08:00:00.000Z',
    });
    const tracking = setPrayerOutcome(createPrayerTrackingState(new Date(2026, 7, 28)), {
      date: DATE,
      prayerName: 'Dhuhr',
      status: 'on_time',
      recordedAt: new Date(2026, 7, 28, 13, 5),
    });
    const reminders = buildBoundedReminderPlan({
      prayerDate: DATE,
      schedule: SCHEDULE,
      timeZone: 'Europe/London',
      tracking,
      momentum: completedMomentum,
      reminderMinutes: 15,
    });
    expect(reminders.some(item => item.pillars.includes('learn'))).toBe(false);
    expect(reminders.some(item => item.prayerNames.includes('Dhuhr'))).toBe(false);
  });

  it('schedules summer deadline reminders from London wall time, not Berlin wall time', () => {
    const reminders = plan();
    const dhuhrDeadline = reminders.find(item => (
      item.kind === 'prayer-deadline' && item.prayerNames[0] === 'Dhuhr'
    ));

    expect(dhuhrDeadline?.expiresAt.toISOString()).toBe('2026-08-28T15:30:00.000Z');
    expect(dhuhrDeadline?.fireAt.toISOString()).toBe('2026-08-28T15:15:00.000Z');
  });

  it('persists stable attempt receipts across reconciliation and enforces one snooze', () => {
    const reminders = plan();
    const maghrib = reminders.find(item => item.kind === 'momentum' && item.prayerNames[0] === 'Maghrib')!;
    const now = new Date(2026, 7, 28, 20, 16);
    const initial = createPrayerTrackingState(new Date(2026, 7, 28));
    expect(getAttemptableBoundedReminders(reminders, initial.boundedReminderReceipts, now)).toContain(maghrib);

    const attempted = recordBoundedReminderAttempt(initial, maghrib, now, false);
    expect(getAttemptableBoundedReminders(reminders, attempted.boundedReminderReceipts, now)).not.toContain(maghrib);

    const snoozedUntil = new Date(2026, 7, 28, 20, 21);
    expect(canSnoozeBoundedReminder(attempted, maghrib, snoozedUntil)).toBe(true);
    const snoozed = snoozeBoundedReminder(attempted, maghrib, snoozedUntil);
    expect(canSnoozeBoundedReminder(snoozed, maghrib, new Date(2026, 7, 28, 20, 26))).toBe(false);
    expect(() => snoozeBoundedReminder(snoozed, maghrib, new Date(2026, 7, 28, 20, 26)))
      .toThrow('one snooze');
  });
});
