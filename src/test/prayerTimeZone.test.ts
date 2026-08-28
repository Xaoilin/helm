import { describe, expect, it } from 'vitest';
import {
  getPrayerZonedClockSeconds,
  getPrayerZonedDate,
  prayerZonedDateTimeToInstant,
  validatePrayerTimeZone,
} from '../services/prayerTimeZone';

describe('prayer schedule timezone boundary', () => {
  it('orients the same instant to the raw London schedule wall clock, not Berlin', () => {
    const instant = new Date('2026-08-28T11:54:00.000Z');

    expect(getPrayerZonedDate(instant, 'Europe/London')).toBe('2026-08-28');
    expect(getPrayerZonedClockSeconds(instant, 'Europe/London')).toBe(12 * 3600 + 54 * 60);
    expect(getPrayerZonedClockSeconds(instant, 'Europe/Berlin')).toBe(13 * 3600 + 54 * 60);
  });

  it('converts London and Berlin wall clocks to distinct summer instants', () => {
    expect(prayerZonedDateTimeToInstant('2026-08-28', '13:03', 'Europe/London')?.toISOString())
      .toBe('2026-08-28T12:03:00.000Z');
    expect(prayerZonedDateTimeToInstant('2026-08-28', '13:03', 'Europe/Berlin')?.toISOString())
      .toBe('2026-08-28T11:03:00.000Z');
  });

  it('handles London spring-forward boundaries and rejects nonexistent wall times', () => {
    expect(prayerZonedDateTimeToInstant('2026-03-29', '00:30', 'Europe/London')?.toISOString())
      .toBe('2026-03-29T00:30:00.000Z');
    expect(prayerZonedDateTimeToInstant('2026-03-29', '02:30', 'Europe/London')?.toISOString())
      .toBe('2026-03-29T01:30:00.000Z');
    expect(prayerZonedDateTimeToInstant('2026-03-29', '01:30', 'Europe/London')).toBeNull();
  });

  it('preserves valid explicit zones and fails closed for invalid or missing zones', () => {
    expect(validatePrayerTimeZone('Europe/London')).toBe('Europe/London');
    expect(validatePrayerTimeZone('Not/A_Timezone')).toBe('');
    expect(prayerZonedDateTimeToInstant('2026-08-28', '13:03', '')).toBeNull();
  });
});
