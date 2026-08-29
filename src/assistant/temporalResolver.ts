import { LIMITS } from '../config/constants';
import {
  getZonedDate,
  getZonedDateTimeParts,
  shiftIsoDate,
  validateIanaTimeZone,
  zonedDateTimeToInstant,
} from '../services/timeZone';
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

function getTimeZone(context: AssistantCommandContext): string {
  return validateIanaTimeZone(context.timezone) || 'UTC';
}

function getPrayerTimeZone(context: AssistantCommandContext): string {
  return validateIanaTimeZone(context.prayerTimezone) || getTimeZone(context);
}

/** A UTC-backed Date used only as a stable wall-clock calendar marker. */
function toWallDate(instant: Date, timeZone: string): Date {
  const parts = getZonedDateTimeParts(instant, timeZone);
  if (!parts) return new Date(Number.NaN);
  return new Date(Date.UTC(
    parts.year,
    parts.month - 1,
    parts.day,
    parts.hour,
    parts.minute,
    parts.second,
  ));
}

function toWallDateStr(date: Date): string {
  return `${date.getUTCFullYear()}-${String(date.getUTCMonth() + 1).padStart(2, '0')}-${String(date.getUTCDate()).padStart(2, '0')}`;
}

function parseWallDate(value: string, hours = 9): Date | null {
  const normalized = shiftIsoDate(value, 0);
  if (!normalized) return null;
  const [year, month, day] = normalized.split('-').map(Number);
  return new Date(Date.UTC(year, month - 1, day, hours));
}

function cloneAt(date: Date, hours: number, minutes = 0): Date {
  const next = new Date(date);
  next.setUTCHours(hours, minutes, 0, 0);
  return next;
}

function getReferenceInstant(context: AssistantCommandContext): Date {
  const reference = context.now ? new Date(context.now) : new Date();
  return Number.isFinite(reference.getTime()) ? reference : new Date();
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

function findPrayerInstant(
  prayerName: string,
  context: AssistantCommandContext,
  prayerDate: string,
  prayerTimeZone: string,
): Date | null {
  const canonical = PRAYER_NAME_MAP[prayerName.toLowerCase()];
  if (!canonical) return null;
  const prayer = context.prayerTimes?.find(
    entry => entry.name.toLowerCase() === canonical.toLowerCase(),
  );
  if (!prayer) return null;
  const time = parseClockTime(prayer.time);
  if (!time) return null;
  return zonedDateTimeToInstant(
    prayerDate,
    `${String(time.hours).padStart(2, '0')}:${String(time.minutes).padStart(2, '0')}`,
    prayerTimeZone,
  );
}

function nextWeekday(base: Date, targetDay: number): Date {
  const result = new Date(base);
  const delta = (targetDay + 7 - result.getUTCDay()) % 7 || 7;
  result.setUTCDate(result.getUTCDate() + delta);
  return result;
}

function cleanupText(value: string): string {
  return value.replace(/\s+/g, ' ').trim();
}

export function extractTemporalReference(
  input: string,
  context: AssistantCommandContext,
  options: { defaultDurationMs?: number; baseStart?: string; baseEnd?: string } = {},
): TemporalExtraction {
  const defaultDurationMs = options.defaultDurationMs ?? LIMITS.DEFAULT_EVENT_DURATION;
  const original = input;
  let remaining = input;
  const timeZone = getTimeZone(context);
  const prayerTimeZone = getPrayerTimeZone(context);
  const nowInstant = getReferenceInstant(context);
  const now = toWallDate(nowInstant, timeZone);
  const suppliedPrayerDate = shiftIsoDate(context.prayerDate || '', 0);
  const prayerDateNow = suppliedPrayerDate || getZonedDate(nowInstant, prayerTimeZone);
  const prayerNow = prayerDateNow ? parseWallDate(prayerDateNow) : null;
  const baseStart = options.baseStart ? new Date(options.baseStart) : null;
  const baseEnd = options.baseEnd ? new Date(options.baseEnd) : null;
  let baseDate = new Date(now);
  let prayerBaseDate = prayerNow ? new Date(prayerNow) : new Date(now);
  let precision: TemporalResolution['precision'] = 'day';
  const phrases: string[] = [];
  let exactTime: { hours: number; minutes: number } | null = null;
  let prayerAnchoredStart: Date | null = null;
  let prayerAnchorDate: string | null = null;

  const absoluteDate = remaining.match(/\b(\d{4}-\d{2}-\d{2})\b/);
  if (absoluteDate) {
    const parsed = parseWallDate(absoluteDate[1]);
    if (parsed) {
      baseDate = parsed;
      prayerBaseDate = new Date(parsed);
      phrases.push(absoluteDate[0]);
      remaining = remaining.replace(absoluteDate[0], ' ');
    }
  }

  if (/\btomorrow\b/i.test(remaining)) {
    baseDate.setUTCDate(baseDate.getUTCDate() + 1);
    prayerBaseDate.setUTCDate(prayerBaseDate.getUTCDate() + 1);
    phrases.push('tomorrow');
    remaining = remaining.replace(/\btomorrow\b/i, ' ');
  } else if (/\bnext month\b/i.test(remaining)) {
    baseDate.setUTCMonth(baseDate.getUTCMonth() + 1);
    prayerBaseDate.setUTCMonth(prayerBaseDate.getUTCMonth() + 1);
    phrases.push('next month');
    remaining = remaining.replace(/\bnext month\b/i, ' ');
  } else if (/\bnext week\b/i.test(remaining)) {
    baseDate.setUTCDate(baseDate.getUTCDate() + 7);
    prayerBaseDate.setUTCDate(prayerBaseDate.getUTCDate() + 7);
    phrases.push('next week');
    remaining = remaining.replace(/\bnext week\b/i, ' ');
  } else if (/\btoday\b/i.test(remaining)) {
    phrases.push('today');
    remaining = remaining.replace(/\btoday\b/i, ' ');
  }

  const weekdayMatch = remaining.match(
    /\bnext\s+(sunday|monday|tuesday|wednesday|thursday|friday|saturday)\b/i,
  );
  if (weekdayMatch) {
    baseDate = nextWeekday(now, WEEKDAY_MAP[weekdayMatch[1].toLowerCase()]);
    prayerBaseDate = nextWeekday(prayerBaseDate, WEEKDAY_MAP[weekdayMatch[1].toLowerCase()]);
    phrases.push(weekdayMatch[0]);
    remaining = remaining.replace(weekdayMatch[0], ' ');
  }

  const prayerMatch = remaining.match(
    /\b(before|after)\s+(fajr|dhuhr|asr|maghrib|isha|فجر|ظهر|عصر|مغرب|عشاء)\b/i,
  );
  if (prayerMatch) {
    const anchorDate = toWallDateStr(prayerBaseDate);
    const prayerInstant = findPrayerInstant(
      prayerMatch[2],
      context,
      anchorDate,
      prayerTimeZone,
    );
    if (prayerInstant) {
      const offsetMinutes = prayerMatch[1].toLowerCase() === 'before' ? -60 : 30;
      prayerAnchoredStart = new Date(prayerInstant.getTime() + offsetMinutes * 60_000);
      prayerAnchorDate = anchorDate;
      precision = 'window';
      phrases.push(prayerMatch[0]);
      remaining = remaining.replace(prayerMatch[0], ' ');
    }
  }

  if (!prayerAnchoredStart && /\bafter lunch\b/i.test(remaining)) {
    exactTime = { hours: 13, minutes: 30 };
    precision = 'window';
    phrases.push('after lunch');
    remaining = remaining.replace(/\bafter lunch\b/i, ' ');
  }
  if (!prayerAnchoredStart && !exactTime && /\bmorning\b/i.test(remaining)) {
    exactTime = { hours: 9, minutes: 0 };
    precision = 'window';
    phrases.push('morning');
    remaining = remaining.replace(/\bmorning\b/i, ' ');
  }
  if (!prayerAnchoredStart && !exactTime && /\bafternoon\b/i.test(remaining)) {
    exactTime = { hours: 14, minutes: 0 };
    precision = 'window';
    phrases.push('afternoon');
    remaining = remaining.replace(/\bafternoon\b/i, ' ');
  }
  if (!prayerAnchoredStart && !exactTime && /\bevening\b/i.test(remaining)) {
    exactTime = { hours: 18, minutes: 0 };
    precision = 'window';
    phrases.push('evening');
    remaining = remaining.replace(/\bevening\b/i, ' ');
  }
  if (!prayerAnchoredStart && !exactTime && /\btonight\b/i.test(remaining)) {
    exactTime = { hours: 20, minutes: 0 };
    precision = 'window';
    phrases.push('tonight');
    remaining = remaining.replace(/\btonight\b/i, ' ');
  }

  const relativeHourShift = remaining.match(
    /\b(?:(back|ahead|forward|later|earlier)\s+(?:by\s+)?(an|one|\d+)\s+hour(?:s)?|(an|one|\d+)\s+hour(?:s)?\s+(later|earlier))\b/i,
  );
  if (!prayerAnchoredStart && !exactTime && relativeHourShift && baseStart) {
    const verb = (relativeHourShift[1] || relativeHourShift[5] || '').toLowerCase();
    const amountToken = relativeHourShift[2] || relativeHourShift[4] || '1';
    const amount = amountToken.match(/^\d+$/u) ? parseInt(amountToken, 10) : 1;
    const direction = verb === 'earlier' ? -1 : 1;
    const shiftedStart = new Date(baseStart.getTime() + direction * amount * 60 * 60 * 1000);
    const shiftedEnd = baseEnd
      ? new Date(baseEnd.getTime() + direction * amount * 60 * 60 * 1000)
      : new Date(shiftedStart.getTime() + defaultDurationMs);

    phrases.push(relativeHourShift[0]);
    remaining = remaining.replace(relativeHourShift[0], ' ');
    return {
      resolution: {
        phrase: phrases.join(' '),
        date: getZonedDate(shiftedStart, timeZone) || shiftedStart.toISOString().slice(0, 10),
        start: shiftedStart.toISOString(),
        end: shiftedEnd.toISOString(),
        precision: 'exact',
      },
      cleanedText: cleanupText(remaining),
    };
  }

  const explicitTimeMatch = remaining.match(
    /\b(?:at\s+)?(\d{1,2}(?::\d{2})?\s*(?:am|pm)?)\b/i,
  );
  if (!prayerAnchoredStart && !exactTime && explicitTimeMatch) {
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

  let start = prayerAnchoredStart;
  if (!start) {
    const startWall = exactTime
      ? cloneAt(baseDate, exactTime.hours, exactTime.minutes)
      : cloneAt(baseDate, 9, 0);
    if (!exactTime && toWallDateStr(startWall) === toWallDateStr(now)) {
      const nowParts = getZonedDateTimeParts(nowInstant, timeZone);
      if (nowParts) {
        const nextHour = nowParts.hour + 1;
        if (nextHour >= 24) {
          startWall.setUTCDate(startWall.getUTCDate() + 1);
          startWall.setUTCHours(0, 0, 0, 0);
        } else {
          startWall.setUTCHours(nextHour, 0, 0, 0);
        }
      }
    }
    start = zonedDateTimeToInstant(
      toWallDateStr(startWall),
      `${String(startWall.getUTCHours()).padStart(2, '0')}:${String(startWall.getUTCMinutes()).padStart(2, '0')}`,
      timeZone,
    );
  }
  if (!start) return { resolution: null, cleanedText: cleanupText(original) };
  const end = new Date(start.getTime() + defaultDurationMs);

  return {
    resolution: {
      phrase: phrases.join(' '),
      date: prayerAnchorDate || getZonedDate(start, timeZone) || toWallDateStr(baseDate),
      start: start.toISOString(),
      end: end.toISOString(),
      precision,
    },
    cleanedText: cleanupText(remaining),
  };
}
