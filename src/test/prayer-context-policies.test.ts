import { describe, expect, it } from 'vitest';
import { getPrayerDateAt } from '../services/prayerTimeZone';
import {
  assertCurrentPrayerSchedule,
  reminderSchedulesHaveValidZones,
  retainReminderSchedules,
} from '../services/prayerSchedulePolicy';
import {
  getPrayerSnoozeEnd,
  selectBoundedReminderPlans,
  snoozePrayerReminderGroup,
  type PrayerReminderGroup,
} from '../services/prayerReminderPolicy';
import { countPrayerRewardKnowledge } from '../services/prayerCompletionPolicy';
import {
  buildPrayerDiagnostics,
  describeError,
  describeReminderSuppression,
  findNextReminderAt,
} from '../services/prayerDiagnostics';
import { createPrayerTrackingState, getPrayerReminderKey, setPrayerOutcome } from '../services/prayerTracking';
import { makeMomentumState } from './fixtures';
import { makePrayerTimesData, PRAYER_TEST_DATE } from './prayerFixtures';

const tracking = createPrayerTrackingState(new Date('2026-09-01T00:00:00Z'));

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

describe('snoozePrayerReminderGroup', () => {
  const deadlineAt = new Date('2026-09-26T15:20:00Z');
  const group: PrayerReminderGroup = {
    prayerDate: PRAYER_TEST_DATE,
    prayerNames: ['Dhuhr'],
    deadlineName: 'Asr',
    deadlineAt,
    fireAt: new Date('2026-09-26T15:05:00Z'),
    minutesRemaining: 15,
    canSnooze: true,
    timezone: 'Europe/London',
  };

  it('records a snooze receipt five minutes out for each prayer in the group', () => {
    const now = new Date('2026-09-26T15:06:00Z');
    const next = snoozePrayerReminderGroup(tracking, group, now);
    const receipt = next?.reminderReceipts[getPrayerReminderKey(PRAYER_TEST_DATE, 'Dhuhr', deadlineAt)];
    expect(receipt?.snoozedUntil).toBe(getPrayerSnoozeEnd(now).toISOString());
    expect(getPrayerSnoozeEnd(now).toISOString()).toBe('2026-09-26T15:11:00.000Z');
  });

  it('changes nothing without a group or when the group cannot be snoozed', () => {
    const now = new Date('2026-09-26T15:06:00Z');
    expect(snoozePrayerReminderGroup(tracking, null, now)).toBeNull();
    expect(snoozePrayerReminderGroup(tracking, { ...group, canSnooze: false }, now)).toBeNull();
  });

  it('refuses a snooze that would reach the deadline', () => {
    expect(snoozePrayerReminderGroup(tracking, group, new Date('2026-09-26T15:15:00Z'))).toBeNull();
  });
});

describe('selectBoundedReminderPlans', () => {
  const input = {
    prayerEnabled: true,
    reminderEnabled: true,
    timetable: makePrayerTimesData(),
    momentum: makeMomentumState(),
    prayerDate: PRAYER_TEST_DATE,
    tracking,
    reminderMinutes: 15,
  };

  it('plans an opportunity and a deadline reminder for each open prayer', () => {
    const plans = selectBoundedReminderPlans(input);
    expect(plans.filter(plan => plan.prayerNames.includes('Dhuhr')).map(plan => plan.kind))
      .toEqual(['prayer-opportunity', 'prayer-deadline']);
  });

  it('skips prayers that already have an outcome', () => {
    const done = setPrayerOutcome(tracking, {
      date: PRAYER_TEST_DATE,
      prayerName: 'Dhuhr',
      status: 'on_time',
      recordedAt: new Date('2026-09-26T12:00:00Z'),
      source: 'dashboard',
    });
    expect(selectBoundedReminderPlans({ ...input, tracking: done }).some(plan => plan.prayerNames.includes('Dhuhr')))
      .toBe(false);
  });

  it('plans nothing while prayer is off, without a timetable, or before momentum loads', () => {
    expect(selectBoundedReminderPlans({ ...input, prayerEnabled: false })).toEqual([]);
    expect(selectBoundedReminderPlans({ ...input, timetable: null })).toEqual([]);
    expect(selectBoundedReminderPlans({ ...input, momentum: null })).toEqual([]);
  });

  it('keeps only momentum reminders when deadline reminders are off', () => {
    const plans = selectBoundedReminderPlans({ ...input, reminderEnabled: false });
    expect(plans.every(plan => plan.kind === 'momentum')).toBe(true);
  });
});

describe('countPrayerRewardKnowledge', () => {
  it('counts entries, topics and lifestyle progress', () => {
    expect(countPrayerRewardKnowledge({
      knowledgeEntries: [{}, {}],
      knowledgeTopics: [{}],
      lifestyleItems: [
        { type: 'haram', status: 'mastered' },
        { type: 'haram', status: 'struggling' },
        { type: 'halal', status: 'consistent' },
      ] as never,
    })).toEqual({
      knowledgeEntries: 2,
      knowledgeTopics: 1,
      lifestyleHaramMastered: 1,
      lifestyleHalalConsistent: 1,
      lifestyleTotal: 3,
    });
  });
});

describe('prayer diagnostics', () => {
  const ready = {
    prayerEnabled: true,
    reminderEnabled: true,
    scheduleStatus: 'ready' as const,
    schedule: makePrayerTimesData(),
    scheduleTimezone: 'Europe/London',
    reminderGroupCount: 2,
  };

  it('explains the first reason reminders cannot run', () => {
    expect(describeReminderSuppression(ready)).toBeNull();
    expect(describeReminderSuppression({ ...ready, prayerEnabled: false, reminderEnabled: false }))
      .toBe('Prayer times are disabled.');
    expect(describeReminderSuppression({ ...ready, reminderEnabled: false })).toBe('Deadline reminders are disabled.');
    expect(describeReminderSuppression({ ...ready, scheduleStatus: 'loading' }))
      .toBe('No matching current-day prayer schedule is available.');
    expect(describeReminderSuppression({ ...ready, scheduleTimezone: '' }))
      .toBe('The schedule timezone could not be verified.');
    expect(describeReminderSuppression({ ...ready, reminderGroupCount: 0 }))
      .toBe('No incomplete prayer is currently eligible.');
  });

  it('finds the fire time of the first group whose deadline is still ahead', () => {
    const groups = [
      { deadlineAt: new Date('2026-09-26T06:00:00Z'), fireAt: new Date('2026-09-26T05:45:00Z') },
      { deadlineAt: new Date('2026-09-26T15:20:00Z'), fireAt: new Date('2026-09-26T15:05:00Z') },
    ] as PrayerReminderGroup[];
    expect(findNextReminderAt(groups, new Date('2026-09-26T12:00:00Z'))).toBe('2026-09-26T15:05:00.000Z');
    expect(findNextReminderAt(groups, new Date('2026-09-26T16:00:00Z'))).toBeNull();
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
      nextReminderAt: null,
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
