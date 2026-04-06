import { LIMITS } from '../config/constants';
import type { AssistantCommandContext } from './shared';

export interface TemporalResolution {
  phrase: string;
  date: string;
  start: string;
  end: string;
  precision: 'day' | 'exact' | 'window';
}

export interface TemporalExtraction {
  resolution: TemporalResolution | null;
  cleanedText: string;
}

const WEEKDAY_MAP: Record<string, number> = {
  sunday: 0,
  monday: 1,
  tuesday: 2,
  wednesday: 3,
  thursday: 4,
  friday: 5,
  saturday: 6,
};

const PRAYER_NAME_MAP: Record<string, string> = {
  fajr: 'Fajr',
  dhuhr: 'Dhuhr',
  asr: 'Asr',
  maghrib: 'Maghrib',
  isha: 'Isha',
  فجر: 'Fajr',
  ظهر: 'Dhuhr',
  عصر: 'Asr',
  مغرب: 'Maghrib',
  عشاء: 'Isha',
};

function toLocalDateStr(date: Date): string {
  return `${date.getFullYear()}-${String(date.getMonth() + 1).padStart(2, '0')}-${String(date.getDate()).padStart(2, '0')}`;
}

function cloneAt(date: Date, hours: number, minutes = 0): Date {
  const next = new Date(date);
  next.setHours(hours, minutes, 0, 0);
  return next;
}

function getReferenceDate(context: AssistantCommandContext): Date {
  return context.now ? new Date(context.now) : new Date();
}

function parseClockTime(value: string): { hours: number; minutes: number } | null {
  const match = value.match(/\b(\d{1,2})(?::(\d{2}))?\s*(am|pm)?\b/i);
  if (!match) return null;

  let hours = parseInt(match[1], 10);
  const minutes = match[2] ? parseInt(match[2], 10) : 0;
  const suffix = match[3]?.toLowerCase();

  if (suffix === 'pm' && hours < 12) hours += 12;
  if (suffix === 'am' && hours === 12) hours = 0;
  if (hours > 23 || minutes > 59) return null;

  return { hours, minutes };
}

function findPrayerTime(
  prayerName: string,
  context: AssistantCommandContext,
  date: Date,
): Date | null {
  const canonical = PRAYER_NAME_MAP[prayerName.toLowerCase()];
  if (!canonical) return null;

  const prayer = context.prayerTimes?.find(entry => entry.name.toLowerCase() === canonical.toLowerCase());
  if (!prayer) return null;

  const time = parseClockTime(prayer.time);
  if (!time) return null;

  return cloneAt(date, time.hours, time.minutes);
}

function nextWeekday(base: Date, targetDay: number): Date {
  const result = new Date(base);
  const delta = (targetDay + 7 - result.getDay()) % 7 || 7;
  result.setDate(result.getDate() + delta);
  return result;
}

function cleanupText(value: string): string {
  return value.replace(/\s+/g, ' ').trim();
}

export function extractTemporalReference(
  input: string,
  context: AssistantCommandContext,
  options: { defaultDurationMs?: number } = {},
): TemporalExtraction {
  const defaultDurationMs = options.defaultDurationMs ?? LIMITS.DEFAULT_EVENT_DURATION;
  const original = input;
  let remaining = input;
  const now = getReferenceDate(context);
  let baseDate = new Date(now);
  let precision: TemporalResolution['precision'] = 'day';
  const phrases: string[] = [];
  let exactTime: { hours: number; minutes: number } | null = null;

  const absoluteDate = remaining.match(/\b(\d{4}-\d{2}-\d{2})\b/);
  if (absoluteDate) {
    const parsed = new Date(`${absoluteDate[1]}T09:00:00`);
    if (!Number.isNaN(parsed.getTime())) {
      baseDate = parsed;
      phrases.push(absoluteDate[0]);
      remaining = remaining.replace(absoluteDate[0], ' ');
    }
  }

  if (/\btomorrow\b/i.test(remaining)) {
    baseDate.setDate(baseDate.getDate() + 1);
    phrases.push('tomorrow');
    remaining = remaining.replace(/\btomorrow\b/i, ' ');
  } else if (/\bnext week\b/i.test(remaining)) {
    baseDate.setDate(baseDate.getDate() + 7);
    phrases.push('next week');
    remaining = remaining.replace(/\bnext week\b/i, ' ');
  } else if (/\btoday\b/i.test(remaining)) {
    phrases.push('today');
    remaining = remaining.replace(/\btoday\b/i, ' ');
  }

  const weekdayMatch = remaining.match(/\bnext\s+(sunday|monday|tuesday|wednesday|thursday|friday|saturday)\b/i);
  if (weekdayMatch) {
    baseDate = nextWeekday(now, WEEKDAY_MAP[weekdayMatch[1].toLowerCase()]);
    phrases.push(weekdayMatch[0]);
    remaining = remaining.replace(weekdayMatch[0], ' ');
  }

  const prayerMatch = remaining.match(/\b(before|after)\s+(fajr|dhuhr|asr|maghrib|isha|فجر|ظهر|عصر|مغرب|عشاء)\b/i);
  if (prayerMatch) {
    const prayerDate = findPrayerTime(prayerMatch[2], context, baseDate);
    if (prayerDate) {
      const offset = prayerMatch[1].toLowerCase() === 'before' ? -60 : 30;
      const next = new Date(prayerDate);
      next.setMinutes(next.getMinutes() + offset);
      exactTime = { hours: next.getHours(), minutes: next.getMinutes() };
      precision = 'window';
      phrases.push(prayerMatch[0]);
      remaining = remaining.replace(prayerMatch[0], ' ');
    }
  }

  if (!exactTime && /\bafter lunch\b/i.test(remaining)) {
    exactTime = { hours: 13, minutes: 30 };
    precision = 'window';
    phrases.push('after lunch');
    remaining = remaining.replace(/\bafter lunch\b/i, ' ');
  }

  if (!exactTime && /\bmorning\b/i.test(remaining)) {
    exactTime = { hours: 9, minutes: 0 };
    precision = 'window';
    phrases.push('morning');
    remaining = remaining.replace(/\bmorning\b/i, ' ');
  }

  if (!exactTime && /\bafternoon\b/i.test(remaining)) {
    exactTime = { hours: 14, minutes: 0 };
    precision = 'window';
    phrases.push('afternoon');
    remaining = remaining.replace(/\bafternoon\b/i, ' ');
  }

  if (!exactTime && /\bevening\b/i.test(remaining)) {
    exactTime = { hours: 18, minutes: 0 };
    precision = 'window';
    phrases.push('evening');
    remaining = remaining.replace(/\bevening\b/i, ' ');
  }

  if (!exactTime && /\btonight\b/i.test(remaining)) {
    exactTime = { hours: 20, minutes: 0 };
    precision = 'window';
    phrases.push('tonight');
    remaining = remaining.replace(/\btonight\b/i, ' ');
  }

  const explicitTimeMatch = remaining.match(/\b(?:at\s+)?(\d{1,2}(?::\d{2})?\s*(?:am|pm)?)\b/i);
  if (!exactTime && explicitTimeMatch) {
    const parsed = parseClockTime(explicitTimeMatch[1]);
    if (parsed) {
      exactTime = parsed;
      precision = 'exact';
      phrases.push(explicitTimeMatch[0]);
      remaining = remaining.replace(explicitTimeMatch[0], ' ');
    }
  }

  if (phrases.length === 0) {
    return { resolution: null, cleanedText: cleanupText(original) };
  }

  const start = exactTime ? cloneAt(baseDate, exactTime.hours, exactTime.minutes) : cloneAt(baseDate, 9, 0);
  if (!exactTime && toLocalDateStr(start) === toLocalDateStr(now) && start < now) {
    start.setHours(now.getHours() + 1, 0, 0, 0);
  }
  const end = new Date(start.getTime() + defaultDurationMs);

  return {
    resolution: {
      phrase: phrases.join(' '),
      date: toLocalDateStr(start),
      start: start.toISOString(),
      end: end.toISOString(),
      precision,
    },
    cleanedText: cleanupText(remaining),
  };
}
