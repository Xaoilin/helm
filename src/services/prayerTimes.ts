/**
 * Prayer times — Shia Ithna-Ashari (Jafari)
 *
 * The Sabah One prayer service is the only source: it fetches and caches each location's timetable
 * from AlAdhan (method 0: Leva Institute, Qum — Fajr 16°, Isha 14°, Maghrib 4° after sunset, Jafari
 * midnight). The app checks every timetable it receives is complete and in order.
 */

import { getPrayerSchedule } from './backend/prayerServiceApi';
import type { ServiceSchedule } from './backend/contracts';
import {
  getPrayerZonedDate,
  prayerZonedDateTimeToInstant,
  shiftPrayerDate,
  validatePrayerTimeZone,
} from './prayerTimeZone';

export interface PrayerTime {
  name: string;
  nameArabic: string;
  time: string; // HH:MM format
  type: 'prayer' | 'event'; // prayer = wajib salah, event = sunrise/sunset/midnight
}

export interface PrayerTimesData {
  prayers: PrayerTime[];
  date: string; // YYYY-MM-DD
  hijriDate: string;
  city: string;
  country: string;
  timezone: string;
  method: string;
  fetchedAt: string;
  source: 'network' | 'cache';
}

export const PRAYER_NAMES: Record<string, { arabic: string; type: 'prayer' | 'event' }> = {
  Fajr: { arabic: '\u0627\u0644\u0641\u062C\u0631', type: 'prayer' },
  Sunrise: { arabic: '\u0627\u0644\u0634\u0631\u0648\u0642', type: 'event' },
  Dhuhr: { arabic: '\u0627\u0644\u0638\u0647\u0631', type: 'prayer' },
  Asr: { arabic: '\u0627\u0644\u0639\u0635\u0631', type: 'prayer' },
  Sunset: { arabic: '\u063A\u0631\u0648\u0628', type: 'event' },
  Maghrib: { arabic: '\u0627\u0644\u0645\u063A\u0631\u0628', type: 'prayer' },
  Isha: { arabic: '\u0627\u0644\u0639\u0634\u0627\u0621', type: 'prayer' },
  Midnight: { arabic: '\u0646\u0635\u0641 \u0627\u0644\u0644\u064A\u0644', type: 'event' },
};

const DISPLAY_ORDER = ['Fajr', 'Sunrise', 'Dhuhr', 'Asr', 'Sunset', 'Maghrib', 'Isha', 'Midnight'];
const REQUIRED_TIMINGS = DISPLAY_ORDER;
const CLOCK_TIME_PATTERN = /^([01]?\d|2[0-3]):([0-5]\d)(?:\s*\([^)]*\))?$/u;

function clockMinutes(value: string): number | null {
  const match = CLOCK_TIME_PATTERN.exec(value.trim());
  if (!match) return null;
  return Number(match[1]) * 60 + Number(match[2]);
}

function hasValidPrayerSequence(timings: Readonly<Record<string, string>>): boolean {
  const values = Object.fromEntries(REQUIRED_TIMINGS.map(name => [
    name,
    clockMinutes(timings[name] || ''),
  ])) as Record<(typeof REQUIRED_TIMINGS)[number], number | null>;
  if (Object.values(values).some(value => value === null)) return false;

  const fajr = values.Fajr!;
  const sunrise = values.Sunrise!;
  const dhuhr = values.Dhuhr!;
  const asr = values.Asr!;
  const sunset = values.Sunset!;
  const maghrib = values.Maghrib!;
  const isha = values.Isha!;
  const midnight = values.Midnight! <= isha ? values.Midnight! + 24 * 60 : values.Midnight!;

  return fajr < sunrise
    && sunrise < dhuhr
    && dhuhr <= asr
    && asr < sunset
    && sunset <= maghrib
    && maghrib <= isha
    && isha < midnight
    && midnight < fajr + 24 * 60;
}

function isCompletePrayerTimesData(value: unknown): value is PrayerTimesData {
  if (!value || typeof value !== 'object') return false;
  const candidate = value as Partial<PrayerTimesData>;
  if (
    typeof candidate.date !== 'string'
    || typeof candidate.city !== 'string'
    || typeof candidate.country !== 'string'
    || typeof candidate.timezone !== 'string'
    || typeof candidate.method !== 'string'
    || typeof candidate.fetchedAt !== 'string'
    || !Array.isArray(candidate.prayers)
  ) {
    return false;
  }

  const entries = new Map(candidate.prayers.map(prayer => [prayer?.name, prayer]));
  const complete = REQUIRED_TIMINGS.every(name => {
    const entry = entries.get(name);
    return Boolean(
      entry
      && typeof entry.nameArabic === 'string'
      && typeof entry.time === 'string'
      && CLOCK_TIME_PATTERN.test(entry.time)
      && entry.type === PRAYER_NAMES[name]?.type,
    );
  });
  if (!complete) return false;
  return hasValidPrayerSequence(Object.fromEntries(
    REQUIRED_TIMINGS.map(name => [name, entries.get(name)!.time]),
  ));
}

/**
 * Turns the prayer service's timetable into the app's, refusing one that is incomplete, out of
 * order, or in an invalid time zone.
 */
export function prayerTimesFromSchedule(schedule: ServiceSchedule, fetchedAt = new Date()): PrayerTimesData {
  const timezone = validatePrayerTimeZone(schedule.timezone);
  if (!timezone) throw new Error('The prayer service returned an invalid or missing timezone');
  const data: PrayerTimesData = {
    prayers: DISPLAY_ORDER.flatMap(name => {
      const entry = schedule.times.find(time => time.name === name);
      return entry ? [{ name, nameArabic: entry.nameArabic, time: entry.time, type: entry.type }] : [];
    }),
    date: schedule.date,
    hijriDate: schedule.hijriDate,
    city: schedule.city,
    country: schedule.country,
    timezone,
    method: schedule.method,
    fetchedAt: fetchedAt.toISOString(),
    source: 'network',
  };
  if (!isCompletePrayerTimesData(data)) {
    throw new Error('The prayer service returned an incomplete or out-of-order timetable');
  }
  return data;
}

/** The timetable for a location, today by default, from the prayer service. */
export async function getPrayerTimes(city: string, country: string, date?: string): Promise<PrayerTimesData> {
  return prayerTimesFromSchedule(await getPrayerSchedule(city, country, date));
}

/** Find the next upcoming prayer (wajib only). */
export function getNextPrayer(
  prayers: PrayerTime[],
  now: Date,
  timeZone: string,
): { prayer: PrayerTime; minutesUntil: number } | null {
  const prayerDate = getPrayerZonedDate(now, timeZone);
  if (!prayerDate) return null;
  const wajibPrayers = prayers.filter(p => p.type === 'prayer');

  for (const prayer of wajibPrayers) {
    const prayerInstant = prayerZonedDateTimeToInstant(prayerDate, prayer.time, timeZone);
    if (!prayerInstant) return null;
    const diff = (prayerInstant.getTime() - now.getTime()) / 60000;
    if (diff > -1) { // allow 1 min grace
      return { prayer, minutesUntil: Math.max(0, diff) };
    }
  }

  // All prayers passed — next is tomorrow's Fajr
  const fajr = wajibPrayers.find(p => p.name === 'Fajr');
  if (fajr) {
    const tomorrowDate = shiftPrayerDate(prayerDate, 1);
    const tomorrow = tomorrowDate
      ? prayerZonedDateTimeToInstant(tomorrowDate, fajr.time, timeZone)
      : null;
    if (!tomorrow) return null;
    const diff = (tomorrow.getTime() - now.getTime()) / 60000;
    return { prayer: fajr, minutesUntil: Math.round(diff) };
  }

  return null;
}

/** Check if a prayer is happening right now (within 1 minute window). */
export function isAdhanTime(prayers: PrayerTime[], now: Date, timeZone: string): PrayerTime | null {
  const prayerDate = getPrayerZonedDate(now, timeZone);
  if (!prayerDate) return null;
  const wajib = prayers.filter(p => p.type === 'prayer');

  for (const prayer of wajib) {
    const prayerInstant = prayerZonedDateTimeToInstant(prayerDate, prayer.time, timeZone);
    if (!prayerInstant) return null;
    const diffMs = now.getTime() - prayerInstant.getTime();
    // Within 0-60 seconds after prayer time
    if (diffMs >= 0 && diffMs < 60000) {
      return prayer;
    }
  }
  return null;
}

/** Format minutes until prayer as human-readable. */
export function formatTimeUntil(minutes: number): string {
  if (minutes < 1) return 'now';
  if (minutes < 60) return `${Math.floor(minutes)}m ${Math.round((minutes % 1) * 60)}s`;
  const h = Math.floor(minutes / 60);
  const m = Math.floor(minutes % 60);
  return m > 0 ? `${h}h ${m}m` : `${h}h`;
}
