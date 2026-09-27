import { describe, expect, it } from 'vitest';
import { getPrayerDateAt } from '../services/prayerTimeZone';
import {
  assertCurrentPrayerSchedule,
  reminderSchedulesHaveValidZones,
  retainReminderSchedules,
} from '../services/prayerSchedulePolicy';
import {
  buildPrayerDiagnostics,
  describeError,
  describeReminderSuppression,
} from '../services/prayerDiagnostics';
import { makePrayerTimesData, PRAYER_TEST_DATE } from './prayerFixtures';

describe('getPrayerDateAt', () => {
  it('uses the schedule zone date, which can differ from UTC near midnight', () => {
    expect(getPrayerDateAt(new Date('2026-09-26T23:30:00Z'), 'Europe/London')).toBe('2026-09-27');
    expect(getPrayerDateAt(new Date('2026-09-26T23:30:00Z'), 'America/New_York')).toBe('2026-09-26');
  });

  it('falls back to the host date without a verified zone', () => {
    // Vitest runs with TZ=UTC.
    expect(getPrayerDateAt(new Date('2026-09-26T23:30:00Z'), '')).toBe('2026-09-26');
  });
});

describe('assertCurrentPrayerSchedule', () => {
  it('accepts a timetable for the current date in its own zone', () => {
    expect(() => assertCurrentPrayerSchedule(makePrayerTimesData(), new Date('2026-09-26T12:00:00Z'))).not.toThrow();
  });

  it('accepts today in the schedule zone even when UTC is still yesterday', () => {
    const schedule = makePrayerTimesData('2026-09-27');
    expect(() => assertCurrentPrayerSchedule(schedule, new Date('2026-09-26T23:30:00Z'))).not.toThrow();
  });

  it('refuses a stale timetable', () => {
    expect(() => assertCurrentPrayerSchedule(makePrayerTimesData('2026-09-25'), new Date('2026-09-26T12:00:00Z')))
      .toThrow('Prayer schedule is for 2026-09-25, not the current schedule date.');
  });

  it('refuses a timetable with an invalid zone', () => {
    expect(() => assertCurrentPrayerSchedule(makePrayerTimesData(PRAYER_TEST_DATE, 'Not/AZone'), new Date()))
      .toThrow('Prayer schedule timezone is invalid or missing.');
  });
});

describe('retainReminderSchedules', () => {
  it('keeps the previous day beside the new one and drops anything older', () => {
    const older = makePrayerTimesData('2026-09-24');
    const yesterday = makePrayerTimesData('2026-09-25');
    const today = makePrayerTimesData('2026-09-26');
    expect(retainReminderSchedules({ '2026-09-24': older, '2026-09-25': yesterday }, today)).toEqual({
      '2026-09-25': yesterday,
      '2026-09-26': today,
    });
  });

  it('holds only the new day when yesterday was never loaded', () => {
    const today = makePrayerTimesData('2026-09-26');
    expect(retainReminderSchedules({}, today)).toEqual({ '2026-09-26': today });
  });
});

describe('reminderSchedulesHaveValidZones', () => {
  it('needs at least one timetable', () => {
    expect(reminderSchedulesHaveValidZones([])).toBe(false);
  });

  it('fails when any held zone is invalid', () => {
    expect(reminderSchedulesHaveValidZones([makePrayerTimesData()])).toBe(true);
    expect(reminderSchedulesHaveValidZones([makePrayerTimesData(), makePrayerTimesData('2026-09-25', 'Bad/Zone')]))
      .toBe(false);
  });
});

describe('prayer diagnostics', () => {
  const ready = {
    prayerEnabled: true,
    reminderEnabled: true,
    serviceEnabled: true,
    reminderLoadError: null,
  };

  it('explains the first reason reminders cannot run', () => {
    expect(describeReminderSuppression(ready)).toBeNull();
    expect(describeReminderSuppression({ ...ready, prayerEnabled: false, reminderEnabled: false }))
      .toBe('Prayer times are disabled.');
    expect(describeReminderSuppression({ ...ready, reminderEnabled: false }))
      .toBe('Prayer reminders are disabled; Learn/Move reminders follow their own settings.');
    expect(describeReminderSuppression({ ...ready, serviceEnabled: false }))
      .toBe('The prayer service is not configured for this build.');
    expect(describeReminderSuppression({ ...ready, reminderLoadError: 'HTTP 503.' }))
      .toBe('The prayer service reminders could not be loaded: HTTP 503.');
  });

  it('prefers the reminder error over the schedule error', () => {
    const base = {
      scheduleStatus: 'ready' as const,
      schedule: makePrayerTimesData(),
      scheduleError: 'schedule failed',
      city: 'Bedford',
      country: 'United Kingdom',
      scheduleTimezone: 'Europe/London',
      scheduleTimezoneValid: true,
      localTimezone: 'UTC',
      timezoneMatches: false,
      activeReminders: [],
      suppressionReason: null,
      permissionState: 'granted' as const,
      lastNotificationKey: null,
      lastReminderError: null,
    };
    expect(buildPrayerDiagnostics(base)).toMatchObject({
      location: 'Bedford, United Kingdom',
      scheduleDate: PRAYER_TEST_DATE,
      scheduleSource: 'cache',
      lastError: 'schedule failed',
    });
    expect(buildPrayerDiagnostics({ ...base, lastReminderError: 'timer failed' }).lastError).toBe('timer failed');
  });

  it('describes thrown values that are not errors', () => {
    expect(describeError(new Error('boom'))).toBe('boom');
    expect(describeError('plain')).toBe('plain');
  });
});
