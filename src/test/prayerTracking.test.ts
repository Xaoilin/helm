// @vitest-environment node
import { describe, expect, it } from 'vitest';
import type {
  PrayerName,
  PrayerScheduleDay,
  PrayerTrackingState,
  TaskCategory,
} from '../types/domain';
import {
  CANONICAL_PRAYER_NAMES,
  PRAYER_TRACKING_SCHEMA_VERSION,
  calculatePrayerOutcomeStats,
  capturePrayerActivationDayEligibility,
  createPrayerTrackingState,
  getPrayerCompletionStatusAt,
  getPrayerDeadlineBounds,
  getPrayerOutcome,
  getPrayerRecordKey,
  getPrayerReminderKey,
  isPrayerOpportunityTracked,
  normalizePrayerTrackingState,
  removePrayerOutcome,
  setPrayerOutcome,
  setPrayerReminderReceipt,
} from '../services/prayerTracking';

const PRAYERS = [
  { name: 'Fajr', time: '05:00' },
  { name: 'Sunrise', time: '06:30' },
  { name: 'Dhuhr', time: '12:00' },
  { name: 'Asr', time: '16:00' },
  { name: 'Sunset', time: '20:00' },
  { name: 'Maghrib', time: '20:15' },
  { name: 'Isha', time: '22:00' },
  { name: 'Midnight', time: '00:40' },
] as const;

function at(
  year: number,
  month: number,
  day: number,
  hours = 0,
  minutes = 0,
  milliseconds = 0,
): Date {
  return new Date(year, month - 1, day, hours, minutes, 0, milliseconds);
}

function schedule(date: string): PrayerScheduleDay {
  return { date, prayers: PRAYERS };
}

function scheduleWithTimes(
  date: string,
  times: Partial<Record<string, string>>,
): PrayerScheduleDay {
  return {
    date,
    prayers: PRAYERS.map(prayer => ({
      ...prayer,
      time: times[prayer.name] ?? prayer.time,
    })),
  };
}

function setOutcome(
  state: PrayerTrackingState,
  date: string,
  prayerName: PrayerName,
  status: 'on_time' | 'late' | 'missed' | 'unclassified',
  recordedAt: Date,
): PrayerTrackingState {
  return setPrayerOutcome(state, {
    date,
    prayerName,
    status,
    recordedAt,
    source: status === 'unclassified' ? 'migration' : 'dashboard',
  });
}

describe('prayer tracking state', () => {
  it('creates a versioned canonical empty state', () => {
    const activatedAt = at(2026, 4, 1, 9, 30);

    expect(createPrayerTrackingState(activatedAt)).toEqual({
      schemaVersion: PRAYER_TRACKING_SCHEMA_VERSION,
      trackingStartedAt: activatedAt.toISOString(),
      records: {},
      reminderReceipts: {},
      boundedReminderReceipts: {},
    });
    expect(CANONICAL_PRAYER_NAMES).toEqual(['Fajr', 'Dhuhr', 'Asr', 'Maghrib', 'Isha']);
  });

  it('imports legacy prayer completions as unclassified without guessing completion time', () => {
    const activatedAt = at(2026, 4, 20, 8);
    const tasks = [
      {
        id: 'old-fajr-id',
        title: 'Fajr Prayer',
        category: 'daily' as TaskCategory,
      },
      {
        id: 'dhuhr-id',
        title: 'Dhuhr Prayer',
        category: 'prayer' as TaskCategory,
        prayerName: 'Dhuhr' as const,
      },
      {
        id: 'ordinary-id',
        title: 'Drink water',
        category: 'daily' as TaskCategory,
      },
    ];
    const dailyLog = {
      '2026-04-18': ['old-fajr-id', 'ordinary-id'],
      '2026-04-19': ['dhuhr-id'],
      'not-a-date': ['old-fajr-id'],
    };

    const result = normalizePrayerTrackingState(null, {
      now: activatedAt,
      tasks,
      dailyLog,
    });

    expect(result.records).toEqual({
      [getPrayerRecordKey('2026-04-18', 'Fajr')]: {
        date: '2026-04-18',
        prayerName: 'Fajr',
        status: 'unclassified',
        recordedAt: activatedAt.toISOString(),
        rewarded: true,
        taskId: 'old-fajr-id',
        source: 'migration',
      },
      [getPrayerRecordKey('2026-04-19', 'Dhuhr')]: {
        date: '2026-04-19',
        prayerName: 'Dhuhr',
        status: 'unclassified',
        recordedAt: activatedAt.toISOString(),
        rewarded: true,
        taskId: 'dhuhr-id',
        source: 'migration',
      },
    });
  });

  it('is idempotent and preserves canonical records across task deletion or recreation', () => {
    const activatedAt = at(2026, 4, 20, 8);
    const first = normalizePrayerTrackingState(null, {
      now: activatedAt,
      tasks: [{
        id: 'old-fajr-id',
        title: 'Fajr Prayer',
        category: 'prayer',
        prayerName: 'Fajr',
      }],
      dailyLog: { '2026-04-19': ['old-fajr-id'] },
    });

    const repeated = normalizePrayerTrackingState(first, {
      now: at(2026, 4, 21, 12),
      tasks: [{
        id: 'new-fajr-id',
        title: 'Fajr Prayer',
        category: 'prayer',
        prayerName: 'Fajr',
      }],
      dailyLog: { '2026-04-19': ['new-fajr-id'] },
    });

    expect(repeated).toEqual(first);
    expect(getPrayerOutcome(repeated, '2026-04-19', 'Fajr')?.taskId).toBe('old-fajr-id');
  });

  it('normalizes activation-day eligibility idempotently in canonical order', () => {
    const raw = {
      ...createPrayerTrackingState(at(2026, 4, 20, 8)),
      activationDayEligibility: {
        date: '2026-04-20',
        prayerNames: ['Isha', 'invalid', 'Fajr', 'Isha'],
      },
    };

    const normalized = normalizePrayerTrackingState(raw, { now: at(2026, 4, 21) });
    const repeated = normalizePrayerTrackingState(normalized, { now: at(2026, 4, 22) });

    expect(normalized.activationDayEligibility).toEqual({
      date: '2026-04-20',
      prayerNames: ['Fajr', 'Isha'],
    });
    expect(repeated).toEqual(normalized);
  });

  it('discards an eligibility snapshot that is not for the activation local date', () => {
    const raw = {
      ...createPrayerTrackingState(at(2026, 4, 20, 8)),
      activationDayEligibility: {
        date: '2026-04-19',
        prayerNames: ['Fajr'],
      },
    };

    expect(
      normalizePrayerTrackingState(raw, { now: at(2026, 4, 21) })
        .activationDayEligibility,
    ).toBeUndefined();
  });

  it('never downgrades an existing classified outcome during legacy import', () => {
    const activatedAt = at(2026, 4, 20, 8);
    const classified = setPrayerOutcome(createPrayerTrackingState(activatedAt), {
      date: '2026-04-20',
      prayerName: 'Fajr',
      status: 'on_time',
      recordedAt: at(2026, 4, 20, 6),
      taskId: 'fajr-id',
      source: 'dashboard',
    });

    const normalized = normalizePrayerTrackingState(classified, {
      now: activatedAt,
      tasks: [{
        id: 'fajr-id',
        title: 'Fajr Prayer',
        category: 'prayer',
        prayerName: 'Fajr',
      }],
      dailyLog: { '2026-04-20': ['fajr-id'] },
    });

    expect(getPrayerOutcome(normalized, '2026-04-20', 'Fajr')?.status).toBe('on_time');
  });

  it('sets, corrects, reads, and removes outcomes immutably', () => {
    const initial = createPrayerTrackingState(at(2026, 4, 1));
    const onTime = setPrayerOutcome(initial, {
      date: '2026-04-01',
      prayerName: 'Fajr',
      status: 'on_time',
      recordedAt: at(2026, 4, 1, 6),
      rewarded: true,
      taskId: 'fajr-id',
      source: 'tasks',
    });
    const corrected = setPrayerOutcome(onTime, {
      date: '2026-04-01',
      prayerName: 'Fajr',
      status: 'late',
      recordedAt: at(2026, 4, 2, 10),
    });
    const removed = removePrayerOutcome(corrected, '2026-04-01', 'Fajr');

    expect(initial.records).toEqual({});
    expect(getPrayerOutcome(onTime, '2026-04-01', 'Fajr')?.status).toBe('on_time');
    expect(getPrayerOutcome(corrected, '2026-04-01', 'Fajr')).toMatchObject({
      status: 'late',
      rewarded: true,
      taskId: 'fajr-id',
      source: 'tasks',
    });
    expect(getPrayerOutcome(removed, '2026-04-01', 'Fajr')).toBeUndefined();
    expect(removePrayerOutcome(removed, '2026-04-01', 'Fajr')).toBe(removed);
  });

  it('stores notification and snooze receipts under date/prayer/deadline keys', () => {
    const initial = createPrayerTrackingState(at(2026, 4, 1));
    const deadlineAt = at(2026, 4, 1, 20);
    const notifiedAt = at(2026, 4, 1, 19, 45);
    const snoozedUntil = at(2026, 4, 1, 19, 50);
    const notified = setPrayerReminderReceipt(initial, {
      date: '2026-04-01',
      prayerName: 'Asr',
      deadlineAt,
      notifiedAt,
    });
    const snoozed = setPrayerReminderReceipt(notified, {
      date: '2026-04-01',
      prayerName: 'Asr',
      deadlineAt,
      snoozedUntil,
    });
    const key = getPrayerReminderKey('2026-04-01', 'Asr', deadlineAt);

    expect(snoozed.reminderReceipts[key]).toEqual({
      date: '2026-04-01',
      prayerName: 'Asr',
      deadlineAt: deadlineAt.toISOString(),
      notificationKey: key,
      notifiedAt: notifiedAt.toISOString(),
      snoozedUntil: snoozedUntil.toISOString(),
    });
    expect(normalizePrayerTrackingState(snoozed, { now: at(2026, 4, 2) })).toEqual(snoozed);
  });

  it('rejects invalid local dates and timestamps', () => {
    const state = createPrayerTrackingState(at(2026, 4, 1));

    expect(() => setPrayerOutcome(state, {
      date: '2026-02-30',
      prayerName: 'Fajr',
      status: 'on_time',
    })).toThrow('Invalid local prayer date');
    expect(() => getPrayerReminderKey('2026-04-01', 'Fajr', 'invalid')).toThrow(
      'Invalid prayer reminder deadline',
    );
  });
});

describe('Jafari prayer deadline bounds', () => {
  it.each([
    ['Fajr', 'Sunrise', 6, 30],
    ['Dhuhr', 'Sunset', 20, 0],
    ['Asr', 'Sunset', 20, 0],
  ] as const)('%s remains on time until %s', (prayerName, deadlineName, hour, minute) => {
    const bounds = getPrayerDeadlineBounds(PRAYERS, '2026-04-01', prayerName);

    expect(bounds).not.toBeNull();
    expect(bounds?.deadlineName).toBe(deadlineName);
    expect(bounds?.deadlineAt.getFullYear()).toBe(2026);
    expect(bounds?.deadlineAt.getMonth()).toBe(3);
    expect(bounds?.deadlineAt.getDate()).toBe(1);
    expect(bounds?.deadlineAt.getHours()).toBe(hour);
    expect(bounds?.deadlineAt.getMinutes()).toBe(minute);
  });

  it.each([
    ['Maghrib', 20, 15],
    ['Isha', 22, 0],
  ] as const)('%s uses next-day Jafari Midnight', (prayerName, startHour, startMinute) => {
    const bounds = getPrayerDeadlineBounds(PRAYERS, '2026-04-01', prayerName);

    expect(bounds?.deadlineName).toBe('Midnight');
    expect(bounds?.startsAt.getDate()).toBe(1);
    expect(bounds?.startsAt.getHours()).toBe(startHour);
    expect(bounds?.startsAt.getMinutes()).toBe(startMinute);
    expect(bounds?.deadlineAt.getDate()).toBe(2);
    expect(bounds?.deadlineAt.getHours()).toBe(0);
    expect(bounds?.deadlineAt.getMinutes()).toBe(40);
  });

  it('treats exact deadline as late and the preceding millisecond as on time', () => {
    const deadline = at(2026, 4, 1, 6, 30);

    expect(getPrayerCompletionStatusAt(deadline, new Date(deadline.getTime() - 1))).toBe('on_time');
    expect(getPrayerCompletionStatusAt(deadline, deadline)).toBe('late');
    expect(getPrayerCompletionStatusAt(deadline, new Date(deadline.getTime() + 1))).toBe('late');
  });

  it('keeps local calendar dates through a DST transition instead of slicing UTC dates', () => {
    const bounds = getPrayerDeadlineBounds(PRAYERS, '2026-03-29', 'Isha');

    expect(bounds?.date).toBe('2026-03-29');
    expect(bounds?.startsAt.getFullYear()).toBe(2026);
    expect(bounds?.startsAt.getMonth()).toBe(2);
    expect(bounds?.startsAt.getDate()).toBe(29);
    expect(bounds?.deadlineAt.getDate()).toBe(30);
  });

  it('returns null when schedule lacks required events or has invalid clock data', () => {
    expect(getPrayerDeadlineBounds([{ name: 'Fajr', time: '05:00' }], '2026-04-01', 'Fajr')).toBeNull();
    expect(getPrayerDeadlineBounds([
      { name: 'Fajr', time: '25:00' },
      { name: 'Sunrise', time: '06:30' },
    ], '2026-04-01', 'Fajr')).toBeNull();
  });
});

describe('activation-day eligibility snapshot', () => {
  it('captures only prayers whose actual deadline is strictly after activation', () => {
    const activation = at(2026, 7, 1, 6, 30);
    const state = createPrayerTrackingState(activation);
    const captured = capturePrayerActivationDayEligibility(
      state,
      scheduleWithTimes('2026-07-01', {
        Sunrise: '06:30',
        Sunset: '21:30',
        Midnight: '00:45',
      }),
    );

    expect(captured.activationDayEligibility).toEqual({
      date: '2026-07-01',
      prayerNames: ['Dhuhr', 'Asr', 'Maghrib', 'Isha'],
    });
  });

  it('does not capture a partial or non-activation-day schedule', () => {
    const state = createPrayerTrackingState(at(2026, 7, 1, 6, 30));

    const partial = capturePrayerActivationDayEligibility(state, {
      date: '2026-07-01',
      prayers: [{ name: 'Fajr', time: '04:00' }],
    });
    const wrongDay = capturePrayerActivationDayEligibility(
      state,
      schedule('2026-07-02'),
    );

    expect(partial.activationDayEligibility).toBeUndefined();
    expect(wrongDay.activationDayEligibility).toBeUndefined();
  });

  it('keeps first capture immutable across later season or location schedules', () => {
    const state = createPrayerTrackingState(at(2026, 7, 1, 6));
    const summer = capturePrayerActivationDayEligibility(
      state,
      scheduleWithTimes('2026-07-01', { Fajr: '03:30', Sunrise: '04:45' }),
    );
    const changedLocation = capturePrayerActivationDayEligibility(
      summer,
      scheduleWithTimes('2026-07-01', { Sunrise: '09:00' }),
    );

    expect(changedLocation.activationDayEligibility).toEqual(
      summer.activationDayEligibility,
    );
    expect(changedLocation).toEqual(summer);
  });

  it('preserves DST-transition eligibility when later clock times move earlier', () => {
    const state = createPrayerTrackingState(at(2026, 3, 29, 6, 45));
    const captured = capturePrayerActivationDayEligibility(
      state,
      scheduleWithTimes('2026-03-29', { Sunrise: '06:50' }),
    );
    const result = calculatePrayerOutcomeStats(
      captured,
      [scheduleWithTimes('2026-03-29', { Sunrise: '06:30' })],
      at(2026, 3, 30, 12),
    );

    expect(captured.activationDayEligibility?.prayerNames).toContain('Fajr');
    expect(result).toMatchObject({
      missed: 5,
      inferredMissed: 5,
      classifiedTotal: 5,
    });
  });

  it('prevents winter/location times from adding an ineligible summer Fajr later', () => {
    const state = createPrayerTrackingState(at(2026, 7, 1, 6));
    const captured = capturePrayerActivationDayEligibility(
      state,
      scheduleWithTimes('2026-07-01', { Fajr: '03:30', Sunrise: '04:45' }),
    );
    const result = calculatePrayerOutcomeStats(
      captured,
      [scheduleWithTimes('2026-07-01', { Sunrise: '08:30' })],
      at(2026, 7, 2, 12),
    );
    const changedSchedule = scheduleWithTimes('2026-07-01', { Sunrise: '08:30' });

    expect(captured.activationDayEligibility?.prayerNames).not.toContain('Fajr');
    expect(isPrayerOpportunityTracked(captured, changedSchedule, 'Fajr')).toBe(false);
    expect(isPrayerOpportunityTracked(captured, changedSchedule, 'Dhuhr')).toBe(true);
    expect(result).toMatchObject({
      missed: 4,
      inferredMissed: 4,
      classifiedTotal: 4,
      opportunities: 4,
    });
    expect(result.perPrayer.Fajr.classifiedTotal).toBe(0);
  });

  it('falls back to exact activation boundary bounds before a snapshot exists', () => {
    const state = createPrayerTrackingState(at(2026, 7, 1, 6, 30));

    expect(isPrayerOpportunityTracked(
      state,
      scheduleWithTimes('2026-07-01', { Sunrise: '06:30' }),
      'Fajr',
      at(2026, 7, 1, 12),
    )).toBe(false);
    expect(isPrayerOpportunityTracked(
      state,
      schedule('2026-07-01'),
      'Dhuhr',
      at(2026, 7, 1, 12),
    )).toBe(true);
    expect(isPrayerOpportunityTracked(
      state,
      schedule('2026-06-30'),
      'Dhuhr',
      at(2026, 7, 1, 12),
    )).toBe(false);
    expect(isPrayerOpportunityTracked(
      state,
      schedule('2026-07-02'),
      'Fajr',
      at(2026, 7, 1, 12),
    )).toBe(true);
  });

  it('does not reconstruct activation-day eligibility after that local day has ended', () => {
    const state = createPrayerTrackingState(at(2026, 7, 1, 6));
    const laterTimetable = scheduleWithTimes('2026-07-01', { Sunrise: '08:30' });

    expect(isPrayerOpportunityTracked(
      state,
      laterTimetable,
      'Fajr',
      at(2026, 7, 2, 12),
    )).toBe(false);
    expect(calculatePrayerOutcomeStats(
      state,
      [laterTimetable],
      at(2026, 7, 2, 12),
    ).opportunities).toBe(0);
  });

  it('does not track an opportunity whose required deadline is unavailable', () => {
    const state = createPrayerTrackingState(at(2026, 7, 1));

    expect(isPrayerOpportunityTracked(state, {
      date: '2026-07-01',
      prayers: [{ name: 'Fajr', time: '04:00' }],
    }, 'Fajr')).toBe(false);
  });
});

describe('prayer outcome stats', () => {
  it('counts classified and matured outcomes while excluding pending and legacy entries', () => {
    let state = capturePrayerActivationDayEligibility(
      createPrayerTrackingState(at(2026, 4, 1)),
      schedule('2026-04-01'),
    );
    state = setOutcome(state, '2026-04-01', 'Fajr', 'on_time', at(2026, 4, 1, 6));
    state = setOutcome(state, '2026-04-01', 'Dhuhr', 'late', at(2026, 4, 1, 21));
    state = setOutcome(state, '2026-04-01', 'Asr', 'missed', at(2026, 4, 1, 21));
    state = setOutcome(state, '2026-04-01', 'Maghrib', 'unclassified', at(2026, 4, 1));

    const result = calculatePrayerOutcomeStats(
      state,
      [schedule('2026-04-01'), schedule('2026-04-02')],
      at(2026, 4, 2, 15),
    );

    expect(result).toMatchObject({
      onTime: 1,
      late: 1,
      missed: 3,
      inferredMissed: 2,
      unclassified: 1,
      pending: 4,
      classifiedTotal: 5,
      opportunities: 10,
      trackedDays: 2,
      percentages: { onTime: 20, late: 20, missed: 60 },
    });
    expect(result.perPrayer.Dhuhr).toMatchObject({
      late: 1,
      pending: 1,
      classifiedTotal: 1,
      percentages: { onTime: 0, late: 100, missed: 0 },
    });
    expect(result.perPrayer.Maghrib).toMatchObject({
      unclassified: 1,
      pending: 1,
      classifiedTotal: 0,
      percentages: { onTime: 0, late: 0, missed: 0 },
    });
  });

  it('lets an explicit late backfill replace an inferred miss', () => {
    const initial = capturePrayerActivationDayEligibility(
      createPrayerTrackingState(at(2026, 4, 1)),
      schedule('2026-04-01'),
    );
    const before = calculatePrayerOutcomeStats(initial, [schedule('2026-04-01')], at(2026, 4, 2, 1));
    const correctedState = setOutcome(
      initial,
      '2026-04-01',
      'Isha',
      'late',
      at(2026, 4, 2, 1),
    );
    const after = calculatePrayerOutcomeStats(
      correctedState,
      [schedule('2026-04-01')],
      at(2026, 4, 2, 1),
    );

    expect(before).toMatchObject({ late: 0, missed: 5, inferredMissed: 5 });
    expect(after).toMatchObject({ late: 1, missed: 4, inferredMissed: 4 });
  });

  it('excludes pre-activation opportunities but includes prayers completed after activation', () => {
    const activatedAt = at(2026, 4, 1, 10);
    let state = createPrayerTrackingState(activatedAt);
    const withoutCompletion = calculatePrayerOutcomeStats(
      state,
      [schedule('2026-04-01')],
      at(2026, 4, 1, 21),
    );

    state = setOutcome(state, '2026-04-01', 'Fajr', 'late', at(2026, 4, 1, 11));
    const withCompletion = calculatePrayerOutcomeStats(
      state,
      [schedule('2026-04-01')],
      at(2026, 4, 1, 21),
    );

    expect(withoutCompletion).toMatchObject({
      missed: 2,
      pending: 2,
      classifiedTotal: 2,
      opportunities: 4,
    });
    expect(withCompletion).toMatchObject({
      late: 1,
      missed: 2,
      pending: 2,
      classifiedTotal: 3,
      opportunities: 5,
    });
  });

  it('counts legacy unclassified records separately but ignores old classified records', () => {
    const activatedAt = at(2026, 4, 2, 2);
    const state: PrayerTrackingState = {
      ...createPrayerTrackingState(activatedAt),
      records: {
        [getPrayerRecordKey('2026-04-01', 'Fajr')]: {
          date: '2026-04-01',
          prayerName: 'Fajr',
          status: 'on_time',
          recordedAt: at(2026, 4, 1, 6).toISOString(),
        },
        [getPrayerRecordKey('2026-04-01', 'Dhuhr')]: {
          date: '2026-04-01',
          prayerName: 'Dhuhr',
          status: 'unclassified',
          recordedAt: activatedAt.toISOString(),
          source: 'migration',
        },
      },
    };

    const result = calculatePrayerOutcomeStats(
      state,
      [schedule('2026-04-01')],
      at(2026, 4, 2, 12),
    );

    expect(result).toMatchObject({
      onTime: 0,
      late: 0,
      missed: 0,
      unclassified: 1,
      classifiedTotal: 0,
      opportunities: 1,
    });
  });

  it('uses deterministic largest-remainder rounding so classified percentages total 100', () => {
    let state = createPrayerTrackingState(at(2026, 4, 1));
    state = setOutcome(state, '2026-04-01', 'Fajr', 'on_time', at(2026, 4, 1, 6));
    state = setOutcome(state, '2026-04-01', 'Dhuhr', 'late', at(2026, 4, 1, 21));
    state = setOutcome(state, '2026-04-01', 'Asr', 'missed', at(2026, 4, 1, 21));
    state = setOutcome(state, '2026-04-01', 'Maghrib', 'unclassified', at(2026, 4, 1));
    state = setOutcome(state, '2026-04-01', 'Isha', 'unclassified', at(2026, 4, 1));

    const result = calculatePrayerOutcomeStats(
      state,
      [schedule('2026-04-01')],
      at(2026, 4, 2, 1),
    );

    expect(result.percentages).toEqual({ onTime: 34, late: 33, missed: 33 });
    expect(Object.values(result.percentages).reduce((sum, value) => sum + value, 0)).toBe(100);
  });

  it('treats deadline equality as matured and deduplicates repeated schedule days', () => {
    const state = createPrayerTrackingState(at(2026, 4, 1));
    const result = calculatePrayerOutcomeStats(
      state,
      [schedule('2026-04-01'), schedule('2026-04-01')],
      at(2026, 4, 1, 6, 30),
    );

    expect(result).toMatchObject({
      missed: 1,
      inferredMissed: 1,
      pending: 4,
      opportunities: 5,
      trackedDays: 1,
    });
  });

  it('counts explicit outcomes even when deadline data is unavailable', () => {
    let state = createPrayerTrackingState(at(2026, 4, 1));
    state = setOutcome(state, '2026-04-01', 'Fajr', 'on_time', at(2026, 4, 1, 6));

    const result = calculatePrayerOutcomeStats(
      state,
      [{ date: '2026-04-01', prayers: [{ name: 'Fajr', time: '05:00' }] }],
      at(2026, 4, 1, 7),
    );

    expect(result).toMatchObject({
      onTime: 1,
      classifiedTotal: 1,
      pending: 0,
      opportunities: 1,
    });
  });

  it('keeps explicit classified and legacy counts when no schedule is available', () => {
    const activatedAt = at(2026, 4, 2, 2);
    const state: PrayerTrackingState = {
      ...createPrayerTrackingState(activatedAt),
      records: {
        [getPrayerRecordKey('2026-04-01', 'Dhuhr')]: {
          date: '2026-04-01',
          prayerName: 'Dhuhr',
          status: 'unclassified',
          recordedAt: activatedAt.toISOString(),
          rewarded: true,
          source: 'migration',
        },
        [getPrayerRecordKey('2026-04-02', 'Fajr')]: {
          date: '2026-04-02',
          prayerName: 'Fajr',
          status: 'late',
          recordedAt: at(2026, 4, 2, 6).toISOString(),
          rewarded: true,
          source: 'tasks',
        },
      },
    };

    expect(calculatePrayerOutcomeStats(state, [], at(2026, 4, 2, 7))).toMatchObject({
      late: 1,
      unclassified: 1,
      classifiedTotal: 1,
      opportunities: 2,
      trackedDays: 2,
      percentages: { onTime: 0, late: 100, missed: 0 },
    });
  });

  it('recovers a missing tracking record from the gamification transaction ledger', () => {
    const recordedAt = at(2026, 4, 2, 6).toISOString();
    const state = normalizePrayerTrackingState(null, {
      now: at(2026, 4, 2, 7),
      prayerCompletionLedger: {
        [getPrayerRecordKey('2026-04-02', 'Fajr')]: {
          date: '2026-04-02',
          prayerName: 'Fajr',
          status: 'late',
          recordedAt,
          rewarded: true,
          source: 'dashboard',
        },
      },
    });

    expect(getPrayerOutcome(state, '2026-04-02', 'Fajr')).toMatchObject({
      status: 'late',
      recordedAt,
      rewarded: true,
      source: 'dashboard',
    });
  });
});
