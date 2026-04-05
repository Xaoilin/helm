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
  method: string;
  fetchedAt: string;
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

function toLocalDateStr(d: Date): string {
  return `${d.getFullYear()}-${String(d.getMonth() + 1).padStart(2, '0')}-${String(d.getDate()).padStart(2, '0')}`;
}

/** Fetch prayer times from AlAdhan API. */
export async function fetchPrayerTimes(city: string, country: string): Promise<PrayerTimesData> {
  const url = `${API_BASE}/timingsByCity?city=${encodeURIComponent(city)}&country=${encodeURIComponent(country)}&method=0`;
  const resp = await fetch(url, { signal: AbortSignal.timeout(API_TIMEOUT.PRAYER_TIMES) });
  if (!resp.ok) throw new Error(`Prayer times API error: ${resp.status}`);
  const json = await resp.json();
  const data = json.data;

  const timings = data.timings as Record<string, string>;
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
    method: 'Shia Ithna-Ashari, Leva Institute, Qum',
    fetchedAt: new Date().toISOString(),
  };
}

/** Load cached prayer times for today, or fetch fresh. */
export async function getPrayerTimes(city: string, country: string): Promise<PrayerTimesData> {
  const todayStr = toLocalDateStr(new Date());

  // Check cache
  try {
    const raw = localStorage.getItem(CACHE_KEY);
    if (raw) {
      const cached = JSON.parse(raw) as PrayerTimesData;
      if (cached.date === todayStr && cached.city === city && cached.country === country) {
        return cached;
      }
    }
  } catch { /* ignore */ }

  // Fetch fresh
  const data = await fetchPrayerTimes(city, country);
  try { localStorage.setItem(CACHE_KEY, JSON.stringify(data)); } catch { /* ignore */ }
  return data;
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
