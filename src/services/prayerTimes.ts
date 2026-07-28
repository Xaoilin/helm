/**
 * Prayer Times Service — Shia Ithna-Ashari (Jafari)
 *
 * Data source: AlAdhan API (https://aladhan.com/prayer-times-api)
 * Method: Shia Ithna-Ashari, Leva Institute, Qum (method=0)
 *   - Fajr angle: 16°
 *   - Isha angle: 14°
 *   - Maghrib: 4° after sunset
 *   - Midnight: Jafari method
 *
 * Source links:
 *   API docs: https://aladhan.com/prayer-times-api
 *   Calculation methods: https://aladhan.com/calculation-methods
 *   Shia method details: Leva Institute, Qum, Iran
 */

import { API_TIMEOUT } from '../config/constants';
import { prayerTimesBreaker } from './serviceBreakers';
import { withRetry } from './retry';
import { toLocalDateStr } from './financeHelpers';

const API_BASE = 'https://api.aladhan.com/v1';
const CACHE_KEY = 'helm:prayer-times-cache';

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

/** Fetch prayer times from AlAdhan API. */
export async function fetchPrayerTimes(city: string, country: string): Promise<PrayerTimesData> {
  const url = `${API_BASE}/timingsByCity?city=${encodeURIComponent(city)}&country=${encodeURIComponent(country)}&method=0`;
  const resp = await prayerTimesBreaker.call(() => withRetry(async () => {
    const response = await fetch(url, { signal: AbortSignal.timeout(API_TIMEOUT.PRAYER_TIMES) });
    if (!response.ok) {
      throw new Error(`Prayer times API error: ${response.status}`);
    }
    return response;
  }, { name: 'PrayerTimes', maxRetries: 2, initialDelayMs: 2000 }));
  const json = await resp.json();
  const data = json.data;
  if (!data || typeof data !== 'object' || !data.timings || typeof data.timings !== 'object') {
    throw new Error('Prayer times API returned an invalid schedule');
  }

  const timings = data.timings as Record<string, string>;
  const missingTimings = REQUIRED_TIMINGS.filter(name =>
    typeof timings[name] !== 'string' || !CLOCK_TIME_PATTERN.test(timings[name].trim())
  );
  if (missingTimings.length > 0) {
    throw new Error(`Prayer times API omitted required timings: ${missingTimings.join(', ')}`);
  }
  if (!hasValidPrayerSequence(timings)) {
    throw new Error('Prayer times API returned an invalid timing sequence');
  }
  const prayers: PrayerTime[] = DISPLAY_ORDER
    .filter(name => timings[name])
    .map(name => ({
      name,
      nameArabic: PRAYER_NAMES[name]?.arabic || name,
      time: timings[name].replace(/\s*\(.*\)/, ''), // strip timezone annotations
      type: PRAYER_NAMES[name]?.type || 'event',
    }));

  const hijri = data.date?.hijri;
  const hijriDate = hijri ? `${hijri.day} ${hijri.month?.en || ''} ${hijri.year}` : '';

  return {
    prayers,
    date: toLocalDateStr(new Date()),
    hijriDate,
    city,
    country,
    timezone: typeof data.meta?.timezone === 'string' ? data.meta.timezone : '',
    method: 'Shia Ithna-Ashari, Leva Institute, Qum',
    fetchedAt: new Date().toISOString(),
    source: 'network',
  };
}

export interface GetPrayerTimesOptions {
  forceRefresh?: boolean;
}

function readPrayerTimesCache(
  city: string,
  country: string,
  todayStr: string,
): PrayerTimesData | null {
  try {
    const raw = localStorage.getItem(CACHE_KEY);
    if (!raw) return null;

    const cached = JSON.parse(raw) as unknown;
    if (
      !isCompletePrayerTimesData(cached)
      || cached.date !== todayStr
      || cached.city !== city
      || cached.country !== country
    ) {
      return null;
    }

    return {
      ...cached,
      timezone: cached.timezone || '',
      source: 'cache',
    };
  } catch {
    return null;
  }
}

/** Load cached prayer times for today, or fetch fresh. */
export async function getPrayerTimes(
  city: string,
  country: string,
  options: GetPrayerTimesOptions = {},
): Promise<PrayerTimesData> {
  const todayStr = toLocalDateStr(new Date());
  const cached = readPrayerTimesCache(city, country, todayStr);

  if (cached && !options.forceRefresh) return cached;

  try {
    const data = await fetchPrayerTimes(city, country);
    try { localStorage.setItem(CACHE_KEY, JSON.stringify(data)); } catch { /* ignore */ }
    return data;
  } catch (error) {
    // A matching same-day cache is safe as a truthful degraded fallback.
    if (cached) return cached;
    throw error;
  }
}

/** Parse "HH:MM" time string to today's Date object. */
export function parseTimeToDate(timeStr: string): Date {
  const [h, m] = timeStr.split(':').map(Number);
  const d = new Date();
  d.setHours(h, m, 0, 0);
  return d;
}

/** Find the next upcoming prayer (wajib only). */
export function getNextPrayer(prayers: PrayerTime[]): { prayer: PrayerTime; minutesUntil: number } | null {
  const now = new Date();
  const wajibPrayers = prayers.filter(p => p.type === 'prayer');

  for (const prayer of wajibPrayers) {
    const prayerDate = parseTimeToDate(prayer.time);
    const diff = (prayerDate.getTime() - now.getTime()) / 60000;
    if (diff > -1) { // allow 1 min grace
      return { prayer, minutesUntil: Math.max(0, diff) };
    }
  }

  // All prayers passed — next is tomorrow's Fajr
  const fajr = wajibPrayers.find(p => p.name === 'Fajr');
  if (fajr) {
    const tomorrow = parseTimeToDate(fajr.time);
    tomorrow.setDate(tomorrow.getDate() + 1);
    const diff = (tomorrow.getTime() - now.getTime()) / 60000;
    return { prayer: fajr, minutesUntil: Math.round(diff) };
  }

  return null;
}

/** Check if a prayer is happening right now (within 1 minute window). */
export function isAdhanTime(prayers: PrayerTime[]): PrayerTime | null {
  const now = new Date();
  const wajib = prayers.filter(p => p.type === 'prayer');

  for (const prayer of wajib) {
    const prayerDate = parseTimeToDate(prayer.time);
    const diffMs = now.getTime() - prayerDate.getTime();
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

/** Data source information for attribution. */
export const PRAYER_SOURCES = {
  api: {
    name: 'AlAdhan Prayer Times API',
    url: 'https://aladhan.com/prayer-times-api',
    description: 'Free RESTful API for Islamic prayer times, Hijri calendar, and Qibla direction.',
  },
  method: {
    name: 'Shia Ithna-Ashari (Jafari)',
    url: 'https://aladhan.com/calculation-methods',
    description: 'Leva Institute, Qum. Fajr: 16°, Isha: 14°, Maghrib: 4° after sunset, Midnight: Jafari method.',
  },
  verification: {
    name: 'AlAdhan Prayer Times Calendar',
    url: 'https://aladhan.com/prayer-times',
    description: 'Verify prayer times directly on the AlAdhan website.',
  },
};
