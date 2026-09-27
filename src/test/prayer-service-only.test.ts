import { renderHook } from '@testing-library/react';
import { afterEach, describe, expect, it, vi } from 'vitest';
import type { PrayerTrackingState } from '../types/domain';
import { createPrayerTrackingState, getPrayerRecordKey } from '../services/prayerTracking';
import { settingsFromPrayerPreferences } from '../store/contexts/usePrayerPreferencesSync';
import { usePrayerOutcomeUpkeep } from '../store/contexts/prayer/usePrayerOutcomeUpkeep';
import { makePrayerTimesData, PRAYER_TEST_DATE } from './prayerFixtures';

const api = vi.hoisted(() => ({ getPrayerSchedule: vi.fn() }));
vi.mock('../services/backend/prayerServiceApi', () => api);

import { getPrayerTimes, prayerTimesFromSchedule } from '../services/prayerTimes';

afterEach(() => vi.clearAllMocks());

/** The prayer service's timetable for the fixture day. */
function serviceSchedule(overrides: Record<string, unknown> = {}) {
  const times = makePrayerTimesData();
  return {
    date: times.date, hijriDate: '14 Rabīʿ al-thānī 1448', city: 'Bedford', country: 'United Kingdom',
    timezone: 'Europe/London', method: times.method,
    times: times.prayers.map(({ name, nameArabic, time, type }) => ({ name, nameArabic, time, type })),
    windows: [],
    ...overrides,
  };
}

describe('prayer times from the prayer service', () => {
  it('maps the service timetable to the app timetable in display order', () => {
    const shuffled = serviceSchedule({ times: [...serviceSchedule().times].reverse() });

    const data = prayerTimesFromSchedule(shuffled, new Date('2026-09-26T08:00:00Z'));

    expect(data.prayers.map(prayer => prayer.name))
      .toEqual(['Fajr', 'Sunrise', 'Dhuhr', 'Asr', 'Sunset', 'Maghrib', 'Isha', 'Midnight']);
    expect(data).toMatchObject({
      date: PRAYER_TEST_DATE, hijriDate: '14 Rabīʿ al-thānī 1448', timezone: 'Europe/London',
      fetchedAt: '2026-09-26T08:00:00.000Z', source: 'network',
    });
  });

  it('refuses a timetable missing a time', () => {
    const incomplete = serviceSchedule({ times: serviceSchedule().times.filter(time => time.name !== 'Midnight') });
    expect(() => prayerTimesFromSchedule(incomplete)).toThrow(/incomplete or out-of-order/u);
  });

  it('refuses a timetable whose times are out of order', () => {
    const times = serviceSchedule().times.map(time => (time.name === 'Dhuhr' ? { ...time, time: '04:00' } : time));
    expect(() => prayerTimesFromSchedule(serviceSchedule({ times }))).toThrow(/incomplete or out-of-order/u);
  });

  it('refuses a timetable in an invalid time zone', () => {
    expect(() => prayerTimesFromSchedule(serviceSchedule({ timezone: 'Not/AZone' }))).toThrow(/timezone/u);
  });

  it('asks the service for the location and, when given, the date', async () => {
    api.getPrayerSchedule.mockResolvedValue(serviceSchedule());

    await getPrayerTimes('Bedford', 'United Kingdom');
    await getPrayerTimes('Bedford', 'United Kingdom', '2026-09-25');

    expect(api.getPrayerSchedule).toHaveBeenNthCalledWith(1, 'Bedford', 'United Kingdom', undefined);
    expect(api.getPrayerSchedule).toHaveBeenNthCalledWith(2, 'Bedford', 'United Kingdom', '2026-09-25');
  });
});

describe('usePrayerOutcomeUpkeep', () => {
  // Dhuhr's deadline (Asr) is 15:20Z on the fixture day.
  const afterDhuhr = new Date('2026-09-26T15:30:00Z');
  const tracking = createPrayerTrackingState(new Date('2026-09-26T09:00:00Z'));
  const schedules = { [PRAYER_TEST_DATE]: makePrayerTimesData() };

  function render(initial: { tracking: PrayerTrackingState; now: Date }) {
    const reload = vi.fn();
    const hook = renderHook(props => usePrayerOutcomeUpkeep({
      loaded: true,
      tracking: props.tracking,
      reminderSchedules: schedules,
      reminderSchedulesValid: true,
      today: PRAYER_TEST_DATE,
      now: props.now,
      reload,
    }), { initialProps: initial });
    return { ...hook, reload };
  }

  it('reloads from the service once when a deadline passes without an outcome, never writing the miss', () => {
    const { reload, rerender } = render({ tracking, now: afterDhuhr });

    expect(reload).toHaveBeenCalledTimes(1);
    rerender({ tracking, now: new Date('2026-09-26T15:31:00Z') });
    expect(reload).toHaveBeenCalledTimes(1);
  });

  it('does nothing before a deadline passes', () => {
    const { reload } = render({ tracking, now: new Date('2026-09-26T13:00:00Z') });
    expect(reload).not.toHaveBeenCalled();
  });

  it('does nothing once the service has the outcome', () => {
    const dhuhrKey = getPrayerRecordKey(PRAYER_TEST_DATE, 'Dhuhr');
    const withMiss: PrayerTrackingState = {
      ...tracking,
      records: {
        [dhuhrKey]: { date: PRAYER_TEST_DATE, prayerName: 'Dhuhr', status: 'missed', recordedAt: '2026-09-26T15:21:00.000Z' },
      },
    };
    const { reload } = render({ tracking: withMiss, now: afterDhuhr });
    expect(reload).not.toHaveBeenCalled();
  });
});

describe('settingsFromPrayerPreferences', () => {
  it('applies the service preferences', () => {
    expect(settingsFromPrayerPreferences({ enabled: false, reminderEnabled: true, reminderMinutes: 30 }))
      .toEqual({ prayerEnabled: false, prayerReminderEnabled: true, prayerReminderMinutes: 30 });
  });

  it('falls back to the default lead time when the service holds one the app cannot offer', () => {
    expect(settingsFromPrayerPreferences({ enabled: true, reminderEnabled: true, reminderMinutes: 7 }).prayerReminderMinutes)
      .toBe(15);
  });
});
