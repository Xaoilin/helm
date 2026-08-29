import { readFileSync } from 'node:fs';
import { resolve } from 'node:path';
import { describe, expect, it } from 'vitest';
import { extractTemporalReference } from '../assistant/temporalResolver';
import { resolveAppTimeZone } from '../services/appTimeZone';
import { localEventToGooglePayload } from '../services/googleCalendarApi';
import {
  buildPrayerScheduleDays,
  buildPrayerSchedulePolicySnapshot,
} from '../services/prayerSchedulePolicy';
import { createPrayerTrackingState } from '../services/prayerTracking';
import type { PrayerTimesData } from '../services/prayerTimes';
import {
  dateTimeLocalToInstant,
  getZonedDateTimeParts,
  instantToDateTimeLocal,
  zonedDateTimeToInstant,
} from '../services/timeZone';
import { makeAssistantContext, makePrayerScheduleEntries } from './fixtures';

const root = resolve(__dirname, '../..');

function makePrayerSchedule(timezone = 'Europe/London'): PrayerTimesData {
  return {
    date: '2026-08-29',
    hijriDate: '16-03-1448',
    city: 'Bedford',
    country: 'United Kingdom',
    timezone,
    method: 'Jafari',
    fetchedAt: '2026-08-29T03:00:00.000Z',
    source: 'network',
    prayers: makePrayerScheduleEntries().map(entry => ({
      ...entry,
      nameArabic: entry.name,
      type: ['Sunrise', 'Sunset', 'Midnight'].includes(entry.name) ? 'event' : 'prayer',
    })) as PrayerTimesData['prayers'],
  };
}

describe('effective app time-zone policy', () => {
  it('resolves one validated preference and falls back through Automatic to UTC', () => {
    expect(resolveAppTimeZone('America/New_York', 'Europe/London')).toEqual({
      preferredTimeZone: 'America/New_York',
      browserTimeZone: 'Europe/London',
      effectiveTimeZone: 'America/New_York',
      source: 'preference',
    });
    expect(resolveAppTimeZone(undefined, 'Europe/London')).toMatchObject({
      effectiveTimeZone: 'Europe/London',
      source: 'automatic',
    });
    expect(resolveAppTimeZone('Not/AZone', '')).toMatchObject({
      effectiveTimeZone: 'UTC',
      source: 'utc-fallback',
      invalidPreference: 'Not/AZone',
    });
  });

  it('presents one instant in zones with different offsets without host-zone dependence', () => {
    const instant = new Date('2026-08-29T03:30:00.000Z');
    expect(getZonedDateTimeParts(instant, 'Europe/London')).toMatchObject({
      year: 2026,
      month: 8,
      day: 29,
      hour: 4,
      minute: 30,
    });
    expect(getZonedDateTimeParts(instant, 'America/New_York')).toMatchObject({
      year: 2026,
      month: 8,
      day: 28,
      hour: 23,
      minute: 30,
    });
  });

  it('fails closed for a spring-forward gap and chooses the earliest fall-back instant', () => {
    expect(zonedDateTimeToInstant('2026-03-29', '01:30', 'Europe/London')).toBeNull();
    expect(zonedDateTimeToInstant('2026-10-25', '01:30', 'Europe/London')?.toISOString()).toBe(
      '2026-10-25T00:30:00.000Z',
    );
    expect(dateTimeLocalToInstant('2026-03-29T01:30', 'Europe/London')).toBeNull();
    expect(instantToDateTimeLocal(
      new Date('2026-10-25T00:30:00.000Z'),
      'Europe/London',
    )).toBe('2026-10-25T01:30');
  });

  it('keeps prayer days and deadlines bound to schedule.timezone, not the app preference', () => {
    const schedule = makePrayerSchedule();
    const tracking = createPrayerTrackingState(new Date('2026-08-28T23:30:00.000Z'));
    const appZone = resolveAppTimeZone('America/New_York', 'Asia/Tokyo');
    expect(appZone.effectiveTimeZone).toBe('America/New_York');
    expect(buildPrayerScheduleDays(schedule, tracking.trackingStartedAt, schedule.date)).toEqual([{
      date: '2026-08-29',
      timezone: 'Europe/London',
      prayers: makePrayerScheduleEntries(),
    }]);

    const snapshot = buildPrayerSchedulePolicySnapshot({
      schedule,
      tracking,
      today: schedule.date,
      now: new Date('2026-08-29T10:00:00.000Z'),
    });
    expect(snapshot.deadlines.Isha?.deadlineAt.toISOString()).toBe('2026-08-29T23:00:00.000Z');
  });

  it('resolves assistant generic wall time in the app zone across the DST boundary', () => {
    const now = new Date('2026-03-28T23:30:00.000Z');
    const london = extractTemporalReference('tomorrow at 9', makeAssistantContext({
      now,
      timezone: 'Europe/London',
    })).resolution;
    const newYork = extractTemporalReference('tomorrow at 9', makeAssistantContext({
      now,
      timezone: 'America/New_York',
    })).resolution;
    expect(london?.start).toBe('2026-03-29T08:00:00.000Z');
    expect(newYork?.start).toBe('2026-03-29T13:00:00.000Z');
    expect(extractTemporalReference('2026-03-29 at 1:30', makeAssistantContext({
      now,
      timezone: 'Europe/London',
    })).resolution).toBeNull();
  });

  it('uses the prayer schedule zone for prayer anchors during an app-zone mismatch', () => {
    const resolution = extractTemporalReference('tomorrow after Dhuhr', makeAssistantContext({
      now: new Date('2026-08-29T10:00:00.000Z'),
      timezone: 'America/New_York',
      prayerTimezone: 'Europe/London',
      prayerTimes: [{ name: 'Dhuhr', time: '12:00' }],
    })).resolution;
    expect(resolution?.start).toBe('2026-08-30T11:30:00.000Z');
  });

  it('writes Google timed events with the effective app zone explicitly', () => {
    expect(localEventToGooglePayload({
      title: 'Review',
      description: '',
      start: '2026-08-29T13:00:00.000Z',
      end: '2026-08-29T14:00:00.000Z',
      allDay: false,
    }, 'America/New_York')).toMatchObject({
      start: { dateTime: '2026-08-29T13:00:00.000Z', timeZone: 'America/New_York' },
      end: { dateTime: '2026-08-29T14:00:00.000Z', timeZone: 'America/New_York' },
    });
    expect(() => localEventToGooglePayload({
      title: 'Review',
      description: '',
      start: '2026-08-29T13:00:00.000Z',
      end: '2026-08-29T14:00:00.000Z',
      allDay: false,
    }, 'Not/AZone')).toThrow('valid app time zone');
  });

  it('keeps direct browser time-zone discovery behind one resolver', () => {
    const resolver = readFileSync(resolve(root, 'src/services/appTimeZone.ts'), 'utf8');
    const prayerContext = readFileSync(resolve(root, 'src/store/contexts/PrayerContext.tsx'), 'utf8');
    const planner = readFileSync(resolve(root, 'src/assistant/planner.ts'), 'utf8');
    const calendarApi = readFileSync(resolve(root, 'src/services/googleCalendarApi.ts'), 'utf8');
    expect(resolver).toContain('Intl.DateTimeFormat().resolvedOptions().timeZone');
    expect(prayerContext).not.toContain('Intl.DateTimeFormat().resolvedOptions().timeZone');
    expect(planner).not.toContain('Intl.DateTimeFormat().resolvedOptions().timeZone');
    expect(calendarApi).not.toContain('Intl.DateTimeFormat().resolvedOptions().timeZone');
  });

  it('keeps React prayer orchestration dependent on cohesive policy boundaries', () => {
    const source = readFileSync(resolve(root, 'src/store/contexts/PrayerContext.tsx'), 'utf8');
    expect(source).toContain("from '../../services/prayerSchedulePolicy'");
    expect(source).toContain("from '../../services/prayerReminderPolicy'");
    expect(source).toContain("from '../../services/prayerCompletionPolicy'");
    expect(source).not.toContain('function buildScheduleDays(');
    expect(source).not.toContain('function reversePrayerGamification(');
  });
});
