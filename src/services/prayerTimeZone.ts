const PRAYER_DATE_PATTERN = /^(\d{4})-(\d{2})-(\d{2})$/u;
const PRAYER_CLOCK_PATTERN = /^([01]\d|2[0-3]):([0-5]\d)(?::([0-5]\d))?$/u;
const OFFSET_SAMPLE_HOURS = [-48, -24, 0, 24, 48] as const;
const validatedTimeZones = new Map<string, boolean>();
const zonedFormatters = new Map<string, Intl.DateTimeFormat>();
const dateOffsets = new Map<string, readonly number[]>();

export interface PrayerZonedDateTimeParts {
  year: number;
  month: number;
  day: number;
  hour: number;
  minute: number;
  second: number;
}

function isValidDateParts(year: number, month: number, day: number): boolean {
  const candidate = new Date(Date.UTC(year, month - 1, day));
  return candidate.getUTCFullYear() === year
    && candidate.getUTCMonth() === month - 1
    && candidate.getUTCDate() === day;
}

function readNumericPart(parts: Intl.DateTimeFormatPart[], type: Intl.DateTimeFormatPartTypes): number {
  return Number(parts.find(part => part.type === type)?.value);
}

export function validatePrayerTimeZone(timeZone: string): string {
  if (!timeZone) return '';
  const cached = validatedTimeZones.get(timeZone);
  if (cached !== undefined) return cached ? timeZone : '';
  try {
    new Intl.DateTimeFormat('en-GB', { timeZone }).format();
    validatedTimeZones.set(timeZone, true);
    return timeZone;
  } catch {
    validatedTimeZones.set(timeZone, false);
    return '';
  }
}

function getPrayerZonedFormatter(timeZone: string): Intl.DateTimeFormat | null {
  if (!validatePrayerTimeZone(timeZone)) return null;
  const cached = zonedFormatters.get(timeZone);
  if (cached) return cached;
  try {
    const formatter = new Intl.DateTimeFormat('en-GB-u-ca-gregory-nu-latn', {
      timeZone,
      year: 'numeric',
      month: '2-digit',
      day: '2-digit',
      hour: '2-digit',
      minute: '2-digit',
      second: '2-digit',
      hourCycle: 'h23',
    });
    zonedFormatters.set(timeZone, formatter);
    return formatter;
  } catch {
    return null;
  }
}

export function getPrayerZonedDateTimeParts(
  instant: Date,
  timeZone: string,
): PrayerZonedDateTimeParts | null {
  if (!Number.isFinite(instant.getTime())) return null;

  try {
    const formatter = getPrayerZonedFormatter(timeZone);
    if (!formatter) return null;
    const parts = formatter.formatToParts(instant);
    const result = {
      year: readNumericPart(parts, 'year'),
      month: readNumericPart(parts, 'month'),
      day: readNumericPart(parts, 'day'),
      hour: readNumericPart(parts, 'hour'),
      minute: readNumericPart(parts, 'minute'),
      second: readNumericPart(parts, 'second'),
    };
    return Object.values(result).every(Number.isFinite) ? result : null;
  } catch {
    return null;
  }
}

export function getPrayerZonedDate(instant: Date, timeZone: string): string | null {
  const parts = getPrayerZonedDateTimeParts(instant, timeZone);
  if (!parts) return null;
  return `${String(parts.year).padStart(4, '0')}-${String(parts.month).padStart(2, '0')}-${String(parts.day).padStart(2, '0')}`;
}

export function getPrayerZonedClockSeconds(instant: Date, timeZone: string): number | null {
  const parts = getPrayerZonedDateTimeParts(instant, timeZone);
  if (!parts) return null;
  return parts.hour * 3600 + parts.minute * 60 + parts.second + instant.getMilliseconds() / 1000;
}

export function shiftPrayerDate(date: string, days: number): string | null {
  const match = PRAYER_DATE_PATTERN.exec(date);
  if (!match || !Number.isInteger(days)) return null;
  const year = Number(match[1]);
  const month = Number(match[2]);
  const day = Number(match[3]);
  if (!isValidDateParts(year, month, day)) return null;

  const shifted = new Date(Date.UTC(year, month - 1, day + days));
  return `${String(shifted.getUTCFullYear()).padStart(4, '0')}-${String(shifted.getUTCMonth() + 1).padStart(2, '0')}-${String(shifted.getUTCDate()).padStart(2, '0')}`;
}

/**
 * Convert a validated schedule wall-clock value into its real instant.
 * Ambiguous fall-back clock values resolve to the first occurrence; nonexistent
 * spring-forward values fail closed.
 */
export function prayerZonedDateTimeToInstant(
  date: string,
  clock: string,
  timeZone: string,
): Date | null {
  const dateMatch = PRAYER_DATE_PATTERN.exec(date);
  const clockMatch = PRAYER_CLOCK_PATTERN.exec(clock.trim());
  if (!dateMatch || !clockMatch || !validatePrayerTimeZone(timeZone)) return null;

  const target = {
    year: Number(dateMatch[1]),
    month: Number(dateMatch[2]),
    day: Number(dateMatch[3]),
    hour: Number(clockMatch[1]),
    minute: Number(clockMatch[2]),
    second: Number(clockMatch[3] ?? 0),
  };
  if (!isValidDateParts(target.year, target.month, target.day)) return null;

  const targetWallMilliseconds = Date.UTC(
    target.year,
    target.month - 1,
    target.day,
    target.hour,
    target.minute,
    target.second,
  );
  const offsetCacheKey = `${timeZone}|${date}`;
  let offsets = dateOffsets.get(offsetCacheKey);
  if (!offsets) {
    const discoveredOffsets = new Set<number>();
    const dateMiddayMilliseconds = Date.UTC(target.year, target.month - 1, target.day, 12);
    for (const sampleHours of OFFSET_SAMPLE_HOURS) {
      const sample = new Date(dateMiddayMilliseconds + sampleHours * 3600_000);
      const sampleParts = getPrayerZonedDateTimeParts(sample, timeZone);
      if (!sampleParts) return null;
      discoveredOffsets.add(Date.UTC(
        sampleParts.year,
        sampleParts.month - 1,
        sampleParts.day,
        sampleParts.hour,
        sampleParts.minute,
        sampleParts.second,
      ) - sample.getTime());
    }
    offsets = [...discoveredOffsets];
    dateOffsets.set(offsetCacheKey, offsets);
  }

  const matches = offsets
    .map(offset => new Date(targetWallMilliseconds - offset))
    .filter(candidate => {
      const parts = getPrayerZonedDateTimeParts(candidate, timeZone);
      return parts !== null
        && parts.year === target.year
        && parts.month === target.month
        && parts.day === target.day
        && parts.hour === target.hour
        && parts.minute === target.minute
        && parts.second === target.second;
    })
    .sort((left, right) => left.getTime() - right.getTime());

  return matches[0] ?? null;
}

export function formatPrayerInstantTime(instant: Date, timeZone: string): string {
  if (!Number.isFinite(instant.getTime()) || !validatePrayerTimeZone(timeZone)) return '—';
  try {
    return instant.toLocaleTimeString([], {
      timeZone,
      hour: '2-digit',
      minute: '2-digit',
    });
  } catch {
    return '—';
  }
}
