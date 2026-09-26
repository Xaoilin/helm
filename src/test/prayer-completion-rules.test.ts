import { describe, expect, it } from 'vitest';
import {
  assertPrayerCompletable,
  PrayerCompletionRejectedError,
  prayerCompletionRejection,
  type PrayerCompletionCheck,
} from '../services/prayerCompletionRules';

/** London on 2026-09-26 (BST, UTC+1): Fajr 05:14, Dhuhr 12:52, Isha 20:15, Midnight 00:52. */
const LONDON = {
  timezone: 'Europe/London',
  prayers: [
    { name: 'Fajr', time: '05:14' },
    { name: 'Sunrise', time: '06:53' },
    { name: 'Dhuhr', time: '12:52' },
    { name: 'Asr', time: '16:06' },
    { name: 'Sunset', time: '18:50' },
    { name: 'Maghrib', time: '19:10' },
    { name: 'Isha', time: '20:15' },
    { name: 'Midnight', time: '00:52' },
  ],
};

function check(overrides: Partial<PrayerCompletionCheck>): PrayerCompletionCheck {
  return {
    prayerName: 'Fajr',
    prayerDate: '2026-09-26',
    today: '2026-09-26',
    timetable: LONDON,
    now: new Date('2026-09-26T09:00:00Z'),
    ...overrides,
  };
}

describe('prayerCompletionRejection', () => {
  describe('allows', () => {
    it('a prayer inside its on-time window', () => {
      expect(prayerCompletionRejection(check({ prayerName: 'Fajr', now: new Date('2026-09-26T04:30:00Z') }))).toBeNull();
    });

    it('a prayer after its window (a late completion)', () => {
      expect(prayerCompletionRejection(check({ prayerName: 'Fajr', now: new Date('2026-09-26T09:00:00Z') }))).toBeNull();
    });

    it('any prayer on an earlier date, whatever the clock says', () => {
      expect(prayerCompletionRejection(check({
        prayerName: 'Isha', prayerDate: '2026-09-25', now: new Date('2026-09-26T01:00:00Z'),
      }))).toBeNull();
    });

    it('a prayer on the current date when no timetable is available', () => {
      expect(prayerCompletionRejection(check({ timetable: null, now: new Date('2026-09-26T00:10:00Z') }))).toBeNull();
    });
  });

  describe('rejects', () => {
    it('Fajr and Dhuhr in the early hours before either has started (the reported case)', () => {
      const earlyHours = new Date('2026-09-26T01:10:00Z'); // 02:10 London
      expect(prayerCompletionRejection(check({ prayerName: 'Fajr', now: earlyHours }))).toBe('Fajr has not started yet.');
      expect(prayerCompletionRejection(check({ prayerName: 'Dhuhr', now: earlyHours }))).toBe('Dhuhr has not started yet.');
    });

    it('a later prayer of the day before its start', () => {
      expect(prayerCompletionRejection(check({ prayerName: 'Isha', now: new Date('2026-09-26T13:00:00Z') })))
        .toBe('Isha has not started yet.');
    });

    it('any prayer on a future date, with or without a timetable', () => {
      expect(prayerCompletionRejection(check({ prayerDate: '2026-09-27' }))).toBe('Fajr has not started yet.');
      expect(prayerCompletionRejection(check({ prayerDate: '2026-09-27', timetable: null }))).toBe('Fajr has not started yet.');
    });
  });

  describe('edges', () => {
    it('allows a prayer at the exact start instant and rejects one millisecond before', () => {
      expect(prayerCompletionRejection(check({ prayerName: 'Dhuhr', now: new Date('2026-09-26T11:52:00.000Z') }))).toBeNull();
      expect(prayerCompletionRejection(check({ prayerName: 'Dhuhr', now: new Date('2026-09-26T11:51:59.999Z') })))
        .toBe('Dhuhr has not started yet.');
    });

    it('keeps Isha completable after calendar midnight while its date is still the previous day', () => {
      expect(prayerCompletionRejection(check({
        prayerName: 'Isha', prayerDate: '2026-09-25', today: '2026-09-25', now: new Date('2026-09-25T23:30:00Z'),
      }))).toBeNull();
    });

    it('uses the timetable zone, not the browser zone, for the start instant', () => {
      const berlin = { ...LONDON, timezone: 'Europe/Berlin' }; // Fajr 05:14 Berlin = 03:14Z
      expect(prayerCompletionRejection(check({ timetable: berlin, now: new Date('2026-09-26T03:30:00Z') }))).toBeNull();
      expect(prayerCompletionRejection(check({ timetable: LONDON, now: new Date('2026-09-26T03:30:00Z') })))
        .toBe('Fajr has not started yet.');
    });

    it('does not block when the timetable lacks the prayer entry', () => {
      const partial = { ...LONDON, prayers: LONDON.prayers.filter(prayer => prayer.name !== 'Dhuhr') };
      expect(prayerCompletionRejection(check({ prayerName: 'Dhuhr', timetable: partial, now: new Date('2026-09-26T01:00:00Z') })))
        .toBeNull();
    });
  });
});

it('assertPrayerCompletable throws a typed error the UI can show', () => {
  expect(() => assertPrayerCompletable(check({ prayerName: 'Fajr', now: new Date('2026-09-26T01:10:00Z') })))
    .toThrow(PrayerCompletionRejectedError);
  expect(() => assertPrayerCompletable(check({ now: new Date('2026-09-26T09:00:00Z') }))).not.toThrow();
});
